import { readdirSync, readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLOSE_MONTH, CLOSE_MONTH_NAME, type CloseDraftView, type CloseFigures, type CloseSignoffView, type CloseView } from "@/close/contracts";
import { octoberClose } from "@/close/october";
import type { ActingRole } from "@/ledger/contracts";
import { EMPTY_CLOSE, type CloseSnapshot, type SignFailure } from "@/ui/close/close-client";
import { DraftPanel } from "@/ui/close/close-draft";
import { BudgetLines, Exceptions, MonthRows, Statement } from "@/ui/close/close-figures";
import { CloseScreen, type CloseInitial } from "@/ui/close/close-screen";
import { Proof, SignoffPanel } from "@/ui/close/close-signoff";
import { SAMPLE_DRAFT } from "@/ui/close/dev/close-fixture";

// The screen reads two stores: this session's close (close-source) and the judge's acting role
// (use-judge). Both are replaced here, so each component is rendered against a known snapshot.
const stores = vi.hoisted(() => ({
  snapshot: null as unknown,
  role: "treasurer" as string,
  sign: (() => undefined) as (role: string) => unknown,
}));
vi.mock("@/ui/close/close-source", () => ({
  useClose: () => stores.snapshot,
  closeClient: () => ({ refresh: async () => undefined, sign: (role: string) => stores.sign(role) }),
}));
vi.mock("@/ui/judge/use-judge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ui/judge/use-judge")>()),
  useActingRole: () => stores.role,
}));

const HASH = "70f5a1c5853aaddb0c2635fe08f515f8fe6b51827c2fc10c77584299dc1c3548";
const figures = octoberClose();
const recorded: CloseDraftView = { state: "recorded", recordedAt: "2026-11-05T20:14:00.000Z", draft: SAMPLE_DRAFT };

const signoff = (over: Partial<CloseSignoffView> = {}): CloseSignoffView => ({
  month: CLOSE_MONTH,
  role: "reviewer",
  title: "Reviewer",
  keyId: "4951e1dd",
  signature: "c2lnbmF0dXJlLWJ5dGVz",
  signedAt: "2026-11-05T18:00:00.000Z",
  signed: { type: "twokey.close.signoff.v1", month: CLOSE_MONTH, closeHash: HASH, role: "reviewer", keyId: "4951e1dd", signedAt: "2026-11-05T18:00:00.000Z" },
  verified: true,
  matchesClose: true,
  ...over,
});

const view = (over: Partial<CloseView> = {}): CloseView => ({
  month: CLOSE_MONTH,
  monthName: CLOSE_MONTH_NAME,
  figures,
  closeHash: HASH,
  draft: recorded,
  signoff: null,
  reviewerKey: { keyId: "4951e1dd" },
  ...over,
});

const failure = (over: Partial<SignFailure> = {}): SignFailure => ({
  id: 1,
  role: "treasurer",
  at: Date.now(),
  code: "signer_cannot_review",
  message: "The Treasurer can't sign the monthly close: a non-signer reviews it.",
  ...over,
});

function given(snapshot: Partial<CloseSnapshot>, role: ActingRole = "treasurer") {
  stores.snapshot = { ...EMPTY_CLOSE, ...snapshot };
  stores.role = role;
}

