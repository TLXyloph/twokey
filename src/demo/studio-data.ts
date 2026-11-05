/**
 * AG Studio data sources for the Riverbend demo data (fictional, see ./riverbend.ts): one table per
 * row type, the payouts waiting for a second key, and links from ledger rows to their event and
 * account. Field ids ('balances.available') are what widgets and the initial report refer to.
 *
 * Field names are sentence case and short, because Studio uses them as they are for grid headers,
 * chart legends and the AI's view of the schema; there is no per-widget column title.
 */
import type {
  AgBaseRegistry,
  AgDataSourcesDefinition,
  AgDefaultRegistry,
  AgFieldDefinition,
  AgFormat,
  AgRelationDefinition,
} from "ag-studio";
import { balanceMonth, isMoneyInThisMonth, secondKeyQueue, stillToSignFor } from "./board-figures";
import { CLUB_NAME, OFFICERS, riverbend, type ClubDemoData } from "./riverbend";

/**
 * Excel-style patterns; Studio's number formatter treats `$` as a literal. A second section formats
 * negatives, so a shortfall reads "−$1,290.00" with a true minus sign rather than a hyphen.
 */
const USD = { format: "$#,##0.00;−$#,##0.00" };
/** "Oct 24": every date here falls in one season, so the year adds nothing. */
const SHORT_DATE = { format: "mmm d" };

/** Carried on a field whose negative values are shortfalls; the grid prints those in the data hue. */
export interface ShortfallFieldContext {
  negativeIsShortfall: true;
}
export const SHORTFALL_FIELD_CONTEXT: ShortfallFieldContext = { negativeIsShortfall: true };

interface FieldExtras {
  hide?: boolean;
  description?: string;
  context?: ShortfallFieldContext;
}
// [id, name, format, extras?]
type FieldSpec = [id: string, name: string, format: AgFormat, extras?: FieldExtras];

const FORMAT_OPTIONS: Partial<Record<AgFormat, object>> = { currencyFormat: USD, dateFormat: SHORT_DATE };

const fields = <TRegistry extends AgBaseRegistry>(specs: FieldSpec[]): AgFieldDefinition<TRegistry>[] =>
  specs.map(([id, name, format, extras = {}]) => ({
    id,
    name,
    format,
    ...(FORMAT_OPTIONS[format] && { formatOptions: FORMAT_OPTIONS[format] }),
    ...(extras.hide && { hide: true }),
    ...(extras.description && { description: extras.description }),
    ...(extras.context && { context: extras.context }),
  }));

const roundCents = (amount: number) => Math.round(amount * 100) / 100;

const manyToOne = (id: string, source: [string, string], target: [string, string]): AgRelationDefinition => ({
  id,
  source: { tableId: source[0], fieldId: source[1] },
  target: { tableId: target[0], fieldId: target[1] },
  type: "many-to-one",
});

/** Ledger rows plus the per-row helpers the balances strip and the second-key block aggregate. */
export function ledgerRows(data: ClubDemoData = riverbend) {
  const accountId = data.balances[0]?.id ?? null;
  const month = balanceMonth(data);
  return data.ledger.map(({ requestedBy, ...row }) => {
    const waiting = row.status === "pending" && row.direction === "out" && requestedBy !== null;
    return {
      ...row,
      accountId,
      signedBy: requestedBy ? (OFFICERS.find((o) => o.role === requestedBy)?.title ?? null) : null,
      stillToSign: stillToSignFor({ ...row, requestedBy }),
      awaitingSecondKey: waiting ? 1 : 0,
      pendingAmount: waiting ? roundCents(-row.amount) : 0,
      moneyInThisMonth: isMoneyInThisMonth(row, month) ? row.amount : 0,
    };
  });
}

/** "events.received" and the rest: every field formatted as money, as `table.field` ids. */
export function currencyFieldIds(definition: Pick<AgDataSourcesDefinition, "sources">): Set<string> {
  const ids = new Set<string>();
  for (const source of definition.sources) {
    if (!("fields" in source)) continue;
    for (const field of source.fields ?? []) if (field.format === "currencyFormat") ids.add(`${source.id}.${field.id}`);
  }
  return ids;
}

