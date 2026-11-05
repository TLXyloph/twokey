import { describe, expect, it } from "vitest";
import type { LedgerAppendInput } from "@/ledger/contracts";
import { foldBoard } from "@/ledger/fold";
import { boardFinding, secondKeyQueue } from "@/demo/board-figures";
import { riverbend } from "@/demo/riverbend";
import { orderCreated, paymentCaptured, payoutRequested, payoutSent, requestedPayload } from "./fixtures";
import { aiCard, assessed, eventsOf, signedBy } from "./events";

const cents = (n: number) => Math.round(n * 100);
const extras = { sharedBalance: null, dailySentCents: 0, seedHash: "seed" };
const opened: LedgerAppendInput = { type: "session.opened", payload: { seedVersion: "v", seedHash: "seed" } };

/** The seeded L14 and L15, each with key 1 and a rules card, as a fresh session holds them. */
function seeded(): LedgerAppendInput[] {
  const l14 = { requestId: "L14", requestHash: "14".repeat(32), source: "seed" as const, createdAt: "2026-11-02T15:00:00.000Z" };
  const l15 = {
    requestId: "L15",
    requestHash: "15".repeat(32),
    source: "seed" as const,
    payeeId: "treasurer-reimbursement" as const,
    payeeName: "Esther Huang (Treasurer), reimbursement",
    amountCents: 3650,
    description: "Field-paint reimbursement",
    budgetLine: "field-maintenance" as const,
    receiptId: "paint-bluebird-hardware" as const,
    requestedBy: "secretary" as const,
    createdAt: "2026-11-03T15:00:00.000Z",
  };
  return [
    opened,
    payoutRequested(l14),
    signedBy("treasurer", { requestHash: l14.requestHash }, "L14"),
    assessed({}, "L14"),
    payoutRequested(l15),
    signedBy("secretary", { requestHash: l15.requestHash }, "L15"),
    assessed({}, "L15"),
  ];
}

const sentL14: LedgerAppendInput[] = [assessed(aiCard(), "L14"), signedBy("president", {}, "L14"), payoutSent("L14", "14".repeat(32), "BATCH-14")];
const completedSum = (ledger: { status: string; amount: number }[]) =>
  ledger.filter((r) => r.status === "completed").reduce((t, r) => t + cents(r.amount), 0);

describe("foldBoard: a fresh session", () => {
  const board = foldBoard(riverbend, eventsOf(seeded()), extras);

  it("is the seed, unchanged", () => {
    expect(board.data).toEqual(riverbend);
  });

  it("lists the two seeded requests as demo data, waiting, with key 1 on each", () => {
    expect(board.requests.map((r) => [r.requestId, r.sourceLabel, r.status, r.signatures.length])).toEqual([
      ["L15", "demo data", "waiting", 1],
      ["L14", "demo data", "waiting", 1],
    ]);
    expect(board.requests[1]!.signatures[0]).toMatchObject({ role: "treasurer", title: "Treasurer", isRequest: true });
  });

  it("offers L15's second key to the President only (the Treasurer is its payee)", () => {
    const l15 = board.requests.find((r) => r.requestId === "L15")!;
    expect(l15.payee).toEqual({ id: "treasurer-reimbursement", name: "Esther Huang (Treasurer), reimbursement", role: "treasurer" });
    expect(l15.eligibleSigners).toEqual(["president"]);
  });

  it("shows the rules card and waits for the receipt check", () => {
    const l14 = board.requests.find((r) => r.requestId === "L14")!;
    expect(l14.risk?.origin).toBe("rules");
    expect(l14.riskPending).toBe(true);
    expect(l14.receipt).toEqual({ id: "gloves-team-supply", label: expect.any(String), imageUrl: "/receipts/gloves-team-supply.png" });
    expect(l14.timeline).toEqual([{ step: "requested", label: "Requested by the Treasurer", at: "2026-11-02T15:00:00.000Z" }]);
  });

  it("reports the limits and the chain", () => {
    expect(board.limits).toEqual({ payoutCapCents: 5000, sessionPayoutsLeft: 3, dailyCentsLeft: 50000 });
    expect(board.chain).toEqual({ length: 7, head: "h7" });
    expect(foldBoard(riverbend, [], extras).chain).toEqual({ length: 0, head: "seed" });
  });
});

