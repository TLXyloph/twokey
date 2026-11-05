/**
 * The rule checks (spec §4): plain code, $0, instant. Every request gets these first, and the AI
 * read sees their results.
 *
 *   officer   warn  the payee is an officer, or shares an officer's surname or address on file
 *   budget    stop  the amount is over what's left on the budget line: approved for the season,
 *                   minus completed spend in the seed ledger for that category, minus the
 *                   session's other requests on the line
 *   split     warn  the same payee has two or more requests within 7 days that together exceed $50
 *   round     info  $40 or more ending in .00; a weak signal, shown only alongside another flag
 *
 * Verdict from the rules alone: any stop -> "stop", any warn -> "check", else "clear".
 * Pure functions: the club's policy and seed come in through `RulesContext` (defaults: the demo's).
 */
import { riverbend, type LedgerEntry, type OfficerRole } from "@/demo/riverbend";
import { BUDGET_LINES, OFFICER_DIRECTORY, type BudgetLine, type OfficerRecord } from "@/demo/riverbend-policy";
import { PAYEES, type Payee } from "@/disbursements/payees";
import { PAYOUT_CAP_CENTS, type LedgerEventPayloads, type RiskCard, type RiskFinding, type RiskInput, type RiskVerdict } from "@/ledger/contracts";
import { capWords, clubDate, formatUsd } from "./format";

export type PayoutRequest = LedgerEventPayloads["payout.requested"];

/** A payee as the rules read it; an address on file is optional (the demo's payees have none). */
export type RulesPayee = Pick<Payee, "id" | "name" | "role"> & { address?: string | null };

export interface RulesContext {
  budgetLines: readonly BudgetLine[];
  officers: readonly OfficerRecord[];
  payees: readonly RulesPayee[];
  /** The seed's ledger rows; its completed money out per category is the season's spend so far. */
  seedLedger: readonly LedgerEntry[];
}

export const DEMO_RULES_CONTEXT: RulesContext = {
  budgetLines: BUDGET_LINES,
  officers: OFFICER_DIRECTORY,
  payees: PAYEES,
  seedLedger: riverbend.ledger,
};

export const SPLIT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const ROUND_AMOUNT_MIN_CENTS = 4_000;
export const SUMMARY_MAX_WORDS = 25;

const TITLES: Readonly<Record<OfficerRole, string>> = { treasurer: "Treasurer", president: "President", secretary: "Secretary" };
export const officerTitle = (role: OfficerRole): string => TITLES[role];

/** A finding plus the few words the summary uses for it. */
interface Flag {
  finding: RiskFinding;
  short: string;
}
const flag = (severity: RiskFinding["severity"], text: string, evidence: string, short: string): Flag => ({
  finding: { severity, text, evidence, source: "rule" },
  short,
});

// ---------------------------------------------------------------------------------------------
// Officer
// ---------------------------------------------------------------------------------------------

const words = (text: string): string[] => text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
const surname = (name: string): string => words(name).at(-1) ?? "";
const sameAddress = (a: string, b: string): boolean => words(a).join(" ") === words(b).join(" ") && words(a).length > 0;

