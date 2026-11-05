/**
 * The parent ledger (/demo/ledger). Direction "Colour chapters" (design-taste-frontend, seed
 * 584334170, team colours kept): every section is a field in one of the club's colours, floor to
 * ceiling, held together by one grid and two faces.
 *
 *   maroon   the hero: what this is, the one action, and the ledger's latest rows on a crimson stage
 *            whose corner is cut like a key's bit
 *   gold     "Did each event's takings arrive?": one event at poster size (the car wash's gap)
 *   maroon   the club's books: the second AG Studio, in team colours (stacked HTML below 720px)
 *   crimson  the Watchtower: its status with PayPal's "as of" time and its alerts, visible to parents
 *   maroon   the footer, a board of tiles
 *
 * A server component: the words and the frame render on the server; the live parts are client
 * components fed by the session's board view (./parent-shell.tsx). The judge band sits on top, as on
 * the board, in the board's own tokens.
 */
import Link from "next/link";
import { JudgePanel } from "@/ui/judge/judge-panel";
import { boardCssVars } from "@/ui/studio/tokens";
import { BooksBody } from "./books";
import { ClubClock } from "./club-clock";
import { BOOKS, FOOT, HERO, NAV, TAKINGS, WATCH } from "./content";
import { LatestStatement } from "./latest";
import { ParentMotion } from "./parent-motion";
import { ParentShell } from "./parent-shell";
import { TakingsFigure } from "./takings";
import { parentCssVars } from "./tokens";
import { WatchRoom } from "./watch-room";
import "./parent.css";
import "./chapters.css";
import "./stacked.css";
import "./motion.css";

/** The two officers' keys, bows side by side: the board's mark, at the wordmark's size. */
function KeysMark() {
  return (
    <svg className="nav__mark" width="22" height="22" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="6.5" cy="5.75" r="3.25" />
        <path d="M6.5 9v8.5M6.5 14.25H4.5M6.5 17H4.75" />
        <circle cx="13.5" cy="5.75" r="3.25" />
        <path d="M13.5 9v8.5M13.5 14.25h2M13.5 17h1.75" />
      </g>
    </svg>
  );
}

function Arrow() {
  return (
    <svg className="foot__arrow" width="56" height="56" viewBox="0 0 56 56" aria-hidden="true" focusable="false">
      <path d="M10 46 46 10M20 10h26v26" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="square" />
    </svg>
  );
}

export function ParentLedgerPage({ licenseKey }: { licenseKey?: string }) {
  return (
    <div className="parent" style={parentCssVars}>
      <div className="parent__judge" style={boardCssVars}>
        <JudgePanel />
      </div>
      <ParentShell />

      <header className="nav">
        <Link className="nav__wordmark" href="/">
          <KeysMark />
          TwoKey
        </Link>
        <p className="nav__club">
          {NAV.club} <span className="nav__demo">{NAV.demo}</span>
        </p>
        <nav className="nav__links" aria-label="This page">
          {NAV.links.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
        <Link className="nav__action" href={NAV.action.href}>
          {NAV.action.label}
        </Link>
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero__words">
            <h1 id="hero-title" className="hero__title">
              {HERO.title}
            </h1>
            <p className="hero__lead">{HERO.lead}</p>
            <div className="hero__actions">
              <Link className="button" href={NAV.action.href}>
                {HERO.action}
              </Link>
              <Link className="link" href={FOOT.links[1].href}>
                {HERO.keys}
              </Link>
            </div>
          </div>
          <div className="hero__stage">
            <LatestStatement />
          </div>
        </section>

        <section className="takings" aria-labelledby="takings-title">
          <h2 id="takings-title" className="takings__title" data-reveal="">
            {TAKINGS.title}
          </h2>
          <figure className="takings__photo" data-reveal="">
            <div className="takings__frame">
              {/* eslint-disable-next-line @next/next/no-img-element -- a fixed, pre-sized archive picture */}
              <img src="/parent/img/1955-washing-a-car.jpg" width={1400} height={1424} alt={TAKINGS.photoAlt} loading="lazy" decoding="async" />
            </div>
            <figcaption className="takings__caption">{TAKINGS.caption}</figcaption>
          </figure>
          <TakingsFigure />
        </section>

        <section id="books" className="books" aria-labelledby="books-title">
          <div className="books__head">
            <h2 id="books-title" className="chapter-title" data-reveal="">
              {BOOKS.title}
            </h2>
            <p className="chapter-lead" data-reveal="">
              {BOOKS.lead}
            </p>
          </div>
          <BooksBody licenseKey={licenseKey} />
        </section>

        <section id="watchtower" className="watch" aria-labelledby="watch-title">
          <div className="watch__words">
            <h2 id="watch-title" className="chapter-title" data-reveal="">
              {WATCH.title}
            </h2>
            <p className="chapter-lead" data-reveal="">
              {WATCH.lead}
            </p>
            <p className="watch__delay" data-reveal="">
              {WATCH.delay}
            </p>
          </div>
          <div className="watch__room" data-reveal="">
            <WatchRoom />
          </div>
        </section>
      </main>

      <footer className="foot" aria-label="About this page">
        <div className="foot__tile foot__tile--statement" data-reveal="">
          <p className="foot__statement">{FOOT.statement}</p>
          <p className="foot__small">{FOOT.small}</p>
        </div>
        <nav className="foot__tile foot__tile--nav" aria-label="TwoKey's screens" data-reveal="">
          <ul className="foot__links">
            {FOOT.links.map((link) => (
              <li key={link.href}>
                <Link href={link.href}>{link.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="foot__tile foot__tile--time" data-reveal="">
          <p className="foot__small">{FOOT.time}</p>
          <ClubClock />
        </div>
        <div className="foot__tile foot__tile--credits" data-reveal="">
          <p className="foot__small">Pictures</p>
          <ul className="foot__credits">
            {FOOT.credits.map((credit) => (
              <li key={credit.href}>
                <a href={credit.href} rel="noreferrer" target="_blank">
                  {credit.text}
                </a>
              </li>
            ))}
          </ul>
        </div>
        <p className="foot__tile foot__tile--wordmark" aria-hidden="true">
          {FOOT.wordmark}
        </p>
        <Link className="foot__tile foot__tile--banquet" href={NAV.action.href}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a fixed, pre-sized archive picture */}
          <img className="foot__program" src="/pay/img/1921-pitt-banquet-program.jpg" width={774} height={1100} alt={FOOT.banquet.alt} loading="lazy" decoding="async" />
          <span className="foot__banquet-words">
            <span className="foot__banquet-title">{FOOT.banquet.title}</span>
            <span className="foot__small">{FOOT.banquet.when}</span>
          </span>
          <Arrow />
        </Link>
      </footer>
      <ParentMotion />
    </div>
  );
}
