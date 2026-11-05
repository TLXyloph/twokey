/**
 * POST /api/close/sign: the Reviewer signs the monthly close (every other role is refused, with the
 * reason). Glue only: `handleCloseSign` (src/close/api/handlers.ts) documents the statuses.
 */
import { handleCloseSign } from "@/close/api/handlers";
import { closeDepsFromWorker } from "@/close/api/worker-deps";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleCloseSign(request, closeDepsFromWorker());
}
