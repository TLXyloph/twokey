/**
 * The judge-session issuance log on D1 (table `ai_session_issuances`, in
 * config/d1/migrations/0002_ai_turns.sql). Same semantics as the in-memory log in
 * ./session-issuance-log.ts; the shared contract test runs both.
 *
 * The cap check and the append are one `INSERT ... SELECT ... WHERE` statement. D1 runs a
 * database's statements one at a time and SQLite runs each one atomically, so two isolates racing
 * for an IP's last slot cannot both get it.
 */
import type { D1DatabaseLike } from "@/platform/cloudflare-env";
import type { SessionIssuanceLog } from "./session-issuance-log";

// ?1 session ?2 ip hmac ?3 at ?4 window start ?5 cap
export const ISSUE_SESSION_SQL = `INSERT INTO ai_session_issuances (session_id, ip_hmac, issued_at)
SELECT ?1, ?2, ?3
WHERE (
  SELECT COUNT(*) FROM ai_session_issuances WHERE ip_hmac = ?2 AND issued_at > ?4
) < ?5`;

export function createD1SessionIssuanceLog(db: D1DatabaseLike): SessionIssuanceLog {
  return {
    async issue(issuance, limit) {
      const { meta } = await db
        .prepare(ISSUE_SESSION_SQL)
        .bind(issuance.sessionId, issuance.ipHmac, issuance.at, issuance.at - limit.windowMs, limit.perWindow)
        .run();
      if (meta.changes === 1) return "issued";
      if (meta.changes === 0) return "ip_limited";
      throw new Error(`ai_session_issuances insert: unexpected change count ${String(meta.changes)}`);
    },
  };
}
