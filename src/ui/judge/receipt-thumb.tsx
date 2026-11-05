"use client";

/**
 * A receipt's thumbnail, which opens the receipt larger in its own small modal dialog (on top of
 * the drawer; Esc closes it first). If the image can't load, both show a plain stand-in with the
 * receipt's label rather than a broken image.
 */
import { useEffect, useRef, useState } from "react";
import type { PayoutRequestView } from "@/ledger/contracts";
import { CloseGlyph } from "./glyphs";
import "./receipt.css";

type Receipt = PayoutRequestView["receipt"];

/**
 * A receipt image, or, when it can't load, the lines of a till slip in its place. `alt` is empty
 * where the receipt's label is already said beside it.
 */
export function ReceiptImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    setFailed(false);
    // An image that failed before React attached its handler reports it here.
    const img = ref.current;
    if (img?.complete && img.naturalWidth === 0) setFailed(true);
  }, [src]);

  if (failed) {
    return (
      <span className="judge-receipt__stand-in" {...(alt ? { role: "img", "aria-label": `${alt} (image unavailable)` } : { "aria-hidden": true })}>
        <span />
        <span />
        <span />
      </span>
    );
  }
  return <img ref={ref} className={className} src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

export function ReceiptThumb({ receipt }: { receipt: Receipt }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const close = () => dialogRef.current?.close();

  return (
    <>
      <button type="button" className="judge-receipt" aria-label={`Open the receipt: ${receipt.label}`} onClick={() => dialogRef.current?.showModal()}>
        <ReceiptImage src={receipt.imageUrl} alt="" />
      </button>
      <dialog
        ref={dialogRef}
        className="judge-receipt-view"
        aria-label={receipt.label}
        onClick={(event) => {
          // A click on the backdrop lands on the dialog itself; the panel fills it otherwise.
          if (event.target === event.currentTarget) close();
        }}
      >
        <div className="judge-receipt-view__panel">
          <div className="judge-receipt-view__head">
            <p className="judge-receipt-view__title">{receipt.label}</p>
            <button type="button" className="judge-icon-button" aria-label="Close the receipt" onClick={close}>
              <CloseGlyph />
            </button>
          </div>
          <span className="judge-receipt-view__frame">
            <ReceiptImage className="judge-receipt-view__image" src={receipt.imageUrl} alt={receipt.label} />
          </span>
        </div>
      </dialog>
    </>
  );
}
