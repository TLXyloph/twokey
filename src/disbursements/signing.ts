/**
 * The officers' demo keys (spec §3): Ed25519 through WebCrypto (`{ name: "Ed25519" }`, available on
 * Workers), over the canonical JSON of a `SignedApproval`.
 *
 * Private keys are the Worker secrets TWOKEY_DEMO_KEY_PRESIDENT / _TREASURER / _SECRETARY (PKCS8
 * DER, base64), written by scripts/gen-demo-keys.sh and never printed. Public keys are committed in
 * ./demo-public-keys.json (raw 32 bytes, base64) with keyId = the first 8 hex characters of
 * SHA-256 over the raw public key. Loading the signer checks each secret against its committed
 * public key, so a missing, malformed or mismatched key fails closed before anything is signed.
 */
import { z } from "zod";
import type { OfficerRole, SignedApproval } from "@/ledger/contracts";
import { base64ToBytes, base64UrlToBytes, bytesToBase64, bytesToBase64Url, canonicalJson, sha256Hex } from "@/ledger/canonical";
import committedKeys from "./demo-public-keys.json";

const ED25519 = { name: "Ed25519" } as const;
export const OFFICER_ROLES: readonly OfficerRole[] = ["president", "treasurer", "secretary"];

export const DEMO_KEY_ENV = {
  president: "TWOKEY_DEMO_KEY_PRESIDENT",
  treasurer: "TWOKEY_DEMO_KEY_TREASURER",
  secretary: "TWOKEY_DEMO_KEY_SECRETARY",
} as const satisfies Record<OfficerRole, string>;

export type DemoKeyEnv = Partial<Record<(typeof DEMO_KEY_ENV)[OfficerRole], string>>;

export interface DemoPublicKey {
  keyId: string;
  /** Raw 32-byte Ed25519 public key, base64. */
  publicKey: string;
}
export type DemoPublicKeys = Record<OfficerRole, DemoPublicKey>;

const publicKeySchema = z.object({ keyId: z.string(), publicKey: z.string() });
const publicKeysSchema = z.object({ president: publicKeySchema, treasurer: publicKeySchema, secretary: publicKeySchema });

/** The committed public keys; "unset" placeholders until scripts/gen-demo-keys.sh writes real ones. */
export const COMMITTED_PUBLIC_KEYS: DemoPublicKeys = publicKeysSchema.parse(committedKeys);

export async function keyIdOf(rawPublicKey: Uint8Array): Promise<string> {
  return (await sha256Hex(rawPublicKey)).slice(0, 8);
}

export const signedBytes = (signed: SignedApproval): Uint8Array<ArrayBuffer> => new TextEncoder().encode(canonicalJson(signed));

export interface DemoSignature {
  keyId: string;
  /** base64url. */
  signature: string;
}

export interface DemoSigner {
  sign(role: OfficerRole, signed: SignedApproval): Promise<DemoSignature>;
}

export interface SignatureVerifier {
  /** True only when `signature` is the role's key over exactly `signed`, under the committed keyId. */
  verify(role: OfficerRole, signed: SignedApproval, signature: string, keyId: string): Promise<boolean>;
}

export type DemoKeyCode = "demo_keys_unset" | "demo_keys_invalid" | "demo_keys_mismatch";
export type SignerLoad = { ok: true; signer: DemoSigner } | { ok: false; code: DemoKeyCode; problems: string[] };

/** Every demo-key secret that is unset, as `<NAME>:unset` codes. */
export function missingDemoKeys(env: DemoKeyEnv): string[] {
  return OFFICER_ROLES.filter((role) => !env[DEMO_KEY_ENV[role]]?.trim()).map((role) => `${DEMO_KEY_ENV[role]}:unset`);
}

async function importPrivate(text: string): Promise<{ key: CryptoKey; rawPublic: Uint8Array } | undefined> {
  try {
    const key = await crypto.subtle.importKey("pkcs8", base64ToBytes(text.trim()), ED25519, true, ["sign"]);
    const jwk = await crypto.subtle.exportKey("jwk", key);
    if (typeof jwk.x !== "string") return undefined;
    return { key, rawPublic: base64UrlToBytes(jwk.x) };
  } catch {
    return undefined;
  }
}

/** Imports the three private keys and checks each against its committed public key. */
export async function loadDemoSigner(env: DemoKeyEnv, publicKeys: DemoPublicKeys = COMMITTED_PUBLIC_KEYS): Promise<SignerLoad> {
  const unset = missingDemoKeys(env);
  if (unset.length > 0) return { ok: false, code: "demo_keys_unset", problems: unset };
  const keys = new Map<OfficerRole, { key: CryptoKey; keyId: string }>();
  const invalid: string[] = [];
  const mismatched: string[] = [];
  for (const role of OFFICER_ROLES) {
    const name = DEMO_KEY_ENV[role];
    const imported = await importPrivate(env[name] ?? "");
    if (!imported) {
      invalid.push(`${name}:invalid`);
      continue;
    }
    const keyId = await keyIdOf(imported.rawPublic);
    const committed = publicKeys[role];
    if (committed.publicKey !== bytesToBase64(imported.rawPublic) || committed.keyId !== keyId) mismatched.push(`${name}:mismatch`);
    keys.set(role, { key: imported.key, keyId });
  }
  if (invalid.length > 0) return { ok: false, code: "demo_keys_invalid", problems: invalid };
  if (mismatched.length > 0) return { ok: false, code: "demo_keys_mismatch", problems: mismatched };
  return {
    ok: true,
    signer: {
      async sign(role, signed) {
        const entry = keys.get(role);
        if (!entry) throw new Error(`no demo key for ${role}`);
        const signature = new Uint8Array(await crypto.subtle.sign(ED25519, entry.key, signedBytes(signed)));
        return { keyId: entry.keyId, signature: bytesToBase64Url(signature) };
      },
    },
  };
}

/** Verifies against the committed public keys. A placeholder or unreadable key verifies nothing. */
export function createSignatureVerifier(publicKeys: DemoPublicKeys = COMMITTED_PUBLIC_KEYS): SignatureVerifier {
  const imported = new Map<OfficerRole, Promise<CryptoKey | undefined>>();
  const publicKeyFor = (role: OfficerRole): Promise<CryptoKey | undefined> => {
    let found = imported.get(role);
    if (!found) {
      found = (async () => {
        try {
          return await crypto.subtle.importKey("raw", base64ToBytes(publicKeys[role].publicKey), ED25519, false, ["verify"]);
        } catch {
          return undefined;
        }
      })();
      imported.set(role, found);
    }
    return found;
  };
  return {
    async verify(role, signed, signature, keyId) {
      if (!OFFICER_ROLES.includes(role) || signed.role !== role || keyId !== publicKeys[role].keyId) return false;
      const key = await publicKeyFor(role);
      if (!key) return false;
      try {
        return await crypto.subtle.verify(ED25519, key, base64UrlToBytes(signature), signedBytes(signed));
      } catch {
        return false;
      }
    },
  };
}
