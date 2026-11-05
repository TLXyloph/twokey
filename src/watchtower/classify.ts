/**
 * The Watchtower's rules (pure): Transaction Search rows in, the debits to judge out. Spec:
 * .plans/watchtower-spec.md "Classify every row". It never looks at the balance.
 *   - Credits (amount > 0) are never findings. A T03xx credit whose `paypal_reference_id` names a
 *     debit marks that debit `fundedByBank` (the linked bank covered it; the balance didn't move).
 *   - Holds and their releases (T15xx, T1105, and the dispute hold pair T1110/T1111) are never
 *     findings. Other T11xx debits are: a T1107 refund or a T1106 reversal is money leaving, and
 *     TwoKey never refunds. A denied row ("D") moved no money.
 *   - T0001 (payout) goes on to be traced against the ledger (./trace.ts).
 *   - Any other debit is `outside_debit`.
 * What left = |amount| + |fee| (a payout carries its $0.25 fee on the same row).
 */
import type { TransactionRow } from "@/payments/paypal/transactions";
import type { FindingKind, WatchFinding } from "./contracts";
import { nameCounterparty } from "./names";

export type DebitRoute = "outside_debit" | "payout";

export interface JudgedDebit {
  transactionId: string;
  eventCode: string;
  route: DebitRoute;
  /** Plain words for the route; a payout's final label comes from its trace. */
  label: string;
  /** Positive cents that left the account: the amount plus its fee. */
  amountCents: number;
  /** Positive cents sent, before the fee: what a payout request asked for. */
  sentCents: number;
  counterparty: string | null;
  counterpartyIsOfficer: boolean;
  /** The full email, for tracing only. Never logged, stored or shown. */
  counterpartyEmail: string | null;
  customField: string | null;
  at: string;
  fundedByBank: boolean;
}

export interface FundingPair {
  debitId: string;
  fundingId: string;
}

export interface Classification {
  /** In PayPal's row order. */
  debits: JudgedDebit[];
  fundingPairs: FundingPair[];
  lastRefreshed: string | null;
}

export const PAYOUT_LABELS = {
  /** No trace to a ledger payout. */
  untraced: "Payout outside the two-key flow",
  /** Traced to a ledger payout whose two signatures don't check out. */
  unsigned: "Payout without two valid signatures",
} as const;

const code = (eventCode: string): number => Number(eventCode.slice(1));

export function routeLabel(eventCode: string): string {
  const n = code(eventCode);
  if (n === 0) return "Sent from PayPal's website";
  if (n === 1) return PAYOUT_LABELS.untraced;
  if (n < 100) return "Paid from the PayPal account";
  if (n < 200) return "Fee charged by PayPal";
  if (n >= 400 && n < 500) return "Withdrawn to a bank";
  if (n >= 700 && n < 800) return "Spent with a PayPal debit card";
  if (n === 1106) return "Reversed by PayPal (a dispute or chargeback)";
  if (n === 1107) return "Refunded from PayPal's website";
  if (n >= 1200 && n < 1300) return "Adjusted by PayPal";
  return "Money left the PayPal account";
}

const HOLD_PAIR_CODES = new Set(["T1105", "T1110", "T1111"]);
const isHoldOrRelease = (eventCode: string): boolean => eventCode.startsWith("T15") || HOLD_PAIR_CODES.has(eventCode);
const isFunding = (eventCode: string): boolean => eventCode.startsWith("T03");

export function classifyRows(rows: readonly TransactionRow[], lastRefreshed: string | null): Classification {
  const debitRows = rows.filter((row) => row.amountCents < 0 && row.status !== "D" && !isHoldOrRelease(row.eventCode));
  const debitIds = new Set(debitRows.map((row) => row.transactionId));
  const fundingPairs: FundingPair[] = rows
    .filter((row) => row.amountCents > 0 && isFunding(row.eventCode) && row.referenceId !== null && debitIds.has(row.referenceId))
    .map((row) => ({ debitId: row.referenceId!, fundingId: row.transactionId }));
  const funded = new Set(fundingPairs.map((pair) => pair.debitId));

  const debits = debitRows.map((row): JudgedDebit => {
    const { counterparty, isOfficer } = nameCounterparty(row.counterpartyEmail);
    const sentCents = Math.abs(row.amountCents);
    return {
      transactionId: row.transactionId,
      eventCode: row.eventCode,
      route: row.eventCode === "T0001" ? "payout" : "outside_debit",
      label: routeLabel(row.eventCode),
      amountCents: sentCents + Math.abs(row.feeCents),
      sentCents,
      counterparty,
      counterpartyIsOfficer: isOfficer,
      counterpartyEmail: row.counterpartyEmail,
      customField: row.customField,
      at: row.initiatedAt,
      fundedByBank: funded.has(row.transactionId),
    };
  });
  return { debits, fundingPairs, lastRefreshed };
}

export interface FindingContext {
  kind: FindingKind;
  label: string;
  firstSeenAt: string;
  /** Found by the Watchtower's first successful run: the delay isn't known. */
  backfill: boolean;
  explanation: string | null;
}

export function findingFrom(debit: JudgedDebit, context: FindingContext): WatchFinding {
  const delayMs = Date.parse(context.firstSeenAt) - Date.parse(debit.at);
  return {
    transactionId: debit.transactionId,
    kind: context.kind,
    eventCode: debit.eventCode,
    label: context.label,
    amountCents: debit.amountCents,
    counterparty: debit.counterparty,
    counterpartyIsOfficer: debit.counterpartyIsOfficer,
    at: debit.at,
    firstSeenAt: context.firstSeenAt,
    reportedAfterMinutes: context.backfill || !Number.isFinite(delayMs) ? null : Math.max(0, Math.round(delayMs / 60_000)),
    fundedByBank: debit.fundedByBank,
    explanation: context.explanation,
  };
}
