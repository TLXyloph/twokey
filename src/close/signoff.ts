/**
 * The Reviewer's sign-off (spec §4, §5.6): only the Reviewer, a non-signer, may sign the monthly
 * close. The rulebooks ask for a reconciliation "reviewed and signed by a non-signer", and the
 * insurer says financial software doesn't qualify, so the AI drafts and a person signs.
 *
 * The signature binds the close hash: the Reviewer's demo key signs the canonical JSON of
 * `SignedClose` (the month, the hash, the role, the key id and the time), so changing any figure
 * changes the hash and the signature no longer matches it.
 */
import type { ActingRole } from "@/ledger/contracts";
import { SIGNOFF_TYPE, type CloseMonth, type CloseRefusalCode, type CloseSignoffView, type SignedClose } from "./contracts";
import type { ReviewerSigner, ReviewerVerifier } from "./reviewer-key";
import type { CloseSignoffStore, StoredSignoff } from "./signoff-store";

const TITLES: Record<Exclude<ActingRole, "reviewer">, string> = {
  president: "President",
  treasurer: "Treasurer",
  secretary: "Secretary",
  parent: "Parent",
};

export interface CloseRefusal {
  code: CloseRefusalCode;
  message: string;
}

/** Why this role can't sign the close; null for the Reviewer. Plain sentences, shown as they are. */
export function closeRefusalFor(role: ActingRole): CloseRefusal | null {
  if (role === "reviewer") return null;
  if (role === "parent") return { code: "not_the_reviewer", message: "A parent can't sign the monthly close: the club's Reviewer signs it." };
  return { code: "signer_cannot_review", message: `The ${TITLES[role]} can't sign the monthly close: a non-signer reviews it.` };
}

export const signedCloseOf = (stored: Pick<StoredSignoff, "month" | "closeHash" | "keyId" | "signedAt">): SignedClose => ({
  type: SIGNOFF_TYPE,
  month: stored.month,
  closeHash: stored.closeHash,
  role: "reviewer",
  keyId: stored.keyId,
  signedAt: stored.signedAt,
});

export interface SignCloseInput {
  store: CloseSignoffStore;
  signer: ReviewerSigner;
  sessionId: string;
  month: CloseMonth;
  closeHash: string;
  now: Date;
}

export type SignCloseOutcome = { outcome: "signed" | "duplicate"; signoff: StoredSignoff };

/** Signs once per session and month. A second sign-off (or a race lost) answers the stored one. */
export async function signClose(input: SignCloseInput): Promise<SignCloseOutcome> {
  const existing = await input.store.find(input.sessionId, input.month);
  if (existing) return { outcome: "duplicate", signoff: existing };
  const unsigned = { month: input.month, closeHash: input.closeHash, keyId: input.signer.keyId, signedAt: input.now.toISOString() };
  const signature = await input.signer.sign(signedCloseOf(unsigned));
  const signoff: StoredSignoff = { sessionId: input.sessionId, role: "reviewer", ...unsigned, signature };
  if ((await input.store.insert(signoff)) === "stored") return { outcome: "signed", signoff };
  const winner = await input.store.find(input.sessionId, input.month);
  if (!winner) throw new Error("close sign-off insert reported a duplicate, but none is stored");
  return { outcome: "duplicate", signoff: winner };
}

/** The sign-off as the page shows it, checked against the committed key and today's close hash. */
export async function toSignoffView(stored: StoredSignoff, verify: ReviewerVerifier, currentCloseHash: string): Promise<CloseSignoffView> {
  const signed = signedCloseOf(stored);
  return {
    month: stored.month,
    role: "reviewer",
    title: "Reviewer",
    keyId: stored.keyId,
    signature: stored.signature,
    signedAt: stored.signedAt,
    signed,
    verified: await verify(signed, stored.signature),
    matchesClose: stored.closeHash === currentCloseHash,
  };
}
