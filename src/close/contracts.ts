/**
 * The monthly close's contract (spec §5.6, .plans/site-completion-spec.md "Monthly close (C)"):
 * the figures code computes for a month, the AI's recorded draft, the Reviewer's sign-off and the
 * two routes. Money is integer cents (USD) everywhere; dates are ISO (YYYY-MM-DD) in the club's
 * time zone; times are ISO 8601.
 *
 * The close is computed from the seed (demo data), so it is the same for every judge session. Only
 * the sign-off is per session.
 */
import type { ActingRole, BudgetLineId, OfficerRole } from "@/ledger/contracts";

/** The one month this demo closes: October 2026, the seed's month. */
export const CLOSE_MONTH = "2026-10";
export type CloseMonth = typeof CLOSE_MONTH;
export const CLOSE_MONTH_NAME = "October 2026";

/** Bump when the shape of `CloseFigures` changes: it is inside the hash. */
export const CLOSE_FIGURES_VERSION = "twokey-close-v1";

// ---------------------------------------------------------------------------------------------
// The figures (computed in code; their canonical JSON's SHA-256 is the close hash).
// ---------------------------------------------------------------------------------------------

/** What a fundraiser's volunteers logged, against what the ledger received for it. */
export interface CloseTakings {
  eventId: string;
  name: string;
  unitLabel: string;
  unitsLogged: number;
  unitPriceCents: number;
  expectedCents: number;
  receivedCents: number;
}

/** One deposit in the month (the opening balance is not money in). */
export interface CloseMoneyIn {
  rowId: string;
  date: string;
  description: string;
  counterparty: string;
  amountCents: number;
  /** Set when the deposit is a fundraiser's takings. */
  takings: CloseTakings | null;
}

/** One payment out in the month, as a positive amount. */
export interface ClosePayment {
  rowId: string;
  date: string;
  description: string;
  counterparty: string;
  amountCents: number;
}

/** A budget line: approved for the season, against what was paid from it this month. */
export interface CloseBudgetLine {
  id: BudgetLineId;
  label: string;
  approvedCents: number;
  spentCents: number;
  /** Negative when the line is overspent. */
  leftCents: number;
  payments: ClosePayment[];
}

/** A payout requested on or before the month's last day and still waiting for its second key. */
export interface CloseOpenItem extends ClosePayment {
  requestedBy: OfficerRole;
}

export type CloseException =
  | {
      kind: "takings_gap";
      eventId: string;
      name: string;
      date: string;
      unitLabel: string;
      unitsLogged: number;
      unitPriceCents: number;
      expectedCents: number;
      receivedCents: number;
      missingCents: number;
    }
  | {
      /** Payments out with no two-key record: no two officers' signatures are on record for them. */
      kind: "no_two_key_record";
      count: number;
      totalCents: number;
      rowIds: string[];
      /** The first payout request TwoKey holds a signature for (any month); null if none. */
      firstSignedRequestDate: string | null;
    }
  | { kind: "over_budget"; budgetLine: BudgetLineId; label: string; approvedCents: number; spentCents: number; overCents: number }
  | { kind: "no_budget_line"; rowId: string; category: string; description: string; amountCents: number };

export interface CloseFigures {
  version: typeof CLOSE_FIGURES_VERSION;
  club: string;
  month: CloseMonth;
  period: { from: string; to: string };
  openingCents: number;
  moneyInCents: number;
  moneyOutCents: number;
  closingCents: number;
  moneyIn: CloseMoneyIn[];
  budgetLines: CloseBudgetLine[];
  openItems: CloseOpenItem[];
  exceptions: CloseException[];
  /**
   * The month end carried forward to the account's balance: closing + every completed row after the
   * month = the balance the seed records, as of its time.
   */
  carriedForward: { laterCents: number; balanceCents: number; balanceAsOf: string; reconciles: boolean };
}

// ---------------------------------------------------------------------------------------------
// The AI's draft (recorded once in development; never a live call per judge).
// ---------------------------------------------------------------------------------------------

export interface DraftPoint {
  /** One plain sentence: what the Reviewer should check. */
  check: string;
  /** The figure it rests on, e.g. "Car wash, Oct 24: 87 cars logged, $15.00 received". */
  basis: string;
}

export interface CloseDraft {
  /** At most 120 words. */
  summary: string;
  /** Two to four points for the Reviewer to check. */
  points: DraftPoint[];
}

/** The model is kept in the recorded file, never sent to the page (the UI names no AI vendor). */
export type CloseDraftView = { state: "recorded"; recordedAt: string; draft: CloseDraft } | { state: "not_recorded" };

// ---------------------------------------------------------------------------------------------
// The Reviewer's sign-off.
// ---------------------------------------------------------------------------------------------

export const SIGNOFF_TYPE = "twokey.close.signoff.v1";

/** Exactly what the Reviewer's demo key signs (canonical JSON, sorted keys). */
export interface SignedClose {
  type: typeof SIGNOFF_TYPE;
  month: CloseMonth;
  closeHash: string;
  role: "reviewer";
  /** First 8 hex characters of SHA-256 over the raw public key. */
  keyId: string;
  signedAt: string;
}

export interface CloseSignoffView {
  month: CloseMonth;
  role: "reviewer";
  title: "Reviewer";
  keyId: string;
  /** Ed25519 over the canonical JSON of `signed`, base64url. */
  signature: string;
  signedAt: string;
  signed: SignedClose;
  /** The signature checks out against the committed Reviewer public key. */
  verified: boolean;
  /** The signed hash is today's close hash (false if the figures changed after signing). */
  matchesClose: boolean;
}

/** GET /api/close?month=2026-10 */
export interface CloseView {
  month: CloseMonth;
  monthName: string;
  figures: CloseFigures;
  closeHash: string;
  draft: CloseDraftView;
  /** This judge session's sign-off, if the Reviewer has signed. */
  signoff: CloseSignoffView | null;
  /** The Reviewer's published demo key; null until scripts/gen-reviewer-key.sh has run. */
  reviewerKey: { keyId: string } | null;
}

/** POST /api/close/sign */
export interface CloseSignBody {
  actingAs: ActingRole;
  month: string;
}

/** 201 when signed now; 200 with `duplicate: true` when this session had already signed. */
export interface CloseSignResult {
  signoff: CloseSignoffView;
  duplicate: boolean;
}

export const CLOSE_API = {
  view: (month: string = CLOSE_MONTH) => `/api/close?month=${encodeURIComponent(month)}`,
  sign: "/api/close/sign",
} as const;

export type CloseRefusalCode = "signer_cannot_review" | "not_the_reviewer";
export type CloseKeyCode = "reviewer_key_unset" | "reviewer_key_unpublished" | "reviewer_key_invalid" | "reviewer_key_mismatch";
