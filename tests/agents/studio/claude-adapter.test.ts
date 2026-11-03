import type { AgAiEvent, AgLlmRequest, AgLlmResponse } from "ag-studio";
import { describe, expect, it, vi } from "vitest";
import { createClaudeAdapter, TurnError } from "@/agents/studio/claude-adapter";
import { encodeLine, NDJSON_CONTENT_TYPE, REPLAY_LABEL, SESSION_ENDPOINT, TURN_ENDPOINT, type WireLine } from "@/agents/llm/wire";

// --- Fixtures ---------------------------------------------------------------------------

const request: AgLlmRequest = {
  input: [{ id: "u1", kind: "input", type: "message", role: "user", status: "completed", content: [{ type: "text", text: "Hi" }] }],
  instructions: "Be careful.",
  tools: [{ name: "compare_event_takings", description: "Compare", parameters: { type: "object", properties: {} } }],
  toolChoice: "auto",
  responseFormat: { type: "text" },
  model: { id: "some-browser-chosen-model", effort: "high" },
};

const start: AgAiEvent = { type: "TEXT_MESSAGE_START", messageId: "m1", role: "assistant" };
const delta: AgAiEvent = { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "Hello" };
const end: AgAiEvent = { type: "TEXT_MESSAGE_END", messageId: "m1" };

const response: AgLlmResponse = {
  id: "resp_1",
  createdAt: 1_790_000_000_000,
  status: "completed",
  output: [
    {
      id: "m1",
      kind: "output",
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "text", text: "Hello", annotations: [] }],
    },
  ],
};

const eventLine = (event: AgAiEvent): WireLine => ({ type: "event", event });
const completeLine: WireLine = { type: "complete", response };

// --- Helpers ----------------------------------------------------------------------------

const encoder = new TextEncoder();

/** A stream whose chunks the test pushes by hand, so it can observe events arriving one by one. */
function manualBody() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    body,
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
  };
}

function ndjson(chunks: string[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { "Content-Type": NDJSON_CONTENT_TYPE } });
}

function fetchReturning(res: Response) {
  return vi.fn<typeof fetch>(async () => res);
}

