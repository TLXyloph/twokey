/**
 * The prompt for the AI's draft of the monthly close: one Messages call with the close's figures as
 * plain lines; the answer is JSON (./draft.ts). Run only by scripts/record-close-draft.sh, once, in
 * development.
 *
 * The facts come from `CloseFigures` alone: no session id, no clock time, no person's contact
 * details. Formatting is deterministic (no locale rendering), so the same figures always give the
 * same prompt.
 *
 * Provider parameters follow the treasurer's receipt check (src/agents/treasurer/prompt.ts):
 * structured JSON output, refusals fall back server-side, effort set explicitly (medium: a short
 * reading of a page of figures).
 */
import type { BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { FALLBACK_BETA } from "@/agents/llm/translate-request";
import { clubDate, formatUsd } from "@/disbursements/risk/format";
import { CLOSE_MONTH_NAME, type CloseException, type CloseFigures } from "./contracts";
import { CLOSE_DRAFT_JSON_SCHEMA, DRAFT_MAX_POINTS, DRAFT_MIN_POINTS, DRAFT_SUMMARY_MAX_WORDS } from "./draft";

/** Thinking plus a ~300-token answer. */
export const DRAFT_MAX_TOKENS = 8192;
export const DRAFT_EFFORT = "medium" as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 24" from "2026-10-24". */
export function shortDate(isoDate: string): string {
  const [, month, day] = isoDate.split("-").map(Number) as [number, number, number];
  return `${MONTHS[month - 1] ?? ""} ${day}`;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export const CLOSE_DRAFT_SYSTEM_PROMPT = `You prepare the monthly reconciliation for the Riverbend Youth Football League, a volunteer-run youth club. This is a demo: the club, its people and its shops are fictional.

The club's rules say a non-signer reviews and signs each month's reconciliation; the club's insurer says financial software does not qualify. So you prepare the draft, and the Reviewer, a volunteer parent who holds no payout key, reads it and decides whether to sign. You never sign, approve or close the month.

Code has already computed every figure below and checked the exceptions. Use only those figures. Don't add, recompute or estimate others, and don't guess where missing money went or who is responsible: say what the records show and what they don't.

Write:
- "summary": at most ${DRAFT_SUMMARY_MAX_WORDS} words. Say whether the month adds up (opening balance plus money in, minus money out, equals the closing balance, and whether it carries forward to the account balance), how the budget lines stand, whether anything was left open at month end, and what the exceptions are.
- "points": ${DRAFT_MIN_POINTS} to ${DRAFT_MAX_POINTS} things the Reviewer should check before signing, most important first. Each "check" is one sentence saying what to check and with whom (for example the event's volunteers or the Treasurer). Each "basis" is the figure from the close it rests on, for example "Car wash, Oct 24: 87 cars logged, $15.00 received".

How to write:
- Plain, calm sentences a volunteer parent understands. No jargon, no accusations, no markdown.
- Amounts in dollars with cents, like $1,290.00. Dates like Oct 24.
- Name roles (the Treasurer, the Reviewer), not people.`;

function exceptionLine(exception: CloseException): string {
  switch (exception.kind) {
    case "takings_gap":
      return (
        `${exception.name}, ${shortDate(exception.date)}: ${exception.unitsLogged} ${exception.unitLabel} logged at ${formatUsd(exception.unitPriceCents)} = ` +
        `${formatUsd(exception.expectedCents)} expected; ${formatUsd(exception.receivedCents)} received; ${formatUsd(exception.missingCents)} has no record.`
      );
    case "no_two_key_record":
      return (
        `No two-key record: ${plural(exception.count, "payment", "payments")} out (${formatUsd(exception.totalCents)}) have no two officers' signatures on record.` +
        (exception.firstSignedRequestDate ? ` TwoKey's first signed payout request is dated ${shortDate(exception.firstSignedRequestDate)}.` : "")
      );
    case "over_budget":
      return `${exception.label}: ${formatUsd(exception.spentCents)} paid against ${formatUsd(exception.approvedCents)} approved; ${formatUsd(exception.overCents)} over.`;
    case "no_budget_line":
      return `${exception.description} (${formatUsd(exception.amountCents)}): its category "${exception.category}" is on no budget line.`;
  }
}

/** The close as the model reads it: plain lines, in a fixed order. */
export function closeFactsText(figures: CloseFigures): string {
  const { period, carriedForward: carried } = figures;
  const paymentsOut = figures.budgetLines.reduce((n, line) => n + line.payments.length, 0);
  const asOf = clubDate(carried.balanceAsOf)?.short ?? carried.balanceAsOf;
  const moneyIn = figures.moneyIn.map((row) => {
    const takings = row.takings
      ? ` ${row.takings.name}: ${row.takings.unitsLogged} ${row.takings.unitLabel} logged at ${formatUsd(row.takings.unitPriceCents)} = ${formatUsd(row.takings.expectedCents)} expected; ${formatUsd(row.takings.receivedCents)} received.`
      : "";
    return `- ${shortDate(row.date)}: ${row.description}, ${formatUsd(row.amountCents)}.${takings}`;
  });
  const lines = figures.budgetLines.map((line) => {
    const head = `- ${line.label}: ${line.spentCents === 0 ? "nothing paid" : `${formatUsd(line.spentCents)} paid`} of ${formatUsd(line.approvedCents)} approved; ${formatUsd(line.leftCents)} left.`;
    const payments = line.payments.map((p) => `${shortDate(p.date)}, ${p.description}, ${p.counterparty}, ${formatUsd(p.amountCents)}`);
    return payments.length > 0 ? `${head} Payments: ${payments.join("; ")}.` : head;
  });
  const open =
    figures.openItems.length > 0
      ? figures.openItems.map((item) => `- ${shortDate(item.date)}: ${item.description}, ${item.counterparty}, ${formatUsd(item.amountCents)}, waiting for a second key.`)
      : ["- None."];
  const exceptions = figures.exceptions.length > 0 ? figures.exceptions.map((e) => `- ${exceptionLine(e)}`) : ["- None."];
  return [
    `Club: ${figures.club}.`,
    `Month: ${CLOSE_MONTH_NAME} (${shortDate(period.from)} to ${shortDate(period.to)}). Amounts in US dollars.`,
    "",
    "Month statement:",
    `- Opening balance, ${shortDate(period.from)}: ${formatUsd(figures.openingCents)}`,
    `- Money in: ${formatUsd(figures.moneyInCents)} (${plural(figures.moneyIn.length, "deposit", "deposits")})`,
    `- Money out: ${formatUsd(figures.moneyOutCents)} (${plural(paymentsOut, "payment", "payments")})`,
    `- Closing balance, ${shortDate(period.to)}: ${formatUsd(figures.closingCents)}`,
    `- Carried forward: ${formatUsd(figures.closingCents)} plus ${formatUsd(carried.laterCents)} of completed rows after the month = ` +
      `${formatUsd(figures.closingCents + carried.laterCents)}; the account balance recorded on ${asOf} is ${formatUsd(carried.balanceCents)}. ` +
      `${carried.reconciles ? "They agree." : "They do not agree."}`,
    "",
    "Money in:",
    ...moneyIn,
    "",
    "Money out, by budget line (approved for the fall season):",
    ...lines,
    "",
    `Open items at ${shortDate(period.to)} (payouts waiting for a second key):`,
    ...open,
    "",
    "Exceptions found by code:",
    ...exceptions,
    "",
    "Write the draft in the JSON format.",
  ].join("\n");
}

export function buildCloseDraftParams(figures: CloseFigures, model: string): BetaMessageStreamParams {
  return {
    model,
    max_tokens: DRAFT_MAX_TOKENS,
    output_config: { effort: DRAFT_EFFORT, format: { type: "json_schema", schema: CLOSE_DRAFT_JSON_SCHEMA } },
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    system: [{ type: "text", text: CLOSE_DRAFT_SYSTEM_PROMPT }],
    messages: [{ role: "user", content: [{ type: "text", text: closeFactsText(figures) }] }],
  };
}
