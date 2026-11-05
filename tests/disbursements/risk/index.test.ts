import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryAiTurnStore } from "@/agents/llm/ai-turn-log";
import type { RiskInput } from "@/ledger/contracts";
import { createRiskAssessor, riskAssessorFromEnv } from "@/disbursements/risk";
import { fileReceiptImages } from "@/disbursements/risk/receipt-images";
import { fakeClient, fakeStream, message, textBlock, usage } from "../../agents/llm/fixtures";
import { sqlite, sqliteD1 } from "../../agents/llm/sqlite-d1";
import { paintAnswer } from "../../agents/treasurer/fixtures";
import { fakeContext, request } from "./fixtures";

const PUBLIC_DIR = fileURLToPath(new URL("../../../public", import.meta.url));
const NOW = new Date("2026-11-05T17:00:00.000Z");
const paint = request({
  payeeId: "treasurer-reimbursement",
  payeeName: "Esther Huang (Treasurer), reimbursement",
  amountCents: 3650,
  description: "Field-paint reimbursement",
  budgetLine: "field-maintenance",
  receiptId: "paint-bluebird-hardware",
  requestedBy: "secretary",
});
const INPUT: RiskInput = { request: paint, sessionRequests: [paint] };
const answerStream = () => fakeStream(message([textBlock(JSON.stringify(paintAnswer()))], "end_turn", { usage: usage({ input_tokens: 2000, output_tokens: 400 }) }));

describe("createRiskAssessor", () => {
  it("gives rules cards from the demo policy by default, and no AI card without AI deps", async () => {
    const assessor = createRiskAssessor();
    expect(assessor.rulesCard(INPUT, NOW)).toMatchObject({ origin: "rules", verdict: "check" });
    await expect(assessor.aiCard(INPUT, "session-a", NOW)).resolves.toBeNull();
  });

  it("uses the same rules context for the rules card and the AI read", async () => {
    const tight = fakeContext({ budgetLines: [{ id: "field-maintenance", label: "Field maintenance", category: "field maintenance", approvedCents: 100 }] });
    const assessor = createRiskAssessor({
      rules: tight,
      ai: {
        images: fileReceiptImages(PUBLIC_DIR),
        recorded: new Map(),
        model: "claude-opus-5-5",
        store: createInMemoryAiTurnStore(),
        live: { client: fakeClient(answerStream()), limits: { totalBudgetMicroUsd: 10_000_000, sessionBudgetMicroUsd: 3_000_000, sessionTurnsPerWindow: 60, windowMs: 60_000 } },
        now: () => NOW.getTime(),
        newId: () => "turn-1",
        log: () => undefined,
      },
    });
    expect(assessor.rulesCard(INPUT, NOW).verdict).toBe("stop");
    const card = await assessor.aiCard(INPUT, "session-a", NOW);
    expect(card).toMatchObject({ origin: "live", verdict: "stop" });
    expect(card?.findings[0]).toMatchObject({ severity: "stop", source: "rule" });
  });
});

describe.skipIf(!sqlite)("riskAssessorFromEnv", () => {
  const ENV = {
    TWOKEY_SESSION_SECRET: "s".repeat(40),
    TWOKEY_SITE_ORIGIN: "https://twokey.example",
    TWOKEY_AI_BUDGET_USD: "10",
    TWOKEY_AI_SESSION_BUDGET_USD: "3",
    TWOKEY_AI_SESSION_TURNS_PER_MINUTE: "60",
  };
  const pngFor = (path: string) => readFileSync(`${PUBLIC_DIR}${path}`);
  const assets = () => ({ fetch: vi.fn(async (req: Request) => new Response(pngFor(new URL(req.url).pathname))) });

  beforeEach(() => {
    // Nothing from the shell may switch the live AI on in a test.
    for (const name of ["ANTHROPIC_API_KEY", "TWOKEY_AI_MODEL", ...Object.keys(ENV)]) vi.stubEnv(name, "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("runs a live read on D1 with the receipt from the ASSETS binding, then replays it when the key is gone", async () => {
    const { db, all } = sqliteD1();
    const ASSETS = assets();
    const client = fakeClient(answerStream());
    const clientFor = vi.fn(() => client);
    const live = riskAssessorFromEnv({ ...ENV, ANTHROPIC_API_KEY: "test-key", ASSETS }, db, { clientFor, log: () => undefined });

    expect(await live.aiCard(INPUT, "session-a", NOW)).toMatchObject({ origin: "live", verdict: "check" });
    expect(clientFor).toHaveBeenCalledWith("test-key");
    expect(new URL(ASSETS.fetch.mock.calls[0]![0].url).pathname).toBe("/receipts/paint-bluebird-hardware.png");
    expect(all("SELECT kind, session_id, outcome, cost_micro_usd FROM ai_turn_events ORDER BY rowid")).toEqual([
      expect.objectContaining({ kind: "reserved", session_id: "session-a" }),
      { kind: "settled", session_id: "session-a", outcome: "complete", cost_micro_usd: 16_000 },
    ]);

    const off = riskAssessorFromEnv({ ...ENV, ASSETS }, db, { clientFor, log: () => undefined });
    expect(await off.aiCard(INPUT, "session-b", NOW)).toMatchObject({ origin: "replay", verdict: "check" });
    expect(clientFor).toHaveBeenCalledTimes(1);
  });

  it("serves no AI card outside development without a D1 binding", async () => {
    const assessor = riskAssessorFromEnv({ ...ENV, ANTHROPIC_API_KEY: "test-key", ASSETS: assets() }, undefined, {
      clientFor: () => {
        throw new Error("must not build a client");
      },
      log: () => undefined,
    });
    await expect(assessor.aiCard(INPUT, "session-a", NOW)).resolves.toBeNull();
  });

  it("keeps the live AI off when the AI config is incomplete, even with a key", async () => {
    const { db } = sqliteD1();
    const clientFor = vi.fn(() => fakeClient());
    const assessor = riskAssessorFromEnv({ ANTHROPIC_API_KEY: "test-key", ASSETS: assets() }, db, { clientFor, log: () => undefined });
    await expect(assessor.aiCard(INPUT, "session-a", NOW)).resolves.toBeNull();
    expect(clientFor).not.toHaveBeenCalled();
  });
});
