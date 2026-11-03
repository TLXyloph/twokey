/**
 * The TwoKey auditor's own tools. `compare_event_takings` sets each fundraising event's expected
 * takings (units logged x unit price) against what was received, and lists the deposits the ledger
 * records against it. The model gets the comparison as text and as structured data.
 *
 * The computation is pure and works on the demo data passed in; only the tool wrapper touches Studio.
 */
import type { AgAiTool, AgBaseAiToolDisplay, AgStudioApi } from "ag-studio";
import type { ClubDemoData } from "@/demo/riverbend";

export const COMPARE_EVENT_TAKINGS_TOOL = "compare_event_takings";

export type TakingsStatus = "reconciled" | "short" | "over";

export interface EventDeposit {
  ledgerId: string;
  date: string;
  description: string;
  amount: number;
}

export interface EventTakings {
  eventId: string;
  event: string;
  date: string;
  unitLabel: string;
  unitsLogged: number;
  unitPrice: number;
  expected: number;
  received: number;
  /** expected - received: positive when short, negative when over. */
  gap: number;
  status: TakingsStatus;
  /** Completed money in tagged to this event in the ledger. */
  deposits: EventDeposit[];
  /** The sum of `deposits`; should equal `received`. */
  ledgerReceived: number;
}

export interface EventTakingsComparison {
  events: EventTakings[];
  totals: { expected: number; received: number; gap: number };
}

type TakingsData = Pick<ClubDemoData, "events" | "ledger">;

const toCents = (amount: number) => Math.round(amount * 100);
const fromCents = (cents: number) => cents / 100;
const sum = (amounts: number[]) => fromCents(amounts.reduce((total, amount) => total + toCents(amount), 0));

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const money = (amount: number) => usd.format(amount);

/** Expected vs received takings per event, in date order; `eventId` narrows to one event. */
export function compareEventTakings(data: TakingsData, eventId?: string): EventTakingsComparison {
  const events = data.events
    .filter((event) => eventId === undefined || event.id === eventId)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((event): EventTakings => {
      const deposits = data.ledger
        .filter((row) => row.eventId === event.id && row.direction === "in" && row.status === "completed")
        .map((row) => ({ ledgerId: row.id, date: row.date, description: row.description, amount: row.amount }));
      const gap = fromCents(toCents(event.expected) - toCents(event.received));
      return {
        eventId: event.id,
        event: event.name,
        date: event.date,
        unitLabel: event.unitLabel,
        unitsLogged: event.unitsLogged,
        unitPrice: event.unitPrice,
        expected: event.expected,
        received: event.received,
        gap,
        status: gap === 0 ? "reconciled" : gap > 0 ? "short" : "over",
        deposits,
        ledgerReceived: sum(deposits.map((deposit) => deposit.amount)),
      };
    });
  return {
    events,
    totals: {
      expected: sum(events.map((e) => e.expected)),
      received: sum(events.map((e) => e.received)),
      gap: sum(events.map((e) => e.gap)),
    },
  };
}

/** The comparison as the model reads it: totals first, then one line per event with its figures. */
export function describeComparison({ events, totals }: EventTakingsComparison): string {
  const lines = [
    `Expected vs received takings (demo data, ${events.length} event${events.length === 1 ? "" : "s"}). ` +
      `Totals: expected ${money(totals.expected)}, received ${money(totals.received)}, gap ${money(totals.gap)}.`,
  ];
  for (const e of events) {
    const outcome =
      e.status === "reconciled" ? "reconciled" : e.status === "short" ? `short by ${money(e.gap)}` : `over by ${money(-e.gap)}`;
    const deposits = e.deposits.length
      ? e.deposits.map((d) => `${d.ledgerId} ${d.date} ${money(d.amount)} "${d.description}"`).join("; ")
      : "none";
    let line =
      `- ${e.event} (${e.date}): ${e.unitsLogged} ${e.unitLabel} x ${money(e.unitPrice)} = ${money(e.expected)} expected; ` +
      `${money(e.received)} received; ${outcome}. Deposits recorded: ${deposits}.`;
    if (toCents(e.ledgerReceived) !== toCents(e.received)) {
      line += ` Note: the event records ${money(e.received)} received but the ledger rows tagged to it sum to ${money(e.ledgerReceived)}.`;
    }
    lines.push(line);
  }
  lines.push(
    "Received takings are the money in recorded against each event in the ledger. A gap means the data has " +
      "no record of that money; it does not show where it went.",
  );
  return lines.join("\n");
}

/** The Studio tool. Built once per harness; `api` is the Studio API the harness was created with. */
export function createCompareEventTakingsTool(api: Pick<AgStudioApi, "defineAiTool">, data: TakingsData): AgAiTool {
  const eventIds = data.events.map((event) => event.id);
  return api.defineAiTool({
    name: COMPARE_EVENT_TAKINGS_TOOL,
    description:
      "Compare each fundraising event's expected takings (units logged x unit price) with the takings received, " +
      "and list the deposits the ledger records against it. Use it first for any question about a fundraiser, " +
      "its takings, or money that seems to be unaccounted for. Omit eventId to compare every event.",
    params: (s) =>
      s.object({
        eventId: s.enum(eventIds, { description: "Compare only this event. Omit to compare every event." }).optional(),
      }),
    execute: (args, ctx) => {
      const eventId = typeof args.eventId === "string" ? args.eventId : undefined;
      if (eventId !== undefined && !eventIds.includes(eventId)) {
        return ctx.error(`Unknown eventId '${eventId}'. Known events: ${eventIds.join(", ")}.`);
      }
      const comparison = compareEventTakings(data, eventId);
      return ctx.success(describeComparison(comparison), comparison);
    },
  });
}

/** How the chat panel shows calls to the auditor's tools (Studio shows only the name otherwise). */
export const AUDITOR_TOOL_DISPLAY: Record<string, AgBaseAiToolDisplay> = {
  [COMPARE_EVENT_TAKINGS_TOOL]: {
    label: ({ args }) => ({
      text: "Compare expected and received takings",
      ...(typeof args.eventId === "string" && { pill: args.eventId }),
    }),
  },
};
