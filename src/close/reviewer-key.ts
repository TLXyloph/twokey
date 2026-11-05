/**
 * The Reviewer's demo key (spec §5.6): one Ed25519 key, held by the server like the officers' demo
 * keys (src/disbursements/signing.ts), that signs the monthly close. The Reviewer holds no payout
 * key, and no officer's key can sign the close.
 *
 * - Private key: the Worker secret TWOKEY_DEMO_KEY_REVIEWER (PKCS8 DER, base64), written by
 *   scripts/gen-reviewer-key.sh and never printed.
 * - Public key: committed in ./reviewer-public-key.json (raw 32 bytes, base64) with keyId = the first
 *   8 hex characters of SHA-256 over the raw public key. Until the script runs, the file holds an
 *   "unset" placeholder and the sign route fails closed (503).
 *
 * Loading the signer checks the secret against the committed public key, so a missing, malformed or
 * mismatched key signs nothing.
 */
import { z } from "zod";
import { keyIdOf } from "@/disbursements/signing";
import { base64ToBytes, base64UrlToBytes, bytesToBase64, bytesToBase64Url, canonicalJson } from "@/ledger/canonical";
import type { CloseKeyCode, SignedClose } from "./contracts";
import committedKey from "./reviewer-public-key.json";

declare global {
  interface CloudflareEnv {
    /** Worker secret: the Reviewer's demo signing key (scripts/gen-reviewer-key.sh; never printed). */
    TWOKEY_DEMO_KEY_REVIEWER?: string;
  }
}

const ED25519 = { name: "Ed25519" } as const;
export const REVIEWER_KEY_ENV = "TWOKEY_DEMO_KEY_REVIEWER";

export interface ReviewerPublicKey {
  keyId: string;
  /** Raw 32-byte Ed25519 public key, base64; "unset" until the script runs. */
  publicKey: string;
}

export const COMMITTED_REVIEWER_KEY: ReviewerPublicKey = z.object({ keyId: z.string(), publicKey: z.string() }).strict().parse(committedKey);

/** A real key: 8 hex characters of id and 32 bytes of public key (not the placeholder). */
export function isPublished(key: ReviewerPublicKey): boolean {
  return /^[0-9a-f]{8}$/.test(key.keyId) && /^[A-Za-z0-9+/]{43}=$/.test(key.publicKey);
}

export const signedCloseBytes = (signed: SignedClose): Uint8Array<ArrayBuffer> => new TextEncoder().encode(canonicalJson(signed));

export interface ReviewerSigner {
  keyId: string;
  /** base64url Ed25519 signature over the canonical JSON of `signed`. */
  sign(signed: SignedClose): Promise<string>;
}

export type ReviewerSignerLoad = { ok: true; signer: ReviewerSigner } | { ok: false; code: CloseKeyCode };

/** Imports the secret and checks it against the committed public key. */
export async function loadReviewerSigner(secret: string | undefined, publicKey: ReviewerPublicKey = COMMITTED_REVIEWER_KEY): Promise<ReviewerSignerLoad> {
  if (!isPublished(publicKey)) return { ok: false, code: "reviewer_key_unpublished" };
  if (!secret?.trim()) return { ok: false, code: "reviewer_key_unset" };
  let key: CryptoKey;
  let rawPublic: Uint8Array;
  try {
    key = await crypto.subtle.importKey("pkcs8", base64ToBytes(secret.trim()), ED25519, true, ["sign"]);
    const jwk = await crypto.subtle.exportKey("jwk", key);
    if (typeof jwk.x !== "string") return { ok: false, code: "reviewer_key_invalid" };
    rawPublic = base64UrlToBytes(jwk.x);
  } catch {
    return { ok: false, code: "reviewer_key_invalid" };
  }
  const keyId = await keyIdOf(rawPublic);
  if (bytesToBase64(rawPublic) !== publicKey.publicKey || keyId !== publicKey.keyId) return { ok: false, code: "reviewer_key_mismatch" };
  return {
    ok: true,
    signer: {
      keyId,
      async sign(signed) {
        return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign(ED25519, key, signedCloseBytes(signed))));
      },
    },
  };
}

/** True only when `signature` is the committed Reviewer key over exactly `signed`. */
export type ReviewerVerifier = (signed: SignedClose, signature: string) => Promise<boolean>;

export function createReviewerVerifier(publicKey: ReviewerPublicKey = COMMITTED_REVIEWER_KEY): ReviewerVerifier {
  let imported: Promise<CryptoKey | undefined> | undefined;
  const keyFor = () =>
    (imported ??= (async () => {
      if (!isPublished(publicKey)) return undefined;
      try {
        return await crypto.subtle.importKey("raw", base64ToBytes(publicKey.publicKey), ED25519, false, ["verify"]);
      } catch {
        return undefined;
      }
    })());
  return async (signed, signature) => {
    if (signed.role !== "reviewer" || signed.keyId !== publicKey.keyId) return false;
    const key = await keyFor();
    if (!key) return false;
    try {
      return await crypto.subtle.verify(ED25519, key, base64UrlToBytes(signature), signedCloseBytes(signed));
    } catch {
      return false;
    }
  };
}
