/**
 * The four sample receipts a payout request can attach (spec §4). DEMO DATA: the shops, addresses,
 * phone numbers (555-01xx) and card numbers are invented.
 *
 * The PNGs live in public/receipts/ (sources and the render script in public/receipts/src/). Each
 * `sha256` is the hex SHA-256 of the committed PNG's bytes: it goes into the request hash, and the
 * AI read checks the bytes against it before sending them. tests/disbursements/risk/receipts.test.ts
 * recomputes every hash, so a re-rendered image can't drift from this file unnoticed.
 *
 * `facts` is what each receipt shows. The AI reads the image, not these; they serve the tests and
 * the dev scripts.
 */
import type { ReceiptId } from "@/ledger/contracts";

export interface ReceiptFacts {
  vendor: string;
  address: string;
  /** ISO date printed on the receipt. */
  date: string;
  items: { description: string; amountCents: number }[];
  totalCents: number;
}

export interface SampleReceipt {
  id: ReceiptId;
  /** How the drawer names it. */
  label: string;
  /** Served from public/: "/receipts/<id>.png". */
  imageUrl: string;
  sha256: string;
  width: number;
  height: number;
  facts: ReceiptFacts;
}

const TEAM_SUPPLY = { vendor: "Riverbend Team Supply", address: "1400 Mill Race Rd, Riverbend" } as const;

export const RECEIPTS: Readonly<Record<ReceiptId, SampleReceipt>> = {
  "gloves-team-supply": {
    id: "gloves-team-supply",
    label: "Riverbend Team Supply: goalkeeper gloves, $42.00",
    imageUrl: "/receipts/gloves-team-supply.png",
    sha256: "abdecb81e99d3a512ff51ab9aee254d35f4326e2444e550115ba0b4ec0b7cd65",
    width: 720,
    height: 760,
    facts: {
      ...TEAM_SUPPLY,
      date: "2026-11-01",
      items: [{ description: "Goalkeeper gloves, size 8 (2 at $21.00)", amountCents: 4200 }],
      totalCents: 4200,
    },
  },
  "paint-bluebird-hardware": {
    id: "paint-bluebird-hardware",
    label: "Bluebird Hardware: field-marking paint and string lights, $36.50",
    imageUrl: "/receipts/paint-bluebird-hardware.png",
    sha256: "b9f3b27fdfe4bf3f643a70905c7f605168e9f91a4ba692312ea6df71cbff9acf",
    width: 720,
    height: 800,
    facts: {
      vendor: "Bluebird Hardware",
      address: "77 Ferry St, Riverbend",
      date: "2026-11-02",
      items: [
        { description: "Field-marking paint, white (2 at $12.25)", amountCents: 2450 },
        { description: "Patio string lights, 24 ft", amountCents: 1200 },
      ],
      totalCents: 3650,
    },
  },
  "cones-team-supply": {
    id: "cones-team-supply",
    label: "Riverbend Team Supply: practice cones, $48.00",
    imageUrl: "/receipts/cones-team-supply.png",
    sha256: "5fe9383b346fd87ffcbeace509007f65cee624b3ad7687095d56f662e5a5f3e8",
    width: 720,
    height: 760,
    facts: {
      ...TEAM_SUPPLY,
      date: "2026-11-04",
      items: [{ description: "Practice cones, set of 24", amountCents: 4800 }],
      totalCents: 4800,
    },
  },
  "bibs-team-supply": {
    id: "bibs-team-supply",
    label: "Riverbend Team Supply: training bibs, $64.00",
    imageUrl: "/receipts/bibs-team-supply.png",
    sha256: "ba5b402b136ef85550d4e06124df07362049d7a383cae4fd2adb6636ff7909d1",
    width: 720,
    height: 760,
    facts: {
      ...TEAM_SUPPLY,
      date: "2026-11-04",
      items: [{ description: "Training bibs, mesh, youth (16 at $4.00)", amountCents: 6400 }],
      totalCents: 6400,
    },
  },
};

export function receiptById(id: string): SampleReceipt | undefined {
  return Object.hasOwn(RECEIPTS, id) ? RECEIPTS[id as ReceiptId] : undefined;
}
