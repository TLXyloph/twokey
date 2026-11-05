/**
 * The monthly close's routes' cores (route files are glue). After the shared checks (./prelude.ts):
 *
 * GET /api/close?month=2026-10
 *   month malformed                              -> 400 bad_request
 *   any month but October 2026                   -> 404 unknown_month
 *   ok                                           -> 200 CloseView: the figures, the close hash, the
 *                                                   AI's recorded draft (or "not recorded"), this
 *                                                   session's sign-off (or null) and the Reviewer's
 *                                                   published key id (or null)
 *
 * POST /api/close/sign  { actingAs, month }
 *   body invalid                                 -> 400 bad_request
 *   any month but October 2026                   -> 404 unknown_month
 *   any role but the Reviewer                    -> 409 signer_cannot_review / not_the_reviewer
 *   this session already signed                  -> 200 { signoff, duplicate: true }
 *   Reviewer key unpublished, unset, unreadable,
 *   or not the committed one                     -> 503 reviewer_key_* (nothing signed)
 *   signed                                       -> 201 { signoff, duplicate: false }
 *
 * A store failure is 500 internal. Messages are plain sentences the page shows as they are.
 */
import { z } from "zod";
import { CLOSE_MONTH, CLOSE_MONTH_NAME, type CloseFigures, type CloseKeyCode, type CloseView } from "../contracts";
import { recordedDraftFor } from "../draft";
import { closeHash, octoberClose } from "../october";
import committedDraft from "../recorded-draft.json";
import { COMMITTED_REVIEWER_KEY, createReviewerVerifier, isPublished, loadReviewerSigner, type ReviewerPublicKey, type ReviewerSignerLoad } from "../reviewer-key";
import { closeRefusalFor, signClose, toSignoffView } from "../signoff";
import { errorJson, internalError, json, openCloseRequest, type CloseApiDeps, type CloseRequestContext } from "./prelude";

export type { CloseApiDeps } from "./prelude";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const signBodySchema = z
  .object({
    actingAs: z.enum(["president", "treasurer", "secretary", "reviewer", "parent"]),
    month: z.string().max(16),
  })
  .strict();

const KEY_MESSAGES: Record<CloseKeyCode, string> = {
  reviewer_key_unpublished: "The Reviewer's demo key hasn't been published on this server yet, so the close can't be signed.",
  reviewer_key_unset: "The Reviewer's demo key isn't set on this server, so the close can't be signed.",
  reviewer_key_invalid: "The Reviewer's demo key on this server can't be read, so the close can't be signed.",
  reviewer_key_mismatch: "The Reviewer's demo key on this server doesn't match the published public key, so the close can't be signed.",
};

const UNKNOWN_MONTH = `Only the ${CLOSE_MONTH_NAME} close is in this demo.`;

// Per isolate: the close is computed from the seed once, and the signer is imported once per secret.
let closeMemo: Promise<{ figures: CloseFigures; hash: string }> | undefined;
let signerCache: { secret: string; publicKey: ReviewerPublicKey; load: Promise<ReviewerSignerLoad> } | undefined;
const verifiers = new WeakMap<ReviewerPublicKey, ReturnType<typeof createReviewerVerifier>>();

function theClose(): Promise<{ figures: CloseFigures; hash: string }> {
  closeMemo ??= (async () => {
    const figures = octoberClose();
    return { figures, hash: await closeHash(figures) };
  })();
  return closeMemo;
}

function signerFor(secret: string | undefined, publicKey: ReviewerPublicKey): Promise<ReviewerSignerLoad> {
  const key = secret ?? "";
  if (signerCache?.secret !== key || signerCache.publicKey !== publicKey) {
    signerCache = { secret: key, publicKey, load: loadReviewerSigner(secret, publicKey) };
  }
  return signerCache.load;
}

function verifierFor(publicKey: ReviewerPublicKey) {
  let verifier = verifiers.get(publicKey);
  if (!verifier) {
    verifier = createReviewerVerifier(publicKey);
    verifiers.set(publicKey, verifier);
  }
  return verifier;
}

