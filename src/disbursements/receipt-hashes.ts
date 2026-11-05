/**
 * The sample receipts a payout request can point to, as the Disbursements context reads them: the
 * id, the label and image the drawer shows, and the SHA-256 a request hash binds. The Risk context
 * owns the receipts themselves (src/disbursements/risk/receipts.ts, with a test that recomputes
 * each PNG's hash); this module only reshapes them.
 */
import type { ReceiptId } from "@/ledger/contracts";
import { RECEIPTS as SAMPLE_RECEIPTS } from "./risk/receipts";

export interface ReceiptEntry {
  id: ReceiptId;
  /** As the drawer shows it beside the thumbnail. */
  label: string;
  imageUrl: string;
  /** SHA-256 (hex) of the receipt image. */
  sha256: string;
}

export const RECEIPTS: readonly ReceiptEntry[] = (Object.keys(SAMPLE_RECEIPTS) as ReceiptId[]).map((id) => ({
  id,
  label: SAMPLE_RECEIPTS[id].label,
  imageUrl: SAMPLE_RECEIPTS[id].imageUrl,
  sha256: SAMPLE_RECEIPTS[id].sha256,
}));

export const RECEIPT_IDS = RECEIPTS.map((receipt) => receipt.id) as [ReceiptId, ...ReceiptId[]];

export function receiptById(id: string): ReceiptEntry | undefined {
  return RECEIPTS.find((receipt) => receipt.id === id);
}

/** The hash a request binds for this receipt. Throws for an unknown id (validated at the boundary). */
export function receiptSha256(id: ReceiptId): string {
  const receipt = receiptById(id);
  if (!receipt) throw new Error(`unknown receipt ${id}`);
  return receipt.sha256;
}
