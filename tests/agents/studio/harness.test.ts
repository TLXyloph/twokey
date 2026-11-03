import type {
  AgAiAgentContext,
  AgAiHarnessBuilderContext,
  AgAiTool,
  AgAnyAiAgentDefinition,
  AgLlmAdapter,
  AgStudioApi,
} from "ag-studio";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ag-studio", () => ({
  directLlmRunner: vi.fn((config: object) => ({ ...config, run: vi.fn() })),
  createAiHarness: vi.fn(() => ({ kind: "fake-harness" })),
}));

const { createAiHarness, directLlmRunner } = await import("ag-studio");
const { AUDITOR_AGENT_ID, DELEGATE_TARGETS, PROMPT_STARTERS, buildHarnessConfig, createTwoKeyAi } = await import(
  "@/agents/studio/harness"
);
const { COMPARE_EVENT_TAKINGS_TOOL } = await import("@/agents/studio/auditor-tools");
const { riverbend } = await import("@/demo/riverbend");

// --- Doubles ------------------------------------------------------------------------------

const adapter: AgLlmAdapter = { executeTurn: vi.fn() };
const compareTool = { name: COMPARE_EVENT_TAKINGS_TOOL } as AgAiTool;
const delegateTool = { name: "delegate_to" } as AgAiTool;

function fakeApi() {
  return {
    defineAiTool: vi.fn(() => compareTool),
    getAiContext: () => ({ schema: () => ({ tables: [{ name: "Fundraising Events" }, { name: "Ledger" }, { name: "Balances" }] }) }),
  } as unknown as AgStudioApi;
}

function fakeBuilderContext() {
  const builtIn = Object.fromEntries(
    ["lead", "data", "page", "planning", "widget"].map((id) => [id, { id, name: `${id} agent`, description: id }]),
  ) as Record<string, AgAnyAiAgentDefinition>;
  const delegateTo = vi.fn(() => delegateTool);
  const ctx = { builtIn, tools: { delegateTo } } as unknown as AgAiHarnessBuilderContext;
  return { ctx, delegateTo };
}

type Runner = AgAnyAiAgentDefinition & { adapter: AgLlmAdapter };

// --- Tests --------------------------------------------------------------------------------

