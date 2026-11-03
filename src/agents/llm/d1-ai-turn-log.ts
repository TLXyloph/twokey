/**
 * The AI turn log and the recordings store on D1 (schema: config/d1/migrations/0002_ai_turns.sql).
 * Same semantics as the in-memory store in ./ai-turn-log.ts; the shared contract test runs both.
 *
 * The reservation is one `INSERT ... SELECT ... WHERE <every limit holds>` statement. D1 runs a
 * database's statements one at a time, and SQLite runs each statement atomically, so the check and
 * the append cannot interleave with another turn's. When the insert changes no row, a second query
 * reads which limit refused it (rate first, then the session's share, then the total); if none
 * does any more (a turn settled in between), the refusal is reported as the total budget, which
 * errs on the side of not spending.
 */
import type { D1DatabaseLike, D1PreparedStatementLike, D1Value } from "@/platform/cloudflare-env";
import type { AiTurnLog, AiTurnStore, ReserveOutcome, TurnRecording, TurnRecordingStore } from "./ai-turn-log";

/** Spend: settled turns at their cost, plus reservations that have no settlement yet. */
const committedSql = (sessionParam?: string) => `(
  SELECT COALESCE(SUM(e.cost_micro_usd), 0) FROM ai_turn_events e
  WHERE ${sessionParam ? `e.session_id = ${sessionParam} AND ` : ""}(
    e.kind = 'settled'
    OR (e.kind = 'reserved' AND NOT EXISTS (
      SELECT 1 FROM ai_turn_events s WHERE s.turn_id = e.turn_id AND s.kind = 'settled'
    ))
  )
)`;

/** Rate: reserved and replayed turns the session started after the window's start. */
const recentSql = (sessionParam: string, sinceParam: string) => `(
  SELECT COUNT(*) FROM ai_turn_events
  WHERE session_id = ${sessionParam} AND kind IN ('reserved', 'replayed') AND occurred_at > ${sinceParam}
)`;

// ?1 turn ?2 session ?3 at ?4 model ?5 hash ?6 cost ?7 window start ?8 rate limit ?9 session budget ?10 total budget
export const RESERVE_TURN_SQL = `INSERT INTO ai_turn_events (turn_id, kind, session_id, occurred_at, model, request_hash, cost_micro_usd)
SELECT ?1, 'reserved', ?2, ?3, ?4, ?5, ?6
WHERE ${recentSql("?2", "?7")} < ?8
  AND ${committedSql("?2")} + ?6 <= ?9
  AND ${committedSql()} + ?6 <= ?10`;

// ?1 session ?2 window start
export const TURN_STATUS_SQL = `SELECT ${recentSql("?1", "?2")} AS recent, ${committedSql("?1")} AS session_committed, ${committedSql()} AS total_committed`;

export const SETTLE_TURN_SQL =
  "INSERT INTO ai_turn_events (turn_id, kind, session_id, occurred_at, model, cost_micro_usd, outcome, " +
  "input_tokens, output_tokens, cache_read_tokens, cache_write_tokens) " +
  "VALUES (?, 'settled', ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (turn_id, kind) DO NOTHING";

export const RECORD_REPLAY_SQL =
  "INSERT INTO ai_turn_events (turn_id, kind, session_id, occurred_at, request_hash, outcome) VALUES (?, 'replayed', ?, ?, ?, ?)";

export const COUNT_RECENT_SQL = `SELECT ${recentSql("?1", "?2")} AS n`;
export const COMMITTED_TOTAL_SQL = `SELECT ${committedSql()} AS n`;
export const COMMITTED_SESSION_SQL = `SELECT ${committedSql("?1")} AS n`;

export const FIND_RECORDING_SQL =
  "SELECT request_hash, turn_id, model, recorded_at, ndjson FROM ai_turn_recordings WHERE request_hash = ?1";
export const SAVE_RECORDING_SQL =
  "INSERT INTO ai_turn_recordings (request_hash, turn_id, model, recorded_at, ndjson) VALUES (?, ?, ?, ?, ?) " +
  "ON CONFLICT (request_hash) DO NOTHING";

async function rows<Row>(statement: D1PreparedStatementLike): Promise<Row[]> {
  if (!statement.all) throw new Error("D1 statement has no all(): cannot read rows");
  const { results } = await statement.all<Row>();
  if (!Array.isArray(results)) throw new Error("D1 all() returned no results array");
  return results;
}

