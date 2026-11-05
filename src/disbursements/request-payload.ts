/**
 * A payout request as the ledger records it (`payout.requested`), and its request hash (spec §3):
 * SHA-256 of the canonical JSON {sessionId, requestId, payeeId, payeeEmail, amountCents, currency,
 * description, budgetLine, receiptSha256, requestedBy, createdAt}. The hash is the PayPal
 * `sender_batch_id` and `PayPal-Request-Id`, and every signature binds it.
 */
import type { BudgetLineId, LedgerEventPayloads, OfficerRole, PayeeId, ReceiptId } from "@/ledger/contracts";
import { canonicalJson, sha256Hex } from "@/ledger/canonical";
import { payeeById } from "./payees";
import { receiptSha256 } from "./receipt-hashes";

export type RequestPayload = LedgerEventPayloads["payout.requested"];

export interface RequestFacts {
  requestId: string;
  payeeId: PayeeId;
  amountCents: number;
  description: string;
  budgetLine: BudgetLineId;
  receiptId: ReceiptId;
  requestedBy: OfficerRole;
  /** ISO 8601. */
  createdAt: string;
  source: RequestPayload["source"];
}

type HashedRequest = Pick<
  RequestPayload,
  | "requestId"
  | "payeeId"
  | "payeeEmail"
  | "amountCents"
  | "currency"
  | "description"
  | "budgetLine"
  | "receiptSha256"
  | "requestedBy"
  | "createdAt"
>;

export function computeRequestHash(sessionId: string, request: HashedRequest): Promise<string> {
  return sha256Hex(
    canonicalJson({
      sessionId,
      requestId: request.requestId,
      payeeId: request.payeeId,
      payeeEmail: request.payeeEmail,
      amountCents: request.amountCents,
      currency: request.currency,
      description: request.description,
      budgetLine: request.budgetLine,
      receiptSha256: request.receiptSha256,
      requestedBy: request.requestedBy,
      createdAt: request.createdAt,
    }),
  );
}

/** Fills in the payee's name and email, the receipt hash and the request hash. */
export async function buildRequestPayload(sessionId: string, facts: RequestFacts): Promise<RequestPayload> {
  const payee = payeeById(facts.payeeId);
  if (!payee) throw new Error(`unknown payee ${facts.payeeId}`);
  const unhashed = {
    requestId: facts.requestId,
    payeeId: payee.id,
    payeeName: payee.name,
    payeeEmail: payee.email,
    amountCents: facts.amountCents,
    currency: "USD" as const,
    description: facts.description,
    budgetLine: facts.budgetLine,
    receiptId: facts.receiptId,
    receiptSha256: receiptSha256(facts.receiptId),
    requestedBy: facts.requestedBy,
    createdAt: facts.createdAt,
    source: facts.source,
  };
  return { ...unhashed, requestHash: await computeRequestHash(sessionId, unhashed) };
}
