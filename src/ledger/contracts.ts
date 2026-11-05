/**
 * The fixed contract between TwoKey's step-4 contexts (Ledger, Disbursements, Risk, Collections)
 * and the judge UI. Spec: .plans/step4-two-key-path-spec.md. Types only, plus a few constants.
 *
 * Change this file only through the design lead: four parts of the code are built against it at
 * the same time.
 *
 * Money crosses every boundary in integer cents (USD), never floats. `ClubDemoData` (the board's
 * existing shape, in dollars) is the one exception, because Studio and the board already read it.
 */
import type { ClubDemoData, OfficerRole } from "@/demo/riverbend";
import type { WatchtowerView } from "@/watchtower/contracts";

export type { OfficerRole };
/**
 * Who a judge is acting as. A parent can pay, but can't request or sign. The reviewer is the
 * non-signer who signs the monthly close (spec §4): never a payout key.
 */
export type ActingRole = OfficerRole | "parent" | "reviewer";
export type Currency = "USD";

// ---------------------------------------------------------------------------------------------
// Limits (spec §3). Judge mode only; a real club would set its own.
// ---------------------------------------------------------------------------------------------
export const PAYOUT_CAP_CENTS = 5_000;
export const SESSION_PAYOUT_LIMIT = 3;
export const DAILY_PAYOUT_LIMIT_CENTS = 50_000;
export const TICKET_PRICE_CENTS = 1_500;
export const MAX_TICKETS_PER_ORDER = 4;

// ---------------------------------------------------------------------------------------------
// Payees (fixed list) and receipts (fictional samples). Values live in src/disbursements/payees.ts
// and src/disbursements/risk/receipts.ts; the ids are fixed here.
// ---------------------------------------------------------------------------------------------
export type PayeeId = "team-supply" | "treasurer-reimbursement";
export type ReceiptId = "gloves-team-supply" | "paint-bluebird-hardware" | "cones-team-supply" | "bibs-team-supply";
export type BudgetLineId =
  | "equipment"
  | "facilities"
  | "officials"
  | "fundraising-costs"
  | "concessions"
  | "field-maintenance"
  | "banquet";

// ---------------------------------------------------------------------------------------------
// Ledger events (append-only, hash-chained per session). Spec §2.
// ---------------------------------------------------------------------------------------------
export interface LedgerEventPayloads {
  "session.opened": { seedVersion: string; seedHash: string };
  "order.created": { orderId: string; eventId: string; quantity: number; amountCents: number; currency: Currency };
  "payment.captured": {
    orderId: string;
    captureId: string;
    eventId: string;
    amountCents: number;
    currency: Currency;
    /** PayPal's capture status, e.g. "COMPLETED". */
    status: string;
    /** "PayPal" or "Venmo": the button the buyer used. */
    method: "paypal" | "venmo";
  };
  "payment.confirmed": { captureId: string; paypalEventId: string; eventType: string; paypalCreatedAt: string | null };
  "payout.requested": {
    requestId: string;
    requestHash: string;
    payeeId: PayeeId;
    payeeName: string;
    payeeEmail: string;
    amountCents: number;
    currency: Currency;
    description: string;
    budgetLine: BudgetLineId;
    receiptId: ReceiptId;
    receiptSha256: string;
    requestedBy: OfficerRole;
    createdAt: string;
    /** "seed": one of the two demo-data requests every session starts with. */
    source: "seed" | "session";
  };
  "risk.assessed": { requestId: string; requestHash: string; card: RiskCard; cardHash: string };
  "approval.signed": {
    requestId: string;
    role: OfficerRole;
    /** First 8 hex characters of SHA-256 over the raw public key. */
    keyId: string;
    /** Ed25519 over the canonical JSON of `signed`, base64url. */
    signature: string;
    signed: SignedApproval;
  };
  "approval.refused": { requestId: string; role: ActingRole; code: RefusalCode; message: string };
  "payout.blocked": { requestId: string; code: LimitCode; message: string };
  "payout.sent": { requestId: string; requestHash: string; senderBatchId: string; payoutBatchId: string; batchStatus: string };
  "payout.failed": { requestId: string; httpStatus: number; reason: string };
  "payout.confirmed": {
    requestId: string;
    payoutBatchId: string;
    payoutItemId: string | null;
    /** e.g. "SUCCESS" (item) or "SUCCESS" (batch). */
    status: string;
    paypalEventId: string;
    eventType: string;
    paypalCreatedAt: string | null;
  };
}

export type LedgerEventType = keyof LedgerEventPayloads;

