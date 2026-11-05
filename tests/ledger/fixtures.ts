/**
 * Shared fixtures for the Ledger tests: payload builders, a fixed clock and sequential ids.
 * Every id, hash and amount is fictional.
 */
import type { LedgerAppendInput, LedgerEventPayloads, RiskCard } from "@/ledger/contracts";

export const SEED = "5eed".repeat(16);
export const T0 = Date.parse("2026-11-05T15:00:00.000Z");

/** A clock that advances one second per call, from T0. */
export function steppingClock(start = T0, stepMs = 1000) {
  let at = start - stepMs;
  return () => new Date((at += stepMs));
}

export function sequentialIds(prefix = "evt") {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

export const orderCreated = (orderId: string, quantity = 2, key?: string): LedgerAppendInput<"order.created"> => ({
  type: "order.created",
  payload: { orderId, eventId: "banquet", quantity, amountCents: quantity * 1500, currency: "USD" },
  ...(key && { idempotencyKey: key }),
});

export const paymentCaptured = (
  orderId: string,
  captureId: string,
  amountCents = 3000,
  method: "paypal" | "venmo" = "paypal",
): LedgerAppendInput<"payment.captured"> => ({
  type: "payment.captured",
  payload: { orderId, captureId, eventId: "banquet", amountCents, currency: "USD", status: "COMPLETED", method },
  idempotencyKey: captureId,
});

export function requestedPayload(over: Partial<LedgerEventPayloads["payout.requested"]> = {}): LedgerEventPayloads["payout.requested"] {
  return {
    requestId: "req-1",
    requestHash: "a1".repeat(32),
    payeeId: "team-supply",
    payeeName: "Riverbend Team Supply",
    payeeEmail: "vendor-fictional@example.test",
    amountCents: 4200,
    currency: "USD",
    description: "Goalkeeper gloves",
    budgetLine: "equipment",
    receiptId: "gloves-team-supply",
    receiptSha256: "pending",
    requestedBy: "treasurer",
    createdAt: "2026-11-05T15:00:00.000Z",
    source: "session",
    ...over,
  };
}

export const payoutRequested = (over: Partial<LedgerEventPayloads["payout.requested"]> = {}): LedgerAppendInput<"payout.requested"> => ({
  type: "payout.requested",
  payload: requestedPayload(over),
  idempotencyKey: `request:${over.requestId ?? "req-1"}`,
});

export const payoutSent = (requestId: string, requestHash: string, payoutBatchId = "BATCH-1"): LedgerAppendInput<"payout.sent"> => ({
  type: "payout.sent",
  payload: { requestId, requestHash, senderBatchId: requestHash, payoutBatchId, batchStatus: "PENDING" },
  idempotencyKey: `outcome:${requestHash}`,
});

export function rulesCard(over: Partial<RiskCard> = {}): RiskCard {
  return {
    verdict: "clear",
    summary: "Receipt check not wired yet.",
    findings: [],
    receipt: null,
    matchesRequest: null,
    origin: "rules",
    model: null,
    checkedAt: "2026-11-05T15:00:00.000Z",
    ...over,
  };
}
