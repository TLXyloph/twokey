import { describe, expect, it } from "vitest";
import { EXPLANATIONS, explanationFor } from "@/watchtower/explanations";

describe("explanationFor", () => {
  it("explains the two setup-test payouts by their transaction ids", () => {
    for (const id of ["3XT37311AK7894010", "23Y96953CP0068646"]) {
      expect(explanationFor(id, "item-1")).toBe(
        "TwoKey's setup test, Nov 2–3: a $1 payout sent by a developer script with the app's own credentials, before the two-key flow existed.",
      );
    }
  });

  it("explains the local test payout by its custom_field, whatever its transaction id", () => {
    expect(explanationFor("9K2669282J012372J", "eedb2122-9cd6-4fa4-8ef0-8ca52e4eab15")).toBe(
      "TwoKey's local test, Nov 5: signed by two demo keys on a developer's machine, so it isn't in the hosted ledger.",
    );
    expect(explanationFor("ANY-OTHER-ID", "eedb2122-9cd6-4fa4-8ef0-8ca52e4eab15")).not.toBeNull();
  });

  it("leaves the two real outside website sends open", () => {
    expect(explanationFor("22N17109956532336", null)).toBeNull();
    expect(explanationFor("1TY14748YE721631B", null)).toBeNull();
  });

  it("doesn't explain a payout just because it reuses a generic custom_field", () => {
    expect(explanationFor("SOME-NEW-PAYOUT", "item-1")).toBeNull();
  });

  it("keys every entry by a transaction id or a custom_field, with a note", () => {
    for (const entry of EXPLANATIONS) {
      expect(Boolean(entry.transactionId) !== Boolean(entry.customField)).toBe(true);
      expect(entry.note.length).toBeGreaterThan(20);
    }
  });
});
