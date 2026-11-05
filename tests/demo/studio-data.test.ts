import { describe, expect, it } from "vitest";
import { ledgerRows } from "@/demo/studio-data";

describe("ledgerRows: who can still sign", () => {
  it("never offers the second key to the payee (L15 is a reimbursement to the Treasurer)", () => {
    const l15 = ledgerRows().find((row) => row.id === "L15");
    expect(l15?.signedBy).toBe("Secretary");
    expect(l15?.stillToSign).toBe("President");
  });

  it("offers it to every officer but the requester otherwise", () => {
    expect(ledgerRows().find((row) => row.id === "L14")?.stillToSign).toBe("President or Secretary");
  });
});