describe("foldBoard: payouts", () => {
  it("completes a seeded row once it is sent, takes it off the balance and out of the second-key queue", () => {
    const board = foldBoard(riverbend, eventsOf([...seeded(), ...sentL14]), extras);
    expect(board.data.ledger.find((r) => r.id === "L14")?.status).toBe("completed");
    expect(board.data.balances[0]!.available).toBe(4998.75 - 42 - 0.25);
    expect(completedSum(board.data.ledger)).toBe(cents(board.data.balances[0]!.available));
    expect(secondKeyQueue(board.data).count).toBe(1);
    expect(board.limits.sessionPayoutsLeft).toBe(2);
  });

  it("records PayPal's $0.25 payout fee as its own completed row, beside the payout", () => {
    const board = foldBoard(riverbend, eventsOf([...seeded(), ...sentL14]), extras);
    const fee = board.data.ledger.find((r) => r.id === "L14:fee");
    expect(fee).toMatchObject({ direction: "out", amount: -0.25, status: "completed", counterparty: "PayPal", category: "fees", requestedBy: null });
    expect(fee?.description).toBe("PayPal payout fee: Goalkeeper gloves");
  });

  it("tells the payout's story in plain words", () => {
    const confirmed: LedgerAppendInput = {
      type: "payout.confirmed",
      payload: {
        requestId: "L14",
        payoutBatchId: "BATCH-14",
        payoutItemId: "ITEM-14",
        status: "SUCCESS",
        paypalEventId: "WH-1",
        eventType: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
        paypalCreatedAt: "2026-11-05T15:00:30.000Z",
      },
    };
    const board = foldBoard(riverbend, eventsOf([...seeded(), ...sentL14, confirmed]), extras);
    const l14 = board.requests.find((r) => r.requestId === "L14")!;
    expect(l14.status).toBe("confirmed");
    expect(l14.riskPending).toBe(false);
    expect(l14.timeline.map((s) => [s.step, s.label])).toEqual([
      ["requested", "Requested by the Treasurer"],
      ["signed", "Signed by the President"],
      ["sent", "Sent to PayPal"],
      ["confirmed", "PayPal confirmed"],
    ]);
    expect(l14.timeline[2]!.detail).toBe("BATCH-14");
    expect(l14.timeline[3]!.at).toBe("2026-11-05T15:00:30.000Z");
  });

  it("drops a blocked or failed payout from the ledger rows and says why it wasn't sent", () => {
    const blocked: LedgerAppendInput = {
      type: "payout.blocked",
      payload: { requestId: "L14", code: "daily_payout_limit", message: "Today's payouts would pass $500." },
    };
    const board = foldBoard(riverbend, eventsOf([...seeded(), blocked]), extras);
    expect(board.data.ledger.some((r) => r.id === "L14")).toBe(false);
    const l14 = board.requests.find((r) => r.requestId === "L14")!;
    expect(l14.status).toBe("blocked");
    expect(l14.timeline.at(-1)).toMatchObject({ step: "blocked", label: "Not sent: Today's payouts would pass $500." });
  });

  it("adds a judge's own request as a live pending row, and lists waiting requests first, newest first", () => {
    const mine = payoutRequested({ requestId: "R-1", requestHash: "ee".repeat(32), createdAt: "2026-11-05T15:00:00.000Z", amountCents: 4800, description: "Practice cones" });
    const board = foldBoard(riverbend, eventsOf([...seeded(), ...sentL14, mine]), extras);
    expect(board.requests.map((r) => [r.requestId, r.status])).toEqual([
      ["R-1", "waiting"],
      ["L15", "waiting"],
      ["L14", "sent"],
    ]);
    expect(board.requests[0]!.sourceLabel).toBe("live sandbox");
    expect(board.data.ledger.at(-1)).toMatchObject({
      id: "R-1",
      date: "2026-11-05",
      description: "Practice cones",
      counterparty: "Riverbend Team Supply",
      category: "equipment",
      direction: "out",
      amount: -48,
      status: "pending",
      eventId: null,
      requestedBy: "treasurer",
    });
    expect(secondKeyQueue(board.data).total).toBe(36.5 + 48);
  });

  it("counts today's payouts across sessions in the daily limit", () => {
    expect(foldBoard(riverbend, [], { ...extras, dailySentCents: 49_000 }).limits.dailyCentsLeft).toBe(1000);
    expect(foldBoard(riverbend, [], { ...extras, dailySentCents: 60_000 }).limits.dailyCentsLeft).toBe(0);
  });
});

