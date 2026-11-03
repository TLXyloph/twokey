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
import { CLUB_NAME, riverbend, type ClubDemoData } from "./riverbend";

/** Excel-style pattern; Studio's number formatter treats `$` as a literal. */
const USD = { format: "$#,##0.00" };

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
        description: "One row per fundraising event (demo data). Gap is expected minus received takings.",
        data: data.events.map((event) => ({ ...event, gap: roundCents(event.expected - event.received) })),
        fields: fields([
          ["id", "Event ID", "textFormat", true],
          ["name", "Event", "textFormat"],
          ["date", "Event Date", "dateFormat"],
          ["unitLabel", "Unit", "textFormat"],
          ["unitsLogged", "Units Logged", "integerFormat"],
          ["unitPrice", "Unit Price", "currencyFormat"],
          ["expected", "Expected Takings", "currencyFormat"],
          ["received", "Received Takings", "currencyFormat"],
          ["gap", "Gap (Expected - Received)", "currencyFormat"],
          ["notes", "Event Notes", "textFormat"],
        ]),
      },
      {
        id: "ledger",
        name: "Ledger",
        description:
          "Money in and out of the club account, Oct-Nov 2026 (demo data). Amount is signed. " +
          "Rows from a fundraiser carry its event id.",
        data: data.ledger,
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
    relationships: [manyToOne("ledger-event", ["ledger", "eventId"], ["events", "id"])],
  };
}
