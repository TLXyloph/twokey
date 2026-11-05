/**
 * React's view of the key-setup steps, and the "ready" flag that lets changes animate only after the
 * page has settled (the first paint, and the steps restored from storage, never animate).
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { keyStepsStore } from "./keys-store";

export function useKeySteps(): number {
  return useSyncExternalStore(keyStepsStore.subscribe, keyStepsStore.get, () => 0);
}

/** False through hydration and the first frames after it; true once later changes should move. */
export function useSettled(): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setSettled(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, []);
  return settled;
}
