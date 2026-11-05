import { describe, expect, it } from "vitest";
import { riverbend, type ClubDemoData } from "@/demo/riverbend";
import { fixtureWatchtower, STRANGER_SEND, TREASURER_SEND } from "@/ui/judge/dev/watchtower-fixture";
import {
  balanceFigures,
  eventTakings,
  flaggedLine,
  latestLines,
  ledgerNewestFirst,
  money,
  parentFinding,
  parentWatch,
  signedMoney,
  storyEventId,
} from "@/ui/parent/parent-model";

/** The seed plus one banquet capture of two tickets, as the fold appends it. */
function withBanquet(): ClubDemoData {
  return {
    ...riverbend,
    events: [
      ...riverbend.events,
      {
        id: "banquet",
        name: "End-of-season banquet",
        date: "2026-11-21",
        unitLabel: "tickets",
        unitsLogged: 2,
        unitPrice: 15,
        expected: 30,
        received: 30,
        notes: "",
      },
    ],
    ledger: [
      ...riverbend.ledger,
      {
        id: "CAPTURE-1",
        date: "2026-11-05",
        description: "End-of-season banquet tickets",
        counterparty: "Banquet tickets (PayPal)",
        category: "fundraising",
        direction: "in",
        amount: 30,
        status: "completed",
        eventId: "banquet",
        requestedBy: null,
      },
    ],
    balances: [{ ...riverbend.balances[0]!, available: 5028.75, asOf: "2026-11-05T20:14:00Z" }],
  };
}

describe("money", () => {
  it("drops the cents of a whole-dollar sum and keeps them otherwise, with a true minus", () => {
    expect(money(1305)).toBe("$1,305");
    expect(money(22.5)).toBe("$22.50");
    expect(money(-1290)).toBe("−$1,290");
    expect(signedMoney(30)).toBe("+$30.00");
    expect(signedMoney(-42)).toBe("−$42.00");
  });
});

describe("the ledger, newest first", () => {
  it("opens the seed on the two payouts waiting for a second key, then November's registrations", () => {
    const lines = latestLines(riverbend, 3);
    expect(lines.map((l) => l.id)).toEqual(["L15", "L14", "L13"]);
    expect(lines[0]).toMatchObject({ day: "Nov 3", amount: "−$36.50", status: "Waiting for a second key", waiting: true });
    expect(lines[2]).toMatchObject({ amount: "+$630.00", status: "Received", waiting: false });
  });

  it("puts a ticket bought today on top: the row a parent sees arrive", () => {
    const [first] = latestLines(withBanquet(), 1);
    expect(first).toMatchObject({ id: "CAPTURE-1", day: "Nov 5", amount: "+$30.00", status: "Received" });
  });

  it("orders rows on one day by when the ledger recorded them, last first", () => {
    const lines = ledgerNewestFirst(riverbend).filter((l) => l.date === "2026-10-24");
    expect(lines.map((l) => l.id)).toEqual(["L11", "L10"]);
    expect(ledgerNewestFirst(riverbend)).toHaveLength(riverbend.ledger.length);
  });
});

describe("each event's takings", () => {
  const events = eventTakings(riverbend);

  it("tells the car wash's gap without naming a cause", () => {
    const carWash = events.find((e) => e.id === "car-wash")!;
    expect(carWash).toMatchObject({ received: "$15", expected: "$1,305", gapCents: 129_000, day: "October 24" });
    expect(carWash.sentence).toBe(
      "87 cars at $15 each make $1,305 expected. One $15 payment is recorded; the ledger has no record of the other $1,290.",
    );
    expect(carWash.sentence).not.toMatch(/missing|stolen|taken|theft/i);
  });

  it("says when an event reconciles, with cents where the price has them", () => {
    expect(events.find((e) => e.id === "fun-run")!.sentence).toBe("64 runners at $20 each make $1,280 expected. All $1,280 is recorded.");
    expect(events.find((e) => e.id === "spirit-wear")!.sentence).toBe("48 items at $22.50 each make $1,080 expected. All $1,080 is recorded.");
  });

  it("lists events in date order and opens on the largest gap", () => {
    expect(events.map((e) => e.id)).toEqual(["fun-run", "spirit-wear", "car-wash"]);
    expect(storyEventId(events)).toBe("car-wash");
  });

  it("adds the banquet once a ticket is bought", () => {
    const withTickets = eventTakings(withBanquet());
    expect(withTickets.at(-1)!.sentence).toBe("2 tickets at $15 each make $30 expected. All $30 is recorded.");
    expect(storyEventId(withTickets)).toBe("car-wash");
  });

  it("opens on the latest event when every event reconciles, and handles one unit and no payment", () => {
    const reconciled = eventTakings({ ...riverbend, events: riverbend.events.filter((e) => e.id !== "car-wash") });
    expect(storyEventId(reconciled)).toBe("spirit-wear");
    const lone = eventTakings({
      ...riverbend,
      ledger: [],
      events: [{ ...riverbend.events[2]!, unitsLogged: 1, expected: 15, received: 0 }],
    });
    expect(lone[0]!.sentence).toBe("1 car at $15 each make $15 expected. No payment is recorded against it; the ledger has no record of the other $15.");
  });
});

