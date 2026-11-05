import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ReceiptId } from "@/ledger/contracts";
import { RECEIPTS, receiptById } from "@/disbursements/risk/receipts";

const PUBLIC_DIR = fileURLToPath(new URL("../../../public", import.meta.url));
const pngBytes = (imageUrl: string) => readFileSync(`${PUBLIC_DIR}${imageUrl}`);

/** Width and height from the PNG's IHDR chunk (bytes 16-23, big-endian). */
const pngSize = (bytes: Buffer) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });

const ALL_IDS: ReceiptId[] = ["gloves-team-supply", "paint-bluebird-hardware", "cones-team-supply", "bibs-team-supply"];

describe("sample receipts", () => {
  it("has exactly the contract's four receipt ids, each keyed by its own id", () => {
    expect(Object.keys(RECEIPTS).sort()).toEqual([...ALL_IDS].sort());
    for (const id of ALL_IDS) expect(RECEIPTS[id].id).toBe(id);
  });

  it.each(ALL_IDS)("%s: the committed SHA-256 is the hash of the PNG's bytes", (id) => {
    const receipt = RECEIPTS[id];
    expect(receipt.imageUrl).toBe(`/receipts/${id}.png`);
    const digest = createHash("sha256").update(pngBytes(receipt.imageUrl)).digest("hex");
    expect(receipt.sha256).toBe(digest);
  });

  it.each(ALL_IDS)("%s: the recorded size is the PNG's size, and its items add up to its total", (id) => {
    const receipt = RECEIPTS[id];
    expect(pngSize(pngBytes(receipt.imageUrl))).toEqual({ width: receipt.width, height: receipt.height });
    const sum = receipt.facts.items.reduce((total, item) => total + item.amountCents, 0);
    expect(sum).toBe(receipt.facts.totalCents);
  });

  it("matches the story: two clean Team Supply receipts, one with a non-league item, one over the cap", () => {
    expect(RECEIPTS["gloves-team-supply"].facts).toMatchObject({ vendor: "Riverbend Team Supply", date: "2026-11-01", totalCents: 4200 });
    expect(RECEIPTS["paint-bluebird-hardware"].facts).toMatchObject({ vendor: "Bluebird Hardware", date: "2026-11-02", totalCents: 3650 });
    expect(RECEIPTS["paint-bluebird-hardware"].facts.items.map((item) => item.amountCents)).toEqual([2450, 1200]);
    expect(RECEIPTS["cones-team-supply"].facts).toMatchObject({ date: "2026-11-04", totalCents: 4800 });
    expect(RECEIPTS["bibs-team-supply"].facts.totalCents).toBeGreaterThan(5000);
  });

  it("looks a receipt up by id, and returns undefined for an unknown one", () => {
    expect(receiptById("cones-team-supply")?.label).toMatch(/cones/i);
    expect(receiptById("nope")).toBeUndefined();
    expect(receiptById("toString")).toBeUndefined();
  });
});
