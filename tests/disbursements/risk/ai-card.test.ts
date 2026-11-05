import Anthropic from "@anthropic-ai/sdk";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryAiTurnStore, type AiTurnStore, type InMemoryAiTurnStore } from "@/agents/llm/ai-turn-log";
import { replayKey } from "@/agents/llm/replay-key";
import { worstCaseMicroUsd } from "@/agents/llm/turn-cost";
import { buildTreasurerParams } from "@/agents/treasurer/prompt";
import type { RiskInput } from "@/ledger/contracts";
import { aiReadCard, type AiReadDeps } from "@/disbursements/risk/ai-card";
import { treasurerFacts } from "@/disbursements/risk/card";
import { encodeRiskRecording, type RecordedCard } from "@/disbursements/risk/recorded";
import { fileReceiptImages, loadReceiptImage } from "@/disbursements/risk/receipt-images";
import { RECEIPTS } from "@/disbursements/risk/receipts";
import { buildRulesCard } from "@/disbursements/risk/rules";
import { fakeClient, fakeStream, message, textBlock, thinkingBlock, usage, type FakeClient } from "../../agents/llm/fixtures";
import { paintAnswer } from "../../agents/treasurer/fixtures";
import { fakeContext, request } from "./fixtures";

const PUBLIC_DIR = fileURLToPath(new URL("../../../public", import.meta.url));
const images = fileReceiptImages(PUBLIC_DIR);
const ctx = fakeContext();
const NOW = new Date("2026-11-05T17:00:00.000Z");
const T = NOW.getTime();
const LIMITS = { totalBudgetMicroUsd: 10_000_000, sessionBudgetMicroUsd: 3_000_000, sessionTurnsPerWindow: 60, windowMs: 60_000 };

const paint = request({
  requestId: "req-paint",
  payeeId: "treasurer-reimbursement",
  payeeName: "Esther Huang (Treasurer), reimbursement",
  amountCents: 3650,
  description: "Field-paint reimbursement",
  budgetLine: "field-maintenance",
  receiptId: "paint-bluebird-hardware",
  requestedBy: "secretary",
  createdAt: "2026-11-03T15:00:00.000Z",
});
const INPUT: RiskInput = { request: paint, sessionRequests: [paint] };

const answerMessage = (answer: unknown, over: Parameters<typeof message>[2] = {}) =>
  message([thinkingBlock(), textBlock(JSON.stringify(answer))], "end_turn", { usage: usage({ input_tokens: 2000, output_tokens: 400 }), ...over });

/** The prompt the AI read builds for `input`, and its replay key (composed from the parts). */
async function promptFor(input: RiskInput) {
  const image = await loadReceiptImage(images, RECEIPTS[input.request.receiptId]);
  const params = buildTreasurerParams(treasurerFacts(input, buildRulesCard(input, NOW, ctx), ctx), image, "claude-opus-5-5");
  return { params, key: await replayKey(params) };
}

interface Setup {
  client?: FakeClient;
  store?: AiTurnStore | null;
  live?: boolean;
  limits?: typeof LIMITS;
  recorded?: Map<string, RecordedCard>;
}

function setup(options: Setup = {}) {
  const client = options.client ?? fakeClient();
  const store = options.store === null ? undefined : (options.store ?? createInMemoryAiTurnStore());
  let id = 0;
  let clock = T;
  const log = vi.fn<(line: string) => void>();
  const deps: AiReadDeps = {
    rules: ctx,
    images,
    recorded: options.recorded ?? new Map(),
    model: "claude-opus-5-5",
    store,
    live: options.live === false ? undefined : { client, limits: options.limits ?? LIMITS },
    now: () => (clock += 1000),
    newId: () => `turn-${++id}`,
    log,
  };
  return { deps, client, store: store as InMemoryAiTurnStore | undefined, log };
}

