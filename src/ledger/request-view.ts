/**
 * One request's `PayoutRequestView` (contracts.ts), as the drawer shows it: who asked, who signed,
 * the risk card, who could sign next, and a timeline in plain words.
 */
import { eligibleSigners } from "@/disbursements/eligibility";
import { payeeById } from "@/disbursements/payees";
import { receiptById } from "@/disbursements/receipt-hashes";
import type { PayoutRequestView, TimelineStep } from "./contracts";
import { currentRisk, isRiskPending, requestStatus, titleOf, type RequestState } from "./request-projection";

function timeline(state: RequestState): TimelineStep[] {
  const { request } = state;
  const steps: (TimelineStep & { order: number })[] = [
    { step: "requested", label: `Requested by the ${titleOf(request.requestedBy)}`, at: request.createdAt, order: 0 },
  ];
  state.signatures.forEach((signature, index) => {
    if (!signature.isRequest) steps.push({ step: "signed", label: `Signed by the ${signature.title}`, at: signature.at, order: 1 + index });
  });
  const base = 100;
  if (state.sentBack) {
    const { role, reason, at, seq } = state.sentBack;
    steps.push({ step: "sent_back", label: `Sent back by the ${titleOf(role)}`, at, order: base + seq, detail: reason });
  }
  if (state.blocked) {
    steps.push({ step: "blocked", label: `Not sent: ${state.blocked.payload.message}`, at: state.blocked.at, order: base + state.blocked.seq });
  }
  if (state.failed) {
    steps.push({ step: "failed", label: `Not sent: ${state.failed.payload.reason}`, at: state.failed.at, order: base + state.failed.seq });
  }
  if (state.sent) {
    const detail = state.sent.payload.payoutBatchId;
    steps.push({ step: "sent", label: "Sent to PayPal", at: state.sent.at, order: base + state.sent.seq, ...(detail && { detail }) });
  }
  const confirmed = state.confirmations[0];
  if (confirmed) {
    const detail = confirmed.payload.payoutItemId ?? confirmed.payload.payoutBatchId;
    steps.push({
      step: "confirmed",
      label: "PayPal confirmed",
      at: confirmed.payload.paypalCreatedAt ?? confirmed.at,
      order: base + confirmed.seq,
      ...(detail && { detail }),
    });
  }
  return steps.sort((a, b) => a.order - b.order).map(({ order: _order, ...step }) => step);
}

export function toRequestView(state: RequestState): PayoutRequestView {
  const { request } = state;
  const receipt = receiptById(request.receiptId);
  return {
    requestId: request.requestId,
    requestHash: request.requestHash,
    sourceLabel: request.source === "seed" ? "demo data" : "live sandbox",
    payee: { id: request.payeeId, name: request.payeeName, role: payeeById(request.payeeId)?.role ?? null },
    amountCents: request.amountCents,
    description: request.description,
    budgetLine: request.budgetLine,
    receipt: { id: request.receiptId, label: receipt?.label ?? request.receiptId, imageUrl: receipt?.imageUrl ?? "" },
    requestedBy: request.requestedBy,
    createdAt: request.createdAt,
    signatures: state.signatures,
    eligibleSigners: eligibleSigners(state),
    refusals: state.refusals,
    risk: currentRisk(state)?.card ?? null,
    riskPending: isRiskPending(state),
    status: requestStatus(state),
    timeline: timeline(state),
  };
}
