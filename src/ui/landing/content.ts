/**
 * The landing page's words, from the copy deck in .taste-skill/brief.md. Kept as data so each section
 * renders from one source. The cases are public reports of accusations and audit findings: keep the
 * "accused" wording and never add people's names.
 */

export const SUPPORTING =
  "TwoKey keeps a youth league's or PTA's money in its own PayPal Business account, and no payout leaves without two officers signing.";

export const NAV_LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#ask", label: "Ask the ledger" },
  { href: "#rules", label: "Rulebooks" },
  { href: "#faq", label: "Questions" },
] as const;

export interface Case {
  place: string;
  caption: string;
  source: { label: string; href: string };
}

export const PROOF_OPENING = "Club treasurers have been accused of emptying accounts in";

export const CASES: Case[] = [
  {
    place: "South Fayette",
    caption:
      "South Fayette, Pennsylvania, youth football, 2025: 70 Venmo payments, $56,450, to the treasurer's husband. The board's spreadsheet showed $60,000; the account held $745.",
    source: {
      label: "WPXI",
      href: "https://www.wpxi.com/news/local/treasurer-accused-stealing-nearly-65k-local-youth-football-organization/FJ63BYOMHFGGLFRBW2OY7GJGTQ/",
    },
  },
  {
    place: "Sarasota",
    caption:
      "Sarasota, Florida, Little League, 2025: $207,000 taken. The board was told $80,000 to $120,000; the account held $949.",
    source: {
      label: "WPXI",
      href: "https://www.wpxi.com/news/trending/former-youth-league-treasurer-accused-stealing-207k-organization/MIER3HMO5BG3HMO4JQOGUEMOBU/",
    },
  },
  {
    place: "DeKalb County",
    caption: "DeKalb County, Tennessee, band boosters, 2026 state audit: a car wash raised $1,300; $15 was deposited.",
    source: {
      label: "Tennessee Comptroller (PDF)",
      href: "https://comptroller.tn.gov/content/dam/cot/ia/advanced-search/2026/school-support-organization/DeKalbCountyBandBoostersReport.pdf",
    },
  },
  {
    place: "Ellsworth",
    caption:
      "Ellsworth, Maine, PTA, 2026: $37,900. Members were told the playground equipment they voted for had been ordered.",
    source: {
      label: "Bangor Daily News",
      href: "https://www.bangordailynews.com/2026/06/05/hancock/hancock-police-courts/ellsworth-maine-pta-funds-theft-indictment-joshua-dudeck/",
    },
  },
  {
    place: "Hempfield",
    caption: "Hempfield, Pennsylvania, PTO: $46,000.",
    source: {
      label: "TribLive",
      href: "https://triblive.com/local/westmoreland/treasurer-of-hempfield-area-pto-accused-of-pocketing-46k-of-groups-funds/",
    },
  },
  {
    place: "Colorado Springs",
    caption: "Colorado Springs, Colorado, Little League, 2025: about $123,000, through the treasurer's personal PayPal account.",
    source: {
      label: "The Gazette",
      href: "https://gazette.com/2025/02/21/colorado-springs-woman-embezzled-over-123000-from-local-little-league-court-documents-allege/",
    },
  },
];

export interface Stage {
  duration: string;
  clause: string;
  /** A representative length in seconds; it sets the segment's width. */
  seconds: number;
}

/** Measured: the sandbox payout took 16.7 s; PayPal reporting usually runs about 1.5–2 h behind. */
export const STAGES: Stage[] = [
  {
    duration: "Two minutes",
    clause: "First, the treasurer files the request with a receipt photo, and the AI checks it against the budget.",
    seconds: 120,
  },
  {
    duration: "Usually the same day",
    clause: "Then two officers sign. The person who asked for the money can never be one of them.",
    seconds: 6 * 3600,
  },
  { duration: "About 17 seconds", clause: "Next, PayPal sends the payout to the vendor's PayPal account.", seconds: 17 },
  {
    duration: "About two hours",
    clause: "Last, PayPal's own records confirm it, and the auditor matches every row.",
    seconds: 2 * 3600,
  },
];

/**
 * Each stage's share of the bar, in percent: proportional to its length, with a floor so the shortest
 * stages still hold their words. Shares sum to 100.
 */
export function stageShares(seconds: number[], floor = 15): number[] {
  const shares = seconds.map(() => 0);
  let fixed = new Set<number>();
  for (;;) {
    const free = seconds.map((_, i) => i).filter((i) => !fixed.has(i));
    const room = 100 - fixed.size * floor;
    const total = free.reduce((sum, i) => sum + (seconds[i] ?? 0), 0);
    const under = free.filter((i) => ((seconds[i] ?? 0) / total) * room < floor);
    if (!under.length) {
      for (const i of free) shares[i] = ((seconds[i] ?? 0) / total) * room;
      for (const i of fixed) shares[i] = floor;
      return shares.map((s) => Math.round(s * 10) / 10);
    }
    fixed = new Set([...fixed, ...under]);
  }
}

