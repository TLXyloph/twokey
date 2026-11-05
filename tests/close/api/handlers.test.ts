import { describe, expect, it } from "vitest";
import { issueSession } from "@/agents/llm/judge-session";
import { handleCloseSign, handleCloseView, type CloseApiDeps } from "@/close/api/handlers";
import { MAX_CLOSE_BODY_BYTES } from "@/close/api/prelude";
import type { CloseView } from "@/close/contracts";
import { closeHash, octoberClose } from "@/close/october";
import { createReviewerVerifier } from "@/close/reviewer-key";
import { createInMemorySignoffStore } from "@/close/signoff-store";
import { generateTestReviewerKey, sampleDraft, type TestReviewerKey } from "../fixtures";

const SITE = "https://twokey.afterscroll.workers.dev";
const SESSION_SECRET = "test-session-secret-not-real-0123456789abcdef";
const NOW = new Date("2026-11-05T17:42:05.000Z");

/** What src/close/reviewer-public-key.json holds until scripts/gen-reviewer-key.sh runs. */
const PLACEHOLDER_KEY = { keyId: "unset", publicKey: "unset" };

async function setup(over: Partial<CloseApiDeps> = {}, key?: TestReviewerKey) {
  const reviewer = key ?? (await generateTestReviewerKey());
  const store = createInMemorySignoffStore();
  const lines: string[] = [];
  const deps: CloseApiDeps = {
    env: { TWOKEY_SESSION_SECRET: SESSION_SECRET, TWOKEY_SITE_ORIGIN: SITE, TWOKEY_DEMO_KEY_REVIEWER: reviewer.secret },
    development: false,
    store,
    publicKey: reviewer.publicKey,
    now: () => NOW,
    log: (line) => lines.push(line),
    ...over,
  };
  const cookieFor = async (fill: number) => (await issueSession(SESSION_SECRET, NOW.getTime() - 60_000, (n) => new Uint8Array(n).fill(fill))).setCookie.split(";")[0]!;
  return { deps, store, lines, reviewer, cookie: await cookieFor(7), cookieFor };
}

const get = (cookie?: string, query = "?month=2026-10") =>
  new Request(`${SITE}/api/close${query}`, { method: "GET", headers: cookie ? { cookie } : {} });
const post = (body: unknown, headers: Record<string, string>) =>
  new Request(`${SITE}/api/close/sign`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const sameSite = (cookie: string) => ({ origin: SITE, "sec-fetch-site": "same-origin", cookie });
const sign = (deps: CloseApiDeps, cookie: string, actingAs = "reviewer", month = "2026-10") =>
  handleCloseSign(post({ actingAs, month }, sameSite(cookie)), deps);

describe("GET /api/close", () => {
  it("answers the October figures, their hash, the draft's state and no sign-off yet, never cached", async () => {
    const { deps, cookie, lines, reviewer } = await setup();
    const response = await handleCloseView(get(cookie), deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const view = (await response.json()) as CloseView;
    expect(view.month).toBe("2026-10");
    expect(view.monthName).toBe("October 2026");
    expect(view.figures).toEqual(octoberClose());
    expect(view.closeHash).toBe(await closeHash(octoberClose()));
    expect(view.draft).toEqual({ state: "not_recorded" });
    expect(view.signoff).toBeNull();
    expect(view.reviewerKey).toEqual({ keyId: reviewer.publicKey.keyId });
    expect(lines).toEqual([expect.stringMatching(/^\[close\/view\] outcome=ok status=200 session=\S{8}$/)]);
  });

  it("serves a recorded draft for this close hash", async () => {
    const hash = await closeHash(octoberClose());
    const recordedDraft = { [hash]: { month: "2026-10", model: "claude-opus-5-5", recordedAt: "2026-11-05T20:00:00.000Z", costUsd: 0.03, draft: sampleDraft() } };
    const { deps, cookie } = await setup({ recordedDraft });
    const view = (await (await handleCloseView(get(cookie), deps)).json()) as CloseView;
    expect(view.draft).toEqual({ state: "recorded", recordedAt: "2026-11-05T20:00:00.000Z", draft: sampleDraft() });
  });

  it("defaults to October, refuses other months and malformed ones", async () => {
    const { deps, cookie } = await setup();
    expect((await handleCloseView(get(cookie, ""), deps)).status).toBe(200);
    const other = await handleCloseView(get(cookie, "?month=2026-11"), deps);
    expect(other.status).toBe(404);
    expect(await other.json()).toEqual({ error: { code: "unknown_month", message: "Only the October 2026 close is in this demo." } });
    expect((await handleCloseView(get(cookie, "?month=october"), deps)).status).toBe(400);
  });

  it("says no Reviewer key is published while the JSON is the placeholder", async () => {
    const { deps, cookie } = await setup({ publicKey: PLACEHOLDER_KEY });
    const view = (await (await handleCloseView(get(cookie), deps)).json()) as CloseView;
    expect(view.reviewerKey).toBeNull();
  });

  it("needs a judge session, and a configured server", async () => {
    const { deps } = await setup();
    const response = await handleCloseView(get(), deps);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "no_session" } });
    const { deps: bare, cookie } = await setup({ env: {} });
    expect((await handleCloseView(get(cookie), bare)).status).toBe(503);
    const { deps: noStore, cookie: c2 } = await setup({ store: undefined });
    expect((await handleCloseView(get(c2), noStore)).status).toBe(503);
  });
});

