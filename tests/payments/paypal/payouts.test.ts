import { describe, expect, it, vi } from "vitest";
import { createPaypalClient } from "@/payments/paypal/client";
import { formatAmount, getPayoutBatch, PAYOUTS_PATH, sendPayout, type PayoutOrder } from "@/payments/paypal/payouts";
import { FAKE_CLIENT_ID, FAKE_CLIENT_SECRET, FAKE_TOKEN, fakePaypal, SANDBOX, type FakeCall } from "./fixtures";

const HASH = "ab".repeat(32);
const order: PayoutOrder = {
  senderBatchId: HASH,
  requestId: "req-1",
  receiverEmail: "vendor-fictional@example.test",
  amountCents: 4200,
  currency: "USD",
  note: "Goalkeeper gloves. Signed by the Treasurer and the President (TwoKey demo).",
  emailSubject: "A payout from the Riverbend Youth Football League (demo)",
};

const clientWith = (handle: (call: FakeCall) => Response | undefined) => {
  const paypal = fakePaypal({ handle });
  return { paypal, client: createPaypalClient({ clientId: FAKE_CLIENT_ID, clientSecret: FAKE_CLIENT_SECRET, fetch: paypal.fetch }) };
};

const batch = (status: string, id: string, httpStatus: number) =>
  Response.json({ batch_header: { payout_batch_id: id, batch_status: status, sender_batch_header: { sender_batch_id: HASH } } }, { status: httpStatus });
/** POST's answer (201 Created). */
const created = (status = "PENDING", id = "BATCH-1") => batch(status, id, 201);
/** GET's answer (200). */
const fetched = (status: string, id: string) => batch(status, id, 200);

describe("formatAmount", () => {
  it("writes cents as PayPal's decimal string", () => {
    expect(formatAmount(4200)).toBe("42.00");
    expect(formatAmount(3650)).toBe("36.50");
    expect(formatAmount(5)).toBe("0.05");
  });
});

describe("sendPayout", () => {
  it("posts one EMAIL item with sender_batch_id and PayPal-Request-Id both set to the request hash", async () => {
    const { paypal, client } = clientWith(() => created());
    expect(await sendPayout(client, order)).toEqual({ ok: true, payoutBatchId: "BATCH-1", batchStatus: "PENDING", existing: false });
    const call = paypal.calls.find((c) => c.url === `${SANDBOX}${PAYOUTS_PATH}`)!;
    expect(call.method).toBe("POST");
    expect(call.headers.get("paypal-request-id")).toBe(HASH);
    expect(call.headers.get("authorization")).toBe(`Bearer ${FAKE_TOKEN}`);
    expect(JSON.parse(call.body)).toEqual({
      sender_batch_header: { sender_batch_id: HASH, email_subject: order.emailSubject },
      items: [
        {
          recipient_type: "EMAIL",
          amount: { value: "42.00", currency: "USD" },
          note: order.note,
          sender_item_id: "req-1",
          receiver: "vendor-fictional@example.test",
        },
      ],
    });
  });

  it("resolves a 400 'already exists' to the existing batch instead of failing", async () => {
    const duplicate = () =>
      Response.json(
        { name: "USER_BUSINESS_ERROR", message: "User business error.", details: [{ field: "SENDER_BATCH_ID", issue: "Batch with given sender_batch_id already exists" }] },
        { status: 400 },
      );
    const { client } = clientWith((call) => (call.method === "POST" ? duplicate() : fetched("SUCCESS", "BATCH-7")));
    const find = vi.fn(async () => "BATCH-7");
    expect(await sendPayout(client, order, { findExistingBatchId: find })).toEqual({ ok: true, payoutBatchId: "BATCH-7", batchStatus: "SUCCESS", existing: true });
    expect(find).toHaveBeenCalledWith(HASH);
  });

  it("still reports an existing batch as sent when its id can't be found (PayPal's webhook will name it)", async () => {
    const { client } = clientWith(() => Response.json({ name: "USER_BUSINESS_ERROR", message: "Batch already exists" }, { status: 400 }));
    expect(await sendPayout(client, order)).toEqual({ ok: true, payoutBatchId: "", batchStatus: "EXISTING", existing: true });
  });

  it("explains a refusal in plain words and never passes PayPal's body through", async () => {
    const secretish = "debug-id-and-internal-detail-1234";
    const { client } = clientWith(() => Response.json({ name: "INSUFFICIENT_FUNDS", message: secretish, debug_id: secretish }, { status: 422 }));
    const result = await sendPayout(client, order);
    expect(result).toEqual({ ok: false, httpStatus: 422, reason: "The club's PayPal balance is too low for this payout." });
    expect(JSON.stringify(result)).not.toContain(secretish);
  });

  it("names other failures by kind: authorization, rate limit, PayPal's own errors, no answer", async () => {
    const reasonFor = async (response: () => Response) => {
      const result = await sendPayout(clientWith(response).client, order);
      return result.ok ? "sent" : `${result.httpStatus} ${result.reason}`;
    };
    expect(await reasonFor(() => Response.json({ name: "AUTHORIZATION_ERROR" }, { status: 403 }))).toBe(
      "403 PayPal didn't allow this app to send the payout.",
    );
    expect(await reasonFor(() => Response.json({}, { status: 429 }))).toBe("429 PayPal is limiting payouts right now, so this one wasn't taken.");
    expect(await reasonFor(() => new Response("", { status: 503 }))).toBe("503 PayPal had a problem on its side (HTTP 503) and didn't take the payout.");
    expect(await reasonFor(() => Response.json({ name: "VALIDATION_ERROR" }, { status: 400 }))).toBe("400 PayPal refused the payout (HTTP 400).");
    const down = fakePaypal({ networkError: true });
    const result = await sendPayout(createPaypalClient({ clientId: FAKE_CLIENT_ID, clientSecret: FAKE_CLIENT_SECRET, fetch: down.fetch }), order);
    expect(result).toEqual({
      ok: false,
      httpStatus: 0,
      reason: "PayPal didn't answer in time. If the payout went through anyway, PayPal's confirmation will still show here.",
    });
  });
});

describe("getPayoutBatch", () => {
  it("reads a batch's status by its payout_batch_id", async () => {
    const { paypal, client } = clientWith((call) => (call.method === "GET" ? fetched("SUCCESS", "BATCH/1") : undefined));
    expect(await getPayoutBatch(client, "BATCH/1")).toEqual({ payoutBatchId: "BATCH/1", batchStatus: "SUCCESS" });
    expect(paypal.calls.at(-1)?.url).toBe(`${SANDBOX}/v1/payments/payouts/BATCH%2F1`);
  });

  it("is null when PayPal can't say", async () => {
    const { client } = clientWith(() => Response.json({ name: "INVALID_RESOURCE_ID" }, { status: 404 }));
    expect(await getPayoutBatch(client, "BATCH-404")).toBeNull();
  });
});
