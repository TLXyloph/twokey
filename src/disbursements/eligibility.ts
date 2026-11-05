/**
 * Who may request and who may sign (spec §3). Pure rules over the request projection; the routes
 * record every refusal as `approval.refused` and answer 409 with the message, which is a plain
 * sentence the drawer shows as it is.
 *
 * Signing, checked in this order:
 *   not_an_officer           a parent holds no key
 *   request_closed           already sent, confirmed, blocked or failed, or both keys are on it
 *   payee_cannot_sign        the payee never signs a payout to themselves
 *   already_signed           one officer, one key (the requester's request is key 1)
 *   receipt_check_pending    key 2 waits for the receipt check to land or be tried
 *   flags_not_acknowledged   a "check" or "stop" card needs "I've read the flags" ticked
 */
import type { ActingRole, OfficerRole, RefusalCode } from "@/ledger/contracts";
import { currentRisk, hasBothKeys, isRiskPending, requestStatus, signers, titleOf, type RequestState } from "@/ledger/request-projection";
import { payeeById } from "./payees";
import { OFFICER_ROLES } from "./signing";

export interface Refusal {
  code: RefusalCode;
  message: string;
}

const isOfficer = (role: ActingRole): role is OfficerRole => (OFFICER_ROLES as readonly string[]).includes(role);

export const payeeRole = (state: RequestState): OfficerRole | null => payeeById(state.request.payeeId)?.role ?? null;

export const unknownRequest: Refusal = { code: "unknown_request", message: "There's no payout request with that id on this board." };

const CLOSED: Record<"sent" | "confirmed" | "blocked" | "failed", string> = {
  sent: "This payout has already been sent to PayPal.",
  confirmed: "This payout has already been sent, and PayPal confirmed it.",
  blocked: "This payout was stopped by a limit, so it can't be signed any more.",
  failed: "PayPal didn't take this payout, so it can't be signed again.",
};

const NON_OFFICER: Record<Exclude<ActingRole, OfficerRole>, string> = { parent: "A parent", reviewer: "The reviewer" };
const NON_OFFICER_SIGN: Record<Exclude<ActingRole, OfficerRole>, string> = {
  parent: "A parent can't sign payouts. Only the club's officers hold keys.",
  reviewer: "The reviewer signs the monthly close, never a payout, so the reviewer holds no payout key.",
};

/** May `actingAs` request a payout to this payee? */
export function requestRefusal(actingAs: ActingRole, payeeOfficer: OfficerRole | null): Refusal | null {
  if (!isOfficer(actingAs)) return { code: "not_an_officer", message: `${NON_OFFICER[actingAs]} can't request payouts. Only the club's officers can.` };
  if (payeeOfficer === actingAs) {
    const title = titleOf(actingAs);
    return { code: "payee_cannot_sign", message: `The ${title} is the payee, so the ${title} can't request (and sign) this payout.` };
  }
  return null;
}

/** May `actingAs` add a key to this request now? */
export function signRefusal(state: RequestState, actingAs: ActingRole, acknowledgedFlags: boolean): Refusal | null {
  if (!isOfficer(actingAs)) return { code: "not_an_officer", message: NON_OFFICER_SIGN[actingAs] };
  const status = requestStatus(state);
  if (status !== "waiting") return { code: "request_closed", message: CLOSED[status] };
  if (hasBothKeys(state)) return { code: "request_closed", message: "This payout already has both keys." };
  const title = titleOf(actingAs);
  if (payeeRole(state) === actingAs) {
    return { code: "payee_cannot_sign", message: `The ${title} is the payee, so the ${title} can't sign this payout.` };
  }
  if (signers(state).includes(actingAs)) {
    const message =
      state.request.requestedBy === actingAs
        ? `The ${title} requested this payout, so the ${title}'s key is already on it. A second, different officer has to sign.`
        : `The ${title} has already signed this payout.`;
    return { code: "already_signed", message };
  }
  if (isRiskPending(state)) {
    return { code: "receipt_check_pending", message: "The receipt check hasn't finished yet. Sign once the risk card is in." };
  }
  const verdict = currentRisk(state)?.card.verdict;
  if ((verdict === "check" || verdict === "stop") && !acknowledgedFlags) {
    return { code: "flags_not_acknowledged", message: "This payout's risk card has flags. Tick “I've read the flags” before you sign." };
  }
  return null;
}

/** Officers who could add the next key (a hint for the UI; `signRefusal` is what the server enforces). */
export function eligibleSigners(state: RequestState): OfficerRole[] {
  if (requestStatus(state) !== "waiting" || hasBothKeys(state)) return [];
  const taken = new Set<OfficerRole>(signers(state));
  const payee = payeeRole(state);
  return OFFICER_ROLES.filter((role) => role !== payee && !taken.has(role));
}
