/**
 * POST /api/judge/reset: judge mode's "Start over" (a fresh judge session, so the board opens from
 * the seed again). Glue only: `handleJudgeReset` (src/judge/reset-handler.ts) documents the
 * statuses; `resetDepsFromWorker` (src/judge/reset-deps.ts) builds its deps.
 */
import { resetDepsFromWorker } from "@/judge/reset-deps";
import { handleJudgeReset } from "@/judge/reset-handler";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleJudgeReset(request, resetDepsFromWorker());
}
