import type { AgAiParamsBuilder, AgAiTool, AgAiToolContext, AgAiToolResult, AgStudioApi } from "ag-studio";
import { describe, expect, it, vi } from "vitest";
import {
  COMPARE_EVENT_TAKINGS_TOOL,
  compareEventTakings,
  createCompareEventTakingsTool,
  describeComparison,
} from "@/agents/studio/auditor-tools";
import { riverbend, type ClubDemoData } from "@/demo/riverbend";

// --- Doubles ------------------------------------------------------------------------------

type ToolConfig = {
  name: string;
  description: string;
  params: (s: AgAiParamsBuilder) => unknown;
  execute: (args: Record<string, unknown>, ctx: AgAiToolContext) => Promise<AgAiToolResult> | AgAiToolResult;
};

function fakeApi() {
  const fakeTool = { name: COMPARE_EVENT_TAKINGS_TOOL } as AgAiTool;
  const defineAiTool = vi.fn((_config: unknown) => fakeTool);
  const api = { defineAiTool } as unknown as Pick<AgStudioApi, "defineAiTool">;
  const config = () => defineAiTool.mock.calls[0]![0] as ToolConfig;
  return { api, defineAiTool, fakeTool, config };
}

function fakeContext(): AgAiToolContext {
  return {
    signal: new AbortController().signal,
    run: { threadId: "t1", runId: "r1" },
    success: (response, data) => ({ success: true, response, data }),
    error: (messages) => ({
      success: false,
      issues: (Array.isArray(messages) ? messages : [messages]).map((message) => ({ message })),
    }),
  };
}

function fakeBuilder() {
  const optionalEnum = { kind: "optional-enum" };
  const enumShape = { optional: vi.fn(() => optionalEnum) };
  const s = {
    enum: vi.fn(() => enumShape),
    object: vi.fn((definition: unknown) => ({ kind: "object", definition })),
  };
  return { s: s as unknown as AgAiParamsBuilder, spies: s, optionalEnum };
}

// --- Computation ----------------------------------------------------------------------------

describe("compareEventTakings", () => {
  it("finds the car wash short: 87 x $15 = $1,305 expected, $15 received", () => {
    const { events } = compareEventTakings(riverbend);
    const carWash = events.find((e) => e.eventId === "car-wash");

    expect(carWash).toMatchObject({
      event: "Car wash",
      unitsLogged: 87,
      unitPrice: 15,
      expected: 1305,
      received: 15,
      gap: 1290,
      status: "short",
      ledgerReceived: 15,
    });
    expect(carWash?.deposits).toEqual([
      { ledgerId: "L10", date: "2026-10-24", description: "Car wash, PayPal payment (1 car)", amount: 15 },
    ]);
  });

  it("marks events whose takings match as reconciled", () => {
    const { events } = compareEventTakings(riverbend);
    expect(events.filter((e) => e.status === "reconciled").map((e) => e.eventId).sort()).toEqual(["fun-run", "spirit-wear"]);
    expect(events.every((e) => e.status !== "reconciled" || e.gap === 0)).toBe(true);
  });

  it("totals expected, received and the gap across events", () => {
    expect(compareEventTakings(riverbend).totals).toEqual({ expected: 3665, received: 2375, gap: 1290 });
  });

  it("narrows to one event when asked", () => {
    const { events, totals } = compareEventTakings(riverbend, "fun-run");
    expect(events.map((e) => e.eventId)).toEqual(["fun-run"]);
    expect(totals).toEqual({ expected: 1280, received: 1280, gap: 0 });
  });

  it("lists events in date order", () => {
    expect(compareEventTakings(riverbend).events.map((e) => e.eventId)).toEqual(["fun-run", "spirit-wear", "car-wash"]);
  });

  it("only counts completed money in as deposits", () => {
    const data: ClubDemoData = {
      ...riverbend,
      events: [{ ...riverbend.events[0]!, id: "x", expected: 100, received: 100, unitsLogged: 5, unitPrice: 20 }],
      ledger: [
        { id: "A", date: "2026-10-01", description: "in", counterparty: "c", category: "f", direction: "in", amount: 100, status: "completed", eventId: "x" },
        { id: "B", date: "2026-10-01", description: "cost", counterparty: "c", category: "f", direction: "out", amount: -40, status: "completed", eventId: "x" },
        { id: "C", date: "2026-10-01", description: "later", counterparty: "c", category: "f", direction: "in", amount: 9, status: "pending", eventId: "x" },
      ],
    };
    const [event] = compareEventTakings(data).events;
    expect(event?.deposits.map((d) => d.ledgerId)).toEqual(["A"]);
    expect(event?.ledgerReceived).toBe(100);
  });

  it("marks an event that took more than expected as over", () => {
    const data: ClubDemoData = {
      ...riverbend,
      events: [{ ...riverbend.events[0]!, id: "x", expected: 100, received: 120 }],
      ledger: [],
    };
    expect(compareEventTakings(data).events[0]).toMatchObject({ status: "over", gap: -20 });
  });
});

