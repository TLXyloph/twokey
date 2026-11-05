import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JudgePanel } from "@/ui/judge/judge-panel";
import { BoardHeader } from "@/ui/studio/board-header";
import { REPLAY_BUTTON_ID, ReplayButtonView } from "@/ui/watchtower/replay-button";
import { WatchAlertsView } from "@/ui/watchtower/watch-alerts";
import { WatchStatusLine } from "@/ui/watchtower/watch-status";
import { fixtureReplay, LOCAL_TEST_PAYOUT, NOW, SETUP_PAYOUTS, watchtowerView } from "../../fixtures/watchtower-view";

/** Markup as text, tags dropped, entities and non-breaking spaces read as plain spaces. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .replace(/ ([.,:])/g, "$1")
    .trim();

const replayed = () => ({ id: "replay-1", ...fixtureReplay(NOW) });

describe("the status line", () => {
  it("holds its place with a flat bar until the board view arrives", () => {
    const html = renderToStaticMarkup(<WatchStatusLine watch="loading" now={NOW} />);
    expect(html).toContain("watch-status__bar");
    expect(text(html)).toBe("Loading the Watchtower's status");
  });

  it("reads the stamp, then what a late report means, with the tone on the mark", () => {
    const html = renderToStaticMarkup(<WatchStatusLine watch={watchtowerView()} now={NOW} />);
    expect(html).toContain('data-tone="notice"');
    expect(text(html)).toBe(
      "Watchtower checked PayPal at 10:20 AM · PayPal's records as of 2:59 AM CST. PayPal's reports are running late, so recent money may not show yet.",
    );
  });

  it("is quiet, not broken, when the Watchtower can't be read", () => {
    const html = renderToStaticMarkup(<WatchStatusLine watch={null} now={NOW} />);
    expect(html).toContain('data-tone="neutral"');
    expect(text(html)).toBe("Watchtower status unavailable");
  });
});

describe("the alerts", () => {
  it("show the newest open finding in full and count the rest", () => {
    const html = renderToStaticMarkup(<WatchAlertsView watch={watchtowerView({ explained: SETUP_PAYOUTS })} now={NOW} />);
    const t = text(html);
    expect(t).toContain(
      "$3.21 left the club account outside TwoKey: sent from PayPal's website to an officer, Esther Huang (Treasurer). PayPal recorded it on Nov 3, 2:27 PM CST. The linked bank covered it, so the balance didn't move.",
    );
    expect(t).not.toContain("sb-wdq");
    expect(t).toContain("1 more");
    expect(t).toContain("Explained (2)");
    expect(html).toMatch(/aria-expanded="false"/);
  });

  it("open to every finding, and to the explained ones with their notes, never hiding them", () => {
    const html = renderToStaticMarkup(
      <WatchAlertsView watch={watchtowerView({ explained: [LOCAL_TEST_PAYOUT, ...SETUP_PAYOUTS] })} now={NOW} initiallyOpen={{ more: true, explained: true }} />,
    );
    const t = text(html);
    expect(t).toContain("to sb-wdq…@personal.example.com. PayPal recorded it on Nov 2, 10:13 PM CST.");
    expect(t).toContain("Show less");
    expect(t).toContain("Explained (3)");
    expect(t).toContain("Explained: TwoKey's setup test, Nov 2–3");
    expect(t).toContain("Explained: TwoKey's local test, Nov 5");
    expect(t).toContain("PayPal reported it 1 h 55 min later.");
  });

  it("raise lost access as an alert of its own, above the findings", () => {
    const t = text(renderToStaticMarkup(<WatchAlertsView watch={watchtowerView({ status: "no_access" })} now={NOW} />));
    expect(t.indexOf("TwoKey has lost access to the club's PayPal account: every officer should check the account's settings.")).toBe(0);
    expect(t).toContain("$3.21 left the club account outside TwoKey");
  });

  it("show a replay first, labelled as a replay of a real sandbox event, with a way to dismiss it", () => {
    const html = renderToStaticMarkup(<WatchAlertsView watch={watchtowerView()} replay={replayed()} now={NOW} />);
    const t = text(html);
    expect(t.startsWith("Replay of a real sandbox event: a $3.21 website send on Nov 3, 2026. $3.21 left the club account outside TwoKey")).toBe(true);
    expect(html).toContain('aria-label="Dismiss the replay"');
    expect(html).toMatch(/aria-live="polite"[^>]*>\s*<section[^>]*data-replay/);
  });

  it("say there are no open findings when everything is explained, and nothing at all when there is nothing", () => {
    const quiet = text(renderToStaticMarkup(<WatchAlertsView watch={watchtowerView({ findings: [], explained: SETUP_PAYOUTS })} now={NOW} />));
    expect(quiet).toBe("The Watchtower has no open findings. Explained (2)");
    for (const watch of [null, "loading" as const, watchtowerView({ status: "ok", findings: [], explained: [] })]) {
      const html = renderToStaticMarkup(<WatchAlertsView watch={watch} now={NOW} />);
      expect(html).toContain("data-empty");
      expect(text(html)).toBe("");
    }
  });
});

describe("the replay button", () => {
  it("is labelled for what it does and keeps its label while it runs", () => {
    const idle = renderToStaticMarkup(<ReplayButtonView running={false} error={null} onReplay={() => {}} />);
    expect(text(idle)).toBe("Replay an outside send");
    expect(idle).toContain(`id="${REPLAY_BUTTON_ID}"`);
    const busy = renderToStaticMarkup(<ReplayButtonView running error={null} onReplay={() => {}} />);
    expect(text(busy)).toBe("Replay an outside send");
    expect(busy).toContain('aria-disabled="true"');
    expect(busy).toContain('aria-busy="true"');
  });

  it("says plainly when the replay failed", () => {
    const html = renderToStaticMarkup(<ReplayButtonView running={false} error="The replay isn't available just now." onReplay={() => {}} />);
    expect(html).toContain('role="status"');
    expect(text(html)).toContain("The replay isn't available just now.");
  });

  it("sits in the judge band", () => {
    expect(text(renderToStaticMarkup(<JudgePanel />))).toContain("Replay an outside send");
  });
});

describe("the board header", () => {
  it("carries the status line in its scope row and the alerts under the finding, for every role", () => {
    const html = renderToStaticMarkup(<BoardHeader />);
    expect(html).toMatch(/board-header__scope[\s\S]*watch-status[\s\S]*board-header__title-row[\s\S]*watch-alerts/);
  });
});

describe("a replay never repeats the alert it replays", () => {
  it("hides the open finding with the replay's transaction id while the replay shows", () => {
    const replay = replayed();
    const open = watchtowerView();
    expect(open.findings.some((f) => f.transactionId === replay.finding.transactionId)).toBe(true);
    const html = renderToStaticMarkup(<WatchAlertsView watch={open} replay={replay} now={NOW} />);
    const mentions = text(html).split("Esther Huang").length - 1;
    expect(mentions).toBe(1);
    expect(text(html)).toContain(replay.label);
  });
});