export interface LedgerEvent<T extends LedgerEventType = LedgerEventType> {
  sessionId: string;
  /** 1-based, gapless per session. */
  seq: number;
  /** Random, unique across all sessions. */
  eventId: string;
  type: T;
  payload: LedgerEventPayloads[T];
  /** ISO 8601, set by the server. */
  occurredAt: string;
  /** Seq 1 chains to the seed hash. */
  prevHash: string;
  /** SHA-256 (hex) of canonical JSON {sessionId, seq, type, payload, occurredAt, prevHash}. */
  hash: string;
}

/** What a caller hands the ledger; the store fills in seq, ids, time and hashes. */
export interface LedgerAppendInput<T extends LedgerEventType = LedgerEventType> {
  type: T;
  payload: LedgerEventPayloads[T];
  /** Makes the append idempotent (capture id, PayPal event id, `${requestHash}:${role}`, ...). */
  idempotencyKey?: string;
}

export type LedgerAppendResult<T extends LedgerEventType = LedgerEventType> =
  | { outcome: "stored"; event: LedgerEvent<T> }
  | { outcome: "duplicate"; event: LedgerEvent<T> };

/** The Ledger context's port. Implemented in D1 and in memory (tests). */
export interface LedgerStore {
  /** Opens the session on first use (session.opened + the seeded requests), then returns its events. */
  read(sessionId: string): Promise<LedgerEvent[]>;
  append<T extends LedgerEventType>(sessionId: string, input: LedgerAppendInput<T>): Promise<LedgerAppendResult<T>>;
  /** For webhook linking: the session whose events carry this order id or sender_batch_id. */
  findSessionByOrderId(orderId: string): Promise<string | null>;
  findSessionBySenderBatchId(senderBatchId: string): Promise<{ sessionId: string; requestId: string } | null>;
  /** Sum of payout.sent amounts (cents) across all sessions since `sinceIso`. */
  sentPayoutCentsSince(sinceIso: string): Promise<number>;
}

// ---------------------------------------------------------------------------------------------
// Signatures and refusals. Spec §3.
// ---------------------------------------------------------------------------------------------
/** Exactly what an officer's demo key signs (canonical JSON, sorted keys). */
export interface SignedApproval {
  requestHash: string;
  payeeId: PayeeId;
  payeeEmail: string;
  amountCents: number;
  currency: Currency;
  role: OfficerRole;
  /** The risk card the signer saw; null for key 1 (the request itself). */
  riskCardHash: string | null;
  acknowledgedFlags: boolean;
  /** The ledger head when the signature was made: binds it into the chain. */
  prevHash: string;
}

export type RefusalCode =
  | "not_an_officer"
  | "payee_cannot_sign"
  | "already_signed"
  | "request_closed"
  | "receipt_check_pending"
  | "flags_not_acknowledged"
  | "unknown_request";

export type LimitCode = "over_payout_cap" | "session_payout_limit" | "daily_payout_limit";

// ---------------------------------------------------------------------------------------------
// Risk card. Spec §4.
// ---------------------------------------------------------------------------------------------
export type RiskVerdict = "clear" | "check" | "stop";

export interface RiskFinding {
  severity: "info" | "warn" | "stop";
  /** One plain sentence. */
  text: string;
  /** What it rests on, e.g. "Receipt line 2: patio string lights, $12.00". */
  evidence: string;
  source: "rule" | "ai";
}

export interface ReceiptReading {
  vendor: string | null;
  /** ISO date, if legible. */
  date: string | null;
  items: { description: string; amountCents: number }[];
  totalCents: number | null;
}

export interface RiskCard {
  verdict: RiskVerdict;
  /** At most 25 words. */
  summary: string;
  findings: RiskFinding[];
  /** Null on a rules-only card. */
  receipt: ReceiptReading | null;
  matchesRequest: boolean | null;
  /**
   * "rules": code checks only (instant, $0; what every request gets first).
   * "live": the AI read the receipt just now. "recorded": made once in development (seed requests).
   * "replay": a recorded answer served because the live AI is unavailable.
   */
  origin: "rules" | "live" | "recorded" | "replay";
  /** The model that read the receipt; null for "rules". */
  model: string | null;
  checkedAt: string;
}

/** What the risk context needs to judge one request. */
export interface RiskInput {
  request: LedgerEventPayloads["payout.requested"];
  /** Every request in the session, for the split check. */
  sessionRequests: LedgerEventPayloads["payout.requested"][];
}

/** The Risk context's port. */
export interface RiskAssessor {
  /** Code checks only: synchronous in spirit, never calls the AI. */
  rulesCard(input: RiskInput, now: Date): RiskCard;
  /**
   * Reads the receipt with the AI, behind the AI budget gates. Resolves to a "live", "recorded" or
   * "replay" card, or to null when the AI is unavailable and nothing is recorded (the rules card stands).
   */
  aiCard(input: RiskInput, sessionId: string, now: Date): Promise<RiskCard | null>;
}

