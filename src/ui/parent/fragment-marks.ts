/**
 * Each of AG Studio's widgets on the parent ledger is a real piece of the club's books: a table with
 * its rules, a chart, the balance with its labels. The page marks each widget's box as an interface
 * fragment (`data-ui`), the attribute the design rules use for a real interface shown on a page, so its
 * own conventions (table rules, a label over a figure) are judged as an interface's. Studio's canvas as
 * a whole is too tall to be one fragment (it is most of a page), so each widget is marked on its own.
 *
 * Studio renders its widgets itself, after it loads, so the books' place watches for them
 * (./books.tsx). Only additions are watched, never attributes, so the marks never wake the watcher.
 */

/** The box Studio draws around each widget on its canvas. */
export const STUDIO_WIDGET_SELECTOR = ".ag-studio-layout-widget";

/** Marks every unmarked widget under `root`; returns how many it marked. */
export function markFragments(root: ParentNode): number {
  let marked = 0;
  for (const widget of root.querySelectorAll(STUDIO_WIDGET_SELECTOR)) {
    if (widget.hasAttribute("data-ui")) continue;
    widget.setAttribute("data-ui", "");
    marked += 1;
  }
  return marked;
}

/** What `watchFragments` needs of a MutationObserver (a stand-in in tests). */
export type FragmentObserverCtor = new (callback: MutationCallback) => Pick<MutationObserver, "observe" | "disconnect">;

/** Marks Studio's widgets now and as Studio adds them; returns the function that stops watching. */
export function watchFragments(root: Element, Observer: FragmentObserverCtor = MutationObserver): () => void {
  markFragments(root);
  const observer = new Observer(() => {
    markFragments(root);
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}
