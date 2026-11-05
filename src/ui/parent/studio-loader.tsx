"use client";

/**
 * Loads the parent's AG Studio in the browser only (it touches the DOM as it starts). While it loads,
 * a panel of the ground's tone holds its place, so the page below does not jump.
 */
import dynamic from "next/dynamic";
import type { ParentStudioViewProps } from "./studio-view";

const ParentStudioView = dynamic(() => import("./studio-view").then((mod) => mod.ParentStudioView), {
  ssr: false,
  loading: () => (
    <p className="books__loading" role="status">
      Opening the club&apos;s books…
    </p>
  ),
});

export function ParentStudioLoader(props: ParentStudioViewProps) {
  return <ParentStudioView {...props} />;
}
