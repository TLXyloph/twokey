import type { Metadata } from "next";
import { CLOSE_MONTH_NAME } from "@/close/contracts";
import { recordedDraftFor } from "@/close/draft";
import { closeHash, octoberClose } from "@/close/october";
import recordedDraft from "@/close/recorded-draft.json";
import { COMMITTED_REVIEWER_KEY, isPublished } from "@/close/reviewer-key";
import { CloseScreen } from "@/ui/close/close-screen";
import { JudgePanel } from "@/ui/judge/judge-panel";
import { boardCssVars } from "@/ui/studio/tokens";
import "@/ui/studio/board.css";
import "@/ui/close/close.css";
import "@/ui/close/close-rail.css";

export const metadata: Metadata = {
  title: `Monthly close, ${CLOSE_MONTH_NAME} · TwoKey`,
  description: "The Riverbend Youth Football League's October 2026 reconciliation, drafted by the AI and signed by a non-signer (demo data).",
};

/**
 * The monthly close (/demo/close): the judge band, then the Reviewer's screen (src/ui/close). A
 * server component: the close is computed from the seed and the draft read from the committed
 * recording here, so the figures are in the first paint. Only this session's sign-off is read in
 * the browser (GET /api/close).
 */
export default async function ClosePage() {
  const figures = octoberClose();
  const hash = await closeHash(figures);
  return (
    <main className="close" style={boardCssVars}>
      <JudgePanel />
      <CloseScreen
        initial={{
          monthName: CLOSE_MONTH_NAME,
          figures,
          closeHash: hash,
          draft: recordedDraftFor(recordedDraft, hash),
          reviewerKey: isPublished(COMMITTED_REVIEWER_KEY) ? { keyId: COMMITTED_REVIEWER_KEY.keyId } : null,
        }}
      />
    </main>
  );
}
