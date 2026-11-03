/** Shared builders for the LLM route tests: typed Anthropic beta objects and fake streams, no network. */
import type {
  BetaContentBlock,
  BetaMessage,
  BetaRawMessageStreamEvent,
  BetaStopReason,
  BetaUsage,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { AgAiInputMessage } from "ag-studio";
import type { AnthropicLike, TurnStream } from "@/agents/llm/run-turn";
import type { TurnRequest } from "@/agents/llm/wire";

export const userMessage = (text: string): AgAiInputMessage => ({
  id: `u-${text}`,
  kind: "input",
  type: "message",
  role: "user",
  content: [{ type: "text", text }],
  status: "completed",
});

export const turnRequest = (text = "hello", extra: Partial<TurnRequest> = {}): TurnRequest => ({
  input: [userMessage(text)],
  responseFormat: { type: "text" },
  ...extra,
});

export const usage = (over: Partial<BetaUsage> = {}): BetaUsage => ({
  cache_creation: null,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  fallback_credit: null,
  inference_geo: null,
  input_tokens: 100,
  iterations: null,
  output_tokens: 50,
  output_tokens_details: null,
  server_tool_use: null,
  service_tier: "standard",
  speed: null,
  ...over,
});

export const textBlock = (text: string): BetaContentBlock => ({ type: "text", text, citations: null });
export const toolUseBlock = (id: string, name: string, input: unknown): BetaContentBlock => ({
  type: "tool_use",
  id,
  name,
  input,
});
export const thinkingBlock = (): BetaContentBlock => ({ type: "thinking", thinking: "", signature: "sig" });
export const fallbackBlock = (): BetaContentBlock => ({
  type: "fallback",
  from: { model: "claude-opus-5-5" },
  to: { model: "claude-opus-4-8" },
  trigger: { type: "refusal", category: "cyber" },
});

export const message = (
  content: BetaContentBlock[],
  stopReason: BetaStopReason = "end_turn",
  over: Partial<BetaMessage> = {},
): BetaMessage => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content,
  container: null,
  context_management: null,
  diagnostics: null,
  stop_details: null,
  stop_reason: stopReason,
  stop_sequence: null,
  usage: usage(),
  ...over,
});

/** The stream events the API would send for `final`: text and tool_use blocks get deltas. */
export function eventsFor(final: BetaMessage): BetaRawMessageStreamEvent[] {
  const events: BetaRawMessageStreamEvent[] = [
    { type: "message_start", message: { ...final, content: [], stop_reason: null, usage: usage({ output_tokens: 1 }) } },
  ];
  final.content.forEach((block, index) => {
    if (block.type === "text") {
      events.push({ type: "content_block_start", index, content_block: { ...block, text: "" } });
      events.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } });
    } else if (block.type === "tool_use") {
      events.push({ type: "content_block_start", index, content_block: { ...block, input: {} } });
      events.push({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } });
    } else {
      events.push({ type: "content_block_start", index, content_block: block });
    }
    events.push({ type: "content_block_stop", index });
  });
  events.push({
    type: "message_delta",
    context_management: null,
    delta: { container: null, stop_details: final.stop_details, stop_reason: final.stop_reason, stop_sequence: null },
    usage: { ...final.usage, input_tokens: null, cache_creation_input_tokens: null, cache_read_input_tokens: null },
  });
  events.push({ type: "message_stop" });
  return events;
}

export interface FakeStreamOptions {
  /** Thrown from the iterator after this many events. */
  failAfter?: { count: number; error: unknown };
  /** Rejects finalMessage() with this instead of resolving. */
  finalError?: unknown;
  /** Waits on this before yielding each event (lets a test abort mid-stream). */
  gate?: () => Promise<void>;
}

export function fakeStream(final: BetaMessage, options: FakeStreamOptions = {}): TurnStream {
  const events = eventsFor(final);
  return {
    async *[Symbol.asyncIterator]() {
      for (const [count, event] of events.entries()) {
        if (options.failAfter && count >= options.failAfter.count) throw options.failAfter.error;
        if (options.gate) await options.gate();
        yield event;
      }
    },
    finalMessage: () => (options.finalError === undefined ? Promise.resolve(final) : Promise.reject(options.finalError)),
  };
}

/** Yields `message_start`, then behaves like the SDK on abort: rejects with APIUserAbortError. */
export function hangingStream(signal: AbortSignal | undefined, abortError: unknown, onHang?: () => void): TurnStream {
  const final = message([textBlock("never")]);
  const [start] = eventsFor(final);
  return {
    async *[Symbol.asyncIterator]() {
      yield start!;
      onHang?.();
      await new Promise<never>((_, reject) => {
        if (signal?.aborted) reject(abortError);
        signal?.addEventListener("abort", () => reject(abortError), { once: true });
      });
    },
    finalMessage: () => Promise.reject(abortError),
  };
}

type StreamSource = TurnStream | ((signal: AbortSignal | undefined) => TurnStream);

export interface FakeClient extends AnthropicLike {
  calls: { body: Parameters<AnthropicLike["beta"]["messages"]["stream"]>[0]; signal: AbortSignal | undefined }[];
}

export function fakeClient(...streams: StreamSource[]): FakeClient {
  const calls: FakeClient["calls"] = [];
  return {
    calls,
    beta: {
      messages: {
        stream(body, options) {
          const signal = options?.signal ?? undefined;
          calls.push({ body, signal });
          const next = streams.shift();
          if (!next) throw new Error("fakeClient: no stream left");
          return typeof next === "function" ? next(signal) : next;
        },
      },
    },
  };
}