/** Generic over the Studio registry so the caller's widget registry types it; the data is the same. */
export function buildStudioData<TRegistry extends AgBaseRegistry = AgDefaultRegistry>(
  data: ClubDemoData = riverbend,
): AgDataSourcesDefinition<TRegistry> {
  return {
    description:
      `DEMO DATA (fictional): the club account of the ${CLUB_NAME}, a volunteer-run youth league, ` +
      "as a PayPal sandbox account would show it. All amounts are USD. " +
      "Ledger amounts are signed: money in is positive, money out negative. Only 'completed' rows count " +
      "towards the available balance; 'pending' payouts are waiting for a second approver. " +
      "Each fundraising event records expected takings (units logged x unit price) and received takings " +
      "(money in recorded against the event in the ledger).",
    sources: [
      {
        id: "events",
        name: "Fundraising events",
        description:
          "One row per fundraising event (demo data). Difference is received minus expected takings: " +
          "negative when takings have no record.",
        data: data.events.map((event) => ({ ...event, difference: roundCents(event.received - event.expected) })),
        fields: fields([
          ["id", "Event ID", "textFormat", { hide: true }],
          ["name", "Event", "textFormat"],
          ["date", "Date", "dateFormat", { description: "The day the event was held." }],
          ["unitLabel", "Unit", "textFormat"],
          ["unitsLogged", "Units logged", "integerFormat"],
          ["unitPrice", "Unit price", "currencyFormat"],
          ["expected", "Expected", "currencyFormat", { description: "Expected takings: units logged x unit price." }],
          ["received", "Received", "currencyFormat", { description: "Received takings: completed money in recorded against the event." }],
          [
            "difference",
            "Difference",
            "currencyFormat",
            { description: "Received minus expected. Negative when takings have no record.", context: SHORTFALL_FIELD_CONTEXT },
          ],
          ["notes", "Notes", "textFormat"],
        ]),
      },
      {
        id: "ledger",
        name: "Ledger",
        description:
          "Money in and out of the club account, Oct-Nov 2026 (demo data). Amount is signed. " +
          "Rows from a fundraiser carry its event id. A pending payout carries the officer who signed it " +
          `first and the officers who may sign second (${OFFICERS.map((o) => o.title).join(", ")}; never the same officer). ` +
          "Waiting for a second key (1 or 0), Pending payout and Money in this month are per-row helpers: sum them.",
        data: ledgerRows(data),
        fields: fields([
          ["id", "Ledger ID", "textFormat"],
          ["date", "Date", "dateFormat"],
          ["description", "Description", "textFormat"],
          ["counterparty", "Counterparty", "textFormat"],
          ["category", "Category", "textFormat"],
          ["direction", "Direction", "textFormat"],
          ["amount", "Amount", "currencyFormat", { description: "Signed: money in is positive, money out negative." }],
          ["status", "Status", "textFormat", { description: "completed, or pending (a payout waiting for a second key)." }],
          ["eventId", "Event ID", "textFormat", { hide: true }],
          ["accountId", "Account ID", "textFormat", { hide: true }],
          ["signedBy", "Signed by", "textFormat"],
          ["stillToSign", "Still to sign", "textFormat"],
          ["awaitingSecondKey", "Waiting for a second key", "integerFormat", { description: "1 for a payout waiting for a second key, else 0. Sum it to count them." }],
          ["pendingAmount", "Pending payout", "currencyFormat", { description: "A waiting payout's amount as a positive figure, else 0. Sum it." }],
          ["moneyInThisMonth", "Money in this month", "currencyFormat", { description: "Completed money in dated in the balance's month, else 0. Sum it." }],
        ]),
      },
      {
        id: "balances",
        name: "Balances",
        description: "The club account's balance as last read from the PayPal sandbox (demo data). One row.",
        data: data.balances,
        fields: fields([
          ["id", "Balance ID", "textFormat", { hide: true }],
          ["account", "Account", "textFormat"],
          ["currency", "Currency", "textFormat"],
          ["available", "Available balance", "currencyFormat"],
          ["asOf", "As of", "dateTimeFormat"],
        ]),
      },
      {
        id: "waiting",
        name: "Waiting for a second key",
        description:
          "Payouts one officer has signed that wait for a second officer's key (demo data). One row per " +
          "pending payout in the ledger; amounts are positive. The money has not left the account.",
        data: secondKeyQueue(data).payouts,
        fields: fields([
          ["id", "Ledger ID", "textFormat", { hide: true }],
          ["date", "Requested", "dateFormat", { description: "The day the first officer signed." }],
          ["payee", "Payee", "textFormat"],
          ["description", "Description", "textFormat"],
          ["amount", "Amount", "currencyFormat", { description: "The payout, as a positive amount." }],
          ["signedBy", "Signed by", "textFormat", { description: "The officer who requested the payout and signed first." }],
          ["stillToSign", "Still to sign", "textFormat", { description: "The officers who may sign second; never the first signer, never the payee." }],
        ]),
      },
    ],
    // The ledger is the fact table: each row belongs to the club account and, for a fundraiser, to
    // its event. That keeps every table reachable from every other (one connected schema).
    relationships: [
      manyToOne("ledger-event", ["ledger", "eventId"], ["events", "id"]),
      manyToOne("ledger-account", ["ledger", "accountId"], ["balances", "id"]),
      manyToOne("waiting-ledger", ["waiting", "id"], ["ledger", "id"]),
    ],
  };
}
