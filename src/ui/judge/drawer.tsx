"use client";

/**
 * The payout drawer, opened by "Review N payouts": a native modal <dialog> over the board's right
 * side (a full-width sheet below 900px). The dialog gives the focus trap, Esc to close and the top
 * layer above Studio's own popups; the rest of the page is inert while it is open, so the role
 * switch is repeated in its header. Closing returns focus to the button that opened it.
 *
 * Waiting requests come first, then the ones that left the queue. Officers can request a payout
 * from the header; a parent's drawer is read-only. The board behind updates as the client polls.
 */
import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import type { ActingRole, BoardView, PayoutRequestView } from "@/ledger/contracts";
import { unrecordedOutcome, type BoardViewSnapshot } from "./board-view-client";
import { boardViewClient } from "./board-view-source";
import { RequestCard } from "./drawer-request";
import { RequestForm } from "./drawer-request-form";
import { drawerStore } from "./drawer-store";
import { CloseGlyph, PlusGlyph } from "./glyphs";
import { formatCents, isOfficer, limitsLine, requestSections } from "./judge-model";
import { RoleSwitch } from "./role-switch";
import { useActingRole, useBoardView, useDrawerOpen } from "./use-judge";
import "./drawer.css";
import "./drawer-card.css";
import "./drawer-details.css";

/** How long a request the judge just created keeps its emphasis. */
const FRESH_MS = 2_400;

interface SectionsProps {
  view: BoardView;
  snapshot: BoardViewSnapshot;
  role: ActingRole;
  open: boolean;
  /** The request the judge just created or sent back, drawn with a moment's emphasis. */
  freshId: string | null;
  /** A send-back landed: the card moves to "Sent back", and focus follows it. */
  onSentBack?: (requestId: string) => void;
}

function Section({ id, title, requests, card }: { id: string; title: string; requests: PayoutRequestView[]; card: (r: PayoutRequestView) => ReactNode }) {
  if (requests.length === 0) return null;
  return (
    <section className="judge-section" aria-labelledby={id}>
      <h3 id={id} className="judge-section__title">
        {title} <span className="judge-section__count">{requests.length}</span>
      </h3>
      <div className="judge-section__cards">{requests.map((r) => card(r))}</div>
    </section>
  );
}

/** Waiting for a second key, then Signed, then Sent back: every request in the session. */
export function RequestSections({ view, snapshot, role, open, freshId, onSentBack }: SectionsProps) {
  const client = boardViewClient();
  const now = new Date();
  const { waiting, signed, sentBack } = requestSections(view);

  // Ask for the AI's receipt read on any request still waiting for it (once per request; spec §4).
  const pendingIds = view.requests.filter((r) => r.riskPending).map((r) => r.requestId).join(" ");
  useEffect(() => {
    if (!open || !client || pendingIds === "") return;
    for (const id of pendingIds.split(" ")) client.assessRiskOnce(id);
  }, [open, client, pendingIds]);

  const card = (request: BoardView["requests"][number]) => (
    <RequestCard
      key={request.requestId}
      request={request}
      role={role}
      now={now}
      busy={snapshot.busy[request.requestId] === true}
      outcome={unrecordedOutcome(request, snapshot.outcomes[request.requestId])}
      riskRead={snapshot.riskReads[request.requestId]}
      fresh={request.requestId === freshId}
      onSign={(acknowledgedFlags) => void client?.sign(request.requestId, { actingAs: role, acknowledgedFlags })}
      onSendBack={async (reason) => {
        if (!client) return { ok: false, status: 0, code: "network", message: "The page isn't ready yet. Try again in a moment." };
        const result = await client.sendBack(request.requestId, { actingAs: role, reason });
        if (result.ok) onSentBack?.(request.requestId);
        return result;
      }}
    />
  );

  return (
    <>
      <section className="judge-section" aria-labelledby="judge-waiting-title">
        <h3 id="judge-waiting-title" className="judge-section__title">
          Waiting for a second key <span className="judge-section__count">{waiting.length}</span>
        </h3>
        {waiting.length > 0 ? (
          <div className="judge-section__cards">{waiting.map((r) => card(r))}</div>
        ) : (
          <p className="judge-empty">Nothing is waiting for a second key.</p>
        )}
      </section>
      <Section id="judge-signed-title" title="Signed" requests={signed} card={card} />
      <Section id="judge-sent-back-title" title="Sent back" requests={sentBack} card={card} />
    </>
  );
}

