import { describe, expect, it } from "vitest";
import { CASES, FAQS, STAGES, stageShares } from "@/ui/landing/content";

describe("stageShares", () => {
  it("gives short stages the floor and splits the rest by real length", () => {
    expect(stageShares([120, 6 * 3600, 17, 2 * 3600])).toEqual([15, 52.5, 15, 17.5]);
  });

  it("always sums to 100", () => {
    for (const input of [[1, 1], [5, 100, 1000], STAGES.map((s) => s.seconds)]) {
      const total = stageShares(input).reduce((a, b) => a + b, 0);
      expect(Math.round(total * 10) / 10).toBe(100);
    }
  });

  it("is plainly proportional when every stage clears the floor", () => {
    expect(stageShares([1, 1, 2], 10)).toEqual([25, 25, 50]);
  });
});

describe("copy deck", () => {
  it("has six cases with sources and no people's names beyond roles", () => {
    expect(CASES.map((c) => c.place)).toEqual(["South Fayette", "Sarasota", "DeKalb County", "Ellsworth", "Hempfield", "Colorado Springs"]);
    for (const c of CASES) expect(c.source.href).toMatch(/^https:\/\//);
  });

  it("has six honest questions", () => {
    expect(FAQS).toHaveLength(6);
  });
});
