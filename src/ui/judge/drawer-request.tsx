"use client";

/**
 * One payout request in the drawer: who is paid, how much and for what, the receipt, the risk card,
 * the signatures, and then either the sign action (waiting) or the live timeline (sent, stopped or
 * sent back).
 *
 * "Sign as <role>" always works for an officer: the server decides, and its refusal shows here as a
 * calm, recorded event. That is the point of the demo (spec §6): the rule lives on the server, not
 * in this page. Only a parent gets no button, because a parent's view is read-only.
 *
 * "Send back" is the other decision key 2 can make, so it is offered only to an officer who could
 * sign key 2 (the server's `eligibleSigners`). It opens a reason, which starts from the card's top
 * flag; the server records it as the request's last step and closes the request.
 */
import { useEffect, useId, useRef, useState } from "react";
import { budgetLineById } from "@/demo/riverbend-policy";
import { CLUB_TIME_ZONE } from "@/demo/riverbend";
import type { ActingRole, PayoutRequestView } from "@/ledger/contracts";
import type { RiskReadState, SignOutcome } from "./board-view-client";
import { RiskBlock } from "./drawer-risk";
import { SendBackForm } from "./drawer-send-back";
import { Signatures } from "./drawer-signatures";
import { Timeline } from "./drawer-timeline";
import type { ActionResult } from "./http-transport";
import {
  canSendBack,
  checkSendBackReason,
  defaultSendBackReason,
  followCardReason,
  formatCents,
  formatStepTime,
  isOfficer,
  needsAcknowledgement,
  roleTitle,
  signHint,
} from "./judge-model";
import { ReceiptThumb } from "./receipt-thumb";

const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: CLUB_TIME_ZONE });

export interface RequestCardProps {
  request: PayoutRequestView;
  role: ActingRole;
  now: Date;
  busy?: boolean;
  /** The latest sign attempt that the view has not recorded yet (see `unrecordedOutcome`). */
  outcome?: SignOutcome | null;
  riskRead?: RiskReadState;
  /** Brief emphasis on a request the judge just created or sent back. */
  fresh?: boolean;
  onSign?: (acknowledgedFlags: boolean) => void;
  /** Sends the request back with this reason. A refusal comes back as the card's latest outcome. */
  onSendBack?: (reason: string) => Promise<ActionResult>;
}

/** "Send back" beside the sign action, and the reason it opens. */
function useSendBack(request: PayoutRequestView, onSendBack: RequestCardProps["onSendBack"]) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(() => defaultSendBackReason(request.risk));
  const edited = useRef(false);
  // Until the officer types, the reason follows the card: its AI flags arrive after the rules' card.
  useEffect(() => {
    setReason((current) => followCardReason(edited.current, current, request.risk));
  }, [request.risk]);
  const editReason = (value: string) => {
    edited.current = true;
    setReason(value);
  };
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    const field = fieldRef.current;
    field?.focus();
    field?.setSelectionRange(field.value.length, field.value.length);
  }, [open]);

  const close = () => {
    setOpen(false);
    setError(null);
    toggleRef.current?.focus();
  };

  const submit = async () => {
    const checked = checkSendBackReason(reason);
    if (!checked.ok) return setError(checked.message);
    setError(null);
    setSubmitting(true);
    const result = await onSendBack?.(checked.reason);
    setSubmitting(false);
    // On success the card moves to "Sent back". A refusal shows inline under the actions, as the
    // card's latest outcome (recorded in the ledger once the view has it), so the reason closes.
    if (result && !result.ok) close();
  };

  return { open, setOpen, reason, setReason: editReason, error, submitting, toggleRef, fieldRef, close, submit };
}

function Refusal({ role, message, at, recorded }: { role: ActingRole; message: string; at: string; recorded: boolean }) {
  return (
    <li className="judge-refusal">
      <p className="judge-refusal__head">
        <span className="judge-refusal__tag">Refused</span>
        <span className="judge-refusal__who">
          {roleTitle(role)} · {at}
        </span>
      </p>
      <p className="judge-refusal__message">{message}</p>
      <p className="judge-refusal__note">{recorded ? "Recorded in the ledger. Nothing was sent." : "Nothing was sent."}</p>
    </li>
  );
}