export interface Rule {
  kind: string;
  rule: string;
  source?: { label: string; href: string };
}

export const STATE_RULES: Rule[] = [
  {
    kind: "New York State PTA",
    rule: "Venmo, Zelle and Cash App should not be used for PTA banking",
    source: { label: "Insurance guide (PDF)", href: "https://nyspta.org/wp-content/uploads/2024/07/NYS-PTA-Insurance-Guide-2024-final.pdf" },
  },
  {
    kind: "Florida PTA, 2025–26",
    rule: "Peer-to-peer payment apps are not permitted",
    source: { label: "Section 3 (PDF)", href: "https://www.floridapta.org/wp-content/uploads/2025/08/Section-3-Dollar-and-ene-25-26.pdf" },
  },
  {
    kind: "California PTA",
    rule: "Personal payment apps leave one person holding the account",
    source: { label: "capta.org", href: "https://capta.org/how-your-pta-can-easily-and-safely-collect-payments/" },
  },
  {
    kind: "Utah PTA",
    rule: "PayPal is an approved method; never a personal account",
    source: { label: "utahpta.org", href: "https://www.utahpta.org/online-payment-collection-systems" },
  },
];

export const ENFORCED: Rule[] = [
  { kind: "Two signatures", rule: "Two officers on every payout; the payee never signs" },
  { kind: "The club's own account", rule: "A PayPal Business account in the club's name" },
  { kind: "Receipts", rule: "The AI checks each receipt before anyone can sign" },
  { kind: "Monthly review", rule: "The AI drafts the reconciliation; a non-signer signs it" },
];

export const FAQS: { q: string; a: string }[] = [
  {
    q: "Can the president still move money outside TwoKey?",
    a: "Yes. PayPal Business has one owner login, and TwoKey gives it to the president. If money leaves outside TwoKey, the auditor tells every officer and posts it on the parent ledger once PayPal reports it, usually within about two hours. It can't stop it.",
  },
  {
    q: "Does TwoKey hold our money?",
    a: "No. The money stays in the club's own PayPal Business account. TwoKey only asks PayPal to send a payout after two officers sign.",
  },
  {
    q: "What about cash and checks at the bank?",
    a: "They stay outside TwoKey. The auditor compares what each event should have raised with what reached PayPal, so 87 cars logged and $15 received still shows up.",
  },
  {
    q: "Does the AI approve payouts?",
    a: "No. The AI checks receipts, drafts the monthly reconciliation and flags gaps. Officers sign every payout, and a person who isn't a signer signs the reconciliation, because insurers don't accept software as the reviewer.",
  },
  {
    q: "Why not just use Venmo?",
    a: "Several state PTA rulebooks steer clubs away from personal payment apps, and some PTA insurance doesn't cover losses on them. Parents can still pay with Venmo: the button pays the club's PayPal Business account.",
  },
  {
    q: "What does it cost?",
    a: "PayPal's normal fees: 3.49% + $0.49 per checkout (1.99% + $0.49 on eligible donations to a confirmed 501(c)(3)) and $0.25 per payout. TwoKey is a hackathon prototype and has no price.",
  },
];

export const CTA = {
  title: ["Try being", "the second key"],
  sentence: "Open the demo as the treasurer, the second key or a parent, using the fictional Riverbend Youth Football League.",
};

export const FOOTER_NOTES = [
  "An entry in the PayPal AI Hackathon, 2026.",
  "Built on the PayPal sandbox and AG Studio, with an AI agent.",
  "Riverbend Youth Football League is fictional demo data.",
];

export const REPO = { label: "github.com/TLXyloph/twokey", href: "https://github.com/TLXyloph/twokey" };

/** As `assets.mjs --credits --to public/landing/img` prints them; both pictures are public domain or CC0. */
export const CREDITS = [
  {
    title: "Skeletonkey",
    page: "https://commons.wikimedia.org/wiki/File:Skeletonkey.png",
    creator: "Blenheimears",
    licence: { label: "CC0", href: "https://creativecommons.org/publicdomain/zero/1.0/deed.en" },
  },
  {
    title: "Youth football game at Cardozo Senior High School, Washington, D.C.",
    page: "https://commons.wikimedia.org/wiki/File:Youth_football_game_at_Cardozo_Senior_High_School,_1200_Clifton_St.,_NW,_Washington,_D.C_LCCN2010641325.tif",
    creator: "Carol M. Highsmith",
    licence: { label: "public domain", href: "https://creativecommons.org/publicdomain/mark/1.0/" },
  },
];
