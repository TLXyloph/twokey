import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueSession } from "@/agents/llm/judge-session";
import { payeeById } from "@/disbursements/payees";
import type { BoardView } from "@/ledger/contracts";
import { createD1PaypalEventStore } from "@/ledger/event-store";
import { TRANSACTIONS_PATH } from "@/payments/paypal/transactions";
import type { WatchReplay } from "@/watchtower/contracts";
import { sqliteD1, type SqliteD1 } from "../../../agents/llm/sqlite-d1";
import measured from "../../../fixtures/paypal/transaction-search-2026-11-05.json";
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
const SESSION_SECRET = "test-session-secret-not-real-0123456789abcdef";
const CRON_SECRET = "test-cron-secret-not-real-0123456789abcdefghij";
const VENDOR = payeeById("team-supply")!.email;
let d1: SqliteD1;
let paypal: FakePaypal;
let cookie: string;

const payoutRow = (id: string, value: string, customField: string) => ({
  payer_info: { email_address: VENDOR },
  transaction_info: {
    transaction_id: id,
    transaction_event_code: "T0001",
    transaction_initiation_date: "2026-11-05T14:00:00Z",
    transaction_amount: { currency_code: "USD", value },
    fee_amount: { currency_code: "USD", value: "-0.25" },
    transaction_status: "S",
    custom_field: customField,
  },
});

const routes = async () => ({
  run: await import("@/app/api/watchtower/run/route"),
  replay: await import("@/app/api/watchtower/replay/route"),
  view: await import("@/app/api/ledger/view/route"),
  risk: await import("@/app/api/payouts/requests/[id]/risk/route"),
  sign: await import("@/app/api/payouts/requests/[id]/sign/route"),
});
const cron = (authorization?: string) =>
  new Request(`${SITE}/api/watchtower/run`, { method: "POST", headers: authorization ? { authorization } : {} });
