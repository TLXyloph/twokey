/**
 * What "Who holds the keys" says, computed from how many setup steps are done (demo data, in
 * order) and the session's live board view, and kept free of React so every line is tested as
 * plain data. Before any step, the Treasurer holds everything (the pattern in the cited cases);
 * each step moves one thing; after the fifth, no officer holds every key.
 *
 * The key ids are the committed demo public keys (src/disbursements/demo-public-keys.json); the
 * last signature per officer comes from the view's requests, newest first.
 */
import demoPublicKeys from "@/disbursements/demo-public-keys.json";
import { OFFICER_DIRECTORY, REVIEWER } from "@/demo/riverbend-policy";
import type { ActingRole, BoardView, OfficerRole } from "@/ledger/contracts";
import { formatStepTime, roleTitle } from "@/ui/judge/judge-model";
import { KEY_STEPS, STEP_COUNT, type KeyStepId } from "./keys-content";

/** The committed demo keys, read loosely: a Reviewer key may be added later for the monthly close. */
const COMMITTED_KEYS: Partial<Record<ActingRole, { keyId: string }>> = demoPublicKeys;

/** risk: the setup still leaves money exposed here; held: as the rulebook wants; none: no access. */
export type AccessTone = "risk" | "held" | "none";

export interface AccessLine {
  text: string;
  tone: AccessTone;
}

export type LastSigned =
  | { kind: "loading" }
  /** Reviewers and parents hold no payout key: nothing to show. */
  | { kind: "not-a-signer" }
  | { kind: "none" }
  | { kind: "signed"; time: string; detail: string };

export interface HolderRow {
  role: ActingRole;
  title: string;
  person: string;
  /** One line, or two when the Treasurer still has the club's Venmo. */
  access: AccessLine[];
  /** The demo key's id, or null for a role without one. */
  keyId: string | null;
  keyNote: string;
  lastSigned: LastSigned;
}

export interface FactRow {
  id: "payouts" | "parents" | "alerts";
  label: string;
  value: AccessLine;
}

export type KeysStage = "before" | "during" | "after";

export interface KeysPanelModel {
  stage: KeysStage;
  stageLabel: string;
  headline: string;
  subline: string;
  holders: HolderRow[];
  facts: FactRow[];
}

/** A step count from storage or a URL, clamped to 0..5; anything unreadable is 0. */
export function clampSteps(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d{1,2}$/.test(value.trim()) ? Number(value) : NaN;
  return Number.isInteger(n) ? Math.min(Math.max(n, 0), STEP_COUNT) : 0;
}

export function stepsDone(done: number): ReadonlySet<KeyStepId> {
  return new Set(KEY_STEPS.slice(0, clampSteps(done)).map((step) => step.id));
}

const nameOf = (role: OfficerRole) => OFFICER_DIRECTORY.find((officer) => officer.role === role)?.name ?? roleTitle(role);

/** The officer's newest signature in this session's view, with what it signed. */
export function lastSignature(view: BoardView | null, role: OfficerRole, now: Date): LastSigned {
  if (!view) return { kind: "loading" };
  let latest: { at: number; iso: string; detail: string } | null = null;
  for (const request of view.requests) {
    for (const signature of request.signatures) {
      const at = new Date(signature.at).getTime();
      if (signature.role !== role || Number.isNaN(at) || (latest && latest.at >= at)) continue;
      latest = { at, iso: signature.at, detail: `${signature.isRequest ? "Key 1" : "Key 2"} on “${request.description}”` };
    }
  }
  return latest ? { kind: "signed", time: formatStepTime(latest.iso, now), detail: latest.detail } : { kind: "none" };
}

function officerRow(role: OfficerRole, access: AccessLine[], view: BoardView | null, now: Date): HolderRow {
  const keyId = COMMITTED_KEYS[role]?.keyId ?? null;
  return {
    role,
    title: roleTitle(role),
    person: nameOf(role),
    access,
    keyId,
    keyNote: "Signs payouts",
    lastSigned: lastSignature(view, role, now),
  };
}

const NO_ACCESS: AccessLine = { text: "None", tone: "none" };

export function keysPanel(done: number, view: BoardView | null, now: Date = new Date()): KeysPanelModel {
  const count = clampSteps(done);
  const has = stepsDone(count);
  const venmo: AccessLine[] = has.has("venmo") ? [] : [{ text: "The club's personal Venmo, on her phone", tone: "risk" }];

  const president: AccessLine = has.has("owner") ? { text: "Owner login, with 2-step verification", tone: "held" } : NO_ACCESS;
  const treasurer: AccessLine = !has.has("owner")
    ? { text: "Owner login, password only", tone: "risk" }
    : has.has("treasurer")
      ? { text: "Limited user: can't send or withdraw", tone: "held" }
      : { text: "No login of her own yet", tone: "none" };

  const reviewerKey = COMMITTED_KEYS.reviewer?.keyId ?? null;
  const holders: HolderRow[] = [
    officerRow("president", [president], view, now),
    officerRow("treasurer", [treasurer, ...venmo], view, now),
    officerRow("secretary", [NO_ACCESS], view, now),
    {
      role: "reviewer",
      title: roleTitle("reviewer"),
      person: REVIEWER.name,
      access: [NO_ACCESS],
      keyId: reviewerKey,
      keyNote: reviewerKey ? "Signs the monthly close only" : "No payout key; signs the monthly close",
      lastSigned: { kind: "not-a-signer" },
    },
    {
      role: "parent",
      title: roleTitle("parent"),
      person: "Every family",
      access: [NO_ACCESS],
      keyId: null,
      keyNote: "No key: parents see the ledger",
      lastSigned: { kind: "not-a-signer" },
    },
  ];

  const facts: FactRow[] = [
    {
      id: "payouts",
      label: "Apps that can send payouts",
      value: has.has("payouts") ? { text: "TwoKey only, and only with two officers' keys", tone: "held" } : { text: "Any app with the club's API access", tone: "risk" },
    },
    {
      id: "parents",
      label: "Parents pay into",
      value: has.has("venmo")
        ? { text: "The club's page, into the club's PayPal account", tone: "held" }
        : { text: "A personal Venmo on the Treasurer's phone", tone: "risk" },
    },
    {
      id: "alerts",
      label: "Alerts go to",
      value: has.has("alerts")
        ? { text: "Every officer: President, Treasurer, Secretary and Reviewer", tone: "held" }
        : { text: `The ${has.has("owner") ? "President" : "Treasurer"}'s email only`, tone: "risk" },
    },
  ];

  if (count === 0) {
    return {
      stage: "before",
      stageLabel: "Before key setup",
      headline: "The Treasurer holds every key.",
      subline: "The owner login, the club's Venmo and PayPal's alerts all sit with one officer: the pattern in the cases TwoKey cites.",
      holders,
      facts,
    };
  }
  if (count === STEP_COUNT) {
    return {
      stage: "after",
      stageLabel: "After key setup",
      headline: "No officer holds every key.",
      subline: "The President holds the owner login with 2-step verification, the Treasurer can't send or withdraw, and every payout needs two officers' keys.",
      holders,
      facts,
    };
  }
  const made = KEY_STEPS[count - 1]!;
  const open = KEY_STEPS[count]!;
  return {
    stage: "during",
    stageLabel: "During key setup",
    headline: made.madeLine,
    subline: `${count} of ${STEP_COUNT} changes made. Still open: ${open.openRisk}`,
    holders,
    facts,
  };
}
