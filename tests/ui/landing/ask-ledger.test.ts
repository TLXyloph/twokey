import { describe, expect, it } from "vitest";
import { riverbend, type ClubDemoData } from "@/demo/riverbend";
import {
  DEFAULT_QUESTION,
  EXAMPLE_QUESTIONS,
  NO_MATCH,
  askLedger,
  formatUSD,
} from "@/ui/landing/ask-ledger";

const ids = (question: string) => askLedger(question).rows.map((row) => row.id);

describe("askLedger: events", () => {
  it("answers the prefilled car-wash question with the gap, in the copy deck's words", () => {
    const answer = askLedger(DEFAULT_QUESTION);
    expect(DEFAULT_QUESTION).toBe("Where did the car-wash money go?");
    expect(answer.kind).toBe("event");
    expect(answer.sentence).toBe(
      "Car wash, October 24: 87 cars logged at $15, so $1,305 expected. " +
        "$15 reached the club's PayPal account. $1,290 has no record.",
    );
  });

  it("lists every ledger row tagged to the event, oldest first", () => {
    expect(ids(DEFAULT_QUESTION)).toEqual(["L10", "L11"]);
  });

  it("matches the event however it is written", () => {
    for (const q of ["car wash", "CAR WASH?", "carwash", "the car-wash takings"]) {
      expect(askLedger(q).kind, q).toBe("event");
      expect(ids(q), q).toEqual(["L10", "L11"]);
    }
  });

  it("answers expected against received for the fun run", () => {
    const answer = askLedger("fun run");
    expect(answer.sentence).toBe(
      "Fun run, October 10: 64 runners logged at $20, so $1,280 expected. " +
        "$1,280 reached the club's PayPal account. Nothing is missing.",
    );
    expect(answer.rows.map((r) => r.id)).toEqual(["L04", "L06"]);
  });

  it("answers the spirit-wear sale, with or without the hyphen or the word sale", () => {
    const expected =
      "Spirit-wear sale, October 17: 48 items logged at $22.50, so $1,080 expected. " +
      "$1,080 reached the club's PayPal account. Nothing is missing.";
    expect(askLedger("Spirit-wear sale").sentence).toBe(expected);
    expect(askLedger("how did spirit wear do").sentence).toBe(expected);
    expect(ids("Spirit-wear sale")).toEqual(["L07", "L08"]);
  });

  it("computes received from the ledger rows, not from a separate total", () => {
    const data: ClubDemoData = {
      ...riverbend,
      ledger: riverbend.ledger.map((row) => (row.id === "L10" ? { ...row, amount: 30 } : row)),
    };
    expect(askLedger("car wash", data).sentence).toBe(
      "Car wash, October 24: 87 cars logged at $15, so $1,305 expected. " +
        "$30 reached the club's PayPal account. $1,275 has no record.",
    );
  });
});

describe("askLedger: pending payouts", () => {
  it("lists the payouts waiting for a second approver", () => {
    const answer = askLedger("What is still pending?");
    expect(answer.kind).toBe("pending");
    expect(answer.rows.map((r) => r.id)).toEqual(["L14", "L15"]);
    expect(answer.sentence).toBe(
      "Two payouts are waiting for a second approver, $489 in all. Nothing leaves the account until a second officer signs.",
    );
  });

  it("understands other ways of asking", () => {
    for (const q of ["anything waiting for approval?", "Awaiting a second approver"]) {
      expect(askLedger(q).kind, q).toBe("pending");
    }
  });

  it("says so when nothing is waiting", () => {
    const data: ClubDemoData = {
      ...riverbend,
      ledger: riverbend.ledger.filter((row) => row.status !== "pending"),
    };
    const answer = askLedger("pending", data);
    expect(answer.kind).toBe("pending");
    expect(answer.rows).toEqual([]);
    expect(answer.sentence).toBe("No payouts are waiting for a second approver.");
  });
});

describe("askLedger: payees", () => {
  it("lists the payouts to a payee with their status", () => {
    const answer = askLedger("Riverbend Team Supply");
    expect(answer.kind).toBe("payee");
    expect(answer.rows.map((r) => r.id)).toEqual(["L03", "L14"]);
    expect(answer.sentence).toBe(
      "Riverbend Team Supply: two payouts, $412.50 paid and $129 waiting for a second approver.",
    );
  });

  it("matches a payee without its first word or its punctuation", () => {
    expect(ids("what went to team supply?")).toEqual(["L03", "L14"]);
    expect(askLedger("kestrel print").sentence).toBe("Kestrel Print & Embroidery: one payout, $624 paid.");
  });

  it("names a payee as the ledger does, parenthetical dropped", () => {
    expect(askLedger("referee pool").sentence).toBe(
      "Referee pool: two payouts, $480 paid and $360 waiting for a second approver.",
    );
  });

  it("prefers the payee over the pending list when both are asked", () => {
    expect(askLedger("is anything pending for riverbend team supply").kind).toBe("payee");
  });
});

describe("askLedger: anything else", () => {
  it("says nothing matches and suggests what to ask", () => {
    for (const q of ["Who won on Saturday?", "", "   ", "riverbend"]) {
      const answer = askLedger(q);
      expect(answer.kind, q).toBe("none");
      expect(answer.sentence, q).toBe(NO_MATCH);
      expect(answer.rows, q).toEqual([]);
    }
    expect(NO_MATCH).toBe("Nothing in the ledger matches that. Try an event or a payee.");
  });
});

describe("answer rows", () => {
  it("carry a short date, a signed amount with cents and a status in the trade's words", () => {
    const [deposit, supplies] = askLedger("car wash").rows;
    expect(deposit).toMatchObject({
      dateLabel: "Oct 24",
      counterparty: "Car-wash customer (PayPal)",
      amountLabel: "+$15.00",
      statusLabel: "Received",
    });
    expect(supplies).toMatchObject({ amountLabel: "−$38.75", statusLabel: "Paid" });
  });

  it("drops the pending note from the description, because the status says it", () => {
    const [gloves] = askLedger("pending").rows;
    expect(gloves?.description).toBe("Goalkeeper gloves");
    expect(gloves?.statusLabel).toBe("Waiting for the second key");
  });
});

describe("example questions", () => {
  it("are the three in the copy deck, and each one finds rows", () => {
    expect(EXAMPLE_QUESTIONS).toEqual(["What is still pending?", "Spirit-wear sale", "Riverbend Team Supply"]);
    for (const q of EXAMPLE_QUESTIONS) expect(askLedger(q).rows.length, q).toBeGreaterThan(0);
  });
});

describe("formatUSD", () => {
  it("drops zero cents unless asked, and groups thousands", () => {
    expect(formatUSD(15)).toBe("$15");
    expect(formatUSD(22.5)).toBe("$22.50");
    expect(formatUSD(1305)).toBe("$1,305");
    expect(formatUSD(412.5)).toBe("$412.50");
  });

  it("signs every amount with a true minus when asked", () => {
    expect(formatUSD(15, { cents: "always", signed: true })).toBe("+$15.00");
    expect(formatUSD(-38.75, { cents: "always", signed: true })).toBe("−$38.75");
    expect(formatUSD(-1290, { cents: "always" })).toBe("−$1,290.00");
  });

  it("rounds to the cent without floating-point drift", () => {
    expect(formatUSD(0.1 + 0.2, { cents: "always" })).toBe("$0.30");
  });
});
