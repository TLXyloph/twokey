import { describe, expect, it } from "vitest";
import { verifyChain } from "@/ledger/chain";
import type { LedgerEvent } from "@/ledger/contracts";
import { projectRequests } from "@/ledger/request-projection";
import { SEED_VERSION, seedHash } from "@/ledger/seed";
import { harness, SESSION } from "./harness";

describe("opening a judge session", () => {
  it("records session.opened, then each seeded request with key 1 and a rules card", async () => {
    const h = await harness();
    const events = await h.ledger.read(SESSION);
    expect(events.map((e) => e.type)).toEqual([
      "session.opened",
      "payout.requested",
      "approval.signed",
      "risk.assessed",
      "payout.requested",
      "approval.signed",
      "risk.assessed",
    ]);
    expect(events[0]).toMatchObject({ seq: 1, prevHash: await seedHash(), payload: { seedVersion: SEED_VERSION, seedHash: await seedHash() } });
    expect(await verifyChain(events, await seedHash())).toMatchObject({ ok: true, length: 7 });
  });

  it("signs key 1 with the requester's real demo key, bound to the request event", async () => {
    const h = await harness();
    const events = await h.ledger.read(SESSION);
    const states = projectRequests(events);
    expect(states.map((s) => [s.request.requestId, s.request.source, s.signatures[0]?.role])).toEqual([
      ["L14", "seed", "treasurer"],
      ["L15", "seed", "secretary"],
    ]);
    for (const state of states) {
      const key1 = state.signatures[0]!;
      const requested = events.find((e) => e.type === "payout.requested" && (e as LedgerEvent<"payout.requested">).payload.requestId === state.request.requestId)!;
      expect(key1.signed).toMatchObject({ requestHash: state.request.requestHash, riskCardHash: null, acknowledgedFlags: false, prevHash: requested.hash });
      expect(await h.verifier.verify(key1.role, key1.signed, key1.signature, key1.keyId)).toBe(true);
      expect(key1.keyId).toBe(h.keys.publicKeys[key1.role].keyId);
    }
  });

  it("asks the injected RiskAssessor for each rules card, with every seeded request for the split check", async () => {
    const h = await harness();
    await h.ledger.read(SESSION);
    expect(h.risk.rulesCard).toHaveBeenCalledTimes(2);
    const [input] = h.risk.rulesCard.mock.calls[0]!;
    expect(input.request.requestId).toBe("L14");
    expect(input.sessionRequests.map((r) => r.requestId)).toEqual(["L14", "L15"]);
    expect(h.risk.aiCard).not.toHaveBeenCalled();
  });

  it("opens once when two first requests race, and never again", async () => {
    const h = await harness();
    const [a, b] = await Promise.all([h.ledger.read(SESSION), h.ledger.read(SESSION)]);
    expect(a).toHaveLength(7);
    expect(b).toEqual(a);
    expect(await h.ledger.read(SESSION)).toHaveLength(7);
  });

  it("gives every session its own request hashes", async () => {
    const h = await harness();
    const hashes = async (session: string) => projectRequests(await h.ledger.read(session)).map((s) => s.request.requestHash);
    const [mine, theirs] = [await hashes(SESSION), await hashes("session-bbbbbbbbbbbbbbbb")];
    expect(mine.filter((hash) => theirs.includes(hash))).toEqual([]);
  });
});
