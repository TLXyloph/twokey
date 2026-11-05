/**
 * GET /api/close?month=2026-10: the monthly close (figures, the AI's recorded draft, this session's
 * sign-off). Glue only: `handleCloseView` (src/close/api/handlers.ts) documents the statuses, and
 * `closeDepsFromWorker` (src/close/api/worker-deps.ts) reads the Worker's env and D1.
 */
import { handleCloseView } from "@/close/api/handlers";
import { closeDepsFromWorker } from "@/close/api/worker-deps";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleCloseView(request, closeDepsFromWorker());
}
