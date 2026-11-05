/**
 * The payout routes' cores (route files are glue). After the shared checks (./judge-context.ts):
 *
 * POST /api/payouts/requests  CreatePayoutRequestBody
 *   body invalid                                -> 400 bad_request
 *   a parent, or the requester is the payee     -> 409 not_an_officer / payee_cannot_sign (recorded)
 *   the session already made 20 requests        -> 409 too_many_requests
 *   created (request + key 1 + rules card)      -> 201 { request: PayoutRequestView }
 *
 * POST /api/payouts/requests/:id/sign  SignBody
 *   PayPal not configured                       -> 503 paypal_unconfigured (nothing signed)
 *   body invalid                                -> 400 bad_request
 *   no such request in this session            -> 404 unknown_request
 *   a rule refuses the signer                   -> 409 <RefusalCode> (recorded as approval.refused)
 *   key 2 signed, a limit stops the payout      -> 409 <LimitCode> (recorded as payout.blocked)
 *   signed (and, for key 2, sent or failed)     -> 200 { request }
 *
 * POST /api/payouts/requests/:id/risk  {} (or no body)
 *   no such request in this session            -> 404 unknown_request
 *   the AI read ran once (or had already run)   -> 200 { request }
 *
 * A ledger failure is 500 internal. Messages are plain sentences the drawer shows as they are.
 */
import { z } from "zod";
import type { PayoutRequestView } from "@/ledger/contracts";
import { findRequest } from "@/ledger/request-projection";
import { toRequestView } from "@/ledger/request-view";
import { signPayout } from "../approve";
import { unknownRequest } from "../eligibility";
import { createPayoutRequest, createPayoutRequestSchema, MAX_SESSION_REQUESTS } from "../requests";
import { runRiskRead } from "../risk-read";
import { errorJson, internalError, json, openJudgeRequest, type JudgeApiDeps, type JudgeContext } from "./judge-context";

const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

const signBodySchema = z
  .object({
    actingAs: z.enum(["president", "treasurer", "secretary", "parent"]),
    acknowledgedFlags: z.boolean().default(false),
  })
  .strict();

const riskBodySchema = z.union([z.undefined(), z.object({}).strict()]);

function badRequest(ctx: JudgeContext, error: z.ZodError): Response {
  ctx.finish("bad_request", 400, "validation");
  const fields = [...new Set(error.issues.map((issue) => issue.path.join(".") || "body"))].join(", ");
  return errorJson(400, "bad_request", `Check these fields and try again: ${fields}.`);
}

async function viewOf(ctx: JudgeContext, requestId: string): Promise<PayoutRequestView | null> {
  const state = findRequest(await ctx.ledger.read(ctx.sessionId), requestId);
  return state ? toRequestView(state) : null;
}

const unknown = (ctx: JudgeContext): Response => {
  ctx.finish("unknown_request", 404);
  return errorJson(404, unknownRequest.code, unknownRequest.message);
};

export async function handleCreatePayoutRequest(request: Request, deps: JudgeApiDeps): Promise<Response> {
  const prelude = await openJudgeRequest(request, deps, "payouts/requests");
  if (!prelude.ok) return prelude.response;
  const { ctx } = prelude;
  const parsed = createPayoutRequestSchema.safeParse(ctx.body);
  if (!parsed.success) return badRequest(ctx, parsed.error);
  try {
    const result = await createPayoutRequest(ctx, ctx.sessionId, parsed.data);
    if (!result.ok && "refusal" in result) {
      ctx.finish(result.refusal.code, 409);
      return errorJson(409, result.refusal.code, result.refusal.message);
    }
    if (!result.ok) {
      ctx.finish("too_many_requests", 409);
      return errorJson(409, "too_many_requests", `This judge session has made ${MAX_SESSION_REQUESTS} payout requests, the most it can make.`);
    }
    const view = await viewOf(ctx, result.requestId);
    ctx.finish("created", 201);
    return json(201, { request: view });
  } catch (error) {
    return internalError(ctx, error);
  }
}

export async function handleSignPayout(request: Request, requestId: string, deps: JudgeApiDeps): Promise<Response> {
  const prelude = await openJudgeRequest(request, deps, "payouts/sign");
  if (!prelude.ok) return prelude.response;
  const { ctx } = prelude;
  if (!deps.paypal) {
    ctx.finish("paypal_unconfigured", 503);
    return errorJson(503, "paypal_unconfigured", "PayPal isn't configured on this server, so payouts can't be signed or sent.");
  }
  const parsed = signBodySchema.safeParse(ctx.body);
  if (!parsed.success) return badRequest(ctx, parsed.error);
  if (!REQUEST_ID.test(requestId)) return unknown(ctx);
  try {
    const outcome = await signPayout({ ...ctx, paypal: deps.paypal }, ctx.sessionId, requestId, parsed.data);
    switch (outcome.kind) {
      case "unknown_request":
        return unknown(ctx);
      case "refused":
        ctx.finish(outcome.refusal.code, 409);
        return errorJson(409, outcome.refusal.code, outcome.refusal.message);
      case "blocked":
        ctx.finish(outcome.code, 409);
        return errorJson(409, outcome.code, outcome.message);
      case "signed":
        ctx.finish(outcome.executed ? `signed_${outcome.executed}` : "signed", 200);
        return json(200, { request: await viewOf(ctx, requestId) });
    }
  } catch (error) {
    return internalError(ctx, error);
  }
}

export async function handleRiskRead(request: Request, requestId: string, deps: JudgeApiDeps): Promise<Response> {
  const prelude = await openJudgeRequest(request, deps, "payouts/risk");
  if (!prelude.ok) return prelude.response;
  const { ctx } = prelude;
  const parsed = riskBodySchema.safeParse(ctx.body);
  if (!parsed.success) return badRequest(ctx, parsed.error);
  if (!REQUEST_ID.test(requestId)) return unknown(ctx);
  try {
    const outcome = await runRiskRead(ctx, ctx.sessionId, requestId);
    if (outcome === "unknown_request") return unknown(ctx);
    ctx.finish(outcome, 200);
    return json(200, { request: await viewOf(ctx, requestId) });
  } catch (error) {
    return internalError(ctx, error);
  }
}
