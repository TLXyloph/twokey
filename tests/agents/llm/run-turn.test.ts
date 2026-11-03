import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi, type Mock } from "vitest";
import { createInMemorySpendLedger, type SpendLedger } from "@/agents/llm/guardrails";
import { runTurn, toNdjsonStream, type RunTurnDeps } from "@/agents/llm/run-turn";
import { createLineDecoder, type WireLine } from "@/agents/llm/wire";
import { fakeClient, fakeStream, hangingStream, message, textBlock, toolUseBlock, turnRequest, usage, type FakeClient } from "./fixtures";

const collect = async (lines: AsyncIterable<WireLine>): Promise<WireLine[]> => {
  const out: WireLine[] = [];
  for await (const line of lines) out.push(line);
  return out;
};
const deps = (client: FakeClient, over: Partial<RunTurnDeps> = {}): RunTurnDeps & { log: Mock<(line: string) => void> } => ({
  client,
  ledger: createInMemorySpendLedger(),
  model: "claude-opus-5-5",
  now: () => 1,
  ...over,
  log: vi.fn<(line: string) => void>(),
});
const terminals = (lines: WireLine[]) => lines.filter((line) => line.type !== "event");
const apiError = (Cls: typeof Anthropic.RateLimitError, status: number) =>
  new Cls(status as 429, { type: "error", error: { type: "rate_limit_error", message: "slow down" } }, "slow down", new Headers());

describe("runTurn", () => {
  it("streams event lines then exactly one complete line", async () => {
    const client = fakeClient(fakeStream(message([textBlock("Hi!")])));
    const lines = await collect(runTurn(deps(client), turnRequest(), new AbortController().signal));
    expect(lines.map((line) => line.type)).toEqual(["event", "event", "event", "complete"]);
    expect(lines[0]).toEqual({ type: "event", event: { type: "TEXT_MESSAGE_START", messageId: "msg_1-0", role: "assistant" } });
    expect(lines.at(-1)).toMatchObject({ type: "complete", response: { id: "msg_1", status: "completed", createdAt: 1 } });
  });

  it("sends the translated, server-fixed params and passes the abort signal to the SDK", async () => {
    const client = fakeClient(fakeStream(message([textBlock("ok")])));
    const signal = new AbortController().signal;
    await collect(runTurn(deps(client, { model: "claude-sonnet-5-5" }), turnRequest("hello"), signal));
    expect(client.calls).toHaveLength(1);
    const [call] = client.calls;
    expect(call?.signal).toBe(signal);
    expect(call?.body).toMatchObject({
      model: "claude-sonnet-5-5",
      max_tokens: 16000,
      fallbacks: "default",
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    });
  });

  it("completes a tool-use turn with function_call output items", async () => {
    const final = message([toolUseBlock("toolu_1", "lookup", { q: "dues" })], "tool_use");
    const lines = await collect(runTurn(deps(fakeClient(fakeStream(final))), turnRequest(), new AbortController().signal));
    const complete = lines.at(-1);
    expect(complete?.type).toBe("complete");
    if (complete?.type !== "complete") return;
    expect(complete.response.output).toEqual([
      { id: "toolu_1", kind: "output", type: "function_call", callId: "toolu_1", name: "lookup", arguments: '{"q":"dues"}', status: "completed" },
    ]);
  });

  it("turns a refusal into a refusal error line and never completes", async () => {
    const final = message([textBlock("partial")], "refusal", {
      stop_details: { type: "refusal", category: "cyber", explanation: null, fallback_credit_token: null, fallback_has_prefill_claim: null, recommended_model: null },
    });
    const lines = await collect(runTurn(deps(fakeClient(fakeStream(final))), turnRequest(), new AbortController().signal));
    expect(terminals(lines)).toEqual([{ type: "error", error: { code: "refusal", message: expect.stringContaining("declined") } }]);
    expect(lines.at(-1)?.type).toBe("error");
  });

  it.each([
    ["rate limit", apiError(Anthropic.RateLimitError, 429)],
    ["server error", apiError(Anthropic.InternalServerError as typeof Anthropic.RateLimitError, 500)],
    ["connection", new Anthropic.APIConnectionError({ message: "ECONNRESET" })],
  ])("maps an SDK %s error to one upstream_error line", async (_name, error) => {
    const client = fakeClient(fakeStream(message([textBlock("hello")]), { failAfter: { count: 2, error } }));
    const lines = await collect(runTurn(deps(client), turnRequest(), new AbortController().signal));
    expect(terminals(lines)).toEqual([{ type: "error", error: { code: "upstream_error", message: expect.any(String) } }]);
    expect(lines.at(-1)?.type).toBe("error");
  });

  it("maps a failed finalMessage() to one upstream_error line", async () => {
    const error = apiError(Anthropic.RateLimitError, 429);
    const lines = await collect(runTurn(deps(fakeClient(fakeStream(message([textBlock("x")]), { finalError: error }))), turnRequest(), new AbortController().signal));
    expect(terminals(lines)).toEqual([{ type: "error", error: expect.objectContaining({ code: "upstream_error" }) }]);
  });

  it("maps a non-SDK failure to internal without leaking its message", async () => {
    const client = fakeClient(fakeStream(message([textBlock("x")]), { failAfter: { count: 0, error: new Error("secret detail") } }));
    const lines = await collect(runTurn(deps(client), turnRequest(), new AbortController().signal));
    expect(terminals(lines)).toEqual([{ type: "error", error: { code: "internal", message: expect.not.stringContaining("secret") } }]);
  });

  it("reports aborted, without calling the API, when the signal is already aborted", async () => {
    const client = fakeClient();
    const controller = new AbortController();
    controller.abort();
    const lines = await collect(runTurn(deps(client), turnRequest(), controller.signal));
    expect(lines).toEqual([{ type: "error", error: { code: "aborted", message: expect.any(String) } }]);
    expect(client.calls).toHaveLength(0);
  });

  it("reports aborted, and charges usage seen so far, when the turn is cancelled mid-stream", async () => {
    const controller = new AbortController();
    const ledger = createInMemorySpendLedger();
    let hung = false;
    const client = fakeClient((signal) => hangingStream(signal, new Anthropic.APIUserAbortError(), () => (hung = true)));
    const pending = collect(runTurn(deps(client, { ledger }), turnRequest(), controller.signal));
    await vi.waitFor(() => expect(hung).toBe(true));
    controller.abort();
    expect(await pending).toEqual([{ type: "error", error: { code: "aborted", message: expect.any(String) } }]);
    expect(ledger.getSpentUsd()).toBeGreaterThan(0);
  });

  it("records spend and logs one line with model, tokens and cost, but no prompt text", async () => {
    const ledger = createInMemorySpendLedger();
    const final = message([textBlock("answer")], "end_turn", { usage: usage({ input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 0 }) });
    const d = deps(fakeClient(fakeStream(final)), { ledger });
    await collect(runTurn(d, turnRequest("my secret prompt", { instructions: "secret instructions" }), new AbortController().signal));
    expect(ledger.getSpentUsd()).toBeCloseTo(0.024);
    expect(d.log).toHaveBeenCalledTimes(1);
    const line = String(d.log.mock.calls[0]?.[0]);
    expect(line).toContain("model=claude-opus-5-5");
    expect(line).toContain("input=1000");
    expect(line).toContain("output=1000");
    expect(line).toContain("cost_usd=0.0240");
    expect(line).toContain("total_usd=0.0240");
    expect(line).not.toContain("secret");
  });

  it("still ends with its terminal line when the ledger itself fails", async () => {
    const ledger: SpendLedger = { getSpentUsd: () => 0, record: () => { throw new Error("ledger down"); } };
    const d = deps(fakeClient(fakeStream(message([textBlock("ok")]))), { ledger });
    const lines = await collect(runTurn(d, turnRequest(), new AbortController().signal));
    expect(lines.at(-1)?.type).toBe("complete");
    expect(String(d.log.mock.calls[0]?.[0])).toContain("ledger=failed");
  });

  it("charges each attempt of a fallback turn at its own model's prices", async () => {
    const record = vi.fn<SpendLedger["record"]>(() => 0);
    const ledger: SpendLedger = { getSpentUsd: () => 0, record };
    const attempt = { cache_creation: null, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, input_tokens: 10, output_tokens: 5 };
    const final = message([textBlock("ok")], "end_turn", {
      model: "claude-opus-4-8",
      usage: usage({
        iterations: [
          { ...attempt, type: "message", model: "claude-opus-5-5" },
          { ...attempt, type: "fallback_message", model: "claude-opus-4-8" },
        ],
      }),
    });
    await collect(runTurn(deps(fakeClient(fakeStream(final)), { ledger }), turnRequest(), new AbortController().signal));
    expect(record.mock.calls.map(([, model]) => model)).toEqual(["claude-opus-5-5", "claude-opus-4-8"]);
  });
});