describe("aiReadCard: recorded cards", () => {
  it("serves a recorded card by replay key with no call and no reservation", async () => {
    const { key } = await promptFor(INPUT);
    const recorded = new Map([[key, { model: "claude-opus-5-5", recordedAt: "2026-11-05T09:00:00.000Z", answer: paintAnswer() }]]);
    const { deps, client, store } = setup({ recorded });
    const card = await aiReadCard(deps, INPUT, "session-a", NOW);
    expect(card).toMatchObject({ origin: "recorded", model: "claude-opus-5-5", checkedAt: "2026-11-05T09:00:00.000Z", verdict: "check" });
    expect(card?.findings.map((finding) => finding.source)).toEqual(["rule", "ai"]);
    expect(client.calls).toEqual([]);
    expect(store?.events()).toEqual([]);
  });

  it("finds the same recording from any session: the prompt holds no session or request id", async () => {
    const other: RiskInput = { request: { ...paint, requestId: "req-other", requestHash: "9".repeat(64) }, sessionRequests: [] };
    const otherInput = { ...other, sessionRequests: [other.request] };
    expect((await promptFor(otherInput)).key).toBe((await promptFor(INPUT)).key);
  });
});

describe("aiReadCard: live", () => {
  it("reserves the worst case, calls the model with the receipt, settles the actual cost and records the answer", async () => {
    const client = fakeClient(fakeStream(answerMessage(paintAnswer())));
    const { deps, store } = setup({ client });
    const { params, key } = await promptFor(INPUT);

    const card = await aiReadCard(deps, INPUT, "session-a", NOW);

    expect(card).toMatchObject({ origin: "live", model: "claude-opus-5-5", checkedAt: NOW.toISOString(), verdict: "check", matchesRequest: true });
    expect(card?.receipt?.totalCents).toBe(3650);
    expect(client.calls.map((call) => call.body)).toEqual([params]);
    expect(store?.events()).toEqual([
      expect.objectContaining({ kind: "reserved", turnId: "turn-1", sessionId: "session-a", requestHash: key, costMicroUsd: worstCaseMicroUsd(params) }),
      // 2000 x $4/M + 400 x $20/M = $0.016
      expect.objectContaining({ kind: "settled", turnId: "turn-1", outcome: "complete", costMicroUsd: 16_000 }),
    ]);
    const recording = await store?.recordings.find(key);
    expect(recording).toMatchObject({ turnId: "turn-1", model: "claude-opus-5-5", ndjson: encodeRiskRecording(paintAnswer()) });
  });

  it("retries once on an answer that doesn't validate, with a second reservation", async () => {
    const client = fakeClient(fakeStream(answerMessage({ vendor: "half an answer" })), fakeStream(answerMessage(paintAnswer())));
    const { deps, store } = setup({ client });
    const card = await aiReadCard(deps, INPUT, "session-a", NOW);
    expect(card?.origin).toBe("live");
    expect(client.calls).toHaveLength(2);
    expect(store?.events().map((event) => `${event.kind}:${event.turnId}`)).toEqual(["reserved:turn-1", "settled:turn-1", "reserved:turn-2", "settled:turn-2"]);
    expect(store?.events()[1]).toMatchObject({ outcome: "invalid_shape" });
  });

  it("returns null after two answers that don't validate, recording nothing", async () => {
    const bad = () => fakeStream(message([textBlock("not json")]));
    const { deps, client, store } = setup({ client: fakeClient(bad(), bad()) });
    expect(await aiReadCard(deps, INPUT, "session-a", NOW)).toBeNull();
    expect(client.calls).toHaveLength(2);
    expect(store?.events().filter((event) => event.kind === "replayed")).toEqual([]);
    expect(await store?.recordings.find((await promptFor(INPUT)).key)).toBeUndefined();
  });

  it("logs costs and short ids, never the prompt, the image or the answer", async () => {
    const { deps, log } = setup({ client: fakeClient(fakeStream(answerMessage(paintAnswer()))) });
    await aiReadCard(deps, INPUT, "session-abcdef123", NOW);
    const lines = log.mock.calls.flat().join("\n");
    expect(lines).toMatch(/outcome=live session=session- key=[0-9a-f]{12} attempt=1 turn=turn-1 reserved_usd=\d+\.\d{4} cost_usd=0\.0160/);
    expect(lines).not.toContain("patio");
    expect(lines).not.toContain("iVBOR");
    expect(lines).not.toContain("session-abcdef123");
  });
});

