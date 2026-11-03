/**
 * Anthropic -> AG Studio, for one turn: a stateful mapper from beta stream events to `AgAiEvent`s,
 * and a pure mapping from the final `BetaMessage` to `AgLlmResponse`.
 *
 * Only text and client `tool_use` blocks surface. Thinking, redacted thinking, `fallback` markers
 * and any block type this code does not know are ignored, and no reasoning events are emitted.
 *
 * Ids: a text block's `messageId` (stream) and output-message `id` (final) are both
 * `blockMessageId(message.id, blockIndex)`; a tool call's `toolCallId`, `callId` and item `id`
 * are all the Anthropic `tool_use` block id.
 */
import type {
  BetaContentBlock,
  BetaMessage,
  BetaMessageDeltaUsage,
  BetaRawContentBlockDelta,
  BetaRawContentBlockStartEvent,
  BetaRawMessageStreamEvent,
  BetaUsage,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { AgAiEvent, AgAiOutputItem, AgAiUsage, AgLlmResponse } from "ag-studio";
import type { TokenUsage } from "./guardrails";

export function blockMessageId(messageId: string, index: number): string {
  return `${messageId}-${index}`;
}

type OpenBlock = { kind: "text"; messageId: string; started: boolean } | { kind: "tool"; toolCallId: string };

export class StreamTranslator {
  private messageId = "msg";
  private readonly open = new Map<number, OpenBlock>();
  private usage: TokenUsage | undefined;

  /** The Studio events one Anthropic stream event maps to; anything unrecognised maps to none. */
  translate(event: BetaRawMessageStreamEvent): AgAiEvent[] {
    switch (event.type) {
      case "message_start":
        this.messageId = event.message.id;
        this.usage = pickUsage(event.message.usage);
        return [];
      case "message_delta":
        this.usage = mergeUsage(this.usage, event.usage);
        return [];
      case "content_block_start":
        return this.start(event.index, event.content_block);
      case "content_block_delta":
        return this.delta(event.index, event.delta);
      case "content_block_stop":
        return this.stop(event.index);
      default:
        return [];
    }
  }

  /** Usage reported by the stream so far: lets an aborted or failed turn still be charged. */
  usageSoFar(): TokenUsage | undefined {
    return this.usage && { ...this.usage };
  }

  private start(index: number, block: BetaRawContentBlockStartEvent["content_block"]): AgAiEvent[] {
    if (block.type === "text") {
      const open: OpenBlock = { kind: "text", messageId: blockMessageId(this.messageId, index), started: false };
      this.open.set(index, open);
      return this.text(open, block.text);
    }
    if (block.type === "tool_use") {
      this.open.set(index, { kind: "tool", toolCallId: block.id });
      return [{ type: "TOOL_CALL_START", toolCallId: block.id, toolCallName: block.name }];
    }
    return [];
  }

  private delta(index: number, delta: BetaRawContentBlockDelta): AgAiEvent[] {
    const open = this.open.get(index);
    if (open?.kind === "text" && delta.type === "text_delta") return this.text(open, delta.text);
    if (open?.kind === "tool" && delta.type === "input_json_delta" && delta.partial_json) {
      return [{ type: "TOOL_CALL_ARGS", toolCallId: open.toolCallId, delta: delta.partial_json }];
    }
    return [];
  }

  private stop(index: number): AgAiEvent[] {
    const open = this.open.get(index);
    this.open.delete(index);
    if (open?.kind === "tool") return [{ type: "TOOL_CALL_END", toolCallId: open.toolCallId }];
    if (open?.kind === "text" && open.started) return [{ type: "TEXT_MESSAGE_END", messageId: open.messageId }];
    return [];
  }

  /** A text message starts on its first non-empty text, so an empty block emits nothing. */
  private text(open: { messageId: string; started: boolean }, text: string): AgAiEvent[] {
    if (!text) return [];
    const events: AgAiEvent[] = [];
    if (!open.started) {
      open.started = true;
      events.push({ type: "TEXT_MESSAGE_START", messageId: open.messageId, role: "assistant" });
    }
    events.push({ type: "TEXT_MESSAGE_CONTENT", messageId: open.messageId, delta: text });
    return events;
  }
}

function pickUsage(usage: BetaUsage): TokenUsage {
  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_read_input_tokens: usage.cache_read_input_tokens,
    cache_creation_input_tokens: usage.cache_creation_input_tokens,
  };
}

/** `message_delta` usage is cumulative; its input-side fields are null when unchanged. */
function mergeUsage(previous: TokenUsage | undefined, delta: BetaMessageDeltaUsage): TokenUsage {
  return {
    input_tokens: delta.input_tokens ?? previous?.input_tokens ?? 0,
    output_tokens: delta.output_tokens,
    cache_read_input_tokens: delta.cache_read_input_tokens ?? previous?.cache_read_input_tokens ?? null,
    cache_creation_input_tokens: delta.cache_creation_input_tokens ?? previous?.cache_creation_input_tokens ?? null,
  };
}

/**
 * The final response Studio reads tool calls from. Two kinds of `tool_use` are withheld so they
 * are never executed: one cut off by `max_tokens` (the last block of a truncated turn), and any
 * that precede the last `fallback` block (the declined model's partial output).
 */
export function toAgLlmResponse(message: BetaMessage, now: () => number = Date.now): AgLlmResponse {
  const incomplete = message.stop_reason === "max_tokens";
  const lastIndex = message.content.length - 1;
  const lastFallback = message.content.findLastIndex((block) => block.type === "fallback");
  const output = message.content.flatMap((block, index): AgAiOutputItem[] => {
    if (block.type === "text") {
      if (!block.text) return [];
      const status = incomplete && index === lastIndex ? "incomplete" : "completed";
      return [textItem(blockMessageId(message.id, index), block.text, status)];
    }
    if (block.type !== "tool_use" || index < lastFallback || (incomplete && index === lastIndex)) return [];
    return [toolCallItem(block)];
  });
  return {
    id: message.id,
    createdAt: now(),
    model: message.model,
    output,
    status: incomplete ? "incomplete" : "completed",
    ...(incomplete ? { incompleteDetails: { reason: "max_output_tokens" as const } } : {}),
    usage: toAgUsage(message.usage),
  };
}

function textItem(id: string, text: string, status: "completed" | "incomplete"): AgAiOutputItem {
  return { id, kind: "output", type: "message", role: "assistant", status, content: [{ type: "text", text, annotations: [] }] };
}

function toolCallItem(block: Extract<BetaContentBlock, { type: "tool_use" }>): AgAiOutputItem {
  return {
    id: block.id,
    kind: "output",
    type: "function_call",
    callId: block.id,
    name: block.name,
    arguments: JSON.stringify(block.input ?? {}),
    status: "completed",
  };
}

/**
 * Studio counts cache reads and writes inside `inputTokens` (they are documented as subsets of it),
 * whereas Anthropic's `input_tokens` excludes them, so the three are summed.
 */
export function toAgUsage(usage: BetaUsage): AgAiUsage {
  const cachedInputTokens = usage.cache_read_input_tokens ?? 0;
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
  const inputTokens = usage.input_tokens + cachedInputTokens + cacheWriteTokens;
  return {
    inputTokens,
    outputTokens: usage.output_tokens,
    totalTokens: inputTokens + usage.output_tokens,
    cachedInputTokens,
    cacheWriteTokens,
    ...(usage.output_tokens_details ? { reasoningTokens: usage.output_tokens_details.thinking_tokens } : {}),
  };
}
