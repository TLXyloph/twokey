import { describe, expect, it } from "vitest";
import { capWords, clubDate, formatUsd, wordCount } from "@/disbursements/risk/format";

describe("formatUsd", () => {
  it.each([
    [0, "$0.00"],
    [5, "$0.05"],
    [3650, "$36.50"],
    [4200, "$42.00"],
    [123_456_789, "$1,234,567.89"],
    [-1250, "-$12.50"],
  ])("%i cents reads %s", (cents, text) => {
    expect(formatUsd(cents)).toBe(text);
  });
});

describe("clubDate", () => {
  it("gives the calendar date in the club's time zone (America/Chicago), not UTC", () => {
    // 03:30 UTC on Nov 3 is still the evening of Nov 2 in Chicago (CST, UTC-6).
    expect(clubDate("2026-11-03T03:30:00.000Z")).toEqual({ iso: "2026-11-02", long: "Monday, November 2, 2026", short: "Nov 2" });
    expect(clubDate("2026-11-03T15:00:00Z")).toEqual({ iso: "2026-11-03", long: "Tuesday, November 3, 2026", short: "Nov 3" });
  });

  it("handles daylight saving time (CDT, UTC-5) in October", () => {
    expect(clubDate("2026-10-01T04:59:00Z").iso).toBe("2026-09-30");
    expect(clubDate("2026-10-01T05:00:00Z").iso).toBe("2026-10-01");
  });

  it("returns null for a timestamp it can't read", () => {
    expect(clubDate("not a date")).toBeNull();
  });
});

describe("words", () => {
  it("counts words separated by any whitespace", () => {
    expect(wordCount("  one two\nthree  ")).toBe(3);
    expect(wordCount("")).toBe(0);
  });

  it("caps text at n words, ending it with a full stop", () => {
    expect(capWords("a b c d e", 3)).toBe("a b c.");
    expect(capWords("a b c;", 3)).toBe("a b c;");
    expect(capWords("short one.", 25)).toBe("short one.");
  });
});
