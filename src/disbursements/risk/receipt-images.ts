/**
 * How a sample receipt's PNG reaches the AI read.
 *
 * On Workers: OpenNext copies public/ into the Worker's static assets, and the `ASSETS` binding
 * (wrangler.jsonc) serves them to code in the Worker without a network round trip. OpenNext's own
 * image route reads public/ files the same way (`env.ASSETS.fetch(new URL(path, ...))`). The
 * binding matches on the path, so the host in the URL is a placeholder.
 * Under `next dev` and in the record script there is no binding, so the file is read from public/.
 *
 * Either way the bytes are checked against the receipt's committed SHA-256 before they are sent:
 * the model reads exactly the image the request hash binds.
 */
import type { ReceiptImage } from "@/agents/treasurer/prompt";
import type { SampleReceipt } from "./receipts";

export interface ReceiptImages {
  read(receipt: SampleReceipt): Promise<Uint8Array>;
}

/** The slice of the Workers `Fetcher` (the ASSETS binding) used here. */
export interface AssetFetcher {
  fetch(request: Request): Promise<Response> | unknown;
}

export function isAssetFetcher(value: unknown): value is AssetFetcher {
  return typeof value === "object" && value !== null && typeof (value as { fetch?: unknown }).fetch === "function";
}

/** Cloudflare's convention (docs: Workers static assets, binding): only the pathname is matched. */
const ASSET_ORIGIN = "https://assets.local";

export function assetReceiptImages(assets: AssetFetcher): ReceiptImages {
  return {
    async read(receipt) {
      const response = (await assets.fetch(new Request(new URL(receipt.imageUrl, ASSET_ORIGIN)))) as Response;
      if (!response.ok) throw new Error(`receipt image ${receipt.id}: asset fetch returned ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

/** Reads `<publicDir>/receipts/<id>.png`. Node's fs is imported only when this is used. */
export function fileReceiptImages(publicDir: string): ReceiptImages {
  return {
    async read(receipt) {
      const { readFile } = await import("node:fs/promises");
      return new Uint8Array(await readFile(`${publicDir.replace(/\/$/, "")}${receipt.imageUrl}`));
    },
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

/** The receipt as an image block's source, after the hash check. Throws on a read or hash failure. */
export async function loadReceiptImage(images: ReceiptImages, receipt: SampleReceipt): Promise<ReceiptImage> {
  const bytes = await images.read(receipt);
  if ((await sha256Hex(bytes)) !== receipt.sha256) {
    throw new Error(`receipt image ${receipt.id}: bytes don't match the committed SHA-256`);
  }
  return { mediaType: "image/png", base64: toBase64(bytes) };
}
