/**
 * The pay page's checkout, without React: what happens on a wallet button's click and in PayPal's
 * callbacks. The click starts PayPal's window at once (inside the click, so popup blockers allow
 * it) and hands it a promise of the server's order; on approval the page asks the server to
 * capture. Every message the parent sees is in plain words: the server's own, or this file's.
 */
import type { CaptureResult, CreateOrderBody } from "@/ledger/contracts";
import { PayApiError, type PayApi, type PayMethod } from "./pay-api";
import type { PaymentSession, SessionOptions } from "./paypal-sdk";

export type CheckoutStatus =
  | { kind: "idle" }
  /** PayPal's window is opening, or open. */
  | { kind: "opening"; method: PayMethod }
  /** The buyer approved; the server is capturing. */
  | { kind: "capturing"; method: PayMethod }
  | { kind: "paid"; method: PayMethod; quantity: number; result: CaptureResult }
  | { kind: "cancelled" }
  | { kind: "failed"; message: string };

export const PAYPAL_ERROR = "PayPal couldn't finish the payment. Nothing was charged; try again.";

export interface CheckoutDeps {
  api: PayApi;
  eventId: CreateOrderBody["eventId"];
  /** The quantity on the ticket at the moment of the click. */
  quantity(): number;
  onStatus(status: CheckoutStatus): void;
}

export interface Checkout {
  pay(method: PayMethod, session: PaymentSession): void;
  sessionOptions(method: PayMethod): SessionOptions;
}

const messageOf = (error: unknown): string => (error instanceof PayApiError ? error.message : PAYPAL_ERROR);

export function createCheckout(deps: CheckoutDeps): Checkout {
  let orderError: string | undefined;
  let quantity = deps.quantity();

  return {
    pay(method, session) {
      orderError = undefined;
      quantity = deps.quantity();
      deps.onStatus({ kind: "opening", method });
      const order = deps.api.createOrder(deps.eventId, quantity).catch((error: unknown) => {
        orderError = messageOf(error);
        throw error;
      });
      // Marks the rejection handled here too; PayPal's SDK still receives it through `start`.
      order.catch(() => undefined);
      session.start({ presentationMode: "auto" }, order).catch(() => {
        deps.onStatus({ kind: "failed", message: orderError ?? PAYPAL_ERROR });
      });
    },

    sessionOptions(method) {
      return {
        async onApprove({ orderId }) {
          deps.onStatus({ kind: "capturing", method });
          try {
            const result = await deps.api.captureOrder(orderId, method);
            deps.onStatus({ kind: "paid", method, quantity, result });
          } catch (error) {
            deps.onStatus({ kind: "failed", message: messageOf(error) });
          }
        },
        onCancel() {
          deps.onStatus({ kind: "cancelled" });
        },
        onError() {
          deps.onStatus({ kind: "failed", message: orderError ?? PAYPAL_ERROR });
        },
      };
    },
  };
}