async function collect(stream: AsyncIterable<AgAiEvent>): Promise<AgAiEvent[]> {
  const events: AgAiEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// --- Tests ------------------------------------------------------------------------------

describe("createClaudeAdapter", () => {
  it("POSTs { request } as JSON to the turn endpoint and never sends the model", async () => {
    const fetchMock = fetchReturning(ndjson([encodeLine(completeLine)]));
    const handler = createClaudeAdapter({ fetch: fetchMock }).executeTurn(request);
    await handler.complete;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(TURN_ENDPOINT);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");

    const body = JSON.parse(String(init?.body)) as { request: Record<string, unknown> };
    expect(Object.keys(body)).toEqual(["request"]);
    expect(body.request).not.toHaveProperty("model");
    expect(body.request).toEqual({
      input: request.input,
      instructions: request.instructions,
      tools: request.tools,
      toolChoice: request.toolChoice,
      responseFormat: request.responseFormat,
    });
  });

  it("omits optional request fields Studio left unset", async () => {
    const fetchMock = fetchReturning(ndjson([encodeLine(completeLine)]));
    const minimal: AgLlmRequest = { input: [], responseFormat: { type: "text" } };
    await createClaudeAdapter({ fetch: fetchMock }).executeTurn(minimal).complete;

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as { request: Record<string, unknown> };
    expect(body.request).toEqual({ input: [], responseFormat: { type: "text" } });
  });

  it("returns the stream and complete synchronously, before fetch settles", () => {
    const fetchMock = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
    const handler = createClaudeAdapter({ fetch: fetchMock }).executeTurn(request);

    expect(typeof handler.stream[Symbol.asyncIterator]).toBe("function");
    expect(handler.complete).toBeInstanceOf(Promise);
  });

  it("forwards the abort signal to fetch", async () => {
    const fetchMock = fetchReturning(ndjson([encodeLine(completeLine)]));
    const controller = new AbortController();
    await createClaudeAdapter({ fetch: fetchMock }).executeTurn(request, { signal: controller.signal }).complete;

    expect(fetchMock.mock.calls[0]![1]?.signal).toBe(controller.signal);
  });

  it("streams event lines in order as they arrive, then resolves complete", async () => {
    const wire = manualBody();
    const fetchMock = fetchReturning(new Response(wire.body, { status: 200 }));
    const handler = createClaudeAdapter({ fetch: fetchMock }).executeTurn(request);
    const iterator = handler.stream[Symbol.asyncIterator]();

    wire.push(encodeLine(eventLine(start)));
    expect(await iterator.next()).toEqual({ done: false, value: start });

    // One line split across two chunks, followed by another in the same chunk.
    const second = encodeLine(eventLine(delta));
    wire.push(second.slice(0, 7));
    wire.push(second.slice(7) + encodeLine(eventLine(end)));
    expect(await iterator.next()).toEqual({ done: false, value: delta });
    expect(await iterator.next()).toEqual({ done: false, value: end });

    wire.push(encodeLine(completeLine));
    wire.close();
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
    await expect(handler.complete).resolves.toEqual(response);
  });

  it("resolves complete even when nobody reads the stream", async () => {
    const fetchMock = fetchReturning(ndjson([encodeLine(eventLine(start)), encodeLine(completeLine)]));
    const handler = createClaudeAdapter({ fetch: fetchMock }).executeTurn(request);

    await expect(handler.complete).resolves.toEqual(response);
    expect(await collect(handler.stream)).toEqual([start]);
  });

  it("rejects complete with the server's code on an error line, and ends the stream quietly", async () => {
    const fetchMock = fetchReturning(
      ndjson([
        encodeLine(eventLine(start)),
        encodeLine({ type: "error", error: { code: "refusal", message: "The model declined." } }),
      ]),
    );
    const handler = createClaudeAdapter({ fetch: fetchMock }).executeTurn(request);

    expect(await collect(handler.stream)).toEqual([start]);
    const error = await handler.complete.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TurnError);
    expect(error).toMatchObject({ code: "refusal" });
    expect((error as Error).message).toContain("The model declined.");
  });

  it("rejects a non-200 response with the code from its JSON error body", async () => {
    const body = JSON.stringify({ error: { code: "rate_limited", message: "Too many turns." } });
    const fetchMock = fetchReturning(new Response(body, { status: 429, headers: { "Content-Type": "application/json" } }));
    const handler = createClaudeAdapter({ fetch: fetchMock }).executeTurn(request);

    await expect(handler.complete).rejects.toMatchObject({ code: "rate_limited", status: 429 });
    expect(await collect(handler.stream)).toEqual([]);
  });

  it("rejects a non-200 response whose body is not JSON as internal", async () => {
    const fetchMock = fetchReturning(new Response("<html>Bad gateway</html>", { status: 502 }));
    const handler = createClaudeAdapter({ fetch: fetchMock }).executeTurn(request);

    const error = await handler.complete.catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "internal", status: 502 });
    expect((error as Error).message).toContain("502");
  });

  it("rejects when the stream ends without a terminal line", async () => {
    const fetchMock = fetchReturning(ndjson([encodeLine(eventLine(start)), encodeLine(eventLine(delta))]));
    const handler = createClaudeAdapter({ fetch: fetchMock }).executeTurn(request);

    expect(await collect(handler.stream)).toEqual([start, delta]);
    await expect(handler.complete).rejects.toMatchObject({ code: "internal" });
    await expect(handler.complete).rejects.toThrow(/without a terminal line/);
  });

  it("rejects on a malformed line", async () => {
    const fetchMock = fetchReturning(ndjson([encodeLine(eventLine(start)), "{not json}\n"]));
    const handler = createClaudeAdapter({ fetch: fetchMock }).executeTurn(request);

    expect(await collect(handler.stream)).toEqual([start]);
    await expect(handler.complete).rejects.toMatchObject({ code: "internal" });
  });

  it("rejects a complete line that carries no response", async () => {
    const fetchMock = fetchReturning(ndjson(['{"type":"complete"}\n']));
    const handler = createClaudeAdapter({ fetch: fetchMock }).executeTurn(request);

    await expect(handler.complete).rejects.toMatchObject({ code: "internal" });
  });

  it("decodes a terminal line that arrives without a trailing newline", async () => {
    const fetchMock = fetchReturning(ndjson([encodeLine(eventLine(start)), JSON.stringify(completeLine)]));
    const handler = createClaudeAdapter({ fetch: fetchMock }).executeTurn(request);

    await expect(handler.complete).resolves.toEqual(response);
    expect(await collect(handler.stream)).toEqual([start]);
  });

  it("rejects as aborted when the signal fires mid-stream, and ends the stream", async () => {
    const wire = manualBody();
    const fetchMock = fetchReturning(new Response(wire.body, { status: 200 }));
    const controller = new AbortController();
    const handler = createClaudeAdapter({ fetch: fetchMock }).executeTurn(request, { signal: controller.signal });
    const iterator = handler.stream[Symbol.asyncIterator]();

    wire.push(encodeLine(eventLine(start)));
    expect(await iterator.next()).toEqual({ done: false, value: start });

    controller.abort();
    await expect(handler.complete).rejects.toMatchObject({ code: "aborted" });
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
  });

  it("rejects as aborted while fetch is still pending, even if fetch ignores the signal", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
    const controller = new AbortController();
    const handler = createClaudeAdapter({ fetch: fetchMock }).executeTurn(request, { signal: controller.signal });

    await flush();
    controller.abort();
    await expect(handler.complete).rejects.toMatchObject({ code: "aborted" });
    expect(await collect(handler.stream)).toEqual([]);
  });

  it("rejects as aborted without calling fetch when the signal is already aborted", async () => {
    const fetchMock = fetchReturning(ndjson([encodeLine(completeLine)]));
    const controller = new AbortController();
    controller.abort();
    const handler = createClaudeAdapter({ fetch: fetchMock }).executeTurn(request, { signal: controller.signal });

    await expect(handler.complete).rejects.toMatchObject({ code: "aborted" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects as internal when fetch itself fails (network error)", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    const handler = createClaudeAdapter({ fetch: fetchMock }).executeTurn(request);

    await expect(handler.complete).rejects.toMatchObject({ code: "internal" });
    await expect(handler.complete).rejects.toThrow(/Failed to fetch/);
  });

  it("ignores anything after the terminal line", async () => {
    const fetchMock = fetchReturning(ndjson([encodeLine(completeLine), encodeLine(eventLine(start))]));
    const handler = createClaudeAdapter({ fetch: fetchMock }).executeTurn(request);

    await expect(handler.complete).resolves.toEqual(response);
    expect(await collect(handler.stream)).toEqual([]);
  });
});

