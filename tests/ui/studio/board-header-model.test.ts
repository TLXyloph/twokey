import { describe, expect, it } from "vitest";
import { boardFinding, secondKeyQueue } from "@/demo/board-figures";
import { CLUB_SHORT_NAME, riverbend, type ClubDemoData } from "@/demo/riverbend";
import { boardHeaderModel, reviewLabel } from "@/ui/studio/board-header-model";

const withoutPending = (data: ClubDemoData): ClubDemoData => ({
  ...data,
  ledger: data.ledger.filter((row) => row.status !== "pending"),
});

describe("board header model", () => {
  it("names the club and the screen, and leads with the board's finding", () => {
    const model = boardHeaderModel();
    expect(model.club).toBe(CLUB_SHORT_NAME);
    expect(model.title).toBe("Club account");
    expect(model.finding).toBe(boardFinding(riverbend));
  });

  it("builds the review action from the same queue the waiting grid shows", () => {
    const { count } = secondKeyQueue(riverbend);
    expect(boardHeaderModel().review).toEqual({ count, label: `Review ${count} payouts` });
  });

  it("offers no review action when nothing is waiting for a second key", () => {
    expect(boardHeaderModel(withoutPending(riverbend)).review).toBeNull();
  });
});

describe("reviewLabel", () => {
  it("counts payouts in words a treasurer would use", () => {
    expect(reviewLabel(1)).toBe("Review 1 payout");
    expect(reviewLabel(2)).toBe("Review 2 payouts");
    expect(reviewLabel(12)).toBe("Review 12 payouts");
  });
});