/** Markup as text, tags dropped, entities decoded, so assertions read like the screen. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .replace(/ ([.,:;])/g, "$1")
    .trim();

beforeEach(() => given({}));

describe("the statement", () => {
  const html = renderToStaticMarkup(<Statement figures={figures} />);

  it("reads opening + in − out = closing, each with its note", () => {
    expect(text(html)).toContain("Opening balance · Oct 1 $2,549.00 Money in · 4 deposits +$4,175.00 Money out · 7 payments −$2,355.25 Closing balance · Oct 31 $4,368.75");
    expect(html).toContain('data-cell="closing"');
  });

  it("keeps each note's separator in its own span, so a narrow statement can put the note on its own line", () => {
    expect(html).toContain('<span class="close-strip__note"><span class="close-strip__dot"> · </span>Oct 31</span>');
  });

  it("ticks the three checks: it carries forward, nothing was open, and every payment has two keys (demo data)", () => {
    const t = text(html);
    expect(t).toContain("Carries forward: $4,368.75 + $630.00 completed after Oct 31 = $4,998.75, the club account's balance as of Nov 3, 10:30 AM CST.");
    expect(t).toContain("Open at month end: none.");
    expect(t).toContain("Two keys: all 7 payments out are approved by two officers (demo data, taken as approved).");
    expect(html.match(/class="close-check" data-ok="true"/g)).toHaveLength(3);
  });

  it("marks a check that fails with the alert, not the tick", () => {
    const unsigned: CloseFigures = { ...figures, twoKeyRecord: { payments: 8, signed: 0, seedApproved: 7 } };
    const marked = renderToStaticMarkup(<Statement figures={unsigned} />);
    expect(marked.match(/class="close-check" data-ok="true"/g)).toHaveLength(2);
    expect(text(marked)).toContain("1 payment is under Exceptions.");
  });
});

describe("the exceptions", () => {
  it("show October's one exception, the car-wash gap, with its shortfall in the data maroon", () => {
    const html = renderToStaticMarkup(<Exceptions figures={figures} />);
    expect(text(html)).toBe(
      "Exceptions Found by code, from the ledger Car wash, Oct 24 −$1,290.00 87 cars logged × $15.00 = $1,305.00 expected. $15.00 received; $1,290.00 has no record. " +
        "Checked and clear: the other 2 fundraisers' takings and every payment's budget line.",
    );
    expect(html).toMatch(/close-exception__figure num" data-shortfall="true">−\$1,290\.00/);
    expect(text(html)).not.toContain("no two-key record");
  });

  it("keep their frame and say so when there are none", () => {
    const t = text(renderToStaticMarkup(<Exceptions figures={{ ...figures, exceptions: [] }} />));
    expect(t).toBe("Exceptions Found by code, from the ledger None. Every fundraiser's takings are recorded, and every payment has two keys on record.");
  });

  it("show a payout without two keys when there is one", () => {
    const unsigned: CloseFigures = {
      ...figures,
      exceptions: [...figures.exceptions, { kind: "no_two_key_record", count: 1, totalCents: 2_000, rowIds: ["S1"], firstSignedRequestDate: "2026-11-02" }],
    };
    expect(text(renderToStaticMarkup(<Exceptions figures={unsigned} />))).toContain("Paid with no two-key record $20.00 1 payment out has no two officers' signatures on record.");
  });
});

describe("October, row by row", () => {
  const html = renderToStaticMarkup(<MonthRows figures={figures} />);

  it("is a ledger table: grey sentence-case headers, the amount column right-aligned", () => {
    expect(html).toMatch(/<table class="close-table">/);
    expect(text(html)).toContain("Date What From or to Checked against Amount");
    expect(html).toContain('<th scope="col" class="close-table__num">Amount</th>');
  });

  it("groups the deposits and the payments, each with its count and total", () => {
    const t = text(html);
    expect(t).toContain("Money in · 4 deposits +$4,175.00");
    expect(t).toContain("Money out · 7 payments −$2,355.25");
    expect(html.match(/<tr>/g)).toHaveLength(1 + 4 + 7);
  });

  it("checks the car wash against its expected takings, marks it short, and prints a dash where nothing is checked", () => {
    expect(text(html)).toContain("$1,305.00 expected · $1,290.00 short $15.00");
    expect(html).toContain('<span class="close-table__none">—</span>');
  });
});

describe("the budget lines", () => {
  const html = renderToStaticMarkup(<BudgetLines figures={figures} />);

  it("draw each line's bar at its true share, named for a screen reader", () => {
    expect(html).toContain('aria-label="Equipment: $412.50 of $700.00 spent"');
    expect(html).toContain(`inline-size:${((41_250 / 70_000) * 100).toFixed(2)}%`);
  });

  it("print an unspent line as a real zero, with no fill", () => {
    expect(html).toMatch(/End-of-season banquet<\/span><span class="close-row__amount num" data-zero="true">\$0\.00 of \$300\.00/);
    expect(text(html)).toContain("No payments · $300.00 left");
  });

  it("total what was paid against the season's approval", () => {
    expect(text(html)).toContain("Total paid $2,355.25 of $3,700.00");
  });
});

describe("the AI's draft", () => {
  it("shows the recorded summary beside its points, labelled as the AI's and recorded, with no vendor", () => {
    const html = renderToStaticMarkup(<DraftPanel draft={recorded} />);
    const t = text(html);
    expect(t).toContain("Reconciliation summary Drafted by the AI (recorded) Nov 5, 2:14 PM CST");
    expect(t).toContain(SAMPLE_DRAFT.summary);
    expect(t).toContain("Points to check");
    expect(html.match(/class="close-point"/g)).toHaveLength(SAMPLE_DRAFT.points.length);
    expect(t).toContain("The AI prepares the close. A person signs it: the club's insurer says financial software doesn't qualify.");
  });

  it("keeps its frame and says the draft isn't recorded yet, and that the close doesn't need it, without the recorded label", () => {
    const t = text(renderToStaticMarkup(<DraftPanel draft={{ state: "not_recorded" }} />));
    expect(t).toContain("Reconciliation summary The AI's draft isn't recorded yet.");
    expect(t).not.toContain("Drafted by the AI (recorded)");
    expect(t).toContain("so the Reviewer can check and sign the close without it.");
    expect(t).not.toContain("Points to check");
  });
});

describe("the sign-off", () => {
  const panel = (key: { keyId: string } | null = { keyId: "4951e1dd" }) => renderToStaticMarkup(<SignoffPanel closeHash={HASH} reviewerKey={key} />);

  it("offers the Reviewer the button, with the hash and key it signs", () => {
    given({}, "reviewer");
    const html = panel();
    const t = text(html);
    expect(t).toContain("Sign-off A non-signer reviews and signs each month's close. The Reviewer holds no payout key.");
    expect(t).toContain("Reviewer: not signed yet Signs the close hash 70f5a1c5… with demo key 4951e1dd.");
    expect(t).toContain("Sign as Reviewer");
    expect(t).not.toContain("Switch to Reviewer");
    expect(html).not.toContain("data-expect-refusal");
  });

  it("lets any other role press Sign (the server refuses, not the page) and offers the switch to the Reviewer", () => {
    given({}, "treasurer");
    const html = panel();
    expect(text(html)).toContain("Sign as Treasurer Switch to Reviewer Only the Reviewer, a non-signer, signs the close. The server refuses every other role.");
    expect(html).not.toMatch(/<button[^>]*disabled/);
    expect(html).toContain('data-expect-refusal="true"');
  });

  it("says so when the Reviewer's key isn't published, from the live view once it has arrived", () => {
    given({}, "reviewer");
    expect(text(panel(null))).toContain("The Reviewer's demo key isn't published on this server yet.");
    given({ view: view({ reviewerKey: null }) }, "reviewer");
    expect(text(panel({ keyId: "4951e1dd" }))).toContain("The Reviewer's demo key isn't published on this server yet.");
  });

  it("keeps its label in place and is marked busy while signing", () => {
    given({ signing: true }, "reviewer");
    const html = panel();
    expect(text(html)).toContain("Signing…");
    expect(html).toContain('aria-disabled="true"');
  });

  it("records each refusal inline: who, when, the server's sentence, and that nothing was signed", () => {
    given({ failures: [failure(), failure({ id: 2, role: "parent", code: "reviewer_key_unset", message: "The Reviewer's demo key isn't set on this server, so the close can't be signed." })] }, "treasurer");
    const html = panel();
    const t = text(html);
    expect(html).toContain('aria-label="Sign attempts"');
    expect(t).toMatch(/Refused Treasurer · \d{1,2}:\d{2}:\d{2} [AP]M C[SD]T The Treasurer can't sign the monthly close: a non-signer reviews it\. Nothing was signed\./);
    expect(t).toMatch(/Not signed Parent · .* The Reviewer's demo key isn't set on this server, so the close can't be signed\. Nothing was signed\./);
    expect(html).toContain('aria-live="polite"');
  });

  it("replaces the button with the signature once signed, with the proof behind a toggle", () => {
    given({ signoff: signoff(), failures: [failure()] }, "reviewer");
    const html = panel();
    const t = text(html);
    expect(t).toContain("Signed by the Reviewer · demo key 4951e1dd Show proof Nov 5, 12:00 PM CST · Stored for this demo session");
    expect(t).not.toContain("Sign as");
    expect(t).not.toContain("Nothing was signed.");
    expect(html).toMatch(/aria-expanded="false" aria-controls="[^"]+"/);
    expect(html).not.toContain("data-fresh");
  });

  it("lands a signature made on this page with motion", () => {
    given({ signoff: signoff(), fresh: true }, "reviewer");
    expect(panel()).toContain('data-fresh="true"');
  });
});

describe("the proof", () => {
  it("shows what the signature binds, whole, with the time in the club's zone", () => {
    const html = renderToStaticMarkup(<Proof signoff={signoff()} id="proof" />);
    const t = text(html);
    expect(t).toContain("Month October 2026 Signed Nov 5, 2026, 12:00:00 PM CST Key Reviewer's demo key 4951e1dd · held by the server");
    expect(t).toContain(`Close hash ${HASH} Signature c2lnbmF0dXJlLWJ5dGVz`);
    expect(t).toContain("Verifies against the Reviewer's published public key.");
    expect(html).toContain('data-ok="true"');
    expect(t).not.toContain("earlier version of the close");
  });

  it("says when the signature doesn't verify, or is for figures that have changed since", () => {
    const t = text(renderToStaticMarkup(<Proof signoff={signoff({ verified: false, matchesClose: false })} id="proof" />));
    expect(t).toContain("Doesn't verify against the Reviewer's published public key.");
    expect(t).toContain("This signature is for an earlier version of the close: its figures have changed since.");
  });
});

describe("the close screen", () => {
  const initial: CloseInitial = { monthName: CLOSE_MONTH_NAME, figures, closeHash: HASH, draft: { state: "not_recorded" }, reviewerKey: { keyId: "4951e1dd" } };

  it("names the product, the club as demo data and the month, and answers whether it adds up", () => {
    const html = renderToStaticMarkup(<CloseScreen initial={initial} />);
    const t = text(html);
    expect(t).toMatch(/^TwoKey \/ Riverbend Youth Football League Demo data Monthly close: October 2026 October adds up and closes at \$4,368\.75\. 1 exception to check before the Reviewer signs\./);
    expect(html).toContain('<h1 class="board-header__title">Monthly close: October 2026</h1>');
    expect(html).toContain('href="/demo"');
  });

  it("puts the statement, draft and rows in the main column and the exceptions, sign-off and budget in the rail", () => {
    const html = renderToStaticMarkup(<CloseScreen initial={initial} />);
    expect(html).toMatch(/close-main[\s\S]*close-statement[\s\S]*close-draft[\s\S]*close-rows-panel[\s\S]*close-rail[\s\S]*close-exceptions-panel[\s\S]*close-signoff[\s\S]*close-budget/);
  });

  it("takes the live view's draft once it arrives, and says when this session's sign-off couldn't be read", () => {
    given({ view: view(), error: "Couldn't reach the server. Check the connection and try again." });
    const t = text(renderToStaticMarkup(<CloseScreen initial={initial} />));
    expect(t).toContain(SAMPLE_DRAFT.summary);
    expect(t).toContain("Couldn't read this session's sign-off: Couldn't reach the server.");
  });
});

describe("the close page", () => {
  it("renders the judge band with no props, then the close from the seed, with the draft not recorded yet", async () => {
    const { default: ClosePage } = await import("@/app/demo/close/page");
    const html = renderToStaticMarkup(await ClosePage());
    const t = text(html);
    expect(t).toContain("Judge mode");
    expect(t).toContain("Monthly close: October 2026");
    expect(t).toContain("The AI's draft isn't recorded yet.");
    expect(html.indexOf("Judge mode")).toBeLessThan(html.indexOf("Monthly close: October 2026"));
  });
});

describe("the close UI stays model-agnostic", () => {
  it("never names a specific AI model or vendor", () => {
    const dirs = ["src/ui/close", "src/ui/close/dev", "src/app/demo/close"];
    const source = dirs
      .flatMap((dir) => readdirSync(dir).filter((f) => /\.(ts|tsx|css)$/.test(f)).map((f) => readFileSync(`${dir}/${f}`, "utf8")))
      .join("\n");
    expect(source).not.toMatch(/\b(claude|anthropic|openai|gpt|gemini|opus|sonnet)\b/i);
  });
});
