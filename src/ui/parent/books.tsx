"use client";

/**
 * The club's books: AG Studio from 720px, the stacked version below it. CSS decides which one shows
 * (so a phone gets the server-rendered stacked books with no flash); script decides whether Studio
 * loads at all, so a phone never downloads it. Once loaded, Studio stays: narrowing the window below
 * 720px only hides it.
 */
import { useEffect, useState, type CSSProperties } from "react";
import { PARENT_BREAKPOINTS, STUDIO_HEIGHTS } from "./parent-grid";
import { StackedBooks } from "./stacked-books";
import { ParentStudioLoader } from "./studio-loader";

const STUDIO_QUERY = `(min-width: ${PARENT_BREAKPOINTS.studio}px)`;

/** The place Studio will take, sized before it loads (the heights come from the canvas layout). */
const studioPlace = {
  "--books-wide": `${STUDIO_HEIGHTS.wide}px`,
  "--books-medium": `${STUDIO_HEIGHTS.medium}px`,
} as CSSProperties;

function useStudioFits(): boolean {
  const [fits, setFits] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(STUDIO_QUERY);
    const update = () => {
      if (query.matches) setFits(true);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return fits;
}

export function BooksBody({ licenseKey }: { licenseKey?: string }) {
  const fits = useStudioFits();
  return (
    <>
      <div className="books__studio" style={studioPlace}>
        {fits ? (
          <ParentStudioLoader licenseKey={licenseKey} />
        ) : (
          <p className="books__loading" role="status">
            Opening the club&apos;s books…
          </p>
        )}
      </div>
      <StackedBooks />
    </>
  );
}
