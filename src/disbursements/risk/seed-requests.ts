/**
 * The two seeded payout requests as the risk check reads them (spec §7; DEMO DATA):
 *   L14  goalkeeper gloves, $42.00 to Riverbend Team Supply, requested by the treasurer (equipment)
 *   L15  field-paint reimbursement, $36.50 to the treasurer, requested by the secretary
 *        (field maintenance)
 *
 * Their recorded cards (recorded-cards.json) are keyed by the prompt, so they are served only if
 * the ledger seeds these requests with the same prompt facts: payee name, amount, description,
 * budget line, receipt, requester, and `createdAt` on the same calendar day in Chicago time (not
 * the time the session opened). The ids, hashes and emails here are placeholders: the prompt never
 * contains them.
 */
import { payeeById } from "@/disbursements/payees";
import type { LedgerEventPayloads, PayeeId } from "@/ledger/contracts";
import { RECEIPTS } from "./receipts";

type PayoutRequest = LedgerEventPayloads["payout.requested"];

function payee(id: PayeeId): { payeeId: PayeeId; payeeName: string; payeeEmail: string } {
  const found = payeeById(id);
  if (!found) throw new Error(`seed-requests: unknown payee ${id}`);
  return { payeeId: id, payeeName: found.name, payeeEmail: found.email };
}

export interface SeedRiskRequest {
  /** For people reading recorded-cards.json. */
  label: string;
  request: PayoutRequest;
}

const gloves: PayoutRequest = {
    requestId: "seed-L14",
    requestHash: "",
    ...payee("team-supply"),
    amountCents: 4200,
    currency: "USD",
    description: "Goalkeeper gloves",
    budgetLine: "equipment",
    receiptId: "gloves-team-supply",
    receiptSha256: RECEIPTS["gloves-team-supply"].sha256,
    requestedBy: "treasurer",
    createdAt: "2026-11-02T15:00:00.000Z",
    source: "seed",
};

const paint: PayoutRequest = {
    requestId: "seed-L15",
    requestHash: "",
    ...payee("treasurer-reimbursement"),
    amountCents: 3650,
    currency: "USD",
    description: "Field-paint reimbursement",
    budgetLine: "field-maintenance",
    receiptId: "paint-bluebird-hardware",
    receiptSha256: RECEIPTS["paint-bluebird-hardware"].sha256,
    requestedBy: "secretary",
    createdAt: "2026-11-03T15:00:00.000Z",
    source: "seed",
};

export const SEED_RISK_REQUESTS: readonly SeedRiskRequest[] = [
  { label: "L14 goalkeeper gloves (seed)", request: gloves },
  { label: "L15 field-paint reimbursement (seed)", request: paint },
];

/** Every session starts with both seeded requests, so each one's check sees the other. */
export const SEED_SESSION_REQUESTS: readonly PayoutRequest[] = [gloves, paint];
