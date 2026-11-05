"use client";

/**
 * The Watchtower's alerts, under the board's finding line, for every role (a parent included):
 *
 *   1. a replayed outside send (judge mode), labelled as a replay of a real sandbox event, dismissible;
 *   2. a status that is an alert on its own: lost access, or silence;
 *   3. the open findings: the newest in full, the rest behind "N more";
 *   4. "Explained (N)": findings a person has explained, collapsed, never hidden.
 *
 * One sentence per finding, built in ./watch-model.ts. Rows that appear (a replay arriving, a list
 * opening) fade up a few pixels; the height itself snaps, so Studio below resizes once, not per frame.
 */
import { useId, useState } from "react";
import { ChevronGlyph, CloseGlyph, ReplayGlyph } from "@/ui/judge/glyphs";
import type { WatchFinding, WatchtowerView } from "@/watchtower/contracts";
import type { ReplayedAlert } from "./replay-store";
import { REPLAY_BUTTON_ID } from "./replay-button";
import { explainedLabel, findingText, keepTimesTogether, moreLabel, watchAlerts } from "./watch-model";
import { replayStore, useReplay, useWatchtower } from "./use-watchtower";
import "./watchtower.css";

/** The claim on its line, the evidence under it in the quieter size: one sentence, read in order. */
export function FindingSentence({ finding }: { finding: WatchFinding }) {
  const text = findingText(finding);
  return (
    <div className="watch-finding">
      <p className="watch-sentence">
        <strong className="watch-sentence__amount">{text.amount}</strong> <span className="watch-sentence__verb">{text.verb}</span>:{" "}
        {keepTimesTogether(text.route)}
      </p>
      {text.facts ? <p className="watch-facts">{keepTimesTogether(text.facts)}</p> : null}
    </div>
  );
}

function Disclosure({ open, controls, onToggle, children }: { open: boolean; controls: string; onToggle: () => void; children: string }) {
  return (
    <button type="button" className="watch-toggle" aria-expanded={open} aria-controls={controls} onClick={onToggle}>
      {children}
      <ChevronGlyph />
    </button>
  );
}

function ReplayAlertBand({ alert, onDismiss }: { alert: ReplayedAlert; onDismiss: (id: string) => void }) {
  return (
    <section className="watch-alert" data-replay="" aria-label="Replayed alert">
      <div className="watch-alert__label-row">
        <p className="watch-alert__label">
          <ReplayGlyph />
          {alert.label}
        </p>
        <button type="button" className="watch-dismiss" aria-label="Dismiss the replay" onClick={() => onDismiss(alert.id)}>
          <CloseGlyph />
        </button>
      </div>
      <div className="watch-alert__row">
        <span className="watch-mark" aria-hidden="true" />
        <FindingSentence finding={alert.finding} />
      </div>
    </section>
  );
}

function ExplainedList({ id, explained }: { id: string; explained: WatchFinding[] }) {
  return (
    <section id={id} className="watch-explained" aria-label="Explained findings">
      <ul className="watch-explained__list">
        {explained.map((finding) => (
          <li key={finding.transactionId} className="watch-explained__item">
            <span className="watch-mark" aria-hidden="true" />
            <div className="watch-explained__body">
              <FindingSentence finding={finding} />
              <p className="watch-explained__note">
                <span className="watch-explained__tag">Explained:</span> {finding.explanation}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export interface WatchAlertsViewProps {
  watch: WatchtowerView | null | "loading";
  replay?: ReplayedAlert | null;
  onDismissReplay?: (id: string) => void;
  now?: Date;
  /** Initial disclosure state (tests and screenshots); the judge's clicks own it after that. */
  initiallyOpen?: { more?: boolean; explained?: boolean };
}

export function WatchAlertsView({ watch, replay = null, onDismissReplay = () => {}, now = new Date(), initiallyOpen = {} }: WatchAlertsViewProps) {
  const [moreOpen, setMoreOpen] = useState(initiallyOpen.more ?? false);
  const [explainedOpen, setExplainedOpen] = useState(initiallyOpen.explained ?? false);
  const listId = useId();
  const explainedId = useId();
  const { statusAlert, open, explained } = watchAlerts(watch === "loading" ? null : watch, now);
  const [newest, ...rest] = open;

  const explainedToggle =
    explained.length > 0 ? (
      <Disclosure open={explainedOpen} controls={explainedId} onToggle={() => setExplainedOpen((v) => !v)}>
        {explainedLabel(explained.length)}
      </Disclosure>
    ) : null;

  const empty = !replay && !statusAlert && !newest && !explainedToggle;

  return (
    <div className="watch-alerts" data-empty={empty ? "" : undefined}>
      {/* Polite: the replay is announced when it arrives, never on load. */}
      <div className="watch-alerts__live" aria-live="polite">
        {replay ? <ReplayAlertBand key={replay.id} alert={replay} onDismiss={onDismissReplay} /> : null}
      </div>

      {statusAlert ? (
        <section className="watch-alert" data-kind="status" aria-label="Watchtower status">
          <div className="watch-alert__row">
            <span className="watch-mark" aria-hidden="true" />
            <p className="watch-sentence">
              <strong className="watch-sentence__verb">{keepTimesTogether(statusAlert.lead)}</strong>
              {statusAlert.rest}
            </p>
          </div>
        </section>
      ) : null}

      {newest ? (
        <section className="watch-alert" aria-label="Watchtower findings">
          <ul id={listId} className="watch-alert__list">
            {[newest, ...(moreOpen ? rest : [])].map((finding) => (
              <li key={finding.transactionId} className="watch-alert__row">
                <span className="watch-mark" aria-hidden="true" />
                <FindingSentence finding={finding} />
              </li>
            ))}
          </ul>
          {rest.length > 0 || explainedToggle ? (
            <div className="watch-alert__actions">
              {rest.length > 0 ? (
                <Disclosure open={moreOpen} controls={listId} onToggle={() => setMoreOpen((v) => !v)}>
                  {moreOpen ? "Show less" : moreLabel(rest.length)}
                </Disclosure>
              ) : null}
              {explainedToggle}
            </div>
          ) : null}
        </section>
      ) : explainedToggle ? (
        <div className="watch-quiet">
          <p className="watch-quiet__text">The Watchtower has no open findings.</p>
          {explainedToggle}
        </div>
      ) : null}

      {explainedOpen && explained.length > 0 ? <ExplainedList id={explainedId} explained={explained} /> : null}
    </div>
  );
}

/** Hands focus back to the replay button when its alert goes, so the keyboard isn't dropped on the page. */
function dismissReplay(id: string) {
  replayStore()?.dismiss(id);
  document.getElementById(REPLAY_BUTTON_ID)?.focus();
}

export function WatchtowerAlerts() {
  const watch = useWatchtower();
  const { alert } = useReplay();
  return <WatchAlertsView watch={watch} replay={alert} onDismissReplay={dismissReplay} />;
}
