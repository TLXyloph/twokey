/**
 * Every payout request in a session, folded from its events: the request, its signatures, its
 * refusals, its risk cards and how it ended. The board view (./fold.ts), the eligibility rules
 * (src/disbursements/eligibility.ts) and the executor all read this one projection, so they can't
 * disagree about a request's state.
 */
import { OFFICERS } from "@/demo/riverbend";
import type { LedgerEvent, LedgerEventPayloads, OfficerRole, PayoutRequestView, RiskCard, SignatureView } from "./contracts";

type Payload<T extends keyof LedgerEventPayloads> = LedgerEventPayloads[T];

export interface Stamped<T> {
  payload: T;
  at: string;
  seq: number;
}

export interface RiskRecord {
  card: RiskCard;
  cardHash: string;
  at: string;
}

export interface RequestState {
  request: Payload<"payout.requested">;
  /** In ledger order; the first is the request's own (key 1). */
  signatures: SignatureView[];
  /** The server's refusals (a "sent_back" decision is kept apart, in `sentBack`). */
  refusals: PayoutRequestView["refusals"];
  /** An officer's decision to send the request back, with the reason; it closes the request. */
  sentBack: { role: OfficerRole; reason: string; at: string; seq: number } | null;
  risks: RiskRecord[];
  blocked: Stamped<Payload<"payout.blocked">> | null;
  sent: Stamped<Payload<"payout.sent">> | null;
  failed: Stamped<Payload<"payout.failed">> | null;
  confirmations: Stamped<Payload<"payout.confirmed">>[];
}

export const titleOf = (role: OfficerRole): string => OFFICERS.find((officer) => officer.role === role)?.title ?? role;

const is = <T extends LedgerEvent["type"]>(event: LedgerEvent, type: T): event is LedgerEvent<T> => event.type === type;

/** The session's requests, in the order they were made. Events for an unknown request are ignored. */
export function projectRequests(events: readonly LedgerEvent[]): RequestState[] {
  const states = new Map<string, RequestState>();
  for (const event of events) {
    if (is(event, "payout.requested")) {
      if (!states.has(event.payload.requestId)) {
        states.set(event.payload.requestId, {
          request: event.payload,
          signatures: [],
          refusals: [],
          sentBack: null,
          risks: [],
          blocked: null,
          sent: null,
          failed: null,
          confirmations: [],
        });
      }
      continue;
    }
    const requestId = (event.payload as { requestId?: unknown }).requestId;
    const state = typeof requestId === "string" ? states.get(requestId) : undefined;
    if (!state) continue;
    const stamp = <T>(payload: T): Stamped<T> => ({ payload, at: event.occurredAt, seq: event.seq });
    if (is(event, "approval.signed")) {
      const { role, keyId, signature, signed } = event.payload;
      state.signatures.push({
        role,
        title: titleOf(role),
        keyId,
        at: event.occurredAt,
        signature,
        signed,
        eventHash: event.hash,
        isRequest: state.signatures.length === 0 && role === state.request.requestedBy,
      });
    } else if (is(event, "approval.refused")) {
      const { role, code, message } = event.payload;
      if (code === "sent_back") state.sentBack ??= { role: role as OfficerRole, reason: message, at: event.occurredAt, seq: event.seq };
      else state.refusals.push({ role, code, message, at: event.occurredAt });
    } else if (is(event, "risk.assessed")) {
      state.risks.push({ card: event.payload.card, cardHash: event.payload.cardHash, at: event.occurredAt });
    } else if (is(event, "payout.blocked")) {
      state.blocked ??= stamp(event.payload);
    } else if (is(event, "payout.sent")) {
      state.sent ??= stamp(event.payload);
    } else if (is(event, "payout.failed")) {
      state.failed ??= stamp(event.payload);
    } else if (is(event, "payout.confirmed")) {
      state.confirmations.push(stamp(event.payload));
    }
  }
  return [...states.values()];
}

/** PayPal's confirmation wins over everything (a timed-out send can still go through). */
export function requestStatus(state: RequestState): PayoutRequestView["status"] {
  if (state.confirmations.length > 0) return "confirmed";
  if (state.sent) return "sent";
  if (state.failed) return "failed";
  if (state.blocked) return "blocked";
  if (state.sentBack) return "sent_back";
  return "waiting";
}

const isAiAttempt = (card: RiskCard): boolean => card.origin !== "rules" || card.findings.some((finding) => finding.source === "ai");

/** The card the signer sees: the latest AI card, else the latest card. */
export function currentRisk(state: RequestState): RiskRecord | null {
  return state.risks.filter((record) => record.card.origin !== "rules").at(-1) ?? state.risks.at(-1) ?? null;
}

/**
 * True while no AI read has landed or been tried. A tried read that came back empty is recorded as
 * a rules card carrying an AI-sourced note (src/disbursements/risk-read.ts), so it ends the wait.
 */
export function isRiskPending(state: RequestState): boolean {
  return !state.risks.some((record) => isAiAttempt(record.card));
}

/** The officers who have signed, in order (key 1 first). */
export const signers = (state: RequestState): OfficerRole[] => state.signatures.map((signature) => signature.role);

export const hasBothKeys = (state: RequestState): boolean => new Set(signers(state)).size >= 2;

export function findRequest(events: readonly LedgerEvent[], requestId: string): RequestState | undefined {
  return projectRequests(events).find((state) => state.request.requestId === requestId);
}