describe("the balance, for the phone", () => {
  it("states the balance with its as-of time, what waits, and this month's money in", () => {
    expect(balanceFigures(riverbend)).toEqual({
      balance: "$4,998.75",
      asOf: "As of Nov 3, 10:30 AM CST",
      waitingTotal: "$78.50",
      waitingCaption: "2 payouts, not paid yet",
      moneyIn: "$630.00",
      moneyInLabel: "Money in, November",
      balanceLine: "In the club account, as of Nov 3, 10:30 AM CST",
      waitingLine: "Waiting for a second key: 2 payouts, not paid yet",
    });
  });

  it("stays whole without a balance row", () => {
    expect(balanceFigures({ ...riverbend, balances: [] })).toMatchObject({ balance: "$0.00", asOf: "", moneyInLabel: "Money in this month" });
    const none = { ...riverbend, ledger: riverbend.ledger.filter((row) => row.status !== "pending") };
    expect(balanceFigures(none)).toMatchObject({ waitingTotal: "$0.00", waitingLine: "Nothing is waiting for a second key" });
  });
});

describe("the Watchtower, as a parent sees it", () => {
  it("drops a masked email but keeps an officer's name", () => {
    expect(STRANGER_SEND.counterparty).toContain("@");
    expect(parentFinding(STRANGER_SEND)).toMatchObject({ counterparty: null, counterpartyIsOfficer: false, amountCents: STRANGER_SEND.amountCents });
    expect(parentFinding(TREASURER_SEND)).toBe(TREASURER_SEND);
  });

  it("cleans open and explained findings alike, and keeps the status and the as-of time", () => {
    const watch = fixtureWatchtower("ok", new Date("2026-11-05T17:00:00Z"))!;
    const seen = parentWatch(watch)!;
    expect(seen.status).toBe("ok");
    expect(seen.paypalAsOf).toBe(watch.paypalAsOf);
    expect(JSON.stringify(seen)).not.toContain("@");
    expect(seen.findings).toHaveLength(watch.findings.length);
    expect(seen.explained).toHaveLength(watch.explained.length);
    expect(parentWatch(null)).toBeNull();
  });
});

describe("the newest open finding, pinned over the latest rows", () => {
  const now = new Date("2026-11-05T17:00:00Z");

  it("is the newest open finding, as a ledger-shaped row with PayPal's time", () => {
    const line = flaggedLine(parentWatch(fixtureWatchtower("stale", now)));
    expect(line).toEqual({
      id: `watch-${TREASURER_SEND.transactionId}`,
      day: "Nov 3",
      description: "Sent from PayPal's website to Esther Huang (Treasurer)",
      note: "Not two-key: the Watchtower flagged it. PayPal recorded it Nov 3, 2:27 PM CST.",
      amount: "−$3.21",
      more: 1,
    });
  });

  it("names no one when PayPal names no one a parent may see", () => {
    const line = flaggedLine({ ...fixtureWatchtower("ok", now)!, findings: [parentFinding(STRANGER_SEND)] });
    expect(line?.description).toBe("Sent from PayPal's website");
    expect(line?.day).toBe("Nov 2");
    expect(line?.more).toBe(0);
  });

  it("is absent while loading, without a view, or with nothing open", () => {
    expect(flaggedLine("loading")).toBeNull();
    expect(flaggedLine(null)).toBeNull();
    expect(flaggedLine({ ...fixtureWatchtower("ok", now)!, findings: [] })).toBeNull();
  });
});
