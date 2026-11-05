/**
 * POST /api/watchtower/replay: judge mode's "Replay an outside send" (a recorded real sandbox
 * event through the live classifier; nothing stored). Glue only: `handleWatchtowerReplay`
 * (src/watchtower/api/handlers.ts) documents the statuses.
 */
import { handleWatchtowerReplay } from "@/watchtower/api/handlers";
import { watchtowerReplayDepsFromWorker } from "@/watchtower/api/worker-deps";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleWatchtowerReplay(request, watchtowerReplayDepsFromWorker());
}
