/**
 * Does a fresh board asking the same question produce the same request chain, so that replays can
 * match by key? This drives AG Studio's REAL agent loop (`directLlmRunner` from ag-studio 3.0.0,
 * not mocked) twice, with a scripted adapter standing in for the model and fixed tool outputs, then
 * runs every request through the same path the server uses (zod parse, translation, replay key).
 *
 * What it shows: Studio rebuilds the history from the conversation, so turn N of run A and turn N
 * of run B are identical to the model, EXCEPT that Studio seeds some agents (page, widget, lead)
 * with preflight tool calls whose ids embed a random run id (`<runId>-preflight-<i>`). The replay
 * key relabels tool ids positionally, which is what makes those turns match. What it cannot show:
 * that Studio's built-in tools (view_page, execute_query, ...) return the same output on another
 * board; that depends on the board's state and viewport (see the hand-over report).
 */
import type { AgAiRunInput, AgLlmAdapter, AgLlmRequest, AgLlmResponse } from "ag-studio";
import { directLlmRunner } from "ag-studio";
import { describe, expect, it } from "vitest";
import { parseTurnBody } from "@/agents/llm/guardrails";
import { replayKey } from "@/agents/llm/replay-key";
import { buildMessageParams } from "@/agents/llm/translate-request";
import { toTurnRequest } from "@/agents/studio/claude-adapter";

type Scripted = AgLlmResponse["output"];

/** Replies to turn i with script[i], and keeps a deep copy of every request it was sent. */
function scriptedAdapter(script: Scripted[]): { adapter: AgLlmAdapter; requests: AgLlmRequest[] } {
  const requests: AgLlmRequest[] = [];
  const adapter: AgLlmAdapter = {
    executeTurn(request) {
      requests.push(JSON.parse(JSON.stringify(request)) as AgLlmRequest);
      const output = script[requests.length - 1] ?? [];
      const response: AgLlmResponse = { id: `resp-${requests.length}`, createdAt: 1, status: "completed", output };
      return { stream: { async *[Symbol.asyncIterator]() {} }, complete: Promise.resolve(response) };
    },
  };
  return { adapter, requests };
}

const tool = (name: string, output: unknown) => ({
  name,
  kind: "client" as const,
  schema: () => ({ name, description: `${name} tool`, parameters: { type: "object", properties: {} } }),
  execute: async () => ({ success: true, value: output }),
});

const callItem = (callId: string, name: string): Scripted[number] => ({
  id: callId,
  kind: "output",
  type: "function_call",
  callId,
  name,
  arguments: "{}",
  status: "completed",
});
const textItem = (text: string): Scripted[number] => ({
  id: "m",
  kind: "output",
  type: "message",
  role: "assistant",
  status: "completed",
  content: [{ type: "text", text, annotations: [] }],
});

async function runOnce(options: { preflight: boolean }): Promise<AgLlmRequest[]> {
  // What the recorded model said, replayed verbatim: a tool call, then an answer.
  const { adapter, requests } = scriptedAdapter([[callItem("toolu_01ABC", "add_widget")], [textItem("Done.")]]);
  const runner = directLlmRunner({ id: "page", name: "Page", description: "page agent", adapter, schema: (s) => s.undefined() });
  const runId = `run-${crypto.randomUUID()}`;
  const input: AgAiRunInput = {
    threadId: `thread-${crypto.randomUUID()}`,
    runId,
    messages: [{ id: `msg-${crypto.randomUUID()}`, role: "user", content: "Chart event takings" }],
    tools: [],
    state: {},
    context: [],
    forwardedProps: {},
  };
  const tools = [tool("view_page", { widgets: [] }), tool("add_widget", { added: "w1" })];
  const ctx = {
    params: {},
    instructions: () => "You are the page manager.",
    tools: () => tools,
    defaultToolCalls: () => (options.preflight ? [{ tool: "view_page" }] : []),
    signal: new AbortController().signal,
    completeTask: undefined,
    emit: undefined,
  };
  for await (const event of runner.run(input, ctx as unknown as Parameters<typeof runner.run>[1])) {
    if (event.type === "RUN_ERROR") throw new Error(event.message);
  }
  return requests;
}

/** The server's path for one request: zod parse of the wire body, translation, replay key. */
async function serverView(request: AgLlmRequest) {
  const parsed = parseTurnBody(JSON.stringify({ request: toTurnRequest(request) }));
  if (!parsed.ok) throw new Error(parsed.rejection.error.message);
  const params = buildMessageParams(parsed.value, "claude-opus-5-5");
  return { key: await replayKey(params), messages: JSON.stringify(params.messages) };
}

describe("Studio request chains, on AG Studio's real agent loop", () => {
  it("are identical turn by turn for an agent with no preflight (the TwoKey auditor and the data agent)", async () => {
    const [a, b] = await Promise.all([runOnce({ preflight: false }), runOnce({ preflight: false })]);
    expect(a).toHaveLength(2);
    for (let turn = 0; turn < a.length; turn++) {
      const [viewA, viewB] = await Promise.all([serverView(a[turn]!), serverView(b[turn]!)]);
      expect(viewA.messages).toBe(viewB.messages);
      expect(viewA.key).toBe(viewB.key);
    }
  });

  it("differ only in random preflight tool ids for the page agent, which the replay key relabels", async () => {
    const [a, b] = await Promise.all([runOnce({ preflight: true }), runOnce({ preflight: true })]);
    expect(a).toHaveLength(2);
    for (let turn = 0; turn < a.length; turn++) {
      const [viewA, viewB] = await Promise.all([serverView(a[turn]!), serverView(b[turn]!)]);
      expect(viewA.messages).toMatch(/-preflight-0/);
      expect(viewA.messages).not.toBe(viewB.messages);
      expect(viewA.key).toBe(viewB.key);
    }
  });
});
