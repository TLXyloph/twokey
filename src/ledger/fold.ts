/**
 * The session fold (spec §2): seed rows + this session's events -> `BoardView`.
 *
 * - Payouts: a request's row is pending while it waits and completed once sent (or confirmed); a
 *   blocked or failed payout never left the account, so its row is dropped. The seeded L14/L15
 *   rows come from the seed; a judge's own requests are appended as live rows.
 * - Money in: each completed capture is a completed row (event "banquet", counterparty "Banquet
 *   tickets (PayPal)" or "(Venmo)"); the banquet's FundraisingEvent appears with the first one.
 * - Each sent payout also gets PayPal's $0.25 payout fee as its own completed row, right after it
 *   (measured in the sandbox: a $1 payout cost $1.25).
 * - The available balance is the seed's, plus captures, minus sent payouts and their fees, so
 *   completed rows still sum to it. Its as-of time is the latest event that moved it.
 * `src/demo/board-figures.ts` reads the folded `data` as it reads the seed.
 */
import { budgetLineById } from "@/demo/riverbend-policy";
import { CLUB_TIME_ZONE, type ClubDemoData, type FundraisingEvent, type LedgerEntry } from "@/demo/riverbend";
import {
  DAILY_PAYOUT_LIMIT_CENTS,
  PAYOUT_CAP_CENTS,
  SESSION_PAYOUT_LIMIT,
  TICKET_PRICE_CENTS,
  type BoardView,
  type LedgerEvent,
  type LedgerEventPayloads,
  type PayoutRequestView,
} from "./contracts";
import { projectRequests, requestStatus, type RequestState } from "./request-projection";
import { toRequestView } from "./request-view";

export interface FoldExtras {
  sharedBalance: BoardView["sharedBalance"];
  /** payout.sent cents across all sessions since the start of today (UTC). */
  dailySentCents: number;
  /** The chain's head when the session has no events yet. */
  seedHash: string;
  /** The global Watchtower's state, read beside the session (src/watchtower/); null when unread. */
  watchtower?: BoardView["watchtower"];
}

export const BANQUET_EVENT_ID = "banquet";
const BANQUET = { name: "End-of-season banquet", date: "2026-11-21", unitLabel: "tickets" } as const;

const dateFormat = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: CLUB_TIME_ZONE });
/** "2026-11-05": the day an ISO time falls on, in the club's time zone. */
const clubDate = (iso: string): string => dateFormat.format(new Date(iso));
const dollars = (cents: number): number => cents / 100;
const toCents = (amount: number): number => Math.round(amount * 100);

type Captured = { payload: LedgerEventPayloads["payment.captured"]; at: string };

function capturesOf(events: readonly LedgerEvent[]): Captured[] {
  const seen = new Set<string>();
  const captured: Captured[] = [];
  for (const event of events) {
    if (event.type !== "payment.captured") continue;
    const payload = event.payload as LedgerEventPayloads["payment.captured"];
    if (payload.status !== "COMPLETED" || payload.eventId !== BANQUET_EVENT_ID || seen.has(payload.captureId)) continue;
    seen.add(payload.captureId);
    captured.push({ payload, at: event.occurredAt });
  }
  return captured;
}

function banquetEvent(events: readonly LedgerEvent[], captured: readonly Captured[]): FundraisingEvent {
  const quantities = new Map<string, number>();
  for (const event of events) {
    if (event.type === "order.created") {
      const order = event.payload as LedgerEventPayloads["order.created"];
      quantities.set(order.orderId, order.quantity);
    }
  }
  const unitsLogged = captured.reduce((total, c) => total + (quantities.get(c.payload.orderId) ?? 0), 0);
  const unitPrice = dollars(TICKET_PRICE_CENTS);
  return {
    id: BANQUET_EVENT_ID,
    ...BANQUET,
    unitsLogged,
    unitPrice,
    expected: dollars(unitsLogged * TICKET_PRICE_CENTS),
    received: dollars(captured.reduce((total, c) => total + c.payload.amountCents, 0)),
    notes: "Tickets bought on the banquet page with PayPal or Venmo (live sandbox), at $15 each.",
  };
}

function captureRow(c: Captured): LedgerEntry {
  return {
    id: c.payload.captureId,
    date: clubDate(c.at),
    description: "End-of-season banquet tickets",
    counterparty: `Banquet tickets (${c.payload.method === "venmo" ? "Venmo" : "PayPal"})`,
    category: "fundraising",
    direction: "in",
    amount: dollars(c.payload.amountCents),
    status: "completed",
    eventId: BANQUET_EVENT_ID,
    requestedBy: null,
  };
}

