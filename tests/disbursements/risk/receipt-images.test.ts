import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { RECEIPTS } from "@/disbursements/risk/receipts";
import { assetReceiptImages, fileReceiptImages, isAssetFetcher, loadReceiptImage } from "@/disbursements/risk/receipt-images";

const PUBLIC_DIR = fileURLToPath(new URL("../../../public", import.meta.url));
const gloves = RECEIPTS["gloves-team-supply"];
const glovesBytes = readFileSync(`${PUBLIC_DIR}${gloves.imageUrl}`);

describe("assetReceiptImages (the Worker's ASSETS binding)", () => {
  it("fetches the PNG by its public path, as OpenNext serves public/", async () => {
    const fetch = vi.fn(async (_request: Request) => new Response(glovesBytes, { status: 200 }));
    const bytes = await assetReceiptImages({ fetch }).read(gloves);
    expect(new URL(fetch.mock.calls[0]![0].url).pathname).toBe("/receipts/gloves-team-supply.png");
    expect(Buffer.from(bytes).equals(glovesBytes)).toBe(true);
  });

  it("fails on a missing asset", async () => {
    const images = assetReceiptImages({ fetch: async () => new Response("not found", { status: 404 }) });
    await expect(images.read(gloves)).rejects.toThrow(/404/);
  });

  it("recognises a binding by its fetch function", () => {
    expect(isAssetFetcher({ fetch: () => undefined })).toBe(true);
    expect(isAssetFetcher(undefined)).toBe(false);
    expect(isAssetFetcher({})).toBe(false);
  });
});

describe("fileReceiptImages (next dev and the record script)", () => {
  it("reads the PNG from the public folder", async () => {
    const bytes = await fileReceiptImages(PUBLIC_DIR).read(gloves);
    expect(Buffer.from(bytes).equals(glovesBytes)).toBe(true);
  });
});

describe("loadReceiptImage", () => {
  it("returns the image as base64 PNG once its bytes match the committed SHA-256", async () => {
    const image = await loadReceiptImage({ read: async () => new Uint8Array(glovesBytes) }, gloves);
    expect(image).toEqual({ mediaType: "image/png", base64: glovesBytes.toString("base64") });
  });

  it("refuses bytes that don't match the committed hash", async () => {
    const tampered = new Uint8Array(glovesBytes);
    tampered[tampered.length - 1] = (tampered.at(-1) ?? 0) ^ 0xff;
    await expect(loadReceiptImage({ read: async () => tampered }, gloves)).rejects.toThrow(/SHA-256/);
  });
});
