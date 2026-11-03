/**
 * Pure mapping from a validated `TurnRequest` (AG Studio's shapes) to Anthropic beta Messages params.
 *
 * Every provider parameter (model, limits, effort, caching, refusal fallback) is fixed here on the
 * server; nothing in the request can change them. Thinking is never configured or replayed:
 * Opus 5.5 always thinks adaptively, and its thinking blocks are bound to the exact conversation
 * prefix, which Studio's rebuilt history cannot reproduce.
 */
import type {
  BetaContentBlockParam,
  BetaImageBlockParam,
  BetaMessageParam,
  BetaMessageStreamParams,
  BetaTextBlockParam,
  BetaTool,
  BetaToolChoice,
  BetaToolResultBlockParam,
  BetaToolUseBlockParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type {
  AgAiConversationItem,
  AgAiInputContent,
  AgAiOutputMessage,
  AgAiToolCall,
  AgAiToolCallResult,
  AgAiToolSchema,
  AgLlmRequest,
} from "ag-studio";
import type { TurnRequest } from "./wire";

export const DEFAULT_MODEL = "claude-opus-5-5";
export const MAX_TOKENS = 16000;
/** Beta header for the scalar `fallbacks: "default"` form (the array form uses a different one). */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
export const REQUIRED_TOOL_INSTRUCTION = "You must call one of the available tools in this turn.";

const START_TEXT = "(The conversation starts here.)";
const CONTINUE_TEXT = "Continue.";
const NO_RESULT_TEXT = "No result was recorded for this tool call.";
const BAD_ARGS_NOTE = "Note: this call's arguments were not valid JSON, so it was recorded with {} as its arguments.\n";

type Json = Record<string, unknown>;
type Role = "user" | "assistant";
type Turn = { role: Role; content: BetaContentBlockParam[] };
type ToolItem = AgAiToolCall | AgAiToolCallResult;
type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

const IMAGE_MEDIA_TYPES: Readonly<Record<string, ImageMediaType>> = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/gif": "image/gif",
  "image/webp": "image/webp",
};

/** The model is a server constant; `TWOKEY_AI_MODEL` exists only for a later model comparison. */
export function resolveModel(env: Readonly<Record<string, string | undefined>>): string {
  const override = env.TWOKEY_AI_MODEL?.trim();
  return override ? override : DEFAULT_MODEL;
}

export function buildMessageParams(request: TurnRequest, model: string): BetaMessageStreamParams {
  const tools = toAnthropicTools(request.tools ?? []);
  const choice = tools.length > 0 ? toToolChoice(request.toolChoice) : undefined;
  const system = buildSystem(request, choice?.instruction);
  return {
    model,
    max_tokens: MAX_TOKENS,
    output_config: { effort: "medium" },
    cache_control: { type: "ephemeral" },
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    messages: toAnthropicMessages(request.input),
    ...(system.length > 0 ? { system } : {}),
    ...(choice ? { tools, tool_choice: choice.toolChoice } : {}),
  };
}

/**
 * Stable text (instructions, then every system message in order) comes first and carries an
 * explicit cache breakpoint; per-turn steering (JSON format, tool forcing) trails it uncached, so
 * a change there never invalidates the cached tools + stable system prefix.
 */
function buildSystem(request: TurnRequest, toolInstruction: string | undefined): BetaTextBlockParam[] {
  const stable: string[] = [];
  if (request.instructions?.trim()) stable.push(request.instructions);
  for (const item of request.input) {
    if (item.type === "message" && item.kind === "input" && item.role === "system") {
      const text = item.content.flatMap((part) => (part.type === "text" && part.text ? [part.text] : [])).join("\n");
      if (text.trim()) stable.push(text);
    }
  }
  const blocks: BetaTextBlockParam[] = stable.map((text) => ({ type: "text", text }));
  const last = blocks.at(-1);
  if (last) last.cache_control = { type: "ephemeral" };
  const format = jsonFormatInstruction(request.responseFormat);
  if (format) blocks.push({ type: "text", text: format });
  if (toolInstruction) blocks.push({ type: "text", text: toolInstruction });
  return blocks;
}

function jsonFormatInstruction(format: AgLlmRequest["responseFormat"]): string | undefined {
  if (format.type !== "json") return undefined;
  const lines = [
    `Answer only with JSON that matches the JSON Schema below (output name: ${format.name}). ` +
      "Output the JSON value alone: no prose and no Markdown code fences.",
  ];
  if (format.description) lines.push(`Description: ${format.description}`);
  lines.push(`Schema: ${JSON.stringify(cleanSchema(format.schema))}`);
  return lines.join("\n");
}

