/**
 * PayPal Transaction Search (sandbox) for the Watchtower: `GET /v1/reporting/transactions` with
 * `fields=all` and `page_size=500`, every page, in windows of at most 31 days (PayPal's limit)
 * from WATCH_FROM to now. Rows are parsed with zod for only the fields the Watchtower uses.
 *
 * Failures are a `TransactionSearchError` with a kind, an HTTP status and a fixed code, never a
 * response body or a token:
 *   token or search answered 401/403   -> no_access     (credentials revoked or rotated)
 *   any other status, no response, an unreadable body or too many pages -> paypal_error
 * A single row it can't read is counted (`unreadable`), never guessed at.
 */
import { z } from "zod";
import { decimalToCents } from "./balances";
import { PaypalApiError, type PaypalClient } from "./client";

export const TRANSACTIONS_PATH = "/v1/reporting/transactions";
export const PAGE_SIZE = 500;
export const MAX_WINDOW_DAYS = 31;
/** 10,000 rows a window; past that the search fails rather than silently stopping. */
export const MAX_PAGES_PER_WINDOW = 20;

const DAY_MS = 86_400_000;

export interface TransactionRow {
  transactionId: string;
  /** PayPal's event code, e.g. "T0000". */
  eventCode: string;
  /** Signed cents: negative when money left the account. */
  amountCents: number;
  /** Signed cents of the row's own fee (a payout carries its $0.25 here); 0 when none. */
  feeCents: number;
  currency: string;
  /** When PayPal says the money moved (ISO, UTC, second precision). */
  initiatedAt: string;
  /** "S" success, "P" pending, "D" denied, "V" reversed, "F" partially refunded. */
  status: string | null;
  /** `paypal_reference_id`: for a T03xx funding row, the debit it covered. */
  referenceId: string | null;
  /** `custom_field`: on a payout, the `sender_item_id` (TwoKey's request id). */
  customField: string | null;
  /** The other party's email as PayPal reports it. Never logged or stored in full. */
  counterpartyEmail: string | null;
}

export type SearchFailureKind = "no_access" | "paypal_error";

export class TransactionSearchError extends Error {
  readonly kind: SearchFailureKind;
  /** The HTTP status, or 0 when no response arrived. */
  readonly status: number;
  /** A fixed code for logs and the run record, e.g. "search_http_500". */
  readonly code: string;