export function PayoutDrawer() {
  const open = useDrawerOpen();
  const role = useActingRole();
  const snapshot = useBoardView();
  const { view, error } = snapshot;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const officer = isOfficer(role);

  // The store drives the dialog; the dialog's own close (Esc, the button) drives the store back.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      titleRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    if (!fresh) return;
    const timer = setTimeout(() => setFresh(null), FRESH_MS);
    return () => clearTimeout(timer);
  }, [fresh]);

  const onClose = (event: SyntheticEvent<HTMLDialogElement>) => {
    // A receipt's own dialog sits inside this one; its close is not the drawer's.
    if (event.target !== event.currentTarget) return;
    const opener = drawerStore.opener();
    drawerStore.close();
    setFormOpen(false);
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  };

  const client = boardViewClient();
  const showForm = officer && formOpen && view !== null;

  return (
    <dialog
      ref={dialogRef}
      className="judge-drawer"
      aria-labelledby="judge-drawer-title"
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog itself; its panel fills it otherwise.
        if (event.target === event.currentTarget) dialogRef.current?.close();
      }}
    >
      <div className="judge-drawer__panel">
        <header className="judge-drawer__head">
          <div className="judge-drawer__title-row">
            <h2 id="judge-drawer-title" ref={titleRef} className="judge-drawer__title" tabIndex={-1}>
              Payouts
            </h2>
            {officer && view && (
              <button
                type="button"
                className="judge-secondary-button"
                aria-expanded={showForm}
                onClick={() => {
                  setFormOpen(!formOpen);
                  bodyRef.current?.scrollTo({ top: 0 });
                }}
              >
                <PlusGlyph />
                Request a payout
              </button>
            )}
            <button type="button" className="judge-icon-button" aria-label="Close payouts" onClick={() => dialogRef.current?.close()}>
              <CloseGlyph />
            </button>
          </div>
          <RoleSwitch name="judge-role-drawer" />
          {view && (
            <p className="judge-drawer__limits">
              {limitsLine(view.limits)} · up to {formatCents(view.limits.payoutCapCents)} each
            </p>
          )}
          <p className="judge-drawer__limits">Signatures use the server&apos;s demo keys. A real club would use passkeys.</p>
        </header>

        <div ref={bodyRef} className="judge-drawer__body">
          {error && (
            <div className="judge-error" role="status">
              <p>{view ? `Couldn't refresh the payouts just now. ${error}` : `Couldn't load the payouts. ${error}`}</p>
              <button type="button" className="judge-text-button" onClick={() => void client?.refresh()}>
                Try again
              </button>
            </div>
          )}
          {!view && !error && (
            <div className="judge-loading" role="status">
              <span className="board-visually-hidden">Loading the payouts</span>
              <span className="judge-loading__bar" />
              <span className="judge-loading__card" />
              <span className="judge-loading__card" />
            </div>
          )}
          {view && !officer && (
            <p className="judge-readonly">
              {role === "reviewer"
                ? "You're viewing as the Reviewer: you can see every payout. The Reviewer signs the monthly close, never a payout."
                : "You're viewing as a parent: you can see every payout, but only officers request and sign them."}
            </p>
          )}
          {showForm && view && officer && (
            <RequestForm
              role={role}
              data={view.data}
              limits={view.limits}
              onSubmit={(body) => client!.createRequest(body)}
              onDone={(requestId) => {
                setFormOpen(false);
                if (requestId) setFresh(requestId);
              }}
            />
          )}
          {view && <RequestSections view={view} snapshot={snapshot} role={role} open={open} freshId={fresh} onSentBack={setFresh} />}
        </div>
      </div>
    </dialog>
  );
}
