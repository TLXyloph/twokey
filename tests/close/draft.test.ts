import { describe, expect, it } from "vitest";
import { CLOSE_DRAFT_JSON_SCHEMA, closeDraftSchema, parseDraftJson, parseDraftMessage, recordedDraftFor, serializeRecordedDraft } from "@/close/draft";
import { buildCloseDraftParams, CLOSE_DRAFT_SYSTEM_PROMPT, closeFactsText, DRAFT_EFFORT, shortDate } from "@/close/draft-prompt";
import { planCloseDraft, recordCloseDraft } from "@/close/draft-recording";
import { closeHash, octoberClose } from "@/close/october";
import committed from "@/close/recorded-draft.json";
import { readEnvValue } from "../../scripts/record-close-draft";
import { fakeClient, fakeStream, message, textBlock, usage } from "../agents/llm/fixtures";
import { sampleDraft } from "./fixtures";

const HASH = "e".repeat(64);
const entry = (draft: unknown = sampleDraft()) => ({ month: "2026-10", model: "claude-opus-5-5", recordedAt: "2026-11-05T20:00:00.000Z", costUsd: 0.03, draft });

describe("the draft's shape", () => {
  it("accepts a summary of at most 120 words and 2 to 4 points", () => {
    expect(parseDraftJson(sampleDraft()).ok).toBe(true);
    expect(parseDraftJson(sampleDraft({ summary: Array.from({ length: 121 }, () => "word").join(" ") })).ok).toBe(false);
    expect(parseDraftJson(sampleDraft({ points: sampleDraft().points.slice(0, 1) })).ok).toBe(false);
    const five = Array.from({ length: 5 }, () => sampleDraft().points[0]!);
    expect(parseDraftJson(sampleDraft({ points: five })).ok).toBe(false);
    expect(parseDraftJson({ ...sampleDraft(), extra: 1 }).ok).toBe(false);
  });

  it("asks for the same fields in the JSON schema as the zod schema validates", () => {
    expect([...CLOSE_DRAFT_JSON_SCHEMA.required].sort()).toEqual(Object.keys(closeDraftSchema.shape).sort());
    expect([...CLOSE_DRAFT_JSON_SCHEMA.properties.points.items.required].sort()).toEqual(["basis", "check"]);
  });

  it("reads a final message, and names what went wrong otherwise", () => {
    expect(parseDraftMessage(message([textBlock(JSON.stringify(sampleDraft()))]))).toEqual({ ok: true, draft: sampleDraft() });
    expect(parseDraftMessage(message([textBlock("{}")], "refusal"))).toEqual({ ok: false, problem: "refusal" });
    expect(parseDraftMessage(message([textBlock("{")], "max_tokens"))).toEqual({ ok: false, problem: "max_tokens" });
    expect(parseDraftMessage(message([]))).toEqual({ ok: false, problem: "no_text" });
    expect(parseDraftMessage(message([textBlock("not json")]))).toEqual({ ok: false, problem: "invalid_json" });
    expect(parseDraftMessage(message([textBlock("{}")]))).toEqual({ ok: false, problem: "invalid_shape" });
  });
});

describe("the recorded draft", () => {
  it("is committed as 'not recorded yet'", async () => {
    expect(committed).toEqual({});
    expect(recordedDraftFor(committed, await closeHash(octoberClose()))).toEqual({ state: "not_recorded" });
  });

  it("is served for its own close hash, without the model's name", () => {
    const view = recordedDraftFor({ [HASH]: entry() }, HASH);
    expect(view).toEqual({ state: "recorded", recordedAt: "2026-11-05T20:00:00.000Z", draft: sampleDraft() });
    expect(JSON.stringify(view)).not.toContain("claude");
  });

  it("is never shown against other figures, and an invalid entry reads as not recorded", () => {
    const lines: string[] = [];
    expect(recordedDraftFor({ ["f".repeat(64)]: entry() }, HASH, (line) => lines.push(line))).toEqual({ state: "not_recorded" });
    expect(recordedDraftFor({ [HASH]: entry({ summary: "" }) }, HASH, (line) => lines.push(line))).toEqual({ state: "not_recorded" });
    expect(recordedDraftFor({ [HASH]: { ...entry(), extra: true } }, HASH, (line) => lines.push(line))).toEqual({ state: "not_recorded" });
    expect(recordedDraftFor([], HASH)).toEqual({ state: "not_recorded" });
    expect(lines).toEqual(["[close/draft] recorded=stale", "[close/draft] recorded=invalid", "[close/draft] recorded=invalid"]);
  });

  it("serializes with sorted keys and a trailing newline", () => {
    const text = serializeRecordedDraft({ [HASH]: entry(), ["0".repeat(64)]: entry() });
    expect(text.endsWith("}\n")).toBe(true);
    expect(Object.keys(JSON.parse(text))).toEqual(["0".repeat(64), HASH]);
  });
});

