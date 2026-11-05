import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import type { CreatePayoutRequestBody } from "@/ledger/contracts";
import { fixtureOptionsFrom } from "@/ui/judge/board-view-source";
import { createFixtureTransport } from "@/ui/judge/dev/fixture-transport";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-05T16:40:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

/** Runs a fake call to completion: 250 ms of latency, 1.8 s for the AI's read; PayPal confirms after 6 s. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(2_500);
  return promise;
}

const cones: CreatePayoutRequestBody = {
  actingAs: "secretary",
  payeeId: "team-supply",
  amountCents: 4_800,
  description: "Practice cones",
  budgetLine: "equipment",
  receiptId: "cones-team-supply",
};

describe("the dev fixture's fake server", () => {
  it("starts as a fresh judge session: two waiting payouts, three sends left", async () => {
    const view = await settle(createFixtureTransport().getView());
    expect(view.requests.map((r) => [r.description, r.status])).toEqual([
      ["Goalkeeper gloves", "waiting"],
      ["Field paint, reimbursement", "waiting"],
    ]);
    expect(view.limits.sessionPayoutsLeft).toBe(3);
  });

  it("refuses the payee, records the refusal, and sends nothing", async () => {
    const transport = createFixtureTransport();
    const result = await settle(transport.sign("req_seed_paint", { actingAs: "treasurer", acknowledgedFlags: true }));
    expect(result).toMatchObject({ ok: false, status: 409, code: "payee_cannot_sign" });

    const view = await settle(transport.getView());
    const paint = view.requests.find((r) => r.requestId === "req_seed_paint")!;
    expect(paint.status).toBe("waiting");
    expect(paint.refusals).toMatchObject([{ role: "treasurer", code: "payee_cannot_sign" }]);
  });

  it("refuses the first signer a second key, and a parent any key", async () => {
    const transport = createFixtureTransport();
    await expect(settle(transport.sign("req_seed_gloves", { actingAs: "treasurer", acknowledgedFlags: false }))).resolves.toMatchObject({ code: "already_signed" });
    await expect(settle(transport.sign("req_seed_gloves", { actingAs: "parent", acknowledgedFlags: false }))).resolves.toMatchObject({ code: "not_an_officer" });
  });

  it("wants the flags read on a flagged card", async () => {
    const transport = createFixtureTransport();
    await expect(settle(transport.sign("req_seed_paint", { actingAs: "president", acknowledgedFlags: false }))).resolves.toMatchObject({
      code: "flags_not_acknowledged",
    });
    await expect(settle(transport.sign("req_seed_paint", { actingAs: "president", acknowledgedFlags: true }))).resolves.toMatchObject({ ok: true });
  });

  it("sends on the second key, moves the money, then confirms a few seconds later", async () => {
    const transport = createFixtureTransport();
    const before = await settle(transport.getView());
    const result = await settle(transport.sign("req_seed_gloves", { actingAs: "president", acknowledgedFlags: false }));
    expect(result.ok && result.request.status).toBe("sent");

    const sent = await settle(transport.getView());
    expect(sent.limits.sessionPayoutsLeft).toBe(2);
    expect(sent.data.ledger.find((row) => row.id === "L14")!.status).toBe("completed");
    expect(sent.data.balances[0]!.available).toBe(before.data.balances[0]!.available - 42);

    await vi.advanceTimersByTimeAsync(10_000);
    const confirmed = await settle(transport.getView());
    const gloves = confirmed.requests.find((r) => r.requestId === "req_seed_gloves")!;
    expect(gloves.status).toBe("confirmed");
    expect(gloves.timeline.map((t) => t.step)).toEqual(["requested", "signed", "sent", "confirmed"]);
  });

  it("creates a judge's request as key 1, then the AI's read replaces the rules card", async () => {
    const transport = createFixtureTransport();
    const created = await settle(transport.createRequest(cones));
    if (!created.ok) throw new Error(created.message);
    expect(created.request).toMatchObject({ sourceLabel: "live sandbox", riskPending: true, eligibleSigners: ["treasurer", "president"] });
    expect(created.request.risk?.origin).toBe("rules");
    expect(created.request.signatures).toMatchObject([{ role: "secretary", isRequest: true }]);

    const read = await settle(transport.assessRisk(created.request.requestId));
    expect(read.ok && read.request.riskPending).toBe(false);
    expect(read.ok && read.request.risk?.verdict).toBe("clear");
  });

  it("stops a request whose receipt total does not match", async () => {
    const transport = createFixtureTransport();
    const created = await settle(transport.createRequest({ ...cones, receiptId: "bibs-team-supply" }));
    if (!created.ok) throw new Error(created.message);
    const read = await settle(transport.assessRisk(created.request.requestId));
    expect(read.ok && read.request.risk).toMatchObject({ verdict: "stop", matchesRequest: false });
  });

  it("refuses a request to yourself, over the cap, or without a description", async () => {
    const transport = createFixtureTransport();
    await expect(settle(transport.createRequest({ ...cones, actingAs: "treasurer", payeeId: "treasurer-reimbursement" }))).resolves.toMatchObject({
      code: "payee_cannot_sign",
    });
    await expect(settle(transport.createRequest({ ...cones, amountCents: 5_001 }))).resolves.toMatchObject({ status: 400 });
    await expect(settle(transport.createRequest({ ...cones, description: "  " }))).resolves.toMatchObject({ status: 400 });
  });

  it("blocks the fourth send of the session and sends nothing", async () => {
    const transport = createFixtureTransport();
    for (let i = 0; i < 3; i += 1) {
      const created = await settle(transport.createRequest({ ...cones, amountCents: 100 + i }));
      if (!created.ok) throw new Error(created.message);
      await settle(transport.assessRisk(created.request.requestId));
      await expect(settle(transport.sign(created.request.requestId, { actingAs: "president", acknowledgedFlags: true }))).resolves.toMatchObject({ ok: true });
    }
    const result = await settle(transport.sign("req_seed_gloves", { actingAs: "president", acknowledgedFlags: false }));
    expect(result).toMatchObject({ ok: false, code: "session_payout_limit" });
    const gloves = (await settle(transport.getView())).requests.find((r) => r.requestId === "req_seed_gloves")!;
    expect(gloves.status).toBe("blocked");
    expect(gloves.timeline.at(-1)).toMatchObject({ step: "blocked" });
  });
});

describe("the dev fixture's send-back", () => {
  const REASON = "One line on the receipt is not a league item.";

  it("lets the President send the paint back: it leaves the queue and the board's waiting rows, with the reason on its timeline", async () => {
    const transport = createFixtureTransport();
    const result = await settle(transport.sendBack("req_seed_paint", { actingAs: "president", reason: `  ${REASON} ` }));
    expect(result.ok && result.request).toMatchObject({ status: "sent_back", eligibleSigners: [] });

    const view = await settle(transport.getView());
    const paint = view.requests.find((r) => r.requestId === "req_seed_paint")!;
    expect(paint.timeline.at(-1)).toMatchObject({ step: "sent_back", label: "Sent back by the President", detail: REASON });
    expect(paint.refusals).toEqual([]);
    expect(view.data.ledger.find((row) => row.id === "L15")).toBeUndefined();
    expect(view.limits.sessionPayoutsLeft).toBe(3);
  });

  it("then refuses any signature on it", async () => {
    const transport = createFixtureTransport();
    await settle(transport.sendBack("req_seed_paint", { actingAs: "president", reason: REASON }));
    await expect(settle(transport.sign("req_seed_paint", { actingAs: "president", acknowledgedFlags: true }))).resolves.toMatchObject({ code: "request_closed" });
  });

  it.each([
    ["treasurer", "payee_cannot_sign"],
    ["secretary", "already_signed"],
    ["reviewer", "not_an_officer"],
    ["parent", "not_an_officer"],
  ] as const)("refuses the %s on the paint (%s) and records the refusal", async (role, code) => {
    const transport = createFixtureTransport();
    await expect(settle(transport.sendBack("req_seed_paint", { actingAs: role, reason: REASON }))).resolves.toMatchObject({ ok: false, status: 409, code });
    const paint = (await settle(transport.getView())).requests.find((r) => r.requestId === "req_seed_paint")!;
    expect(paint.status).toBe("waiting");
    expect(paint.refusals).toMatchObject([{ role, code }]);
  });

  it("wants a reason of 3 to 200 characters, as the server does", async () => {
    const transport = createFixtureTransport();
    await expect(settle(transport.sendBack("req_seed_paint", { actingAs: "president", reason: " no " }))).resolves.toMatchObject({ status: 400 });
    await expect(settle(transport.sendBack("req_seed_paint", { actingAs: "president", reason: "x".repeat(201) }))).resolves.toMatchObject({ status: 400 });
  });

  it("reads its options from the dev URL: &confirm=hold keeps a sent payout waiting for PayPal", () => {
    expect(fixtureOptionsFrom("?fixture=1&confirm=hold")).toMatchObject({ confirmAfterMs: null });
    expect(fixtureOptionsFrom("?fixture=1&watch=ok&replay=fail")).toEqual({ watch: "ok", replayFails: true });
    expect(fixtureOptionsFrom("?fixture=1")).toEqual({ watch: null, replayFails: false });
  });

  it("can hold a sent payout unconfirmed, to watch the wait", async () => {
    const transport = createFixtureTransport({ confirmAfterMs: null });
    await settle(transport.sign("req_seed_gloves", { actingAs: "president", acknowledgedFlags: false }));
    await vi.advanceTimersByTimeAsync(60_000);
    const gloves = (await settle(transport.getView())).requests.find((r) => r.requestId === "req_seed_gloves")!;
    expect(gloves.status).toBe("sent");
  });
});

describe("the dev fixture's Watchtower", () => {
  it("is stale by default, as PayPal's reports really were on Nov 5, with the two real outside sends open", async () => {
    const watch = (await settle(createFixtureTransport().getView())).watchtower!;
    expect(watch.status).toBe("stale_reports");
    expect(watch.paypalAsOf).toBe("2026-11-05T08:59:59Z");
    expect(watch.checkedAt).toBe("2026-11-05T16:40:00Z");
    expect(watch.findings.map((f) => [f.transactionId, f.amountCents, f.fundedByBank, f.reportedAfterMinutes])).toEqual([
      ["1TY14748YE721631B", 321, true, null],
      ["22N17109956532336", 321, true, null],
    ]);
    expect(watch.explained.map((f) => f.transactionId)).toEqual(["23Y96953CP0068646", "3XT37311AK7894010"]);
    expect(watch.explained.every((f) => f.explanation)).toBe(true);
  });

  it("takes the state the URL names, and falls back to stale for anything else", async () => {
    const status = async (watch: string | null) => (await settle(createFixtureTransport({ watch }).getView())).watchtower?.status ?? null;
    expect(await status("ok")).toBe("ok");
    expect(await status("no_access")).toBe("no_access");
    expect(await status("silent")).toBe("silent");
    expect(await status("not_started")).toBe("not_started");
    expect(await status("none")).toBeNull();
    expect(await status("nonsense")).toBe("stale_reports");
    expect(await status(null)).toBe("stale_reports");
  });

  it("keeps PayPal's records about an hour behind when they're current, with three explained findings", async () => {
    const watch = (await settle(createFixtureTransport({ watch: "ok" }).getView())).watchtower!;
    expect(watch.paypalAsOf).toBe("2026-11-05T15:59:59Z");
    expect(watch.explained).toHaveLength(3);
  });

  it("goes quiet for longer than the silence threshold in the silent state", async () => {
    const watch = (await settle(createFixtureTransport({ watch: "silent" }).getView())).watchtower!;
    expect(Date.parse("2026-11-05T16:40:00Z") - Date.parse(watch.checkedAt!)).toBeGreaterThan(30 * 60_000);
  });

  it("replays the treasurer's real website send, labelled, and stores nothing", async () => {
    const transport = createFixtureTransport();
    const result = await settle(transport.replayOutsideSend());
    expect(result).toMatchObject({
      ok: true,
      replay: { label: "Replay of a real sandbox event: a $3.21 website send on Nov 3, 2026.", finding: { transactionId: "1TY14748YE721631B" } },
    });
    expect((await settle(transport.getView())).watchtower!.findings).toHaveLength(2);
  });

  it("can fail the replay, to show the failure line", async () => {
    await expect(settle(createFixtureTransport({ replayFails: true }).replayOutsideSend())).resolves.toMatchObject({ ok: false, status: 503 });
  });
});
