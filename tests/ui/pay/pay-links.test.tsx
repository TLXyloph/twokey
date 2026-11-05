import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TICKET } from "@/ui/pay/content";
import { PayPage } from "@/ui/pay/pay-page";
import { PaidTicket } from "@/ui/pay/ticket-checkout";

const event = { id: "banquet" as const, ticketPriceCents: 1_500, minTickets: 1, maxTickets: 4 };
const LEDGER_LINK = /<a[^>]*href="\/demo\/ledger"[^>]*>See it on the parent ledger<\/a>/g;
const BOARD_LINK = /<a[^>]*href="\/demo"[^>]*>Back to the board<\/a>/g;

const paid = (judge: boolean) =>
  renderToStaticMarkup(
    <PaidTicket
      result={{ captureId: "4XG12345AB678901C", status: "COMPLETED", amountCents: 3_000 }}
      method="paypal"
      quantity={2}
      judge={judge}
      boardHref="/demo"
      ledgerHref="/demo/ledger"
      onBuyMore={() => {}}
    />,
  );

describe("after paying", () => {
  it("in judge mode, leads to the parent ledger, beside the way back to the board", () => {
    const html = paid(true);
    expect(TICKET.seeLedger).toBe("See it on the parent ledger");
    expect(html.match(LEDGER_LINK)).toHaveLength(1);
    expect(html.match(BOARD_LINK)).toHaveLength(1);
    // The ledger is where this beat ends, so it is the one filled button; the board link stays quiet.
    expect(html).toMatch(/<a class="button" href="\/demo\/ledger">/);
    expect(html).toMatch(/<a class="button button--quiet" href="\/demo">/);
    expect(html.indexOf("/demo/ledger")).toBeLessThan(html.indexOf('href="/demo"'));
  });

  it("shows a parent who came without judge mode neither link", () => {
    const html = paid(false);
    expect(html.match(LEDGER_LINK)).toBeNull();
    expect(html.match(BOARD_LINK)).toBeNull();
    expect(html).toContain("PayPal capture <strong>4XG12345AB678901C</strong>");
    expect(html).toContain(TICKET.buyMore);
  });
});

describe("the pay page's links", () => {
  const page = (judge: boolean) => renderToStaticMarkup(<PayPage event={event} paypalClientId={null} testBuyer={null} judge={judge} />);

  it("in judge mode, puts the parent ledger wherever the board link shows: on the ticket and in the footer", () => {
    const html = page(true);
    expect(html.match(BOARD_LINK)).toHaveLength(2);
    expect(html.match(LEDGER_LINK)).toHaveLength(2);
  });

  it("keeps a parent's page free of both", () => {
    const html = page(false);
    expect(html.match(BOARD_LINK)).toBeNull();
    expect(html.match(LEDGER_LINK)).toBeNull();
  });
});
