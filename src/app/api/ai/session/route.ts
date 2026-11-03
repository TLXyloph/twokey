/**
 * POST /api/ai/session: issues the demo browser's judge-session cookie, which /api/ai/turn
 * requires, at most TWOKEY_AI_SESSIONS_PER_IP_PER_HOUR new sessions per client IP. Glue only;
 * `handleSessionRequest` (src/agents/llm/session-handler.ts) documents the statuses. The AI
 * adapter (src/agents/studio/claude-adapter.ts) calls it when a turn is answered 401.
 *
 * A route handler, not proxy.ts: it needs no change to the /demo page, runs on the same Node
 * runtime as the other routes, and OpenNext's support for Node-runtime proxy on Workers is not
 * something this project has verified. Strings come from `process.env` (see the turn route); the
 * issuance log is D1, or in memory under plain `next dev` only.
 */
import { createD1SessionIssuanceLog } from "@/agents/llm/d1-session-issuance-log";
import { handleSessionRequest } from "@/agents/llm/session-handler";
import { createInMemorySessionIssuanceLog, type SessionIssuanceLog } from "@/agents/llm/session-issuance-log";
import { workerContext } from "@/platform/worker-context";

export const runtime = "nodejs";

let devIssuances: SessionIssuanceLog | undefined;

export async function POST(request: Request): Promise<Response> {
  const { env } = workerContext();
  const development = process.env.NODE_ENV === "development";
  const issuances = env.DB
    ? createD1SessionIssuanceLog(env.DB)
    : development
      ? (devIssuances ??= createInMemorySessionIssuanceLog())
      : undefined;
  return handleSessionRequest(request, {
    env: {
      TWOKEY_SESSION_SECRET: process.env.TWOKEY_SESSION_SECRET,
      TWOKEY_SITE_ORIGIN: process.env.TWOKEY_SITE_ORIGIN,
      TWOKEY_AI_SESSIONS_PER_IP_PER_HOUR: process.env.TWOKEY_AI_SESSIONS_PER_IP_PER_HOUR,
    },
    development,
    issuances,
  });
}
