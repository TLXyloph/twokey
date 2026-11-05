/**
 * The Watchtower store on D1 (schema: config/d1/migrations/0004_watchtower.sql). Findings are
 * `INSERT ... ON CONFLICT DO NOTHING` on the transaction id, so two runs at once store each
 * finding once; the triggers refuse every UPDATE and DELETE.
 */
import type { D1DatabaseLike, D1Value } from "@/platform/cloudflare-env";
import type { FindingKind } from "./contracts";
import type { RunOutcome, RunRecord, StoredFinding, WatchtowerStore } from "./store";

export const MAX_FINDINGS_READ = 500;

const FINDING_COLUMNS =
  "transaction_id, kind, event_code, label, amount_cents, counterparty, counterparty_is_officer, at, first_seen_at, " +
  "reported_after_minutes, funded_by_bank, explanation, custom_field, backfill, run_id";
const RUN_COLUMNS = "run_id, started_at, finished_at, outcome, paypal_as_of, rows_seen, new_findings, detail";

export const INSERT_FINDING_SQL =
  `INSERT INTO watchtower_findings (${FINDING_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ` +
  "ON CONFLICT (transaction_id) DO NOTHING";
export const INSERT_RUN_SQL = `INSERT INTO watchtower_runs (${RUN_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
export const FINDINGS_SQL = `SELECT ${FINDING_COLUMNS} FROM watchtower_findings ORDER BY at DESC, transaction_id DESC LIMIT ${MAX_FINDINGS_READ}`;
export const FINDING_IDS_SQL = "SELECT transaction_id FROM watchtower_findings";
export const LATEST_RUN_SQL = `SELECT ${RUN_COLUMNS} FROM watchtower_runs ORDER BY finished_at DESC, run_id DESC LIMIT 1`;
export const LATEST_OK_RUN_SQL = `SELECT ${RUN_COLUMNS} FROM watchtower_runs WHERE outcome = 'ok' ORDER BY finished_at DESC, run_id DESC LIMIT 1`;

interface FindingRow {
  transaction_id: string;
  kind: string;
  event_code: string;
  label: string;
  amount_cents: number;
  counterparty: string | null;
  counterparty_is_officer: number;
  at: string;
  first_seen_at: string;
  reported_after_minutes: number | null;
  funded_by_bank: number;
  explanation: string | null;
  custom_field: string | null;
  backfill: number;
  run_id: string;
}

interface RunRow {
  run_id: string;
  started_at: string;
  finished_at: string;
  outcome: string;
  paypal_as_of: string | null;
  rows_seen: number;
  new_findings: number;
  detail: string | null;
}

async function rows<Row>(db: D1DatabaseLike, sql: string, ...values: D1Value[]): Promise<Row[]> {
  const statement = db.prepare(sql).bind(...values);
  if (!statement.all) throw new Error("D1 statement has no all(): cannot read rows");
  const { results } = await statement.all<Row>();
  if (!Array.isArray(results)) throw new Error("D1 all() returned no results array");
  return results;
}

const flag = (value: boolean): number => (value ? 1 : 0);
const nullableNumber = (value: number | null): number | null => (value === null ? null : Number(value));

const toFinding = (row: FindingRow): StoredFinding => ({
  transactionId: row.transaction_id,
  kind: row.kind as FindingKind,
  eventCode: row.event_code,
  label: row.label,
  amountCents: Number(row.amount_cents),
  counterparty: row.counterparty,
  counterpartyIsOfficer: Number(row.counterparty_is_officer) === 1,
  at: row.at,
  firstSeenAt: row.first_seen_at,
  reportedAfterMinutes: nullableNumber(row.reported_after_minutes),
  fundedByBank: Number(row.funded_by_bank) === 1,
  explanation: row.explanation,
  customField: row.custom_field,
  backfill: Number(row.backfill) === 1,
  runId: row.run_id,
});

const toRun = (row: RunRow): RunRecord => ({
  runId: row.run_id,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  outcome: row.outcome as RunOutcome,
  paypalAsOf: row.paypal_as_of,
  rowsSeen: Number(row.rows_seen),
  newFindings: Number(row.new_findings),
  detail: row.detail,
});

export function createD1WatchtowerStore(db: D1DatabaseLike): WatchtowerStore {
  const latest = async (sql: string) => {
    const [row] = await rows<RunRow>(db, sql);
    return row ? toRun(row) : null;
  };
  return {
    async hasSuccessfulRun() {
      return (await latest(LATEST_OK_RUN_SQL)) !== null;
    },
    async findingIds() {
      return new Set((await rows<{ transaction_id: string }>(db, FINDING_IDS_SQL)).map((row) => row.transaction_id));
    },
    async insertFinding(f) {
      const result = await db
        .prepare(INSERT_FINDING_SQL)
        .bind(
          f.transactionId,
          f.kind,
          f.eventCode,
          f.label,
          f.amountCents,
          f.counterparty,
          flag(f.counterpartyIsOfficer),
          f.at,
          f.firstSeenAt,
          f.reportedAfterMinutes,
          flag(f.fundedByBank),
          f.explanation,
          f.customField,
          flag(f.backfill),
          f.runId,
        )
        .run();
      const changes = result.meta.changes;
      if (changes === 1) return true;
      if (changes === 0) return false;
      throw new Error(`watchtower_findings insert: unexpected change count ${String(changes)}`);
    },
    async appendRun(r) {
      await db
        .prepare(INSERT_RUN_SQL)
        .bind(r.runId, r.startedAt, r.finishedAt, r.outcome, r.paypalAsOf, r.rowsSeen, r.newFindings, r.detail)
        .run();
    },
    latestRun: () => latest(LATEST_RUN_SQL),
    latestSuccessfulRun: () => latest(LATEST_OK_RUN_SQL),
    async findings() {
      return (await rows<FindingRow>(db, FINDINGS_SQL)).map(toFinding);
    },
  };
}
