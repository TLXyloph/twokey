/**
 * DEV ONLY. A `BoardView` as the step-4 server will fold it for a fresh judge session: the seed
 * (src/demo/riverbend.ts) with its two waiting payouts as they are being re-seeded (spec §7), each
 * with its key-1 signature and a recorded risk card. The judge UI is built and tested against it
 * while the real routes are written elsewhere; tests/fixtures/board-view.ts re-exports it.
 *
 * Every hash, key id and signature below is made up for the fixture. Nothing here verifies.
 */
import type {
  BoardView,
  OfficerRole,
  PayoutRequestView,
  RiskCard,
  SignatureView,
  SignedApproval,
} from "@/ledger/contracts";
import { riverbend, type ClubDemoData, type LedgerEntry } from "@/demo/riverbend";

const TITLES: Record<OfficerRole, string> = { treasurer: "Treasurer", president: "President", secretary: "Secretary" };

/** A deterministic hex string of `length` characters, so fixtures are stable across runs. */
export function fakeHex(seed: string, length = 64): string {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  let out = "";
  while (out.length < length) {
    state = Math.imul(state ^ (state >>> 15), 2246822519) >>> 0;
    out += state.toString(16).padStart(8, "0");
  }
  return out.slice(0, length);
}

/** 86 base64url characters: the length of an Ed25519 signature. */
export function fakeSignature(seed: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  return [...fakeHex(seed, 172)].reduce(
    (out, _, i, hex) => (i % 2 === 0 ? out + alphabet[parseInt(hex[i]! + hex[i + 1]!, 16) % 64] : out),
    "",
  );
}

export const FIXTURE_KEY_IDS: Record<OfficerRole, string> = {
  treasurer: "7f3a1c2e",
  president: "b41d09e7",
  secretary: "2c8e5fa0",
};

interface SignatureInput {
  requestHash: string;
  payee: PayoutRequestView["payee"];
  amountCents: number;
  role: OfficerRole;
  at: string;
  isRequest: boolean;
  riskCardHash: string | null;
  acknowledgedFlags: boolean;
  prevHash: string;
  payeeEmail: string;
}

export function fixtureSignature(input: SignatureInput): SignatureView {
  const signed: SignedApproval = {
    requestHash: input.requestHash,
    payeeId: input.payee.id,
    payeeEmail: input.payeeEmail,
    amountCents: input.amountCents,
    currency: "USD",
    role: input.role,
    riskCardHash: input.riskCardHash,
    acknowledgedFlags: input.acknowledgedFlags,
    prevHash: input.prevHash,
  };
  return {
    role: input.role,
    title: TITLES[input.role],
    keyId: FIXTURE_KEY_IDS[input.role],
    at: input.at,
    signature: fakeSignature(`${input.requestHash}:${input.role}`),
    signed,
    eventHash: fakeHex(`event:${input.requestHash}:${input.role}`),
    isRequest: input.isRequest,
  };
}

const glovesCard: RiskCard = {
  verdict: "clear",
  summary: "The receipt matches the request: two pairs of goalkeeper gloves from Riverbend Team Supply, $42.00 in all.",
  findings: [
    {
      severity: "info",
      text: "The receipt total matches the amount requested.",
      evidence: "Receipt total $42.00; request $42.00",
      source: "ai",
    },
  ],
  receipt: {
    vendor: "Riverbend Team Supply",
    date: "2026-11-02",
    items: [{ description: "Goalkeeper gloves (2 x $21.00)", amountCents: 4_200 }],
    totalCents: 4_200,
  },
  matchesRequest: true,
  origin: "recorded",
  model: "recorded in development",
  checkedAt: "2026-11-02T15:12:00Z",
};

const paintCard: RiskCard = {
  verdict: "check",
  summary: "The payee is the treasurer, and one receipt line, patio string lights, is not a league expense.",
  findings: [
    {
      severity: "warn",
      text: "The payee is an officer: this reimbursement goes to the treasurer.",
      evidence: "Payee: Esther Huang (Treasurer), officer directory",
      source: "rule",
    },
    {
      severity: "warn",
      text: "One line on the receipt is not a league item.",
      evidence: "Receipt line 2: patio string lights, $12.00",
      source: "ai",
    },
    // The two notes the recorded card carries (src/disbursements/risk/recorded-cards.json).
    {
      severity: "info",
      text: "The field marking paint fits the request and the budget line; that part comes to $24.50.",
      evidence: "Receipt line 1: field marking paint white, 2 @ $12.25, $24.50",
      source: "ai",
    },
    {
      severity: "info",
      text: "The receipt shows 3 items sold, but only two lines with 3 units in total are listed, which matches.",
      evidence: "Items sold: 3",
      source: "ai",
    },
  ],
  receipt: {
    vendor: "Bluebird Hardware",
    date: "2026-11-03",
    items: [
      { description: "Field-marking paint", amountCents: 2_450 },
      { description: "Patio string lights", amountCents: 1_200 },
    ],
    totalCents: 3_650,
  },
  matchesRequest: true,
  origin: "recorded",
  model: "recorded in development",
  checkedAt: "2026-11-03T14:05:00Z",
};

