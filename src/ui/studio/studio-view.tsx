"use client";

/**
 * AG Studio for TwoKey: the Riverbend demo data, the placeholder theme, the Live Balance widget and
 * the auditor agent. Browser-only: load it through ./studio-loader (next/dynamic, ssr: false).
 *
 * It opens in edit mode, where the "AI Assistant" panel is on the left and expanded. Studio reads
 * `ai` and `initialState` once, so both live at module scope.
 */
import { AgStudioAiModule, enableStudioDevValidations, type AgReportState, type AgWidgetLayoutState } from "ag-studio";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import { AUDITOR_TOOL_DISPLAY } from "@/agents/studio/auditor-tools";
import { createClaudeAdapter } from "@/agents/studio/claude-adapter";
import { createTwoKeyAi } from "@/agents/studio/harness";
import { buildStudioData } from "@/demo/studio-data";
import { twoKeyStudioTheme } from "./theme";
import { LIVE_BALANCE_WIDGET_TYPE, twoKeyWidgets, type TwoKeyRegistry } from "./widgets";

if (process.env.NODE_ENV !== "production") {
  enableStudioDevValidations();
}

// Position on the canvas grid, in tracks: 24 columns wide.
const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({ xTrack, yTrack, xSpan, ySpan });

const PAGE_ID = "club-account";

const initialState: AgReportState<TwoKeyRegistry> = {
  selectedPageId: PAGE_ID,
  pages: [
    {
      id: PAGE_ID,
      widgets: {
        "live-balance": {
          type: LIVE_BALANCE_WIDGET_TYPE,
          dataMapping: {
            value: [{ id: "balances.available", aggregation: "sum" }],
            asOf: [{ id: "balances.asOf", aggregation: "last" }],
          },
          format: { title: { enabled: true, text: "Live balance" } },
        },
        "event-takings": {
          type: "grid",
          dataMapping: {
            cols: [
              { id: "events.name" },
              { id: "events.date" },
              { id: "events.unitsLogged", aggregation: "sum" },
              { id: "events.expected", aggregation: "sum" },
              { id: "events.received", aggregation: "sum" },
              { id: "events.gap", aggregation: "sum" },
            ],
          },
          sort: [{ field: { id: "events.date" }, direction: "asc" }],
          format: { title: { enabled: true, text: "Fundraising events: expected vs received" } },
        },
      },
      widgetLayout: {
        "live-balance": at(0, 0, 8, 10),
        "event-takings": at(0, 10, 24, 14),
      },
    },
  ],
  // Leave the AI Assistant panel open; fold the right-hand panels away to give the canvas room.
  panels: { filters: { collapsed: true }, edit: { collapsed: true }, data: { collapsed: true } },
};

const studioData = buildStudioData<TwoKeyRegistry>();
const ai = createTwoKeyAi(createClaudeAdapter());
const modules = [AgStudioAiModule];
const studioStyle = { height: "100%", width: "100%" };

export interface StudioViewProps {
  /** AG Studio licence key. Without one Studio still runs, with a licence watermark. */
  licenseKey?: string;
}

export function StudioView({ licenseKey }: StudioViewProps) {
  return (
    <AgStudioProvider licenseKey={licenseKey || undefined} modules={modules}>
      <AgStudio<TwoKeyRegistry>
        style={studioStyle}
        theme={twoKeyStudioTheme}
        layout={{ widgetBorderEnabled: true }}
        data={studioData}
        widgets={twoKeyWidgets}
        ai={ai}
        aiToolDisplay={AUDITOR_TOOL_DISPLAY}
        initialState={initialState}
        mode="edit"
      />
    </AgStudioProvider>
  );
}

export default StudioView;
