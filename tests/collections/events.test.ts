import { describe, expect, it } from "vitest";
import { BANQUET, findCollectionEvent, priceOrder } from "@/collections/events";
import { MAX_TICKETS_PER_ORDER, TICKET_PRICE_CENTS } from "@/ledger/contracts";
import { formatPaypalValue, parsePaypalValue } from "@/payments/paypal/orders";

/** Amounts PayPal's sandbox uses to simulate a declined Venmo payment (R1, Venmo testing). */
const DECLINE_SIMULATING_VALUES = ["12.34", "21.43", "11.45", "10.23", "13.42"];

describe("the banquet event", () => {
  it("is the end-of-season banquet on Sat, Nov 21 2026, $15 a ticket, 1 to 4 per order", () => {
    expect(BANQUET).toMatchObject({
      id: "banquet",
      name: "End-of-season banquet",
      date: "2026-11-21",
      dateLabel: "Sat, Nov 21",
      ticketPriceCents: TICKET_PRICE_CENTS,
      maxTickets: MAX_TICKETS_PER_ORDER,
      currency: "USD",
    });
    expect(TICKET_PRICE_CENTS).toBe(1_500);
    expect(new Date(`${BANQUET.date}T12:00:00Z`).getUTCDay()).toBe(6); // a Saturday
  });

  it("is the only event on sale", () => {
    expect(findCollectionEvent("banquet")).toBe(BANQUET);
    for (const id of ["car-wash", "BANQUET", "", "banquet ", "__proto__", "toString"]) {
      expect(findCollectionEvent(id)).toBeUndefined();
    }
  });
});

describe("priceOrder", () => {
  it.each([
    [1, 1_500, "15.00"],
    [2, 3_000, "30.00"],
    [3, 4_500, "45.00"],
    [4, 6_000, "60.00"],
  ])("prices %i ticket(s) on the server: %i cents", (quantity, amountCents, value) => {
    const priced = priceOrder(BANQUET, quantity);
    expect(priced).toEqual({
      eventId: "banquet",
      quantity,
      unitAmountCents: 1_500,
      amountCents,
      currency: "USD",
      description: `End-of-season banquet × ${quantity}`,
      itemName: "Banquet ticket",
    });
    expect(formatPaypalValue(priced.amountCents)).toBe(value);
  });

  it.each([0, 5, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("refuses a quantity of %s", (quantity) => {
    expect(() => priceOrder(BANQUET, quantity)).toThrow(RangeError);
  });

  it("never lands on one of the sandbox's decline-simulating amounts", () => {
    for (let quantity = 1; quantity <= BANQUET.maxTickets; quantity++) {
      expect(DECLINE_SIMULATING_VALUES).not.toContain(formatPaypalValue(priceOrder(BANQUET, quantity).amountCents));
    }
  });
});

describe("PayPal money values", () => {
  it("formats integer cents as PayPal's two-decimal string", () => {
    expect(formatPaypalValue(0)).toBe("0.00");
    expect(formatPaypalValue(5)).toBe("0.05");
    expect(formatPaypalValue(1_500)).toBe("15.00");
    expect(formatPaypalValue(123_456)).toBe("1234.56");
  });

  it("refuses negative or fractional cents", () => {
    expect(() => formatPaypalValue(-1)).toThrow(RangeError);
    expect(() => formatPaypalValue(1.5)).toThrow(RangeError);
  });

  it("parses PayPal's value strings to integer cents without floating point", () => {
    expect(parsePaypalValue("15.00")).toBe(1_500);
    expect(parsePaypalValue("15")).toBe(1_500);
    expect(parsePaypalValue("15.5")).toBe(1_550);
    expect(parsePaypalValue("0.07")).toBe(7);
    expect(parsePaypalValue("1234.56")).toBe(123_456);
  });

  it.each(["", "-1.00", "1.234", "1e3", "abc", " 15.00", "15.00 ", "1,000.00", "99999999999.00"])(
    "refuses the value %j",
    (value) => {
      expect(parsePaypalValue(value)).toBeUndefined();
    },
  );
});
