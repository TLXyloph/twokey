/**
 * The treasurer agent's receipt check: one Messages call with the receipt image, the request's
 * facts and the rule checks' results; the answer is JSON (./answer.ts).
 *
 * The prompt is the replay key (src/agents/llm/replay-key.ts hashes `system` and `messages`), so it
 * carries only facts that are the same for the same request in every session: no session id, no
 * request id, no request hash, no clock time. `TreasurerFacts` has no field for any of them.
 *
 * Provider parameters are fixed here, as in src/agents/llm/translate-request.ts: the model comes
 * from the server config, effort is low (reading a receipt is extraction plus a short judgment),
 * and refusals fall back server-side, as on the AI route.
 */
import type { BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { RiskFinding, RiskVerdict } from "@/ledger/contracts";
import { FALLBACK_BETA } from "@/agents/llm/translate-request";
import { formatUsd as dollars } from "@/disbursements/risk/format";
import { TREASURER_ANSWER_JSON_SCHEMA } from "./answer";

/** Thinking plus a ~400-token answer; a cut-off answer is retried once. */
export const TREASURER_MAX_TOKENS = 4096;
export const TREASURER_EFFORT = "low" as const;

export interface TreasurerFacts {
  payeeName: string;
  /** "Treasurer" when the payee is an officer; null otherwise. */
  payeeOfficerTitle: string | null;
  amountCents: number;
  description: string;
  /** Null when the line isn't in the club's budget. */
  budgetLine: { label: string; approvedCents: number; leftCents: number } | null;
  requestedByTitle: string;
  /** The request's date in the club's time zone, e.g. "Tuesday, November 3, 2026". */
  requestedOn: string;
  officers: { title: string; name: string; address: string }[];
  ruleFindings: RiskFinding[];
  ruleVerdict: RiskVerdict;
}

export interface ReceiptImage {
  mediaType: "image/png";
  /** Base64, no line breaks. */
  base64: string;
}

export const TREASURER_SYSTEM_PROMPT = `You are the treasurer's assistant for the Riverbend Youth Football League, a volunteer-run youth club. This is a demo: the club, its people and its shops are fictional.

Before a second officer signs a payout, you read the receipt attached to the request and compare it with the request. You give advice only. You never approve, sign or block a payout: two officers decide.

What to do:
1. Read the receipt image: the shop's name, the date printed on it, each line item with its line total, and the total. Copy what is printed; don't guess. Use null for anything you can't read.
2. Compare the receipt with the request. Does the total equal the amount asked for? Is the shop the payee, or, for a reimbursement, a shop the officer could have paid? Is the receipt dated on or before the request? Is every item a reasonable cost for a youth football club on the request's budget line?
3. Write findings for what the receipt shows. Code has already run the rule checks listed in the request; don't repeat them, but weigh them in your verdict and summary.

Severity of a finding:
- info: worth knowing; nothing to do.
- warn: someone should look before signing. For example: an item that isn't a club expense, a total that differs from the amount asked for, a shop that isn't the payee, a receipt dated after the request.
- stop: the receipt doesn't support this payout at all. For example: a receipt for something else entirely.

Verdict: "clear" when nothing needs a look, "check" when anything needs a look, "stop" when the receipt doesn't support the payout. Your verdict must be at least as strict as the rule checks' verdict.

matchesRequest: true only when the receipt's total equals the amount asked for and the receipt supports the request's description.

How to write:
- Plain, calm sentences that a volunteer parent understands. No jargon and no accusations: say what the receipt shows.
- A finding's "text" is one sentence. Its "evidence" is the receipt line or fact it rests on, for example "Receipt line 2: patio string lights, $12.00".
- In sentences, write amounts in dollars, like $12.00. In the JSON amount fields, use whole cents: $12.00 is 1200.
- Dates in the JSON are YYYY-MM-DD. The club's time zone is America/Chicago (Central Time).
- At most 4 findings; none if nothing needs a look.
- "summary": one or two sentences, at most 20 words.`;

/** The request as the model reads it: plain lines, in a fixed order. */
export function requestText(facts: TreasurerFacts): string {
  const payee = facts.payeeOfficerTitle ? `${facts.payeeName} (an officer: the ${facts.payeeOfficerTitle})` : facts.payeeName;
  const line = facts.budgetLine
    ? `${facts.budgetLine.label} (${dollars(facts.budgetLine.approvedCents)} approved for the season; ${dollars(facts.budgetLine.leftCents)} left before this request)`
    : "not in the club's budget";
  const officers = facts.officers.map((officer) => `- ${officer.title}: ${officer.name}, ${officer.address}`);
  const rules =
    facts.ruleFindings.length > 0
      ? facts.ruleFindings.map((finding) => `- ${finding.severity}: ${finding.text} (${finding.evidence})`)
      : ["- none"];
  return [
    "Payout request (its receipt is the image above):",
    `- Payee: ${payee}`,
    `- Amount asked for: ${dollars(facts.amountCents)}`,
    `- Description: ${facts.description}`,
    `- Budget line: ${line}`,
    `- Requested by: the ${facts.requestedByTitle}`,
    `- Requested on: ${facts.requestedOn} (club time)`,
    "",
    "Officers on file (fictional):",
    ...officers,
    "",
    "Rule checks already run by code:",
    ...rules,
    `Rule verdict: ${facts.ruleVerdict}`,
    "",
    "Read the receipt and answer in the JSON format.",
  ].join("\n");
}

export function buildTreasurerParams(facts: TreasurerFacts, image: ReceiptImage, model: string): BetaMessageStreamParams {
  return {
    model,
    max_tokens: TREASURER_MAX_TOKENS,
    output_config: { effort: TREASURER_EFFORT, format: { type: "json_schema", schema: TREASURER_ANSWER_JSON_SCHEMA } },
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    system: [{ type: "text", text: TREASURER_SYSTEM_PROMPT }],
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } },
          { type: "text", text: requestText(facts) },
        ],
      },
    ],
  };
}
