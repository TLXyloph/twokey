/**
 * The four fictional sample receipts a judge can attach to a payout request (spec §4). The ids are
 * fixed in src/ledger/contracts.ts; the images are served from /receipts/<id>.png. Receipt upload is
 * out of scope, so these are the only choices.
 */
import type { ReceiptId } from "@/ledger/contracts";

export interface SampleReceipt {
  id: ReceiptId;
  /** As the picker and the drawer show it. */
  label: string;
  imageUrl: string;
}

const receipt = (id: ReceiptId, label: string): SampleReceipt => ({ id, label, imageUrl: `/receipts/${id}.png` });

export const SAMPLE_RECEIPTS: readonly SampleReceipt[] = [
  receipt("gloves-team-supply", "Team Supply: goalkeeper gloves, $42"),
  receipt("paint-bluebird-hardware", "Bluebird Hardware: field paint, $36.50"),
  receipt("cones-team-supply", "Team Supply: practice cones, $48"),
  receipt("bibs-team-supply", "Team Supply: training bibs, $64"),
];

export const sampleReceipt = (id: string) => SAMPLE_RECEIPTS.find((r) => r.id === id);
