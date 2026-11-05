import { describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "@/ledger/contracts";
import { signPayout } from "@/disbursements/approve";
import { payeeById } from "@/disbursements/payees";
import { runRiskRead } from "@/disbursements/risk-read";
import type { JudgedDebit } from "@/watchtower/classify";
import { tracePayout, type TraceSources } from "@/watchtower/trace";
import { deps, harness, SESSION, type Harness } from "../disbursements/harness";

const VENDOR = payeeById("team-supply")!.email;

/** A session in which L14 ($42 to the vendor) was signed by two officers and sent as BATCH-1. */
async function sentL14(): Promise<Harness> {
  const h = await harness();
  await runRiskRead(deps(h), SESSION, "L14");
  expect(await signPayout(deps(h), SESSION, "L14", { actingAs: "president", acknowledgedFlags: false })).toEqual({ kind: "signed", executed: "sent" });
  return h;
}

const debit = (over: Partial<JudgedDebit> = {}): JudgedDebit => ({
  transactionId: "T0001-TXN",
  eventCode: "T0001",
  route: "payout",
  label: "Payout outside the two-key flow",
  amountCents: 4225,
  sentCents: 4200,
  counterparty: "Riverbend Team Supply",
  counterpartyIsOfficer: false,
  counterpartyEmail: VENDOR,
  customField: "L14",
  at: "2026-11-05T15:10:00Z",
  fundedByBank: false,
  ...over,
});

function sources(h: Harness, over: Partial<TraceSources> = {}) {
  const mocks = {
    payoutBatchIdForTransaction: vi.fn<TraceSources["payoutBatchIdForTransaction"]>(async () => null),
    requestByPayoutBatchId: vi.fn<TraceSources["requestByPayoutBatchId"]>((id) => h.table.requestByPayoutBatchId(id)),
    sessionsThatSent: vi.fn<TraceSources["sessionsThatSent"]>(async () => []),
    events: vi.fn<TraceSources["events"]>((sessionId) => h.table.events(sessionId)),
    ...over,
  };
  return mocks;
}

/** Key 2's signature replaced by key 1's: the chain is intact, the signature isn't. */
const forgedKey2 = (events: LedgerEvent[]): LedgerEvent[] => {
  const signed = events.filter(
    (e): e is LedgerEvent<"approval.signed"> => e.type === "approval.signed" && (e as LedgerEvent<"approval.signed">).payload.requestId === "L14",
  );
  const [key1, key2] = signed;
  return events.map((e) => (e === key2 ? { ...e, payload: { ...key2.payload, signature: key1!.payload.signature } } : e));
};

describe("tracePayout: through the stored webhook", () => {
  it("matches a T0001 whose webhook names a batch the ledger sent with two valid signatures", async () => {
    const h = await sentL14();
    const s = sources(h, { payoutBatchIdForTransaction: vi.fn(async () => "BATCH-1") });
    expect(await tracePayout(debit(), s, h.verifier)).toEqual({ kind: "matched", via: "webhook", sessionId: SESSION, requestId: "L14" });
    expect(s.payoutBatchIdForTransaction).toHaveBeenCalledWith("T0001-TXN");
    expect(s.requestByPayoutBatchId).toHaveBeenCalledWith("BATCH-1");
    expect(s.sessionsThatSent).not.toHaveBeenCalled();
  });

  it("flags a batch no session's ledger sent as untraced, without falling back to custom_field", async () => {
    const h = await sentL14();
    const s = sources(h, { payoutBatchIdForTransaction: vi.fn(async () => "SPIKE-BATCH") });
    expect(await tracePayout(debit(), s, h.verifier)).toEqual({ kind: "untraced", reason: "no_ledger_payout" });
    expect(s.sessionsThatSent).not.toHaveBeenCalled();
  });

  it("flags a traced payout whose second signature doesn't verify", async () => {
    const h = await sentL14();
    const s = sources(h, {
      payoutBatchIdForTransaction: vi.fn(async () => "BATCH-1"),
      events: vi.fn(async (id: string) => forgedKey2(await h.table.events(id))),
    });
    expect(await tracePayout(debit(), s, h.verifier)).toEqual({ kind: "unsigned", via: "webhook", reason: "signatures" });
  });

  it("flags a traced payout when the money that left isn't what was signed", async () => {
    const h = await sentL14();
    const s = sources(h, { payoutBatchIdForTransaction: vi.fn(async () => "BATCH-1") });
    expect(await tracePayout(debit({ sentCents: 4900 }), s, h.verifier)).toEqual({ kind: "unsigned", via: "webhook", reason: "amount_mismatch" });
    expect(await tracePayout(debit({ counterpartyEmail: "someone-else@example.test" }), s, h.verifier)).toEqual({
      kind: "unsigned",
      via: "webhook",
      reason: "payee_mismatch",
    });
  });

  it("matches without the receiver's email when PayPal leaves it off the row", async () => {
    const h = await sentL14();
    const s = sources(h, { payoutBatchIdForTransaction: vi.fn(async () => "BATCH-1") });
    expect(await tracePayout(debit({ counterpartyEmail: null }), s, h.verifier)).toMatchObject({ kind: "matched" });
  });
});

describe("tracePayout: fallback when no webhook was stored", () => {
  it("matches by custom_field (the request id) + amount + receiver email to a ledger payout.sent", async () => {
    const h = await sentL14();
    const s = sources(h, { sessionsThatSent: vi.fn(async () => ["another-session", SESSION]) });
    expect(await tracePayout(debit({ counterpartyEmail: VENDOR.toUpperCase() }), s, h.verifier)).toEqual({
      kind: "matched",
      via: "custom_field",
      sessionId: SESSION,
      requestId: "L14",
    });
    expect(s.sessionsThatSent).toHaveBeenCalledWith("L14");
  });

  it("is untraced when the amount or receiver doesn't match any session's payout", async () => {
    const h = await sentL14();
    const s = sources(h, { sessionsThatSent: vi.fn(async () => [SESSION]) });
    expect(await tracePayout(debit({ sentCents: 100 }), s, h.verifier)).toEqual({ kind: "untraced", reason: "no_ledger_payout" });
    expect(await tracePayout(debit({ counterpartyEmail: "someone-else@example.test" }), s, h.verifier)).toEqual({ kind: "untraced", reason: "no_ledger_payout" });
    expect(await tracePayout(debit({ counterpartyEmail: null }), s, h.verifier)).toEqual({ kind: "untraced", reason: "no_ledger_payout" });
  });

  it("flags a payout that matches the facts but not two valid signatures", async () => {
    const h = await sentL14();
    const s = sources(h, {
      sessionsThatSent: vi.fn(async () => [SESSION]),
      events: vi.fn(async (id: string) => forgedKey2(await h.table.events(id))),
    });
    expect(await tracePayout(debit(), s, h.verifier)).toEqual({ kind: "unsigned", via: "custom_field", reason: "signatures" });
  });

  it("is untraced without a custom_field, and for the setup-test payouts (item-1) the ledger never sent", async () => {
    const h = await sentL14();
    const s = sources(h);
    expect(await tracePayout(debit({ customField: null }), s, h.verifier)).toEqual({ kind: "untraced", reason: "no_custom_field" });
    expect(await tracePayout(debit({ customField: "item-1", sentCents: 100, counterpartyEmail: "payouts-simulator-receiver@paypal.com" }), s, h.verifier)).toEqual({
      kind: "untraced",
      reason: "no_ledger_payout",
    });
  });
});
