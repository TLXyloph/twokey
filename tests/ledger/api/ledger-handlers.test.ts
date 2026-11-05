import { describe, expect, it, vi } from "vitest";
import type { JudgeApiDeps } from "@/disbursements/api/judge-context";
import { eventHash } from "@/ledger/chain";
import type { WatchtowerView } from "@/watchtower/contracts";
import type { BoardView, ChainCheck, LedgerEvent } from "@/ledger/contracts";
import type { LedgerTable } from "@/ledger/ledger-table";
import { seedHash } from "@/ledger/seed";
import { handleLedgerVerify, handleLedgerView } from "@/ledger/api/ledger-handlers";
import { riverbend } from "@/demo/riverbend";
import { errorOf, get, judgeFixture } from "../../disbursements/api/judge-fixtures";

/** Re-hashes a chain after `change`, so only a check deeper than the hashes can catch it. */
async function rechained(events: LedgerEvent[], change: (event: LedgerEvent) => LedgerEvent): Promise<LedgerEvent[]> {
  const out: LedgerEvent[] = [];
  let prevHash = await seedHash();
  for (const original of events) {
    const event = { ...change(original), prevHash };
    event.hash = await eventHash(event);
    out.push(event);
    prevHash = event.hash;
  }
  return out;
}

describe("GET /api/ledger/view", () => {
  it("opens the session and answers its BoardView, never cached", async () => {
    const sharedBalance = { availableCents: 499_750, currency: "USD" as const, asOf: "2026-11-05T13:59:59Z" };
    const f = await judgeFixture({ sharedBalance: async () => sharedBalance });
    const response = await handleLedgerView(get("/api/ledger/view", f.cookie), f.deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const board = (await response.json()) as BoardView;
    expect(board.data).toEqual(riverbend);
    expect(board.requests.map((r) => [r.requestId, r.status, r.eligibleSigners])).toEqual([
      ["L15", "waiting", ["president"]],
      ["L14", "waiting", ["president", "secretary"]],
    ]);
    expect(board.sharedBalance).toEqual(sharedBalance);
    expect(board.limits).toEqual({ payoutCapCents: 5000, sessionPayoutsLeft: 3, dailyCentsLeft: 50_000 });
    expect(board.chain.length).toBe(7);
  });

  it("shows no shared balance rather than failing when PayPal's can't be read", async () => {
    const f = await judgeFixture({ sharedBalance: async () => Promise.reject(new Error("PayPal down")) });
    const board = (await (await handleLedgerView(get("/api/ledger/view", f.cookie), f.deps)).json()) as BoardView;
    expect(board.sharedBalance).toBeNull();
  });

  it("carries the global Watchtower's view, the same for every session", async () => {
    const watchtower: WatchtowerView = { status: "stale_reports", checkedAt: "2026-11-05T15:00:02.000Z", paypalAsOf: "2026-11-05T08:59:59Z", findings: [], explained: [] };
    const read = vi.fn(async () => watchtower);
    const f = await judgeFixture({ watchtower: read });
    const board = (await (await handleLedgerView(get("/api/ledger/view", f.cookie), f.deps)).json()) as BoardView;
    expect(board.watchtower).toEqual(watchtower);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("shows no Watchtower (null) rather than failing when it can't be read", async () => {
    for (const watchtower of [async () => Promise.reject(new Error("D1 down")), () => { throw new Error("sync"); }, undefined]) {
      const f = await judgeFixture({ watchtower: watchtower as JudgeApiDeps["watchtower"] });
      const response = await handleLedgerView(get("/api/ledger/view", f.cookie), f.deps);
      expect(response.status).toBe(200);
      expect(((await response.json()) as BoardView).watchtower).toBeNull();
    }
  });

  it("needs a session cookie, but not a same-origin header (it's a GET)", async () => {
    const f = await judgeFixture();
    expect((await handleLedgerView(get("/api/ledger/view", null), f.deps)).status).toBe(401);
    expect(await errorOf(await handleLedgerView(get("/api/ledger/view", null), f.deps))).toMatchObject({ code: "no_session" });
  });
});

describe("GET /api/ledger/verify", () => {
  it("answers ok with the chain's length and head", async () => {
    const f = await judgeFixture();
    const view = (await (await handleLedgerView(get("/api/ledger/view", f.cookie), f.deps)).json()) as BoardView;
    const check = (await (await handleLedgerVerify(get("/api/ledger/verify", f.cookie), f.deps)).json()) as ChainCheck;
    expect(check).toEqual({ ok: true, length: 7, head: view.chain.head });
  });

  it("names the first event whose contents were changed", async () => {
    const f = await judgeFixture();
    await handleLedgerView(get("/api/ledger/view", f.cookie), f.deps);
    const tampered: LedgerTable = {
      ...f.table,
      events: async (sessionId) =>
        (await f.table.events(sessionId)).map((e) => (e.seq === 2 ? ({ ...e, payload: { ...e.payload, amountCents: 1 } } as LedgerEvent) : e)),
    };
    const response = await handleLedgerVerify(get("/api/ledger/verify", f.cookie), { ...f.deps, table: tampered });
    expect(await response.json()).toEqual({ ok: false, badSeq: 2, reason: "Event 2's contents don't match its hash." });
    expect(f.lines.at(-1)).toContain("outcome=broken status=200");
  });

  it("catches a forged signature even in a chain re-hashed to look consistent", async () => {
    const f = await judgeFixture();
    await handleLedgerView(get("/api/ledger/view", f.cookie), f.deps);
    const forged = await rechained(await f.table.events(f.sessionId), (e) =>
      e.type === "approval.signed" ? ({ ...e, payload: { ...e.payload, signed: { ...(e as LedgerEvent<"approval.signed">).payload.signed, amountCents: 1 } } } as LedgerEvent) : e,
    );
    const response = await handleLedgerVerify(get("/api/ledger/verify", f.cookie), { ...f.deps, table: { ...f.table, events: async () => forged } });
    expect(await response.json()).toEqual({ ok: false, badSeq: 3, reason: "Event 3: its signature doesn't verify against the published demo key." });
  });
});
