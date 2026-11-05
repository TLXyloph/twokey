/**
 * Builds a session's events from append inputs without a store (fake hashes, one second apart),
 * for tests of pure folds over events. Plus builders for the approval events.
 */
import type { LedgerAppendInput, LedgerEvent, OfficerRole, RefusalCode, RiskCard, SignedApproval } from "@/ledger/contracts";
import { requestedPayload, rulesCard, T0 } from "./fixtures";

export function eventsOf(inputs: readonly LedgerAppendInput[], sessionId = "s1"): LedgerEvent[] {
  return inputs.map((input, index) => ({
    sessionId,
    seq: index + 1,
    eventId: `e${index + 1}`,
    type: input.type,
    payload: input.payload,
    occurredAt: new Date(T0 + index * 1000).toISOString(),
    prevHash: index === 0 ? "seed" : `h${index}`,
    hash: `h${index + 1}`,
  }));
}

export function signedBy(role: OfficerRole, over: Partial<SignedApproval> = {}, requestId = "req-1"): LedgerAppendInput<"approval.signed"> {
  const request = requestedPayload({ requestId });
  return {
    type: "approval.signed",
    payload: {
      requestId,
      role,
      keyId: `${role.slice(0, 4)}0000`,
      signature: `sig-${role}`,
      signed: {
        requestHash: request.requestHash,
        payeeId: request.payeeId,
        payeeEmail: request.payeeEmail,
        amountCents: request.amountCents,
        currency: "USD",
        role,
        riskCardHash: null,
        acknowledgedFlags: false,
        prevHash: "h1",
        ...over,
      },
    },
  };
}

export const assessed = (card: Partial<RiskCard> = {}, requestId = "req-1"): LedgerAppendInput<"risk.assessed"> => ({
  type: "risk.assessed",
  payload: { requestId, requestHash: requestedPayload().requestHash, card: rulesCard(card), cardHash: `card-${card.origin ?? "rules"}` },
});

export const refused = (role: OfficerRole | "parent", code: RefusalCode, requestId = "req-1"): LedgerAppendInput<"approval.refused"> => ({
  type: "approval.refused",
  payload: { requestId, role, code, message: `refused ${code}` },
});

export const aiCard = (over: Partial<RiskCard> = {}): Partial<RiskCard> => ({
  origin: "live",
  model: "test-model",
  summary: "The receipt matches the request.",
  ...over,
});