describe("foldBoard: money in", () => {
  const events = eventsOf([...seeded(), orderCreated("O-1", 2), paymentCaptured("O-1", "CAP-1", 3000), orderCreated("O-2", 1), paymentCaptured("O-2", "CAP-2", 1500, "venmo")]);
  const board = foldBoard(riverbend, events, extras);

  it("adds the banquet only after its first captured payment", () => {
    expect(foldBoard(riverbend, eventsOf([...seeded(), orderCreated("O-1", 2)]), extras).data.events.map((e) => e.id)).not.toContain("banquet");
    expect(board.data.events.find((e) => e.id === "banquet")).toEqual({
      id: "banquet",
      name: "End-of-season banquet",
      date: "2026-11-21",
      unitLabel: "tickets",
      unitsLogged: 3,
      unitPrice: 15,
      expected: 45,
      received: 45,
      notes: expect.any(String),
    });
  });

  it("records each capture as completed money in, by the button the buyer used", () => {
    expect(board.data.ledger.filter((r) => r.eventId === "banquet").map((r) => [r.id, r.counterparty, r.amount, r.status, r.direction])).toEqual([
      ["CAP-1", "Banquet tickets (PayPal)", 30, "completed", "in"],
      ["CAP-2", "Banquet tickets (Venmo)", 15, "completed", "in"],
    ]);
    expect(board.data.balances[0]!.available).toBe(4998.75 + 45);
    expect(completedSum(board.data.ledger)).toBe(cents(board.data.balances[0]!.available));
    expect(board.data.balances[0]!.asOf).toBe(events.at(-1)!.occurredAt);
  });

  it("never changes the car-wash finding", () => {
    expect(boardFinding(board.data)).toBe(boardFinding(riverbend));
  });

  it("ignores a capture that didn't complete", () => {
    const pending = paymentCaptured("O-3", "CAP-3");
    pending.payload.status = "PENDING";
    const folded = foldBoard(riverbend, eventsOf([orderCreated("O-3", 1), pending]), extras);
    expect(folded.data.events.some((e) => e.id === "banquet")).toBe(false);
    expect(folded.data.balances[0]!.available).toBe(4998.75);
  });
});

describe("foldBoard: the shared balance", () => {
  it("passes PayPal's shared sandbox balance through as it was read", () => {
    const sharedBalance = { availableCents: 499_750, currency: "USD" as const, asOf: "2026-11-05T14:30:00Z" };
    expect(foldBoard(riverbend, [], { ...extras, sharedBalance }).sharedBalance).toEqual(sharedBalance);
  });

  it("keeps a payout's request facts on the view", () => {
    const board = foldBoard(riverbend, eventsOf(seeded()), extras);
    const l14 = board.requests.find((r) => r.requestId === "L14")!;
    expect(l14).toMatchObject({ requestHash: "14".repeat(32), amountCents: requestedPayload().amountCents, budgetLine: "equipment", requestedBy: "treasurer" });
  });
});
