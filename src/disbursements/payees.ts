/**
 * The fixed list of payees a judge can pay (spec §3). No free-text emails: every payout goes to a
 * PayPal sandbox account we control, so the Watchtower can match it and nothing leaves the sandbox.
 * These are sandbox addresses, not secrets.
 */
import type { OfficerRole, PayeeId } from "@/ledger/contracts";

export interface Payee {
  id: PayeeId;
  /** As the board and the drawer show it. */
  name: string;
  /** The PayPal sandbox account a payout to this payee goes to. */
  email: string;
  /** Set when the payee is an officer: that officer can never sign a payout to themselves. */
  role: OfficerRole | null;
}

export const PAYEES: readonly Payee[] = [
  {
    id: "team-supply",
    name: "Riverbend Team Supply",
    email: "sb-6oocj53656441@business.example.com",
    role: null,
  },
  {
    id: "treasurer-reimbursement",
    name: "Esther Huang (Treasurer), reimbursement",
    email: "sb-6j9x4753696003@personal.example.com",
    role: "treasurer",
  },
];

export function payeeById(id: string): Payee | undefined {
  return PAYEES.find((payee) => payee.id === id);
}
