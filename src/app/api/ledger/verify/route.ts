/**
 * GET /api/ledger/verify: re-hashes the judge session's chain and checks every signature
 * ("Show proof" links here). Glue only: `handleLedgerVerify` (src/ledger/api/ledger-handlers.ts)
 * documents the statuses.
 */
import { judgeDepsFromWorker } from "@/disbursements/api/worker-deps";
import { handleLedgerVerify } from "@/ledger/api/ledger-handlers";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleLedgerVerify(request, judgeDepsFromWorker());
}
