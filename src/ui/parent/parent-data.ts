/**
 * AG Studio's data sources for the parent ledger: the same session data as the board
 * (`BoardView.data`, folded from the seed and this session's events), named for parents. Studio
 * uses a field's name as it is in table headers and chart legends, so the words here are the words
 * on the page: "Paid to or from", not "Counterparty"; "Waiting for a second key", not "pending".
 *
 * What a parent never gets: an email, an address, a key id or a signature. `ClubDemoData` carries
 * none of them (payees are names), and nothing else from the board view reaches Studio.
 */
import type { AgBaseRegistry, AgDataSourcesDefinition, AgDefaultRegistry, AgFieldDefinition, AgFormat, AgRelationDefinition } from "ag-studio";
import { balanceMonth, isMoneyInThisMonth, secondKeyQueue } from "@/demo/board-figures";
import { CLUB_NAME, OFFICERS, riverbend, type ClubDemoData, type LedgerEntry } from "@/demo/riverbend";
import { SHORTFALL_FIELD_CONTEXT, type ShortfallFieldContext } from "@/demo/studio-data";

/** A true minus sign on a negative amount, as on the board. */
const USD = { format: "$#,##0.00;−$#,##0.00" };
const SHORT_DATE = { format: "mmm d" };
const FORMAT_OPTIONS: Partial<Record<AgFormat, object>> = { currencyFormat: USD, dateFormat: SHORT_DATE };

type FieldSpec = [id: string, name: string, format: AgFormat, extras?: { hide?: boolean; description?: string; context?: ShortfallFieldContext }];

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

export type ParentRowStatus = "Received" | "Paid" | "Waiting for a second key";

/** A ledger row's state, in a parent's words. */
export function parentStatus(row: Pick<LedgerEntry, "direction" | "status">): ParentRowStatus {
  if (row.status === "pending") return "Waiting for a second key";
  return row.direction === "in" ? "Received" : "Paid";
}

/** The ledger rows as parents read them, plus the per-row helpers the balance widget sums. */
export function parentLedgerRows(data: ClubDemoData = riverbend) {
  const accountId = data.balances[0]?.id ?? null;
  const month = balanceMonth(data);
  return data.ledger.map((row) => {
    const waiting = row.status === "pending" && row.direction === "out" && row.requestedBy !== null;
    return {
      id: row.id,
      date: row.date,
      description: row.description,
      party: row.counterparty,
      amount: row.amount,
      status: parentStatus(row),
      eventId: row.eventId,
      accountId,
      awaitingSecondKey: waiting ? 1 : 0,
      pendingAmount: waiting ? roundCents(-row.amount) : 0,
      moneyInThisMonth: isMoneyInThisMonth(row, month) ? row.amount : 0,
    };
  });
}

/** The payouts with one key on them: payee, what for, amount and the officers who may sign second. */
export function parentWaitingRows(data: ClubDemoData = riverbend) {
  // The queue already names the second signers without the requester or the payee.
  return secondKeyQueue(data).payouts.map(({ id, date, payee, description, amount, signedBy, stillToSign }) => ({
    id,
    date,
    payee,
    description,
    amount,
    signedBy,
    stillToSign,
  }));
}

export function parentStudioData<TRegistry extends AgBaseRegistry = AgDefaultRegistry>(
  data: ClubDemoData = riverbend,
): AgDataSourcesDefinition<TRegistry> {
  return {
    description:
      `DEMO DATA (fictional): the club account of the ${CLUB_NAME}, as its parents see it. All amounts are USD. ` +
      "Ledger amounts are signed: money in is positive, money out negative. A payout waiting for a second key " +
      "has not left the account.",
    sources: [
      {
        id: "events",
        name: "Fundraising events",
        description: "One row per fundraising event. Difference is received minus expected: negative when takings have no record.",
        data: data.events.map((event) => ({ ...event, difference: roundCents(event.received - event.expected) })),
        fields: fields([
          ["id", "Event ID", "textFormat", { hide: true }],
          ["name", "Event", "textFormat"],
          ["date", "Date", "dateFormat"],
          ["unitLabel", "Counted", "textFormat"],
          ["unitsLogged", "How many", "integerFormat"],
          ["unitPrice", "Price each", "currencyFormat"],
          ["expected", "Expected", "currencyFormat", { description: "How many were counted, times the price." }],
          ["received", "Received", "currencyFormat", { description: "Money in recorded against the event." }],
          ["difference", "Difference", "currencyFormat", { description: "Received minus expected.", context: SHORTFALL_FIELD_CONTEXT }],
          ["notes", "Notes", "textFormat"],
        ]),
      },
      {
        id: "ledger",
        name: "Money in and out",
        description:
          "Every row in the club account. Amount is signed. Status is Received, Paid, or Waiting for a second key " +
          `(one of ${OFFICERS.map((o) => o.title).join(", ")} has signed; another must sign before it is paid).`,
        data: parentLedgerRows(data),
        fields: fields([
          ["id", "Ledger ID", "textFormat", { hide: true }],
          ["date", "Date", "dateFormat"],
          ["description", "What for", "textFormat"],
          ["party", "Paid to or from", "textFormat"],
          ["amount", "Amount", "currencyFormat", { description: "Signed: money in is positive, money out negative." }],
          ["status", "Status", "textFormat"],
          ["eventId", "Event ID", "textFormat", { hide: true }],
          ["accountId", "Account ID", "textFormat", { hide: true }],
          ["awaitingSecondKey", "Waiting for a second key", "integerFormat", { description: "1 for a payout waiting for a second key, else 0." }],
          ["pendingAmount", "Waiting to be paid", "currencyFormat", { description: "A waiting payout's amount, else 0." }],
          ["moneyInThisMonth", "Money in this month", "currencyFormat", { description: "Money received in the balance's month, else 0." }],
        ]),
      },
      {
        id: "balances",
        name: "Balance",
        description: "The club account's balance, as last read. One row.",
        data: data.balances,
        fields: fields([
          ["id", "Balance ID", "textFormat", { hide: true }],
          ["account", "Account", "textFormat"],
          ["currency", "Currency", "textFormat"],
          ["available", "In the club account", "currencyFormat"],
          ["asOf", "As of", "dateTimeFormat"],
        ]),
      },
      {
        id: "waiting",
        name: "Waiting for a second key",
        description: "Payouts one officer has signed that wait for a second officer's key. The money has not left the account.",
        data: parentWaitingRows(data),
        fields: fields([
          ["id", "Ledger ID", "textFormat", { hide: true }],
          ["date", "Asked for", "dateFormat"],
          ["payee", "Payee", "textFormat"],
          ["description", "What for", "textFormat"],
          ["amount", "Amount", "currencyFormat"],
          ["signedBy", "First key", "textFormat"],
          ["stillToSign", "Second key from", "textFormat"],
        ]),
      },
    ],
    relationships: [
      manyToOne("ledger-event", ["ledger", "eventId"], ["events", "id"]),
      manyToOne("ledger-account", ["ledger", "accountId"], ["balances", "id"]),
      manyToOne("waiting-ledger", ["waiting", "id"], ["ledger", "id"]),
    ],
  };
}
