/**
 * Fixtures for the judge routes' handlers: deps over the real in-memory ledger and real throwaway
 * demo keys, with the RiskAssessor, PayPal and the clock mocked; a real signed session cookie;
 * and request builders. Every secret here is fictional.
 */
import { issueSession } from "@/agents/llm/judge-session";
import type { RiskCard } from "@/ledger/contracts";
import { createInMemoryLedgerTable, type InMemoryLedgerTable } from "@/ledger/ledger-table";
import type { JudgeApiDeps } from "@/disbursements/api/judge-context";
import { steppingClock, T0 } from "../../ledger/fixtures";
import { sharedTestDemoKeys, type TestDemoKeys } from "../demo-keys";
import { mockPaypal, mockRisk } from "../harness";

export const SITE = "https://twokey.afterscroll.workers.dev";
export const SECRET = "test-session-secret-not-real-0123456789abcdef";

export interface JudgeFixture {
  deps: JudgeApiDeps;
  table: InMemoryLedgerTable;
  keys: TestDemoKeys;
  risk: ReturnType<typeof mockRisk>;
  paypal: ReturnType<typeof mockPaypal>;
  lines: string[];
  cookie: string;
  sessionId: string;
}

export async function judgeFixture(over: Partial<JudgeApiDeps> & { ai?: RiskCard | null; sessionByte?: number } = {}): Promise<JudgeFixture> {
  const keys = await sharedTestDemoKeys();
  const table = createInMemoryLedgerTable();
  const risk = mockRisk(over.ai ?? null);
  const paypal = mockPaypal();
  const lines: string[] = [];
  const { session, setCookie } = await issueSession(SECRET, T0 - 60_000, (n) => new Uint8Array(n).fill(over.sessionByte ?? 7));
  let id = 0;
  const deps: JudgeApiDeps = {
    env: { TWOKEY_SESSION_SECRET: SECRET, TWOKEY_SITE_ORIGIN: SITE, ...keys.env },
    development: false,
    table,
    risk: risk.assessor,
    paypal: paypal.client,
    publicKeys: keys.publicKeys,
    now: steppingClock(),
    newId: () => `R-${++id}`,
    log: (line) => lines.push(line),
    ...over,
  };
  return { deps, table, keys, risk, paypal, lines, cookie: setCookie.split(";")[0]!, sessionId: session.id };
}

export function post(path: string, body: unknown, cookie: string | null, headers: Record<string, string> = {}): Request {
  const init: RequestInit = {
    method: "POST",
    headers: { origin: SITE, "sec-fetch-site": "same-origin", "content-type": "application/json", ...(cookie && { cookie }), ...headers },
    ...(body !== undefined && { body: typeof body === "string" ? body : JSON.stringify(body) }),
  };
  return new Request(`${SITE}${path}`, init);
}

export const get = (path: string, cookie: string | null): Request =>
  new Request(`${SITE}${path}`, { headers: { "sec-fetch-site": "same-origin", ...(cookie && { cookie }) } });

export const errorOf = async (response: Response) => ((await response.json()) as { error: { code: string; message: string } }).error;
