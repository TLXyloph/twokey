/**
 * The ledger routes' cores (route files are glue). After the shared judge checks
 * (src/disbursements/api/judge-context.ts; a first read opens the session):
 *
 * GET /api/ledger/view    -> 200 BoardView: the seed folded with this session's events, today's
 *                            payout total across sessions for the limits, and PayPal's shared
 *                            sandbox balance (null when it can't be read).
 * GET /api/ledger/verify  -> 200 ChainCheck: re-hashes the session's chain from the seed hash and
 *                            checks every signature against the committed public keys; names the
 *                            first event that doesn't hold.
 * A ledger failure is 500 internal.
 */
import { riverbend } from "@/demo/riverbend";
import { internalError, json, openJudgeRequest, type JudgeApiDeps } from "@/disbursements/api/judge-context";
import { startOfUtcDay } from "@/disbursements/executor";
import { verifyChain } from "../chain";
import type { LedgerEvent } from "../contracts";
import { foldBoard } from "../fold";
import { seedHash } from "../seed";

export async function handleLedgerView(request: Request, deps: JudgeApiDeps): Promise<Response> {
  const prelude = await openJudgeRequest(request, deps, "ledger/view");
  if (!prelude.ok) return prelude.response;
  const { ctx } = prelude;
  try {
    const events = await ctx.ledger.read(ctx.sessionId);
    const [dailySentCents, sharedBalance, seed] = await Promise.all([
      ctx.ledger.sentPayoutCentsSince(startOfUtcDay(ctx.now())),
      deps.sharedBalance ? deps.sharedBalance().catch(() => null) : Promise.resolve(null),
      seedHash(),
    ]);
    const board = foldBoard(riverbend, events, { sharedBalance, dailySentCents, seedHash: seed });
    ctx.finish("ok", 200);
    return json(200, board);
  } catch (error) {
    return internalError(ctx, error);
  }
}

export async function handleLedgerVerify(request: Request, deps: JudgeApiDeps): Promise<Response> {
  const prelude = await openJudgeRequest(request, deps, "ledger/verify");
  if (!prelude.ok) return prelude.response;
  const { ctx } = prelude;
  try {
    const events = await ctx.ledger.read(ctx.sessionId);
    const check = await verifyChain(events, await seedHash(), {
      async checkEvent(event) {
        if (event.type !== "approval.signed") return null;
        const { role, signed, signature, keyId } = (event as LedgerEvent<"approval.signed">).payload;
        return (await ctx.verifier.verify(role, signed, signature, keyId)) ? null : "its signature doesn't verify against the published demo key.";
      },
    });
    ctx.finish(check.ok ? "ok" : "broken", 200, check.ok ? undefined : `seq_${check.badSeq}`);
    return json(200, check);
  } catch (error) {
    return internalError(ctx, error);
  }
}