/** Opus 5.5 rejects forced tool use (`any` / `tool`), so forcing becomes `auto` plus an instruction. */
export function toToolChoice(choice: AgLlmRequest["toolChoice"]): { toolChoice: BetaToolChoice; instruction?: string } {
  if (choice === undefined || choice === "auto") return { toolChoice: { type: "auto" } };
  if (choice === "none") return { toolChoice: { type: "none" } };
  if (choice === "required") return { toolChoice: { type: "auto" }, instruction: REQUIRED_TOOL_INSTRUCTION };
  return {
    toolChoice: { type: "auto" },
    instruction: `You must call the \`${choice.name}\` tool now; do not answer with text alone.`,
  };
}

/**
 * Only plain custom tools are sent: `provided` (provider-hosted) tools are skipped and no `type`
 * field is ever set, so a client cannot inject Anthropic server tools. `strict` is not set (Studio
 * schemas may not meet its rules) and neither is `eager_input_streaming` (Studio reads tool calls
 * only from the final response, and the API's buffered mode keeps its own input validation).
 */
export function toAnthropicTools(tools: readonly AgAiToolSchema[]): BetaTool[] {
  return tools
    .filter((tool) => tool.kind !== "provided")
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: { ...cleanSchema(tool.parameters), type: "object" },
    }));
}

const SCHEMA_KEYWORDS = new Set([
  "items",
  "additionalItems",
  "additionalProperties",
  "not",
  "contains",
  "if",
  "then",
  "else",
  "propertyNames",
  "unevaluatedItems",
  "unevaluatedProperties",
]);
const SCHEMA_LIST_KEYWORDS = new Set(["anyOf", "oneOf", "allOf", "prefixItems"]);
const SCHEMA_MAP_KEYWORDS = new Set(["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"]);

/**
 * Drops `$schema` keywords and the `{ not: {} }` branches Studio's Shape library puts in `anyOf` to
 * mark a value optional, unwrapping an `anyOf` left with one branch. Only schema positions are
 * walked: property names and data keywords (`default`, `const`, `enum`, `examples`) are untouched.
 */
export function cleanSchema(schema: Json): Json {
  const entries = Object.entries(schema).flatMap(([key, value]): [string, unknown][] => {
    if (key === "$schema") return [];
    if (SCHEMA_KEYWORDS.has(key) && isObject(value)) return [[key, cleanSchema(value)]];
    if (SCHEMA_LIST_KEYWORDS.has(key) && Array.isArray(value)) {
      return [[key, value.map((branch: unknown) => (isObject(branch) ? cleanSchema(branch) : branch))]];
    }
    if (SCHEMA_MAP_KEYWORDS.has(key) && isObject(value)) {
      const mapped = Object.entries(value).map(([name, sub]) => [name, isObject(sub) ? cleanSchema(sub) : sub]);
      return [[key, Object.fromEntries(mapped)]];
    }
    return [[key, value]];
  });
  return unwrapOptionalAnyOf(Object.fromEntries(entries));
}

function unwrapOptionalAnyOf(schema: Json): Json {
  const { anyOf, ...rest } = schema;
  if (!Array.isArray(anyOf)) return schema;
  const branches = anyOf.filter((branch: unknown) => !isUndefinedSentinel(branch));
  if (branches.length === anyOf.length) return schema;
  const [only] = branches;
  if (branches.length === 1 && isObject(only)) return { ...only, ...rest };
  return branches.length === 0 ? rest : { ...rest, anyOf: branches };
}

