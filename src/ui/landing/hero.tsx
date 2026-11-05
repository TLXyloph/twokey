import { NAV_LINKS, SUPPORTING } from "./content";
import { vars } from "./style-vars";

/** Wordmark, four plain links and one quiet action; on a phone the links fold into a "Menu" sheet. */
export function Nav() {
  return (
    <nav className="lp-nav" aria-label="Main">
      <a className="lp-wordmark" href="#top">
        TwoKey
      </a>
      <ul className="lp-nav__links">
        {NAV_LINKS.map((link) => (
          <li key={link.href}>
            <a className="lp-link" href={link.href}>
              {link.label}
            </a>
          </li>
        ))}
      </ul>
      <a className="lp-button lp-button--quiet lp-nav__action" href="/demo">
        Open the demo
      </a>
      <details className="lp-menu">
        <summary className="lp-menu__toggle">
          <span className="lp-menu__open">Menu</span>
          <span className="lp-menu__close">Close</span>
        </summary>
        <div className="lp-menu__sheet">
          <ul>
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a href={link.href}>{link.label}</a>
              </li>
            ))}
          </ul>
          <a className="lp-button" href="/demo">
            Open the demo
          </a>
        </div>
      </details>
    </nav>
  );
}

/**
 * The idea: the product's rule, two keys, is set into the sentence as a photograph where the words
 * would be. Screen readers hear "Club money takes two keys". On desktop the line, keys included, is
 * fitted from margin to margin (hero.css).
 */
export function Hero() {
  return (
    <div className="lp-hero">
      <h1 className="lp-hero__title">
        <span className="lp-hero__mask">
          <span className="lp-hero__words">
            Club money
          </span>
        </span>{" "}
        <span className="lp-hero__mask">
          <span className="lp-hero__words">
            takes
          </span>
        </span>{" "}
        <span className="lp-keys">
          <img
            src="/landing/img/keys-duotone.jpg"
            width={1200}
            height={800}
            alt=""
            fetchPriority="high"
            decoding="async"
          />
        </span>
        <span className="lp-sr-only"> two keys</span>
      </h1>
      <div className="lp-hero__foot">
        <p className="lp-hero__lead" data-load style={vars({ "--d": "420ms" })}>
          {SUPPORTING}
        </p>
        <a className="lp-button lp-hero__action" href="/demo" data-load style={vars({ "--d": "500ms" })}>
          Open the demo
        </a>
      </div>
    </div>
  );
}
