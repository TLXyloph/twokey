import { describe, expect, it } from "vitest";
import { summarizePaypalEvent } from "@/payments/paypal/event-summary";
import {
  AWKWARD_RAW_EVENT,
  captureCompletedEvent,
  payoutsBatchSuccessEvent,
  payoutsItemSucceededEvent,
  rawEvent,
} from "./fixtures";

const summary = (event: unknown) => {
  const result = summarizePaypalEvent(typeof event === "string" ? event : JSON.stringify(event));
  if (!result.ok) throw new Error(`expected a summary, got ${result.reason}`);
  return result.value;
};

describe("summarizePaypalEvent", () => {
  it("reads a capture: resource id, status and amount with currency_code", () => {
    expect(summary(captureCompletedEvent)).toEqual({
      eventId: "WH-TEST0001-CAPTURE",
      eventType: "PAYMENT.CAPTURE.COMPLETED",
      resourceType: "capture",
      resourceId: "CAPTURE-TEST-0001",
      resourceStatus: "COMPLETED",
      amountValue: "500.00",
      amountCurrency: "USD",
      eventCreatedAt: "2026-11-03T20:00:00.000Z",
    });
  });

  it("reads a payout batch from batch_header, with currency", () => {
    expect(summary(payoutsBatchSuccessEvent)).toMatchObject({
      eventType: "PAYMENT.PAYOUTSBATCH.SUCCESS",
      resourceType: "payouts",
      resourceId: "BATCHTEST0001",
      resourceStatus: "SUCCESS",
      amountValue: "1.00",
      amountCurrency: "USD",
    });
  });

  it("reads a payout item from payout_item_id, transaction_status and payout_item.amount", () => {
    expect(summary(payoutsItemSucceededEvent)).toMatchObject({
      eventType: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
      resourceType: "payouts_item",
      resourceId: "ITEMTEST0001",
      resourceStatus: "SUCCESS",
      amountValue: "1.00",
      amountCurrency: "USD",
    });
  });

  it("goes by the resource's shape, not resource_type", () => {
    const relabelled = { ...payoutsBatchSuccessEvent, resource_type: "something-new" };
    expect(summary(relabelled)).toMatchObject({ resourceType: "something-new", resourceId: "BATCHTEST0001", amountValue: "1.00" });
    const unlabelled = { ...payoutsItemSucceededEvent, resource_type: undefined };
    expect(summary(unlabelled)).toMatchObject({ resourceType: null, resourceId: "ITEMTEST0001", resourceStatus: "SUCCESS" });
  });

  it("keeps the envelope and nulls every summary field it can't read", () => {
    expect(summary({ id: "WH-TEST0005-BARE", event_type: "CUSTOMER.SOMETHING" })).toEqual({
      eventId: "WH-TEST0005-BARE",
      eventType: "CUSTOMER.SOMETHING",
      resourceType: null,
      resourceId: null,
      resourceStatus: null,
      amountValue: null,
      amountCurrency: null,
      eventCreatedAt: null,
    });
  });

  it("ignores summary fields of the wrong type instead of rejecting the event", () => {
    const odd = {
      id: "WH-TEST0006-ODD",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource_type: 7,
      create_time: { not: "a string" },
      resource: { id: 12, status: ["COMPLETED"], amount: { value: 500, currency_code: "USD" } },
    };
    expect(summary(odd)).toMatchObject({ resourceType: null, resourceId: null, resourceStatus: null, amountValue: null, amountCurrency: "USD", eventCreatedAt: null });
    expect(summary({ ...odd, resource: "not an object" })).toMatchObject({ resourceId: null, amountValue: null });
  });

  it("parses an awkwardly formatted body", () => {
    expect(summary(AWKWARD_RAW_EVENT)).toMatchObject({ eventId: "WH-TEST0004-AWKWARD", resourceId: "CAPTURE-TEST-0004", amountValue: "12.50" });
  });

  it.each([
    ["invalid JSON", "{not json", "invalid_json"],
    ["an array", "[]", "not_an_object"],
    ["null", "null", "not_an_object"],
    ["no id", JSON.stringify({ event_type: "X" }), "invalid_envelope"],
    ["no event_type", JSON.stringify({ id: "WH-1" }), "invalid_envelope"],
    ["an empty id", JSON.stringify({ id: "", event_type: "X" }), "invalid_envelope"],
    ["a numeric id", JSON.stringify({ id: 1, event_type: "X" }), "invalid_envelope"],
    ["an id over 255 characters", JSON.stringify({ id: "W".repeat(256), event_type: "X" }), "invalid_envelope"],
  ])("refuses %s", (_label, raw, reason) => {
    expect(summarizePaypalEvent(raw)).toEqual({ ok: false, reason });
  });

  it("accepts the fixtures' raw text as sent", () => {
    expect(summarizePaypalEvent(rawEvent(captureCompletedEvent)).ok).toBe(true);
  });
});
