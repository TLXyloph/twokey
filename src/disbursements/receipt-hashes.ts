/**
 * The sample receipts a payout request can point to (fictional, spec §4), with the SHA-256 each
 * request hash binds. PLACEHOLDER: the Risk context renders the receipts into public/receipts/ and
 * owns their real hashes, labels and image paths (src/disbursements/risk/receipts.ts); until it is
 * wired in at integration every hash here reads "pending".
 */
import type { ReceiptId } from "@/ledger/contracts";

export const RECEIPT_HASH_PENDING = "pending";

export interface ReceiptEntry {
  id: ReceiptId;
  /** As the drawer shows it beside the thumbnail. */
  label: string;
  imageUrl: string;
  /** SHA-256 (hex) of the receipt image, or "pending" until the Risk context supplies it. */
  sha256: string;
}

export const RECEIPTS: readonly ReceiptEntry[] = [
  { id: "gloves-team-supply", label: "Riverbend Team Supply receipt: goalkeeper gloves", imageUrl: "/receipts/gloves-team-supply.png", sha256: RECEIPT_HASH_PENDING },
  { id: "paint-bluebird-hardware", label: "Bluebird Hardware receipt: field paint", imageUrl: "/receipts/paint-bluebird-hardware.png", sha256: RECEIPT_HASH_PENDING },
  { id: "cones-team-supply", label: "Riverbend Team Supply receipt: practice cones", imageUrl: "/receipts/cones-team-supply.png", sha256: RECEIPT_HASH_PENDING },
  { id: "bibs-team-supply", label: "Riverbend Team Supply receipt: training bibs", imageUrl: "/receipts/bibs-team-supply.png", sha256: RECEIPT_HASH_PENDING },
];

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