function SignAction({ request, role, now, busy, outcome, onSign, onSendBack }: RequestCardProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const sendBack = useSendBack(request, onSendBack);
  const formId = useId();
  // A parent's drawer says once, at the top, that it is read-only; the cards don't repeat it.
  const hint = isOfficer(role) ? signHint(request, role) : null;
  const flagged = needsAcknowledgement(request.risk);
  const offerSendBack = canSendBack(request, role);
  const checkboxId = `ack-${request.requestId}`;
  const refusals = [...request.refusals].reverse();
  const unrecorded = outcome && !outcome.result.ok ? outcome.result : null;
  const working = busy || sendBack.submitting;

  return (
    <section className="judge-sign" aria-label={isOfficer(role) ? `Sign as ${roleTitle(role)}` : "Signing"}>
      {isOfficer(role) && flagged && (
        <label className="judge-check" htmlFor={checkboxId}>
          <input id={checkboxId} type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
          I&apos;ve read the flags
        </label>
      )}
      <div className="judge-sign__row">
        {hint && (
          <p className="judge-sign__hint" data-expect-refusal={hint.expectRefusal || undefined}>
            {hint.text}
          </p>
        )}
        {isOfficer(role) && (
          <div className="judge-sign__actions">
            {offerSendBack && (
              <button
                ref={sendBack.toggleRef}
                type="button"
                className="judge-secondary-button"
                aria-expanded={sendBack.open}
                aria-controls={sendBack.open ? formId : undefined}
                onClick={() => (sendBack.open ? sendBack.close() : sendBack.setOpen(true))}
              >
                Send back
              </button>
            )}
            <button
              type="button"
              className="board-button judge-sign__button"
              aria-disabled={working || undefined}
              onClick={() => {
                if (!working) onSign?.(flagged && acknowledged);
              }}
            >
              {busy ? "Signing…" : `Sign as ${roleTitle(role)}`}
            </button>
          </div>
        )}
      </div>
      {offerSendBack && sendBack.open && (
        <SendBackForm
          id={formId}
          roleTitle={roleTitle(role)}
          reason={sendBack.reason}
          error={sendBack.error}
          submitting={sendBack.submitting}
          onReasonChange={sendBack.setReason}
          onCancel={sendBack.close}
          onSubmit={() => void sendBack.submit()}
          fieldRef={sendBack.fieldRef}
        />
      )}
      <ul className="judge-refusals" aria-live="polite" aria-label="Refusals">
        {unrecorded && outcome && (
          <Refusal key="unrecorded" role={outcome.role} message={unrecorded.message} at={formatStepTime(new Date(outcome.at), now)} recorded={false} />
        )}
        {refusals.map((refusal) => (
          <Refusal key={`${refusal.at}-${refusal.role}-${refusal.code}`} role={refusal.role} message={refusal.message} at={formatStepTime(refusal.at, now)} recorded />
        ))}
      </ul>
    </section>
  );
}

export function RequestCard(props: RequestCardProps) {
  const { request, now, riskRead, fresh } = props;
  const line = budgetLineById(request.budgetLine);
  const headingId = `payee-${request.requestId}`;
  const cardRef = useRef<HTMLElement>(null);
  const sentBack = request.status === "sent_back";

  // A request just sent back has moved to its own section; focus follows it there, so the judge
  // (and a screen reader) lands on the card that now says who sent it back and why.
  useEffect(() => {
    if (fresh && sentBack) cardRef.current?.focus();
  }, [fresh, sentBack]);

  return (
    <article
      ref={cardRef}
      className="judge-card"
      aria-labelledby={headingId}
      data-status={request.status}
      data-fresh={fresh || undefined}
      tabIndex={sentBack ? -1 : undefined}
    >
      <div className="judge-card__head">
        <ReceiptThumb receipt={request.receipt} />
        <div className="judge-card__who">
          <h4 id={headingId} className="judge-card__payee">
            {request.payee.name}
          </h4>
          <p className="judge-card__desc">{request.description}</p>
          <p className="judge-card__meta">
            {line?.label ?? request.budgetLine} · Requested by the {roleTitle(request.requestedBy)} · {shortDate.format(new Date(request.createdAt))}
          </p>
        </div>
        <div className="judge-card__amount">
          <span className="judge-card__figure">{formatCents(request.amountCents)}</span>
          <span className="judge-source" data-source={request.sourceLabel === "demo data" ? "demo" : "live"}>
            {request.sourceLabel === "demo data" ? "Demo data" : "Live sandbox"}
          </span>
        </div>
      </div>
      <RiskBlock card={request.risk} pending={request.riskPending} read={riskRead} />
      <Signatures request={request} now={now} />
      {request.status === "waiting" ? <SignAction {...props} /> : <Timeline request={request} now={now} />}
    </article>
  );
}
