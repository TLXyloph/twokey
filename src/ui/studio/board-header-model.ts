/**
 * What the board's header says, computed from the demo rows: the club it is scoped to, the screen's
 * name, the finding it leads with and the one action it offers. Kept free of React so the copy is
 * tested against the same figures the widgets aggregate.
 */
import { boardFinding, secondKeyQueue } from "@/demo/board-figures";
import { CLUB_SHORT_NAME, riverbend, type ClubDemoData } from "@/demo/riverbend";

export interface BoardHeaderModel {
  club: string;
  /** The screen's h1: a noun, not a greeting. */
  title: string;
  /** The auditor's finding, read first under the title. */
  finding: string;
  /** The primary action, or null when nothing is waiting for a second key. */
  review: { count: number; label: string } | null;
}

export const reviewLabel = (count: number) => `Review ${count} ${count === 1 ? "payout" : "payouts"}`;

export function boardHeaderModel(data: ClubDemoData = riverbend): BoardHeaderModel {
  const { count } = secondKeyQueue(data);
  return {
    club: CLUB_SHORT_NAME,
    title: "Club account",
    finding: boardFinding(data),
    review: count > 0 ? { count, label: reviewLabel(count) } : null,
  };
}
