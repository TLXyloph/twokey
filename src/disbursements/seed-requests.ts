/**
 * The two payout requests every judge session starts with (spec §2, §7): the seed's pending rows
 * L14 and L15, as requests. Amount, description, requester and date come from the rows in
 * src/demo/riverbend.ts, so the board's seed rows and the ledger's requests can't drift apart.
 */
import type { BudgetLineId, PayeeId, ReceiptId } from "@/ledger/contracts";
import { riverbend, type LedgerEntry } from "@/demo/riverbend";
import type { RequestFacts } from "./request-payload";

interface SeededRequestSpec {
  requestId: "L14" | "L15";
  payeeId: PayeeId;
  budgetLine: BudgetLineId;
  receiptId: ReceiptId;
}

const SPECS: readonly SeededRequestSpec[] = [
  { requestId: "L14", payeeId: "team-supply", budgetLine: "equipment", receiptId: "gloves-team-supply" },
  { requestId: "L15", payeeId: "treasurer-reimbursement", budgetLine: "field-maintenance", receiptId: "paint-bluebird-hardware" },
];

/** The time of day a seeded request is stamped with, on its row's date. */
const SEED_REQUEST_TIME = "T15:00:00.000Z";

function fromRow(spec: SeededRequestSpec, rows: readonly LedgerEntry[]): RequestFacts {
  const row = rows.find((candidate) => candidate.id === spec.requestId);
  if (!row || row.status !== "pending" || row.requestedBy === null) throw new Error(`seed row ${spec.requestId} is not a pending request`);
  return {
    ...spec,
    amountCents: Math.round(-row.amount * 100),
    description: row.description,
    requestedBy: row.requestedBy,
    createdAt: `${row.date}${SEED_REQUEST_TIME}`,
    source: "seed",
  };
}

export const SEEDED_REQUESTS: readonly RequestFacts[] = SPECS.map((spec) => fromRow(spec, riverbend.ledger));

export const SEEDED_REQUEST_IDS: ReadonlySet<string> = new Set(SPECS.map((spec) => spec.requestId));
