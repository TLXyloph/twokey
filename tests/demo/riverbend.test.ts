import { describe, expect, it } from "vitest";
import { CLUB_NAME, riverbend } from "@/demo/riverbend";
import { buildStudioData } from "@/demo/studio-data";

const cents = (amount: number) => Math.round(amount * 100);
const sumCents = (amounts: number[]) => amounts.reduce((total, amount) => total + cents(amount), 0);

describe("Riverbend demo data", () => {
  it("is labelled as demo data", () => {
    expect(CLUB_NAME).toBe("Riverbend Youth Football League (demo data)");
    expect(riverbend.club).toBe(CLUB_NAME);
  });

  it("has the car wash: 87 cars logged at $15 = $1,305 expected, $15 received", () => {
    const carWash = riverbend.events.find((e) => e.id === "car-wash");
    expect(carWash).toMatchObject({ unitsLogged: 87, unitPrice: 15, expected: 1305, received: 15 });
  });

  it("has the fun run and the spirit-wear sale alongside the car wash", () => {
    expect(riverbend.events.map((e) => e.id).sort()).toEqual(["car-wash", "fun-run", "spirit-wear"]);
  });

  it("computes every event's expected takings as units logged x unit price", () => {
    for (const event of riverbend.events) {
      expect(cents(event.expected), event.id).toBe(cents(event.unitsLogged * event.unitPrice));
    }
  });

  it("records each event's received takings as completed money in, tagged to that event", () => {
    for (const event of riverbend.events) {
      const deposits = riverbend.ledger.filter((r) => r.eventId === event.id && r.direction === "in" && r.status === "completed");
      expect(sumCents(deposits.map((r) => r.amount)), event.id).toBe(cents(event.received));
    }
  });

  it("has about 15 ledger rows dated Oct-Nov 2026 with unique ids", () => {
    const { ledger } = riverbend;
    expect(ledger.length).toBeGreaterThanOrEqual(12);
    expect(ledger.length).toBeLessThanOrEqual(18);
    expect(new Set(ledger.map((r) => r.id)).size).toBe(ledger.length);
    for (const row of ledger) {
      expect(row.date, row.id).toMatch(/^2026-(10|11)-\d{2}$/);
    }
  });

  it("signs ledger amounts by direction (in positive, out negative)", () => {
    for (const row of riverbend.ledger) {
      expect(Math.sign(row.amount), row.id).toBe(row.direction === "in" ? 1 : -1);
    }
  });

  it("only tags ledger rows with events that exist", () => {
    const ids = new Set(riverbend.events.map((e) => e.id));
    for (const row of riverbend.ledger) {
      if (row.eventId !== null) expect(ids.has(row.eventId), row.id).toBe(true);
    }
  });

  it("reconciles: completed ledger rows sum to the available balance of $4,998.75", () => {
    const [balance] = riverbend.balances;
    expect(riverbend.balances).toHaveLength(1);
    expect(balance).toMatchObject({ currency: "USD", available: 4998.75 });
    const completed = riverbend.ledger.filter((r) => r.status === "completed");
    expect(sumCents(completed.map((r) => r.amount))).toBe(cents(4998.75));
  });

  it("stamps the balance with an ISO as-of time", () => {
    const asOf = riverbend.balances[0]!.asOf;
    expect(asOf).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    expect(Number.isNaN(Date.parse(asOf))).toBe(false);
  });
});

describe("buildStudioData", () => {
  const studio = buildStudioData(riverbend);
  const source = (id: string) => {
    const found = studio.sources.find((s) => s.id === id);
    if (!found || !("data" in found)) throw new Error(`no simple source ${id}`);
    return found;
  };

  it("describes the data set as demo data", () => {
    expect(studio.description).toMatch(/demo data/i);
  });

  it("exposes events, ledger and balances as sources", () => {
    expect(studio.sources.map((s) => s.id)).toEqual(["events", "ledger", "balances"]);
  });

  it("adds each event's gap (expected - received)", () => {
    const carWash = source("events").data.find((row: { id: string }) => row.id === "car-wash");
    expect(carWash).toMatchObject({ expected: 1305, received: 15, gap: 1290 });
  });

  it("formats the balance fields the Live Balance widget maps", () => {
    const fields = source("balances").fields ?? [];
    expect(fields.find((f) => f.id === "available")?.format).toBe("currencyFormat");
    expect(fields.find((f) => f.id === "asOf")?.format).toBe("dateTimeFormat");
  });

  it("declares a field for every key it maps, in every source", () => {
    for (const s of studio.sources) {
      if (!("data" in s)) continue;
      const declared = new Set((s.fields ?? []).map((f) => f.id));
      for (const key of Object.keys(s.data[0] ?? {})) {
        expect(declared.has(key), `${s.id}.${key}`).toBe(true);
      }
    }
  });

  it("relates ledger rows to their event", () => {
    expect(studio.relationships).toContainEqual(
      expect.objectContaining({
        source: { tableId: "ledger", fieldId: "eventId" },
        target: { tableId: "events", fieldId: "id" },
        type: "many-to-one",
      }),
    );
  });
});