describe("the draft's prompt", () => {
  const figures = octoberClose();
  const facts = closeFactsText(figures);

  it("states the month from the computed figures", () => {
    expect(facts).toContain("Club: Riverbend Youth Football League (demo data).");
    expect(facts).toContain("- Opening balance, Oct 1: $2,549.00");
    expect(facts).toContain("- Money in: $4,175.00 (4 deposits)");
    expect(facts).toContain("- Money out: $2,355.25 (7 payments)");
    expect(facts).toContain("- Closing balance, Oct 31: $4,368.75");
    expect(facts).toContain("$4,368.75 plus $630.00 of completed rows after the month = $4,998.75; the account balance recorded on Nov 3 is $4,998.75. They agree.");
    expect(facts).toContain("- Fundraising costs: $948.75 paid of $1,000.00 approved; $51.25 left.");
    expect(facts).toContain("- Field maintenance: nothing paid of $150.00 approved; $150.00 left.");
    expect(facts).toContain("- Car wash, Oct 24: 87 cars logged at $15.00 = $1,305.00 expected; $15.00 received; $1,290.00 has no record.");
    expect(facts).toContain("- Two keys: 7 of 7 payments out count as approved by two officers: 7 are demo data, taken as approved because the demo data holds no signatures.");
    expect(facts).toMatch(/Exceptions found by code:\n- Car wash, Oct 24: [^\n]*\n\nWrite the draft/);
    expect(facts).not.toContain("No two-key record");
    expect(facts).toMatch(/Open items at Oct 31 \(payouts waiting for a second key\):\n- None\./);
  });

  it("names a payout without two keys as an exception", () => {
    const unsigned = { ...figures, twoKeyRecord: { payments: 7, signed: 0, seedApproved: 6 }, exceptions: [...figures.exceptions, { kind: "no_two_key_record" as const, count: 1, totalCents: 41_250, rowIds: ["L03"], firstSignedRequestDate: "2026-11-02" }] };
    const text = closeFactsText(unsigned);
    expect(text).toContain("- Two keys: 6 of 7 payments out count as approved by two officers: 6 are demo data, taken as approved because the demo data holds no signatures.");
    expect(text).toContain("- No two-key record: 1 payment out ($412.50) has no two officers' signatures on record. TwoKey's first signed payout request is dated Nov 2.");
  });

  it("holds no session id, request hash, email or clock time, and is the same every time", () => {
    expect(facts).not.toMatch(/session|@|[0-9a-f]{32}|T\d\d:\d\d/);
    expect(closeFactsText(octoberClose())).toBe(facts);
  });

  it("fixes the provider parameters: structured JSON, explicit effort, server-side refusal fallback", () => {
    const params = buildCloseDraftParams(figures, "claude-opus-5-5");
    expect(params).toMatchObject({
      model: "claude-opus-5-5",
      output_config: { effort: DRAFT_EFFORT, format: { type: "json_schema", schema: CLOSE_DRAFT_JSON_SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: CLOSE_DRAFT_SYSTEM_PROMPT }],
    });
    expect(DRAFT_EFFORT).toBe("medium");
    expect(params).not.toHaveProperty("thinking");
    expect(CLOSE_DRAFT_SYSTEM_PROMPT).toContain("You never sign, approve or close the month.");
  });

  it("formats dates without the locale", () => {
    expect(shortDate("2026-10-01")).toBe("Oct 1");
    expect(shortDate("2026-11-02")).toBe("Nov 2");
  });
});

describe("recording the draft", () => {
  const draftStream = (draft: unknown, stop: "end_turn" | "refusal" = "end_turn") =>
    fakeStream(message([textBlock(JSON.stringify(draft))], stop, { usage: usage({ input_tokens: 1700, output_tokens: 900 }) }));

  it("plans the call from the figures, keyed by the close hash, with no network", async () => {
    const plan = await planCloseDraft(octoberClose(), "claude-opus-5-5");
    expect(plan.closeHash).toBe(await closeHash(octoberClose()));
    expect(plan.month).toBe("2026-10");
    expect(plan.worstCaseMicroUsd).toBeGreaterThan(0);
  });

  it("records a valid draft with its cost", async () => {
    const plan = await planCloseDraft(octoberClose(), "claude-opus-5-5");
    const client = fakeClient(draftStream(sampleDraft()));
    const result = await recordCloseDraft({ client, now: () => Date.parse("2026-11-05T20:00:00.000Z") }, plan);
    expect(result).toMatchObject({ outcome: "recorded", attempts: 1, costMicroUsd: 24_800 });
    expect(result.entry).toEqual({ month: "2026-10", model: "claude-opus-5-5", recordedAt: "2026-11-05T20:00:00.000Z", costUsd: 0.0248, draft: sampleDraft() });
    expect(client.calls[0]?.body).toBe(plan.params);
    expect(recordedDraftFor({ [plan.closeHash]: result.entry }, plan.closeHash).state).toBe("recorded");
  });

  it("retries an invalid answer once, never a refusal", async () => {
    const plan = await planCloseDraft(octoberClose(), "claude-opus-5-5");
    const retried = await recordCloseDraft({ client: fakeClient(draftStream({}), draftStream(sampleDraft())), now: Date.now }, plan);
    expect(retried).toMatchObject({ outcome: "recorded", attempts: 2 });
    const refused = await recordCloseDraft({ client: fakeClient(draftStream(sampleDraft(), "refusal")), now: Date.now }, plan);
    expect(refused).toMatchObject({ outcome: "failed", problem: "refusal", attempts: 1 });
    const twiceBad = await recordCloseDraft({ client: fakeClient(draftStream({}), draftStream({})), now: Date.now }, plan);
    expect(twiceBad).toMatchObject({ outcome: "failed", problem: "invalid_shape", attempts: 2 });
  });

  it("reads the key from .env text without echoing it", () => {
    expect(readEnvValue("A=1\nexport ANTHROPIC_API_KEY='k-test'\n", "ANTHROPIC_API_KEY")).toBe("k-test");
    expect(readEnvValue("A=1\n", "ANTHROPIC_API_KEY")).toBeUndefined();
  });
});
