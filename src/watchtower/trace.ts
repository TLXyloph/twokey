/**
 * Traces a T0001 payout row to TwoKey's two-key flow (spec: .plans/watchtower-spec.md, "T0001").
 *
 * Through the stored webhook (the usual path; webhooks arrive within about a minute, reports
 * hours later): the T0001's transaction id -> the stored PAYMENT.PAYOUTS-ITEM.* webhook with the
 * same `resource.transaction_id` (measured equal, 2026-11-05) -> its `payout_batch_id` -> the
 * ledger's `payout.sent` with that batch id -> that session's request. A batch no ledger sent is
 * untraced; there is no fallback then, since the webhook proves which batch it was.
 *
 * Fallback, only when no webhook with a batch id was stored: the T0001's `custom_field` (our
 * `sender_item_id`, the request id; seeded ids like "L14" repeat across sessions) + the amount
 * sent + the receiver's email -> a session whose ledger sent that request.
 *
 * A traced payout is matched only when the money that left is what was signed (amount, and the
 * receiver when PayPal names one) and both keys verify against the committed public keys and bind
 * the request's hash, payee and amount (`keysCheckOut`, the executor's own check).
 */
import { keysCheckOut } from "@/disbursements/executor";
import type { SignatureVerifier } from "@/disbursements/signing";
import type { LedgerEvent } from "@/ledger/contracts";
import type { RequestRef } from "@/ledger/ledger-table";
import { findRequest } from "@/ledger/request-projection";
import type { JudgedDebit } from "./classify";

export interface TraceSources {
  /** The `payout_batch_id` of the stored payout-item webhook for this transaction id; null when none. */
  payoutBatchIdForTransaction(transactionId: string): Promise<string | null>;
  /** The session and request whose ledger holds this payout batch id. */
  requestByPayoutBatchId(payoutBatchId: string): Promise<RequestRef | null>;
  /** The sessions whose ledger recorded `payout.sent` for this request id. */
  sessionsThatSent(requestId: string): Promise<string[]>;
  /** A session's events, in order. Read only: never opens a session. */
  events(sessionId: string): Promise<LedgerEvent[]>;
}

export type TraceVia = "webhook" | "custom_field";
export type UnsignedReason = "not_sent" | "amount_mismatch" | "payee_mismatch" | "signatures";

export type TraceResult =
  | { kind: "matched"; via: TraceVia; sessionId: string; requestId: string }
  /** Traced to a ledger request, but not to a payout two valid signatures cover. */
  | { kind: "unsigned"; via: TraceVia; reason: UnsignedReason }
  /** No ledger payout it could be. */
  | { kind: "untraced"; reason: "no_ledger_payout" | "no_custom_field" };

const sameEmail = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

async function judge(
  sources: TraceSources,
  verifier: SignatureVerifier,
  debit: JudgedDebit,
  ref: RequestRef,
  via: TraceVia,
  payoutBatchId: string | null,
): Promise<TraceResult> {
  const state = findRequest(await sources.events(ref.sessionId), ref.requestId);
  const sent = state?.sent?.payload;
  if (!state || !sent || (payoutBatchId !== null && sent.payoutBatchId !== payoutBatchId)) return { kind: "unsigned", via, reason: "not_sent" };
  if (state.request.amountCents !== debit.sentCents) return { kind: "unsigned", via, reason: "amount_mismatch" };
  if (debit.counterpartyEmail !== null && !sameEmail(debit.counterpartyEmail, state.request.payeeEmail)) {
    return { kind: "unsigned", via, reason: "payee_mismatch" };
  }
  if (!(await keysCheckOut(ref.sessionId, state, verifier))) return { kind: "unsigned", via, reason: "signatures" };
  return { kind: "matched", via, sessionId: ref.sessionId, requestId: ref.requestId };
}

export async function tracePayout(debit: JudgedDebit, sources: TraceSources, verifier: SignatureVerifier): Promise<TraceResult> {
  const payoutBatchId = await sources.payoutBatchIdForTransaction(debit.transactionId);
  if (payoutBatchId !== null) {
    const ref = await sources.requestByPayoutBatchId(payoutBatchId);
    if (!ref) return { kind: "untraced", reason: "no_ledger_payout" };
    return judge(sources, verifier, debit, ref, "webhook", payoutBatchId);
  }

  const requestId = debit.customField;
  if (!requestId) return { kind: "untraced", reason: "no_custom_field" };
  // Without the webhook, the facts must pick the payout out: the receiver is required here.
  if (debit.counterpartyEmail === null) return { kind: "untraced", reason: "no_ledger_payout" };
  let traced: TraceResult = { kind: "untraced", reason: "no_ledger_payout" };
  for (const sessionId of await sources.sessionsThatSent(requestId)) {
    const result = await judge(sources, verifier, debit, { sessionId, requestId }, "custom_field", null);
    if (result.kind === "matched") return result;
    // A session whose payout has other facts isn't this payout; one with the same facts but bad keys is.
    if (result.kind === "unsigned" && result.reason === "signatures") traced = result;
  }
  return traced;
}
