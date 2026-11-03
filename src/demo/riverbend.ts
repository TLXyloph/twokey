/**
 * DEMO DATA. Everything in this file is fictional, made up for the TwoKey demo.
 *
 * The Riverbend Youth Football League does not exist. Every payee and payer is a role or an invented
 * vendor, never a real person or organisation. Amounts are USD, as a PayPal sandbox account would
 * show them.
 *
 * The story: three fundraisers in October 2026. The fun run and the spirit-wear sale reconcile.
 * The car wash logged 87 cars at $15 ($1,305 expected), but the ledger records only one $15 PayPal
 * payment against it. The data does not say where the rest went, and nothing here should claim it does.
 */

export const CLUB_NAME = "Riverbend Youth Football League (demo data)";
export const DEMO_DATA_LABEL = "demo data";

export type LedgerDirection = "in" | "out";
/** `pending` payouts are waiting for a second approver and are not yet out of the account. */
export type LedgerStatus = "completed" | "pending";

export interface FundraisingEvent {
  id: string;
  name: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** What was counted, e.g. "cars". */
  unitLabel: string;
  /** Units the volunteers logged on the day. */
  unitsLogged: number;
  unitPrice: number;
  /** unitsLogged x unitPrice. */
  expected: number;
  /** Money in recorded against the event in the ledger. */
  received: number;
  notes: string;
}

export interface LedgerEntry {
  id: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  description: string;
  counterparty: string;
  category: string;
  direction: LedgerDirection;
  /** Signed USD: money in is positive, money out negative. */
  amount: number;
  status: LedgerStatus;
  /** The fundraising event this row belongs to, if any. */
  eventId: string | null;
}

export interface AccountBalance {
  id: string;
  account: string;
  currency: "USD";
  /** Completed money in minus completed money out. Pending payouts are not deducted. */
  available: number;
  /** ISO date-time the balance was read. */
  asOf: string;
}

export interface ClubDemoData {
  club: string;
  events: FundraisingEvent[];
  ledger: LedgerEntry[];
  balances: AccountBalance[];
}

const events: FundraisingEvent[] = [
  {
    id: "fun-run",
    name: "Fun run",
    date: "2026-10-10",
    unitLabel: "runners",
    unitsLogged: 64,
    unitPrice: 20,
    expected: 1280,
    received: 1280,
    notes: "64 runners registered online at $20 each. Entry fees deposited in one batch.",
  },
  {
    id: "spirit-wear",
    name: "Spirit-wear sale",
    date: "2026-10-17",
    unitLabel: "items",
    unitsLogged: 48,
    unitPrice: 22.5,
    expected: 1080,
    received: 1080,
    notes: "48 shirts and hoodies sold at $22.50 each on the sale-day card reader.",
  },
  {
    id: "car-wash",
    name: "Car wash",
    date: "2026-10-24",
    unitLabel: "cars",
    unitsLogged: 87,
    unitPrice: 15,
    expected: 1305,
    received: 15,
    notes:
      "87 cars on the volunteer tally sheet at $15 each. One $15 PayPal payment is recorded; " +
      "no other deposit for this event appears in the ledger.",
  },
];

const ledger: LedgerEntry[] = [
  {
    id: "L01",
    date: "2026-10-01",
    description: "Opening balance carried forward from September",
    counterparty: "Club account",
    category: "opening balance",
    direction: "in",
    amount: 2549,
    status: "completed",
    eventId: null,
  },
  {
    id: "L02",
    date: "2026-10-03",
    description: "Fall registration fees (20 players x $90)",
    counterparty: "Family registrations (batch)",
    category: "registration",
    direction: "in",
    amount: 1800,
    status: "completed",
    eventId: null,
  },
  {
    id: "L03",
    date: "2026-10-05",
    description: "Practice balls and cones",
    counterparty: "Riverbend Team Supply",
    category: "equipment",
    direction: "out",
    amount: -412.5,
    status: "completed",
    eventId: null,
  },
  {
    id: "L04",
    date: "2026-10-10",
    description: "Fun run entry fees (64 runners x $20)",
    counterparty: "Online entries (batch)",
    category: "fundraising",
    direction: "in",
    amount: 1280,
    status: "completed",
    eventId: "fun-run",
  },
  {
    id: "L05",
    date: "2026-10-11",
    description: "Field permit, fall season",
    counterparty: "Riverbend Parks Permit Office",
    category: "facilities",
    direction: "out",
    amount: -350,
    status: "completed",
    eventId: null,
  },
  {
    id: "L06",
    date: "2026-10-12",
    description: "Fun run medals and bibs",
    counterparty: "Maple Lane Trophies",
    category: "fundraising costs",
    direction: "out",
    amount: -286,
    status: "completed",
    eventId: "fun-run",
  },
  {
    id: "L07",
    date: "2026-10-17",
    description: "Spirit-wear sale (48 items x $22.50)",
    counterparty: "Sale-day card reader (batch)",
    category: "fundraising",
    direction: "in",
    amount: 1080,
    status: "completed",
    eventId: "spirit-wear",
  },
  {
    id: "L08",
    date: "2026-10-18",
    description: "Spirit-wear printing",
    counterparty: "Kestrel Print & Embroidery",
    category: "fundraising costs",
    direction: "out",
    amount: -624,
    status: "completed",
    eventId: "spirit-wear",
  },
  {
    id: "L09",
    date: "2026-10-19",
    description: "Referee fees, October",
    counterparty: "Referee pool (league-appointed)",
    category: "officials",
    direction: "out",
    amount: -480,
    status: "completed",
    eventId: null,
  },
  {
    id: "L10",
    date: "2026-10-24",
    description: "Car wash, PayPal payment (1 car)",
    counterparty: "Car-wash customer (PayPal)",
    category: "fundraising",
    direction: "in",
    amount: 15,
    status: "completed",
    eventId: "car-wash",
  },
  {
    id: "L11",
    date: "2026-10-24",
    description: "Car wash supplies (soap, sponges, buckets)",
    counterparty: "Bluebird Hardware",
    category: "fundraising costs",
    direction: "out",
    amount: -38.75,
    status: "completed",
    eventId: "car-wash",
  },
  {
    id: "L12",
    date: "2026-10-28",
    description: "Concession stand restock",
    counterparty: "Hillside Snack Co.",
    category: "concessions",
    direction: "out",
    amount: -164,
    status: "completed",
    eventId: null,
  },
  {
    id: "L13",
    date: "2026-11-01",
    description: "Late registration fees (7 players x $90)",
    counterparty: "Family registrations (batch)",
    category: "registration",
    direction: "in",
    amount: 630,
    status: "completed",
    eventId: null,
  },
  {
    id: "L14",
    date: "2026-11-02",
    description: "Goalkeeper gloves (awaiting second approver)",
    counterparty: "Riverbend Team Supply",
    category: "equipment",
    direction: "out",
    amount: -129,
    status: "pending",
    eventId: null,
  },
  {
    id: "L15",
    date: "2026-11-03",
    description: "Referee fees, November (awaiting second approver)",
    counterparty: "Referee pool (league-appointed)",
    category: "officials",
    direction: "out",
    amount: -360,
    status: "pending",
    eventId: null,
  },
];

const balances: AccountBalance[] = [
  {
    id: "club-account",
    account: "Club account (PayPal sandbox)",
    currency: "USD",
    available: 4998.75,
    asOf: "2026-11-03T16:30:00Z",
  },
];

/** The whole demo data set. Treat it as read-only. */
export const riverbend: ClubDemoData = { club: CLUB_NAME, events, ledger, balances };