async function single(db: D1DatabaseLike, sql: string, ...values: D1Value[]): Promise<number> {
  const [row] = await rows<{ n: unknown }>(db.prepare(sql).bind(...values));
  const n = Number(row?.n);
  if (!Number.isFinite(n)) throw new Error("D1 aggregate returned no number");
  return n;
}

function oneChange(changes: number, what: string): void {
  if (changes !== 1) throw new Error(`${what}: unexpected change count ${String(changes)}`);
}

export function createD1AiTurnLog(db: D1DatabaseLike): AiTurnLog {
  return {
    async reserve(reservation, limits) {
      const windowStart = reservation.at - limits.windowMs;
      const { meta } = await db
        .prepare(RESERVE_TURN_SQL)
        .bind(
          reservation.turnId,
          reservation.sessionId,
          reservation.at,
          reservation.model,
          reservation.requestHash,
          reservation.costMicroUsd,
          windowStart,
          limits.sessionTurnsPerWindow,
          limits.sessionBudgetMicroUsd,
          limits.totalBudgetMicroUsd,
        )
        .run();
      if (meta.changes === 1) return "reserved";
      if (meta.changes !== 0) throw new Error(`ai_turn_events reserve: unexpected change count ${String(meta.changes)}`);
      const [status] = await rows<{ recent: unknown; session_committed: unknown; total_committed: unknown }>(
        db.prepare(TURN_STATUS_SQL).bind(reservation.sessionId, windowStart),
      );
      const outcome: ReserveOutcome =
        Number(status?.recent) >= limits.sessionTurnsPerWindow
          ? "rate_limited"
          : Number(status?.session_committed) + reservation.costMicroUsd > limits.sessionBudgetMicroUsd
            ? "session_budget"
            : "total_budget";
      return outcome;
    },
    async settle(settlement) {
      const { usage } = settlement;
      const { meta } = await db
        .prepare(SETTLE_TURN_SQL)
        .bind(
          settlement.turnId,
          settlement.sessionId,
          settlement.at,
          settlement.model,
          settlement.costMicroUsd,
          settlement.outcome,
          usage.inputTokens,
          usage.outputTokens,
          usage.cacheReadTokens,
          usage.cacheWriteTokens,
        )
        .run();
      if (meta.changes !== 0 && meta.changes !== 1) throw new Error(`ai_turn_events settle: unexpected change count ${String(meta.changes)}`);
    },
    async recordReplay(note) {
      const { meta } = await db
        .prepare(RECORD_REPLAY_SQL)
        .bind(note.turnId, note.sessionId, note.at, note.requestHash, note.outcome)
        .run();
      oneChange(meta.changes, "ai_turn_events replay");
    },
    countRecentTurns: (sessionId, sinceMs) => single(db, COUNT_RECENT_SQL, sessionId, sinceMs),
    committedMicroUsd: (sessionId) =>
      sessionId === undefined ? single(db, COMMITTED_TOTAL_SQL) : single(db, COMMITTED_SESSION_SQL, sessionId),
  };
}

type RecordingRow = { request_hash: string; turn_id: string; model: string; recorded_at: number; ndjson: string };

export function createD1RecordingStore(db: D1DatabaseLike): TurnRecordingStore {
  return {
    async find(requestHash) {
      const [row] = await rows<RecordingRow>(db.prepare(FIND_RECORDING_SQL).bind(requestHash));
      if (!row) return undefined;
      const recording: TurnRecording = {
        requestHash: String(row.request_hash),
        turnId: String(row.turn_id),
        model: String(row.model),
        recordedAt: Number(row.recorded_at),
        ndjson: String(row.ndjson),
      };
      return recording;
    },
    async save(recording) {
      const { meta } = await db
        .prepare(SAVE_RECORDING_SQL)
        .bind(recording.requestHash, recording.turnId, recording.model, recording.recordedAt, recording.ndjson)
        .run();
      if (meta.changes === 1) return "stored";
      if (meta.changes === 0) return "duplicate";
      throw new Error(`ai_turn_recordings insert: unexpected change count ${String(meta.changes)}`);
    },
  };
}

export function createD1AiTurnStore(db: D1DatabaseLike): AiTurnStore {
  return { turnLog: createD1AiTurnLog(db), recordings: createD1RecordingStore(db) };
}
