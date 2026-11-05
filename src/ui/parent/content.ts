/**
 * The parent ledger's words, in one place so the wording rules are tested (tests/ui/parent):
 * plain words for parents; no AI vendor named; "usually within about 2 hours" for PayPal's delay,
 * never "minutes"; the demo labelled as demo.
 */
export const PAGE = {
  title: "Where the club's money goes · Riverbend Youth Football League",
  description: "The Riverbend Youth Football League's money in and out, as every parent can see it (demo data, PayPal sandbox).",
} as const;

export const LINKS = {
  keys: "/demo/keys#who-holds-the-keys",
  banquet: "/demo/pay/banquet",
  board: "/demo",
  close: "/demo/close",
} as const;

export const NAV = {
  club: "Riverbend Youth Football League",
  demo: "(demo data)",
  links: [
    { label: "The books", href: "#books" },
    { label: "Watchtower", href: "#watchtower" },
    { label: "Who holds the keys", href: LINKS.keys },
  ],
  action: { label: "Banquet tickets", href: LINKS.banquet },
} as const;

export const HERO = {
  title: "Where the club's money goes",
  lead:
    "Every dollar in and out of the Riverbend Youth Football League's PayPal account, open to every family. " +
    "No payout leaves without two officers' keys, and the Watchtower flags money that leaves any other way.",
  action: "Buy banquet tickets",
  keys: "Who holds the keys",
} as const;

export const TAKINGS = {
  title: "Did each event's takings arrive?",
  photoAlt: "A man and a boy throw buckets of water over a dark 1950s saloon car parked in the shallows of a lake.",
  caption: "Washing a car in a lake at Savonranta, Finland, in 1955.",
} as const;

export const BOOKS = {
  title: "The club's books",
  lead:
    "The records the officers sign from, read-only: the balance, each event's takings, the payouts waiting for a " +
    "second key and every row in and out. Come back to this page after buying a ticket and your payment is here.",
} as const;

export const WATCH = {
  title: "The Watchtower",
  lead:
    "Every 10 minutes it reads PayPal's own record of the club account and flags any money that left without two " +
    "officers' keys: a send from PayPal's website, a bank withdrawal, a payout TwoKey didn't make.",
  delay:
    "PayPal usually reports a payment within about 2 hours, so each check says how recent PayPal's records are. " +
    "Every officer gets the same alerts this page shows.",
} as const;

export const FOOT = {
  statement: "Riverbend Youth Football League is demo data: a made-up club, on a real PayPal sandbox account.",
  small: "TwoKey: no payout without two officers' keys. An entry to the PayPal AI Hackathon.",
  links: [
    { label: "The officers' board", href: LINKS.board },
    { label: "Who holds the keys", href: LINKS.keys },
    { label: "Monthly close", href: LINKS.close },
    { label: "Banquet tickets", href: LINKS.banquet },
  ],
  time: "Every time on this page is Riverbend's.",
  credits: [
    {
      text: "Washing a car, Savonranta, 1955: Pekka Kyytinen, CC BY 4.0, via Wikimedia Commons",
      href: "https://commons.wikimedia.org/wiki/File:Valokuvaaja_Pekka_Kyytinen_pesem%C3%A4ss%C3%A4_autoaan_Savonrannassa_1955_(KK5596-8.KJ.7.2).tif",
    },
    {
      text: "Football banquet program, 1921: University of Pittsburgh Athletic Council, public domain, via Wikimedia Commons",
      href: "https://commons.wikimedia.org/wiki/File:1921_University_of_Pittsburgh_Foot_Ball_Banquet_program.jpg",
    },
  ],
  wordmark: "TwoKey",
  banquet: { title: "Banquet tickets", when: "Sat, Nov 21 · $15 a ticket", alt: "The cover of the University of Pittsburgh's 1921 football banquet program, with a photograph of the team." },
} as const;
