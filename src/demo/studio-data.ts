/**
 * AG Studio data sources for the Riverbend demo data (fictional, see ./riverbend.ts): one table per
 * row type, and a link from ledger rows to the fundraising event they belong to. Field ids
 * ('balances.available') are what widgets and the initial report refer to.
 */
import type {
  AgBaseRegistry,
  AgDataSourcesDefinition,
  AgDefaultRegistry,
  AgFieldDefinition,
  AgFormat,
  AgRelationDefinition,
} from "ag-studio";
import { balanceMonth, isMoneyInThisMonth, stillToSign } from "./board-figures";
import { CLUB_NAME, OFFICERS, riverbend, type ClubDemoData } from "./riverbend";

/**
 * Excel-style patterns; Studio's number formatter treats `$` as a literal. A second section formats
 * negatives, so a shortfall reads "−$1,290.00" with a true minus sign rather than a hyphen.
 */
const USD = { format: "$#,##0.00;\u2212$#,##0.00" };

// [id, name, format, hide?]
type FieldSpec = [id: string, name: string, format: AgFormat, hide?: boolean];

const fields = <TRegistry extends AgBaseRegistry>(specs: FieldSpec[]): AgFieldDefinition<TRegistry>[] =>
  specs.map(([id, name, format, hide]) => ({
    id,
    name,
    format,
    ...(format === "currencyFormat" && { formatOptions: USD }),
    ...(hide && { hide }),
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
      stillToSign: requestedBy ? stillToSign(requestedBy) : null,
      awaitingSecondKey: waiting ? 1 : 0,
      pendingAmount: waiting ? roundCents(-row.amount) : 0,
      moneyInThisMonth: isMoneyInThisMonth(row, month) ? row.amount : 0,
    };
  });
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
        name: "Fundraising Events",
        description:
          "One row per fundraising event (demo data). Difference is received minus expected takings: " +
          "negative when takings have no record.",
        data: data.events.map((event) => ({ ...event, difference: roundCents(event.received - event.expected) })),
        fields: fields([
          ["id", "Event ID", "textFormat", true],
          ["name", "Event", "textFormat"],
          ["date", "Event Date", "dateFormat"],
          ["unitLabel", "Unit", "textFormat"],
          ["unitsLogged", "Units Logged", "integerFormat"],
          ["unitPrice", "Unit Price", "currencyFormat"],
          ["expected", "Expected Takings", "currencyFormat"],
          ["received", "Received Takings", "currencyFormat"],
          ["difference", "Difference", "currencyFormat"],
          ["notes", "Event Notes", "textFormat"],
        ]),
      },
      {
        id: "ledger",
        name: "Ledger",
        description:
          "Money in and out of the club account, Oct-Nov 2026 (demo data). Amount is signed. " +
          "Rows from a fundraiser carry its event id. A pending payout carries the officer who signed it " +
          `first and the officers who may sign second (${OFFICERS.map((o) => o.title).join(", ")}; never the same officer). ` +
          "Waiting for second key (1 or 0), Pending payout and Money in this month are per-row helpers: sum them.",
        data: ledgerRows(data),
        fields: fields([
          ["id", "Ledger ID", "textFormat"],
          ["date", "Ledger Date", "dateFormat"],
          ["description", "Description", "textFormat"],
          ["counterparty", "Counterparty", "textFormat"],
          ["category", "Category", "textFormat"],
          ["direction", "Direction", "textFormat"],
          ["amount", "Amount", "currencyFormat"],
          ["status", "Ledger Status", "textFormat"],
          ["eventId", "Event ID", "textFormat", true],
          ["accountId", "Account ID", "textFormat", true],
          ["signedBy", "Signed By", "textFormat"],
          ["stillToSign", "Still To Sign", "textFormat"],
          ["awaitingSecondKey", "Waiting For Second Key", "integerFormat"],
          ["pendingAmount", "Pending Payout", "currencyFormat"],
          ["moneyInThisMonth", "Money In This Month", "currencyFormat"],
        ]),
      },
      {
        id: "balances",
        name: "Balances",
        description: "The club account's balance as last read from the PayPal sandbox (demo data). One row.",
        data: data.balances,
        fields: fields([
          ["id", "Balance ID", "textFormat", true],
          ["account", "Account", "textFormat"],
          ["currency", "Balance Currency", "textFormat"],
          ["available", "Available Balance", "currencyFormat"],
          ["asOf", "Balance As Of", "dateTimeFormat"],
        ]),
      },
    ],
    // The ledger is the fact table: each row belongs to the club account and, for a fundraiser, to
    // its event. That keeps every table reachable from every other (one connected schema).
    relationships: [
      manyToOne("ledger-event", ["ledger", "eventId"], ["events", "id"]),
      manyToOne("ledger-account", ["ledger", "accountId"], ["balances", "id"]),
    ],
  };
}
