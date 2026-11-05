/**
 * Records the AI's draft of October 2026's close into src/close/recorded-draft.json. Development
 * only; SPENDS REAL MONEY with --yes.
 *
 * Run from the project root through the wrapper, which bundles this file with the local esbuild
 * (there is no tsx): bash scripts/record-close-draft.sh [--yes]
 *
 * - Without --yes: computes the close and builds the call exactly as it would be sent, prints the
 *   spend estimate and stops. No network, and .env is not read.
 * - With --yes: reads ANTHROPIC_API_KEY from .env in-process (never printed, never an argument),
 *   makes the call (at most 2 attempts), writes the file and prints the actual cost.
 * A draft already recorded for this close hash is kept, so a re-run costs nothing.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createAnthropicClient } from "@/agents/llm/run-turn";
import { inputTokenBound } from "@/agents/llm/turn-cost";
import { DEFAULT_MODEL } from "@/agents/llm/translate-request";
import { serializeRecordedDraft, type RecordedDraftEntry } from "@/close/draft";
import { planCloseDraft, recordCloseDraft } from "@/close/draft-recording";
import { octoberClose } from "@/close/october";

const RECORDED_PATH = "src/close/recorded-draft.json";
/**
 * ~1.7k input tokens (system ~450, the figures ~950, the output schema ~200) at $4/M, and about
 * 600-1,500 output tokens (the JSON plus medium-effort thinking) at $20/M.
 */
const EXPECTED_USD = 0.03;

/** A value from .env-style text (`NAME=value`, optional `export`, optional quotes); undefined if absent. */
export function readEnvValue(text: string, name: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match?.[1] !== name) continue;
    const value = (match[2] ?? "").trim().replace(/^(['"])(.*)\1$/, "$2");
    return value || undefined;
  }
  return undefined;
}

const usd = (micro: number) => `$${(micro / 1e6).toFixed(4)}`;

async function main(argv: string[]): Promise<number> {
  const root = process.cwd();
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { name?: string };
  if (pkg.name !== "twokey") {
    console.error("Run this from the TwoKey project root.");
    return 2;
  }
  const existing = JSON.parse(readFileSync(resolve(root, RECORDED_PATH), "utf8")) as Record<string, RecordedDraftEntry>;
  const plan = await planCloseDraft(octoberClose(), DEFAULT_MODEL);
  console.log(`Model ${DEFAULT_MODEL}. Close ${plan.month}, hash ${plan.closeHash.slice(0, 12)}… ${existing[plan.closeHash] ? "(recorded)" : "(to record)"}`);
  if (existing[plan.closeHash]) return 0;
  console.log(
    `Spend estimate: about $${EXPECTED_USD.toFixed(2)} for one call (up to twice that if the answer needs its one retry). ` +
      `Prompt bound: ${inputTokenBound(plan.params)} input tokens; the site's gate would reserve ${usd(plan.worstCaseMicroUsd)} as a loose upper bound.`,
  );
  if (!argv.includes("--yes")) {
    console.log("Nothing spent. Re-run with --yes to make the call.");
    return 0;
  }

  let dotenv: string;
  try {
    dotenv = readFileSync(resolve(root, ".env"), "utf8");
  } catch {
    console.error("No .env in the project root.");
    return 2;
  }
  const apiKey = readEnvValue(dotenv, "ANTHROPIC_API_KEY");
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY is not set in .env.");
    return 2;
  }

  const result = await recordCloseDraft({ client: createAnthropicClient(apiKey), now: Date.now }, plan);
  if (result.outcome === "recorded" && result.entry) {
    writeFileSync(resolve(root, RECORDED_PATH), serializeRecordedDraft({ ...existing, [plan.closeHash]: result.entry }));
    console.log(`Recorded in ${result.attempts} attempt(s), ${usd(result.costMicroUsd)}. Wrote ${RECORDED_PATH}.`);
    return 0;
  }
  console.log(`FAILED (${result.problem ?? "unknown"}) after ${result.attempts} attempt(s), ${usd(result.costMicroUsd)}. Nothing written.`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      // The SDK's errors never carry the key; print the class and message only.
      console.error(error instanceof Error ? `${error.name}: ${error.message}` : "Failed.");
      process.exit(1);
    },
  );
}
