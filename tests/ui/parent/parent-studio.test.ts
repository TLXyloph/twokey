import { describe, expect, it, vi } from "vitest";
import { riverbend } from "@/demo/riverbend";
import { fixtureBoardView } from "@/ui/judge/dev/board-view-fixture";
import { parentBalanceCells } from "@/ui/parent/balance-cells";
import { parentLedgerRows, parentStatus, parentStudioData, parentWaitingRows } from "@/ui/parent/parent-data";
import { createParentStudioHandle } from "@/ui/parent/parent-handle";
import { layoutRows, PARENT_CANVAS_PADDING, PARENT_CANVAS_PADDING_MEDIUM, ROW_HEIGHT, stackedLayout, WIDGET_IDS, wideLayout } from "@/ui/parent/parent-grid";
import { parentStudioSetup, PARENT_PAGE_ID } from "@/ui/parent/parent-layout";

describe("the parent's Studio data", () => {
  it("names fields in a parent's words", () => {
    const sources = parentStudioData().sources;
    const ledger = sources.find((s) => s.id === "ledger")!;
    const names = "fields" in ledger ? ledger.fields!.map((f) => f.name) : [];
    expect(names).toEqual(expect.arrayContaining(["What for", "Paid to or from", "Amount", "Status"]));
    expect(names).not.toContain("Counterparty");
  });

  it("says Received, Paid or Waiting for a second key", () => {
    expect(parentStatus({ direction: "in", status: "completed" })).toBe("Received");
    expect(parentStatus({ direction: "out", status: "completed" })).toBe("Paid");
    expect(parentStatus({ direction: "out", status: "pending" })).toBe("Waiting for a second key");
    expect(new Set(parentLedgerRows().map((r) => r.status))).toEqual(new Set(["Received", "Paid", "Waiting for a second key"]));
  });

  it("lists the waiting payouts with payee and amount, the first key and who may sign second", () => {
    expect(parentWaitingRows()).toEqual([
      { id: "L14", date: "2026-11-02", payee: "Riverbend Team Supply", description: "Goalkeeper gloves", amount: 42, signedBy: "Treasurer", stillToSign: "President or Secretary" },
      {
        id: "L15",
        date: "2026-11-03",
        payee: "Esther Huang (Treasurer), reimbursement",
        description: "Field-paint reimbursement",
        amount: 36.5,
        signedBy: "Secretary",
        stillToSign: "President",
      },
    ]);
  });

  it("never carries an email, a key id or a signature, even from a full board view", () => {
    const view = fixtureBoardView();
    expect(JSON.stringify(view)).toContain("@"); // the board view itself carries payee emails in signatures
    const text = JSON.stringify(parentStudioData(view.data));
    expect(text).not.toContain("@");
    for (const request of view.requests) {
      for (const signature of request.signatures) {
        expect(text).not.toContain(signature.keyId);
        expect(text).not.toContain(signature.signature);
      }
    }
  });

  it("sums the helpers to the same figures the board shows", () => {
    const rows = parentLedgerRows(riverbend);
    const sum = (key: "pendingAmount" | "moneyInThisMonth" | "awaitingSecondKey") => rows.reduce((t, r) => t + Math.round(r[key] * 100), 0) / 100;
    expect(sum("pendingAmount")).toBe(78.5);
    expect(sum("awaitingSecondKey")).toBe(2);
    expect(sum("moneyInThisMonth")).toBe(630);
  });
});

