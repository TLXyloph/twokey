/**
 * DEV ONLY: a banquet ticket "bought" a few seconds after the page opens, so the ledger's tick can be
 * seen and recorded without PayPal. Reached only through `/demo/ledger?fixture=1&arrive=1` in a
 * development build: ../parent-shell.tsx imports this module dynamically inside
 * `if (process.env.NODE_ENV !== "production")`, which the production bundler folds away.
 *
 * It adds what the fold (src/ledger/fold.ts) adds for one completed capture of two tickets: a
 * "Banquet tickets (PayPal)" row, the banquet event, and the balance moved by $30 with a new as-of time.
 */
import type { ClubDemoData } from "@/demo/riverbend";

const TICKETS = 2;
const PRICE = 15;

export function addBanquetCapture(data: ClubDemoData, at: Date): ClubDemoData {
  if (process.env.NODE_ENV === "production") throw new Error("The arrival overlay is for development only.");
  const amount = TICKETS * PRICE;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(at);
  const banquet = data.events.find((e) => e.id === "banquet");
  const events = banquet
    ? data.events.map((e) => (e.id === "banquet" ? { ...e, unitsLogged: e.unitsLogged + TICKETS, expected: e.expected + amount, received: e.received + amount } : e))
    : [
        ...data.events,
        {
          id: "banquet",
          name: "End-of-season banquet",
          date: "2026-11-21",
          unitLabel: "tickets",
          unitsLogged: TICKETS,
          unitPrice: PRICE,
          expected: amount,
          received: amount,
          notes: "Tickets bought on the banquet page with PayPal or Venmo (live sandbox), at $15 each.",
        },
      ];
  const [balance, ...rest] = data.balances;
  return {
    ...data,
    events,
    ledger: [
      ...data.ledger,
      {
        id: `DEV-CAPTURE-${at.getTime()}`,
        date: day,
        description: "End-of-season banquet tickets",
        counterparty: "Banquet tickets (PayPal)",
        category: "fundraising",
        direction: "in",
        amount,
        status: "completed",
        eventId: "banquet",
        requestedBy: null,
      },
    ],
    balances: balance ? [{ ...balance, available: Math.round((balance.available + amount) * 100) / 100, asOf: at.toISOString() }, ...rest] : [],
  };
}
