/**
 * POST /api/collections/orders/:orderId/capture: { method? } -> 200 CaptureResult. Glue only:
 * `handleCaptureOrder` (src/collections/capture-order.ts) checks the session owns the order,
 * captures it and records `payment.captured`, and documents the statuses.
 */
import { handleCaptureOrder } from "@/collections/capture-order";
import { collectionsDeps } from "@/collections/wiring";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }): Promise<Response> {
  const { orderId } = await context.params;
  return handleCaptureOrder(request, orderId, collectionsDeps());
}
