/**
 * DEV ONLY: an in-memory stand-in for the close routes, so the screen renders without the backend.
 * Reached only through `/demo/close?fixture=1` in a development build (../close-source.ts imports it
 * behind `process.env.NODE_ENV !== "production"`, which the production bundler folds to false), and
 * it refuses to start in a production build in case anyone wires it some other way.
 *
 * It computes the real October close in the browser and follows the server's rule (only the
 * Reviewer signs; everyone else is refused with the same sentence). Its "signature" is a stand-in
 * made from two hashes, not an Ed25519 signature, and its sample draft was written by hand for the
 * layout: neither is ever shipped. It calls nothing.
 */
import { CLOSE_MONTH, CLOSE_MONTH_NAME, SIGNOFF_TYPE, type CloseDraft, type CloseSignoffView, type CloseView } from "@/close/contracts";
import { closeHash, octoberClose } from "@/close/october";
import { closeRefusalFor } from "@/close/signoff";
import { bytesToBase64Url } from "@/ledger/canonical";
import type { CloseTransport } from "../close-client";

export interface CloseFixtureOptions {
  /** "none" shows the draft as not recorded; anything else shows the sample. */
  draft?: string | null;
  signed?: boolean;
  keyUnset?: boolean;
  latencyMs?: number;
}

const FIXTURE_KEY_ID = "7c1e5a90";

/** A hand-written stand-in with the shape the AI's draft takes (layout only; never shipped). */
export const SAMPLE_DRAFT: CloseDraft = {
  summary:
    "October adds up. The month opened at $2,549.00, took in $4,175.00 and paid out $2,355.25, closing at $4,368.75, which carries forward to the account's balance on Nov 3. " +
    "Every budget line is within its season approval; fundraising costs have $51.25 left. Nothing was waiting for a second key at month end, and all 7 payments count as approved by two officers (demo data). " +
    "One thing needs the Reviewer: the car wash logged 87 cars but only $15.00 reached the account.",
  points: [
    { check: "Ask the car-wash volunteers how the other 86 cars paid, and where that money is now.", basis: "Car wash, Oct 24: 87 cars logged, $15.00 received" },
    { check: "Ask the Treasurer whether fundraising costs will stay within the $51.25 left this season.", basis: "Fundraising costs: $948.75 of $1,000.00" },
    { check: "Check the account's balance with the Treasurer against the $4,998.75 the close carries forward.", basis: "$4,368.75 + $630.00 completed after Oct 31 = $4,998.75" },
  ],
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function digest(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

export function createCloseFixtureTransport(options: CloseFixtureOptions = {}): CloseTransport {
  if (process.env.NODE_ENV === "production") throw new Error("The close fixture is for development only.");
  const latency = options.latencyMs ?? 300;
  let signoff: CloseSignoffView | null = null;
  let ready: Promise<{ hash: string }> | null = null;

  const makeSignoff = async (hash: string, signedAt: string): Promise<CloseSignoffView> => {
    const bytes = new Uint8Array([...(await digest(`${hash}:${signedAt}`)), ...(await digest(`${signedAt}:${hash}`))]);
    return {
      month: CLOSE_MONTH,
      role: "reviewer",
      title: "Reviewer",
      keyId: FIXTURE_KEY_ID,
      signature: bytesToBase64Url(bytes),
      signedAt,
      signed: { type: SIGNOFF_TYPE, month: CLOSE_MONTH, closeHash: hash, role: "reviewer", keyId: FIXTURE_KEY_ID, signedAt },
      verified: true,
      matchesClose: true,
    };
  };

  const setup = () =>
    (ready ??= (async () => {
      const hash = await closeHash(octoberClose());
      if (options.signed) signoff = await makeSignoff(hash, new Date(Date.now() - 42 * 60_000).toISOString());
      return { hash };
    })());

  return {
    async getView() {
      const { hash } = await setup();
      await sleep(latency);
      const view: CloseView = {
        month: CLOSE_MONTH,
        monthName: CLOSE_MONTH_NAME,
        figures: octoberClose(),
        closeHash: hash,
        draft: options.draft === "none" ? { state: "not_recorded" } : { state: "recorded", recordedAt: "2026-11-05T20:14:00.000Z", draft: SAMPLE_DRAFT },
        signoff,
        reviewerKey: options.keyUnset ? null : { keyId: FIXTURE_KEY_ID },
      };
      return structuredClone(view);
    },
    async sign(role) {
      const { hash } = await setup();
      await sleep(latency * 2);
      const refusal = closeRefusalFor(role);
      if (refusal) return { ok: false, status: 409, code: refusal.code, message: refusal.message };
      if (signoff) return { ok: true, signoff: structuredClone(signoff), duplicate: true };
      if (options.keyUnset) {
        return { ok: false, status: 503, code: "reviewer_key_unpublished", message: "The Reviewer's demo key hasn't been published on this server yet, so the close can't be signed." };
      }
      signoff = await makeSignoff(hash, new Date().toISOString());
      return { ok: true, signoff: structuredClone(signoff), duplicate: false };
    },
  };
}
