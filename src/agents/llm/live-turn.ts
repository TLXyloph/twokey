/**
 * One live (model-calling) turn, after its worst case was reserved: `runTurn` metered for this
 * turn alone, then the turn's actual cost appended to the turn log, then (for a turn that
 * completed) its NDJSON recorded for later replay.
 *
 * - The settlement is awaited before the terminal line is sent, so the next turn's reservation
 *   already sees the real cost instead of the worst case.
 * - When the client stops reading early, the settlement runs in the background (`waitUntil`) at
 *   the usage seen so far. If it never lands, the reservation keeps counting at its worst case.
 * - The recording is written in the background: no later turn waits on it.
 * - A failing store never breaks the stream; the failure is logged by turn id only.
 */
import type { TurnRequest, WireLine } from "./wire";
import type { AiTurnStore, TurnReservation } from "./ai-turn-log";
import { createRecordingBuffer } from "./replay";
import { runTurn, type AnthropicLike } from "./run-turn";
import { createTurnMeter } from "./turn-cost";

export interface LiveTurnDeps {
  client: AnthropicLike;
  model: string;
  store: AiTurnStore;
  /** The reservation already appended for this turn. */
  reservation: TurnReservation;
  now: () => number;
  log: (line: string) => void;
  /** Keeps background work alive after the response ends (the Worker's `ctx.waitUntil`). */
  waitUntil: (promise: Promise<unknown>) => void;
}

export async function* liveTurn(deps: LiveTurnDeps, request: TurnRequest, signal: AbortSignal): AsyncGenerator<WireLine, void, undefined> {
  const { reservation, store } = deps;
  const meter = createTurnMeter();
  const recording = createRecordingBuffer();
  let settled = false;

  const settle = (outcome: string): Promise<void> => {
    settled = true;
    return store.turnLog
      .settle({
        turnId: reservation.turnId,
        sessionId: reservation.sessionId,
        model: deps.model,
        costMicroUsd: meter.costMicroUsd(),
        outcome,
        usage: meter.usage(),
        at: deps.now(),
      })
      .catch(() => deps.log(`[ai/turn] settle=failed turn=${reservation.turnId} outcome=${outcome}`));
  };

  const record = (ndjson: string): Promise<void> =>
    store.recordings
      .save({ requestHash: reservation.requestHash, turnId: reservation.turnId, model: deps.model, recordedAt: deps.now(), ndjson })
      .then(
        () => undefined,
        () => deps.log(`[ai/turn] record=failed turn=${reservation.turnId}`),
      );

  try {
    for await (const line of runTurn({ client: deps.client, ledger: meter, model: deps.model, log: deps.log, now: deps.now }, request, signal)) {
      if (line.type !== "complete" && line.type !== "error") {
        recording.add(line);
        yield line;
        continue;
      }
      await settle(line.type === "complete" ? "complete" : line.error.code);
      if (line.type === "complete" && line.response.status === "completed") {
        const ndjson = recording.finish(line);
        if (ndjson === undefined) deps.log(`[ai/turn] record=skipped_too_large turn=${reservation.turnId}`);
        else deps.waitUntil(record(ndjson));
      }
      yield line;
    }
  } finally {
    // The consumer stopped before the terminal line (client gone): runTurn has already metered
    // the usage the stream reported, so settle that in the background.
    if (!settled) deps.waitUntil(settle("aborted"));
  }
}
