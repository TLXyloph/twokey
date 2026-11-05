/**
 * The deterministic executor (spec §3). It runs in the request that stores key 2, and appends
 * exactly one outcome per request (idempotency key `outcome:${requestHash}`):
 *   1. Verify: the request hash still matches its payload, the two keys are from two different
 *      officers (key 1 the requester), neither is the payee, each binds this request's hash, payee
 *      and amount, and each signature verifies against the committed public key.  -> payout.failed
 *   2. Limits: $50 a payout, 3 sent per session, $500 sent per UTC day across sessions. -> payout.blocked
 *   3. PayPal: POST /v1/payments/payouts (sender_batch_id = PayPal-Request-Id = the request hash).
 *                                                                        -> payout.sent | payout.failed
 * The AI never blocks it: the risk card is only bound into key 2.
 */
import { DAILY_PAYOUT_LIMIT_CENTS, PAYOUT_CAP_CENTS, SESSION_PAYOUT_LIMIT, type LedgerEvent, type LimitCode } from "@/ledger/contracts";
import type { TwoKeyLedgerStore } from "@/ledger/ledger-store";
import type { RequestState } from "@/ledger/request-projection";
import type { PaypalClient } from "@/payments/paypal/client";
import { sendPayout } from "@/payments/paypal/payouts";
import { CLUB_SHORT_NAME } from "@/demo/riverbend";
import { payeeRole } from "./eligibility";
import { payeeById } from "./payees";
import { computeRequestHash } from "./request-payload";
import { keys, type Append } from "./request-steps";
import type { SignatureVerifier } from "./signing";

export interface ExecutorDeps {
  ledger: TwoKeyLedgerStore;
  verifier: SignatureVerifier;
  paypal: PaypalClient;
  now: () => Date;
}

export type ExecutorOutcome =
  | { kind: "sent"; event: LedgerEvent }
  | { kind: "failed"; event: LedgerEvent }
  | { kind: "blocked"; code: LimitCode; message: string; event: LedgerEvent };

export const LIMIT_MESSAGES: Record<LimitCode, string> = {
  over_payout_cap: "This payout is over the $50 limit for one payout, so it wasn't sent.",
  session_payout_limit: `This judge session has already sent ${SESSION_PAYOUT_LIMIT} payouts, the most it can send, so this one wasn't sent.`,
  daily_payout_limit: "Sending this would take today's payouts, across all judges, over $500, so it wasn't sent.",
};

export const SIGNATURES_FAILED_REASON = "The two signatures didn't check out, so nothing was sent.";
export const EMAIL_SUBJECT = `A payout from the ${CLUB_SHORT_NAME} (demo)`;

export const startOfUtcDay = (at: Date): string => `${at.toISOString().slice(0, 10)}T00:00:00.000Z`;

/** Both keys bind this request, come from two different officers who aren't the payee, and verify. */
export async function keysCheckOut(sessionId: string, state: RequestState, verifier: SignatureVerifier): Promise<boolean> {
  const { request } = state;
  if ((await computeRequestHash(sessionId, request)) !== request.requestHash) return false;
  if (payeeById(request.payeeId)?.email !== request.payeeEmail) return false;
  const [key1, key2] = state.signatures;
  if (!key1 || !key2 || key1.role === key2.role || key1.role !== request.requestedBy) return false;
  const payee = payeeRole(state);
  const cardHashes = new Set(state.risks.map((record) => record.cardHash));
  for (const key of [key1, key2]) {
    const signed = key.signed;
    const binds =
      key.role !== payee &&
      signed.role === key.role &&
      signed.requestHash === request.requestHash &&
      signed.payeeId === request.payeeId &&
      signed.payeeEmail === request.payeeEmail &&
      signed.amountCents === request.amountCents &&
      signed.currency === request.currency &&
      (signed.riskCardHash === null || cardHashes.has(signed.riskCardHash));
    if (!binds || !(await verifier.verify(key.role, signed, key.signature, key.keyId))) return false;
  }
  return true;
}

async function limitHit(deps: ExecutorDeps, events: readonly LedgerEvent[], amountCents: number): Promise<LimitCode | null> {
  if (amountCents > PAYOUT_CAP_CENTS) return "over_payout_cap";
  if (events.filter((event) => event.type === "payout.sent").length >= SESSION_PAYOUT_LIMIT) return "session_payout_limit";
  const sentToday = await deps.ledger.sentPayoutCentsSince(startOfUtcDay(deps.now()));
  if (sentToday + amountCents > DAILY_PAYOUT_LIMIT_CENTS) return "daily_payout_limit";
  return null;
}

/** The batch id an earlier attempt recorded for this sender_batch_id, if the ledger has one. */
async function recordedBatchId(ledger: TwoKeyLedgerStore, senderBatchId: string): Promise<string | null> {
  const ref = await ledger.findSessionBySenderBatchId(senderBatchId);
  if (!ref) return null;
  for (const event of await ledger.read(ref.sessionId)) {
    const payload = event.payload as { requestId?: string; payoutBatchId?: string };
    if ((event.type === "payout.sent" || event.type === "payout.confirmed") && payload.requestId === ref.requestId && payload.payoutBatchId) {
      return payload.payoutBatchId;
    }
  }
  return null;
}

export async function executePayout(
  deps: ExecutorDeps,
  sessionId: string,
  state: RequestState,
  events: readonly LedgerEvent[],
): Promise<ExecutorOutcome> {
  const { request } = state;
  const append: Append = (input) => deps.ledger.append(sessionId, input);
  const idempotencyKey = keys.outcome(request.requestHash);
  const failed = async (httpStatus: number, reason: string): Promise<ExecutorOutcome> => ({
    kind: "failed",
    event: (await append({ type: "payout.failed", payload: { requestId: request.requestId, httpStatus, reason }, idempotencyKey })).event,
  });

  if (!(await keysCheckOut(sessionId, state, deps.verifier))) return failed(0, SIGNATURES_FAILED_REASON);

  const limit = await limitHit(deps, events, request.amountCents);
  if (limit) {
    const message = LIMIT_MESSAGES[limit];
    const { event } = await append({ type: "payout.blocked", payload: { requestId: request.requestId, code: limit, message }, idempotencyKey });
    return { kind: "blocked", code: limit, message, event };
  }

  const [key1, key2] = state.signatures;
  const result = await sendPayout(
    deps.paypal,
    {
      senderBatchId: request.requestHash,
      requestId: request.requestId,
      receiverEmail: request.payeeEmail,
      amountCents: request.amountCents,
      currency: request.currency,
      note: `${request.description}. Signed by the ${key1?.title} and the ${key2?.title} (TwoKey demo, sandbox).`,
      emailSubject: EMAIL_SUBJECT,
    },
    { findExistingBatchId: (senderBatchId) => recordedBatchId(deps.ledger, senderBatchId) },
  );
  if (!result.ok) return failed(result.httpStatus, result.reason);
  const { event } = await append({
    type: "payout.sent",
    payload: {
      requestId: request.requestId,
      requestHash: request.requestHash,
      senderBatchId: request.requestHash,
      payoutBatchId: result.payoutBatchId,
      batchStatus: result.batchStatus,
    },
    idempotencyKey,
  });
  return { kind: "sent", event };
}
