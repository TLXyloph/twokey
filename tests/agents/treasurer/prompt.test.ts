import { describe, expect, it } from "vitest";
import { replayKey } from "@/agents/llm/replay-key";
import { FALLBACK_BETA } from "@/agents/llm/translate-request";
import { TREASURER_ANSWER_JSON_SCHEMA } from "@/agents/treasurer/answer";
import { buildTreasurerParams, requestText, TREASURER_SYSTEM_PROMPT } from "@/agents/treasurer/prompt";
import { paintFacts } from "./fixtures";

const image = { mediaType: "image/png" as const, base64: "iVBORw0KGgo=" };

describe("buildTreasurerParams", () => {
  it("fixes the provider parameters: model from config, low effort, JSON output, server-side fallback, no tools", () => {
    const params = buildTreasurerParams(paintFacts(), image, "claude-opus-5-5");
    expect(params).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 4096,
      output_config: { effort: "low", format: { type: "json_schema", schema: TREASURER_ANSWER_JSON_SCHEMA } },
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      system: [{ type: "text", text: TREASURER_SYSTEM_PROMPT }],
    });
    expect(params.tools).toBeUndefined();
    expect(params.tool_choice).toBeUndefined();
    expect(params.thinking).toBeUndefined();
  });

  it("sends one user message: the receipt image first, then the request as text", () => {
    const params = buildTreasurerParams(paintFacts(), image, "claude-opus-5-5");
    expect(params.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } },
          { type: "text", text: requestText(paintFacts()) },
        ],
      },
    ]);
  });

  it("gives the same replay key for the same facts and image, and a different one when either changes", async () => {
    const key = await replayKey(buildTreasurerParams(paintFacts(), image, "claude-opus-5-5"));
    expect(await replayKey(buildTreasurerParams(paintFacts(), image, "claude-opus-5-5"))).toBe(key);
    expect(await replayKey(buildTreasurerParams(paintFacts({ amountCents: 3651 }), image, "claude-opus-5-5"))).not.toBe(key);
    expect(await replayKey(buildTreasurerParams(paintFacts(), { ...image, base64: "AAAA" }, "claude-opus-5-5"))).not.toBe(key);
  });
});

describe("requestText", () => {
  it("states every request fact, the officers on file and the rule results in plain words", () => {
    const text = requestText(paintFacts());
    expect(text).toContain("Payee: Esther Huang (Treasurer), reimbursement (an officer: the Treasurer)");
    expect(text).toContain("Amount asked for: $36.50");
    expect(text).toContain("Description: Field-paint reimbursement");
    expect(text).toContain("Budget line: Field maintenance ($150.00 approved for the season; $150.00 left before this request)");
    expect(text).toContain("Requested by: the Secretary");
    expect(text).toContain("Requested on: Tuesday, November 3, 2026 (club time)");
    expect(text).toContain("- President: Marcus Bell, 48 Cedar Hollow Ln, Riverbend");
    expect(text).toContain("- warn: This pays an officer, the Treasurer. (Payee: Esther Huang (Treasurer), reimbursement)");
    expect(text).toContain("Rule verdict: check");
  });

  it("says so when the rules found nothing, the payee isn't an officer, or the line isn't budgeted", () => {
    const text = requestText(paintFacts({ ruleFindings: [], ruleVerdict: "clear", payeeName: "Riverbend Team Supply", payeeOfficerTitle: null, budgetLine: null }));
    expect(text).toContain("Payee: Riverbend Team Supply\n");
    expect(text).toContain("Budget line: not in the club's budget");
    expect(text).toContain("Rule checks already run by code:\n- none\nRule verdict: clear");
  });
});

describe("the system prompt", () => {
  it("keeps the AI advisory, plain-spoken, in cents and in the club's time zone", () => {
    expect(TREASURER_SYSTEM_PROMPT).toMatch(/never approve, sign or block/);
    expect(TREASURER_SYSTEM_PROMPT).toMatch(/No jargon/);
    expect(TREASURER_SYSTEM_PROMPT).toMatch(/whole cents: \$12\.00 is 1200/);
    expect(TREASURER_SYSTEM_PROMPT).toMatch(/America\/Chicago/);
    expect(TREASURER_SYSTEM_PROMPT).toMatch(/at least as strict as the rule checks/);
  });
});
