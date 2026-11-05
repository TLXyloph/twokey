/**
 * Sending a payout back (`POST …/send-back`): an officer who could add key 2 decides against the
 * payout and says why. It is recorded as `approval.refused` with the code "sent_back" and the
 * reason as its message, which closes the request: nothing is signed and nothing is sent. Anyone
 * else who tries is refused by the same rules as signing (./eligibility.ts), and that refusal is
 * recorded too.
 */
import type { ActingRole } from "@/ledger/contracts";
import type { LedgerStore } from "@/ledger/contracts";
import { findRequest } from "@/ledger/request-projection";
import { sendBackRefusal, unknownRequest, type Refusal } from "./eligibility";

export interface SendBackInput {
  actingAs: ActingRole;
  /** Already validated (3–200 characters, trimmed). */
  reason: string;
}

export type SendBackOutcome = { kind: "unknown_request"; refusal: Refusal } | { kind: "refused"; refusal: Refusal } | { kind: "sent_back" };

export async function sendBackPayout(deps: { ledger: LedgerStore }, sessionId: string, requestId: string, input: SendBackInput): Promise<SendBackOutcome> {
  const state = findRequest(await deps.ledger.read(sessionId), requestId);
  if (!state) return { kind: "unknown_request", refusal: unknownRequest };
  const refusal = sendBackRefusal(state, input.actingAs);
  if (refusal) {
    await deps.ledger.append(sessionId, { type: "approval.refused", payload: { requestId, role: input.actingAs, ...refusal } });
    return { kind: "refused", refusal };
  }
  await deps.ledger.append(sessionId, {
    type: "approval.refused",
    payload: { requestId, role: input.actingAs, code: "sent_back", message: input.reason },
    idempotencyKey: `sent-back:${state.request.requestHash}`,
  });
  return { kind: "sent_back" };
}
