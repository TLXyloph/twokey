import { CLUB, CREDITS, EVENING_HEADING, FOOTER, LETTER, LETTER_PLATES, MOMENTS, PHOTO_CAPTION, TICKET } from "./content";
import { EveningRow } from "./evening-row";
import { PayMotion } from "./pay-motion";
import { Perforation, Scallops } from "./shapes";
import { TestBuyer } from "./test-buyer";
import { TicketCheckout, type TicketEvent } from "./ticket-checkout";
import "./pay.css";
import "./ticket.css";
import "./pay-sections.css";
import "./pay-motion.css";

export interface PayPageProps {
  event: TicketEvent;
  paypalClientId: string | null;
  testBuyer: { email: string; password: string } | null;
  judge: boolean;
}

const BOARD = "/demo";
/** The parent ledger, where a ticket payment lands (judge mode links it wherever the board shows). */
const LEDGER = "/demo/ledger";

/**
 * The parent's ticket page, built as the club's own banquet ticket: a gold card in the team's
 * colours with the varsity stripe across its top, the quantity set on the ticket itself, and,
 * once PayPal has the money, the ticket stamped with PayPal's capture id. Beside it, the field.
 * Below: the club's letter (where the money goes), the evening hour by hour, and the back of the card.
 */
export function PayPage({ event, paypalClientId, testBuyer, judge }: PayPageProps) {
  return (
    <div className="pay">
      <main>
        <section className="pay-hero" id="tickets" aria-labelledby="pay-title">
          <article className="ticket" data-load>
            <div className="ticket__stripes" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="ticket__body">
              <h1 className="ticket__title" id="pay-title">
                <span className="ticket__nowrap">End-of-season</span> banquet
              </h1>
              <p className="ticket__when">
                {TICKET.date} <span aria-hidden="true">·</span> {TICKET.doors}
              </p>
              <p className="ticket__what">{TICKET.what}</p>
              <TicketCheckout event={event} clientId={paypalClientId} judge={judge} boardHref={BOARD} ledgerHref={LEDGER} />
            </div>
            {testBuyer && (
              <>
                <Perforation id="ticket-holes" />
                <TestBuyer email={testBuyer.email} password={testBuyer.password} />
              </>
            )}
            <nav className="ticket__links" aria-label="On this page">
              <a href="#letter">Where your $15 goes</a>
              <a href="#evening">The evening</a>
              {judge && <a href={BOARD}>{TICKET.backToBoard}</a>}
              {judge && <a href={LEDGER}>{TICKET.seeLedger}</a>}
            </nav>
          </article>
          <figure className="pay-hero__photo">
            <div className="pay-hero__frame">
              <img src="/landing/img/football-4x5.jpg" width={844} height={1055} alt="Players on a football field in front of purple bleachers and a brick school." />
            </div>
            <figcaption>{PHOTO_CAPTION}</figcaption>
          </figure>
        </section>

        <section className="pay-letter" id="letter" aria-labelledby="letter-title">
          {LETTER_PLATES.map((plate) => (
            <figure className="pay-letter__plate" key={plate.src} data-reveal="rise">
              <img src={plate.src} width={plate.width} height={plate.height} alt={plate.alt} loading="lazy" decoding="async" />
              <figcaption>{plate.caption}</figcaption>
            </figure>
          ))}
          <div className="sheet" data-reveal="rise">
            <div className="sheet__paper">
              <h2 className="sheet__heading" id="letter-title">
                {LETTER.heading}
              </h2>
              {LETTER.paragraphs.map((text) => (
                <p key={text}>{text}</p>
              ))}
              <p className="sheet__sign">
                {LETTER.signOff}
                <span>{LETTER.signer}</span>
              </p>
            </div>
            <Scallops id="sheet-scallops" className="sheet__edge" />
            <Perforation id="sheet-holes" tone="field" />
            <a className="sheet__strip" href="#tickets">
              {LETTER.backToTickets}
            </a>
          </div>
        </section>

        <section className="pay-evening" id="evening" aria-labelledby="evening-title">
          <EveningRow heading={EVENING_HEADING} moments={MOMENTS} />
        </section>
      </main>

      <footer className="pay-foot">
        <div className="postcard" data-reveal="rise">
          <Scallops id="postcard-scallops" className="postcard__edge" direction="up" />
          <div className="postcard__paper">
            <div className="postcard__message">
              <h2>{FOOTER.signOff}</h2>
              <p>{FOOTER.message}</p>
            </div>
            <div className="postcard__address">
              <img className="postcard__stamp" src={FOOTER.stamp.src} width={88} height={117} alt={FOOTER.stamp.alt} loading="lazy" decoding="async" />
              <p className="postcard__club">{CLUB}</p>
              <ul>
                {FOOTER.links.map((link) => (
                  <li key={link.href}>
                    <a href={link.href}>{link.label}</a>
                  </li>
                ))}
                {judge && (
                  <>
                    <li>
                      <a href={BOARD}>{TICKET.backToBoard}</a>
                    </li>
                    <li>
                      <a href={LEDGER}>{TICKET.seeLedger}</a>
                    </li>
                  </>
                )}
              </ul>
            </div>
            <p className="postcard__imprint">{FOOTER.imprint}</p>
          </div>
        </div>
        <ul className="pay-foot__credits" aria-label="Picture credits">
          {CREDITS.map((credit) => (
            <li key={credit.href}>
              <a href={credit.href}>{credit.label}</a>
            </li>
          ))}
          <li>Public domain, via Wikimedia Commons.</li>
        </ul>
      </footer>
      <PayMotion />
    </div>
  );
}
