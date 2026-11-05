"use client";

/**
 * The working part of /demo/keys: the setup steps beside "Who holds the keys", both reading the
 * same step count, and the live board view the panel's signatures and Watchtower line come from.
 *
 * At 1440 the two sit side by side, the steps on the left (what to do) and the panel on the right
 * (what everyone sees change): 1392 = 528 + 24 + 840. Under 1100 they stack, steps first.
 */
import { useBoardView } from "@/ui/judge/use-judge";
import { useLiveBoardView } from "@/ui/judge/use-live-board";
import { useWatchtower } from "@/ui/watchtower/use-watchtower";
import { KeyChecklist } from "./key-checklist";
import { keyStepsStore } from "./keys-store";
import { useKeySteps, useSettled } from "./use-key-steps";
import { WhoHoldsTheKeys } from "./who-holds-the-keys";
import "./keys.css";

export function KeysScreen() {
  useLiveBoardView();
  const done = useKeySteps();
  const settled = useSettled();
  const { view } = useBoardView();
  const watch = useWatchtower();
  return (
    <div className="keys-grid">
      <KeyChecklist done={done} onAdvance={keyStepsStore.advance} onBack={keyStepsStore.back} onReset={keyStepsStore.reset} />
      <WhoHoldsTheKeys done={done} view={view} watch={watch} settled={settled} />
    </div>
  );
}
