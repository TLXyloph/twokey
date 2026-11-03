import { describe, expect, it } from "vitest";
import {
  balanceStamp,
  boardFinding,
  formatAsOf,
  formatEventDate,
  monthNameOf,
  moneyInThisMonth,
  secondKeyQueue,
  stillToSign,
} from "@/demo/board-figures";
import { riverbend, type ClubDemoData } from "@/demo/riverbend";
import { ledgerRows } from "@/demo/studio-data";

const cents = (n: number) => Math.round(n * 100);
const sumCents = (values: number[]) => values.reduce((t, v) => t + cents(v), 0);

describe("the finding under the title", () => {
  it("names the car wash's unrecorded takings, computed from its row", () => {
    expect(boardFinding()).toBe("Car wash, October 24: $1,290.00 of $1,305.00 expected has no record.");
  });

  it("agrees with the events table's difference column (one fact, two places)", () => {
    const carWash = ledgerless(riverbend).events.find((e) => e.id === "car-wash")!;
    expect(cents(carWash.received - carWash.expected)).toBe(-129000);
    expect(boardFinding()).toContain("$1,290.00");
  });

  it("says so plainly when nothing is short", () => {
    const reconciled = { ...riverbend, events: riverbend.events.map((e) => ({ ...e, received: e.expected })) };
    expect(boardFinding(reconciled)).toBe("Every event's takings are recorded in full.");
  });

  it("formats event dates in words", () => {
    expect(formatEventDate("2026-10-24")).toBe("October 24");
  });
});

describe("waiting for a second key", () => {
  const queue = secondKeyQueue();

  it("lists the pending payouts with who signed first and who may still sign", () => {
    expect(queue.payouts).toEqual([
      {
        id: "L14",
        date: "2026-11-02",
        payee: "Riverbend Team Supply",
        description: "Goalkeeper gloves",
        amount: 129,
        signedBy: "Treasurer",
        stillToSign: "President or Secretary",
      },
      {
        id: "L15",
        date: "2026-11-03",
        payee: "Referee pool (league-appointed)",
        description: "Referee fees, November",
        amount: 360,
        signedBy: "Secretary",
        stillToSign: "Treasurer or President",
      },
    ]);
  });

  it("never offers the requester as the second key", () => {
    for (const role of ["treasurer", "president", "secretary"] as const) {
      expect(stillToSign(role).toLowerCase()).not.toContain(role);
    }
  });

  it("counts and totals the queue from its rows", () => {
    expect(queue.count).toBe(2);
    expect(queue.total).toBe(489);
  });

  it("agrees with the helper columns the balances strip sums inside Studio", () => {
    const rows = ledgerRows();
    expect(rows.reduce((t, r) => t + r.awaitingSecondKey, 0)).toBe(queue.count);
    expect(sumCents(rows.map((r) => r.pendingAmount))).toBe(cents(queue.total));
    expect(rows.filter((r) => r.awaitingSecondKey === 1).map((r) => [r.signedBy, r.stillToSign])).toEqual(
      queue.payouts.map((p) => [p.signedBy, p.stillToSign]),
    );
  });

  it("is not part of the available balance (pending money has not left)", () => {
    const completed = riverbend.ledger.filter((r) => r.status === "completed");
    expect(sumCents(completed.map((r) => r.amount))).toBe(cents(riverbend.balances[0]!.available));
  });
});

describe("money in this month", () => {
  it("is the completed money in dated in the balance's month (November 2026)", () => {
    expect(moneyInThisMonth()).toEqual({ month: "2026-11", monthName: "November", count: 1, total: 630 });
  });

  it("agrees with the helper column the strip sums inside Studio", () => {
    expect(sumCents(ledgerRows().map((r) => r.moneyInThisMonth))).toBe(cents(moneyInThisMonth().total));
  });
});

describe("the balance's as-of time", () => {
  it("is set in the club's time zone, so the header and the strip print the same words", () => {
    const asOf = riverbend.balances[0]!.asOf;
    expect(formatAsOf(asOf)).toBe("Nov 3, 10:30 AM CST");
    expect(formatAsOf(new Date(asOf))).toBe(formatAsOf(asOf));
    expect(balanceStamp()).toBe(`PayPal sandbox · balance as of ${formatAsOf(asOf)}`);
  });

  it("prints nothing for a missing time rather than 'Invalid Date'", () => {
    expect(formatAsOf("")).toBe("");
  });
});

describe("the month a time falls in", () => {
  it("names the balance's month, the one the strip's money-in cell is labelled with", () => {
    const asOf = riverbend.balances[0]!.asOf;
    expect(monthNameOf(asOf)).toBe("November");
    expect(monthNameOf(new Date(asOf))).toBe(moneyInThisMonth().monthName);
  });

  it("reads the month in the club's time zone, not UTC (04:30 UTC on Nov 1 is Oct 31 in Chicago)", () => {
    expect(monthNameOf("2026-11-01T04:30:00Z")).toBe("October");
  });

  it("is empty for a missing or unreadable time", () => {
    expect(monthNameOf("")).toBe("");
    expect(monthNameOf("not a date")).toBe("");
  });
});

function ledgerless(data: ClubDemoData) {
  return { ...data, ledger: [] };
}
