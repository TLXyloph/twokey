import { readdirSync, readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RiskBlock } from "@/ui/judge/drawer-risk";
import { RequestCard } from "@/ui/judge/drawer-request";
import { JudgePanel, PARENT_PAGE_HREF } from "@/ui/judge/judge-panel";
import { currentPage, SiteNav } from "@/ui/judge/site-nav";
import { StartOverView } from "@/ui/judge/start-over";
import { ReviewButton } from "@/ui/studio/review-button";
import { glovesRequest, paintRequest, riskCard, sentRequest } from "../../fixtures/board-view";

const now = new Date("2026-11-05T17:00:00Z");
/** Markup as text, tags dropped, entities decoded, so assertions read like the screen. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

describe("the judge panel", () => {
  const html = renderToStaticMarkup(<JudgePanel />);

  it("is labelled Judge mode, with the five roles and the Treasurer chosen first", () => {
    expect(text(html)).toContain("Judge mode");
    for (const role of ["President", "Treasurer", "Secretary", "Reviewer", "Parent"]) expect(text(html)).toContain(role);
    const radios = html.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
    expect(radios).toHaveLength(5);
    expect(radios.filter((tag) => /\bchecked\b/.test(tag)).map((tag) => /value="(\w+)"/.exec(tag)?.[1])).toEqual(["treasurer"]);
    expect(html).toContain('role="radiogroup"');
  });

  it("links to the parent's ticket page in judge mode", () => {
    expect(PARENT_PAGE_HREF).toBe("/demo/pay/banquet?judge=1");
    expect(html).toContain('href="/demo/pay/banquet?judge=1"');
    expect(text(html)).toContain("Buy tickets (parent page)");
  });

  it("names the four demo screens, in order, before the role switch", () => {
    expect(html).toContain('aria-label="Demo screens"');
    const hrefs = [...html.matchAll(/class="judge-nav__link"[^>]*href="([^"]+)"|href="([^"]+)"[^>]*class="judge-nav__link"/g)].map((m) => m[1] ?? m[2]);
    expect(hrefs).toEqual(["/demo", "/demo/ledger", "/demo/close", "/demo/keys"]);
    expect(text(html)).toContain("Board Parent ledger Monthly close Key setup");
    expect(html.indexOf("Key setup")).toBeLessThan(html.indexOf("Acting as"));
  });

  it("holds the two judge actions, with the start-over confirm closed and out of reach", () => {
    expect(text(html)).toContain("Replay an outside send Start over");
    expect(html).toMatch(/<div class="judge-actions__set"[^>]*inert=""[^>]*role="group" aria-label="Start over"/);
    expect(html).not.toContain("confirm(");
  });
});

describe("the site nav", () => {
  it("marks the current screen, and none on a page that isn't one of the four", () => {
    const current = (pathname: string | null) => (renderToStaticMarkup(<SiteNav pathname={pathname} />).match(/aria-current="page"[^>]*>([^<]+)</) ?? [])[1] ?? null;
    expect(current("/demo")).toBe("Board");
    expect(current("/demo/keys")).toBe("Key setup");
    expect(current("/demo/ledger/")).toBe("Parent ledger");
    expect(current("/demo/close")).toBe("Monthly close");
    expect(current("/demo/pay/banquet")).toBeNull();
    expect(current(null)).toBeNull();
    expect(currentPage("/demo/keys/anything")?.label).toBe("Key setup");
  });
});

describe("the start-over control", () => {
  const view = (phase: "idle" | "confirming" | "running" | "failed", error: string | null = null) =>
    renderToStaticMarkup(
      <StartOverView snapshot={{ phase, error }} onAsk={() => {}} onCancel={() => {}} onConfirm={() => {}}>
        <span>replay</span>
      </StartOverView>,
    );

  it("asks inline, in the same cell, with Cancel where the first button was", () => {
    const html = view("confirming");
    expect(text(html)).toContain("Start from the seed? Start over Cancel");
    expect(html).toMatch(/<div class="judge-actions__set" inert="">\s*<span>replay<\/span>/);
    expect(html).toMatch(/data-shown=""[^>]*role="group"/);
  });

  it("says it's working, then shows the server's sentence if it was refused", () => {
    expect(text(view("running"))).toContain("Starting over…");
    expect(view("running")).toContain('aria-busy="true"');
    const failed = view("failed", "This network has started the most new demo sessions allowed in an hour.");
    expect(failed).toContain('role="status"');
    expect(text(failed)).toContain("most new demo sessions allowed in an hour");
  });
});

describe("the review button", () => {
  it("counts the seed's waiting payouts until the live view arrives (the first paint is unchanged)", () => {
    expect(text(renderToStaticMarkup(<ReviewButton seedCount={2} />))).toBe("Review 2 payouts");
    expect(text(renderToStaticMarkup(<ReviewButton seedCount={0} />))).toBe("No payouts waiting");
  });
});

describe("a request card", () => {
  it("shows the payee, amount, description, budget line, source and receipt", () => {
    const t = text(renderToStaticMarkup(<RequestCard request={glovesRequest()} role="president" now={now} />));
    expect(t).toContain("Riverbend Team Supply");
    expect(t).toContain("$42.00");
    expect(t).toContain("Goalkeeper gloves");
    expect(t).toContain("Equipment · Requested by the Treasurer · Nov 2");
    expect(t).toContain("Demo data");
    expect(renderToStaticMarkup(<RequestCard request={glovesRequest()} role="president" now={now} />)).toContain(
      'aria-label="Open the receipt: Team Supply: goalkeeper gloves, $42"',
    );
  });

  it("shows the risk card and one line per signature, with the slot for the second key", () => {
    const t = text(renderToStaticMarkup(<RequestCard request={glovesRequest()} role="president" now={now} />));
    expect(t).toContain("Looks right");
    expect(t).toContain("Recorded check");
    expect(t).toContain("Signed by the Treasurer · demo key 7f3a1c2e");
    expect(t).toContain("Show proof");
    expect(t).toContain("Second key: the President or the Secretary");
  });

  it("offers an officer the Sign button, with the flags tick only on a flagged card", () => {
    const clear = renderToStaticMarkup(<RequestCard request={glovesRequest()} role="president" now={now} />);
    expect(text(clear)).toContain("Sign as President");
    expect(text(clear)).not.toContain("I've read the flags");

    const flagged = renderToStaticMarkup(<RequestCard request={paintRequest()} role="treasurer" now={now} />);
    expect(text(flagged)).toContain("Check this");
    expect(text(flagged)).toContain("I've read the flags");
    // The payee's own button still works: the server refuses, not the page.
    expect(text(flagged)).toContain("Sign as Treasurer");
    expect(flagged).not.toMatch(/<button[^>]*disabled/);
    expect(text(flagged)).toContain("You're the payee");
  });

  it("is read-only for a parent, and still shows the recorded refusals", () => {
    const refused = {
      ...paintRequest(),
      refusals: [{ role: "treasurer" as const, code: "payee_cannot_sign" as const, message: "The Treasurer is the payee.", at: "2026-11-05T16:39:13Z" }],
    };
    const t = text(renderToStaticMarkup(<RequestCard request={refused} role="parent" now={now} />));
    expect(t).not.toContain("Sign as");
    expect(t).not.toContain("I've read the flags");
    expect(t).toContain("The Treasurer is the payee.");
  });

  it("shows a refusal calmly, as a recorded event", () => {
    const refused = {
      ...paintRequest(),
      refusals: [{ role: "treasurer" as const, code: "payee_cannot_sign" as const, message: "The Treasurer is the payee.", at: "2026-11-05T16:39:13Z" }],
    };
    const t = text(renderToStaticMarkup(<RequestCard request={refused} role="treasurer" now={now} />));
    expect(t).toContain("Refused Treasurer · 10:39:13 AM CST");
    expect(t).toContain("The Treasurer is the payee.");
    expect(t).toContain("Recorded in the ledger. Nothing was sent.");
  });

  it("shows the server's answer at once, before the ledger's copy arrives", () => {
    const outcome = {
      role: "treasurer" as const,
      at: now.getTime(),
      refusalsBefore: 0,
      result: { ok: false as const, status: 409, code: "payee_cannot_sign", message: "The Treasurer is the payee." },
    };
    const t = text(renderToStaticMarkup(<RequestCard request={paintRequest()} role="treasurer" now={now} outcome={outcome} />));
    expect(t).toContain("The Treasurer is the payee.");
    expect(t).toContain("Nothing was sent.");
  });

  it("swaps the action for the live timeline once the second key is in", () => {
    const t = text(renderToStaticMarkup(<RequestCard request={sentRequest()} role="president" now={now} />));
    expect(t).not.toContain("Sign as");
    expect(t).toContain("Requested");
    expect(t).toContain("Sent to PayPal 10:42:07 AM CST Batch 5UXD2E8A7");
    expect(t).toContain("PayPal confirmed (not yet) Waiting");
  });

  it("labels a judge's own request as live sandbox", () => {
    const t = text(renderToStaticMarkup(<RequestCard request={{ ...glovesRequest(), sourceLabel: "live sandbox" }} role="president" now={now} />));
    expect(t).toContain("Live sandbox");
  });
});

describe("the risk block", () => {
  it("keeps the rules card up while the AI reads the receipt", () => {
    const t = text(renderToStaticMarkup(<RiskBlock card={riskCard({ origin: "rules" })} pending read="running" />));
    expect(t).toContain("Looks right");
    expect(t).toContain("The AI is reading the receipt…");
  });

  it("says plainly when the AI's read failed", () => {
    const t = text(renderToStaticMarkup(<RiskBlock card={riskCard({ origin: "rules" })} pending read="failed" />));
    expect(t).toContain("The AI couldn't read the receipt just now. The rule checks stand.");
  });

  it("names each finding's evidence and where it came from", () => {
    const t = text(renderToStaticMarkup(<RiskBlock card={paintRequest().risk} pending={false} />));
    expect(t).toContain("Receipt line 2: patio string lights, $12.00 · Read from the receipt");
    expect(t).toContain("Payee: Esther Huang (Treasurer), officer directory · Rule check");
  });
});

describe("the judge UI stays model-agnostic", () => {
  it("never names a specific AI model or vendor", () => {
    const dirs = ["src/ui/judge", "src/ui/judge/dev", "src/ui/keys", "src/judge"];
    const source = dirs
      .flatMap((dir) => readdirSync(dir).filter((f) => /\.(ts|tsx|css)$/.test(f)).map((f) => readFileSync(`${dir}/${f}`, "utf8")))
      .join("\n");
    expect(source).not.toMatch(/\b(claude|anthropic|openai|gpt|gemini|opus|sonnet)\b/i);
  });
});