describe("the parent balance widget's cells", () => {
  it("reads the balance with its as-of time, what waits and this month's money in", () => {
    const cells = parentBalanceCells({ balance: 4998.75, asOf: "2026-11-03T16:30:00Z", waiting: { total: 78.5, count: 2 }, moneyIn: 630 });
    expect(cells.map((c) => [c.label, c.value, c.caption])).toEqual([
      ["In the club account", "$4,998.75", "As of Nov 3, 10:30 AM CST"],
      ["Waiting for a second key", "$78.50", "2 payouts, not paid yet"],
      ["Money in, November", "$630.00", "Received since November 1"],
    ]);
  });

  it("says plainly when nothing waits or nothing came in, and drops unmapped cells", () => {
    const cells = parentBalanceCells({ balance: 10, asOf: "2026-11-03T16:30:00Z", waiting: { total: null, count: 0 }, moneyIn: 0 });
    expect(cells[1]).toMatchObject({ caption: "Nothing waiting", zero: true });
    expect(cells[2]).toMatchObject({ caption: "Nothing received since November 1", zero: true });
    expect(parentBalanceCells({ balance: 10, asOf: null })).toHaveLength(1);
  });
});

describe("the parent's Studio page", () => {
  it("opens read-only, with no panels, on the club's books", () => {
    const setup = parentStudioSetup(1440);
    expect(setup.mode).toBe("view");
    expect(setup.panels).toEqual({ view: { left: [], right: [] } });
    expect(setup.initialState.pages.map((p) => p.id)).toEqual([PARENT_PAGE_ID]);
    expect(Object.keys(setup.initialState.pages[0]!.widgets ?? {}).sort()).toEqual(Object.values(WIDGET_IDS).sort());
  });

  it("puts the chart and the events table side by side when wide, and stacks them below 1100px", () => {
    const wide = wideLayout();
    expect(wide[WIDGET_IDS.chart].yTrack).toBe(wide[WIDGET_IDS.events].yTrack);
    const stacked = stackedLayout();
    expect(Object.values(stacked).every((b) => b.xTrack === 0 && b.xSpan === 24)).toBe(true);
  });

  it("never overlaps two widgets", () => {
    for (const layout of [wideLayout(), stackedLayout()]) {
      const boxes = Object.values(layout);
      for (const [i, a] of boxes.entries()) {
        for (const b of boxes.slice(i + 1)) {
          const apart = a.xTrack + a.xSpan <= b.xTrack || b.xTrack + b.xSpan <= a.xTrack || a.yTrack + a.ySpan! <= b.yTrack || b.yTrack + b.ySpan! <= a.yTrack;
          expect(apart).toBe(true);
        }
      }
    }
  });

  it("sizes Studio's box to the whole canvas, so the page scrolls and Studio doesn't", () => {
    expect(parentStudioSetup(1440).heightPx).toBe(layoutRows(wideLayout()) * ROW_HEIGHT + PARENT_CANVAS_PADDING * 2);
    expect(parentStudioSetup(800).heightPx).toBe(layoutRows(stackedLayout()) * ROW_HEIGHT + PARENT_CANVAS_PADDING_MEDIUM * 2);
  });
});

describe("the parent Studio handle", () => {
  it("holds data until Studio is ready, pushes each object once, and bumps the revision", () => {
    const handle = createParentStudioHandle();
    const api = { setProperty: vi.fn() };
    const listener = vi.fn();
    handle.subscribe(listener);
    handle.push(riverbend);
    expect(handle.getRevision()).toBe(0);
    handle.setDataApi(api);
    expect(api.setProperty).toHaveBeenCalledTimes(1);
    expect(api.setProperty.mock.calls[0]![0]).toBe("data");
    handle.push(riverbend);
    expect(api.setProperty).toHaveBeenCalledTimes(1);
    handle.push({ ...riverbend });
    expect(api.setProperty).toHaveBeenCalledTimes(2);
    expect(handle.getRevision()).toBe(2);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("gives a new Studio the latest data again", () => {
    const handle = createParentStudioHandle();
    handle.push(riverbend);
    handle.setDataApi({ setProperty: vi.fn() });
    handle.setDataApi(null);
    const next = { setProperty: vi.fn() };
    handle.setDataApi(next);
    expect(next.setProperty).toHaveBeenCalledTimes(1);
  });
});
