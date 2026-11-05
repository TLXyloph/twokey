/**
 * The close's figures, as the Reviewer reads them: the month statement (opening + in − out =
 * closing, that it carries forward, what was open at month end and the payments' two keys), the exceptions, the month's rows behind the statement, and
 * the money out against each budget line. Presentational: everything comes from ./close-model.ts.
 *
 * Colour: the club maroon goes on a shortfall's figure only, as on the board; spending is drawn in
 * ink against a grey track.
 */
import type { CloseFigures } from "@/close/contracts";
import { AlertGlyph, TickGlyph } from "@/ui/judge/glyphs";
import { approvedTotal, budgetRows, carriedForwardLine, clearChecks, exceptionView, ledgerSections, money, openItemsLine, statementCells, twoKeyLine } from "./close-model";

export function Statement({ figures }: { figures: CloseFigures }) {
  const carried = carriedForwardLine(figures);
  const twoKeys = twoKeyLine(figures);
  return (
    <section className="close-panel close-statement" aria-labelledby="close-statement-title">
      <h2 id="close-statement-title" className="board-visually-hidden">
        Month statement
      </h2>
      <dl className="close-strip">
        {statementCells(figures).map((cell) => (
          <div key={cell.key} className="close-strip__cell" data-cell={cell.key}>
            <dt className="close-strip__label">
              {cell.label}
              <span className="close-strip__note">
                <span className="close-strip__dot"> · </span>
                {cell.note}
              </span>
            </dt>
            <dd className="close-strip__value num">{cell.value}</dd>
          </div>
        ))}
      </dl>
      <ul className="close-checks">
        <li className="close-check" data-ok={carried.ok || undefined}>
          <span className="close-check__mark">{carried.ok ? <TickGlyph /> : <AlertGlyph />}</span>
          <span className="num">{carried.text}</span>
        </li>
        <li className="close-check" data-ok={figures.openItems.length === 0 || undefined}>
          <span className="close-check__mark">{figures.openItems.length === 0 ? <TickGlyph /> : <AlertGlyph />}</span>
          <span>{openItemsLine(figures)}</span>
        </li>
        <li className="close-check" data-ok={twoKeys.ok || undefined}>
          <span className="close-check__mark">{twoKeys.ok ? <TickGlyph /> : <AlertGlyph />}</span>
          <span>{twoKeys.text}</span>
        </li>
      </ul>
    </section>
  );
}

export function Exceptions({ figures }: { figures: CloseFigures }) {
  const items = figures.exceptions.map((exception) => exceptionView(exception, figures));
  const clear = items.length > 0 ? clearChecks(figures) : null;
  return (
    <section className="close-panel close-exceptions-panel" aria-labelledby="close-exceptions-title">
      <header className="close-panel__head">
        <h2 id="close-exceptions-title" className="close-panel__title">
          Exceptions
        </h2>
        <p className="close-panel__aside">Found by code, from the ledger</p>
      </header>
      {items.length === 0 ? (
        <p className="close-empty">None. Every fundraiser&apos;s takings are recorded, and every payment has two keys on record.</p>
      ) : (
        <ul className="close-exceptions">
          {items.map((item) => (
            <li key={item.key} className="close-exception">
              <p className="close-exception__head">
                <span className="close-exception__title">{item.title}</span>
                <span className="close-exception__figure num" data-shortfall={item.shortfall || undefined}>
                  {item.figure}
                </span>
              </p>
              {item.lines.map((line) => (
                <p key={line} className="close-exception__line num">
                  {line}
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
      {clear && <p className="close-exceptions__clear">{clear}</p>}
    </section>
  );
}

/** October, row by row: a ledger table (on a phone, two-line rows). */
export function MonthRows({ figures }: { figures: CloseFigures }) {
  const sections = ledgerSections(figures);
  return (
    <section className="close-panel close-rows-panel" aria-labelledby="close-rows-title">
      <header className="close-panel__head">
        <h2 id="close-rows-title" className="close-panel__title">
          October, row by row
        </h2>
        <p className="close-panel__aside">Completed rows; the opening balance is carried from September</p>
      </header>
      <table className="close-table">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">What</th>
            <th scope="col">From or to</th>
            <th scope="col">Checked against</th>
            <th scope="col" className="close-table__num">
              Amount
            </th>
          </tr>
        </thead>
        {sections.map((section) => (
          <tbody key={section.key} className="close-table__section">
            <tr className="close-table__group">
              <th scope="colgroup" colSpan={4}>
                {section.title} <span className="close-table__count">· {section.count}</span>
              </th>
              <td className="close-table__num num">{section.total}</td>
            </tr>
            {section.rows.map((row) => (
              <tr key={row.key}>
                <td className="close-table__date num">{row.date}</td>
                <td className="close-table__what">
                  {row.description}
                  <span className="close-table__sub num">
                    {[row.date, row.counterparty, row.against].filter(Boolean).join(" · ")}
                    {row.short && <span className="close-table__short"> · {row.short}</span>}
                  </span>
                </td>
                <td className="close-table__who">{row.counterparty}</td>
                <td className="close-table__against num">
                  {row.against ?? <span className="close-table__none">—</span>}
                  {row.short && <span className="close-table__short"> · {row.short}</span>}
                </td>
                <td className="close-table__num num">{row.amount}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </section>
  );
}

export function BudgetLines({ figures }: { figures: CloseFigures }) {
  return (
    <section className="close-panel close-budget" aria-labelledby="close-budget-title">
      <header className="close-panel__head close-panel__head--stack">
        <h2 id="close-budget-title" className="close-panel__title">
          Budget lines
        </h2>
        <p className="close-panel__aside">Paid in October against the season&apos;s approved budget</p>
      </header>
      <ul className="close-rows">
        {budgetRows(figures).map((row) => (
          <li key={row.key} className="close-row">
            <p className="close-row__line">
              <span className="close-row__label">{row.label}</span>
              <span className="close-row__amount num" data-zero={row.spentZero || undefined}>
                {row.figures}
              </span>
            </p>
            <span className="close-bar" role="img" aria-label={`${row.label}: ${row.figures} spent`}>
              {row.share > 0 && <span className="close-bar__fill" style={{ inlineSize: `${(row.share * 100).toFixed(2)}%` }} />}
            </span>
            <p className="close-row__meta num">{row.meta}</p>
          </li>
        ))}
      </ul>
      <p className="close-total">
        <span>Total paid</span>
        <span className="num">
          {money(figures.moneyOutCents)} <span className="close-total__of">of {money(approvedTotal(figures))}</span>
        </span>
      </p>
    </section>
  );
}
