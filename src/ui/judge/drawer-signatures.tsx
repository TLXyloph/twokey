"use client";

/**
 * A request's signatures, one line each ("Signed by the Treasurer · demo key 7f3a1c2e"), and the
 * slot the second key still has to fill. "Show proof" opens what the signature binds: the payee,
 * the amount, the request hash, the ledger head it chained to and the signature itself, with a link
 * to the server's chain check. Hashes are the one place the drawer uses a monospace.
 */
import { useId, useState } from "react";
import { API, type PayoutRequestView, type SignatureView } from "@/ledger/contracts";
import { SlotGlyph, TickGlyph } from "./glyphs";
import { formatCents, formatStepTime, signatureLine, theRoles } from "./judge-model";

function SignatureRow({ signature, payeeName, now }: { signature: SignatureView; payeeName: string; now: Date }) {
  const [open, setOpen] = useState(false);
  const proofId = useId();
  const { signed } = signature;
  return (
    <li className="judge-sig">
      <div className="judge-sig__line">
        <span className="judge-sig__mark" data-signed>
          <TickGlyph />
        </span>
        <span className="judge-sig__text">{signatureLine(signature)}</span>
        <button type="button" className="judge-text-button" aria-expanded={open} aria-controls={proofId} onClick={() => setOpen(!open)}>
          {open ? "Hide proof" : "Show proof"}
        </button>
      </div>
      {open && (
        <div id={proofId} className="judge-proof">
          <dl className="judge-proof__fields">
            <dt>Signed</dt>
            <dd>{formatStepTime(signature.at, now)}</dd>
            <dt>Payee</dt>
            <dd>
              {payeeName}
              <span className="judge-proof__aside"> · {signed.payeeEmail}</span>
            </dd>
            <dt>Amount</dt>
            <dd>
              {formatCents(signed.amountCents)} {signed.currency}
            </dd>
            <dt>Request hash</dt>
            <dd className="judge-proof__hash">{signed.requestHash}</dd>
            <dt>Previous ledger hash</dt>
            <dd className="judge-proof__hash">{signed.prevHash}</dd>
            <dt>Signature</dt>
            <dd className="judge-proof__hash">{signature.signature}</dd>
          </dl>
          <a className="judge-text-link" href={API.ledgerVerify} target="_blank" rel="noopener">
            Check the ledger&apos;s chain
          </a>
        </div>
      )}
    </li>
  );
}

export function Signatures({ request, now }: { request: PayoutRequestView; now: Date }) {
  const missing = request.status === "waiting" && request.signatures.length < 2;
  return (
    <section className="judge-sigs" aria-label="Signatures">
      <ul className="judge-sigs__list">
        {request.signatures.map((signature) => (
          <SignatureRow key={signature.eventHash} signature={signature} payeeName={request.payee.name} now={now} />
        ))}
        {missing && (
          <li className="judge-sig">
            <div className="judge-sig__line">
              <span className="judge-sig__mark">
                <SlotGlyph />
              </span>
              <span className="judge-sig__text judge-sig__text--missing">
                {request.eligibleSigners.length > 0
                  ? `Second key: ${theRoles(request.eligibleSigners)}`
                  : "Second key: no officer can add it"}
              </span>
            </div>
          </li>
        )}
      </ul>
    </section>
  );
}
