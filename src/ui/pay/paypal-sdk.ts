/**
 * PayPal's JS SDK v6, loaded from PayPal's sandbox only, and the few calls the pay page makes:
 *
 *   window.paypal.createInstance({ clientId, components, pageType, testBuyerCountry })
 *   instance.findEligibleMethods({ currencyCode: "USD" }) -> isEligible("paypal" | "venmo")
 *   instance.createPayPalOneTimePaymentSession(options) / createVenmoOneTimePaymentSession(options)
 *   session.start({ presentationMode: "auto" }, Promise<{ orderId }>)
 *
 * Verified against developer.paypal.com/sdk/js/set-up, /sdk/js/reference, /venmo and the v6 types
 * in github.com/paypal/paypal-js (packages/paypal-js/types/v6). v6 accepts the app's client id
 * (public by design) instead of a server-minted client token; client tokens are only required for
 * Fastlane. `testBuyerCountry: "US"` makes the sandbox treat the buyer as American, which Venmo needs.
 */

export const PAYPAL_SDK_URL = "https://www.sandbox.paypal.com/web-sdk/v6/core";
const SCRIPT_MARK = "data-twokey-paypal-sdk";

export type WalletMethod = "paypal" | "venmo";

export interface ApproveData {
  orderId: string;
  payerId?: string;
}

export interface SessionOptions {
  onApprove(data: ApproveData): Promise<void>;
  onCancel?(data: { orderId?: string }): void;
  onError?(error: { code?: string; message?: string }): void;
}

export interface PaymentSession {
  start(options: { presentationMode: "auto" }, order: Promise<{ orderId: string }>): Promise<void>;
}

interface SdkInstance {
  findEligibleMethods(options: { currencyCode: string }): Promise<{ isEligible(method: string): boolean }>;
  createPayPalOneTimePaymentSession(options: SessionOptions): PaymentSession;
  createVenmoOneTimePaymentSession?(options: SessionOptions): PaymentSession;
}

export interface PaypalNamespace {
  createInstance(options: {
    clientId: string;
    components: string[];
    pageType: "checkout";
    testBuyerCountry: string;
  }): Promise<SdkInstance>;
}

declare global {
  interface Window {
    paypal?: PaypalNamespace;
  }
}

/** Adds PayPal's sandbox v6 script once and resolves to `window.paypal`. */
export function loadPaypalSdk(timeoutMs = 15_000): Promise<PaypalNamespace> {
  if (window.paypal?.createInstance) return Promise.resolve(window.paypal);
  return new Promise((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>(`script[${SCRIPT_MARK}]`);
    if (!script) {
      script = document.createElement("script");
      script.src = PAYPAL_SDK_URL;
      script.async = true;
      script.setAttribute(SCRIPT_MARK, "");
      document.head.append(script);
    }
    const timer = window.setTimeout(() => reject(new Error("PayPal's script took too long to load")), timeoutMs);
    script.addEventListener("load", () => {
      window.clearTimeout(timer);
      if (window.paypal?.createInstance) resolve(window.paypal);
      else reject(new Error("PayPal's script loaded without the v6 SDK"));
    });
    script.addEventListener("error", () => {
      window.clearTimeout(timer);
      reject(new Error("PayPal's script didn't load"));
    });
  });
}

export interface Wallets {
  /** The wallets PayPal says this buyer can use, PayPal first. */
  methods: WalletMethod[];
  session(method: WalletMethod, options: SessionOptions): PaymentSession;
}

const BASE = { pageType: "checkout", testBuyerCountry: "US" } as const;

/**
 * Creates the SDK instance and asks PayPal which wallets to show. Venmo is opt-in: if its component
 * fails to load, the page still offers PayPal.
 */
export async function setUpWallets(paypal: PaypalNamespace, clientId: string): Promise<Wallets> {
  let instance: SdkInstance;
  let venmoLoaded = true;
  try {
    instance = await paypal.createInstance({ clientId, components: ["paypal-payments", "venmo-payments"], ...BASE });
  } catch {
    venmoLoaded = false;
    instance = await paypal.createInstance({ clientId, components: ["paypal-payments"], ...BASE });
  }
  const eligible = await instance.findEligibleMethods({ currencyCode: "USD" });
  const methods: WalletMethod[] = [];
  if (eligible.isEligible("paypal")) methods.push("paypal");
  if (venmoLoaded && instance.createVenmoOneTimePaymentSession && eligible.isEligible("venmo")) methods.push("venmo");
  return {
    methods,
    session(method, options) {
      if (method === "venmo" && instance.createVenmoOneTimePaymentSession) return instance.createVenmoOneTimePaymentSession(options);
      return instance.createPayPalOneTimePaymentSession(options);
    },
  };
}