describe("aiReadCard: when the live AI is unavailable", () => {
  async function storeWithRecording() {
    const store = createInMemoryAiTurnStore();
    const { key } = await promptFor(INPUT);
    await store.recordings.save({ requestHash: key, turnId: "old", model: "claude-opus-5-5", recordedAt: Date.parse("2026-11-05T08:00:00Z"), ndjson: encodeRiskRecording(paintAnswer()) });
    return store;
  }

  it("serves the recording for the key when the budget is used up, without calling the model", async () => {
    const store = await storeWithRecording();
    const { deps, client } = setup({ store, limits: { ...LIMITS, totalBudgetMicroUsd: 1 } });
    const card = await aiReadCard(deps, INPUT, "session-a", NOW);
    expect(card).toMatchObject({ origin: "replay", model: "claude-opus-5-5", checkedAt: "2026-11-05T08:00:00.000Z", verdict: "check" });
    expect(client.calls).toEqual([]);
    expect(store.events()).toEqual([expect.objectContaining({ kind: "replayed", outcome: "hit", sessionId: "session-a" })]);
  });

  it("serves the recording when the session's rate is used up", async () => {
    const store = await storeWithRecording();
    const { deps, client } = setup({ store, limits: { ...LIMITS, sessionTurnsPerWindow: 0 } });
    expect((await aiReadCard(deps, INPUT, "session-a", NOW))?.origin).toBe("replay");
    expect(client.calls).toEqual([]);
  });

  it("serves the recording when the live AI is off (no API key)", async () => {
    const store = await storeWithRecording();
    const { deps } = setup({ store, live: false });
    expect((await aiReadCard(deps, INPUT, "session-a", NOW))?.origin).toBe("replay");
  });

  it("settles a failed call (Anthropic rate limiting) and falls back to the recording", async () => {
    const store = await storeWithRecording();
    const error = new Anthropic.RateLimitError(429, undefined, "rate limited", new Headers());
    const client = fakeClient(() => {
      throw error;
    });
    const { deps } = setup({ store, client });
    expect((await aiReadCard(deps, INPUT, "session-a", NOW))?.origin).toBe("replay");
    expect(client.calls).toHaveLength(1);
    expect(store.events().map((event) => event.kind)).toEqual(["reserved", "settled", "replayed"]);
    expect(store.events()[1]).toMatchObject({ outcome: "upstream_rate_limited", costMicroUsd: 0 });
  });

  it("doesn't retry a refusal; it falls back to the recordings", async () => {
    const { deps, client, store } = setup({ client: fakeClient(fakeStream(message([textBlock("")], "refusal"))) });
    expect(await aiReadCard(deps, INPUT, "session-a", NOW)).toBeNull();
    expect(client.calls).toHaveLength(1);
    expect(store?.events().at(-1)).toMatchObject({ kind: "replayed", outcome: "miss" });
  });

  it("returns null when nothing is recorded, noting the miss", async () => {
    const { deps, store } = setup({ live: false });
    expect(await aiReadCard(deps, INPUT, "session-a", NOW)).toBeNull();
    expect(store?.events()).toEqual([expect.objectContaining({ kind: "replayed", outcome: "miss" })]);
  });

  it("returns null without a turn store, and without calling the model", async () => {
    const { deps, client } = setup({ store: null });
    expect(await aiReadCard(deps, INPUT, "session-a", NOW)).toBeNull();
    expect(client.calls).toEqual([]);
  });

  it("returns null when the turn store fails", async () => {
    const store = createInMemoryAiTurnStore();
    vi.spyOn(store.turnLog, "reserve").mockRejectedValue(new Error("D1 down"));
    const { deps, client, log } = setup({ store });
    expect(await aiReadCard(deps, INPUT, "session-a", NOW)).toBeNull();
    expect(client.calls).toEqual([]);
    expect(log.mock.calls.flat().join("\n")).toContain("outcome=store_error");
  });
});

describe("aiReadCard: the receipt image", () => {
  it("returns null, calling nothing, when the image can't be read or doesn't match its hash", async () => {
    const { deps, client, store } = setup();
    const broken = { ...deps, images: { read: async () => new Uint8Array([1, 2, 3]) } };
    expect(await aiReadCard(broken, INPUT, "session-a", NOW)).toBeNull();
    expect(client.calls).toEqual([]);
    expect(store?.events()).toEqual([]);
  });
});
