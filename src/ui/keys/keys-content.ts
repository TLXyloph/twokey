/**
 * The words of the key-setup screen (/demo/keys): the five PayPal settings TwoKey can't change
 * through the API (docs/twokey-concept.md §5.1), each with what to do and why the rulebook asks
 * for it (§3). The setting names in quotes are PayPal's and Venmo's own, read on their help pages
 * on 2026-11-05; each step links the pages it rests on. Where a help page doesn't name a menu
 * (the exact permission boxes for a limited user, a per-app Payouts switch), the copy says what to
 * do in plain words instead of inventing one.
 *
 * Plain words, no AI vendor, times only through the Watchtower's own line. Demo people are the
 * fictional officers of src/demo/riverbend-policy.ts.
 */

export type KeyStepId = "owner" | "treasurer" | "payouts" | "venmo" | "alerts";

export interface HelpLink {
  label: string;
  href: string;
}

export interface KeyStep {
  id: KeyStepId;
  /** The change, as a short imperative. */
  title: string;
  /** Where it's done ("In PayPal's settings", "In the Venmo app") and what to do there. */
  where: string;
  how: string;
  /** Why the rulebook asks for it (spec §3), one or two sentences. */
  why: string;
  /** PayPal's or Venmo's help pages the step rests on. */
  help: HelpLink[];
  /** What is still exposed while this step is open: the panel's "Still open" line. */
  openRisk: string;
  /** What the step changed, as the panel's headline right after it is made. */
  madeLine: string;
}

export const KEY_STEPS: readonly KeyStep[] = [
  {
    id: "owner",
    title: "Move the owner login to the President, with two-step login",
    where: "In PayPal's settings",
    how: "Under Emails, make the President's email the primary one, then change the password, so only the President can sign in as the owner. Under Security, set up “2-step verification” with an authenticator app on the President's phone. PayPal has no transfer button: to put the President's name on the account, it asks for a letter on the club's letterhead, signed by an authorized signer.",
    why: "Rulebooks ask for two administrators on online accounts and no shared logins. In the cases TwoKey cites, one officer held the login, the books and the alerts.",
    help: [
      { label: "2-step verification", href: "https://www.paypal.com/us/cshelp/article/what-is-2-step-verification-help167" },
      { label: "Changing the primary email", href: "https://www.paypal.com/us/cshelp/article/how-do-i-add-remove-or-update-an-email-address-on-my-paypal-account-help135" },
      { label: "Changing the owner's name", href: "https://www.paypal.com/us/cshelp/article/help1032" },
    ],
    openRisk: "the Treasurer still holds the owner login, with a password alone.",
    madeLine: "The President holds the owner login now.",
  },
  {
    id: "treasurer",
    title: "Make the Treasurer a limited user who can't send money or withdraw",
    where: "In PayPal's settings",
    how: "Signed in as the owner, open “Manage users” and add the Treasurer as a user with her own login. Give her what collections need, such as seeing the balance and downloading reports, and leave out the permissions to send money and to withdraw it.",
    why: "Every payment needs two signatures, and the payee never signs. The Tennessee Comptroller: “No single person should control collections, deposits, payments, and recordkeeping.”",
    help: [{ label: "Managing users on a business account", href: "https://www.paypal.com/us/cshelp/article/help274" }],
    openRisk: "the Treasurer has no login of her own, so collections wait on the President.",
    madeLine: "The Treasurer can no longer send money or withdraw it.",
  },
  {
    id: "payouts",
    title: "Make TwoKey the only app that can send payouts",
    where: "In PayPal's settings",
    how: "Under “Account access”, open “API access” and remove every third party except TwoKey. Keep the club's API credentials in TwoKey alone: any app holding them could send a payout.",
    why: "Every payout needs two officers' signatures. TwoKey sends one only when two keys have signed it, and the Watchtower flags any payout that left without them.",
    help: [{ label: "Removing a third party's permissions", href: "https://www.paypal.com/us/cshelp/article/how-can-i-revoke-permissions-granted-to-a-third-party--ts2268" }],
    openRisk: "any app with the club's API access could still send a payout.",
    madeLine: "Only TwoKey can send a payout now, with two keys.",
  },
  {
    id: "venmo",
    title: "Retire the club's personal Venmo; parents pay through the club's page",
    where: "In the Venmo app",
    how: "Move any balance out of the club's personal Venmo, then open Me, Settings, Account and “Close Venmo Account”. Parents pay on the club's page with PayPal or Venmo, and the money lands in the club's PayPal Business account.",
    why: "Rulebooks want the account in the club's name and no personal payment apps. Florida PTA: “PTA insurance does not cover losses from these platforms.”",
    help: [
      { label: "Closing a Venmo account", href: "https://help.venmo.com/cs/articles/close-my-venmo-account-vhel267" },
      { label: "Venmo payments into a business account", href: "https://developer.paypal.com/docs/checkout/pay-with-venmo/" },
    ],
    openRisk: "parents still pay a personal Venmo on the Treasurer's phone.",
    madeLine: "Parents pay the club now, not a personal Venmo.",
  },
  {
    id: "alerts",
    title: "Send the Watchtower's alerts to every officer",
    where: "In PayPal's settings, then in TwoKey",
    how: "Under “Notifications”, keep PayPal's emails on for the owner login, now the President's. In TwoKey, every officer sees the Watchtower's alerts when money leaves outside the two-key flow, usually within about 2 hours, as PayPal reports it.",
    why: "Rulebooks send account alerts to the president and to an officer who doesn't sign. Silence counts too: if the Watchtower stops checking, every officer hears.",
    help: [{ label: "PayPal's email notifications", href: "https://www.paypal.com/us/cshelp/article/how-do-i-update-my-email-notification-preferences-help193" }],
    openRisk: "only the owner login hears about money that leaves.",
    madeLine: "Every officer hears when money leaves.",
  },
];

export const STEP_COUNT = KEY_STEPS.length;

/** The Reviewer isn't in the officer directory (its roles are the payout keys); a fictional name. */
export const REVIEWER_NAME = "Nora Lindgren";

export const KEYS_COPY = {
  title: "Key setup",
  finding: "Five changes in PayPal's settings take the keys away from any one officer. TwoKey can't make them through the API; it walks the board through them.",
  checklistTitle: "Setup steps",
  checklistNote: "Demo data: in judge mode, marking a step done changes only this page. Nothing is sent to PayPal.",
  panelTitle: "Who holds the keys",
  panelNote:
    "PayPal access follows the setup steps (demo data). Key ids and signatures come from this session's ledger, and the Watchtower's line is live. Judge mode's keys are demo keys the server holds; a real club gives each officer a passkey.",
} as const;