function officerFlags(request: PayoutRequest, ctx: RulesContext): Flag[] {
  const payee = ctx.payees.find((entry) => entry.id === request.payeeId);
  const flags: Flag[] = [];
  if (payee?.role) {
    flags.push(
      flag("warn", `This pays an officer, the ${officerTitle(payee.role)}.`, `Payee: ${request.payeeName}`, "the payee is an officer"),
    );
  }
  const nameWords = new Set(words(request.payeeName));
  for (const officer of ctx.officers) {
    if (officer.role === payee?.role) continue;
    const title = officerTitle(officer.role);
    if (nameWords.has(surname(officer.name))) {
      flags.push(
        flag(
          "warn",
          `The payee shares a surname with the ${title}.`,
          `Payee: ${request.payeeName}; ${title}: ${officer.name}`,
          "the payee shares an officer's surname",
        ),
      );
    }
    if (payee?.address && sameAddress(payee.address, officer.address)) {
      flags.push(
        flag(
          "warn",
          `The payee's address on file is the ${title}'s address.`,
          `Payee: ${payee.address}; ${title}: ${officer.address}`,
          "the payee shares an officer's address",
        ),
      );
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------------------------

export interface BudgetStanding {
  line: BudgetLine;
  approvedCents: number;
  /** Completed money out in the seed ledger for the line's category. */
  spentCents: number;
  /** The session's other requests on this line (waiting or sent). */
  otherRequestsCents: number;
  /** What's left before this request. */
  leftCents: number;
}

/** Null when the request's budget line isn't in the club's budget (then there's nothing to check). */
export function budgetStanding(input: RiskInput, ctx: RulesContext = DEMO_RULES_CONTEXT): BudgetStanding | null {
  const { request, sessionRequests } = input;
  const line = ctx.budgetLines.find((entry) => entry.id === request.budgetLine);
  if (!line) return null;
  const spentCents = ctx.seedLedger
    .filter((row) => row.status === "completed" && row.direction === "out" && row.category === line.category)
    .reduce((sum, row) => sum + Math.round(-row.amount * 100), 0);
  const otherRequestsCents = sessionRequests
    .filter((other) => other.requestId !== request.requestId && other.budgetLine === line.id)
    .reduce((sum, other) => sum + other.amountCents, 0);
  return { line, approvedCents: line.approvedCents, spentCents, otherRequestsCents, leftCents: line.approvedCents - spentCents - otherRequestsCents };
}

function budgetFlags(input: RiskInput, ctx: RulesContext): Flag[] {
  const standing = budgetStanding(input, ctx);
  if (!standing || input.request.amountCents <= standing.leftCents) return [];
  const { line } = standing;
  return [
    flag(
      "stop",
      `This is more than is left on the ${line.label} budget line.`,
      `${line.label}: ${formatUsd(standing.approvedCents)} approved, ${formatUsd(standing.spentCents)} spent, ` +
        `${formatUsd(standing.otherRequestsCents)} in other requests, ${formatUsd(standing.leftCents)} left; ` +
        `this request is ${formatUsd(input.request.amountCents)}`,
      "over what's left on the budget line",
    ),
  ];
}

// ---------------------------------------------------------------------------------------------
// Split
// ---------------------------------------------------------------------------------------------

function splitFlags(input: RiskInput): Flag[] {
  const { request } = input;
  const at = Date.parse(request.createdAt);
  const group = new Map<string, PayoutRequest>([[request.requestId, request]]);
  for (const other of input.sessionRequests) {
    if (other.payeeId !== request.payeeId || group.has(other.requestId)) continue;
    if (Math.abs(Date.parse(other.createdAt) - at) <= SPLIT_WINDOW_MS) group.set(other.requestId, other);
  }
  const members = [...group.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const total = members.reduce((sum, member) => sum + member.amountCents, 0);
  if (members.length < 2 || total <= PAYOUT_CAP_CENTS) return [];
  const listed = members.map((member) => `${clubDate(member.createdAt)?.short ?? "?"}: ${formatUsd(member.amountCents)} (${member.description})`);
  return [
    flag(
      "warn",
      `${request.payeeName} has ${members.length} requests within 7 days that add up to more than ${formatUsd(PAYOUT_CAP_CENTS)}.`,
      `${listed.join("; ")}; ${formatUsd(total)} in total`,
      "possibly one purchase split to stay under the cap",
    ),
  ];
}

// ---------------------------------------------------------------------------------------------
// Round amount, verdicts, the card
// ---------------------------------------------------------------------------------------------

function roundFlags(request: PayoutRequest, others: readonly Flag[]): Flag[] {
  const isRound = request.amountCents >= ROUND_AMOUNT_MIN_CENTS && request.amountCents % 100 === 0;
  if (!isRound || !others.some((other) => other.finding.severity !== "info")) return [];
  return [flag("info", "The amount is a round number, which is a weak sign on its own.", `${formatUsd(request.amountCents)}: $40.00 or more, ending in .00`, "a round amount")];
}

const RANK: Readonly<Record<RiskVerdict, number>> = { clear: 0, check: 1, stop: 2 };
const SEVERITY_RANK: Readonly<Record<RiskFinding["severity"], number>> = { stop: 0, warn: 1, info: 2 };

export function stricterVerdict(a: RiskVerdict, b: RiskVerdict): RiskVerdict {
  return RANK[b] > RANK[a] ? b : a;
}

export function verdictOf(findings: readonly RiskFinding[]): RiskVerdict {
  if (findings.some((finding) => finding.severity === "stop")) return "stop";
  if (findings.some((finding) => finding.severity === "warn")) return "check";
  return "clear";
}

function ruleFlags(input: RiskInput, ctx: RulesContext): Flag[] {
  const flags = [...officerFlags(input.request, ctx), ...budgetFlags(input, ctx), ...splitFlags(input)];
  flags.push(...roundFlags(input.request, flags));
  // Worst first; Array.prototype.sort is stable, so checks keep their order within a severity.
  return flags.sort((a, b) => SEVERITY_RANK[a.finding.severity] - SEVERITY_RANK[b.finding.severity]);
}

export function ruleFindings(input: RiskInput, ctx: RulesContext = DEMO_RULES_CONTEXT): RiskFinding[] {
  return ruleFlags(input, ctx).map((entry) => entry.finding);
}

function summaryOf(flags: readonly Flag[]): string {
  if (flags.length === 0) return "No rule flags: the payee isn't an officer, the budget line has room, and nothing looks split.";
  const count = flags.length === 1 ? "One rule flag" : `${flags.length} rule flags`;
  return capWords(`${count}: ${flags.map((entry) => entry.short).join("; ")}.`, SUMMARY_MAX_WORDS);
}

/** The card every request gets first: code checks only, no AI. */
export function buildRulesCard(input: RiskInput, now: Date, ctx: RulesContext = DEMO_RULES_CONTEXT): RiskCard {
  const flags = ruleFlags(input, ctx);
  const findings = flags.map((entry) => entry.finding);
  return {
    verdict: verdictOf(findings),
    summary: summaryOf(flags),
    findings,
    receipt: null,
    matchesRequest: null,
    origin: "rules",
    model: null,
    checkedAt: now.toISOString(),
  };
}
