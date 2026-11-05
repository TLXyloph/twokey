import { describe, expect, it } from "vitest";
import type { SignedApproval } from "@/ledger/contracts";
import { base64ToBytes, sha256Hex } from "@/ledger/canonical";
import {
  COMMITTED_PUBLIC_KEYS,
  createSignatureVerifier,
  keyIdOf,
  loadDemoSigner,
  missingDemoKeys,
  type DemoSigner,
} from "@/disbursements/signing";
import { generateTestDemoKeys, sharedTestDemoKeys } from "./demo-keys";

const signed: SignedApproval = {
  requestHash: "ab".repeat(32),
  payeeId: "team-supply",
  payeeEmail: "vendor-fictional@example.test",
  amountCents: 4200,
  currency: "USD",
  role: "president",
  riskCardHash: "cd".repeat(32),
  acknowledgedFlags: false,
  prevHash: "ef".repeat(32),
};

async function signer(): Promise<DemoSigner> {
  const { env, publicKeys } = await sharedTestDemoKeys();
  const loaded = await loadDemoSigner(env, publicKeys);
  if (!loaded.ok) throw new Error(loaded.problems.join(","));
  return loaded.signer;
}

describe("demo keys", () => {
  it("derives the key id from the first 8 hex characters of SHA-256 over the raw public key", async () => {
    const raw = new Uint8Array(32).fill(7);
    expect(await keyIdOf(raw)).toBe((await sha256Hex(raw)).slice(0, 8));
  });

  it("signs with the role's key, and the committed public key verifies it", async () => {
    const { publicKeys } = await sharedTestDemoKeys();
    const { keyId, signature } = await (await signer()).sign("president", signed);
    expect(keyId).toBe(publicKeys.president.keyId);
    expect(signature).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(await createSignatureVerifier(publicKeys).verify("president", signed, signature, keyId)).toBe(true);
  });

  it("refuses a signature over anything else: another amount, another role's key, or another key id", async () => {
    const { publicKeys } = await sharedTestDemoKeys();
    const verifier = createSignatureVerifier(publicKeys);
    const { keyId, signature } = await (await signer()).sign("president", signed);
    expect(await verifier.verify("president", { ...signed, amountCents: 4201 }, signature, keyId)).toBe(false);
    expect(await verifier.verify("president", { ...signed, acknowledgedFlags: true }, signature, keyId)).toBe(false);
    expect(await verifier.verify("secretary", { ...signed, role: "secretary" }, signature, publicKeys.secretary.keyId)).toBe(false);
    expect(await verifier.verify("president", signed, signature, "00000000")).toBe(false);
    expect(await verifier.verify("treasurer", signed, signature, keyId)).toBe(false);
    expect(await verifier.verify("president", signed, "not-a-signature", keyId)).toBe(false);
  });

  it("verifies nothing against the committed placeholders", async () => {
    const { keyId, signature } = await (await signer()).sign("president", signed);
    expect(COMMITTED_PUBLIC_KEYS.president.publicKey).toBe("unset");
    expect(await createSignatureVerifier().verify("president", signed, signature, keyId)).toBe(false);
  });
});

describe("loadDemoSigner fails closed", () => {
  it("names every unset secret", async () => {
    expect(await loadDemoSigner({})).toEqual({
      ok: false,
      code: "demo_keys_unset",
      problems: ["TWOKEY_DEMO_KEY_PRESIDENT:unset", "TWOKEY_DEMO_KEY_TREASURER:unset", "TWOKEY_DEMO_KEY_SECRETARY:unset"],
    });
    expect(missingDemoKeys({ TWOKEY_DEMO_KEY_PRESIDENT: "x", TWOKEY_DEMO_KEY_TREASURER: " " })).toEqual([
      "TWOKEY_DEMO_KEY_TREASURER:unset",
      "TWOKEY_DEMO_KEY_SECRETARY:unset",
    ]);
  });

  it("refuses a secret that isn't a PKCS8 Ed25519 key, without echoing it", async () => {
    const { env, publicKeys } = await sharedTestDemoKeys();
    const result = await loadDemoSigner({ ...env, TWOKEY_DEMO_KEY_TREASURER: "bm90IGEga2V5" }, publicKeys);
    expect(result).toEqual({ ok: false, code: "demo_keys_invalid", problems: ["TWOKEY_DEMO_KEY_TREASURER:invalid"] });
    expect(JSON.stringify(result)).not.toContain(env.TWOKEY_DEMO_KEY_PRESIDENT);
  });

  it("refuses keys that don't match the committed public keys (the placeholders included)", async () => {
    const { env } = await sharedTestDemoKeys();
    const other = await generateTestDemoKeys();
    expect(await loadDemoSigner(env)).toMatchObject({ ok: false, code: "demo_keys_mismatch" });
    expect(await loadDemoSigner(env, other.publicKeys)).toMatchObject({
      ok: false,
      code: "demo_keys_mismatch",
      problems: ["TWOKEY_DEMO_KEY_PRESIDENT:mismatch", "TWOKEY_DEMO_KEY_TREASURER:mismatch", "TWOKEY_DEMO_KEY_SECRETARY:mismatch"],
    });
  });

  it("reads a committed public key as 32 raw bytes", async () => {
    const { publicKeys } = await sharedTestDemoKeys();
    expect(base64ToBytes(publicKeys.secretary.publicKey)).toHaveLength(32);
  });
});
