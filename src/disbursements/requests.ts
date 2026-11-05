/**
 * A judge's own payout request (spec §3): validated at the boundary, refused when the requester is
 * a parent or the payee, then recorded as payout.requested + key 1 + the rules card.
 */
import { z } from "zod";
import { BUDGET_LINES } from "@/demo/riverbend-policy";
import { PAYOUT_CAP_CENTS, type ActingRole, type BudgetLineId, type CreatePayoutRequestBody, type RiskAssessor } from "@/ledger/contracts";
import type { TwoKeyLedgerStore } from "@/ledger/ledger-store";
import { projectRequests } from "@/ledger/request-projection";
import { requestRefusal, type Refusal } from "./eligibility";
import { payeeById, PAYEES } from "./payees";
import { RECEIPT_IDS } from "./receipt-hashes";
import { buildRequestPayload } from "./request-payload";
import { appendKeyOne, appendRiskCard, keys, type Append } from "./request-steps";
import type { DemoSigner } from "./signing";

/** A judge session can make at most this many requests of its own (it keeps the demo's chain small). */
export const MAX_SESSION_REQUESTS = 20;

const ACTING_ROLES = ["president", "treasurer", "secretary", "parent", "reviewer"] as const satisfies readonly ActingRole[];
const PAYEE_IDS = PAYEES.map((payee) => payee.id) as [CreatePayoutRequestBody["payeeId"], ...CreatePayoutRequestBody["payeeId"][]];
const BUDGET_LINE_IDS = BUDGET_LINES.map((line) => line.id) as [BudgetLineId, ...BudgetLineId[]];

/** Like the contract's body, but a parent is accepted here so the refusal can say why. */
export const createPayoutRequestSchema = z
  .object({
    actingAs: z.enum(ACTING_ROLES),
    payeeId: z.enum(PAYEE_IDS),
    amountCents: z.number().int().min(1).max(PAYOUT_CAP_CENTS),
    description: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[^\p{Cc}]*$/u, "no control characters"),
    budgetLine: z.enum(BUDGET_LINE_IDS),
    receiptId: z.enum(RECEIPT_IDS),
  })
  .strict();

export type CreateRequestInput = z.infer<typeof createPayoutRequestSchema>;

export interface RequestDeps {
  ledger: TwoKeyLedgerStore;
  signer: DemoSigner;
  risk: RiskAssessor;
  now: () => Date;
  newId: () => string;
}

export type CreateOutcome =
  | { ok: true; requestId: string }
  | { ok: false; refusal: Refusal }
  | { ok: false; tooMany: true };

export async function createPayoutRequest(deps: RequestDeps, sessionId: string, input: CreateRequestInput): Promise<CreateOutcome> {
  const { ledger } = deps;
  const append: Append = (event) => ledger.append(sessionId, event);
  const existing = projectRequests(await ledger.read(sessionId)).map((state) => state.request);
  const requestId = deps.newId();
  const refusal = requestRefusal(input.actingAs, payeeById(input.payeeId)?.role ?? null);
  if (refusal) {
    await append({ type: "approval.refused", payload: { requestId, role: input.actingAs, ...refusal } });
    return { ok: false, refusal };
  }
  if (existing.filter((request) => request.source === "session").length >= MAX_SESSION_REQUESTS) return { ok: false, tooMany: true };
  if (input.actingAs === "parent" || input.actingAs === "reviewer") throw new Error("unreachable: a non-officer is refused above");

  const request = await buildRequestPayload(sessionId, {
    requestId,
    payeeId: input.payeeId,
    amountCents: input.amountCents,
    description: input.description,
    budgetLine: input.budgetLine,
    receiptId: input.receiptId,
    requestedBy: input.actingAs,
    createdAt: deps.now().toISOString(),
    source: "session",
  });
  const requested = await append({ type: "payout.requested", payload: request, idempotencyKey: keys.request(requestId) });
  await appendKeyOne(append, deps.signer, requested.event);
  const card = deps.risk.rulesCard({ request, sessionRequests: [...existing, request] }, deps.now());
  await appendRiskCard(append, request, card, keys.rulesRisk(request.requestHash));
  return { ok: true, requestId };
}