function isUndefinedSentinel(value: unknown): boolean {
  if (!isObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === "not" && isObject(value.not) && Object.keys(value.not).length === 0;
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Studio's history, as Anthropic messages. System messages are hoisted (see `buildSystem`) and
 * reasoning items are dropped. A run of tool items (call1, out1, call2, out2, ...) becomes one
 * assistant turn of `tool_use` blocks, merged with any assistant text just before it, followed by
 * one user turn whose leading blocks are the matching `tool_result`s, in call order.
 */
export function toAnthropicMessages(items: readonly AgAiConversationItem[]): BetaMessageParam[] {
  const turns: Turn[] = [];
  let run: ToolItem[] = [];
  const flushRun = () => {
    if (run.length > 0) appendToolRun(turns, run);
    run = [];
  };
  for (const item of items) {
    if (item.type === "reasoning") continue;
    if (item.type === "function_call" || item.type === "function_call_output") {
      run.push(item);
      continue;
    }
    if (item.kind === "input" && item.role === "system") continue;
    flushRun();
    if (item.kind === "input") append(turns, "user", item.content.flatMap(toUserBlocks));
    else append(turns, "assistant", toAssistantBlocks(item));
  }
  flushRun();
  if (turns[0]?.role !== "user") turns.unshift({ role: "user", content: [{ type: "text", text: START_TEXT }] });
  if (turns.at(-1)?.role !== "user") turns.push({ role: "user", content: [{ type: "text", text: CONTINUE_TEXT }] });
  return turns;
}

function appendToolRun(turns: Turn[], run: readonly ToolItem[]): void {
  const outputs = new Map<string, AgAiToolCallResult>();
  for (const item of run) {
    if (item.type === "function_call_output" && !outputs.has(item.callId)) outputs.set(item.callId, item);
  }
  const uses: BetaToolUseBlockParam[] = [];
  const results: BetaToolResultBlockParam[] = [];
  const seen = new Set<string>();
  for (const item of run) {
    if (item.type !== "function_call" || seen.has(item.callId)) continue;
    seen.add(item.callId);
    const args = parseArguments(item.arguments);
    uses.push({ type: "tool_use", id: item.callId, name: item.name, input: args.input });
    results.push(toToolResult(item.callId, outputs.get(item.callId), args.valid));
  }
  append(turns, "assistant", uses);
  append(turns, "user", results);
  // An output whose call is not in this run cannot be a tool_result (the API would reject it).
  const orphans = run.filter(
    (item): item is AgAiToolCallResult => item.type === "function_call_output" && !seen.has(item.callId),
  );
  append(
    turns,
    "user",
    orphans.map((item): BetaTextBlockParam => ({ type: "text", text: `Result of an earlier tool call (${item.callId}): ${item.output}` })),
  );
}

function toToolResult(callId: string, output: AgAiToolCallResult | undefined, validArgs: boolean): BetaToolResultBlockParam {
  const note = validArgs ? "" : BAD_ARGS_NOTE;
  if (!output) return { type: "tool_result", tool_use_id: callId, is_error: true, content: `${note}${NO_RESULT_TEXT}` };
  return { type: "tool_result", tool_use_id: callId, content: `${note}${output.output || "(empty result)"}` };
}

function parseArguments(raw: string): { input: Json; valid: boolean } {
  if (!raw.trim()) return { input: {}, valid: true };
  try {
    const value: unknown = JSON.parse(raw);
    if (isObject(value)) return { input: value, valid: true };
  } catch {
    // fall through: the call is replayed with {} and the model is told so in its result
  }
  return { input: {}, valid: false };
}

function toUserBlocks(part: AgAiInputContent): BetaContentBlockParam[] {
  switch (part.type) {
    case "text":
      return part.text ? [{ type: "text", text: part.text }] : [];
    case "image":
      return [toImageBlock(part.imageUrl)];
    case "file": {
      const name = part.filename ? ` "${part.filename}"` : "";
      return [{ type: "text", text: `[Attached file${name} omitted: this server does not forward file attachments yet.]` }];
    }
  }
}

function toImageBlock(url: string | undefined): BetaImageBlockParam | BetaTextBlockParam {
  const dataUrl = url ? /^data:([^;,]+);base64,(.+)$/is.exec(url) : null;
  const mediaType = dataUrl?.[1] ? IMAGE_MEDIA_TYPES[dataUrl[1].toLowerCase()] : undefined;
  if (dataUrl?.[2] && mediaType) {
    return { type: "image", source: { type: "base64", media_type: mediaType, data: dataUrl[2] } };
  }
  if (url && /^https?:\/\//i.test(url)) return { type: "image", source: { type: "url", url } };
  return { type: "text", text: "[Image omitted: only PNG, JPEG, GIF or WebP data URLs and http(s) URLs are supported.]" };
}

function toAssistantBlocks(message: AgAiOutputMessage): BetaTextBlockParam[] {
  return message.content.flatMap((part): BetaTextBlockParam[] => {
    const text = part.type === "text" ? part.text : part.refusal;
    return text ? [{ type: "text", text }] : [];
  });
}

function append(turns: Turn[], role: Role, blocks: readonly BetaContentBlockParam[]): void {
  if (blocks.length === 0) return;
  const last = turns.at(-1);
  if (last?.role === role) last.content.push(...blocks);
  else turns.push({ role, content: [...blocks] });
}
