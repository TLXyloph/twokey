/**
 * Who money went to, in words a parent can read: the known sandbox accounts by name, anyone else
 * as a masked email (`sb-wdq…@personal.example.com`). A full email is never shown or stored.
 * The officer's and the vendor's addresses come from the fixed payee list, so they can't drift.
 */
import { payeeById } from "@/disbursements/payees";

export const PAYOUT_SIMULATOR_EMAIL = "payouts-simulator-receiver@paypal.com";

interface KnownAccount {
  name: string;
  isOfficer: boolean;
}

function knownAccounts(): Map<string, KnownAccount> {
  const known = new Map<string, KnownAccount>([[PAYOUT_SIMULATOR_EMAIL, { name: "PayPal's payout simulator", isOfficer: false }]]);
  const treasurer = payeeById("treasurer-reimbursement");
  const vendor = payeeById("team-supply");
  if (treasurer) known.set(treasurer.email.toLowerCase(), { name: "Esther Huang (Treasurer)", isOfficer: true });
  if (vendor) known.set(vendor.email.toLowerCase(), { name: vendor.name, isOfficer: false });
  return known;
}

const KNOWN = knownAccounts();

/** Keeps at most 6 characters (and at most half) of the part before the @. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  const local = at === -1 ? email : email.slice(0, at);
  const kept = local.slice(0, Math.min(6, Math.floor(local.length / 2)));
  return at === -1 ? `${kept}…` : `${kept}…${email.slice(at)}`;
}

export function nameCounterparty(email: string | null): { counterparty: string | null; isOfficer: boolean } {
  if (!email) return { counterparty: null, isOfficer: false };
  const known = KNOWN.get(email.trim().toLowerCase());
  return known ? { counterparty: known.name, isOfficer: known.isOfficer } : { counterparty: maskEmail(email.trim()), isOfficer: false };
}