// ---------------------------------------------------------------------------------------------
// The board view: the session fold, as the judge UI reads it. Spec §2, §6.
// ---------------------------------------------------------------------------------------------
export interface SignatureView {
  role: OfficerRole;
  /** "Treasurer". */
  title: string;
  keyId: string;
  at: string;
  signature: string;
  signed: SignedApproval;
  /** The hash of the ledger event that holds it. */
  eventHash: string;
  /** True for the request's own signature (key 1). */
  isRequest: boolean;
}

export interface TimelineStep {
  step: "requested" | "signed" | "blocked" | "sent" | "failed" | "confirmed";
  /** Plain words: "Sent to PayPal", "PayPal confirmed". */
  label: string;
  at: string;
  /** e.g. PayPal's batch id, or the refusal's reason. */
  detail?: string;
}

export interface PayoutRequestView {
  requestId: string;
  requestHash: string;
  /** Seeded requests are "demo data"; a judge's own are "live sandbox". */
  sourceLabel: "demo data" | "live sandbox";
  payee: { id: PayeeId; name: string; role: OfficerRole | null };
  amountCents: number;
  description: string;
  budgetLine: BudgetLineId;
  receipt: { id: ReceiptId; label: string; imageUrl: string };
  requestedBy: OfficerRole;
  createdAt: string;
  signatures: SignatureView[];
  /** Officers who could add the next key. A hint for the UI; the server enforces the rules. */
  eligibleSigners: OfficerRole[];
  refusals: { role: ActingRole; code: RefusalCode; message: string; at: string }[];
  /** The latest card (an AI card supersedes the rules card). */
  risk: RiskCard | null;
  /** True while an AI read hasn't landed yet and could still run. */
  riskPending: boolean;
  status: "waiting" | "blocked" | "sent" | "confirmed" | "failed";
  timeline: TimelineStep[];
}

export interface BoardView {
  /** The seed plus this session's events, in the board's existing shape (dollars). */
  data: ClubDemoData;
  /** Waiting requests first, then the rest, newest first. */
  requests: PayoutRequestView[];
  /** PayPal's real balance for the shared sandbox account; null when it can't be read. */
  sharedBalance: { availableCents: number; currency: Currency; asOf: string } | null;
  limits: { payoutCapCents: number; sessionPayoutsLeft: number; dailyCentsLeft: number };
  chain: { length: number; head: string };
  /** The global Watchtower's state (the same for every session); null when it can't be read. */
  watchtower: WatchtowerView | null;
}

// ---------------------------------------------------------------------------------------------
// HTTP API (all JSON; all need the judge-session cookie; POSTs also pass the same-origin check).
// Errors: { error: { code: string; message: string } } with 4xx/5xx.
// ---------------------------------------------------------------------------------------------
export const API = {
  /** GET -> BoardView */
  ledgerView: "/api/ledger/view",
  /** GET -> ChainCheck */
  ledgerVerify: "/api/ledger/verify",
  /** POST CreatePayoutRequestBody -> 201 { request: PayoutRequestView } */
  payoutRequests: "/api/payouts/requests",
  /** POST SignBody -> 200 { request } | 409 refusal | 409 limit */
  sign: (requestId: string) => `/api/payouts/requests/${encodeURIComponent(requestId)}/sign`,
  /** POST {} -> 200 { request } (runs the AI receipt read once; later calls return the stored card) */
  risk: (requestId: string) => `/api/payouts/requests/${encodeURIComponent(requestId)}/risk`,
  /** POST CreateOrderBody -> 201 { orderId } */
  orders: "/api/collections/orders",
  /** POST {} -> 200 CaptureResult */
  capture: (orderId: string) => `/api/collections/orders/${encodeURIComponent(orderId)}/capture`,
  /** POST -> judge-session cookie (existing route) */
  session: "/api/ai/session",
} as const;

export interface CreatePayoutRequestBody {
  actingAs: OfficerRole;
  payeeId: PayeeId;
  amountCents: number;
  description: string;
  budgetLine: BudgetLineId;
  receiptId: ReceiptId;
}

export interface SignBody {
  actingAs: ActingRole;
  acknowledgedFlags: boolean;
}

export interface CreateOrderBody {
  eventId: "banquet";
  quantity: number;
}

export interface CaptureResult {
  captureId: string;
  status: string;
  amountCents: number;
}

export type ChainCheck = { ok: true; length: number; head: string } | { ok: false; badSeq: number; reason: string };

export interface ApiError {
  error: { code: RefusalCode | LimitCode | string; message: string };
}
