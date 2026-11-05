import { describe, expect, it } from "vitest";
import { parseSearchPage, type TransactionRow } from "@/payments/paypal/transactions";
import { classifyRows, findingFrom, PAYOUT_LABELS, routeLabel } from "@/watchtower/classify";
import { maskEmail, nameCounterparty } from "@/watchtower/names";
import measured from "../fixtures/paypal/transaction-search-2026-11-05.json";

const fixture = parseSearchPage(measured)!;

const row = (over: Partial<TransactionRow>): TransactionRow => ({
  transactionId: "TXN",
  eventCode: "T0000",
  amountCents: -100,
  feeCents: 0,
  currency: "USD",
  initiatedAt: "2026-11-04T10:00:00Z",
  status: "S",
  referenceId: null,
  customField: null,
  counterpartyEmail: null,
  ...over,
});

describe("classifyRows on the measured club account (Nov 1-5)", () => {
  const result = classifyRows(fixture.rows, fixture.lastRefreshed);

  it("finds exactly two outside debits: the two website sends, both covered by the linked bank", () => {
    const outside = result.debits.filter((d) => d.route === "outside_debit");
    expect(outside.map((d) => [d.transactionId, d.eventCode, d.amountCents, d.fundedByBank, d.label])).toEqual([
      ["22N17109956532336", "T0000", 321, true, "Sent from PayPal's website"],
      ["1TY14748YE721631B", "T0000", 321, true, "Sent from PayPal's website"],
    ]);
  });

  it("names the treasurer as an officer and masks an unknown counterparty", () => {
    const byId = new Map(result.debits.map((d) => [d.transactionId, d]));
    expect(byId.get("1TY14748YE721631B")).toMatchObject({ counterparty: "Esther Huang (Treasurer)", counterpartyIsOfficer: true, at: "2026-11-03T20:27:29Z" });
    expect(byId.get("22N17109956532336")).toMatchObject({ counterparty: "sb-wdq…@personal.example.com", counterpartyIsOfficer: false });
  });

  it("hands the two T0001 payouts on to be traced, with the fee counted in what left", () => {
    const payouts = result.debits.filter((d) => d.route === "payout");
    expect(payouts.map((d) => [d.transactionId, d.amountCents, d.sentCents, d.customField, d.counterparty])).toEqual([
      ["3XT37311AK7894010", 125, 100, "item-1", "PayPal's payout simulator"],
      ["23Y96953CP0068646", 125, 100, "item-1", "PayPal's payout simulator"],
    ]);
    expect(payouts.every((d) => !d.fundedByBank)).toBe(true);
  });

  it("never treats credits, holds or releases as debits, and pairs each funding row with its debit", () => {
    expect(result.debits).toHaveLength(4);
    expect(result.fundingPairs).toEqual([
      { debitId: "22N17109956532336", fundingId: "30S826037D3388322" },
      { debitId: "1TY14748YE721631B", fundingId: "0UN74527JS883252U" },
    ]);
    expect(result.lastRefreshed).toBe("2026-11-05T08:59:59Z");
  });
});

