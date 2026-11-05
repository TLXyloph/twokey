/**
 * Records the AI risk cards for the two seeded payout requests into
 * src/disbursements/risk/recorded-cards.json. Development only; SPENDS REAL MONEY with --yes.
 *
 * Run from the project root through the wrapper, which bundles this file with the local esbuild
 * (there is no tsx): bash scripts/record-seed-risk-cards.sh [--yes]
 *
 * - Without --yes: builds both checks exactly as the site would, prints the spend estimate and
 *   stops. No network, and .env is not read.
 * - With --yes: reads ANTHROPIC_API_KEY from .env in-process (never printed, never an argument),
 *   makes the calls (at most 2 attempts per card), writes the file and prints the actual cost.
 * Cards already in the file (same replay key) are skipped, so a re-run costs nothing.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createAnthropicClient } from "@/agents/llm/run-turn";
import { DEFAULT_MODEL } from "@/agents/llm/translate-request";
import { fileReceiptImages } from "@/disbursements/risk/receipt-images";
import type { RecordedCardEntry } from "@/disbursements/risk/recorded";
import { planSeedRecordings, recordSeedCards, serializeRecordedCards } from "@/disbursements/risk/seed-recording";

const RECORDED_PATH = "src/disbursements/risk/recorded-cards.json";
/**
 * Per check: ~2.0k input tokens (image 720x760 ~730, system ~600, output schema ~400, request
 * ~200) at $4/M, and ~400-1,000 output tokens (the JSON plus low-effort thinking) at $20/M.
 */
const EXPECTED_USD_PER_CHECK = 0.025;

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
  const existing = JSON.parse(readFileSync(resolve(root, RECORDED_PATH), "utf8")) as Record<string, RecordedCardEntry>;
  const plans = await planSeedRecordings(fileReceiptImages(resolve(root, "public")), DEFAULT_MODEL, new Date());
  const todo = plans.filter((plan) => !existing[plan.key]);

  console.log(`Model ${DEFAULT_MODEL}. Seed cards: ${plans.length}; already recorded: ${plans.length - todo.length}.`);
  for (const plan of plans) {
    console.log(`  ${plan.label}: key ${plan.key.slice(0, 12)}… ${existing[plan.key] ? "(recorded)" : "(to record)"}`);
  }
  if (todo.length === 0) return 0;
  const worst = todo.reduce((sum, plan) => sum + plan.worstCaseMicroUsd, 0);
  console.log(
    `Spend estimate: about $${(EXPECTED_USD_PER_CHECK * todo.length).toFixed(2)} ` +
      `(up to twice that if an answer needs its one retry). The site's gate would reserve ${usd(worst)} for these as a loose upper bound.`,
  );
  if (!argv.includes("--yes")) {
    console.log("Nothing spent. Re-run with --yes to make the calls.");
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

  const { entries, results } = await recordSeedCards({ client: createAnthropicClient(apiKey), now: Date.now }, todo, existing);
  writeFileSync(resolve(root, RECORDED_PATH), serializeRecordedCards(entries));
  let total = 0;
  for (const result of results) {
    total += result.costMicroUsd;
    const what = result.outcome === "recorded" ? `recorded, verdict ${result.verdict}` : `FAILED (${result.problem ?? "unknown"})`;
    console.log(`  ${result.label}: ${what}; ${result.attempts} attempt(s), ${usd(result.costMicroUsd)}`);
  }
  console.log(`Total spent: ${usd(total)}. Wrote ${RECORDED_PATH}.`);
  return results.some((result) => result.outcome === "failed") ? 1 : 0;
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
