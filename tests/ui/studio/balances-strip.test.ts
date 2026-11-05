import { describe, expect, it, vi } from "vitest";
import { formatAsOf, moneyInThisMonth, secondKeyQueue } from "@/demo/board-figures";
import { riverbend } from "@/demo/riverbend";
import { ledgerRows } from "@/demo/studio-data";
import { balancesStripCells, planStripQueries, toStripFigures, type StripFigures, type StripSlot } from "@/ui/studio/balances-strip";

const asOf = riverbend.balances[0]!.asOf;
const sumOf = (key: "awaitingSecondKey" | "pendingAmount" | "moneyInThisMonth") =>
  ledgerRows().reduce((total, row) => total + Math.round(row[key] * 100), 0) / 100;

/** The figures as Studio's sums over the demo rows return them. */
const demo: StripFigures = {
  balance: riverbend.balances[0]!.available,
  asOf,
  waiting: { count: sumOf("awaitingSecondKey"), total: sumOf("pendingAmount") },
  moneyIn: sumOf("moneyInThisMonth"),
};

describe("the balances strip's cells", () => {
  it("reads balance, second-key queue and money in, in that order", () => {
    expect(balancesStripCells(demo)).toEqual([
      {
        id: "balance",
        label: "Available balance",
        value: "$4,998.75",
        caption: "PayPal sandbox · as of Nov 3, 10:30 AM CST",
        zero: false,
      },
      { id: "waiting", label: "Waiting for a second key", value: "$78.50", caption: "2 payouts", zero: false },
      {
        id: "moneyIn",
        label: "Money in, November",
        value: "$630.00",
        caption: "Completed payments since November 1",
        zero: false,
      },
    ]);
  });

  it("states the same figures as the header (one fact, two places)", () => {
    const [balance, waiting, moneyIn] = balancesStripCells(demo);
    const queue = secondKeyQueue();
    expect(balance!.caption).toContain(formatAsOf(asOf));
    expect(waiting!.caption).toBe(`${queue.count} payouts`);
    expect(waiting!.value).toBe("$78.50");
    expect(queue.total).toBe(78.5);
    expect(moneyIn!.label).toBe(`Money in, ${moneyInThisMonth().monthName}`);
    expect(moneyIn!.value).toBe("$630.00");
  });

  it("counts one payout in the singular", () => {
    const [, waiting] = balancesStripCells({ ...demo, waiting: { count: 1, total: 129 } });
    expect(waiting!.caption).toBe("1 payout");
  });

  it("greys a zero queue and says nothing is waiting", () => {
    const [, waiting] = balancesStripCells({ ...demo, waiting: { count: 0, total: 0 } });
    expect(waiting).toEqual({ id: "waiting", label: "Waiting for a second key", value: "$0.00", caption: "Nothing waiting", zero: true });
  });

  it("treats an empty sum (no rows in view) as zero, not as missing", () => {
    const [, waiting, moneyIn] = balancesStripCells({ ...demo, waiting: { count: null, total: null }, moneyIn: null });
    expect(waiting).toMatchObject({ value: "$0.00", caption: "Nothing waiting", zero: true });
    expect(moneyIn).toMatchObject({ value: "$0.00", caption: "No completed payments since November 1", zero: true });
  });

  it("leaves out the cells whose slots are not mapped", () => {
    expect(balancesStripCells({ balance: 10, asOf }).map((c) => c.id)).toEqual(["balance"]);
    expect(balancesStripCells({ balance: 10, asOf, moneyIn: 5 }).map((c) => c.id)).toEqual(["balance", "moneyIn"]);
  });

  it("still describes the queue when only its total is mapped", () => {
    const [, waiting] = balancesStripCells({ ...demo, waiting: { total: 489 } });
    expect(waiting).toMatchObject({ value: "$489.00", caption: "Not yet paid out", zero: false });
  });

  it("drops the time and the month name when the as-of time is missing", () => {
    const [balance, , moneyIn] = balancesStripCells({ ...demo, asOf: null });
    expect(balance!.caption).toBe("PayPal sandbox");
    expect(moneyIn).toMatchObject({ label: "Money in this month", caption: "Completed payments this month" });
  });

  it("formats money with the formatter it is given, slot by slot", () => {
    const format = vi.fn((amount: number, _slot: StripSlot) => `USD ${amount}`);
    const cells = balancesStripCells(demo, format);
    expect(cells.map((c) => c.value)).toEqual(["USD 4998.75", "USD 78.5", "USD 630"]);
    expect(format.mock.calls.map(([, slot]) => slot)).toEqual(["value", "waitingTotal", "moneyIn"]);
  });
});