describe("buildHarnessConfig", () => {
  beforeEach(() => vi.clearAllMocks());

  it("makes the TwoKey auditor the primary agent", () => {
    const { ctx } = fakeBuilderContext();
    const config = buildHarnessConfig(fakeApi(), adapter, ctx, riverbend);

    expect(AUDITOR_AGENT_ID).toBe("twokey-auditor");
    expect(config.primary).toBe(AUDITOR_AGENT_ID);
    expect(config.agents.map((a) => a.id)).toEqual(["twokey-auditor", "data", "page", "widget"]);
  });

  it("runs every agent, auditor and built-ins, on the Claude adapter via directLlmRunner", () => {
    const { ctx } = fakeBuilderContext();
    const config = buildHarnessConfig(fakeApi(), adapter, ctx, riverbend);

    expect(directLlmRunner).toHaveBeenCalledTimes(4);
    for (const agent of config.agents) expect((agent as unknown as Runner).adapter).toBe(adapter);
  });

  it("registers the built-ins it delegates to as they are, re-pointed at the adapter", () => {
    const { ctx } = fakeBuilderContext();
    buildHarnessConfig(fakeApi(), adapter, ctx, riverbend);

    for (const id of DELEGATE_TARGETS) {
      expect(directLlmRunner).toHaveBeenCalledWith({ ...ctx.builtIn[id], adapter });
    }
    expect(DELEGATE_TARGETS).toEqual(["data", "page", "widget"]);
  });

  it("declares the auditor as a parameterless agent", () => {
    const { ctx } = fakeBuilderContext();
    const [auditor] = buildHarnessConfig(fakeApi(), adapter, ctx, riverbend).agents;
    const undefinedShape = { kind: "undefined" };
    const s = { undefined: vi.fn(() => undefinedShape) };

    expect(auditor?.schema?.(s as never)).toBe(undefinedShape);
    expect(auditor?.name).toBeTruthy();
    expect(auditor?.description).toBeTruthy();
  });

  it("gives the auditor its own tool plus delegate_to the data, page and widget agents", () => {
    const { ctx, delegateTo } = fakeBuilderContext();
    const api = fakeApi();
    const [auditor] = buildHarnessConfig(api, adapter, ctx, riverbend).agents;

    const agentCtx = { api, tools: ctx.tools } as unknown as AgAiAgentContext;
    const tools = auditor?.tools?.(agentCtx, undefined);

    expect(tools).toEqual([compareTool, delegateTool]);
    expect(delegateTo).toHaveBeenCalledWith(["data", "page", "widget"]);
    expect(api.defineAiTool).toHaveBeenCalledTimes(1);
    // Built once, not on every turn.
    auditor?.tools?.(agentCtx, undefined);
    expect(api.defineAiTool).toHaveBeenCalledTimes(1);
  });

  it("instructs the auditor to cite numbers, delegate building, and never claim money moved", () => {
    const { ctx } = fakeBuilderContext();
    const api = fakeApi();
    const [auditor] = buildHarnessConfig(api, adapter, ctx, riverbend).agents;
    const text = auditor?.instructions?.({ api } as unknown as AgAiAgentContext, undefined) ?? "";

    expect(text).toMatch(/auditor/i);
    expect(text).toMatch(/volunteer/i);
    expect(text).toMatch(/cite/i);
    expect(text).toMatch(/never (say|claim) .*money/i);
    expect(text).toContain(COMPARE_EVENT_TAKINGS_TOOL);
    expect(text).toMatch(/delegate_to/);
    expect(text).toContain("Ledger");
  });

  it("offers prompt starters, including the car-wash question", () => {
    const { ctx } = fakeBuilderContext();
    const config = buildHarnessConfig(fakeApi(), adapter, ctx, riverbend);

    expect(config.promptStarters).toBe(PROMPT_STARTERS);
    expect(PROMPT_STARTERS.map((p) => p.prompt)).toContain("Where did the car-wash money go?");
  });

  it("builds something new from the building starter, never by editing the designed board", () => {
    const building = PROMPT_STARTERS.find((p) => p.label === "Show the car-wash rows");
    expect(building?.prompt).toMatch(/new widget below the board/i);
    // A starter that asks for "a chart comparing expected and received" rewrote the board's own chart
    // on the live demo (2026-11-03): it swapped the series, so expected took the club maroon.
    for (const { prompt } of PROMPT_STARTERS) expect(prompt).not.toMatch(/add a chart comparing/i);
  });

  it("keeps the designed board, the narrow panel and the club's time zone in the auditor's rules", () => {
    const { ctx } = fakeBuilderContext();
    const api = fakeApi();
    const [auditor] = buildHarnessConfig(api, adapter, ctx, riverbend).agents;
    const text = auditor?.instructions?.({ api } as unknown as AgAiAgentContext, undefined) ?? "";

    expect(text).toMatch(/do not change .*existing widgets/i);
    expect(text).toMatch(/received first/i);
    expect(text).toMatch(/no tables/i);
    expect(text).toContain("America/Chicago");
  });
});

describe("createTwoKeyAi", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a setup that builds Studio's harness from the auditor config", () => {
    const setup = createTwoKeyAi(adapter, riverbend);
    expect(typeof setup).toBe("function");

    const api = fakeApi();
    const harness = (setup as (params: { api: AgStudioApi; context: unknown }) => unknown)({ api, context: undefined });

    expect(harness).toEqual({ kind: "fake-harness" });
    expect(createAiHarness).toHaveBeenCalledWith(api, expect.any(Function));

    const build = vi.mocked(createAiHarness).mock.calls[0]![1] as (ctx: AgAiHarnessBuilderContext) => { primary: string };
    expect(build(fakeBuilderContext().ctx).primary).toBe(AUDITOR_AGENT_ID);
  });
});
