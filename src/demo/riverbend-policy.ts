/**
 * The club's hand-written policy for the demo (fictional, "demo data"): who the officers are, and
 * the season budget each payout is charged to. The risk checks read both (spec §4): a payee who is
 * an officer or shares an officer's surname or address, and a request over what's left on its line.
 */
import type { BudgetLineId, OfficerRole } from "@/ledger/contracts";

export interface OfficerRecord {
  role: OfficerRole;
  name: string;
  /** Street address on file (fictional). */
  address: string;
}

export const OFFICER_DIRECTORY: readonly OfficerRecord[] = [
  { role: "treasurer", name: "Esther Huang", address: "212 Willow Bend Rd, Riverbend" },
  { role: "president", name: "Marcus Bell", address: "48 Cedar Hollow Ln, Riverbend" },
  { role: "secretary", name: "Priya Natarajan", address: "9 Quarry St, Riverbend" },
];

/**
 * The Reviewer (fictional): a non-signer who signs the monthly close and holds no payout key, so
 * it stays out of `OFFICER_DIRECTORY`, which lists the payout keys the risk checks compare payees with.
 */
export const REVIEWER = { role: "reviewer", name: "Nora Lindgren" } as const;

export interface BudgetLine {
  id: BudgetLineId;
  label: string;
  /** The ledger `category` this line covers. */
  category: string;
  /** Approved for the fall 2026 season, in cents. */
  approvedCents: number;
}

export const BUDGET_LINES: readonly BudgetLine[] = [
  { id: "equipment", label: "Equipment", category: "equipment", approvedCents: 70_000 },
  { id: "facilities", label: "Facilities", category: "facilities", approvedCents: 40_000 },
  { id: "officials", label: "Officials", category: "officials", approvedCents: 90_000 },
  { id: "fundraising-costs", label: "Fundraising costs", category: "fundraising costs", approvedCents: 100_000 },
  { id: "concessions", label: "Concessions", category: "concessions", approvedCents: 25_000 },
  { id: "field-maintenance", label: "Field maintenance", category: "field maintenance", approvedCents: 15_000 },
  { id: "banquet", label: "End-of-season banquet", category: "banquet", approvedCents: 30_000 },
];

export function budgetLineById(id: string): BudgetLine | undefined {
  return BUDGET_LINES.find((line) => line.id === id);
}
