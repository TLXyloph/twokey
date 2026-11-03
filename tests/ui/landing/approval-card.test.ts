import { describe, expect, it } from "vitest";
import { riverbend } from "@/demo/riverbend";
import { PAYOUT_ROW_ID, payoutRow } from "@/ui/landing/approval-card";

describe("landing payout slip", () => {
  it("shows a real completed payout from the demo ledger", () => {
    const row = payoutRow();
    expect(row?.id).toBe(PAYOUT_ROW_ID);
    expect(row?.status).toBe("completed");
    expect(row?.direction).toBe("out");
    expect(row?.counterparty).toBe("Riverbend Team Supply");
  });

  it("refuses a row that is pending or money in, so the slip never disagrees with the ledger", () => {
    const pending = riverbend.ledger.map((r) => (r.id === PAYOUT_ROW_ID ? { ...r, status: "pending" as const } : r));
    expect(payoutRow(pending)).toBeUndefined();
  });
});

describe("landing copy stays model-agnostic", () => {
  it("never names a specific AI model or vendor", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const dir = "src/ui/landing";
    const text = readdirSync(dir)
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .map((f) => readFileSync(`${dir}/${f}`, "utf8"))
      .join("\n");
    expect(text).not.toMatch(/\b(claude|anthropic|openai|gpt|gemini)\b/i);
  });
});
