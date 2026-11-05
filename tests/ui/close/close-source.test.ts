import { afterEach, describe, expect, it, vi } from "vitest";
import { closeDraftSchema } from "@/close/draft";
import { closeHash, octoberClose } from "@/close/october";
import { createCloseFixtureTransport, SAMPLE_DRAFT } from "@/ui/close/dev/close-fixture";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** close-source.ts holds one client per page: load a fresh copy under a given window. */
async function loadSource(search: string | null) {
  vi.resetModules();
  if (search !== null) vi.stubGlobal("window", { location: { search } });
  return import("@/ui/close/close-source");
}

describe("the close screen's client", () => {
  it("is null on the server, so the first paint is the server's", async () => {
    const source = await loadSource(null);
    expect(source.closeClient()).toBeNull();
  });

  it("is one client per page in the browser", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetch);
    const source = await loadSource("");
    const client = source.closeClient();
    expect(client).not.toBeNull();
    expect(source.closeClient()).toBe(client);
    await client!.refresh();
    expect(fetch).toHaveBeenCalledWith("/api/close?month=2026-10", expect.objectContaining({ method: "GET" }));
  });

  it("swaps the API for the in-memory fixture on ?fixture=1 in development, and reads its switches", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const source = await loadSource("?fixture=1&draft=none&key=unset");
    const client = source.closeClient()!;
    await client.refresh();
    const { view } = client.getSnapshot();
    expect(view?.draft).toEqual({ state: "not_recorded" });
    expect(view?.reviewerKey).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  }, 10_000);
});

describe("the dev fixture", () => {
  const fixture = (options = {}) => createCloseFixtureTransport({ latencyMs: 0, ...options });

  it("serves the real October close and the sample draft, unsigned", async () => {
    const view = await fixture().getView();
    expect(view.figures).toEqual(octoberClose());
    expect(view.closeHash).toBe(await closeHash(octoberClose()));
    expect(view.draft).toMatchObject({ state: "recorded", draft: SAMPLE_DRAFT });
    expect(view.signoff).toBeNull();
    expect(view.reviewerKey).toEqual({ keyId: "7c1e5a90" });
  });

  it("has a sample draft in the shape the AI's draft must take, about the figures as they are now", () => {
    expect(closeDraftSchema.safeParse(SAMPLE_DRAFT).success).toBe(true);
    expect(JSON.stringify(SAMPLE_DRAFT)).not.toContain("no two-key record");
  });

  it("follows the server's rule: every role but the Reviewer is refused with the server's sentence", async () => {
    const transport = fixture();
    await expect(transport.sign("treasurer")).resolves.toEqual({
      ok: false,
      status: 409,
      code: "signer_cannot_review",
      message: "The Treasurer can't sign the monthly close: a non-signer reviews it.",
    });
    await expect(transport.sign("parent")).resolves.toMatchObject({ ok: false, code: "not_the_reviewer" });
    expect((await transport.getView()).signoff).toBeNull();
  });

  it("signs once as the Reviewer, binding the close hash, then answers a duplicate", async () => {
    const transport = fixture();
    const first = await transport.sign("reviewer");
    expect(first).toMatchObject({ ok: true, duplicate: false });
    if (!first.ok) throw new Error("expected a sign-off");
    expect(first.signoff.signed.closeHash).toBe(await closeHash(octoberClose()));
    expect(await transport.sign("reviewer")).toMatchObject({ ok: true, duplicate: true });
    expect((await transport.getView()).signoff?.signature).toBe(first.signoff.signature);
  });

  it("starts signed, or with the Reviewer's key unpublished, on request", async () => {
    expect((await fixture({ signed: true }).getView()).signoff).toMatchObject({ role: "reviewer", verified: true, matchesClose: true });
    await expect(fixture({ keyUnset: true }).sign("reviewer")).resolves.toMatchObject({ ok: false, status: 503, code: "reviewer_key_unpublished" });
  });

  it("refuses to start in a production build", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => createCloseFixtureTransport()).toThrow("The close fixture is for development only.");
  });
});