describe("the strip's queries", () => {
  const field = (fieldId: string) => ({ fieldId, key: `${fieldId}.sum` });

  it("asks each table on its own, so a join never repeats the balance row", () => {
    const plan = planStripQueries({
      value: field("balances.available"),
      asOf: field("balances.asOf"),
      waitingCount: field("ledger.awaitingSecondKey"),
      waitingTotal: field("ledger.pendingAmount"),
      moneyIn: field("ledger.moneyInThisMonth"),
    });
    expect(plan).toEqual([
      { queryId: "strip:balances", slots: ["value", "asOf"], fields: [field("balances.available"), field("balances.asOf")] },
      {
        queryId: "strip:ledger",
        slots: ["waitingCount", "waitingTotal", "moneyIn"],
        fields: [field("ledger.awaitingSecondKey"), field("ledger.pendingAmount"), field("ledger.moneyInThisMonth")],
      },
    ]);
  });

  it("skips unmapped slots", () => {
    const plan = planStripQueries({ value: field("balances.available"), asOf: field("balances.asOf") });
    expect(plan.map((q) => q.queryId)).toEqual(["strip:balances"]);
  });
});

describe("toStripFigures", () => {
  it("is null when there is no balance to show", () => {
    expect(toStripFigures({ value: null, asOf }, new Set(["value", "asOf"]))).toBeNull();
  });

  it("keeps a slot only when it is mapped, and reads numbers Studio returns", () => {
    const mapped = new Set(["value", "asOf", "waitingTotal"] as const);
    expect(toStripFigures({ value: 4998.75, asOf, waitingTotal: 489 }, mapped)).toEqual({
      balance: 4998.75,
      asOf,
      waiting: { total: 489, count: undefined },
      moneyIn: undefined,
    });
  });

  it("reads a mapped but empty sum as null, which the cells show as zero", () => {
    const mapped = new Set(["value", "asOf", "waitingCount", "waitingTotal", "moneyIn"] as const);
    expect(toStripFigures({ value: 1, asOf }, mapped)).toMatchObject({ waiting: { count: null, total: null }, moneyIn: null });
  });
});

describe("the shared sandbox balance under the available balance", () => {
  const shared = { availableCents: 499_750, currency: "USD" as const, asOf: "2026-11-05T14:30:00Z" };

  it("adds PayPal's real balance for the shared account, with its own time", () => {
    const [balance, waiting] = balancesStripCells({ ...demo, shared });
    expect(balance!.note).toBe("Shared sandbox balance $4,997.50 · as of Nov 5, 8:30 AM CST");
    expect(waiting!.note).toBeUndefined();
  });

  it("leaves out the date when it is the same day as the balance above it", () => {
    const [balance] = balancesStripCells({ ...demo, asOf: "2026-11-05T15:39:00Z", shared });
    expect(balance!.caption).toBe("PayPal sandbox · as of Nov 5, 9:39 AM CST");
    expect(balance!.note).toBe("Shared sandbox balance $4,997.50 · as of 8:30 AM CST");
    // A narrow strip (a tablet) drops one word rather than the time.
    expect(balance!.noteShort).toBe("Shared sandbox $4,997.50 · as of 8:30 AM CST");
  });

  it("says nothing when PayPal's balance can't be read", () => {
    expect(balancesStripCells({ ...demo, shared: null })[0]).not.toHaveProperty("note");
    expect(balancesStripCells(demo)[0]).not.toHaveProperty("note");
  });
});
