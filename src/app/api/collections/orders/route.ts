/**
 * POST /api/collections/orders: CreateOrderBody -> 201 { orderId }. Glue only: the checks, the
 * pricing, the PayPal call and the ledger append are `handleCreateOrder`
 * (src/collections/create-order.ts), which documents the statuses; the env, the ledger store and
 * the PayPal client come from src/collections/wiring.ts.
 */
import { handleCreateOrder } from "@/collections/create-order";
import { collectionsDeps } from "@/collections/wiring";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleCreateOrder(request, collectionsDeps());
}
