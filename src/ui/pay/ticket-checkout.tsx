"use client";

/**
 * The live part of the ticket: how many tickets, the total, PayPal's v6 buttons (Venmo beside
 * PayPal only when PayPal says the buyer is eligible), and every state after the click. Without a
 * client id, or when PayPal's script can't load, the button area says calmly that payments are
 * unavailable. After the capture, the ticket is stamped with PayPal's capture id.
 */
import { useEffect, useRef, useState, type DetailedHTMLProps, type HTMLAttributes } from "react";
import type { CreateOrderBody } from "@/ledger/contracts";
import { createCheckout, type Checkout, type CheckoutStatus } from "./checkout";
import { TICKET } from "./content";
import { createPayApi } from "./pay-api";
import { clampQuantity, formatDollars, METHOD_LABEL, ticketsLabel } from "./pay-model";
import { loadPaypalSdk, setUpWallets, type PaymentSession, type WalletMethod } from "./paypal-sdk";

type WalletElement = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & { type?: string };
// PayPal's v6 web components, for JSX.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "paypal-button": WalletElement;
      "venmo-button": WalletElement;
    }
  }
}

export interface TicketEvent {
  id: CreateOrderBody["eventId"];
  ticketPriceCents: number;
  minTickets: number;
  maxTickets: number;
}

type Readiness = { kind: "loading" } | { kind: "unavailable" } | { kind: "ready"; methods: WalletMethod[] };

const BUSY = new Set<CheckoutStatus["kind"]>(["opening", "capturing"]);

type Paid = Extract<CheckoutStatus, { kind: "paid" }>;

export interface PaidTicketProps {
  result: Paid["result"];
  method: Paid["method"];
  quantity: number;
  judge: boolean;
  boardHref: string;
  ledgerHref: string;
  onBuyMore: () => void;
}

/**
 * The ticket once PayPal has the money, stamped with the capture id. In judge mode it leads on to the
 * parent ledger, where the payment lands, with the way back to the board beside it.
 */
export function PaidTicket({ result, method, quantity, judge, boardHref, ledgerHref, onBuyMore }: PaidTicketProps) {
  return (
    <div className="checkout checkout--paid" role="status">
      <p className="checkout__stamp" aria-hidden="true">
        Paid
      </p>
      <h2 className="checkout__paid-title">{TICKET.paidHeading}</h2>
      <p className="checkout__paid-line">
        {ticketsLabel(quantity)} · {formatDollars(result.amountCents)} · paid with {METHOD_LABEL[method]}
      </p>
      <p className="checkout__capture">
        PayPal capture <strong>{result.captureId}</strong>
      </p>
      <p className="checkout__note">{result.status === "COMPLETED" ? TICKET.ledgerLine : TICKET.pendingLine}</p>
      <div className="checkout__after">
        {judge && (
          <>
            <a className="button" href={ledgerHref}>
              {TICKET.seeLedger}
            </a>
            <a className="button button--quiet" href={boardHref}>
              {TICKET.backToBoard}
            </a>
          </>
        )}
        <button type="button" className="button button--quiet" onClick={onBuyMore}>
          {TICKET.buyMore}
        </button>
      </div>
    </div>
  );
}

