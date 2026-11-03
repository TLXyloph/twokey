/**
 * POST /api/ai/session: issues the demo browser's judge-session cookie, which /api/ai/turn
 * requires. Glue only; `handleSessionRequest` (src/agents/llm/session-handler.ts) documents the
 * statuses. The AI adapter (src/agents/studio/claude-adapter.ts) calls it before its first turn.
 *
 * A route handler, not proxy.ts: it needs no change to the /demo page, runs on the same Node
 * runtime as the other routes, and OpenNext's support for Node-runtime proxy on Workers is not
 * something this project has verified. Strings come from `process.env` (see the turn route).
 */
import { handleSessionRequest } from "@/agents/llm/session-handler";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleSessionRequest(request, {
    env: { TWOKEY_SESSION_SECRET: process.env.TWOKEY_SESSION_SECRET, TWOKEY_SITE_ORIGIN: process.env.TWOKEY_SITE_ORIGIN },
    development: process.env.NODE_ENV === "development",
  });
}
