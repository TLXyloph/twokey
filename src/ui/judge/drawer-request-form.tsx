"use client";

/**
 * "Request a payout", for officers: a payee from the fixed list, an amount up to the $50.00 cap, a
 * description of 80 characters at most, a budget line (with what is left on it) and one of the four
 * sample receipts. Requesting is the first key: the server signs the request with the requester's
 * demo key. The form checks what it can for the judge's sake; the server checks again and its
 * refusals show here.
 */
import { useId, useState, type FormEvent } from "react";
import type { ClubDemoData } from "@/demo/riverbend";
import { BUDGET_LINES } from "@/demo/riverbend-policy";
import { PAYEES } from "@/disbursements/payees";
import type { BoardView, BudgetLineId, CreatePayoutRequestBody, OfficerRole, PayeeId, ReceiptId } from "@/ledger/contracts";
import type { ActionResult } from "./http-transport";
import { budgetLeftCents, formatCents, limitsLine, parseAmountToCents, roleTitle } from "./judge-model";
import { ReceiptImage } from "./receipt-thumb";
import { SAMPLE_RECEIPTS } from "./sample-receipts";
import "./drawer-form.css";

export const DESCRIPTION_MAX = 80;

export interface RequestFormProps {
  role: OfficerRole;
  data: ClubDemoData;
  limits: BoardView["limits"];
  onSubmit: (body: CreatePayoutRequestBody) => Promise<ActionResult>;
  onDone: (requestId: string | null) => void;
}

export function RequestForm({ role, data, limits, onSubmit, onDone }: RequestFormProps) {
  const id = useId();
  const [payeeId, setPayeeId] = useState<PayeeId>("team-supply");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [budgetLine, setBudgetLine] = useState<BudgetLineId>("equipment");
  const [receiptId, setReceiptId] = useState<ReceiptId>("cones-team-supply");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    const parsed = parseAmountToCents(amount, limits.payoutCapCents);
    if (!parsed.ok) return setError(parsed.message);
    if (description.trim() === "") return setError("Describe what the payout is for.");
    setError(null);
    setSubmitting(true);
    const result = await onSubmit({ actingAs: role, payeeId, amountCents: parsed.cents, description: description.trim(), budgetLine, receiptId });
    setSubmitting(false);
    if (result.ok) onDone(result.request.requestId);
    else setError(result.message);
  };

  return (
    <form className="judge-form" aria-labelledby={`${id}-title`} onSubmit={submit} noValidate>
      <div className="judge-form__head">
        <h3 id={`${id}-title`} className="judge-form__title">
          Request a payout
        </h3>
        <p className="judge-form__lede">Your request is the first key. A second officer signs to send it.</p>
      </div>

      <div className="judge-form__pair">
        <div className="judge-field">
          <label className="judge-field__label" htmlFor={`${id}-payee`}>
            Payee
          </label>
          <select id={`${id}-payee`} className="judge-input" value={payeeId} onChange={(e) => setPayeeId(e.target.value as PayeeId)}>
            {PAYEES.map((payee) => (
              <option key={payee.id} value={payee.id}>
                {payee.name}
              </option>
            ))}
          </select>
        </div>
        <div className="judge-field">
          <label className="judge-field__label" htmlFor={`${id}-amount`}>
            Amount
          </label>
          <div className="judge-money">
            <span className="judge-money__sign" aria-hidden="true">
              $
            </span>
            <input
              id={`${id}-amount`}
              className="judge-input judge-input--money"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-describedby={`${id}-amount-limit`}
            />
          </div>
          <p id={`${id}-amount-limit`} className="judge-field__help">
            Up to {formatCents(limits.payoutCapCents)}
          </p>
        </div>
      </div>

      <div className="judge-field">
        <label className="judge-field__label" htmlFor={`${id}-description`}>
          Description
        </label>
        <input
          id={`${id}-description`}
          className="judge-input"
          maxLength={DESCRIPTION_MAX}
          autoComplete="off"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-describedby={`${id}-description-count`}
        />
        <p id={`${id}-description-count`} className="judge-field__help">
          {description.length} of {DESCRIPTION_MAX} characters
        </p>
      </div>

      <div className="judge-field">
        <label className="judge-field__label" htmlFor={`${id}-budget`}>
          Budget line
        </label>
        <select id={`${id}-budget`} className="judge-input" value={budgetLine} onChange={(e) => setBudgetLine(e.target.value as BudgetLineId)}>
          {BUDGET_LINES.map((line) => (
            <option key={line.id} value={line.id}>
              {line.label} · {formatCents(budgetLeftCents(data, line))} left
            </option>
          ))}
        </select>
      </div>

      <fieldset className="judge-field judge-receipts">
        <legend className="judge-field__label">Receipt</legend>
        <div className="judge-receipts__grid">
          {SAMPLE_RECEIPTS.map((receipt) => (
            <label key={receipt.id} className="judge-receipt-option">
              <input
                className="judge-receipt-option__input"
                type="radio"
                name={`${id}-receipt`}
                value={receipt.id}
                checked={receiptId === receipt.id}
                onChange={() => setReceiptId(receipt.id)}
              />
              <span className="judge-receipt-option__image">
                <ReceiptImage src={receipt.imageUrl} alt="" />
              </span>
              <span className="judge-receipt-option__label">{receipt.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <p className="judge-form__error" role="alert">
        {error}
      </p>

      <div className="judge-form__foot">
        <p className="judge-form__limits">{limitsLine(limits)}</p>
        <div className="judge-form__actions">
          <button type="button" className="judge-secondary-button" onClick={() => onDone(null)}>
            Cancel
          </button>
          <button type="submit" className="board-button" aria-disabled={submitting || undefined}>
            {submitting ? "Requesting…" : `Request as ${roleTitle(role)}`}
          </button>
        </div>
      </div>
    </form>
  );
}
