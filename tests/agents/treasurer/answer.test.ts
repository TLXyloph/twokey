import { describe, expect, it } from "vitest";
import { parseAnswer, parseAnswerJson, TREASURER_ANSWER_JSON_SCHEMA, treasurerAnswerSchema } from "@/agents/treasurer/answer";
import { message, textBlock, thinkingBlock } from "../llm/fixtures";
import { paintAnswer } from "./fixtures";

const answerMessage = (json: unknown) => message([thinkingBlock(), textBlock(typeof json === "string" ? json : JSON.stringify(json))]);

describe("the answer's JSON schema", () => {
  it("lists exactly the zod schema's fields, all required, with no extra properties", () => {
    const zodKeys = Object.keys(treasurerAnswerSchema.shape).sort();
    expect(Object.keys(TREASURER_ANSWER_JSON_SCHEMA.properties).sort()).toEqual(zodKeys);
    expect([...TREASURER_ANSWER_JSON_SCHEMA.required].sort()).toEqual(zodKeys);
    expect(TREASURER_ANSWER_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(TREASURER_ANSWER_JSON_SCHEMA.properties.items.items.additionalProperties).toBe(false);
    expect(TREASURER_ANSWER_JSON_SCHEMA.properties.findings.items.additionalProperties).toBe(false);
  });

  it("uses no constraint that structured outputs doesn't support", () => {
    const text = JSON.stringify(TREASURER_ANSWER_JSON_SCHEMA);
    for (const unsupported of ["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems", "pattern"]) {
      expect(text).not.toContain(`"${unsupported}"`);
    }
  });
});

describe("parseAnswer", () => {
  it("reads the JSON from the text blocks and ignores thinking blocks", () => {
    expect(parseAnswer(answerMessage(paintAnswer()))).toEqual({ ok: true, answer: paintAnswer() });
  });

  it("accepts nulls for what the receipt doesn't show, and no findings", () => {
    const blank = paintAnswer({ vendor: null, date: null, items: [], totalCents: null, findings: [], verdict: "clear" });
    expect(parseAnswer(answerMessage(blank))).toEqual({ ok: true, answer: blank });
  });

  it("refuses text that isn't JSON", () => {
    expect(parseAnswer(answerMessage("Sure! Here is the JSON:"))).toEqual({ ok: false, problem: "invalid_json" });
    expect(parseAnswer(message([thinkingBlock()]))).toEqual({ ok: false, problem: "no_text" });
  });

  it.each([
    ["an amount in dollars, not cents", { totalCents: 36.5 }],
    ["an unknown verdict", { verdict: "maybe" }],
    ["a date in another format", { date: "11/02/2026" }],
    ["a summary over 25 words", { summary: Array.from({ length: 26 }, () => "word").join(" ") }],
    ["an empty finding", { findings: [{ severity: "warn", text: "", evidence: "x" }] }],
    ["too many findings", { findings: Array.from({ length: 7 }, () => ({ severity: "info", text: "t", evidence: "e" })) }],
    ["an extra field", { confidence: 0.9 }],
  ])("refuses %s", (_label, change) => {
    expect(parseAnswer(answerMessage({ ...paintAnswer(), ...change }))).toEqual({ ok: false, problem: "invalid_shape" });
  });

  it("reports a refusal or a cut-off answer instead of parsing it", () => {
    expect(parseAnswer(message([textBlock("{")], "refusal"))).toEqual({ ok: false, problem: "refusal" });
    expect(parseAnswer(message([textBlock('{"vendor":')], "max_tokens"))).toEqual({ ok: false, problem: "max_tokens" });
  });

  it("validates stored JSON the same way", () => {
    expect(parseAnswerJson(paintAnswer())).toEqual({ ok: true, answer: paintAnswer() });
    expect(parseAnswerJson({ vendor: "x" })).toEqual({ ok: false, problem: "invalid_shape" });
  });
});
