/**
 * The judge-session issuance log: one event per new session, keyed by an HMAC of the client's IP
 * (never the IP itself; see `clientIpHmac` in ./judge-session.ts). It caps how many new sessions
 * one IP can get in a rolling window, since sessions are otherwise free and each carries its own
 * share of the AI budget.
 *
 * As with the AI turn log, there is no counter: the cap is a COUNT over the window, and `issue`
 * checks it and appends the event as one atomic step. The D1 version is
 * ./d1-session-issuance-log.ts (table `ai_session_issuances`, migration 0002).
 */

export interface SessionIssuance {
  sessionId: string;
  /** HMAC-SHA256 of the client IP, hex. */
  ipHmac: string;
  /** Milliseconds since epoch. */
  at: number;
}

export interface SessionIssueLimit {
  /** New sessions allowed per IP within the window (TWOKEY_AI_SESSIONS_PER_IP_PER_HOUR). */
  perWindow: number;
  windowMs: number;
}

export type IssueOutcome = "issued" | "ip_limited";

export interface SessionIssuanceLog {
  /** Appends the issuance only if this IP's issuances within the window are still under the cap. */
  issue(issuance: SessionIssuance, limit: SessionIssueLimit): Promise<IssueOutcome>;
}

export interface InMemorySessionIssuanceLog extends SessionIssuanceLog {
  issuances(): readonly SessionIssuance[];
}

/** For tests and plain `next dev`: the same semantics as the D1 log, in memory. */
export function createInMemorySessionIssuanceLog(): InMemorySessionIssuanceLog {
  const events: Readonly<SessionIssuance>[] = [];
  return {
    async issue(issuance, limit) {
      if (events.some((event) => event.sessionId === issuance.sessionId)) throw new Error("ai_session_issuances: UNIQUE session_id");
      const since = issuance.at - limit.windowMs;
      const recent = events.filter((event) => event.ipHmac === issuance.ipHmac && event.at > since).length;
      if (recent >= limit.perWindow) return "ip_limited";
      events.push(Object.freeze({ ...issuance }));
      return "issued";
    },
    issuances: () => [...events],
  };
}