const judgePost = (path: string, body?: unknown) =>
  new Request(`${SITE}${path}`, {
    method: "POST",
    headers: { origin: SITE, "sec-fetch-site": "same-origin", "content-type": "application/json", cookie },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(async () => {
  vi.resetModules();
  d1 = sqliteD1();
  const asOf = new Date(Date.now() - 60 * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  paypal = fakePaypal({
    handle: (call) => {
      if (call.url === `${SANDBOX}/v1/payments/payouts`) {
        return Response.json({ batch_header: { payout_batch_id: "BATCH-ROUTE-1", batch_status: "PENDING" } }, { status: 201 });
      }
      if (new URL(call.url).pathname !== TRANSACTIONS_PATH) return undefined;
      return Response.json({
        ...measured,
        last_refreshed_datetime: asOf,
        transaction_details: [...measured.transaction_details, payoutRow("T0001SIGNED00001", "-42.00", "L14"), payoutRow("T0001ROGUE000001", "-10.00", "L14")],
      });
    },
  });
  vi.stubGlobal("fetch", (input: string, init: RequestInit) => paypal.fetch(input, init));
  mocks.env = {
    DB: d1.db,
    TWOKEY_SESSION_SECRET: SESSION_SECRET,
    TWOKEY_SITE_ORIGIN: SITE,
    TWOKEY_CRON_SECRET: CRON_SECRET,
    PAYPAL_CLIENT_ID: FAKE_CLIENT_ID,
    PAYPAL_CLIENT_SECRET: FAKE_CLIENT_SECRET,
    ...(await keys.ready).env,
  };
  cookie = (await issueSession(SESSION_SECRET, Date.now())).setCookie.split(";")[0]!;
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** L14 signed by two officers through the judge routes, and PayPal's item webhook for it stored. */
async function sendL14WithWebhook() {
  const { view, risk, sign } = await routes();
  await view.GET(new Request(`${SITE}/api/ledger/view`, { headers: { cookie } }));
  expect((await risk.POST(judgePost("/api/payouts/requests/L14/risk", {}), params("L14"))).status).toBe(200);
  expect((await sign.POST(judgePost("/api/payouts/requests/L14/sign", { actingAs: "president", acknowledgedFlags: false }), params("L14"))).status).toBe(200);
  const item = { id: "WH-ROUTE-ITEM", event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", resource: { transaction_id: "T0001SIGNED00001", payout_batch_id: "BATCH-ROUTE-1" } };
  await createD1PaypalEventStore(d1.db).append({
    eventId: item.id,
    eventType: item.event_type,
    resourceType: "payouts_item",
    resourceId: null,
    resourceStatus: "SUCCESS",
    amountValue: "42.00",
    amountCurrency: "USD",
    eventCreatedAt: null,
    receivedAt: new Date().toISOString(),
    payload: JSON.stringify(item),
  });
}

describe("the Watchtower routes", () => {
  it("export POST only, on the Node.js runtime", async () => {
    const { run, replay } = await routes();
    for (const route of [run, replay]) {
      expect(Object.keys(route).sort()).toEqual(["POST", "runtime"]);
      expect(route.runtime).toBe("nodejs");
    }
  });

  it("run end to end on D1: a two-key payout is matched, everything else is flagged, and every session's board shows it", async () => {
    await sendL14WithWebhook();
    const { run, view } = await routes();
    const response = await run.POST(cron(`Bearer ${CRON_SECRET}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "ok", newFindings: 5 });
    const search = paypal.calls.find((c) => c.url.includes(TRANSACTIONS_PATH))!;
    expect(new URL(search.url).searchParams.get("start_date")).toBe("2026-11-01T00:00:00Z");

    const flagged = d1.all("SELECT transaction_id, kind, label FROM watchtower_findings ORDER BY transaction_id") as { transaction_id: string }[];
    expect(flagged.map((row) => row.transaction_id)).toEqual(["1TY14748YE721631B", "22N17109956532336", "23Y96953CP0068646", "3XT37311AK7894010", "T0001ROGUE000001"]);
    expect(d1.all("SELECT label FROM watchtower_findings WHERE transaction_id = 'T0001ROGUE000001'")).toEqual([{ label: "Payout outside the two-key flow" }]);
    expect(d1.all("SELECT outcome, rows_seen, new_findings FROM watchtower_runs")).toEqual([{ outcome: "ok", rows_seen: 13, new_findings: 5 }]);
    const stored = JSON.stringify(d1.all("SELECT * FROM watchtower_findings"));
    for (const email of ["sb-wdqmv53686001@personal.example.com", "sb-6j9x4753696003@personal.example.com", VENDOR]) expect(stored).not.toContain(email);

    const otherCookie = (await issueSession(SESSION_SECRET, Date.now(), (n) => new Uint8Array(n).fill(3))).setCookie.split(";")[0]!;
    const board = (await (await view.GET(new Request(`${SITE}/api/ledger/view`, { headers: { cookie: otherCookie } }))).json()) as BoardView;
    expect(board.watchtower?.status).toBe("ok");
    expect(board.watchtower?.findings.map((f) => f.transactionId)).toEqual(["T0001ROGUE000001", "1TY14748YE721631B", "22N17109956532336"]);
    expect(board.watchtower?.explained.map((f) => f.transactionId)).toEqual(["23Y96953CP0068646", "3XT37311AK7894010"]);

    const again = await run.POST(cron(`Bearer ${CRON_SECRET}`));
    expect(await again.json()).toEqual({ outcome: "ok", newFindings: 0 });
  });

  it("refuse the run without the secret, and answer 503 when it isn't set", async () => {
    const { run } = await routes();
    expect((await run.POST(cron())).status).toBe(401);
    expect((await run.POST(cron("Bearer not-the-secret"))).status).toBe(401);
    mocks.env = { ...mocks.env, TWOKEY_CRON_SECRET: undefined };
    expect((await run.POST(cron(`Bearer ${CRON_SECRET}`))).status).toBe(503);
    expect(d1.all("SELECT run_id FROM watchtower_runs")).toEqual([]);
  });

  it("replay the recorded outside send for a judge session, storing nothing", async () => {
    const { replay } = await routes();
    const response = await replay.POST(judgePost("/api/watchtower/replay"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as WatchReplay;
    expect(body.finding).toMatchObject({ transactionId: "1TY14748YE721631B", kind: "outside_debit", fundedByBank: true });
    expect(d1.all("SELECT transaction_id FROM watchtower_findings")).toEqual([]);
  });
});