export function TicketCheckout({
  event,
  clientId,
  judge,
  boardHref,
  ledgerHref,
}: {
  event: TicketEvent;
  clientId: string | null;
  judge: boolean;
  boardHref: string;
  ledgerHref: string;
}) {
  const [quantity, setQuantity] = useState(Math.min(2, event.maxTickets));
  const [readiness, setReadiness] = useState<Readiness>(clientId ? { kind: "loading" } : { kind: "unavailable" });
  const [status, setStatus] = useState<CheckoutStatus>({ kind: "idle" });
  const quantityRef = useRef(quantity);
  const checkoutRef = useRef<Checkout | null>(null);
  const sessionsRef = useRef<Partial<Record<WalletMethod, PaymentSession>>>({});

  // PayPal's click handler reads the quantity on the ticket at the moment of the click.
  useEffect(() => {
    quantityRef.current = quantity;
  }, [quantity]);

  useEffect(() => {
    if (!clientId) return;
    let live = true;
    const checkout = createCheckout({
      api: createPayApi(),
      eventId: event.id,
      quantity: () => quantityRef.current,
      onStatus: (next) => live && setStatus(next),
    });
    checkoutRef.current = checkout;
    loadPaypalSdk()
      .then((paypal) => setUpWallets(paypal, clientId))
      .then((wallets) => {
        if (!live) return;
        for (const method of wallets.methods) sessionsRef.current[method] = wallets.session(method, checkout.sessionOptions(method));
        setReadiness(wallets.methods.length > 0 ? { kind: "ready", methods: wallets.methods } : { kind: "unavailable" });
      })
      .catch(() => live && setReadiness({ kind: "unavailable" }));
    return () => {
      live = false;
    };
  }, [clientId, event.id]);

  const busy = BUSY.has(status.kind);
  const total = event.ticketPriceCents * quantity;
  const change = (step: number) => setQuantity((current) => clampQuantity(current + step, event.minTickets, event.maxTickets));
  const pay = (method: WalletMethod) => {
    const session = sessionsRef.current[method];
    if (!session || !checkoutRef.current || busy) return;
    checkoutRef.current.pay(method, session);
  };

  if (status.kind === "paid") {
    return (
      <PaidTicket
        result={status.result}
        method={status.method}
        quantity={status.quantity}
        judge={judge}
        boardHref={boardHref}
        ledgerHref={ledgerHref}
        onBuyMore={() => setStatus({ kind: "idle" })}
      />
    );
  }

  return (
    <div className="checkout" data-busy={busy || undefined}>
      <div className="checkout__count">
        <fieldset className="stepper" disabled={busy}>
          <legend className="stepper__label">{TICKET.admitLabel}</legend>
          <div className="stepper__controls">
            <button type="button" className="stepper__button" aria-label="One ticket fewer" disabled={quantity <= event.minTickets} onClick={() => change(-1)}>
              <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
                <rect x="3" y="8.75" width="14" height="2.5" fill="currentColor" />
              </svg>
            </button>
            <output className="stepper__value" aria-live="polite" aria-label={ticketsLabel(quantity)}>
              {quantity}
            </output>
            <button type="button" className="stepper__button" aria-label="One ticket more" disabled={quantity >= event.maxTickets} onClick={() => change(1)}>
              <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
                <rect x="3" y="8.75" width="14" height="2.5" fill="currentColor" />
                <rect x="8.75" y="3" width="2.5" height="14" fill="currentColor" />
              </svg>
            </button>
          </div>
        </fieldset>
        <p className="checkout__total">
          <span className="checkout__total-value" key={total}>
            {formatDollars(total)}
          </span>
          <span className="checkout__total-label">for {ticketsLabel(quantity)}</span>
        </p>
      </div>
      <p className="checkout__price">
        {TICKET.each}, up to {event.maxTickets} per order.
      </p>

      <div className="checkout__wallets" data-state={readiness.kind}>
        {readiness.kind === "ready" &&
          readiness.methods.map((method) =>
            method === "paypal" ? (
              <paypal-button key={method} type="pay" className="paypal-blue" onClick={() => pay("paypal")} />
            ) : (
              <venmo-button key={method} type="pay" className="venmo-blue" onClick={() => pay("venmo")} />
            ),
          )}
        {readiness.kind === "loading" && <p className="checkout__calm">{TICKET.loading}</p>}
        {readiness.kind === "unavailable" && <p className="checkout__calm">{TICKET.unavailable}</p>}
      </div>

      <p className="checkout__status" role="status" aria-live="polite" data-tone={status.kind === "failed" ? "alert" : undefined}>
        {status.kind === "opening" && TICKET.opening}
        {status.kind === "capturing" && TICKET.capturing}
        {status.kind === "cancelled" && TICKET.cancelled}
        {status.kind === "failed" && status.message}
      </p>
      <p className="checkout__note">{TICKET.paidTo}</p>
    </div>
  );
}