describe("toNdjsonStream", () => {
  const read = async (stream: ReadableStream<Uint8Array>): Promise<WireLine[]> => {
    const decoder = createLineDecoder();
    const text = await new Response(stream).text();
    return [...decoder.push(text), ...decoder.flush()];
  };

  it("encodes each wire line as one NDJSON line", async () => {
    async function* lines(): AsyncGenerator<WireLine, void, undefined> {
      yield { type: "event", event: { type: "TEXT_MESSAGE_START", messageId: "m", role: "assistant" } };
      yield { type: "error", error: { code: "refusal", message: "no" } };
    }
    expect(await read(toNdjsonStream(lines()))).toEqual([
      { type: "event", event: { type: "TEXT_MESSAGE_START", messageId: "m", role: "assistant" } },
      { type: "error", error: { code: "refusal", message: "no" } },
    ]);
  });

  it("calls onCancel and closes the line source when the reader cancels", async () => {
    const onCancel = vi.fn();
    let finished = false;
    async function* lines(): AsyncGenerator<WireLine, void, undefined> {
      try {
        yield { type: "event", event: { type: "TEXT_MESSAGE_START", messageId: "m", role: "assistant" } };
        yield { type: "event", event: { type: "TEXT_MESSAGE_END", messageId: "m" } };
      } finally {
        finished = true;
      }
    }
    const reader = toNdjsonStream(lines(), onCancel).getReader();
    await reader.read();
    await reader.cancel();
    expect(onCancel).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(finished).toBe(true));
  });
});
