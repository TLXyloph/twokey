/**
 * Opens a judge session's ledger (spec §2): `session.opened` (the seed hash and version), then each
 * seeded request (L14, L15) as `payout.requested` (source "seed"), key 1 signed by the requester's
 * real demo key, and a rules card from the injected RiskAssessor. Every append has a fixed
 * idempotency key, so two requests racing to open a session store one copy of each.
 */
import type { LedgerEvent, RiskAssessor } from "@/ledger/contracts";
import type { SessionOpener } from "@/ledger/ledger-store";
import { projectRequests } from "@/ledger/request-projection";
import { SEED_VERSION, seedHash } from "@/ledger/seed";
import { buildRequestPayload } from "./request-payload";
import { appendKeyOne, appendRiskCard, keys } from "./request-steps";
import { SEEDED_REQUESTS } from "./seed-requests";
import type { DemoSigner } from "./signing";

export interface OpenerDeps {
  signer: DemoSigner;
  risk: RiskAssessor;
}

function isOpen(events: readonly LedgerEvent[]): boolean {
  if (!events.some((event) => event.type === "session.opened")) return false;
  const states = projectRequests(events);
  return SEEDED_REQUESTS.every((seed) => {
    const state = states.find((candidate) => candidate.request.requestId === seed.requestId);
    return state !== undefined && state.signatures.some((s) => s.isRequest) && state.risks.length > 0;
  });
}

export function createSessionOpener(deps: OpenerDeps): SessionOpener {
  return {
    isOpen,
    async open(sessionId, append, now) {
      await append({
        type: "session.opened",
        payload: { seedVersion: SEED_VERSION, seedHash: await seedHash() },
        idempotencyKey: `open:${sessionId}`,
      });
      const requests = await Promise.all(SEEDED_REQUESTS.map((facts) => buildRequestPayload(sessionId, facts)));
      for (const request of requests) {
        const requested = await append({ type: "payout.requested", payload: request, idempotencyKey: keys.seedRequest(request.requestId) });
        await appendKeyOne(append, deps.signer, requested.event);
        const card = deps.risk.rulesCard({ request, sessionRequests: requests }, now);
        await appendRiskCard(append, request, card, keys.rulesRisk(request.requestHash));
      }
    },
  };
}
