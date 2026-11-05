/**
 * POST /api/payouts/requests/:id/sign: an officer adds their key; key 2 runs the executor.
 * Glue only: `handleSignPayout` (src/disbursements/api/payout-handlers.ts) documents the statuses.
 */
import { handleSignPayout } from "@/disbursements/api/payout-handlers";
import { judgeDepsFromWorker } from "@/disbursements/api/worker-deps";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  return handleSignPayout(request, id, judgeDepsFromWorker());
}
