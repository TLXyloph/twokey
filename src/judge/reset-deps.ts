/**
 * The reset route's glue: builds `ResetHandlerDeps` from the Worker (OpenNext's Cloudflare context
 * for D1, the env for secrets and vars, falling back to `process.env`, which `next dev` fills from
 * .env). The issuance log is D1, the same table `POST /api/ai/session` writes, so a reset counts
 * against the same per-IP cap. Under plain `next dev` with no D1 binding, and only there, it is an
 * in-memory log per process (separate from the session route's own in-memory log).
 */
import { createD1SessionIssuanceLog } from "@/agents/llm/d1-session-issuance-log";
import { createInMemorySessionIssuanceLog, type SessionIssuanceLog } from "@/agents/llm/session-issuance-log";
import { workerContext } from "@/platform/worker-context";
import type { ResetHandlerDeps } from "./reset-handler";

type StringEnvName = "TWOKEY_SESSION_SECRET" | "TWOKEY_SITE_ORIGIN" | "TWOKEY_AI_SESSIONS_PER_IP_PER_HOUR";

let devIssuances: SessionIssuanceLog | undefined;

export function resetDepsFromWorker(): ResetHandlerDeps {
  const { env } = workerContext();
  const read = (name: StringEnvName): string | undefined => env[name] ?? process.env[name];
  const development = process.env.NODE_ENV === "development";
  const issuances = env.DB
    ? createD1SessionIssuanceLog(env.DB)
    : development
      ? (devIssuances ??= createInMemorySessionIssuanceLog())
      : undefined;
  return {
    env: {
      TWOKEY_SESSION_SECRET: read("TWOKEY_SESSION_SECRET"),
      TWOKEY_SITE_ORIGIN: read("TWOKEY_SITE_ORIGIN"),
      TWOKEY_AI_SESSIONS_PER_IP_PER_HOUR: read("TWOKEY_AI_SESSIONS_PER_IP_PER_HOUR"),
    },
    development,
    issuances,
  };
}
