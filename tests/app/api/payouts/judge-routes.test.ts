import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueSession } from "@/agents/llm/judge-session";
import type { BoardView, ChainCheck, PayoutRequestView } from "@/ledger/contracts";
import { sqliteD1, type SqliteD1 } from "../../../agents/llm/sqlite-d1";
import { fakePaypal, FAKE_CLIENT_ID, FAKE_CLIENT_SECRET, SANDBOX, type FakePaypal } from "../../../payments/paypal/fixtures";

// Throwaway demo keys, made before the committed public-key file is mocked with them.
const keys = vi.hoisted(() => {
  const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
  const make = async () => {
    const env: Record<string, string> = {};
    const publicKeys: Record<string, { keyId: string; publicKey: string }> = {};
    for (const role of ["president", "treasurer", "secretary"]) {
      const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
      const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", raw));
      env[`TWOKEY_DEMO_KEY_${role.toUpperCase()}`] = b64(new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey)));
      publicKeys[role] = { keyId: Array.from(digest.slice(0, 4), (b) => b.toString(16).padStart(2, "0")).join(""), publicKey: b64(raw) };
    }
    return { env, publicKeys };
  };
  return { ready: make() };
});
vi.mock("@/disbursements/demo-public-keys.json", async () => ({ default: (await keys.ready).publicKeys }));

// The seams replaced: OpenNext's Cloudflare context (env + D1) and the global fetch (PayPal).
const mocks = vi.hoisted(() => ({ env: undefined as CloudflareEnv | undefined }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    if (!mocks.env) throw new Error("no Cloudflare context");
    return { env: mocks.env, cf: undefined, ctx: { waitUntil: () => undefined } };
  },
}));

const SITE = "https://twokey.afterscroll.workers.dev";
const SECRET = "test-session-secret-not-real-0123456789abcdef";
let d1: SqliteD1;
let paypal: FakePaypal;
let cookie: string;

const routes = async () => ({
  view: await import("@/app/api/ledger/view/route"),
  verify: await import("@/app/api/ledger/verify/route"),
  requests: await import("@/app/api/payouts/requests/route"),
  sign: await import("@/app/api/payouts/requests/[id]/sign/route"),
  risk: await import("@/app/api/payouts/requests/[id]/risk/route"),
});
const get = (path: string, withCookie = true) => new Request(`${SITE}${path}`, { headers: withCookie ? { cookie } : {} });
const post = (path: string, body: unknown) =>
  new Request(`${SITE}${path}`, {
    method: "POST",
    headers: { origin: SITE, "sec-fetch-site": "same-origin", "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(async () => {
  vi.resetModules();
  d1 = sqliteD1();
  paypal = fakePaypal({
    handle: (call) =>
      call.url === `${SANDBOX}/v1/payments/payouts`
        ? Response.json({ batch_header: { payout_batch_id: "BATCH-ROUTE-1", batch_status: "PENDING" } }, { status: 201 })
        : undefined,
  });
  vi.stubGlobal("fetch", (input: string, init: RequestInit) => paypal.fetch(input, init));
  mocks.env = {
    DB: d1.db,
    TWOKEY_SESSION_SECRET: SECRET,
    TWOKEY_SITE_ORIGIN: SITE,
    PAYPAL_CLIENT_ID: FAKE_CLIENT_ID,
    PAYPAL_CLIENT_SECRET: FAKE_CLIENT_SECRET,
    ...(await keys.ready).env,
  };
  cookie = (await issueSession(SECRET, Date.now())).setCookie.split(";")[0]!;
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the judge routes", () => {
  it("export one method each, on the Node.js runtime", async () => {
    const all = await routes();
    expect(Object.keys(all.view).sort()).toEqual(["GET", "runtime"]);
    expect(Object.keys(all.verify).sort()).toEqual(["GET", "runtime"]);
    for (const route of [all.requests, all.sign, all.risk]) expect(Object.keys(route).sort()).toEqual(["POST", "runtime"]);
    for (const route of Object.values(all)) expect(route.runtime).toBe("nodejs");
  });

  it("run the two-key path end to end on D1: view, receipt check, key 2, PayPal, verify", async () => {
    const { view, verify, risk, sign } = await routes();
    const board = (await (await view.GET(get("/api/ledger/view"))).json()) as BoardView;
    expect(board.requests.map((r) => r.requestId)).toEqual(["L15", "L14"]);
    expect((await risk.POST(post("/api/payouts/requests/L14/risk", {}), params("L14"))).status).toBe(200);
    const signed = await sign.POST(post("/api/payouts/requests/L14/sign", { actingAs: "president", acknowledgedFlags: false }), params("L14"));
    expect(signed.status).toBe(200);
    const request = ((await signed.json()) as { request: PayoutRequestView }).request;
    expect(request).toMatchObject({ status: "sent", timeline: expect.arrayContaining([expect.objectContaining({ label: "Sent to PayPal", detail: "BATCH-ROUTE-1" })]) });
    const payout = paypal.calls.find((c) => c.url === `${SANDBOX}/v1/payments/payouts`)!;
    expect(payout.headers.get("paypal-request-id")).toBe(request.requestHash);
    const check = (await (await verify.GET(get("/api/ledger/verify"))).json()) as ChainCheck;
    expect(check).toMatchObject({ ok: true });
    expect(d1.all("SELECT type FROM ledger_events WHERE type = 'payout.sent'")).toHaveLength(1);
  });

  it("create a judge's own request with 201", async () => {
    const { requests } = await routes();
    const body = { actingAs: "secretary", payeeId: "team-supply", amountCents: 300, description: "Cones", budgetLine: "equipment", receiptId: "cones-team-supply" };
    const response = await requests.POST(post("/api/payouts/requests", body));
    expect(response.status).toBe(201);
    expect(((await response.json()) as { request: PayoutRequestView }).request.sourceLabel).toBe("live sandbox");
  });

  it("answer 401 without a session, and fail closed with 503 without the demo keys", async () => {
    const { view } = await routes();
    expect((await view.GET(get("/api/ledger/view", false))).status).toBe(401);
    mocks.env = { ...mocks.env, TWOKEY_DEMO_KEY_TREASURER: undefined };
    const response = await view.GET(get("/api/ledger/view"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "demo_keys_unset", message: expect.any(String) } });
  });

  it("answer 503 without the D1 binding outside development", async () => {
    const { view } = await routes();
    mocks.env = { ...mocks.env, DB: undefined };
    expect((await view.GET(get("/api/ledger/view"))).status).toBe(503);
  });
});
