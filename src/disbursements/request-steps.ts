/**
 * The appends every payout request goes through, shared by a judge's own requests
 * (./requests.ts) and the seeded ones a session opens with (./open-session.ts):
 *   payout.requested, then key 1 (the requester signs it), then the rules card.
 * Each has a fixed idempotency key, so a retry or a race stores each step once.
 */
import type { LedgerAppendInput, LedgerAppendResult, LedgerEvent, LedgerEventType, RiskCard, SignedApproval } from "@/ledger/contracts";
import { canonicalJson, sha256Hex } from "@/ledger/canonical";
import type { RequestPayload } from "./request-payload";
import type { DemoSigner } from "./signing";

export type Append = <T extends LedgerEventType>(input: LedgerAppendInput<T>) => Promise<LedgerAppendResult<T>>;

export const keys = {
  request: (requestId: string) => `request:${requestId}`,
  seedRequest: (requestId: string) => `seed:${requestId}:request`,
  signature: (requestHash: string, role: string) => `${requestHash}:${role}`,
  rulesRisk: (requestHash: string) => `rules-risk:${requestHash}`,
  aiRisk: (requestHash: string) => `ai-risk:${requestHash}`,
  outcome: (requestHash: string) => `outcome:${requestHash}`,
} as const;

export const cardHashOf = (card: RiskCard): Promise<string> => sha256Hex(canonicalJson(card));

/** What a signer binds: the request's payee and amount, the card they saw, and the ledger head. */
export function approvalFor(
  request: RequestPayload,
  role: SignedApproval["role"],
  options: { riskCardHash: string | null; acknowledgedFlags: boolean; prevHash: string },
): SignedApproval {
  return {
    requestHash: request.requestHash,
    payeeId: request.payeeId,
    payeeEmail: request.payeeEmail,
    amountCents: request.amountCents,
    currency: request.currency,
    role,
    ...options,
  };
}

/** Key 1: the requester signs their own request, bound to the request event as the head. */
export async function appendKeyOne(append: Append, signer: DemoSigner, requested: LedgerEvent<"payout.requested">): Promise<void> {
  const request = requested.payload;
  const signed = approvalFor(request, request.requestedBy, { riskCardHash: null, acknowledgedFlags: false, prevHash: requested.hash });
  const { keyId, signature } = await signer.sign(request.requestedBy, signed);
  await append({
    type: "approval.signed",
    payload: { requestId: request.requestId, role: request.requestedBy, keyId, signature, signed },
    idempotencyKey: keys.signature(request.requestHash, request.requestedBy),
  });
}

export async function appendRiskCard(append: Append, request: RequestPayload, card: RiskCard, idempotencyKey: string): Promise<void> {
  await append({
    type: "risk.assessed",
    payload: { requestId: request.requestId, requestHash: request.requestHash, card, cardHash: await cardHashOf(card) },
    idempotencyKey,
  });
}
