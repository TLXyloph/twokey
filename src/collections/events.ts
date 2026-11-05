/**
 * The Collections context's events: what a parent can buy tickets for, and what an order costs.
 * The server prices every order from here; the browser sends only the event and the quantity,
 * never an amount. Money is integer cents (USD) everywhere.
 */
import { MAX_TICKETS_PER_ORDER, TICKET_PRICE_CENTS, type CreateOrderBody, type Currency } from "@/ledger/contracts";

export type CollectionEventId = CreateOrderBody["eventId"];

export interface CollectionEvent {
  id: CollectionEventId;
  name: string;
  /** ISO date (YYYY-MM-DD), in the club's time zone. */
  date: string;
  /** How the parent page shows the date. */
  dateLabel: string;
  /** What one ticket is called on PayPal's review screen. */
  itemName: string;
  ticketPriceCents: number;
  minTickets: number;
  maxTickets: number;
  currency: Currency;
}

/** A new event, so judges' payments never change the car wash's finding on the board. */
export const BANQUET: CollectionEvent = Object.freeze({
  id: "banquet",
  name: "End-of-season banquet",
  date: "2026-11-21",
  dateLabel: "Sat, Nov 21",
  itemName: "Banquet ticket",
  ticketPriceCents: TICKET_PRICE_CENTS,
  minTickets: 1,
  maxTickets: MAX_TICKETS_PER_ORDER,
  currency: "USD",
});

const EVENTS: ReadonlyMap<string, CollectionEvent> = new Map([[BANQUET.id, BANQUET]]);

export function findCollectionEvent(id: string): CollectionEvent | undefined {
  return EVENTS.get(id);
}

export interface PricedOrder {
  eventId: CollectionEventId;
  quantity: number;
  unitAmountCents: number;
  amountCents: number;
  currency: Currency;
  /** "End-of-season banquet × 2": the order's description on PayPal. */
  description: string;
  itemName: string;
}

/** The server's price for `quantity` tickets. Throws a RangeError outside 1..maxTickets. */
export function priceOrder(event: CollectionEvent, quantity: number): PricedOrder {
  if (!Number.isInteger(quantity) || quantity < event.minTickets || quantity > event.maxTickets) {
    throw new RangeError(`quantity must be a whole number from ${event.minTickets} to ${event.maxTickets}`);
  }
  return {
    eventId: event.id,
    quantity,
    unitAmountCents: event.ticketPriceCents,
    amountCents: event.ticketPriceCents * quantity,
    currency: event.currency,
    description: `${event.name} × ${quantity}`,
    itemName: event.itemName,
  };
}
