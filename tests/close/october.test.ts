import { describe, expect, it } from "vitest";
import { CLOSE_MONTH, type CloseException } from "@/close/contracts";
import { closeHash, computeMonthClose, monthPeriod, octoberClose, SEED_TWO_KEY_ROW_IDS } from "@/close/october";
import { canonicalJson } from "@/ledger/canonical";
import { riverbend, type ClubDemoData } from "@/demo/riverbend";
import { BUDGET_LINES } from "@/demo/riverbend-policy";

const cents = (amount: number) => Math.round(amount * 100);
const sumRows = (filter: (row: ClubDemoData["ledger"][number]) => boolean) =>
  riverbend.ledger.filter(filter).reduce((total, row) => total + cents(row.amount), 0);
const kind = <K extends CloseException["kind"]>(list: CloseException[], k: K) =>
  list.filter((e): e is Extract<CloseException, { kind: K }> => e.kind === k);

describe("October 2026's close, from the seed", () => {
  const close = octoberClose();

  it("states the month statement: $2,549.00 + $4,175.00 - $2,355.25 = $4,368.75", () => {
    expect(close.month).toBe("2026-10");
    expect(close.period).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(close.openingCents).toBe(254_900);
    expect(close.moneyInCents).toBe(417_500);
    expect(close.moneyOutCents).toBe(235_525);
    expect(close.closingCents).toBe(436_875);
    expect(close.openingCents + close.moneyInCents - close.moneyOutCents).toBe(close.closingCents);
  });

  it("reconciles with the seed's rows: every completed October row is counted once", () => {
    const october = (row: ClubDemoData["ledger"][number]) => row.status === "completed" && row.date.startsWith("2026-10");
    expect(close.openingCents + close.moneyInCents - close.moneyOutCents).toBe(sumRows(october));
    expect(close.moneyIn.map((r) => r.rowId)).toEqual(["L02", "L04", "L07", "L10"]);
    const paid = close.budgetLines.flatMap((line) => line.payments.map((p) => p.rowId)).sort();
    expect(paid).toEqual(["L03", "L05", "L06", "L08", "L09", "L11", "L12"]);
    expect(close.budgetLines.reduce((t, l) => t + l.spentCents, 0)).toBe(close.moneyOutCents);
  });

  it("carries forward to the account balance: closing + November's completed rows = $4,998.75", () => {
    expect(close.carriedForward).toEqual({ laterCents: 63_000, balanceCents: 499_875, balanceAsOf: "2026-11-03T16:30:00Z", reconciles: true });
    expect(close.closingCents + close.carriedForward.laterCents).toBe(cents(riverbend.balances[0]!.available));
  });

  it("keeps the opening balance out of money in", () => {
    expect(close.moneyIn.some((r) => r.rowId === "L01")).toBe(false);
  });

  it("puts each payment on its budget line, approved for the season against spent", () => {
    const line = (id: string) => close.budgetLines.find((l) => l.id === id)!;
    expect(close.budgetLines.map((l) => l.id)).toEqual(BUDGET_LINES.map((l) => l.id));
    expect(line("equipment")).toMatchObject({ approvedCents: 70_000, spentCents: 41_250, leftCents: 28_750 });
    expect(line("facilities")).toMatchObject({ approvedCents: 40_000, spentCents: 35_000, leftCents: 5_000 });
    expect(line("officials")).toMatchObject({ approvedCents: 90_000, spentCents: 48_000, leftCents: 42_000 });
    expect(line("fundraising-costs")).toMatchObject({ approvedCents: 100_000, spentCents: 94_875, leftCents: 5_125 });
    expect(line("fundraising-costs").payments.map((p) => p.rowId)).toEqual(["L06", "L08", "L11"]);
    expect(line("concessions")).toMatchObject({ approvedCents: 25_000, spentCents: 16_400, leftCents: 8_600 });
    expect(line("field-maintenance")).toMatchObject({ spentCents: 0, leftCents: 15_000, payments: [] });
    expect(line("banquet")).toMatchObject({ spentCents: 0, leftCents: 30_000, payments: [] });
  });

  it("has no open items: both waiting payouts were requested in November", () => {
    expect(close.openItems).toEqual([]);
  });

  it("lists the car-wash gap first: 87 cars x $15 = $1,305 expected, $15 received", () => {
    const [first] = close.exceptions;
    expect(first).toEqual({
      kind: "takings_gap",
      eventId: "car-wash",
      name: "Car wash",
      date: "2026-10-24",
      unitLabel: "cars",
      unitsLogged: 87,
      unitPriceCents: 1_500,
      expectedCents: 130_500,
      receivedCents: 1_500,
      missingCents: 129_000,
    });
    expect(kind(close.exceptions, "takings_gap")).toHaveLength(1);
  });

  it("treats the seed's 7 October payments as two-key approved (demo data), so the car-wash gap is the only exception", () => {
    expect([...SEED_TWO_KEY_ROW_IDS]).toEqual(["L03", "L05", "L06", "L08", "L09", "L11", "L12"]);
    expect(close.exceptions.map((e) => e.kind)).toEqual(["takings_gap"]);
    expect(kind(close.exceptions, "no_two_key_record")).toEqual([]);
    expect(close.twoKeyRecord).toEqual({ payments: 7, signed: 0, seedApproved: 7 });
  });

  it("still flags a payout without both signatures: one that isn't in the seed and that two officers didn't sign", () => {
    const data: ClubDemoData = {
      ...riverbend,
      ledger: [
        ...riverbend.ledger,
        { id: "S1", date: "2026-10-30", description: "Cones", counterparty: "Riverbend Team Supply", category: "equipment", direction: "out", amount: -20, status: "completed", eventId: null, requestedBy: null },
      ],
    };
    const unsigned = computeMonthClose(data, CLOSE_MONTH, { seedApprovedRowIds: SEED_TWO_KEY_ROW_IDS });
    expect(kind(unsigned.exceptions, "no_two_key_record")).toEqual([
      { kind: "no_two_key_record", count: 1, totalCents: 2_000, rowIds: ["S1"], firstSignedRequestDate: "2026-11-02" },
    ]);
    expect(unsigned.twoKeyRecord).toEqual({ payments: 8, signed: 0, seedApproved: 7 });
    expect(unsigned.exceptions.map((e) => e.kind)).toEqual(["takings_gap", "no_two_key_record"]);

    const signed = computeMonthClose(data, CLOSE_MONTH, { seedApprovedRowIds: SEED_TWO_KEY_ROW_IDS, signedPayoutRowIds: new Set(["S1"]) });
    expect(kind(signed.exceptions, "no_two_key_record")).toEqual([]);
    expect(signed.twoKeyRecord).toEqual({ payments: 8, signed: 1, seedApproved: 7 });
  });

  it("counts a payment two officers signed as signed, even when the seed would treat it as approved", () => {
    const result = computeMonthClose(riverbend, CLOSE_MONTH, { seedApprovedRowIds: SEED_TWO_KEY_ROW_IDS, signedPayoutRowIds: new Set(["L03"]) });
    expect(result.twoKeyRecord).toEqual({ payments: 7, signed: 1, seedApproved: 6 });
  });

  it("flags every payment when nothing is on record as two-key approved (TwoKey's first signed request is Nov 2)", () => {
    const bare = computeMonthClose(riverbend, CLOSE_MONTH);
    expect(kind(bare.exceptions, "no_two_key_record")).toEqual([
      { kind: "no_two_key_record", count: 7, totalCents: 235_525, rowIds: ["L03", "L05", "L06", "L08", "L09", "L11", "L12"], firstSignedRequestDate: "2026-11-02" },
    ]);
    expect(bare.twoKeyRecord).toEqual({ payments: 7, signed: 0, seedApproved: 0 });
  });

  it("drops the two-key exception for payments two officers signed", () => {
    const signed = new Set(["L03", "L05", "L06", "L08", "L09", "L11", "L12"]);
    expect(kind(computeMonthClose(riverbend, CLOSE_MONTH, { signedPayoutRowIds: signed }).exceptions, "no_two_key_record")).toEqual([]);
  });

  it("flags an overspent line and a payment on no budget line", () => {
    const data: ClubDemoData = {
      ...riverbend,
      ledger: [
        ...riverbend.ledger,
        { id: "X1", date: "2026-10-30", description: "Extra permit", counterparty: "Parks", category: "facilities", direction: "out", amount: -100, status: "completed", eventId: null, requestedBy: null },
        { id: "X2", date: "2026-10-30", description: "Gift cards", counterparty: "Shop", category: "gifts", direction: "out", amount: -25, status: "completed", eventId: null, requestedBy: null },
      ],
    };
    const exceptions = computeMonthClose(data, CLOSE_MONTH).exceptions;
    expect(kind(exceptions, "over_budget")).toEqual([{ kind: "over_budget", budgetLine: "facilities", label: "Facilities", approvedCents: 40_000, spentCents: 45_000, overCents: 5_000 }]);
    expect(kind(exceptions, "no_budget_line")).toEqual([{ kind: "no_budget_line", rowId: "X2", category: "gifts", description: "Gift cards", amountCents: 2_500 }]);
  });

  it("counts a pending payout dated in the month as an open item, not as money out", () => {
    const data: ClubDemoData = {
      ...riverbend,
      ledger: [
        ...riverbend.ledger,
        { id: "P1", date: "2026-10-31", description: "Cones", counterparty: "Riverbend Team Supply", category: "equipment", direction: "out", amount: -48, status: "pending", eventId: null, requestedBy: "treasurer" },
      ],
    };
    const result = computeMonthClose(data, CLOSE_MONTH);
    expect(result.openItems).toEqual([{ rowId: "P1", date: "2026-10-31", description: "Cones", counterparty: "Riverbend Team Supply", amountCents: 4_800, requestedBy: "treasurer" }]);
    expect(result.moneyOutCents).toBe(235_525);
  });

  it("is deterministic, and its hash is SHA-256 over the canonical JSON", async () => {
    const hash = await closeHash(close);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await closeHash(octoberClose())).toBe(hash);
    expect(canonicalJson(octoberClose())).toBe(canonicalJson(close));
  });

  it("changes its hash when any figure changes, the two-key record included", async () => {
    const hash = await closeHash(close);
    expect(await closeHash({ ...close, closingCents: close.closingCents + 1 })).not.toBe(hash);
    expect(await closeHash({ ...close, twoKeyRecord: { ...close.twoKeyRecord, seedApproved: 0 } })).not.toBe(hash);
  });

  it("is version 2 of the figures' shape (the two-key record was added)", () => {
    expect(close.version).toBe("twokey-close-v2");
  });

  it("names the club as demo data inside the hashed figures", () => {
    expect(close.club).toBe("Riverbend Youth Football League (demo data)");
  });
});

describe("monthPeriod", () => {
  it("knows each month's last day", () => {
    expect(monthPeriod("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthPeriod("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthPeriod("2026-11")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
  });
});
