/**
 * POST /api/payouts/requests: a judge's own payout request (key 1 is the request itself).
 * Glue only: `handleCreatePayoutRequest` (src/disbursements/api/payout-handlers.ts) documents the
 * statuses.
 */
import { handleCreatePayoutRequest } from "@/disbursements/api/payout-handlers";
import { judgeDepsFromWorker } from "@/disbursements/api/worker-deps";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleCreatePayoutRequest(request, judgeDepsFromWorker());
}
