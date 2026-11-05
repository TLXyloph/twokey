import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createInMemoryAiTurnStore } from "@/agents/llm/ai-turn-log";
import { createRiskAssessor } from "@/disbursements/risk";
import { loadRecordedCards } from "@/disbursements/risk/recorded";
import { fileReceiptImages } from "@/disbursements/risk/receipt-images";
import { planSeedRecordings, recordSeedCards, serializeRecordedCards } from "@/disbursements/risk/seed-recording";
import { SEED_RISK_REQUESTS, SEED_SESSION_REQUESTS } from "@/disbursements/risk/seed-requests";
import { readEnvValue } from "../../../scripts/record-seed-risk-cards";
import { fakeClient, fakeStream, message, textBlock, usage } from "../../agents/llm/fixtures";
import { paintAnswer } from "../../agents/treasurer/fixtures";

const images = fileReceiptImages(fileURLToPath(new URL("../../../public", import.meta.url)));
const NOW = new Date("2026-11-05T20:00:00.000Z");
const answerStream = (answer: unknown) =>
  fakeStream(message([textBlock(JSON.stringify(answer))], "end_turn", { usage: usage({ input_tokens: 2400, output_tokens: 500 }) }));
const glovesAnswer = paintAnswer({
  vendor: "Riverbend Team Supply",
  date: "2026-11-01",
  items: [{ description: "Goalkeeper gloves sz 8, 2 at $21.00", amountCents: 4200 }],
  totalCents: 4200,
  findings: [],
  verdict: "clear",
  summary: "The receipt matches: two pairs of goalkeeper gloves for $42.00.",
});

describe("recording the seed cards", () => {
  it("plans both seed checks with distinct replay keys, without any network", async () => {
    const plans = await planSeedRecordings(images, "claude-opus-5-5", NOW);
    expect(plans.map((plan) => plan.label)).toEqual(SEED_RISK_REQUESTS.map((seed) => seed.label));
    expect(new Set(plans.map((plan) => plan.key)).size).toBe(2);
    for (const plan of plans) expect(plan.worstCaseMicroUsd).toBeGreaterThan(0);
  });

  it("writes cards that the site then serves as recorded, with no call and no reservation", async () => {
    const plans = await planSeedRecordings(images, "claude-opus-5-5", NOW);
    const client = fakeClient(answerStream(glovesAnswer), answerStream(paintAnswer()));
    const { entries, results } = await recordSeedCards({ client, now: () => NOW.getTime() }, plans, {});
    expect(results.map((result) => [result.outcome, result.verdict, result.costMicroUsd])).toEqual([
      ["recorded", "clear", 19_600],
      ["recorded", "check", 19_600],
    ]);

    const recorded = loadRecordedCards(JSON.parse(serializeRecordedCards(entries)));
    expect(recorded.size).toBe(2);
    const store = createInMemoryAiTurnStore();
    const unusedClient = fakeClient();
    const assessor = createRiskAssessor({
      ai: {
        images,
        recorded,
        model: "claude-opus-5-5",
        store,
        live: { client: unusedClient, limits: { totalBudgetMicroUsd: 10_000_000, sessionBudgetMicroUsd: 3_000_000, sessionTurnsPerWindow: 60, windowMs: 60_000 } },
        now: () => NOW.getTime(),
        newId: () => "turn-x",
        log: () => undefined,
      },
    });
    // A real session gives the seeds its own ids and hashes; the prompt, and so the key, ignores them.
    const sessionRequests = SEED_SESSION_REQUESTS.map((seed) => ({ ...seed, requestId: `own-${seed.requestId}`, requestHash: "7".repeat(64) }));
    const [gloves, paint] = await Promise.all(
      sessionRequests.map((request) => assessor.aiCard({ request, sessionRequests }, "any-session", new Date())),
    );
    expect(gloves).toMatchObject({ origin: "recorded", verdict: "clear", checkedAt: NOW.toISOString() });
    expect(paint).toMatchObject({ origin: "recorded", verdict: "check" });
    expect(unusedClient.calls).toEqual([]);
    expect(store.events()).toEqual([]);
  });

  it("skips cards already recorded, and reports a card whose answers never validate", async () => {
    const plans = await planSeedRecordings(images, "claude-opus-5-5", NOW);
    const existing = { [plans[0]!.key]: { label: "x", model: "m", recordedAt: NOW.toISOString(), costUsd: 0, answer: glovesAnswer } };
    const bad = () => fakeStream(message([textBlock("nope")]));
    const client = fakeClient(bad(), bad());
    const { entries, results } = await recordSeedCards({ client, now: () => NOW.getTime() }, plans, existing);
    expect(results.map((result) => [result.outcome, result.attempts, result.problem])).toEqual([
      ["already_recorded", 0, undefined],
      ["failed", 2, "invalid_json"],
    ]);
    expect(Object.keys(entries)).toEqual([plans[0]!.key]);
  });

  it("serializes with sorted keys and a trailing newline", () => {
    const entry = { label: "x", model: "m", recordedAt: NOW.toISOString(), costUsd: 0, answer: {} };
    const text = serializeRecordedCards({ b: entry, a: entry });
    expect(Object.keys(JSON.parse(text))).toEqual(["a", "b"]);
    expect(text.endsWith("}\n")).toBe(true);
  });
});

describe("readEnvValue (the record script's .env reader)", () => {
  it("reads NAME=value lines, with optional export and quotes", () => {
    const text = ["# comment", "OTHER=1", 'export WANTED="abc def"', "LATER=2"].join("\n");
    expect(readEnvValue(text, "WANTED")).toBe("abc def");
    expect(readEnvValue("WANTED='x'\n", "WANTED")).toBe("x");
    expect(readEnvValue("WANTED=plain\r\n", "WANTED")).toBe("plain");
  });

  it("returns undefined when the name is missing or empty", () => {
    expect(readEnvValue("A=1\n", "WANTED")).toBeUndefined();
    expect(readEnvValue("WANTED=\n", "WANTED")).toBeUndefined();
    expect(readEnvValue("NOT_WANTED=1\n", "WANTED")).toBeUndefined();
  });
});
