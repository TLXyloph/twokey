"use client";

/**
 * "Who holds the keys": public, the same for every role. Each person, the PayPal access they hold
 * (it follows the setup steps: demo data), their TwoKey demo key, when that key last signed in
 * this session (from the live board view), then how money can leave, where parents pay, where
 * alerts go, and the Watchtower's live line.
 *
 * As a step is marked, what changed swaps in place: the new words rise into place over a pale
 * tint that fades, so the eye finds the one cell that moved. Nothing else moves; with reduced
 * motion the words only fade. The first paint never animates (`settled`).
 */
import Link from "next/link";
import type { BoardView } from "@/ledger/contracts";
import { watchAlerts } from "@/ui/watchtower/watch-model";
import { WatchStatusLine } from "@/ui/watchtower/watch-status";
import type { WatchtowerView } from "@/watchtower/contracts";
import { KEYS_COPY } from "./keys-content";
import { keysPanel, type AccessLine, type HolderRow, type LastSigned } from "./keys-model";
import "./keys-panel.css";

export const KEYS_PANEL_ID = "who-holds-the-keys";

/** Words that remount when they change, so the new ones enter (keys-panel.css: .keys-swap). */
function Swap({ text, flash = true }: { text: string; flash?: boolean }) {
  return (
    <span className="keys-swap" data-flash={flash ? "" : undefined}>
      {text}
    </span>
  );
}

function Access({ line }: { line: AccessLine }) {
  return (
    <span className="keys-access" data-tone={line.tone}>
      <span className="keys-access__mark" aria-hidden="true" />
      <Swap key={line.text} text={line.text} />
    </span>
  );
}

function Signed({ last }: { last: LastSigned }) {
  if (last.kind === "loading") {
    return (
      <span className="keys-loading">
        <span className="board-visually-hidden">Loading this session's signatures</span>
      </span>
    );
  }
  if (last.kind === "not-a-signer") {
    return (
      <span className="keys-dash">
        <span aria-hidden="true">—</span>
        <span className="board-visually-hidden">Holds no payout key</span>
      </span>
    );
  }
  if (last.kind === "none") return <Swap key="none" text="Hasn't signed in this session" flash={false} />;
  return (
    <span key={`${last.time}|${last.detail}`} className="keys-swap keys-signed">
      <span className="keys-signed__time">{last.time}</span>
      <span className="keys-signed__detail">{last.detail}</span>
    </span>
  );
}

function HolderRowView({ row }: { row: HolderRow }) {
  return (
    <tr role="row" className="keys-row">
      <th role="rowheader" scope="row" className="keys-row__who">
        <span className="keys-row__person">{row.person}</span>
        <span className="keys-row__role">{row.title}</span>
      </th>
      <td role="cell" data-label="PayPal access">
        <span className="keys-row__lines">
          {row.access.map((line) => (
            <Access key={line.text} line={line} />
          ))}
        </span>
      </td>
      <td role="cell" data-label="Demo key">
        <span className="keys-cell">
          {row.keyId ? <span className="keys-key">{row.keyId}</span> : null}
          <span className="keys-key__note">{row.keyNote}</span>
        </span>
      </td>
      <td role="cell" data-label="Last signed">
        <span className="keys-cell">
          <Signed last={row.lastSigned} />
        </span>
      </td>
    </tr>
  );
}

function WatchFacts({ watch }: { watch: WatchtowerView | null | "loading" }) {
  const open = watch && watch !== "loading" ? watchAlerts(watch).open.length : 0;
  return (
    <>
      <WatchStatusLine watch={watch} />
      {open > 0 ? (
        <p className="keys-facts__more">
          {open === 1 ? "1 open alert" : `${open} open alerts`}, shown to every role on the{" "}
          <Link className="keys-link" href="/demo">
            board
          </Link>
          .
        </p>
      ) : null}
    </>
  );
}

export interface WhoHoldsTheKeysProps {
  done: number;
  view: BoardView | null;
  watch: WatchtowerView | null | "loading";
  settled: boolean;
  now?: Date;
}

export function WhoHoldsTheKeys({ done, view, watch, settled, now = new Date() }: WhoHoldsTheKeysProps) {
  const model = keysPanel(done, view, now);
  return (
    <section id={KEYS_PANEL_ID} className="keys-card keys-panel" aria-labelledby="keys-panel-title" data-stage={model.stage} data-settled={settled ? "" : undefined}>
      <div className="keys-card__head">
        <h2 id="keys-panel-title" className="keys-card__title">
          {KEYS_COPY.panelTitle}
        </h2>
        <span className="keys-stage" data-stage={model.stage}>
          <Swap key={model.stageLabel} text={model.stageLabel} flash={false} />
        </span>
      </div>
      <div className="keys-panel__lead" aria-live="polite">
        <p className="keys-panel__headline">
          <Swap key={model.headline} text={model.headline} flash={false} />
        </p>
        <p className="keys-panel__subline">
          <Swap key={model.subline} text={model.subline} flash={false} />
        </p>
      </div>

      <table role="table" className="keys-table">
        <caption className="board-visually-hidden">Who holds which access to the club's money</caption>
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader" scope="col">
              Person
            </th>
            <th role="columnheader" scope="col">
              PayPal access
            </th>
            <th role="columnheader" scope="col">
              TwoKey demo key
            </th>
            <th role="columnheader" scope="col">
              Last signed in this session
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {model.holders.map((row) => (
            <HolderRowView key={row.role} row={row} />
          ))}
        </tbody>
      </table>

      <dl className="keys-facts">
        {model.facts.map((fact) => (
          <div key={fact.id} className="keys-facts__row">
            <dt>{fact.label}</dt>
            <dd>
              <Access key={fact.value.text} line={fact.value} />
            </dd>
          </div>
        ))}
        <div className="keys-facts__row">
          <dt>Watchtower</dt>
          <dd>
            <WatchFacts watch={watch} />
          </dd>
        </div>
      </dl>
      <p className="keys-card__note">{KEYS_COPY.panelNote}</p>
    </section>
  );
}