  constructor(kind: SearchFailureKind, status: number, code: string) {
    super(`PayPal transaction search failed: ${code}`);
    this.name = "TransactionSearchError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

export interface TransactionSearchResult {
  /** Every row once (by transaction id), in PayPal's order. */
  rows: TransactionRow[];
  /** PayPal's newest `last_refreshed_datetime` across the responses, or null. */
  lastRefreshed: string | null;
  /** Rows PayPal sent that couldn't be read. */
  unreadable: number;
}

export interface SearchWindow {
  start: string;
  end: string;
}

/** ISO 8601 in UTC with second precision, the form PayPal's search takes. */
const isoSeconds = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** Contiguous windows [start, end] of at most 31 days from `fromIso` to `now`. */
export function searchWindows(fromIso: string, now: Date): SearchWindow[] {
  const windows: SearchWindow[] = [];
  const nowMs = Math.floor(now.getTime() / 1000) * 1000;
  for (let start = Date.parse(fromIso); start <= nowMs; start += MAX_WINDOW_DAYS * DAY_MS) {
    const end = Math.min(start + MAX_WINDOW_DAYS * DAY_MS - 1000, nowMs);
    windows.push({ start: isoSeconds(start), end: isoSeconds(end) });
  }
  return windows;
}

/** "2026-11-03T04:13:48+0000" or "...Z" -> "2026-11-03T04:13:48Z"; null when unreadable. */
function utcSeconds(text: string): string | null {
  const ms = Date.parse(text.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isFinite(ms) ? isoSeconds(ms) : null;
}

const optionalText = (max: number) => z.string().min(1).max(max).optional();
const moneySchema = z.object({ value: z.string(), currency_code: z.string().min(3).max(3) });

const detailSchema = z.object({
  transaction_info: z.object({
    transaction_id: z.string().min(1).max(64),
    transaction_event_code: z.string().regex(/^T\d{4}$/),
    transaction_amount: moneySchema,
    fee_amount: moneySchema.optional(),
    transaction_initiation_date: z.string().max(40),
    transaction_status: optionalText(8),
    paypal_reference_id: optionalText(64),
    custom_field: optionalText(255),
  }),
  payer_info: z.object({ email_address: optionalText(254) }).optional(),
});

const pageSchema = z.object({
  transaction_details: z.array(z.unknown()).default([]),
  total_pages: z.number().int().nonnegative().optional(),
  last_refreshed_datetime: z.string().max(40).optional(),
});

function parseRow(raw: unknown): TransactionRow | null {
  const parsed = detailSchema.safeParse(raw);
  if (!parsed.success) return null;
  const info = parsed.data.transaction_info;
  const amountCents = decimalToCents(info.transaction_amount.value);
  const feeCents = info.fee_amount ? decimalToCents(info.fee_amount.value) : 0;
  const initiatedAt = utcSeconds(info.transaction_initiation_date);
  if (amountCents === null || feeCents === null || initiatedAt === null) return null;
  return {
    transactionId: info.transaction_id,
    eventCode: info.transaction_event_code,
    amountCents,
    feeCents,
    currency: info.transaction_amount.currency_code,
    initiatedAt,
    status: info.transaction_status ?? null,
    referenceId: info.paypal_reference_id ?? null,
    customField: info.custom_field ?? null,
    counterpartyEmail: parsed.data.payer_info?.email_address ?? null,
  };
}

export interface SearchPage {
  rows: TransactionRow[];
  unreadable: number;
  totalPages: number;
  lastRefreshed: string | null;
}

/** One response of the search; null when the body isn't a search page at all. */
export function parseSearchPage(body: unknown): SearchPage | null {
  const parsed = pageSchema.safeParse(body);
  // An empty window may come without `transaction_details`; PayPal's "as of" time still marks it a search page.
  const isPage = typeof body === "object" && body !== null && ("transaction_details" in body || "last_refreshed_datetime" in body);
  if (!parsed.success || !isPage) return null;
  const rows: TransactionRow[] = [];
  let unreadable = 0;
  for (const raw of parsed.data.transaction_details) {
    const row = parseRow(raw);
    if (row) rows.push(row);
    else unreadable += 1;
  }
  const refreshed = parsed.data.last_refreshed_datetime;
  return { rows, unreadable, totalPages: parsed.data.total_pages ?? 1, lastRefreshed: refreshed ? utcSeconds(refreshed) : null };
}

const isAuthFailure = (status: number) => status === 401 || status === 403;

async function fetchPage(client: PaypalClient, window: SearchWindow, page: number): Promise<SearchPage> {
  const query = new URLSearchParams({
    start_date: window.start,
    end_date: window.end,
    fields: "all",
    page_size: String(PAGE_SIZE),
    page: String(page),
  });
  let response;
  try {
    response = await client.getJson(`${TRANSACTIONS_PATH}?${query.toString()}`, "transaction_search");
  } catch (error) {
    const status = error instanceof PaypalApiError ? error.status : 0;
    const operation = error instanceof PaypalApiError && error.operation === "token" ? "token" : "search";
    if (status === 0) throw new TransactionSearchError("paypal_error", 0, "no_response");
    throw new TransactionSearchError(isAuthFailure(status) ? "no_access" : "paypal_error", status, `${operation}_http_${status}`);
  }
  if (response.status !== 200) {
    throw new TransactionSearchError(isAuthFailure(response.status) ? "no_access" : "paypal_error", response.status, `search_http_${response.status}`);
  }
  const parsed = parseSearchPage(response.body);
  if (!parsed) throw new TransactionSearchError("paypal_error", 200, "unreadable_response");
  return parsed;
}

const later = (a: string | null, b: string | null): string | null => (a === null ? b : b === null ? a : a > b ? a : b);

/** Every row from `from` to `now`. Throws `TransactionSearchError` on any failure (never partial). */
export async function searchTransactions(client: PaypalClient, options: { from: string; now: Date }): Promise<TransactionSearchResult> {
  const byId = new Map<string, TransactionRow>();
  let lastRefreshed: string | null = null;
  let unreadable = 0;
  for (const window of searchWindows(options.from, options.now)) {
    for (let page = 1, totalPages = 1; page <= totalPages; page++) {
      const result = await fetchPage(client, window, page);
      if (result.totalPages > MAX_PAGES_PER_WINDOW) throw new TransactionSearchError("paypal_error", 200, "too_many_pages");
      totalPages = result.totalPages;
      lastRefreshed = later(lastRefreshed, result.lastRefreshed);
      unreadable += result.unreadable;
      for (const row of result.rows) if (!byId.has(row.transactionId)) byId.set(row.transactionId, row);
    }
  }
  return { rows: [...byId.values()], lastRefreshed, unreadable };
}
