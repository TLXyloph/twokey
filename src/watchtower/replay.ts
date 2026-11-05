/**
 * Judge mode's "Replay an outside send": the recorded real Test B rows (./recorded-outside-send.ts)
 * through the same parser and classifier as a live run, so judges watch the real alert fire.
 * Nothing is stored. The finding is stamped as first seen now, with no reporting delay (a replay
 * has none), and labelled as a replay of a real sandbox event.
 */
import { parseSearchPage } from "@/payments/paypal/transactions";
import { classifyRows, findingFrom } from "./classify";
import type { WatchReplay } from "./contracts";
import { explanationFor } from "./explanations";
import { RECORDED_OUTSIDE_SEND } from "./recorded-outside-send";

const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const dollars = (cents: number): string => `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

export function replayOutsideSend(now: Date): WatchReplay {
  const page = parseSearchPage(RECORDED_OUTSIDE_SEND);
  const debit = page && classifyRows(page.rows, page.lastRefreshed).debits.find((candidate) => candidate.route === "outside_debit");
  if (!debit) throw new Error("the recorded outside send no longer classifies as an outside debit");
  const finding = findingFrom(debit, {
    kind: "outside_debit",
    label: debit.label,
    firstSeenAt: now.toISOString(),
    backfill: true,
    explanation: explanationFor(debit.transactionId, debit.customField),
  });
  const what = debit.eventCode === "T0000" ? "website send" : "debit";
  return { finding, label: `Replay of a real sandbox event: a ${dollars(finding.amountCents)} ${what} on ${DATE.format(new Date(finding.at))}.` };
}