const isOut = (state: RequestState) => ["sent", "confirmed"].includes(requestStatus(state));
const isDropped = (state: RequestState) => ["blocked", "failed"].includes(requestStatus(state));

function requestRow(state: RequestState): LedgerEntry {
  const { request } = state;
  return {
    id: request.requestId,
    date: clubDate(request.createdAt),
    description: request.description,
    counterparty: request.payeeName,
    category: budgetLineById(request.budgetLine)?.category ?? request.budgetLine,
    direction: "out",
    amount: -dollars(request.amountCents),
    status: isOut(state) ? "completed" : "pending",
    eventId: null,
    requestedBy: request.requestedBy,
  };
}

/** PayPal's fee per US payout item (measured 2026-11-03: a $1 payout took $1.25). */
export const PAYOUT_FEE_CENTS = 25;

function feeRow(state: RequestState, payoutRow: LedgerEntry): LedgerEntry {
  return {
    id: `${state.request.requestId}:fee`,
    date: payoutRow.date,
    description: `PayPal payout fee: ${state.request.description}`,
    counterparty: "PayPal",
    category: "fees",
    direction: "out",
    amount: -dollars(PAYOUT_FEE_CENTS),
    status: "completed",
    eventId: null,
    requestedBy: null,
  };
}

function foldData(seed: ClubDemoData, events: readonly LedgerEvent[], states: readonly RequestState[]): ClubDemoData {
  const byId = new Map(states.map((state) => [state.request.requestId, state]));
  const seedIds = new Set(seed.ledger.map((row) => row.id));
  const ledger: LedgerEntry[] = [];
  for (const row of seed.ledger) {
    const state = byId.get(row.id);
    if (state && isDropped(state)) continue;
    if (state && isOut(state)) ledger.push({ ...row, status: "completed" }, feeRow(state, row));
    else ledger.push({ ...row });
  }
  const captured = capturesOf(events);
  for (const state of states) {
    if (seedIds.has(state.request.requestId) || isDropped(state)) continue;
    const row = requestRow(state);
    ledger.push(row, ...(isOut(state) ? [feeRow(state, row)] : []));
  }
  ledger.push(...captured.map(captureRow));

  const sent = states.filter(isOut);
  const [balance, ...otherBalances] = seed.balances;
  const movedAt = [...captured.map((c) => c.at), ...sent.map((s) => s.sent?.at ?? s.confirmations[0]?.at ?? "")].filter(Boolean).sort();
  const balances = balance
    ? [
        {
          ...balance,
          available: dollars(
            toCents(balance.available) +
              captured.reduce((total, c) => total + c.payload.amountCents, 0) -
              sent.reduce((total, s) => total + s.request.amountCents + PAYOUT_FEE_CENTS, 0),
          ),
          asOf: movedAt.at(-1) ?? balance.asOf,
        },
        ...otherBalances,
      ]
    : [];
  const fundraisers = captured.length > 0 ? [...seed.events, banquetEvent(events, captured)] : [...seed.events];
  return { ...seed, events: fundraisers, ledger, balances };
}

function order(views: PayoutRequestView[]): PayoutRequestView[] {
  const newestFirst = (a: PayoutRequestView, b: PayoutRequestView) => b.createdAt.localeCompare(a.createdAt);
  return [...views.filter((v) => v.status === "waiting").sort(newestFirst), ...views.filter((v) => v.status !== "waiting").sort(newestFirst)];
}

export function foldBoard(seed: ClubDemoData, events: readonly LedgerEvent[], extras: FoldExtras): BoardView {
  const states = projectRequests(events);
  const sentCount = events.filter((event) => event.type === "payout.sent").length;
  return {
    data: foldData(seed, events, states),
    requests: order(states.map(toRequestView)),
    sharedBalance: extras.sharedBalance,
    limits: {
      payoutCapCents: PAYOUT_CAP_CENTS,
      sessionPayoutsLeft: Math.max(0, SESSION_PAYOUT_LIMIT - sentCount),
      dailyCentsLeft: Math.max(0, DAILY_PAYOUT_LIMIT_CENTS - extras.dailySentCents),
    },
    chain: { length: events.length, head: events.at(-1)?.hash ?? extras.seedHash },
    watchtower: extras.watchtower ?? null,
  };
}
