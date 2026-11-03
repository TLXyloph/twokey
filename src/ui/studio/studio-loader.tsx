"use client";

/**
 * Loads ./studio-view in the browser only. AG Studio touches the DOM as it starts, so it must never
 * render on the server.
 */
import dynamic from "next/dynamic";
import type { StudioViewProps } from "./studio-view";

const StudioView = dynamic(() => import("./studio-view").then((mod) => mod.StudioView), {
  ssr: false,
  loading: () => (
    <div className="studio-loading" role="status">
      Loading the club dashboard…
    </div>
  ),
});

export function StudioLoader(props: StudioViewProps) {
  return <StudioView {...props} />;
}
