import { describe, expect, it } from "vitest";
import demoPublicKeys from "@/disbursements/demo-public-keys.json";
import { KEY_STEPS, STEP_COUNT } from "@/ui/keys/keys-content";
import { clampSteps, keysPanel, lastSignature } from "@/ui/keys/keys-model";
import { fixtureBoardView } from "@/ui/judge/dev/board-view-fixture";

const now = new Date("2026-11-05T17:00:00Z");
const accessOf = (done: number, role: string) => keysPanel(done, null, now).holders.find((h) => h.role === role)!.access.map((a) => `${a.tone}: ${a.text}`);
const factOf = (done: number, id: string) => keysPanel(done, null, now).facts.find((f) => f.id === id)!.value;

describe("the setup steps", () => {
  it("are the five spec §5.1 names, each saying where, what and why, with PayPal's or Venmo's own help pages", () => {
    expect(KEY_STEPS.map((s) => s.id)).toEqual(["owner", "treasurer", "payouts", "venmo", "alerts"]);
    for (const step of KEY_STEPS) {
      expect(step.where).toMatch(/^In (PayPal's settings|the Venmo app)/);
      expect(step.how.length).toBeGreaterThan(40);
      expect(step.why.length).toBeGreaterThan(40);
      expect(step.help.length).toBeGreaterThan(0);
      for (const link of step.help) expect(link.href).toMatch(/^https:\/\/(www\.paypal\.com\/us\/cshelp\/|help\.venmo\.com\/|developer\.paypal\.com\/)/);
    }
  });

  it("never name an AI vendor and keep the delay wording rule", () => {
    const words = JSON.stringify(KEY_STEPS);
    expect(words).not.toMatch(/claude|anthropic|openai|gpt|gemini/i);
    expect(words).not.toMatch(/within two hours|within 2 hours|minutes/i);
    expect(words).toContain("usually within about 2 hours");
  });
});

describe("clampSteps", () => {
  it("reads 0..5 and nothing else", () => {
    expect([0, 3, 5, 9, -1, "2", " 4 ", "x", null, undefined, 2.5].map(clampSteps)).toEqual([0, 3, 5, 5, 0, 2, 4, 0, 0, 0, 0]);
  });
});

describe("who holds the keys, before any step", () => {
  const model = keysPanel(0, null, now);

  it("says the Treasurer holds everything: the cited-case pattern", () => {
    expect(model.stage).toBe("before");
    expect(model.stageLabel).toBe("Before key setup");
    expect(model.headline).toBe("The Treasurer holds every key.");
    expect(accessOf(0, "treasurer")).toEqual(["risk: Owner login, password only", "risk: The club's personal Venmo, on her phone"]);
    expect(accessOf(0, "president")).toEqual(["none: None"]);
    expect(factOf(0, "payouts")).toEqual({ text: "Any app with the club's API access", tone: "risk" });
    expect(factOf(0, "parents").text).toBe("A personal Venmo on the Treasurer's phone");
    expect(factOf(0, "alerts").text).toBe("The Treasurer's email only");
  });

  it("lists every role with its fictional person and the committed demo key ids", () => {
    expect(model.holders.map((h) => [h.title, h.person, h.keyId])).toEqual([
      ["President", "Marcus Bell", demoPublicKeys.president.keyId],
      ["Treasurer", "Esther Huang", demoPublicKeys.treasurer.keyId],
      ["Secretary", "Priya Natarajan", demoPublicKeys.secretary.keyId],
      ["Reviewer", "Nora Lindgren", null],
      ["Parent", "Every family", null],
    ]);
    expect(model.holders.find((h) => h.role === "reviewer")!.keyNote).toBe("No payout key; signs the monthly close");
  });
});

describe("who holds the keys, step by step", () => {
  it("moves one thing per step, in order", () => {
    expect(accessOf(1, "president")).toEqual(["held: Owner login, with 2-step verification"]);
    expect(accessOf(1, "treasurer")).toEqual(["none: No login of her own yet", "risk: The club's personal Venmo, on her phone"]);
    expect(factOf(1, "alerts").text).toBe("The President's email only");
    expect(accessOf(2, "treasurer")).toEqual(["held: Limited user: can't send or withdraw", "risk: The club's personal Venmo, on her phone"]);
    expect(factOf(3, "payouts")).toEqual({ text: "TwoKey only, and only with two officers' keys", tone: "held" });
    expect(accessOf(4, "treasurer")).toEqual(["held: Limited user: can't send or withdraw"]);
    expect(factOf(4, "parents").text).toBe("The club's page, into the club's PayPal account");
    expect(factOf(5, "alerts").text).toBe("Every officer: President, Treasurer, Secretary and Reviewer");
  });

  it("names what is still open while it's under way", () => {
    const during = keysPanel(2, null, now);
    expect(during.stage).toBe("during");
    expect(during.stageLabel).toBe("During key setup");
    expect(during.headline).toBe("The Treasurer can no longer send money or withdraw it.");
    expect(during.subline).toBe(`2 of 5 changes made. Still open: ${KEY_STEPS[2]!.openRisk}`);
    for (let made = 1; made < STEP_COUNT; made++) expect(keysPanel(made, null, now).headline).toBe(KEY_STEPS[made - 1]!.madeLine);
  });

  it("ends with no officer holding every key, and nothing left at risk", () => {
    const after = keysPanel(STEP_COUNT, null, now);
    expect(after.stage).toBe("after");
    expect(after.headline).toBe("No officer holds every key.");
    const tones = [...after.holders.flatMap((h) => h.access), ...after.facts.map((f) => f.value)].map((a) => a.tone);
    expect(tones).not.toContain("risk");
  });
});

describe("the last signature per officer", () => {
  it("is loading until the view arrives, then the newest signature with what it signed", () => {
    expect(lastSignature(null, "treasurer", now)).toEqual({ kind: "loading" });
    const view = fixtureBoardView();
    const treasurer = lastSignature(view, "treasurer", now);
    expect(treasurer.kind).toBe("signed");
    if (treasurer.kind === "signed") {
      expect(treasurer.detail).toMatch(/^Key 1 on “.+”$/);
      expect(treasurer.time).toMatch(/(AM|PM) C[SD]T$/);
    }
    expect(lastSignature(view, "president", now)).toEqual({ kind: "none" });
  });

  it("takes the newest signature across requests, key 2 included", () => {
    const view = fixtureBoardView();
    const request = view.requests[0]!;
    const second = { ...request.signatures[0]!, role: "president" as const, title: "President", isRequest: false, at: "2026-11-05T16:42:05Z" };
    view.requests[0] = { ...request, signatures: [...request.signatures, second] };
    expect(lastSignature(view, "president", now)).toEqual({
      kind: "signed",
      time: "10:42:05 AM CST",
      detail: `Key 2 on “${request.description}”`,
    });
  });

  it("is not shown for the Reviewer and parents, who hold no payout key", () => {
    const model = keysPanel(0, fixtureBoardView(), now);
    expect(model.holders.filter((h) => h.lastSigned.kind === "not-a-signer").map((h) => h.role)).toEqual(["reviewer", "parent"]);
  });
});
