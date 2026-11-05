/**
 * The parent pay page's words, kept as data so the sections render from one source. The club is
 * fictional demo data; the evening's times and dishes are sample details. The pictures are
 * archival photographs of other teams' banquets and games, captioned as what they are and credited
 * in the footer; none is presented as Riverbend's.
 */

export const CLUB = "Riverbend Youth Football League";

export const TICKET = {
  admitLabel: "Tickets",
  date: "Sat, Nov 21",
  doors: "Doors at 6 pm",
  what: "Dinner and the season's awards for every Riverbend Youth Football League player and family.",
  each: "$15 a ticket",
  paidTo: "Paid straight into the club's own PayPal account.",
  unavailable: "Payments are unavailable right now. Please try again a little later.",
  loading: "Getting PayPal ready…",
  opening: "Finish paying in PayPal's window.",
  capturing: "PayPal approved it. Recording your tickets…",
  cancelled: "You closed PayPal before paying. Nothing was charged.",
  paidHeading: "Paid. See you on the 21st.",
  ledgerLine: "Recorded in the club's ledger, which every parent can open.",
  pendingLine: "PayPal is still processing it; the board shows it once PayPal confirms.",
  buyMore: "Buy more tickets",
  backToBoard: "Back to the board",
} as const;

export const TEST_BUYER = {
  heading: "Sandbox test buyer",
  note: "A PayPal sandbox test login, not a real account. Use it in PayPal's window to pay with test money.",
  emailLabel: "Email",
  passwordLabel: "Password",
} as const;

export const PHOTO_CAPTION = "A youth football game at Cardozo High School, Washington, D.C., 2010.";

export const LETTER = {
  heading: "Dear Riverbend families,",
  paragraphs: [
    "Every player on every team gets called up on the 21st, so bring the whole family. Dinner is on the tables at 6:30 and the awards start at 7:30.",
    "Tickets are $15 each, the same for players, parents, brothers and sisters. You can buy up to four at a time on this page.",
    "Your money goes straight into the club's own PayPal account. Not into an officer's personal Venmo, and not into a coffee can at the door.",
    "Every ticket shows up on the club's ledger as soon as PayPal confirms it, and that ledger is open to every parent. Money only leaves the account when two officers sign.",
  ],
  signOff: "See you there,",
  signer: "The club's president",
  backToTickets: "Back to the tickets",
} as const;

export interface Moment {
  title: string;
  text: string;
  picture: { src: string; width: number; height: number; alt: string; caption: string; position?: string };
}

export const EVENING_HEADING = "The evening, hour by hour";

export const MOMENTS: Moment[] = [
  {
    title: "Doors at 6:00",
    text: "Coats on the rack, name tags at the table, and the trophies already lined up along the stage.",
    picture: {
      src: "/pay/img/1922-pitt-banquet-program.jpg",
      width: 794,
      height: 1100,
      alt: "The gold-printed cover of a 1922 football banquet program.",
      caption: "Football banquet program, Pittsburgh, 1922",
    },
  },
  {
    title: "Dinner at 6:30",
    text: "Pasta, salad and rolls from the parents' committee. Tell us about allergies when you come in.",
    picture: {
      src: "/pay/img/1899-colby-banquet-menu.jpg",
      width: 712,
      height: 1100,
      alt: "A printed menu from a football team banquet in 1899, listing roast turkey and cranberry sauce.",
      caption: "Team banquet menu, Colby Academy, 1899",
    },
  },
  {
    title: "The season on screen",
    text: "Ten minutes of photographs from every game, from the first scrimmage to the last whistle.",
    picture: {
      src: "/landing/img/football-4x5.jpg",
      width: 844,
      height: 1055,
      alt: "Players on a football field in front of purple bleachers and a brick school.",
      caption: "Cardozo High School, Washington, D.C., 2010",
      position: "40% 70%",
    },
  },
  {
    title: "Every player called up",
    text: "Each player gets a certificate and a handshake from their coach, youngest team first.",
    picture: {
      src: "/pay/img/1910-case-football-team.jpg",
      width: 1345,
      height: 925,
      alt: "A 1910 football team posed in three rows, in striped sleeves and socks.",
      caption: "Case School football team, 1910",
      position: "38% 50%",
    },
  },
  {
    title: "The team photo",
    text: "One picture of the whole league on the steps. Wear the jersey if it still fits.",
    picture: {
      src: "/pay/img/1910-army-football-team.jpg",
      width: 1200,
      height: 865,
      alt: "A 1910 football team seated on wooden bleachers.",
      caption: "Army football team, 1910",
      position: "50% 60%",
    },
  },
  {
    title: "Home by 9",
    text: "Help stack the chairs if you can. Sign-ups for next season open in February.",
    picture: {
      src: "/pay/img/mcgregor-schedule-mural.jpg",
      width: 1200,
      height: 800,
      alt: "A painted wall mural of a bulldog and the words Go Fight Win beside a high school football schedule.",
      caption: "A school's football schedule painted on a wall, McGregor, Texas, 2014",
      position: "62% 50%",
    },
  },
];

export const LETTER_PLATES = [
  {
    src: "/pay/img/1921-pitt-banquet-program.jpg",
    width: 774,
    height: 1100,
    alt: "The cover of a 1921 football banquet program with the team's photograph framed in an ornate border.",
    caption: "Football banquet program, Pittsburgh, 1921",
  },
] as const;

export const FOOTER = {
  signOff: "See you on the 21st",
  message:
    "Tickets are $15 and go straight into the club's own PayPal account, where every parent can see them on the ledger.",
  links: [
    { href: "#tickets", label: "Buy tickets" },
    { href: "#evening", label: "The evening" },
    { href: "#letter", label: "Where your $15 goes" },
  ],
  stamp: {
    src: "/pay/img/mcgregor-schedule-mural.jpg",
    alt: "A painted bulldog from a school football mural.",
  },
  imprint:
    "Demo data: the Riverbend Youth Football League is fictional, and payments run in PayPal's sandbox with test money.",
} as const;

const COMMONS = "https://commons.wikimedia.org/wiki/File:";

/** Every picture on the page; all public domain, via Wikimedia Commons. */
export const CREDITS: { label: string; href: string }[] = [
  {
    label: "Cardozo High School game, 2010, and McGregor mural, 2014: Carol M. Highsmith, Library of Congress",
    href: `${COMMONS}Youth_football_game_at_Cardozo_Senior_High_School,_1200_Clifton_St.,_NW,_Washington,_D.C_LCCN2010641325.tif`,
  },
  { label: "Pittsburgh banquet programs, 1921 and 1922: University of Pittsburgh Athletic Council", href: `${COMMONS}1921_University_of_Pittsburgh_Foot_Ball_Banquet_program.jpg` },
  {
    label: "Colby Academy banquet menu, 1899: scan by the New York Public Library",
    href: `${COMMONS}BANQUET_TO_MEMBERS_OF_FOOTBALL_TEAM_(held_by)_COLBY_ACADEMY_(at)_%22COLBY_HALL,_NEW_LONDON,_N.H.%22_(SCHOOL_HALL)_(NYPL_Hades-271956-4000006739).tiff`,
  },
  { label: "Case School football team, 1910: Case School of Applied Science", href: `${COMMONS}1910_Case_Football_Team.jpg` },
  { label: "Army football team, 1910", href: `${COMMONS}Group_photo_of_the_1910_US_Army_football_team.png` },
];
