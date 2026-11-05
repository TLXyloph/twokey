"use client";

/**
 * One payout request in the drawer: who is paid, how much and for what, the receipt, the risk card,
 * the signatures, and then either the sign action (waiting) or the live timeline (sent or stopped).
 *
 * "Sign as <role>" always works for an officer: the server decides, and its refusal shows here as a
 * calm, recorded event. That is the point of the demo (spec §6): the rule lives on the server, not
 * in this page. Only a parent gets no button, because a parent's view is read-only.
 */
import { useState } from "react";
import { budgetLineById } from "@/demo/riverbend-policy";
import { CLUB_TIME_ZONE } from "@/demo/riverbend";
import type { ActingRole, PayoutRequestView } from "@/ledger/contracts";
import type { RiskReadState, SignOutcome } from "./board-view-client";
import { RiskBlock } from "./drawer-risk";
import { Signatures } from "./drawer-signatures";
import { Timeline } from "./drawer-timeline";
import { formatCents, formatStepTime, isOfficer, needsAcknowledgement, roleTitle, signHint } from "./judge-model";
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
  /** Brief emphasis on a request the judge just created. */
  fresh?: boolean;
  onSign?: (acknowledgedFlags: boolean) => void;
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

function SignAction({ request, role, now, busy, outcome, onSign }: RequestCardProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  // A parent's drawer says once, at the top, that it is read-only; the cards don't repeat it.
  const hint = isOfficer(role) ? signHint(request, role) : null;
  const flagged = needsAcknowledgement(request.risk);
  const checkboxId = `ack-${request.requestId}`;
  const refusals = [...request.refusals].reverse();
  const unrecorded = outcome && !outcome.result.ok ? outcome.result : null;

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
          <button
            type="button"
            className="board-button judge-sign__button"
            aria-disabled={busy || undefined}
            onClick={() => {
              if (!busy) onSign?.(flagged && acknowledged);
            }}
          >
            {busy ? "Signing…" : `Sign as ${roleTitle(role)}`}
          </button>
        )}
      </div>
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
  return (
    <article className="judge-card" aria-labelledby={headingId} data-status={request.status} data-fresh={fresh || undefined}>
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
