/**
 * Throwaway Ed25519 demo keys, generated in-process for tests: the env secrets (PKCS8, base64)
 * and the matching public keys. Never written anywhere.
 */
import type { OfficerRole } from "@/ledger/contracts";
import { bytesToBase64 } from "@/ledger/canonical";
import { DEMO_KEY_ENV, keyIdOf, OFFICER_ROLES, type DemoKeyEnv, type DemoPublicKeys } from "@/disbursements/signing";

export interface TestDemoKeys {
  env: Required<DemoKeyEnv>;
  publicKeys: DemoPublicKeys;
}

async function keypair(): Promise<{ pkcs8: string; publicKey: string; keyId: string }> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { pkcs8: bytesToBase64(pkcs8), publicKey: bytesToBase64(raw), keyId: await keyIdOf(raw) };
}

export async function generateTestDemoKeys(): Promise<TestDemoKeys> {
  const env = {} as Required<DemoKeyEnv>;
  const publicKeys = {} as DemoPublicKeys;
  for (const role of OFFICER_ROLES) {
    const pair = await keypair();
    env[DEMO_KEY_ENV[role as OfficerRole]] = pair.pkcs8;
    publicKeys[role] = { keyId: pair.keyId, publicKey: pair.publicKey };
  }
  return { env, publicKeys };
}

let shared: Promise<TestDemoKeys> | undefined;
/** One set per test file run (key generation is quick, but most tests don't care which keys). */
export const sharedTestDemoKeys = (): Promise<TestDemoKeys> => (shared ??= generateTestDemoKeys());
