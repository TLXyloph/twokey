"use client";

/**
 * The parent ledger's AG Studio: a second instance, apart from the board's (src/ui/studio/studio-view.tsx),
 * with its own page and layout (./parent-layout.ts), its own team-colour theme (./theme.ts), its own
 * widget registry (./widgets.ts, with the custom balance widget) and its own data handle
 * (./parent-handle.ts). Browser-only: load it through ./studio-loader.tsx (next/dynamic, ssr: false).
 *
 * Read-only for parents: view mode, no panels, and no AI Assistant. The assistant's harness
 * (src/agents/studio/harness.ts) edits pages and was recorded against the board's page, so it stays
 * on the board.
 */
import { enableStudioDevValidations, type AgStudioPreDestroyedEvent, type AgStudioReadyEvent } from "ag-studio";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import { useCallback, useEffect, useRef } from "react";
import { parentStudioData } from "./parent-data";
import { parentStudio, type DataApi } from "./parent-handle";
import { parentLocaleText, parentStudioSetup } from "./parent-layout";
import { parentWidgets, type ParentRegistry } from "./widgets";
import "@/ui/studio/studio-grid.css";

if (process.env.NODE_ENV !== "production") {
  enableStudioDevValidations();
}

const studioData = parentStudioData<ParentRegistry>();
const layout = { widgetBorderEnabled: false };
// Browser-only module, so the width is known here; Studio reads the mode, panels and state once.
const setup = parentStudioSetup(window.innerWidth);
const studioStyle = { height: `${setup.heightPx}px`, width: "100%" };

export interface ParentStudioViewProps {
  /** AG Studio licence key. Without one Studio still runs, with its trial watermark. */
  licenseKey?: string;
}

export function ParentStudioView({ licenseKey }: ParentStudioViewProps) {
  // The API this view handed over, kept across React's development double-mount.
  const apiRef = useRef<DataApi | null>(null);

  const onStudioReady = useCallback((event: AgStudioReadyEvent) => {
    const api = event.api as unknown as DataApi;
    apiRef.current = api;
    parentStudio.setDataApi(api);
  }, []);

  const onStudioPreDestroyed = useCallback((event: AgStudioPreDestroyedEvent) => {
    if ((event.api as unknown as DataApi) !== apiRef.current) return;
    apiRef.current = null;
    parentStudio.setDataApi(null);
  }, []);

  useEffect(() => {
    if (apiRef.current) parentStudio.setDataApi(apiRef.current);
    return () => parentStudio.setDataApi(null);
  }, []);

  return (
    <AgStudioProvider licenseKey={licenseKey || undefined}>
      <AgStudio<ParentRegistry>
        studioId="twokey-parent-ledger"
        style={studioStyle}
        theme={setup.theme}
        layout={layout}
        data={studioData}
        widgets={parentWidgets}
        initialState={setup.initialState}
        localeText={parentLocaleText}
        mode={setup.mode}
        panels={setup.panels}
        onStudioReady={onStudioReady}
        onStudioPreDestroyed={onStudioPreDestroyed}
      />
    </AgStudioProvider>
  );
}

export default ParentStudioView;
