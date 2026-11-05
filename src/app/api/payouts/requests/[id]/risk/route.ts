/**
 * POST /api/payouts/requests/:id/risk: runs the AI receipt read once; later calls return the
 * stored card. Glue only: `handleRiskRead` (src/disbursements/api/payout-handlers.ts) documents the
 * statuses.
 */
import { handleRiskRead } from "@/disbursements/api/payout-handlers";
import { judgeDepsFromWorker } from "@/disbursements/api/worker-deps";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  return handleRiskRead(request, id, judgeDepsFromWorker());
}