function badRequest(ctx: CloseRequestContext, error: z.ZodError): Response {
  ctx.finish("bad_request", 400, "validation");
  const fields = [...new Set(error.issues.map((issue) => issue.path.join(".") || "body"))].join(", ");
  return errorJson(400, "bad_request", `Check these fields and try again: ${fields}.`);
}

export async function handleCloseView(request: Request, deps: CloseApiDeps): Promise<Response> {
  const prelude = await openCloseRequest(request, deps, "close/view");
  if (!prelude.ok) return prelude.response;
  const { ctx } = prelude;
  const month = new URL(request.url).searchParams.get("month") ?? CLOSE_MONTH;
  if (!MONTH.test(month)) {
    ctx.finish("bad_request", 400, "month");
    return errorJson(400, "bad_request", "The month must look like 2026-10.");
  }
  if (month !== CLOSE_MONTH) {
    ctx.finish("unknown_month", 404);
    return errorJson(404, "unknown_month", UNKNOWN_MONTH);
  }
  const publicKey = deps.publicKey ?? COMMITTED_REVIEWER_KEY;
  try {
    const { figures, hash } = await theClose();
    const stored = await ctx.store.find(ctx.sessionId, CLOSE_MONTH);
    const view: CloseView = {
      month: CLOSE_MONTH,
      monthName: CLOSE_MONTH_NAME,
      figures,
      closeHash: hash,
      draft: recordedDraftFor(deps.recordedDraft ?? committedDraft, hash, deps.log),
      signoff: stored ? await toSignoffView(stored, verifierFor(publicKey), hash) : null,
      reviewerKey: isPublished(publicKey) ? { keyId: publicKey.keyId } : null,
    };
    ctx.finish(stored ? "ok_signed" : "ok", 200);
    return json(200, view);
  } catch {
    return internalError(ctx);
  }
}

export async function handleCloseSign(request: Request, deps: CloseApiDeps): Promise<Response> {
  const prelude = await openCloseRequest(request, deps, "close/sign");
  if (!prelude.ok) return prelude.response;
  const { ctx } = prelude;
  const parsed = signBodySchema.safeParse(ctx.body);
  if (!parsed.success) return badRequest(ctx, parsed.error);
  if (parsed.data.month !== CLOSE_MONTH) {
    ctx.finish("unknown_month", 404);
    return errorJson(404, "unknown_month", UNKNOWN_MONTH);
  }
  const refusal = closeRefusalFor(parsed.data.actingAs);
  if (refusal) {
    ctx.finish(refusal.code, 409, parsed.data.actingAs);
    return errorJson(409, refusal.code, refusal.message);
  }
  const publicKey = deps.publicKey ?? COMMITTED_REVIEWER_KEY;
  try {
    const { hash } = await theClose();
    const existing = await ctx.store.find(ctx.sessionId, CLOSE_MONTH);
    if (existing) {
      ctx.finish("duplicate", 200);
      return json(200, { signoff: await toSignoffView(existing, verifierFor(publicKey), hash), duplicate: true });
    }
    const loaded = await signerFor(deps.env.TWOKEY_DEMO_KEY_REVIEWER, publicKey);
    if (!loaded.ok) {
      ctx.finish(loaded.code, 503);
      return errorJson(503, loaded.code, KEY_MESSAGES[loaded.code]);
    }
    const result = await signClose({ store: ctx.store, signer: loaded.signer, sessionId: ctx.sessionId, month: CLOSE_MONTH, closeHash: hash, now: ctx.now() });
    const signoff = await toSignoffView(result.signoff, verifierFor(publicKey), hash);
    const status = result.outcome === "signed" ? 201 : 200;
    ctx.finish(result.outcome, status);
    return json(status, { signoff, duplicate: result.outcome === "duplicate" });
  } catch {
    return internalError(ctx);
  }
}
