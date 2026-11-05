"use client";

/**
 * "Send back", for an officer who could add key 2: one required reason (3–200 characters, starting
 * from the card's top flag), its count beside the label and tied to the field, and the two actions.
 * Presentational: the card's sign action (./drawer-request.tsx) owns the state and the call.
 *
 * The server records the decision as the request's last step ("Sent back by the President: …") and
 * closes it; nothing is signed and nothing is sent.
 */
import type { FormEvent, Ref } from "react";
import { reasonCount, SEND_BACK_REASON_MAX, SEND_BACK_REASON_MIN } from "./judge-model";

export interface SendBackFormProps {
  /** The base of the form's element ids (`${id}-reason`, `${id}-count`, `${id}-error`). */
  id: string;
  roleTitle: string;
  reason: string;
  error: string | null;
  submitting: boolean;
  onReasonChange: (reason: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  fieldRef?: Ref<HTMLTextAreaElement>;
}

export function SendBackForm({ id, roleTitle, reason, error, submitting, onReasonChange, onCancel, onSubmit, fieldRef }: SendBackFormProps) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!submitting) onSubmit();
  };
  const describedBy = error ? `${id}-count ${id}-error` : `${id}-count`;

  return (
    <form id={id} className="judge-sendback" aria-label={`Send back as the ${roleTitle}`} onSubmit={submit} noValidate>
      <div className="judge-sendback__field">
        <div className="judge-sendback__label-row">
          <label className="judge-field__label" htmlFor={`${id}-reason`}>
            Why send it back?
          </label>
          <p id={`${id}-count`} className="judge-field__help">
            {reasonCount(reason)}
          </p>
        </div>
        <textarea
          ref={fieldRef}
          id={`${id}-reason`}
          className="judge-input judge-sendback__reason"
          rows={3}
          required
          minLength={SEND_BACK_REASON_MIN}
          maxLength={SEND_BACK_REASON_MAX}
          value={reason}
          onChange={(event) => onReasonChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              // Close the reason, not the whole drawer.
              event.preventDefault();
              event.stopPropagation();
              onCancel();
            }
          }}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
        />
        <p className="judge-sendback__lede">The request closes with your reason on its timeline. Nothing is sent.</p>
      </div>
      {error && (
        <p id={`${id}-error`} className="judge-form__error" role="alert">
          {error}
        </p>
      )}
      <div className="judge-sendback__actions">
        <button type="button" className="judge-secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="board-button" aria-disabled={submitting || undefined}>
          {submitting ? "Sending back…" : `Send back as ${roleTitle}`}
        </button>
      </div>
    </form>
  );
}
