"use client";

/**
 * The live thing: the section's headline is a real field, prefilled with a parent's question, and the
 * ledger answers as the visitor types, from the fictional demo club's data (no network, no AI). The
 * server renders the prefilled question's answer, so the section reads whole without script. On desktop
 * the answer and the screenshot are one pair of equal blocks (columns 1-6 and 7-12), with the examples
 * and the caption on one closing baseline beneath them.
 */
import { useEffect, useId, useRef, useState } from "react";
import { DEFAULT_QUESTION, EXAMPLE_QUESTIONS, askLedger } from "./ask-ledger";

export function AskLedgerSection() {
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const answer = askLedger(question);
  const inputId = useId();
  const noteId = useId();
  const line = useRef<HTMLDivElement>(null);

  // The block caret blinks only while the line is on screen.
  useEffect(() => {
    const el = line.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) el.dataset.inview = "";
      else delete el.dataset.inview;
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section id="ask" className="lp-ask lp-screen" aria-labelledby={`${inputId}-label`}>
      <h2 className="lp-head lp-ask__head" id={`${inputId}-label`} data-reveal="rise">
        <label htmlFor={inputId}>Ask the ledger</label>
      </h2>
      <div className="lp-ask__line" ref={line} data-ui data-reveal="rise">
        <input
          id={inputId}
          className="lp-ask__input"
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          aria-describedby={noteId}
        />
        <span className="lp-ask__ghost" aria-hidden="true">
          <span className="lp-ask__mirror">{question}</span>
          <span className="lp-ask__caret" />
        </span>
      </div>

      <div className="lp-ask__body">
        <div className="lp-ask__left">
          <div className="ui-answer" data-ui data-reveal="rise" data-kind={answer.kind}>
            <p className="ui-answer__sentence" aria-live="polite">
              {answer.sentence}
            </p>
            {answer.rows.length > 0 && (
              <table className="ui-answer__rows">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Entry</th>
                    <th scope="col" className="num">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {answer.rows.map((row) => (
                    <tr key={row.id}>
                      <td className="ui-answer__date">{row.dateLabel}</td>
                      <td>
                        <span className="ui-answer__what">{row.description}</span>
                        <span className="ui-answer__sub">{row.counterparty}</span>
                      </td>
                      <td className="num">
                        <span className="ui-answer__amount">{row.amountLabel}</span>
                        <span className="ui-answer__sub" data-status={row.status}>
                          {row.statusLabel}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="ui-answer__note" id={noteId}>
              Demo data from the fictional Riverbend Youth Football League. In TwoKey, an AI agent answers from PayPal&rsquo;s records.
            </p>
          </div>
          <div className="lp-ask__examples" data-reveal="rise">
            {EXAMPLE_QUESTIONS.map((q) => (
              <button key={q} type="button" className="lp-example" aria-pressed={q === question} onClick={() => setQuestion(q)}>
                {q}
              </button>
            ))}
          </div>
        </div>
        <figure className="lp-shot" data-reveal="rise">
          <div className="lp-shot__frame">
            <img
              src="/landing/img/demo-dashboard.png"
              width={1417}
              height={797}
              alt="The TwoKey board in AG Studio. Under the title, the finding: car wash, October 24, $1,290.00 of $1,305.00 expected has no record. A strip shows the $4,998.75 balance from the PayPal sandbox, $489.00 in two payouts waiting for a second key, and $630.00 in for November. A chart compares received against expected takings for each event, beside the events table, above the queue of payouts waiting for a second officer's signature."
              loading="lazy"
              decoding="async"
            />
          </div>
          <figcaption>The running demo in AG Studio, with the same club&rsquo;s ledger.</figcaption>
        </figure>
      </div>
    </section>
  );
}
