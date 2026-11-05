import { describe, expect, it } from "vitest";
import type { PayoutRequestView } from "@/ledger/contracts";
import type { LedgerTable } from "@/ledger/ledger-table";
import { handleCreatePayoutRequest, handleRiskRead, handleSignPayout } from "@/disbursements/api/payout-handlers";
import { generateTestDemoKeys } from "../demo-keys";
import { errorOf, judgeFixture, post, type JudgeFixture } from "./judge-fixtures";

const cones = { actingAs: "president", payeeId: "team-supply", amountCents: 4800, description: "Practice cones", budgetLine: "equipment", receiptId: "cones-team-supply" };
const view = async (response: Response) => ((await response.json()) as { request: PayoutRequestView }).request;
const create = (f: JudgeFixture, body: unknown = cones) => handleCreatePayoutRequest(post("/api/payouts/requests", body, f.cookie), f.deps);
const risk = (f: JudgeFixture, id: string) => handleRiskRead(post(`/api/payouts/requests/${id}/risk`, {}, f.cookie), id, f.deps);
const sign = (f: JudgeFixture, id: string, actingAs: string, acknowledgedFlags = false) =>
  handleSignPayout(post(`/api/payouts/requests/${id}/sign`, { actingAs, acknowledgedFlags }, f.cookie), id, f.deps);

describe("POST /api/payouts/requests", () => {
  it("creates a request with key 1 on it and answers 201 with its view, never cached", async () => {
    const f = await judgeFixture();
    const response = await create(f);
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const request = await view(response);
    expect(request).toMatchObject({
      requestId: "R-1",
      sourceLabel: "live sandbox",
      amountCents: 4800,
      requestedBy: "president",
      status: "waiting",
      riskPending: true,
      eligibleSigners: ["treasurer", "secretary"],
    });
    expect(request.signatures).toHaveLength(1);
    expect(f.lines).toEqual([`[payouts/requests] outcome=created status=201 session=${f.sessionId.slice(0, 8)}`]);
  });

  it("answers 400 naming the fields that are wrong", async () => {
    const f = await judgeFixture();
    const response = await create(f, { ...cones, amountCents: 5001, payeeId: "someone@example.com" });
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toEqual({ code: "bad_request", message: "Check these fields and try again: payeeId, amountCents." });
  });

  it("refuses the payee as requester with 409 and a sentence the drawer can show", async () => {
    const f = await judgeFixture();
    const response = await create(f, { ...cones, actingAs: "treasurer", payeeId: "treasurer-reimbursement" });
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toEqual({
      code: "payee_cannot_sign",
      message: "The Treasurer is the payee, so the Treasurer can't request (and sign) this payout.",
    });
  });
});

describe("POST /api/payouts/requests/:id/risk and /sign", () => {
  it("reads the receipt, then sends L14 when the President adds key 2", async () => {
    const f = await judgeFixture();
    const read = await risk(f, "L14");
    expect(read.status).toBe(200);
    expect((await view(read)).riskPending).toBe(false);
    const signed = await sign(f, "L14", "president");
    expect(signed.status).toBe(200);
    const request = await view(signed);
    expect(request.status).toBe("sent");
    expect(request.timeline.map((s) => s.label)).toEqual(["Requested by the Treasurer", "Signed by the President", "Sent to PayPal"]);
    expect(f.paypal.postJson).toHaveBeenCalledTimes(1);
    expect(f.paypal.postJson.mock.calls[0]![3]).toEqual({ "PayPal-Request-Id": request.requestHash });
    expect(f.lines.at(-1)).toBe(`[payouts/sign] outcome=signed_sent status=200 session=${f.sessionId.slice(0, 8)}`);
  });

  it("refuses the Treasurer on L15 (the payee) with 409, records it, and shows it in the view", async () => {
    const f = await judgeFixture();
    await risk(f, "L15");
    const response = await sign(f, "L15", "treasurer");
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toEqual({ code: "payee_cannot_sign", message: "The Treasurer is the payee, so the Treasurer can't sign this payout." });
    const again = await view(await risk(f, "L15"));
    expect(again.refusals).toEqual([expect.objectContaining({ role: "treasurer", code: "payee_cannot_sign" })]);
    expect(f.paypal.postJson).not.toHaveBeenCalled();
  });

  it("answers 409 with the limit when key 2 is signed but a limit stops the payout", async () => {
    const f = await judgeFixture();
    for (let i = 0; i < 2; i++) await create(f, { ...cones, amountCents: 100 });
    for (const [id, who] of [["L14", "president"], ["L15", "president"], ["R-1", "treasurer"]]) {
      await risk(f, id!);
      expect((await sign(f, id!, who!)).status).toBe(200);
    }
    await risk(f, "R-2");
    const response = await sign(f, "R-2", "secretary");
    expect(response.status).toBe(409);
    expect((await errorOf(response)).code).toBe("session_payout_limit");
  });

  it("answers 404 for a request that isn't in this session, or an id that can't be one", async () => {
    const f = await judgeFixture();
    expect(await errorOf(await sign(f, "R-404", "president"))).toMatchObject({ code: "unknown_request" });
    expect((await sign(f, "../../etc", "president")).status).toBe(404);
    expect((await risk(f, "R-404")).status).toBe(404);
  });

  it("answers 400 to a sign body with an unknown role or extra fields, and to a risk body that isn't {}", async () => {
    const f = await judgeFixture();
    expect((await sign(f, "L14", "coach")).status).toBe(400);
    const extra = post("/api/payouts/requests/L14/sign", { actingAs: "president", acknowledgedFlags: false, amountCents: 1 }, f.cookie);
    expect((await handleSignPayout(extra, "L14", f.deps)).status).toBe(400);
    expect((await handleRiskRead(post("/api/payouts/requests/L14/risk", { model: "x" }, f.cookie), "L14", f.deps)).status).toBe(400);
    expect((await handleRiskRead(post("/api/payouts/requests/L14/risk", undefined, f.cookie), "L14", f.deps)).status).toBe(200);
  });

  it("fails closed with 503 when PayPal isn't configured, before signing anything", async () => {
    const f = await judgeFixture({ paypal: undefined });
    await risk(f, "L14");
    const response = await sign(f, "L14", "president");
    expect(response.status).toBe(503);
    expect((await errorOf(response)).code).toBe("paypal_unconfigured");
    expect(f.table.all().some((e) => e.type === "approval.signed" && e.payload && (e.payload as { role: string }).role === "president")).toBe(false);
  });
});