interface SeedRequest {
  ledgerId: string;
  requestId: string;
  payee: PayoutRequestView["payee"];
  payeeEmail: string;
  amountCents: number;
  description: string;
  budgetLine: PayoutRequestView["budgetLine"];
  receipt: PayoutRequestView["receipt"];
  requestedBy: OfficerRole;
  createdAt: string;
  risk: RiskCard;
  eligibleSigners: OfficerRole[];
}

const SEED_REQUESTS: SeedRequest[] = [
  {
    ledgerId: "L14",
    requestId: "req_seed_gloves",
    payee: { id: "team-supply", name: "Riverbend Team Supply", role: null },
    payeeEmail: "sb-6oocj53656441@business.example.com",
    amountCents: 4_200,
    description: "Goalkeeper gloves",
    budgetLine: "equipment",
    receipt: { id: "gloves-team-supply", label: "Team Supply: goalkeeper gloves, $42", imageUrl: "/receipts/gloves-team-supply.png" },
    requestedBy: "treasurer",
    createdAt: "2026-11-02T15:10:00Z",
    risk: glovesCard,
    eligibleSigners: ["president", "secretary"],
  },
  {
    ledgerId: "L15",
    requestId: "req_seed_paint",
    payee: { id: "treasurer-reimbursement", name: "Esther Huang (Treasurer), reimbursement", role: "treasurer" },
    payeeEmail: "sb-6j9x4753696003@personal.example.com",
    amountCents: 3_650,
    description: "Field paint, reimbursement",
    budgetLine: "field-maintenance",
    receipt: { id: "paint-bluebird-hardware", label: "Bluebird Hardware: field paint, $36.50", imageUrl: "/receipts/paint-bluebird-hardware.png" },
    requestedBy: "secretary",
    createdAt: "2026-11-03T14:00:00Z",
    risk: paintCard,
    eligibleSigners: ["president"],
  },
];

const SEED_HASH = fakeHex("seed:riverbend");

function seedRequestView(seed: SeedRequest, prevHash: string): PayoutRequestView {
  const requestHash = fakeHex(`request:${seed.requestId}`);
  return {
    requestId: seed.requestId,
    requestHash,
    sourceLabel: "demo data",
    payee: seed.payee,
    amountCents: seed.amountCents,
    description: seed.description,
    budgetLine: seed.budgetLine,
    receipt: seed.receipt,
    requestedBy: seed.requestedBy,
    createdAt: seed.createdAt,
    signatures: [
      fixtureSignature({
        requestHash,
        payee: seed.payee,
        payeeEmail: seed.payeeEmail,
        amountCents: seed.amountCents,
        role: seed.requestedBy,
        at: seed.createdAt,
        isRequest: true,
        riskCardHash: null,
        acknowledgedFlags: false,
        prevHash,
      }),
    ],
    eligibleSigners: seed.eligibleSigners,
    refusals: [],
    risk: seed.risk,
    riskPending: false,
    status: "waiting",
    timeline: [{ step: "requested", label: "Requested", at: seed.createdAt }],
  };
}

/** The seed's ledger with L14 and L15 as re-seeded (spec §7): $42 gloves, $36.50 field paint. */
export function fixtureClubData(base: ClubDemoData = riverbend): ClubDemoData {
  const reseeded: Record<string, Partial<LedgerEntry>> = {
    L14: { description: "Goalkeeper gloves", counterparty: "Riverbend Team Supply", category: "equipment", amount: -42, requestedBy: "treasurer" },
    L15: {
      description: "Field paint, reimbursement",
      counterparty: "Esther Huang (Treasurer), reimbursement",
      category: "field maintenance",
      amount: -36.5,
      requestedBy: "secretary",
    },
  };
  return {
    ...base,
    ledger: base.ledger.map((row) => (reseeded[row.id] ? { ...row, ...reseeded[row.id], status: "pending", direction: "out" } : row)),
  };
}

/** A fresh judge session's board view. A new object every call: callers may mutate it. */
export function fixtureBoardView(): BoardView {
  const requests = SEED_REQUESTS.map((seed, i) => seedRequestView(seed, i === 0 ? SEED_HASH : fakeHex(`head:${i}`)));
  const data = structuredClone(fixtureClubData());
  // The fold dates the session's balance by its latest event: the session opened this morning.
  if (data.balances[0]) data.balances[0].asOf = "2026-11-05T14:41:00Z";
  return {
    data,
    requests,
    sharedBalance: { availableCents: 499_750, currency: "USD", asOf: "2026-11-05T14:30:00Z" },
    limits: { payoutCapCents: 5_000, sessionPayoutsLeft: 3, dailyCentsLeft: 50_000 },
    watchtower: null,
    chain: { length: 5, head: fakeHex("head:5") },
  };
}

export const FIXTURE_PAYEE_EMAILS = Object.fromEntries(SEED_REQUESTS.map((s) => [s.payee.id, s.payeeEmail])) as Record<
  PayoutRequestView["payee"]["id"],
  string
>;
