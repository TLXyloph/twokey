/**
 * The AI turn log: event-sourced spend and rate state for `POST /api/ai/turn`, plus the store of
 * recorded answers that are replayed when the live AI is unavailable.
 *
 * State is never a counter. Spend is derived from the events: each settled turn counts at its
 * actual cost, and each reservation without a settlement counts at its worst case. Rate is the
 * number of reserved and replayed turns a session started within the window.
 *
 * The reservation is the check-then-call guard: `reserve` checks every limit and appends the
 * worst-case cost as ONE atomic step, before the model is called, so two turns racing for the last
 * of the budget cannot both get it. A turn whose settlement never lands (the isolate died) keeps
 * counting at its worst case: the cap can be over-estimated, never under-estimated.
 *
 * The D1 implementation is ./d1-ai-turn-log.ts (schema: config/d1/migrations/0002_ai_turns.sql);
 * the in-memory one below has the same semantics and serves tests and plain `next dev`.
 */
import type { AiLimits } from "./turn-config";
import type { UsageTotals } from "./turn-cost";

export interface TurnReservation {
  turnId: string;
  sessionId: string;
  model: string;
  requestHash: string;
  /** The turn's worst-case cost, in micro-dollars. */
  costMicroUsd: number;
  /** Milliseconds since epoch. */
  at: number;
}

export interface TurnSettlement {
  turnId: string;
  sessionId: string;
  model: string;
  /** The actual cost of every attempt the turn made, in micro-dollars. */
  costMicroUsd: number;
  /** `complete`, or the wire error code the turn ended with (`refusal`, `aborted`, ...). */
  outcome: string;
  usage: UsageTotals;
  at: number;
}

export interface ReplayNote {
  turnId: string;
  sessionId: string;
  requestHash: string;
  outcome: "hit" | "miss";
  at: number;
}

export type ReserveOutcome = "reserved" | "rate_limited" | "session_budget" | "total_budget";

export interface AiTurnLog {
  /** Appends the reservation only if the rate, the session share and the total all allow it. */
  reserve(reservation: TurnReservation, limits: AiLimits): Promise<ReserveOutcome>;
  /** Appends the turn's actual cost. A second settlement of the same turn is ignored. */
  settle(settlement: TurnSettlement): Promise<void>;
  recordReplay(note: ReplayNote): Promise<void>;
  /** Reserved and replayed turns of the session that started after `sinceMs`. */
  countRecentTurns(sessionId: string, sinceMs: number): Promise<number>;
  /** Settled cost plus unsettled reservations, for one session or (no argument) for all. */
  committedMicroUsd(sessionId?: string): Promise<number>;
}

export interface TurnRecording {
  /** The replay key (./replay-key.ts). */
  requestHash: string;
  turnId: string;
  model: string;
  recordedAt: number;
  /** The turn's NDJSON response: event lines then its `complete` line. */
  ndjson: string;
}

export interface TurnRecordingStore {
  find(requestHash: string): Promise<TurnRecording | undefined>;
  /** The first recording for a key wins; later ones report "duplicate". */
  save(recording: TurnRecording): Promise<"stored" | "duplicate">;
}

export interface AiTurnStore {
  turnLog: AiTurnLog;
  recordings: TurnRecordingStore;
}

export type AiTurnEvent =
  | ({ kind: "reserved" } & TurnReservation)
  | ({ kind: "settled" } & TurnSettlement)
  | ({ kind: "replayed" } & ReplayNote);

// ---------------------------------------------------------------------------------------------
// The rules, as pure functions over the events (the D1 store expresses the same rules in SQL)
// ---------------------------------------------------------------------------------------------

export function committedFrom(events: readonly AiTurnEvent[], sessionId?: string): number {
  const settled = new Map<string, number>();
  for (const event of events) if (event.kind === "settled") settled.set(event.turnId, event.costMicroUsd);
  let total = 0;
  for (const event of events) {
    if (sessionId !== undefined && event.sessionId !== sessionId) continue;
    if (event.kind === "settled") total += event.costMicroUsd;
    if (event.kind === "reserved" && !settled.has(event.turnId)) total += event.costMicroUsd;
  }
  return total;
}

export function recentTurnsFrom(events: readonly AiTurnEvent[], sessionId: string, sinceMs: number): number {
  return events.filter((event) => event.kind !== "settled" && event.sessionId === sessionId && event.at > sinceMs).length;
}

/** Which limit, if any, refuses the reservation; checked in the order rate, session share, total. */
export function decideReservation(events: readonly AiTurnEvent[], reservation: TurnReservation, limits: AiLimits): ReserveOutcome {
  if (recentTurnsFrom(events, reservation.sessionId, reservation.at - limits.windowMs) >= limits.sessionTurnsPerWindow) {
    return "rate_limited";
  }
  if (committedFrom(events, reservation.sessionId) + reservation.costMicroUsd > limits.sessionBudgetMicroUsd) return "session_budget";
  if (committedFrom(events) + reservation.costMicroUsd > limits.totalBudgetMicroUsd) return "total_budget";
  return "reserved";
}

// ---------------------------------------------------------------------------------------------
// In memory
// ---------------------------------------------------------------------------------------------

export interface InMemoryAiTurnStore extends AiTurnStore {
  /** Every event in append order, as frozen copies. */
  events(): readonly AiTurnEvent[];
}

export function createInMemoryAiTurnStore(): InMemoryAiTurnStore {
  const events: Readonly<AiTurnEvent>[] = [];
  const recordings = new Map<string, Readonly<TurnRecording>>();
  const append = (event: AiTurnEvent) => events.push(Object.freeze({ ...event, ...("usage" in event ? { usage: { ...event.usage } } : {}) }));
  const has = (kind: AiTurnEvent["kind"], turnId: string) => events.some((event) => event.kind === kind && event.turnId === turnId);
  return {
    turnLog: {
      async reserve(reservation, limits) {
        if (has("reserved", reservation.turnId)) throw new Error("ai_turn_events: turn already reserved");
        const outcome = decideReservation(events, reservation, limits);
        if (outcome === "reserved") append({ kind: "reserved", ...reservation });
        return outcome;
      },
      async settle(settlement) {
        const reserved = events.some(
          (event) => event.kind === "reserved" && event.turnId === settlement.turnId && event.sessionId === settlement.sessionId,
        );
        if (!reserved) throw new Error("ai_turn_events: settled without a reservation");
        if (!has("settled", settlement.turnId)) append({ kind: "settled", ...settlement });
      },
      async recordReplay(note) {
        if (has("replayed", note.turnId)) throw new Error("ai_turn_events: turn already replayed");
        append({ kind: "replayed", ...note });
      },
      countRecentTurns: async (sessionId, sinceMs) => recentTurnsFrom(events, sessionId, sinceMs),
      committedMicroUsd: async (sessionId) => committedFrom(events, sessionId),
    },
    recordings: {
      find: async (requestHash) => {
        const found = recordings.get(requestHash);
        return found && { ...found };
      },
      async save(recording) {
        if (recordings.has(recording.requestHash)) return "duplicate";
        recordings.set(recording.requestHash, Object.freeze({ ...recording }));
        return "stored";
      },
    },
    events: () => [...events],
  };
}