describe("classifyRows rules", () => {
  it("flags every other debit as outside the two-key flow, in plain words", () => {
    const rows = [
      row({ transactionId: "W", eventCode: "T0400", amountCents: -5000 }),
      row({ transactionId: "P", eventCode: "T0006", amountCents: -1200, feeCents: -50 }),
      row({ transactionId: "A", eventCode: "T1201", amountCents: -300 }),
      row({ transactionId: "U", eventCode: "T9999", amountCents: -1 }),
    ];
    expect(classifyRows(rows, null).debits.map((d) => [d.transactionId, d.route, d.amountCents, d.label])).toEqual([
      ["W", "outside_debit", 5000, "Withdrawn to a bank"],
      ["P", "outside_debit", 1250, "Paid from the PayPal account"],
      ["A", "outside_debit", 300, "Adjusted by PayPal"],
      ["U", "outside_debit", 1, "Money left the PayPal account"],
    ]);
  });

  it("ignores holds and releases (T15xx, T11xx) even when they take money, and credits", () => {
    const rows = [
      row({ transactionId: "H", eventCode: "T1503", amountCents: -125 }),
      row({ transactionId: "R", eventCode: "T1105", amountCents: -10 }),
      row({ transactionId: "C", eventCode: "T0011", amountCents: 900 }),
      row({ transactionId: "Z", eventCode: "T0000", amountCents: 0 }),
    ];
    expect(classifyRows(rows, null).debits).toEqual([]);
  });

  it("ignores a denied debit: no money moved", () => {
    expect(classifyRows([row({ status: "D" })], null).debits).toEqual([]);
  });

  it("marks a debit funded by the bank only when a T03xx credit names it", () => {
    const rows = [
      row({ transactionId: "D1", amountCents: -321 }),
      row({ transactionId: "D2", amountCents: -500 }),
      row({ transactionId: "F1", eventCode: "T0300", amountCents: 321, referenceId: "D1" }),
      row({ transactionId: "X", eventCode: "T0011", amountCents: 500, referenceId: "D2" }),
      row({ transactionId: "F9", eventCode: "T0300", amountCents: 100, referenceId: "NOT-A-ROW" }),
    ];
    const result = classifyRows(rows, null);
    expect(result.debits.map((d) => [d.transactionId, d.fundedByBank])).toEqual([
      ["D1", true],
      ["D2", false],
    ]);
    expect(result.fundingPairs).toEqual([{ debitId: "D1", fundingId: "F1" }]);
  });

  it("labels each route in plain words", () => {
    expect(routeLabel("T0000")).toBe("Sent from PayPal's website");
    expect(routeLabel("T0001")).toBe(PAYOUT_LABELS.untraced);
    expect(routeLabel("T0403")).toBe("Withdrawn to a bank");
    expect(routeLabel("T0106")).toBe("Fee charged by PayPal");
    expect(routeLabel("T0700")).toBe("Spent with a PayPal debit card");
  });
});

describe("findingFrom", () => {
  const debit = classifyRows(fixture.rows, null).debits.find((d) => d.transactionId === "1TY14748YE721631B")!;

  it("builds the stored finding, with the delay as an upper bound in minutes", () => {
    expect(findingFrom(debit, { kind: "outside_debit", label: debit.label, firstSeenAt: "2026-11-03T22:30:00Z", backfill: false, explanation: null })).toEqual({
      transactionId: "1TY14748YE721631B",
      kind: "outside_debit",
      eventCode: "T0000",
      label: "Sent from PayPal's website",
      amountCents: 321,
      counterparty: "Esther Huang (Treasurer)",
      counterpartyIsOfficer: true,
      at: "2026-11-03T20:27:29Z",
      firstSeenAt: "2026-11-03T22:30:00Z",
      reportedAfterMinutes: 123,
      fundedByBank: true,
      explanation: null,
    });
  });

  it("leaves the delay unknown for a backfilled row", () => {
    const finding = findingFrom(debit, { kind: "outside_debit", label: debit.label, firstSeenAt: "2026-11-05T15:00:00Z", backfill: true, explanation: null });
    expect(finding.reportedAfterMinutes).toBeNull();
  });
});

describe("counterparty names", () => {
  it("maps the known sandbox accounts to names", () => {
    expect(nameCounterparty("sb-6j9x4753696003@personal.example.com")).toEqual({ counterparty: "Esther Huang (Treasurer)", isOfficer: true });
    expect(nameCounterparty("SB-6OOCJ53656441@business.example.com")).toEqual({ counterparty: "Riverbend Team Supply", isOfficer: false });
    expect(nameCounterparty("payouts-simulator-receiver@paypal.com")).toEqual({ counterparty: "PayPal's payout simulator", isOfficer: false });
    expect(nameCounterparty(null)).toEqual({ counterparty: null, isOfficer: false });
  });

  it("masks any other email, never showing it in full", () => {
    expect(maskEmail("sb-wdqmv53686001@personal.example.com")).toBe("sb-wdq…@personal.example.com");
    expect(maskEmail("ab@x.test")).toBe("a…@x.test");
    expect(maskEmail("not-an-email")).toBe("not-an…");
    expect(nameCounterparty("someone.else@example.test")).toEqual({ counterparty: "someon…@example.test", isOfficer: false });
  });
});
