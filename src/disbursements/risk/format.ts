/**
 * Plain, deterministic formatting for the risk card and the AI prompt: money from integer cents,
 * and dates in the club's time zone.
 *
 * Deterministic matters: these strings go into the AI prompt, and the prompt is the replay key.
 * The key must come out the same under Node (the record script) and workerd (the Worker), so
 * nothing here depends on how a locale renders text; only `formatToParts` numbers are used.
 */
import { CLUB_TIME_ZONE } from "@/demo/riverbend";

export function formatUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${dollars}.${(abs % 100).toString().padStart(2, "0")}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: CLUB_TIME_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

export interface ClubDate {
  /** "2026-11-02" */
  iso: string;
  /** "Monday, November 2, 2026" */
  long: string;
  /** "Nov 2" */
  short: string;
}

/** The calendar date of an ISO timestamp in the club's time zone; null if it can't be read. */
export function clubDate(timestamp: string): ClubDate | null {
  const ms = Date.parse(timestamp);
  if (!Number.isFinite(ms)) return null;
  const parts = Object.fromEntries(partsFormatter.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const monthName = MONTHS[month - 1] ?? "";
  return {
    iso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    long: `${WEEKDAYS[weekday]}, ${monthName} ${day}, ${year}`,
    short: `${monthName.slice(0, 3)} ${day}`,
  };
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** The first `max` words; a cut sentence ends with a full stop. */
export function capWords(text: string, max: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= max) return words.join(" ");
  return `${words.slice(0, max).join(" ").replace(/[,;:]$/, "")}.`;
}
