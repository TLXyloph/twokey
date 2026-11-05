import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as content from "@/ui/pay/content";
import { clampQuantity, formatDollars, isJudgeMode, ticketsLabel } from "@/ui/pay/pay-model";

const PAY_UI = join(__dirname, "../../../src/ui/pay");
const PAY_ROUTE = join(__dirname, "../../../src/app/demo/pay");

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

describe("the pay page's words", () => {
  it("never names an AI vendor or model, in the copy or in the page's source", () => {
    const sources = [...filesUnder(PAY_UI), ...filesUnder(PAY_ROUTE)].map((file) => readFileSync(file, "utf8"));
    const vendor = /\b(claude|anthropic|openai|chatgpt|gpt-\d|gemini|opus|sonnet|haiku|llm)\b/i;
    expect(JSON.stringify(content)).not.toMatch(vendor);
    for (const source of sources) expect(source).not.toMatch(vendor);
  });

  it("labels the test login as a PayPal sandbox login, not a real account", () => {
    expect(content.TEST_BUYER.heading).toMatch(/sandbox test buyer/i);
    expect(content.TEST_BUYER.note).toMatch(/PayPal sandbox test login, not a real account/);
  });

  it("keeps headings short enough for two lines at every width", () => {
    const headings = [content.EVENING_HEADING, content.LETTER.heading, content.FOOTER.signOff, content.TICKET.paidHeading];
    for (const heading of headings) expect(heading.length).toBeLessThanOrEqual(32);
    for (const moment of content.MOMENTS) expect(moment.title.length).toBeLessThanOrEqual(24);
  });

  it("says plainly that the club is demo data and the payments are sandbox test money", () => {
    expect(content.FOOTER.imprint).toMatch(/fictional/);
    expect(content.FOOTER.imprint).toMatch(/sandbox/);
  });

  it("captions every picture as what it is and gives it alt text", () => {
    for (const { picture } of content.MOMENTS) {
      expect(picture.caption.length).toBeGreaterThan(10);
      expect(picture.alt.length).toBeGreaterThan(10);
      expect(picture.src).toMatch(/^\/(pay|landing)\/img\/[a-z0-9-]+\.jpg$/);
    }
  });
});

describe("pay-model", () => {
  it("formats cents as dollars without trailing zeros on whole amounts", () => {
    expect(formatDollars(1_500)).toBe("$15");
    expect(formatDollars(6_000)).toBe("$60");
    expect(formatDollars(1_550)).toBe("$15.50");
    expect(formatDollars(5)).toBe("$0.05");
  });

  it("counts tickets in words", () => {
    expect(ticketsLabel(1)).toBe("1 ticket");
    expect(ticketsLabel(3)).toBe("3 tickets");
  });

  it("clamps a quantity to the event's range", () => {
    expect(clampQuantity(0, 1, 4)).toBe(1);
    expect(clampQuantity(9, 1, 4)).toBe(4);
    expect(clampQuantity(2.4, 1, 4)).toBe(2);
    expect(clampQuantity(Number.NaN, 1, 4)).toBe(1);
  });

  it("is in judge mode only with ?judge=1", () => {
    expect(isJudgeMode({ judge: "1" })).toBe(true);
    expect(isJudgeMode({ judge: ["0", "1"] })).toBe(true);
    expect(isJudgeMode({})).toBe(false);
    expect(isJudgeMode({ judge: "true" })).toBe(false);
  });
});
