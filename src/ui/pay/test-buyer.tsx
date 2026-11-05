"use client";

/**
 * The ticket's stub: the PayPal sandbox test-buyer login, so a judge can pay with test money.
 * Labelled as a sandbox login, not a real account. Shown only when both Worker vars are set.
 */
import { useEffect, useRef, useState } from "react";
import { TEST_BUYER } from "./content";

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button type="button" className="stub__copy" onClick={copy} aria-label={copied ? `${label} copied` : `Copy the ${label.toLowerCase()}`}>
      <span className="stub__copy-word" data-on={!copied || undefined}>
        Copy
      </span>
      <span className="stub__copy-word" data-on={copied || undefined} aria-hidden="true">
        Copied
      </span>
    </button>
  );
}

export function TestBuyer({ email, password }: { email: string; password: string }) {
  return (
    <aside className="stub" aria-labelledby="test-buyer-title">
      <h2 className="stub__title" id="test-buyer-title">
        {TEST_BUYER.heading}
      </h2>
      <p className="stub__note">{TEST_BUYER.note}</p>
      <dl className="stub__login">
        <div className="stub__row">
          <dt>{TEST_BUYER.emailLabel}</dt>
          <dd>
            <span className="stub__value">{email}</span>
            <CopyButton value={email} label={TEST_BUYER.emailLabel} />
          </dd>
        </div>
        <div className="stub__row">
          <dt>{TEST_BUYER.passwordLabel}</dt>
          <dd>
            <span className="stub__value">{password}</span>
            <CopyButton value={password} label={TEST_BUYER.passwordLabel} />
          </dd>
        </div>
      </dl>
    </aside>
  );
}