describe("the checks every judge route runs first", () => {
  it("answers 401 no_session without the cookie, so the browser fetches one and retries", async () => {
    const f = await judgeFixture();
    const response = await handleCreatePayoutRequest(post("/api/payouts/requests", cones, null), f.deps);
    expect(response.status).toBe(401);
    expect((await errorOf(response)).code).toBe("no_session");
  });

  it("answers 403 to a POST from another site", async () => {
    const f = await judgeFixture();
    const response = await handleCreatePayoutRequest(post("/api/payouts/requests", cones, f.cookie, { origin: "https://evil.example", "sec-fetch-site": "cross-site" }), f.deps);
    expect(response.status).toBe(403);
  });

  it("fails closed with 503 demo_keys_unset when the keys are missing, in development too", async () => {
    const f = await judgeFixture({ development: true, env: { TWOKEY_SESSION_SECRET: "test-session-secret-not-real-0123456789abcdef" } });
    const response = await create(f);
    expect(response.status).toBe(503);
    expect(await errorOf(response)).toMatchObject({ code: "demo_keys_unset" });
    expect(f.lines[0]).toContain("detail=TWOKEY_DEMO_KEY_PRESIDENT:unset,TWOKEY_DEMO_KEY_TREASURER:unset,TWOKEY_DEMO_KEY_SECRETARY:unset");
  });

  it("fails closed with 503 when the keys don't match the published public keys", async () => {
    const other = await generateTestDemoKeys();
    const f = await judgeFixture({ publicKeys: other.publicKeys });
    expect(await errorOf(await create(f))).toMatchObject({ code: "demo_keys_mismatch" });
  });

  it("answers 503 without the D1 binding or the session secret", async () => {
    expect((await create(await judgeFixture({ table: undefined }))).status).toBe(503);
    const f = await judgeFixture();
    f.deps.env = { ...f.deps.env, TWOKEY_SESSION_SECRET: undefined };
    expect(await errorOf(await create(f))).toMatchObject({ code: "misconfigured" });
  });

  it("answers 413 to a body over 8 KB and 400 to one that isn't JSON", async () => {
    const f = await judgeFixture();
    expect((await create(f, { ...cones, description: "x".repeat(9000) })).status).toBe(413);
    expect((await create(f, "{not json")).status).toBe(400);
  });

  it("answers 500 when the ledger fails, without its error text", async () => {
    const f = await judgeFixture();
    const broken: LedgerTable = { ...f.table, events: async () => Promise.reject(new Error("D1_ERROR secret-ish detail")) };
    const response = await create({ ...f, deps: { ...f.deps, table: broken } });
    expect(response.status).toBe(500);
    expect(await errorOf(response)).toEqual({ code: "internal", message: "The ledger failed on the server. Try again." });
    expect(f.lines.join("\n")).not.toContain("secret-ish");
  });

  it("never logs a key, the secret or the cookie", async () => {
    const f = await judgeFixture();
    await create(f);
    await sign(f, "R-1", "parent");
    const logged = f.lines.join("\n");
    for (const value of [...Object.values(f.keys.env), f.deps.env.TWOKEY_SESSION_SECRET!, f.cookie]) expect(logged).not.toContain(value);
  });
});
