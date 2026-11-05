"use client";

/**
 * The five setup steps, in order (a real `<ol>`: order matters). Each title opens its details:
 * what to do and where, why the rulebook asks for it, and PayPal's own help pages. The next step
 * to make is open and carries the one primary action, "Mark done"; marking it opens the step after,
 * and focus follows. Demo data: marking a step changes only this page (and "Who holds the keys").
 */
import { useEffect, useId, useRef, useState, type Ref } from "react";
import { TickGlyph } from "@/ui/judge/glyphs";
import { KEY_STEPS, KEYS_COPY, STEP_COUNT, type KeyStep, type KeyStepId } from "./keys-content";

type StepState = "done" | "next" | "later";

export interface KeyChecklistProps {
  done: number;
  onAdvance(): void;
  onBack(): void;
  onReset(): void;
}

function StepMark({ state }: { state: StepState }) {
  return (
    <span className="keys-mark" data-state={state} aria-hidden="true">
      <span className="keys-mark__ring" />
      <span className="keys-mark__tick">
        <TickGlyph />
      </span>
    </span>
  );
}

const STATE_WORDS: Record<StepState, string> = { done: "Done", next: "Next", later: "To do" };

interface StepProps {
  step: KeyStep;
  state: StepState;
  open: boolean;
  onToggle(): void;
  onAdvance(): void;
  actionRef?: Ref<HTMLButtonElement>;
}

function Step({ step, state, open, onToggle, onAdvance, actionRef }: StepProps) {
  const bodyId = useId();
  return (
    <li className="keys-step" data-state={state} data-open={open ? "" : undefined}>
      <h3 className="keys-step__heading">
        <button type="button" className="keys-step__toggle" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
          <StepMark state={state} />
          <span className="keys-step__title">{step.title}</span>
          <span className="keys-step__state">
            <span className="board-visually-hidden">: </span>
            {STATE_WORDS[state]}
          </span>
        </button>
      </h3>
      <div id={bodyId} className="keys-step__body" inert={!open}>
        <div className="keys-step__inner">
          <div className="keys-step__part">
            <p className="keys-step__label">{step.where}</p>
            <p className="keys-step__text">{step.how}</p>
          </div>
          <div className="keys-step__part">
            <p className="keys-step__label">Why the rulebook asks</p>
            <p className="keys-step__text">{step.why}</p>
          </div>
          <p className="keys-step__help">
            <span className="keys-step__help-label">Help pages:</span>{" "}
            {step.help.map((link, index) => (
              <span key={link.href}>
                {index > 0 ? " · " : null}
                <a className="keys-link keys-step__help-item" href={link.href} target="_blank" rel="noopener noreferrer">
                  {link.label}
                </a>
              </span>
            ))}
          </p>
          {state === "next" ? (
            <div className="keys-step__action">
              <button ref={actionRef} type="button" className="keys-primary" onClick={onAdvance}>
                Mark done
              </button>
              <span className="keys-step__demo">Demo data: nothing is sent to PayPal</span>
            </div>
          ) : state === "done" ? (
            <p className="keys-step__demo">Marked done in this demo.</p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function KeyChecklist({ done, onAdvance, onBack, onReset }: KeyChecklistProps) {
  const nextId: KeyStepId | null = KEY_STEPS[done]?.id ?? null;
  const [openId, setOpenId] = useState<KeyStepId | null>(nextId);
  const lastDone = useRef(done);
  const advanced = useRef(false);
  const actionRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);

  // A step marked (or undone) opens the step that is now next; after a mark, focus goes to its button.
  useEffect(() => {
    if (done === lastDone.current) return;
    lastDone.current = done;
    setOpenId(nextId);
    if (advanced.current) {
      advanced.current = false;
      requestAnimationFrame(() => (actionRef.current ?? backRef.current)?.focus({ preventScroll: true }));
    }
  }, [done, nextId]);

  const stateOf = (index: number): StepState => (index < done ? "done" : index === done ? "next" : "later");

  return (
    <section className="keys-card keys-checklist" aria-labelledby="keys-checklist-title">
      <div className="keys-card__head">
        <h2 id="keys-checklist-title" className="keys-card__title">
          {KEYS_COPY.checklistTitle}
        </h2>
        <p className="keys-card__meta" aria-live="polite">
          {done} of {STEP_COUNT} done
        </p>
      </div>
      <p className="keys-card__note">{KEYS_COPY.checklistNote}</p>
      <ol className="keys-steps">
        {KEY_STEPS.map((step, index) => (
          <Step
            key={step.id}
            step={step}
            state={stateOf(index)}
            open={openId === step.id}
            onToggle={() => setOpenId(openId === step.id ? null : step.id)}
            onAdvance={() => {
              advanced.current = true;
              onAdvance();
            }}
            actionRef={index === done ? actionRef : undefined}
          />
        ))}
      </ol>
      {done > 0 ? (
        <div className="keys-checklist__foot">
          {done === STEP_COUNT ? <p className="keys-checklist__all">All five changes are made.</p> : null}
          <div className="keys-checklist__undo">
            <button ref={backRef} type="button" className="keys-text-button" onClick={onBack}>
              Undo the last step
            </button>
            <button type="button" className="keys-text-button" onClick={onReset}>
              Show the “before” again
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
