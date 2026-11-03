/**
 * The AG Studio agent harness for TwoKey: a custom `twokey-auditor` agent is the primary (the one the
 * reader talks to). It answers money questions with its own tool and hands page and widget building
 * to Studio's built-in `data`, `page` and `widget` agents through `delegate_to`. Every agent runs
 * Studio's own loop (`directLlmRunner`) against the Claude adapter, i.e. this app's `/api/ai/turn`.
 *
 * Custom agents are not discovered: the auditor is registered and named as `primary`, and each
 * built-in it delegates to must be registered too, or `delegate_to` has nothing to call.
 */
import {
  createAiHarness,
  directLlmRunner,
  type AgAiHarnessBuilderContext,
  type AgAiHarnessConfig,
  type AgAiHarnessSetup,
  type AgAiPromptStarter,
  type AgBuiltInAgentId,
  type AgLlmAdapter,
  type AgStudioApi,
} from "ag-studio";
import { CLUB_NAME, riverbend, type ClubDemoData } from "@/demo/riverbend";
import { COMPARE_EVENT_TAKINGS_TOOL, createCompareEventTakingsTool } from "./auditor-tools";

export const AUDITOR_AGENT_ID = "twokey-auditor";

/** The built-in agents the auditor may hand work to, and therefore the ones registered. */
export const DELEGATE_TARGETS = ["data", "page", "widget"] as const satisfies readonly AgBuiltInAgentId[];

/** Suggestions shown in a new conversation, before anything has been typed. */
export const PROMPT_STARTERS: AgAiPromptStarter[] = [
  { label: "Where did the car-wash money go?", prompt: "Where did the car-wash money go?" },
  { label: "Expected vs received", prompt: "Compare expected and received takings for every fundraising event." },
  { label: "What is still pending?", prompt: "Which payouts are still pending, and what would the balance be after them?" },
  { label: "Chart event takings", prompt: "Add a chart comparing expected and received takings for each fundraising event." },
];

export function auditorInstructions(api: AgStudioApi): string {
  const tables = api
    .getAiContext()
    .schema()
    .tables.map((table) => table.name)
    .join(", ");
  return `## Role
You are the TwoKey auditor for the club account of the ${CLUB_NAME}, a volunteer-run youth league.
Treasurers, coaches and parents ask you where the club's money came from and where it went. You are a
careful, neutral auditor: precise, plain-spoken and brief.

## Rules
- Answer only from the data and your tools. Cite the numbers you rely on (amounts, counts, dates) and
  where each comes from: an event, a ledger row id such as L10, or the balance.
- Never say money moved, went missing or was taken unless the data shows it. When takings were expected
  but not recorded, say exactly that, e.g. "expected $1,305.00, recorded $15.00; the data has no record
  of the other $1,290.00". Do not guess at causes, and do not speculate about any person.
- Pending payouts are waiting for a second approver: they have not left the account yet.
- This is demo data from a PayPal sandbox. Say so if anyone asks about a real account.
- Lead with the finding, then the figures. Use short paragraphs or a short list.

## Tools
- ${COMPARE_EVENT_TAKINGS_TOOL}: expected vs received takings for each fundraising event, with the ledger
  deposits recorded against it. Call it first for any question about a fundraiser or unaccounted money.
- delegate_to hands a task to another agent and returns its summary:
  - data: explores the schema and runs queries. Use it for ledger, balance or category questions your
    own tool does not answer.
  - page: places widgets on the page, moves them, and manages page filters.
  - widget: configures one widget's data mapping, title and formatting.
  You never build pages or widgets yourself. Building a widget always takes two delegations: page
  (place it) and then widget (configure it). Never stop after page: an unconfigured widget is empty.
  Keep each delegation's instructions to one or two sentences.

## Data
Tables: ${tables}.`;
}

/** The harness config, from the builder context Studio hands `createAiHarness`. */
export function buildHarnessConfig(
  api: AgStudioApi,
  adapter: AgLlmAdapter,
  { builtIn }: AgAiHarnessBuilderContext,
  data: ClubDemoData,
): AgAiHarnessConfig {
  const compareTool = createCompareEventTakingsTool(api, data);
  const auditor = directLlmRunner({
    id: AUDITOR_AGENT_ID,
    name: "TwoKey auditor",
    description: "Audits the club account: answers where money came from and went, citing the data.",
    adapter,
    // The primary takes no delegation parameters.
    schema: (s) => s.undefined(),
    instructions: (ctx) => auditorInstructions(ctx.api),
    tools: ({ tools }) => [compareTool, tools.delegateTo(DELEGATE_TARGETS)],
  });
  const delegates = DELEGATE_TARGETS.map((id) => directLlmRunner({ ...builtIn[id], adapter }));
  return {
    primary: AUDITOR_AGENT_ID,
    agents: [auditor, ...delegates],
    promptStarters: PROMPT_STARTERS,
  };
}

/** The `ai` property for `<AgStudio>`. Studio reads it once, so create it once (module scope or memo). */
export function createTwoKeyAi(adapter: AgLlmAdapter, data: ClubDemoData = riverbend): AgAiHarnessSetup {
  return ({ api }) => createAiHarness(api, (ctx) => buildHarnessConfig(api, adapter, ctx, data));
}
