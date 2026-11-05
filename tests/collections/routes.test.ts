import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API } from "@/ledger/contracts";
import { FAKE_CLIENT_ID, FAKE_CLIENT_SECRET, ORDER_ID, post, SECRET, sessionCookie, SITE } from "./helpers";

// The seam replaced: OpenNext's Cloudflare context.
const mocks = vi.hoisted(() => ({ env: undefined as CloudflareEnv | undefined }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    if (!mocks.env) throw new Error("getCloudflareContext called without a Cloudflare context");
    return { env: mocks.env, ctx: { waitUntil: () => undefined }, cf: undefined };
  },
}));

const loadOrders = async () => import("@/app/api/collections/orders/route");
const loadCapture = async () => import("@/app/api/collections/orders/[orderId]/capture/route");
const loadWiring = async () => import("@/collections/wiring");

beforeEach(() => {
  vi.resetModules();
  mocks.env = {
    TWOKEY_SESSION_SECRET: SECRET,
    TWOKEY_SITE_ORIGIN: SITE,
    PAYPAL_CLIENT_ID: FAKE_CLIENT_ID,
    PAYPAL_CLIENT_SECRET: FAKE_CLIENT_SECRET,
  };
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the Collections routes", () => {
  it("export POST only, on the Node.js runtime", async () => {
    for (const route of [await loadOrders(), await loadCapture()]) {
      expect(Object.keys(route).sort()).toEqual(["POST", "runtime"]);
      expect(route.runtime).toBe("nodejs");
    }
  });

  it("answer 503 misconfigured while the ledger store isn't wired, before touching PayPal", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { cookie } = await sessionCookie();
    const created = await (await loadOrders()).POST(post(API.orders, { eventId: "banquet", quantity: 1 }, { cookie }));
    expect(created.status).toBe(503);
    expect(await created.json()).toMatchObject({ error: { code: "misconfigured" } });
    const captured = await (await loadCapture()).POST(post(API.capture(ORDER_ID), {}, { cookie }), {
      params: Promise.resolve({ orderId: ORDER_ID }),
    });
    expect(captured.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("read the PayPal app and session config from the Worker env, falling back to process.env", async () => {
    const wiring = await loadWiring();
    expect(wiring.collectionsDeps().env).toMatchObject({ PAYPAL_CLIENT_ID: FAKE_CLIENT_ID, TWOKEY_SITE_ORIGIN: SITE });
    mocks.env = undefined;
    vi.stubEnv("PAYPAL_CLIENT_ID", "from-process-env");
    expect((await loadWiring()).collectionsDeps().env.PAYPAL_CLIENT_ID).toBe("from-process-env");
  });

  it("give the pay page only public values: the client id and the sandbox test buyer, when both vars are set", async () => {
    const wiring = await loadWiring();
    expect(wiring.payPagePublicConfig()).toEqual({ paypalClientId: FAKE_CLIENT_ID, testBuyer: null });
    mocks.env = { ...mocks.env, TWOKEY_TEST_BUYER_EMAIL: "buyer@example.test", TWOKEY_TEST_BUYER_PASSWORD: "sandbox-pass" };
    const config = wiring.payPagePublicConfig();
    expect(config).toEqual({ paypalClientId: FAKE_CLIENT_ID, testBuyer: { email: "buyer@example.test", password: "sandbox-pass" } });
    expect(JSON.stringify(config)).not.toContain(FAKE_CLIENT_SECRET);
    expect(JSON.stringify(config)).not.toContain(SECRET);
    mocks.env = { ...mocks.env, TWOKEY_TEST_BUYER_PASSWORD: " " };
    expect(wiring.payPagePublicConfig().testBuyer).toBeNull();
  });

  it("leave the ledger store unwired for now", async () => {
    expect((await loadWiring()).ledgerStoreFor({})).toBeUndefined();
  });
});