describe("POST /api/close/sign", () => {
  it("signs as the Reviewer: 201, the signature binds today's close hash and verifies", async () => {
    const { deps, cookie, store, reviewer, lines } = await setup();
    const response = await sign(deps, cookie);
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { signoff, duplicate } = (await response.json()) as { signoff: NonNullable<CloseView["signoff"]>; duplicate: boolean };
    expect(duplicate).toBe(false);
    expect(signoff).toMatchObject({ month: "2026-10", role: "reviewer", title: "Reviewer", keyId: reviewer.publicKey.keyId, signedAt: NOW.toISOString(), verified: true, matchesClose: true });
    expect(signoff.signed.closeHash).toBe(await closeHash(octoberClose()));
    expect(await createReviewerVerifier(reviewer.publicKey)(signoff.signed, signoff.signature)).toBe(true);
    expect(store.all()).toHaveLength(1);
    expect(lines.at(-1)).toMatch(/^\[close\/sign\] outcome=signed status=201 session=\S{8}$/);

    const view = (await (await handleCloseView(get(cookie), deps)).json()) as CloseView;
    expect(view.signoff).toEqual(signoff);
  });

  it("answers a second sign-off with the first (200, duplicate), per session", async () => {
    const { deps, cookie, cookieFor, store } = await setup();
    const first = await (await sign(deps, cookie)).json();
    const again = await sign(deps, cookie);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ signoff: first.signoff, duplicate: true });
    expect((await sign(deps, await cookieFor(8))).status).toBe(201);
    expect(store.all()).toHaveLength(2);
  });

  it("refuses every other role with a plain reason, and signs nothing", async () => {
    const { deps, cookie, store } = await setup();
    const cases: [string, string, string][] = [
      ["treasurer", "signer_cannot_review", "The Treasurer can't sign the monthly close: a non-signer reviews it."],
      ["president", "signer_cannot_review", "The President can't sign the monthly close: a non-signer reviews it."],
      ["secretary", "signer_cannot_review", "The Secretary can't sign the monthly close: a non-signer reviews it."],
      ["parent", "not_the_reviewer", "A parent can't sign the monthly close: the club's Reviewer signs it."],
    ];
    for (const [role, code, message] of cases) {
      const response = await sign(deps, cookie, role);
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: { code, message } });
    }
    expect(store.all()).toEqual([]);
  });

  it("refuses a role even after the Reviewer has signed", async () => {
    const { deps, cookie } = await setup();
    await sign(deps, cookie);
    expect((await sign(deps, cookie, "treasurer")).status).toBe(409);
  });

  it("fails closed (503) while the Reviewer's key is unpublished, unset or not the committed one", async () => {
    const { deps: placeholder, cookie, store } = await setup({ publicKey: PLACEHOLDER_KEY });
    const unpublished = await sign(placeholder, cookie);
    expect(unpublished.status).toBe(503);
    expect(await unpublished.json()).toMatchObject({ error: { code: "reviewer_key_unpublished" } });
    const { deps: unset, cookie: c2 } = await setup();
    unset.env = { ...unset.env, TWOKEY_DEMO_KEY_REVIEWER: undefined };
    expect(await (await sign(unset, c2)).json()).toMatchObject({ error: { code: "reviewer_key_unset" } });
    const other = await generateTestReviewerKey();
    const { deps: mismatched, cookie: c3 } = await setup();
    mismatched.env = { ...mismatched.env, TWOKEY_DEMO_KEY_REVIEWER: other.secret };
    expect(await (await sign(mismatched, c3)).json()).toMatchObject({ error: { code: "reviewer_key_mismatch" } });
    expect(store.all()).toEqual([]);
  });

  it("refuses other origins, a missing session, a big or broken body, and a bad shape", async () => {
    const { deps, cookie } = await setup();
    expect((await handleCloseSign(post({ actingAs: "reviewer", month: "2026-10" }, { origin: "https://evil.example", cookie }), deps)).status).toBe(403);
    expect((await handleCloseSign(post({ actingAs: "reviewer", month: "2026-10" }, { origin: SITE, "sec-fetch-site": "cross-site", cookie }), deps)).status).toBe(403);
    expect((await handleCloseSign(post({ actingAs: "reviewer", month: "2026-10" }, { origin: SITE }), deps)).status).toBe(401);
    const big = await handleCloseSign(post({ actingAs: "reviewer", month: "2026-10", pad: "x".repeat(MAX_CLOSE_BODY_BYTES) }, sameSite(cookie)), deps);
    expect(big.status).toBe(413);
    expect((await handleCloseSign(post("{nope", sameSite(cookie)), deps)).status).toBe(400);
    const shape = await handleCloseSign(post({ actingAs: "auditor", month: "2026-10" }, sameSite(cookie)), deps);
    expect(shape.status).toBe(400);
    expect(await shape.json()).toMatchObject({ error: { code: "bad_request", message: "Check these fields and try again: actingAs." } });
    expect((await handleCloseSign(post({ actingAs: "reviewer", month: "2026-10", extra: 1 }, sameSite(cookie)), deps)).status).toBe(400);
    expect((await sign(deps, cookie, "reviewer", "2026-11")).status).toBe(404);
  });

  it("answers 500 with a fixed code when the store fails", async () => {
    const { deps, cookie, lines } = await setup();
    deps.store = { find: async () => Promise.reject(new Error("D1 down")), insert: async () => "stored" };
    const response = await sign(deps, cookie);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: "internal" } });
    expect(lines.at(-1)).toMatch(/outcome=internal status=500 .*detail=store_error$/);
  });
});
