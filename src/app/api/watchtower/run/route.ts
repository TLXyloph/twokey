/**
 * POST /api/watchtower/run: one Watchtower run, called every 10 minutes by the Cron Trigger
 * (src/platform/cron-worker.ts) with `Authorization: Bearer <TWOKEY_CRON_SECRET>`. Glue only:
 * `handleWatchtowerRun` (src/watchtower/api/handlers.ts) documents the statuses, and
 * `watchtowerRunDepsFromWorker` (src/watchtower/api/worker-deps.ts) reads the Worker's env and D1.
 */
import { handleWatchtowerRun } from "@/watchtower/api/handlers";
import { watchtowerRunDepsFromWorker } from "@/watchtower/api/worker-deps";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleWatchtowerRun(request, watchtowerRunDepsFromWorker());
}
