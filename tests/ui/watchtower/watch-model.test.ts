import { describe, expect, it } from "vitest";
import {
  atClubTime,
  clubClock,
  findingSentence,
  findingText,
  formatDelay,
  keepTimesTogether,
  newestFirst,
  STATUS_UNAVAILABLE,
  statusAlert,
  statusLine,
  watchAlerts,
} from "@/ui/watchtower/watch-model";
import { finding, LOCAL_TEST_PAYOUT, NOW, SETUP_PAYOUTS, STRANGER_SEND, TREASURER_SEND, watchtowerView } from "../../fixtures/watchtower-view";

describe("club times", () => {
  it("says the time alone today and the date on another day, in the club's zone", () => {
    expect(atClubTime("2026-11-05T16:20:00Z", NOW)).toBe("at 10:20 AM");
    expect(atClubTime("2026-11-05T04:20:00Z", NOW)).toBe("on Nov 4 at 10:20 PM");
    expect(clubClock("2026-11-05T08:59:59Z", NOW)).toBe("2:59 AM");
    expect(clubClock("2026-11-04T05:59:59Z", NOW)).toBe("Nov 3, 11:59 PM");
  });

  it("writes a delay in hours and minutes", () => {
    expect(formatDelay(52)).toBe("52 min");
    expect(formatDelay(120)).toBe("2 h");
    expect(formatDelay(112)).toBe("1 h 52 min");
    expect(formatDelay(-3)).toBe("0 min");
  });

  it("keeps a time and a delay on one line", () => {
    expect(keepTimesTogether("PayPal recorded it on Nov 3, 2:27 PM CST.")).toBe("PayPal recorded it on Nov 3, 2:27 PM CST.");
    expect(keepTimesTogether("PayPal reported it 1 h 52 min later.")).toBe("PayPal reported it 1 h 52 min later.");
  });
});

describe("the status line", () => {
  it("says when the Watchtower checked and how fresh PayPal's records are", () => {
    const line = statusLine(watchtowerView({ status: "ok", paypalAsOf: "2026-11-05T15:29:59Z" }), NOW);
    expect(line).toEqual({
      tone: "neutral",
      stamp: "Watchtower checked PayPal at 10:20 AM · PayPal's records as of 9:29 AM CST",
      sentence: null,
      text: "Watchtower checked PayPal at 10:20 AM · PayPal's records as of 9:29 AM CST",
    });
  });

  it("says plainly when PayPal's reports are late (today's real state)", () => {
    const line = statusLine(watchtowerView(), NOW);
    expect(line.tone).toBe("notice");
    expect(line.text).toBe(
      "Watchtower checked PayPal at 10:20 AM · PayPal's records as of 2:59 AM CST. PayPal's reports are running late, so recent money may not show yet.",
    );
  });

  it("dates a check from another day", () => {
    const line = statusLine(watchtowerView({ status: "ok", checkedAt: "2026-11-04T22:20:00Z", paypalAsOf: "2026-11-04T21:29:59Z" }), NOW);
    expect(line.text).toBe("Watchtower checked PayPal on Nov 4 at 4:20 PM · PayPal's records as of Nov 4, 3:29 PM CST");
  });

  it("says when it last got through after losing access or going quiet", () => {
    expect(statusLine(watchtowerView({ status: "no_access", checkedAt: "2026-11-05T15:40:00Z" }), NOW)).toMatchObject({
      tone: "alert",
      text: "Watchtower last reached PayPal at 9:40 AM · PayPal's records as of 2:59 AM CST",
    });
    expect(statusLine(watchtowerView({ status: "silent", checkedAt: "2026-11-05T15:10:00Z" }), NOW)).toMatchObject({
      tone: "alert",
      text: "Watchtower last checked PayPal at 9:10 AM · PayPal's records as of 2:59 AM CST",
    });
  });

  it("says the Watchtower hasn't started, and shows nothing broken when it can't be read", () => {
    const fresh = watchtowerView({ status: "not_started", checkedAt: null, paypalAsOf: null, findings: [] });
    expect(statusLine(fresh, NOW)).toMatchObject({ tone: "neutral", text: "The Watchtower hasn't checked PayPal yet." });
    expect(statusLine(null, NOW)).toMatchObject({ tone: "neutral", text: STATUS_UNAVAILABLE });
    expect(statusLine(undefined, NOW).text).toBe("Watchtower status unavailable");
  });

  it("never promises minutes for PayPal's delay", () => {
    for (const status of ["ok", "stale_reports", "no_access", "silent", "not_started"] as const) {
      expect(statusLine(watchtowerView({ status }), NOW).text).not.toMatch(/within \d+ min/);
    }
  });
});

