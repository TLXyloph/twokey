/**
 * The hash chain (spec §2). Each event's hash is SHA-256 of the canonical JSON
 * {sessionId, seq, type, payload, occurredAt, prevHash}; seq 1 links to the seed hash and every
 * later event to the one before it. `verifyChain` re-hashes a session and names the first event
 * that doesn't hold, in plain words ("Show proof" links to it through GET /api/ledger/verify).
 */
import type { ChainCheck, LedgerEvent } from "./contracts";
import { canonicalJson, sha256Hex } from "./canonical";

export type HashedFields = Pick<LedgerEvent, "sessionId" | "seq" | "type" | "payload" | "occurredAt" | "prevHash">;

export function eventHash(fields: HashedFields): Promise<string> {
  const { sessionId, seq, type, payload, occurredAt, prevHash } = fields;
  return sha256Hex(canonicalJson({ sessionId, seq, type, payload, occurredAt, prevHash }));
}

export interface VerifyOptions {
  /** An extra check per event (e.g. its signature); a plain sentence when it fails, else null. */
  checkEvent?(event: LedgerEvent): Promise<string | null>;
}

export async function verifyChain(events: readonly LedgerEvent[], seedHash: string, options: VerifyOptions = {}): Promise<ChainCheck> {
  let prevHash = seedHash;
  for (const [index, event] of events.entries()) {
    const seq = index + 1;
    const fail = (reason: string): ChainCheck => ({ ok: false, badSeq: event.seq, reason });
    if (event.seq !== seq) return fail(`Event ${seq} is missing.`);
    if (event.prevHash !== prevHash) {
      return fail(seq === 1 ? "Event 1 doesn't start from this demo's seed." : `Event ${seq} doesn't follow event ${seq - 1}.`);
    }
    if ((await eventHash(event)) !== event.hash) return fail(`Event ${seq}'s contents don't match its hash.`);
    const problem = options.checkEvent ? await options.checkEvent(event) : null;
    if (problem) return fail(`Event ${seq}: ${problem}`);
    prevHash = event.hash;
  }
  return { ok: true, length: events.length, head: prevHash };
}
