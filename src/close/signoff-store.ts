/**
 * Where the Reviewer's sign-offs live: one per judge session and month, append-only. On the Worker
 * it is D1 (schema: config/d1/migrations/0005_close_signoffs.sql); under plain `next dev` with no D1,
 * and in tests, it is memory.
 *
 * Inserts never overwrite: a second sign-off for the same session and month is a "duplicate", and
 * the caller answers with the stored one.
 */
import type { D1DatabaseLike, D1Value } from "@/platform/cloudflare-env";
import type { CloseMonth } from "./contracts";

export interface StoredSignoff {
  sessionId: string;
  month: CloseMonth;
  closeHash: string;
  role: "reviewer";
  keyId: string;
  /** base64url. */
  signature: string;
  signedAt: string;
}

export interface CloseSignoffStore {
  find(sessionId: string, month: CloseMonth): Promise<StoredSignoff | null>;
  insert(signoff: StoredSignoff): Promise<"stored" | "duplicate">;
}

const key = (sessionId: string, month: string) => `${sessionId}\n${month}`;

export function createInMemorySignoffStore(): CloseSignoffStore & { all(): StoredSignoff[] } {
  const rows = new Map<string, StoredSignoff>();
  return {
    async find(sessionId, month) {
      const row = rows.get(key(sessionId, month));
      return row ? { ...row } : null;
    },
    async insert(signoff) {
      const id = key(signoff.sessionId, signoff.month);
      if (rows.has(id)) return "duplicate";
      rows.set(id, { ...signoff });
      return "stored";
    },
    all: () => [...rows.values()].map((row) => ({ ...row })),
  };
}

const COLUMNS = "session_id, month, close_hash, role, key_id, signature, signed_at";
export const INSERT_SIGNOFF_SQL = `INSERT INTO close_signoffs (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (session_id, month) DO NOTHING`;
export const FIND_SIGNOFF_SQL = `SELECT ${COLUMNS} FROM close_signoffs WHERE session_id = ? AND month = ? LIMIT 1`;

interface SignoffRow {
  session_id: string;
  month: string;
  close_hash: string;
  role: string;
  key_id: string;
  signature: string;
  signed_at: string;
}

export function createD1SignoffStore(db: D1DatabaseLike): CloseSignoffStore {
  return {
    async find(sessionId, month) {
      const statement = db.prepare(FIND_SIGNOFF_SQL).bind(sessionId, month);
      if (!statement.all) throw new Error("D1 statement has no all(): cannot read rows");
      const { results } = await statement.all<SignoffRow>();
      if (!Array.isArray(results)) throw new Error("D1 all() returned no results array");
      const row = results[0];
      if (!row) return null;
      if (row.role !== "reviewer" || row.month !== month) throw new Error("close_signoffs row has an unexpected role or month");
      return { sessionId: row.session_id, month, closeHash: row.close_hash, role: "reviewer", keyId: row.key_id, signature: row.signature, signedAt: row.signed_at };
    },
    async insert(signoff) {
      const values: D1Value[] = [signoff.sessionId, signoff.month, signoff.closeHash, signoff.role, signoff.keyId, signoff.signature, signoff.signedAt];
      const { meta } = await db.prepare(INSERT_SIGNOFF_SQL).bind(...values).run();
      return meta.changes === 1 ? "stored" : "duplicate";
    },
  };
}
