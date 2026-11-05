import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fixtureBoardView } from "@/ui/judge/dev/board-view-fixture";
import { fixtureWatchtower } from "@/ui/judge/dev/watchtower-fixture";
import { KeyChecklist } from "@/ui/keys/key-checklist";
import { KEY_STEPS } from "@/ui/keys/keys-content";
import { KEYS_PANEL_ID, WhoHoldsTheKeys } from "@/ui/keys/who-holds-the-keys";

const now = new Date("2026-11-05T17:00:00Z");
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
const noop = () => {};

describe("the setup steps", () => {
  it("is an ordered list of the five steps; the next one is open with the one 'Mark done'", () => {
    const html = renderToStaticMarkup(<KeyChecklist done={1} onAdvance={noop} onBack={noop} onReset={noop} />);
    expect(html).toContain('<ol class="keys-steps">');
    expect((html.match(/class="keys-step"/g) ?? []).length).toBe(5);
    expect((html.match(/>Mark done</g) ?? []).length).toBe(1);
    expect(html).toMatch(/data-state="next" data-open="">[\s\S]*Make the Treasurer a limited user/);
    expect((html.match(/aria-expanded="true"/g) ?? []).length).toBe(1);
    expect(text(html)).toContain("1 of 5 done");
    expect(text(html)).toContain("Demo data");
    expect(text(html)).toContain("Undo the last step");
  });

  it("says where each change is made and why, and links PayPal's help in a new tab", () => {
    const html = renderToStaticMarkup(<KeyChecklist done={0} onAdvance={noop} onBack={noop} onReset={noop} />);
    expect(text(html)).toContain("In PayPal's settings");
    expect(text(html)).toContain("Why the rulebook asks");
    expect(html).toContain(`href="${KEY_STEPS[0]!.help[0]!.href}" target="_blank" rel="noopener noreferrer"`);
    expect(text(html)).not.toContain("Undo the last step");
  });

  it("closes every step once all five are done", () => {
    const html = renderToStaticMarkup(<KeyChecklist done={5} onAdvance={noop} onBack={noop} onReset={noop} />);
    expect(html).not.toContain('aria-expanded="true"');
    expect(html).not.toContain(">Mark done<");
    expect(text(html)).toContain("All five changes are made.");
  });
});

describe("who holds the keys", () => {
  const panel = (done: number, loaded = true) =>
    renderToStaticMarkup(
      <WhoHoldsTheKeys done={done} view={loaded ? fixtureBoardView() : null} watch={loaded ? fixtureWatchtower("stale") : "loading"} settled={false} now={now} />,
    );

  it("is the public panel the parent ledger links to, with a person, access, key and last signature per role", () => {
    const html = panel(0);
    expect(KEYS_PANEL_ID).toBe("who-holds-the-keys");
    expect(html).toContain('id="who-holds-the-keys"');
    expect(html).toContain('role="table"');
    expect((html.match(/role="rowheader"/g) ?? []).length).toBe(5);
    const t = text(html);
    expect(t).toContain("Before key setup");
    expect(t).toContain("The Treasurer holds every key.");
    expect(t).toContain("Esther Huang Treasurer Owner login, password only The club's personal Venmo, on her phone demo key 66da687e");
    expect(t).toContain("Hasn't signed in this session");
    expect(t).toContain("Nora Lindgren Reviewer");
  });

  it("shows the Watchtower's live line and points to the open alerts", () => {
    const t = text(panel(5));
    expect(t).toContain("After key setup");
    expect(t).toContain("No officer holds every key.");
    expect(t).toMatch(/Watchtower checked PayPal/);
    expect(t).toMatch(/open alerts?, shown to every role on the board/);
  });

  it("holds each value's place while the session loads", () => {
    const html = panel(0, false);
    expect(html).toContain("Loading this session");
    expect(html).toContain("Loading the Watchtower");
  });

  it("says the keys are demo keys, and which parts are demo data and which are live", () => {
    const t = text(panel(0));
    expect(t).toContain("demo data");
    expect(t).toContain("passkey");
    expect(t).toContain("the Watchtower's line is live");
  });
});
