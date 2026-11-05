"use client";

/**
 * The sign-off: the Reviewer, a non-signer, signs the month's close with the server's Reviewer demo
 * key, and the signature binds the close hash.
 *
 * "Sign as <role>" always works: the server decides, and a refusal shows here inline, the way the
 * payout drawer shows one (spec §6: the rule lives on the server, not in this page). When the
 * Reviewer signs, the signature line takes the button's place and lands (motion only for a
 * signature made on this page; a sign-off read on load is simply there). "Show proof" opens what the
 * signature binds.
 */
import { useEffect, useId, useRef, useState } from "react";
import { CLOSE_MONTH_NAME, type CloseSignoffView } from "@/close/contracts";
import { formatAsOf } from "@/demo/board-figures";
import { CLUB_TIME_ZONE } from "@/demo/riverbend";
import { AlertGlyph, SlotGlyph, TickGlyph } from "@/ui/judge/glyphs";
import { formatStepTime } from "@/ui/judge/judge-model";
import { roleStore } from "@/ui/judge/role-store";
import { useActingRole } from "@/ui/judge/use-judge";
import type { SignFailure } from "./close-client";
import { roleName, shortHash, signatureLine, signButtonLabel, signHint } from "./close-model";
import { closeClient, useClose } from "./close-source";

const longTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZone: CLUB_TIME_ZONE,
  timeZoneName: "short",
});

function Proof({ signoff, id }: { signoff: CloseSignoffView; id: string }) {
  return (
    <div id={id} className="close-proof">
      <dl className="close-proof__fields">
        <dt>Month</dt>
        <dd>{CLOSE_MONTH_NAME}</dd>
        <dt>Signed</dt>
        <dd>{longTime.format(new Date(signoff.signedAt))}</dd>
        <dt>Key</dt>
        <dd>
          Reviewer&apos;s demo key {signoff.keyId}
          <span className="close-proof__aside"> · held by the server</span>
        </dd>
        <dt>Close hash</dt>
        <dd className="close-proof__hash">{signoff.signed.closeHash}</dd>
        <dt>Signature</dt>
        <dd className="close-proof__hash">{signoff.signature}</dd>
      </dl>
      <p className="close-proof__check" data-ok={signoff.verified || undefined}>
        {signoff.verified ? <TickGlyph /> : <AlertGlyph />}
        {signoff.verified ? "Verifies against the Reviewer's published public key." : "Doesn't verify against the Reviewer's published public key."}
      </p>
      {!signoff.matchesClose && <p className="close-proof__note">This signature is for an earlier version of the close: its figures have changed since.</p>}
      <p className="close-proof__note">
        The signature covers the month, the close hash, the role, the key id and the time. The close hash is SHA-256 over every figure on this page, so changing any one of
        them breaks the signature.
      </p>
    </div>
  );
}

function Signature({ signoff, fresh }: { signoff: CloseSignoffView; fresh: boolean }) {
  const [open, setOpen] = useState(false);
  const proofId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // The button the Reviewer pressed is gone: hand focus to what replaced it.
    if (fresh) ref.current?.focus({ preventScroll: true });
  }, [fresh]);
  return (
    <div ref={ref} className="close-signature" data-fresh={fresh || undefined} tabIndex={-1}>
      <div className="close-signature__line">
        <span className="close-signature__mark">
          <TickGlyph />
        </span>
        <span className="close-signature__text">{signatureLine(signoff)}</span>
        <button type="button" className="close-text-button" aria-expanded={open} aria-controls={proofId} onClick={() => setOpen(!open)}>
          {open ? "Hide proof" : "Show proof"}
        </button>
      </div>
      <p className="close-signature__meta">{formatAsOf(signoff.signedAt)} · Stored for this demo session</p>
      {open && <Proof signoff={signoff} id={proofId} />}
    </div>
  );
}

function Failure({ failure }: { failure: SignFailure }) {
  const refused = failure.code === "signer_cannot_review" || failure.code === "not_the_reviewer";
  return (
    <li className="close-refusal">
      <p className="close-refusal__head">
        <span className="close-refusal__tag">{refused ? "Refused" : "Not signed"}</span>
        <span className="close-refusal__who">
          {roleName(failure.role)} · {formatStepTime(new Date(failure.at))}
        </span>
      </p>
      <p className="close-refusal__message">{failure.message}</p>
      <p className="close-refusal__note">Nothing was signed.</p>
    </li>
  );
}

export function SignoffPanel({ closeHash, reviewerKey }: { closeHash: string; reviewerKey: { keyId: string } | null }) {
  const { signoff, signing, failures, fresh, view } = useClose();
  const role = useActingRole();
  const hint = signHint(role);
  const key = view ? view.reviewerKey : reviewerKey;
  return (
    <section className="close-panel close-signoff" aria-labelledby="close-signoff-title">
      <header className="close-panel__head close-panel__head--stack">
        <h2 id="close-signoff-title" className="close-panel__title">
          Sign-off
        </h2>
        <p className="close-signoff__rule">A non-signer reviews and signs each month&apos;s close. The Reviewer holds no payout key.</p>
      </header>
      <div className="close-signoff__body" aria-live="polite">
        {signoff ? (
          <Signature signoff={signoff} fresh={fresh} />
        ) : (
          <>
            <div className="close-slot">
              <span className="close-slot__mark">
                <SlotGlyph />
              </span>
              <div className="close-slot__text">
                <p className="close-slot__title">Reviewer: not signed yet</p>
                <p className="close-slot__meta num">
                  {key ? `Signs the close hash ${shortHash(closeHash)} with demo key ${key.keyId}.` : "The Reviewer's demo key isn't published on this server yet."}
                </p>
              </div>
            </div>
            <div className="close-sign">
              <button
                type="button"
                className="board-button close-sign__button"
                aria-disabled={signing || undefined}
                onClick={() => {
                  if (!signing) void closeClient()?.sign(role);
                }}
              >
                {signButtonLabel(role, signing)}
              </button>
              {hint.expectRefusal && (
                <button type="button" className="close-text-button" onClick={() => roleStore.set("reviewer")}>
                  Switch to Reviewer
                </button>
              )}
            </div>
            <p className="close-sign__hint" data-expect-refusal={hint.expectRefusal || undefined}>
              {hint.text}
            </p>
          </>
        )}
        {!signoff && failures.length > 0 && (
          <ul className="close-refusals" aria-label="Sign attempts">
            {failures.map((failure) => (
              <Failure key={failure.id} failure={failure} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
