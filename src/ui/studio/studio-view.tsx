"use client";

/**
 * AG Studio for TwoKey: the Riverbend demo data, the achromatic-ledger theme, the balances strip and
 * the auditor agent. Browser-only: load it through ./studio-loader (next/dynamic, ssr: false).
 *
 * On a wide screen it opens in edit mode, with the "AI Assistant" panel open on the left; narrower
 * screens fold or drop the panels (./board-viewport.ts). Studio reads `ai`, the mode, the panels and
 * `initialState` once, so they live at module scope. The API it hands over goes to ./studio-handle:
 * on `onApiReady` for selecting widgets, and on `onStudioReady` (data engine up) for the session's
 * live board data, which the judge UI pushes there. Until the first live view arrives Studio shows
 * the seed data it starts with, so the first paint is unchanged.
 */
import {
  AgStudioAiModule,
  enableStudioDevValidations,
  type AgStudioApi,
  type AgStudioApiReadyEvent,
  type AgStudioPreDestroyedEvent,
  type AgStudioReadyEvent,
} from "ag-studio";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import { useCallback, useEffect, useRef } from "react";
import { AUDITOR_TOOL_DISPLAY } from "@/agents/studio/auditor-tools";
import { createClaudeAdapter } from "@/agents/studio/claude-adapter";
import { createTwoKeyAi } from "@/agents/studio/harness";
import { buildStudioData } from "@/demo/studio-data";
import { boardLocaleText } from "./board-layout";
import { boardStudioSetup, boardViewport } from "./board-viewport";
import { setStudioApi, setStudioDataApi } from "./studio-handle";
import { twoKeyCompactStudioTheme, twoKeyStudioTheme } from "./theme";
import { twoKeyWidgets, type TwoKeyRegistry } from "./widgets";
import "./studio-grid.css";

if (process.env.NODE_ENV !== "production") {
  enableStudioDevValidations();
}

type TwoKeyApi = AgStudioApi<TwoKeyRegistry>;

const studioData = buildStudioData<TwoKeyRegistry>();
const ai = createTwoKeyAi(createClaudeAdapter());
const modules = [AgStudioAiModule];
const studioStyle = { height: "100%", width: "100%" };
const layout = { widgetBorderEnabled: true };
// Browser-only module, so the width is known here; Studio reads the mode, panels and state once.
const setup = boardStudioSetup(boardViewport(window.innerWidth));
const theme = setup.compactCanvas ? twoKeyCompactStudioTheme : twoKeyStudioTheme;

export interface StudioViewProps {
  /** AG Studio licence key. Without one Studio still runs, with a licence watermark. */
  licenseKey?: string;
}

export function StudioView({ licenseKey }: StudioViewProps) {
  // The API this view handed to the handle. Kept across React's development double-mount, so the
  // remount can hand it back; cleared only when Studio itself is destroyed.
  const apiRef = useRef<TwoKeyApi | null>(null);

  const onApiReady = useCallback((event: AgStudioApiReadyEvent) => {
    // Studio's events carry the default-registry API type; this instance runs TwoKeyRegistry.
    const api = event.api as unknown as TwoKeyApi;
    apiRef.current = api;
    setStudioApi(api);
  }, []);

  // The data engine is up: from here the session's live data can replace the seed rows.
  const readyApiRef = useRef<TwoKeyApi | null>(null);
  const onStudioReady = useCallback((event: AgStudioReadyEvent) => {
    const api = event.api as unknown as TwoKeyApi;
    readyApiRef.current = api;
    setStudioDataApi(api);
  }, []);

  const onStudioPreDestroyed = useCallback((event: AgStudioPreDestroyedEvent) => {
    if ((event.api as unknown as TwoKeyApi) !== apiRef.current) return;
    apiRef.current = null;
    readyApiRef.current = null;
    setStudioApi(null);
    setStudioDataApi(null);
  }, []);

  useEffect(() => {
    if (apiRef.current) setStudioApi(apiRef.current);
    if (readyApiRef.current) setStudioDataApi(readyApiRef.current);
    return () => {
      setStudioApi(null);
      setStudioDataApi(null);
    };
  }, []);

  return (
    <AgStudioProvider licenseKey={licenseKey || undefined} modules={modules}>
      <AgStudio<TwoKeyRegistry>
        style={studioStyle}
        theme={theme}
        layout={layout}
        data={studioData}
        widgets={twoKeyWidgets}
        ai={ai}
        aiToolDisplay={AUDITOR_TOOL_DISPLAY}
        initialState={setup.initialState}
        localeText={boardLocaleText}
        mode={setup.mode}
        panels={setup.panels}
        onApiReady={onApiReady}
        onStudioReady={onStudioReady}
        onStudioPreDestroyed={onStudioPreDestroyed}
      />
    </AgStudioProvider>
  );
}

export default StudioView;
