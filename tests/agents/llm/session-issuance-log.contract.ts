/**
 * Behaviour every SessionIssuanceLog must have, run against the in-memory log and the D1 log (on
 * real SQLite with the real migration). Not a test file itself: the two suites import it.
 */
import { describe, expect, it } from "vitest";
import type { SessionIssuance, SessionIssuanceLog } from "@/agents/llm/session-issuance-log";

const HOUR = 3_600_000;
const T0 = 1_790_000_000_000;
const limit = { perWindow: 5, windowMs: HOUR };
const issuance = (n: number, over: Partial<SessionIssuance> = {}): SessionIssuance => ({
  sessionId: `session-${n}`,
  ipHmac: "a".repeat(64),
  at: T0 + n,
  ...over,
});

export function describeSessionIssuanceLog(name: string, makeLog: () => SessionIssuanceLog): void {
  describe(`${name}: per-IP session cap`, () => {
    it("issues up to the cap for one IP within the hour, then refuses", async () => {
      const log = makeLog();
      for (let n = 0; n < 5; n++) expect(await log.issue(issuance(n), limit)).toBe("issued");
      expect(await log.issue(issuance(5), limit)).toBe("ip_limited");
    });

    it("counts each IP on its own", async () => {
      const log = makeLog();
      for (let n = 0; n < 5; n++) await log.issue(issuance(n), limit);
      expect(await log.issue(issuance(5, { ipHmac: "b".repeat(64) }), limit)).toBe("issued");
    });

    it("issues again once the oldest issuance leaves the rolling hour", async () => {
      const log = makeLog();
      for (let n = 0; n < 5; n++) await log.issue(issuance(n), limit);
      expect(await log.issue(issuance(5, { at: T0 + HOUR - 1 }), limit)).toBe("ip_limited");
      expect(await log.issue(issuance(6, { at: T0 + HOUR }), limit)).toBe("issued");
    });

    it("does not count a refused issuance", async () => {
      const log = makeLog();
      const tight = { perWindow: 1, windowMs: HOUR };
      expect(await log.issue(issuance(0), tight)).toBe("issued");
      expect(await log.issue(issuance(1), tight)).toBe("ip_limited");
      expect(await log.issue(issuance(2, { at: T0 + HOUR }), tight)).toBe("issued");
    });
  });
}