describe("a status that is an alert", () => {
  it("tells every officer to check the account when access is lost", () => {
    expect(statusAlert(watchtowerView({ status: "no_access" }), NOW)?.text).toBe(
      "TwoKey has lost access to the club's PayPal account: every officer should check the account's settings.",
    );
  });

  it("treats silence as an alert, naming the last check", () => {
    expect(statusAlert(watchtowerView({ status: "silent", checkedAt: "2026-11-05T15:10:00Z" }), NOW)).toEqual({
      lead: "The Watchtower hasn't checked in since 9:10 AM CST",
      rest: ", though it should check PayPal every 10 minutes.",
      text: "The Watchtower hasn't checked in since 9:10 AM CST, though it should check PayPal every 10 minutes.",
    });
    expect(statusAlert(watchtowerView({ status: "silent", checkedAt: null }), NOW)?.lead).toBe("The Watchtower hasn't checked in for over 30 minutes");
  });

  it("raises nothing for the other statuses", () => {
    for (const status of ["ok", "stale_reports", "not_started"] as const) expect(statusAlert(watchtowerView({ status }), NOW)).toBeNull();
    expect(statusAlert(null, NOW)).toBeNull();
  });
});

describe("one sentence per finding", () => {
  it("flags an officer, says when PayPal recorded it and that the bank covered it (backfill: no delay known)", () => {
    expect(findingSentence(TREASURER_SEND)).toBe(
      "$3.21 left the club account outside TwoKey: sent from PayPal's website to an officer, Esther Huang (Treasurer). " +
        "PayPal recorded it on Nov 3, 2:27 PM CST. The linked bank covered it, so the balance didn't move.",
    );
  });

  it("names a stranger by the masked email, in club time (Nov 3, 04:13 UTC is Nov 2 in Chicago)", () => {
    expect(findingSentence(STRANGER_SEND)).toBe(
      "$3.21 left the club account outside TwoKey: sent from PayPal's website to sb-wdq…@personal.example.com. " +
        "PayPal recorded it on Nov 2, 10:13 PM CST. The linked bank covered it, so the balance didn't move.",
    );
  });

  it("gives the reporting delay only when it is known", () => {
    const seen = finding({ at: "2026-11-05T15:12:00Z", reportedAfterMinutes: 112, fundedByBank: false });
    expect(findingSentence(seen)).toBe(
      "$3.21 left the club account outside TwoKey: sent from PayPal's website to an officer, Esther Huang (Treasurer), on Nov 5, 9:12 AM CST. " +
        "PayPal reported it 1 h 52 min later.",
    );
    expect(findingSentence(finding({ reportedAfterMinutes: null }))).not.toContain("reported it");
  });

  it("says who got a payout without two valid signatures, and leaves out a counterparty PayPal doesn't name", () => {
    expect(findingSentence(SETUP_PAYOUTS[0]!)).toBe(
      "$1.25 left the club account without two valid signatures: payout outside the two-key flow to PayPal's payout simulator. " +
        "PayPal recorded it on Nov 3, 1:59 PM CST.",
    );
    const withdrawal = finding({ eventCode: "T0400", label: "Withdrawn to a bank", counterparty: null, counterpartyIsOfficer: false, fundedByBank: false });
    expect(findingSentence(withdrawal)).toBe("$3.21 left the club account outside TwoKey: withdrawn to a bank. PayPal recorded it on Nov 3, 2:27 PM CST.");
    const known = { ...withdrawal, reportedAfterMinutes: 40, at: "2026-11-05T15:12:00Z" };
    expect(findingSentence(known)).toBe("$3.21 left the club account outside TwoKey: withdrawn to a bank on Nov 5, 9:12 AM CST. PayPal reported it 40 min later.");
  });

  it("splits the claim from its evidence for the two lines on the board", () => {
    const text = findingText(TREASURER_SEND);
    expect(text.amount).toBe("$3.21");
    expect(text.verb).toBe("left the club account outside TwoKey");
    expect(text.route).toBe("sent from PayPal's website to an officer, Esther Huang (Treasurer).");
    expect(text.facts).toBe("PayPal recorded it on Nov 3, 2:27 PM CST. The linked bank covered it, so the balance didn't move.");
  });

  it("names no AI vendor and promises no minutes", () => {
    for (const f of [TREASURER_SEND, STRANGER_SEND, ...SETUP_PAYOUTS, LOCAL_TEST_PAYOUT]) {
      expect(findingSentence(f)).not.toMatch(/claude|anthropic|openai|gpt|within \d+ min/i);
    }
  });
});

describe("ordering", () => {
  it("puts the newest money movement first, keeping the server's order for ties", () => {
    const tie = finding({ transactionId: "TIE", at: TREASURER_SEND.at });
    expect(newestFirst([STRANGER_SEND, TREASURER_SEND, tie]).map((f) => f.transactionId)).toEqual(["1TY14748YE721631B", "TIE", "22N17109956532336"]);
  });

  it("sorts the open and explained findings, and adds the status alert", () => {
    const alerts = watchAlerts(watchtowerView({ status: "silent", findings: [STRANGER_SEND, TREASURER_SEND], explained: [...SETUP_PAYOUTS].reverse() }), NOW);
    expect(alerts.open.map((f) => f.transactionId)).toEqual(["1TY14748YE721631B", "22N17109956532336"]);
    expect(alerts.explained.map((f) => f.transactionId)).toEqual(["23Y96953CP0068646", "3XT37311AK7894010"]);
    expect(alerts.statusAlert?.lead).toContain("hasn't checked in");
  });

  it("shows nothing when the Watchtower can't be read", () => {
    expect(watchAlerts(null, NOW)).toEqual({ statusAlert: null, open: [], explained: [] });
  });
});