// --- Judge session ----------------------------------------------------------------------

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const noSession = () => jsonResponse(401, { error: { code: "no_session", message: "No demo session." } });

describe("createClaudeAdapter: judge session", () => {
  it("on 401 no_session, gets a session from the session endpoint and retries the turn once", async () => {
    const replies = [noSession(), jsonResponse(200, { ok: true, session: "issued" }), ndjson([encodeLine(completeLine)])];
    const fetchMock = vi.fn<typeof fetch>(async () => replies.shift()!);
    await expect(createClaudeAdapter({ fetch: fetchMock }).executeTurn(request).complete).resolves.toEqual(response);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([TURN_ENDPOINT, SESSION_ENDPOINT, TURN_ENDPOINT]);
    const [, sessionInit] = fetchMock.mock.calls[1]!;
    expect(sessionInit?.method).toBe("POST");
    expect(sessionInit?.credentials).toBe("same-origin");
    expect(fetchMock.mock.calls[2]![1]?.body).toBe(fetchMock.mock.calls[0]![1]?.body);
  });

  it("gives up after one retry, reporting no_session", async () => {
    const replies = [noSession(), jsonResponse(200, { ok: true }), noSession()];
    const fetchMock = vi.fn<typeof fetch>(async () => replies.shift()!);
    await expect(createClaudeAdapter({ fetch: fetchMock }).executeTurn(request).complete).rejects.toMatchObject({ code: "no_session", status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reports a refused session request with the server's code", async () => {
    const replies = [noSession(), jsonResponse(403, { error: { code: "forbidden", message: "Not this site." } })];
    const fetchMock = vi.fn<typeof fetch>(async () => replies.shift()!);
    await expect(createClaudeAdapter({ fetch: fetchMock }).executeTurn(request).complete).rejects.toMatchObject({ code: "forbidden", status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not ask for a session on any other refusal", async () => {
    const fetchMock = fetchReturning(jsonResponse(401, { error: { code: "forbidden", message: "x" } }));
    await expect(createClaudeAdapter({ fetch: fetchMock }).executeTurn(request).complete).rejects.toMatchObject({ code: "forbidden" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// --- Replays ----------------------------------------------------------------------------

const replayLine: WireLine = { type: "replay", replay: { recordedAt: 1_790_000_000_000 } };

describe("createClaudeAdapter: replayed answers", () => {
  it("labels a replayed answer in the streamed text, and leaves the response Studio keeps unlabelled", async () => {
    const fetchMock = fetchReturning(ndjson([replayLine, eventLine(start), eventLine(delta), eventLine(end), completeLine].map(encodeLine)));
    const handler = createClaudeAdapter({ fetch: fetchMock }).executeTurn(request);

    expect(await collect(handler.stream)).toEqual([start, { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: REPLAY_LABEL }, delta, end]);
    await expect(handler.complete).resolves.toEqual(response);
    expect(REPLAY_LABEL).toContain("Replay of a recorded answer");
  });

  it("labels only the first text message of a replayed turn", async () => {
    const second: AgAiEvent = { type: "TEXT_MESSAGE_START", messageId: "m2", role: "assistant" };
    const fetchMock = fetchReturning(ndjson([replayLine, eventLine(start), eventLine(end), eventLine(second), completeLine].map(encodeLine)));
    const events = await collect(createClaudeAdapter({ fetch: fetchMock }).executeTurn(request).stream);
    expect(events.filter((event) => event.type === "TEXT_MESSAGE_CONTENT")).toHaveLength(1);
  });

  it("does not label a live answer", async () => {
    const fetchMock = fetchReturning(ndjson([eventLine(start), eventLine(delta), completeLine].map(encodeLine)));
    expect(await collect(createClaudeAdapter({ fetch: fetchMock }).executeTurn(request).stream)).toEqual([start, delta]);
  });
});
