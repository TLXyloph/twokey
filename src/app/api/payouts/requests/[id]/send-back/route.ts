/**
 * POST /api/payouts/requests/:id/send-back: an officer who could add key 2 sends the payout back,
 * with a reason. Glue only: `handleSendBack` (src/disbursements/api/payout-handlers.ts) documents
 * the statuses.
 */
import { handleSendBack } from "@/disbursements/api/payout-handlers";
import { judgeDepsFromWorker } from "@/disbursements/api/worker-deps";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  return handleSendBack(request, id, judgeDepsFromWorker());
}
