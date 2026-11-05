import { describe, expect, it } from "vitest";
import { SIGNOFF_TYPE, type SignedClose } from "@/close/contracts";
import { COMMITTED_REVIEWER_KEY, createReviewerVerifier, isPublished, loadReviewerSigner } from "@/close/reviewer-key";
import { closeRefusalFor, signClose, signedCloseOf, toSignoffView } from "@/close/signoff";
import { createInMemorySignoffStore, type CloseSignoffStore } from "@/close/signoff-store";
import { generateTestReviewerKey } from "./fixtures";

const HASH = "a".repeat(64);
const NOW = new Date("2026-11-05T17:42:05.000Z");

const signed = (keyId: string, over: Partial<SignedClose> = {}): SignedClose => ({
  type: SIGNOFF_TYPE,
  month: "2026-10",
  closeHash: HASH,
  role: "reviewer",
  keyId,
  signedAt: NOW.toISOString(),
  ...over,
});

describe("the Reviewer's demo key", () => {
  it("is published (scripts/gen-reviewer-key.sh ran); against the placeholder, signing fails closed", async () => {
    expect(isPublished(COMMITTED_REVIEWER_KEY)).toBe(true);
    const placeholder = { keyId: "unset", publicKey: "unset" };
    expect(isPublished(placeholder)).toBe(false);
    const { secret } = await generateTestReviewerKey();
    expect(await loadReviewerSigner(secret, placeholder)).toEqual({ ok: false, code: "reviewer_key_unpublished" });
  });

  it("signs with the secret that matches the published key, and the signature verifies", async () => {
    const key = await generateTestReviewerKey();
    const loaded = await loadReviewerSigner(key.secret, key.publicKey);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.signer.keyId).toBe(key.publicKey.keyId);
    const message = signed(key.publicKey.keyId);
    const signature = await loaded.signer.sign(message);
    expect(signature).toMatch(/^[A-Za-z0-9_-]{86}$/);
    const verify = createReviewerVerifier(key.publicKey);
    expect(await verify(message, signature)).toBe(true);
  });

  it("binds the close hash: a changed hash, month, time or key id doesn't verify", async () => {
    const key = await generateTestReviewerKey();
    const loaded = await loadReviewerSigner(key.secret, key.publicKey);
    if (!loaded.ok) throw new Error("no signer");
    const message = signed(key.publicKey.keyId);
    const signature = await loaded.signer.sign(message);
    const verify = createReviewerVerifier(key.publicKey);
    expect(await verify({ ...message, closeHash: "b".repeat(64) }, signature)).toBe(false);
    expect(await verify({ ...message, month: "2026-11" as "2026-10" }, signature)).toBe(false);
    expect(await verify({ ...message, signedAt: "2026-11-05T17:42:06.000Z" }, signature)).toBe(false);
    expect(await verify({ ...message, keyId: "00000000" }, signature)).toBe(false);
    expect(await verify(message, "not-a-signature")).toBe(false);
  });

  it("refuses an unset, unreadable or mismatched secret", async () => {
    const key = await generateTestReviewerKey();
    const other = await generateTestReviewerKey();
    expect(await loadReviewerSigner(undefined, key.publicKey)).toEqual({ ok: false, code: "reviewer_key_unset" });
    expect(await loadReviewerSigner("  ", key.publicKey)).toEqual({ ok: false, code: "reviewer_key_unset" });
    expect(await loadReviewerSigner("bm90IGEga2V5", key.publicKey)).toEqual({ ok: false, code: "reviewer_key_invalid" });
    expect(await loadReviewerSigner(other.secret, key.publicKey)).toEqual({ ok: false, code: "reviewer_key_mismatch" });
  });

  it("verifies nothing against the placeholder", async () => {
    const verify = createReviewerVerifier(COMMITTED_REVIEWER_KEY);
    expect(await verify(signed("unset"), "AAAA")).toBe(false);
  });
});

describe("who may sign the close", () => {
  it("is the Reviewer only; officers and parents get a plain reason", () => {
    expect(closeRefusalFor("reviewer")).toBeNull();
    expect(closeRefusalFor("treasurer")).toEqual({ code: "signer_cannot_review", message: "The Treasurer can't sign the monthly close: a non-signer reviews it." });
    expect(closeRefusalFor("president")?.message).toBe("The President can't sign the monthly close: a non-signer reviews it.");
    expect(closeRefusalFor("secretary")?.message).toBe("The Secretary can't sign the monthly close: a non-signer reviews it.");
    expect(closeRefusalFor("parent")).toEqual({ code: "not_the_reviewer", message: "A parent can't sign the monthly close: the club's Reviewer signs it." });
  });
});

describe("signing the close", () => {
  async function setup(store: CloseSignoffStore = createInMemorySignoffStore()) {
    const key = await generateTestReviewerKey();
    const loaded = await loadReviewerSigner(key.secret, key.publicKey);
    if (!loaded.ok) throw new Error("no signer");
    return { key, signer: loaded.signer, store, verify: createReviewerVerifier(key.publicKey) };
  }

  it("stores one sign-off per session and month, and answers a second with the first", async () => {
    const { signer, store } = await setup();
    const first = await signClose({ store, signer, sessionId: "s1", month: "2026-10", closeHash: HASH, now: NOW });
    expect(first.outcome).toBe("signed");
    expect(first.signoff).toMatchObject({ sessionId: "s1", month: "2026-10", closeHash: HASH, role: "reviewer", keyId: signer.keyId, signedAt: NOW.toISOString() });
    const again = await signClose({ store, signer, sessionId: "s1", month: "2026-10", closeHash: HASH, now: new Date("2026-11-05T18:00:00Z") });
    expect(again).toEqual({ outcome: "duplicate", signoff: first.signoff });
    const other = await signClose({ store, signer, sessionId: "s2", month: "2026-10", closeHash: HASH, now: NOW });
    expect(other.outcome).toBe("signed");
  });

  it("answers the winner when another request stored first (a lost race)", async () => {
    const inner = createInMemorySignoffStore();
    let finds = 0;
    const racing: CloseSignoffStore = {
      async find(sessionId, month) {
        finds += 1;
        return finds === 1 ? null : inner.find(sessionId, month);
      },
      insert: (row) => inner.insert(row),
    };
    const { signer } = await setup();
    const winner = await signClose({ store: inner, signer, sessionId: "s1", month: "2026-10", closeHash: HASH, now: NOW });
    const loser = await signClose({ store: racing, signer, sessionId: "s1", month: "2026-10", closeHash: HASH, now: new Date("2026-11-05T19:00:00Z") });
    expect(loser).toEqual({ outcome: "duplicate", signoff: winner.signoff });
  });

  it("shows a sign-off verified, and says whether it still matches today's close", async () => {
    const { signer, store, verify } = await setup();
    const { signoff } = await signClose({ store, signer, sessionId: "s1", month: "2026-10", closeHash: HASH, now: NOW });
    const view = await toSignoffView(signoff, verify, HASH);
    expect(view).toMatchObject({ month: "2026-10", role: "reviewer", title: "Reviewer", keyId: signer.keyId, signedAt: NOW.toISOString(), verified: true, matchesClose: true });
    expect(view.signed).toEqual(signedCloseOf(signoff));
    expect((await toSignoffView(signoff, verify, "c".repeat(64))).matchesClose).toBe(false);
    expect((await toSignoffView({ ...signoff, closeHash: "d".repeat(64) }, verify, HASH)).verified).toBe(false);
  });
});
