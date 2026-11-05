/**
 * The balances strip's model, kept apart from React and Studio so it can be tested as plain data:
 * which queries the Live Balance widget runs, and the cells it draws from their results.
 *
 * Three cells, left to right: the available balance (the figure that does not change during the
 * day), the payouts waiting for a second key, and money in this month. The second and third are
 * optional slots; an unmapped slot means its cell is not drawn.
 */
import { formatAsOf, formatUsd, monthNameOf } from "@/demo/board-figures";
import { CLUB_TIME_ZONE } from "@/demo/riverbend";

export type StripSlot = "value" | "asOf" | "waitingCount" | "waitingTotal" | "moneyIn";
export const STRIP_SLOTS: readonly StripSlot[] = ["value", "asOf", "waitingCount", "waitingTotal", "moneyIn"];

type AsOf = string | number | Date;

export interface StripFigures {
  balance: number;
  asOf?: AsOf | null;
  /** Absent when `waitingTotal` is unmapped. `null` totals are empty sums: nothing in view. */
  waiting?: { total: number | null; count?: number | null };
  /** Absent when `moneyIn` is unmapped. */
  moneyIn?: number | null;
  /**
   * PayPal's real balance for the shared sandbox account (from the live board view, not from
   * Studio): every judge session draws on one account, so it differs from this session's ledger.
   */
  shared?: { availableCents: number; asOf: AsOf } | null;
}

export interface StripCell {
  id: "balance" | "waiting" | "moneyIn";
  label: string;
  value: string;
  caption: string;
  /** A second caption line: the shared sandbox balance, under the available balance only. */
  note?: string;
  /** The same line for a narrow strip, one word shorter. */
  noteShort?: string;
  /** A zero figure: drawn in grey, with a caption that says so. */
  zero: boolean;
}

export type FormatMoney = (amount: number, slot: StripSlot) => string;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

const clubDay = new Intl.DateTimeFormat("en-CA", { timeZone: CLUB_TIME_ZONE });
const clubClock = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: CLUB_TIME_ZONE, timeZoneName: "short" });

/** "8:30 AM CST" when on the same club day as `reference` (the caption above names it), else "Nov 5, 8:30 AM CST". */
function asOfBeside(value: AsOf, reference: AsOf | null | undefined): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const ref = reference == null ? null : new Date(reference);
  return ref && !Number.isNaN(ref.getTime()) && clubDay.format(ref) === clubDay.format(date) ? clubClock.format(date) : formatAsOf(date);
}

export function balancesStripCells(figures: StripFigures, formatMoney: FormatMoney = formatUsd): StripCell[] {
  const asOf = figures.asOf == null ? "" : formatAsOf(figures.asOf);
  const month = figures.asOf == null ? "" : monthNameOf(figures.asOf);
  const shared = figures.shared;
  const sharedFigures = shared && `${formatUsd(shared.availableCents / 100)} · as of ${asOfBeside(shared.asOf, figures.asOf)}`;
  const cells: StripCell[] = [
    {
      id: "balance",
      label: "Available balance",
      value: formatMoney(figures.balance, "value"),
      caption: asOf ? `This session's ledger · as of ${asOf}` : "This session's ledger",
      ...(sharedFigures && { note: `Shared sandbox balance ${sharedFigures}`, noteShort: `Shared sandbox ${sharedFigures}` }),
      zero: figures.balance === 0,
    },
  ];

  if (figures.waiting) {
    const total = figures.waiting.total ?? 0;
    const count = figures.waiting.count;
    const caption = total === 0 ? "Nothing waiting" : count == null ? "Not yet paid out" : plural(count, "payout");
    cells.push({ id: "waiting", label: "Waiting for a second key", value: formatMoney(total, "waitingTotal"), caption, zero: total === 0 });
  }

  if (figures.moneyIn !== undefined) {
    const total = figures.moneyIn ?? 0;
    const since = month ? `since ${month} 1` : "this month";
    cells.push({
      id: "moneyIn",
      label: month ? `Money in, ${month}` : "Money in this month",
      value: formatMoney(total, "moneyIn"),
      caption: total === 0 && month ? `No completed payments ${since}` : `Completed payments ${since}`,
      zero: total === 0,
    });
  }
  return cells;
}

export interface StripQuery<TField> {
  queryId: string;
  slots: StripSlot[];
  fields: TField[];
}

/** "balances" for "balances.available": the table a field id belongs to. */
const tableOf = (fieldId: string) => fieldId.split(".", 1)[0] ?? fieldId;

/**
 * One query per table, each with its own `queryId`. Asking for the balance and a ledger sum in one
 * query would join the one balance row to every ledger row and multiply the balance.
 */
export function planStripQueries<TField extends { fieldId: string }>(mapped: Partial<Record<StripSlot, TField>>): StripQuery<TField>[] {
  const byTable = new Map<string, StripQuery<TField>>();
  for (const slot of STRIP_SLOTS) {
    const field = mapped[slot];
    if (!field) continue;
    const table = tableOf(String(field.fieldId));
    const query = byTable.get(table) ?? { queryId: `strip:${table}`, slots: [], fields: [] };
    query.slots.push(slot);
    query.fields.push(field);
    byTable.set(table, query);
  }
  return [...byTable.values()];
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

const toAsOf = (value: unknown): AsOf | null =>
  typeof value === "string" || typeof value === "number" || value instanceof Date ? value : null;

/** The figures from the queries' first rows, by slot; null when there is no balance to show. */
export function toStripFigures(values: Partial<Record<StripSlot, unknown>>, mapped: ReadonlySet<StripSlot>): StripFigures | null {
  const balance = toNumber(values.value);
  if (balance === null) return null;
  return {
    balance,
    asOf: toAsOf(values.asOf),
    waiting: mapped.has("waitingTotal")
      ? { total: toNumber(values.waitingTotal), count: mapped.has("waitingCount") ? toNumber(values.waitingCount) : undefined }
      : undefined,
    moneyIn: mapped.has("moneyIn") ? toNumber(values.moneyIn) : undefined,
  };
}
