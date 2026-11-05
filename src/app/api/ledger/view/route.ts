/**
 * GET /api/ledger/view: the judge session's BoardView (the seed folded with its ledger events).
 * Glue only: `handleLedgerView` (src/ledger/api/ledger-handlers.ts) documents the statuses, and
 * `judgeDepsFromWorker` (src/disbursements/api/worker-deps.ts) reads the Worker's env and D1.
 */
import { judgeDepsFromWorker } from "@/disbursements/api/worker-deps";
import { handleLedgerView } from "@/ledger/api/ledger-handlers";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleLedgerView(request, judgeDepsFromWorker());
}
