/**
 * Adding a key to a payout request (`POST …/sign`). The server enforces the rules
 * (./eligibility.ts): a refusal is appended as `approval.refused` and nothing is signed. Otherwise
 * the officer's demo key signs the request's facts, the risk card they saw, whether they ticked
 * "I've read the flags", and the ledger head; and when that is key 2, the executor runs in the
 * same request (./executor.ts).
 */
import type { ActingRole, LimitCode, OfficerRole } from "@/ledger/contracts";
import { currentRisk, findRequest, hasBothKeys, requestStatus } from "@/ledger/request-projection";
import { signRefusal, unknownRequest, type Refusal } from "./eligibility";
import { executePayout, type ExecutorDeps } from "./executor";
import { approvalFor, keys } from "./request-steps";
import type { DemoSigner } from "./signing";

export interface ApproveDeps extends ExecutorDeps {
  signer: DemoSigner;
}

export interface SignInput {
  actingAs: ActingRole;
  acknowledgedFlags: boolean;
}

export type SignOutcome =
  | { kind: "unknown_request"; refusal: Refusal }
  | { kind: "refused"; refusal: Refusal }
  | { kind: "blocked"; code: LimitCode; message: string }
  /** Signed; when it was key 2, the payout was sent or failed (the request view says which). */
  | { kind: "signed"; executed: "sent" | "failed" | null };

export async function signPayout(deps: ApproveDeps, sessionId: string, requestId: string, input: SignInput): Promise<SignOutcome> {
  const { ledger } = deps;
  const events = await ledger.read(sessionId);
  const state = findRequest(events, requestId);
  if (!state) return { kind: "unknown_request", refusal: unknownRequest };

  const refusal = signRefusal(state, input.actingAs, input.acknowledgedFlags);
  if (refusal) {
    await ledger.append(sessionId, { type: "approval.refused", payload: { requestId, role: input.actingAs, ...refusal } });
    return { kind: "refused", refusal };
  }

  const role = input.actingAs as OfficerRole;
  const signed = approvalFor(state.request, role, {
    riskCardHash: currentRisk(state)?.cardHash ?? null,
    acknowledgedFlags: input.acknowledgedFlags,
    prevHash: events.at(-1)?.hash ?? "",
  });
  const { keyId, signature } = await deps.signer.sign(role, signed);
  await ledger.append(sessionId, {
    type: "approval.signed",
    payload: { requestId, role, keyId, signature, signed },
    idempotencyKey: keys.signature(state.request.requestHash, role),
  });

  const after = await ledger.read(sessionId);
  const current = findRequest(after, requestId);
  if (!current || !hasBothKeys(current) || requestStatus(current) !== "waiting") return { kind: "signed", executed: null };
  const outcome = await executePayout(deps, sessionId, current, after);
  if (outcome.kind === "blocked") return { kind: "blocked", code: outcome.code, message: outcome.message };
  return { kind: "signed", executed: outcome.kind };
}
