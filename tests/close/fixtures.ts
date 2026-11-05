/**
 * Builders for the monthly close's tests: a throwaway Reviewer key generated in-process (never
 * written anywhere), and a valid draft.
 */
import type { CloseDraft } from "@/close/contracts";
import { keyIdOf } from "@/disbursements/signing";
import { bytesToBase64 } from "@/ledger/canonical";
import type { ReviewerPublicKey } from "@/close/reviewer-key";

export interface TestReviewerKey {
  secret: string;
  publicKey: ReviewerPublicKey;
}

export async function generateTestReviewerKey(): Promise<TestReviewerKey> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { secret: bytesToBase64(pkcs8), publicKey: { keyId: await keyIdOf(raw), publicKey: bytesToBase64(raw) } };
}

export const sampleDraft = (over: Partial<CloseDraft> = {}): CloseDraft => ({
  summary:
    "October adds up: $2,549.00 opening plus $4,175.00 in, less $2,355.25 out, leaves $4,368.75, which carries forward to the account balance. " +
    "Every budget line is within its approval. Nothing was waiting at month end. One exception needs the Reviewer: the car wash.",
  points: [
    { check: "Ask the car-wash volunteers how the other 86 cars paid and where that money is.", basis: "Car wash, Oct 24: 87 cars logged, $15.00 received" },
    { check: "Ask the Treasurer whether fundraising costs will stay within what is left.", basis: "Fundraising costs: $948.75 of $1,000.00" },
  ],
  ...over,
});
