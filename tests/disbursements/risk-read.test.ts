import { describe, expect, it } from "vitest";
import { currentRisk, findRequest, isRiskPending } from "@/ledger/request-projection";
import { AI_UNAVAILABLE_FINDING, runRiskRead } from "@/disbursements/risk-read";
import { rulesCard } from "../ledger/fixtures";
import { deps, harness, SESSION } from "./harness";

const aiCard = rulesCard({ origin: "live", model: "test-model", verdict: "check", summary: "Line 2 isn't league equipment." });

describe("runRiskRead", () => {
  it("appends the AI card once; it supersedes the rules card and ends the wait", async () => {
    const h = await harness({ ai: aiCard });
    expect(await runRiskRead(deps(h), SESSION, "L15")).toBe("ai_card");
    const state = findRequest(await h.ledger.read(SESSION), "L15")!;
    expect(currentRisk(state)?.card).toEqual(aiCard);
    expect(isRiskPending(state)).toBe(false);
    const [input, sessionId] = h.risk.aiCard.mock.calls[0]!;
    expect(input.request.requestId).toBe("L15");
    expect(sessionId).toBe(SESSION);
  });

  it("returns the stored card on later calls without asking the AI again", async () => {
    const h = await harness({ ai: aiCard });
    await runRiskRead(deps(h), SESSION, "L15");
    expect(await runRiskRead(deps(h), SESSION, "L15")).toBe("already_done");
    expect(h.risk.aiCard).toHaveBeenCalledTimes(1);
  });

  it("lets the rules card stand when the AI is unavailable, and records that it was tried", async () => {
    const h = await harness({ ai: null });
    expect(await runRiskRead(deps(h), SESSION, "L14")).toBe("rules_stand");
    const state = findRequest(await h.ledger.read(SESSION), "L14")!;
    expect(currentRisk(state)?.card).toMatchObject({ origin: "rules", verdict: "clear", findings: [AI_UNAVAILABLE_FINDING] });
    expect(isRiskPending(state)).toBe(false);
  });

  it("treats a failing AI read like an unavailable one", async () => {
    const h = await harness();
    h.risk.aiCard.mockRejectedValueOnce(new Error("upstream down"));
    expect(await runRiskRead(deps(h), SESSION, "L14")).toBe("rules_stand");
  });

  it("knows nothing of a request that isn't in the session", async () => {
    const h = await harness();
    expect(await runRiskRead(deps(h), SESSION, "R-404")).toBe("unknown_request");
    expect(h.risk.aiCard).not.toHaveBeenCalled();
  });
});
