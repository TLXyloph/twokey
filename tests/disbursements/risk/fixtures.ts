/** Builders for the risk tests: payout requests and a small, fake club policy. */
import type { LedgerEntry } from "@/demo/riverbend";
import type { LedgerEventPayloads } from "@/ledger/contracts";
import type { RulesContext } from "@/disbursements/risk/rules";

export type PayoutRequest = LedgerEventPayloads["payout.requested"];

export const request = (over: Partial<PayoutRequest> = {}): PayoutRequest => ({
  requestId: "req-1",
  requestHash: "a".repeat(64),
  payeeId: "team-supply",
  payeeName: "Riverbend Team Supply",
  payeeEmail: "vendor@business.example.com",
  amountCents: 500,
  currency: "USD",
  description: "Practice cones",
  budgetLine: "equipment",
  receiptId: "cones-team-supply",
  receiptSha256: "b".repeat(64),
  requestedBy: "treasurer",
  createdAt: "2026-11-04T15:00:00.000Z",
  source: "session",
  ...over,
});

const row = (over: Partial<LedgerEntry>): LedgerEntry => ({
  id: "R",
  date: "2026-10-01",
  description: "row",
  counterparty: "someone",
  category: "equipment",
  direction: "out",
  amount: 0,
  status: "completed",
  eventId: null,
  requestedBy: null,
  ...over,
});

/** Equipment: $100.00 approved, $90.00 spent (completed); pending and other categories don't count. */
export const fakeContext = (over: Partial<RulesContext> = {}): RulesContext => ({
  budgetLines: [
    { id: "equipment", label: "Equipment", category: "equipment", approvedCents: 10_000 },
    { id: "field-maintenance", label: "Field maintenance", category: "field maintenance", approvedCents: 5_000 },
  ],
  officers: [
    { role: "treasurer", name: "Esther Huang", address: "212 Willow Bend Rd, Riverbend" },
    { role: "president", name: "Marcus Bell", address: "48 Cedar Hollow Ln, Riverbend" },
    { role: "secretary", name: "Priya Natarajan", address: "9 Quarry St, Riverbend" },
  ],
  payees: [
    { id: "team-supply", name: "Riverbend Team Supply", role: null },
    { id: "treasurer-reimbursement", name: "Esther Huang (Treasurer), reimbursement", role: "treasurer" },
  ],
  seedLedger: [
    row({ id: "S1", amount: -60 }),
    row({ id: "S2", amount: -30 }),
    row({ id: "S3", amount: -500, status: "pending" }),
    row({ id: "S4", amount: -700, category: "officials" }),
    row({ id: "S5", amount: 900, direction: "in", category: "equipment" }),
  ],
  ...over,
});