describe("describeComparison", () => {
  it("leads with totals, cites each event's figures and the recorded deposits", () => {
    const text = describeComparison(compareEventTakings(riverbend));

    expect(text).toMatch(/demo data/i);
    expect(text).toContain("expected $3,665.00");
    expect(text).toContain("Car wash (2026-10-24): 87 cars x $15.00 = $1,305.00 expected; $15.00 received; short by $1,290.00");
    expect(text).toContain("L10");
    expect(text).toMatch(/Fun run .*reconciled/);
  });

  it("states what a gap means without claiming money moved", () => {
    const text = describeComparison(compareEventTakings(riverbend));
    expect(text).toMatch(/no record/i);
    expect(text).not.toMatch(/stolen|missing money|took the money/i);
  });

  it("flags an event whose recorded takings disagree with its ledger rows", () => {
    const data: ClubDemoData = { ...riverbend, events: [{ ...riverbend.events[0]!, received: 1300, expected: 1300 }] };
    expect(describeComparison(compareEventTakings(data))).toMatch(/ledger rows tagged to it sum to \$1,280\.00/);
  });
});

// --- The Studio tool ------------------------------------------------------------------------

describe("createCompareEventTakingsTool", () => {
  it("defines one client tool named compare_event_takings through the Studio API", () => {
    const { api, defineAiTool, fakeTool, config } = fakeApi();
    expect(createCompareEventTakingsTool(api, riverbend)).toBe(fakeTool);

    expect(defineAiTool).toHaveBeenCalledTimes(1);
    expect(config().name).toBe(COMPARE_EVENT_TAKINGS_TOOL);
    expect(config().description).toMatch(/expected/i);
  });

  it("takes an optional eventId, limited to the events in the data", () => {
    const { api, config } = fakeApi();
    createCompareEventTakingsTool(api, riverbend);
    const { s, spies, optionalEnum } = fakeBuilder();

    const shape = config().params(s);

    expect(spies.enum).toHaveBeenCalledWith(["fun-run", "spirit-wear", "car-wash"], expect.anything());
    expect(spies.object).toHaveBeenCalledWith({ eventId: optionalEnum });
    expect(shape).toEqual({ kind: "object", definition: { eventId: optionalEnum } });
  });

  it("answers with the comparison as text for the model and as structured data", async () => {
    const { api, config } = fakeApi();
    createCompareEventTakingsTool(api, riverbend);

    const result = await config().execute({}, fakeContext());

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.response).toBe(describeComparison(compareEventTakings(riverbend)));
    expect(result.data).toEqual(compareEventTakings(riverbend));
  });

  it("narrows to the requested event", async () => {
    const { api, config } = fakeApi();
    createCompareEventTakingsTool(api, riverbend);

    const result = await config().execute({ eventId: "car-wash" }, fakeContext());

    expect(result.success && result.data).toEqual(compareEventTakings(riverbend, "car-wash"));
  });

  it("reports an unknown event as a tool error the model can correct", async () => {
    const { api, config } = fakeApi();
    createCompareEventTakingsTool(api, riverbend);

    const result = await config().execute({ eventId: "bake-sale" }, fakeContext());

    expect(result).toEqual({ success: false, issues: [expect.objectContaining({ message: expect.stringMatching(/bake-sale/) })] });
  });
});
