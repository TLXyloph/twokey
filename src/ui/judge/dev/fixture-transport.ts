/**
 * DEV ONLY: an in-memory stand-in for the step-4 API, so the judge UI can be built and checked
 * before the real routes exist. Reached only through `/demo?fixture=1` in a development build
 * (./../board-view-source.ts imports it behind `process.env.NODE_ENV !== "production"`, which the
 * production bundler folds to false, so this module is never shipped). It also refuses to start in
 * a production build, in case anyone wires it some other way.
 *
 * It follows the rules the real server enforces (spec §3) closely enough to exercise every state the
 * drawer draws: refusals recorded in the ledger, the flags tick, the session's limits, a payout sent
 * on the second key and confirmed a few seconds later, and the AI's receipt read replacing the rules
 * card. It also carries the Watchtower in the state `watch` names (./watchtower-fixture.ts) and fakes
 * its judge-mode replay. It calls nothing: no PayPal, no AI.
 */
import { OFFICERS } from "@/demo/riverbend";
import { BUDGET_LINES, OFFICER_DIRECTORY, budgetLineById } from "@/demo/riverbend-policy";
import { payeeById } from "@/disbursements/payees";
import {
  PAYOUT_CAP_CENTS,
  type ActingRole,
  type BoardView,
  type CreatePayoutRequestBody,
  type LimitCode,
  type OfficerRole,
  type PayoutRequestView,
  type RefusalCode,
  type RiskCard,
  type RiskFinding,
  type SignBody,
} from "@/ledger/contracts";
import type { ActionResult, BoardTransport } from "../http-transport";
import { budgetLeftCents, formatCents, isOfficer, needsAcknowledgement, roleTitle } from "../judge-model";
import { sampleReceipt } from "../sample-receipts";
import { fakeHex, fixtureBoardView, fixtureSignature } from "./board-view-fixture";
import { DEFAULT_WATCH_FIXTURE, fixtureReplay, fixtureWatchtower, isWatchFixtureState } from "./watchtower-fixture";

export interface FixtureTransportOptions {
  /** Simulated network time per call. */
  latencyMs?: number;
  /** From "Sent to PayPal" to "PayPal confirmed". */
  confirmAfterMs?: number;
  /** How long the AI takes to read a receipt. */
  readAfterMs?: number;
  /** The Watchtower's state (`&watch=`); anything unknown falls back to "stale", today's real state. */
  watch?: string | null;
  /** Answers the replay with an error instead, to see the failure line. */
  replayFails?: boolean;
}

/** What each sample receipt really says, as the fake AI "reads" it. */
const RECEIPT_TOTALS: Record<string, { vendor: string; items: { description: string; amountCents: number }[] }> = {
  "gloves-team-supply": { vendor: "Riverbend Team Supply", items: [{ description: "Goalkeeper gloves (2 x $21.00)", amountCents: 4_200 }] },
  "paint-bluebird-hardware": {
    vendor: "Bluebird Hardware",
    items: [
      { description: "Field-marking paint", amountCents: 2_450 },
      { description: "Patio string lights", amountCents: 1_200 },
    ],
  },
  "cones-team-supply": { vendor: "Riverbend Team Supply", items: [{ description: "Practice cones (set of 24)", amountCents: 4_800 }] },
  "bibs-team-supply": { vendor: "Riverbend Team Supply", items: [{ description: "Training bibs (16)", amountCents: 6_400 }] },
};

const SEED_LEDGER_IDS: Record<string, string> = { req_seed_gloves: "L14", req_seed_paint: "L15" };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const clone = <T>(value: T): T => structuredClone(value);

export function createFixtureTransport(options: FixtureTransportOptions = {}): BoardTransport {
  if (process.env.NODE_ENV === "production") throw new Error("The board-view fixture is for development only.");
  const { latencyMs = 250, confirmAfterMs = 6_000, readAfterMs = 1_800, replayFails = false } = options;
  const view: BoardView = fixtureBoardView();
  view.watchtower = fixtureWatchtower(isWatchFixtureState(options.watch) ? options.watch : DEFAULT_WATCH_FIXTURE);
  const ledgerIds = new Map(Object.entries(SEED_LEDGER_IDS));
  let created = 0;

  const nowIso = () => new Date().toISOString();
  const find = (id: string) => view.requests.find((r) => r.requestId === id);
  const appendEvent = () => {
    view.chain = { length: view.chain.length + 1, head: fakeHex(`head:${view.chain.length + 1}`) };
  };
  const reply = async <T>(value: T): Promise<T> => {
    await sleep(latencyMs);
    return clone(value);
  };

  function refuse(request: PayoutRequestView, role: ActingRole, code: RefusalCode, message: string): ActionResult {
    request.refusals.push({ role, code, message, at: nowIso() });
    appendEvent();
    return { ok: false, status: 409, code, message };
  }

  function block(request: PayoutRequestView, code: LimitCode, message: string): ActionResult {
    request.status = "blocked";
    request.eligibleSigners = [];
    request.timeline.push({ step: "blocked", label: "Not sent", at: nowIso(), detail: message });
    appendEvent();
    return { ok: false, status: 409, code, message };
  }

  /** The money leaves the account: the ledger row completes and the balance drops. */
  function moveMoney(request: PayoutRequestView) {
    const row = view.data.ledger.find((r) => r.id === ledgerIds.get(request.requestId));
    if (row) row.status = "completed";
    const balance = view.data.balances[0];
    if (balance) {
      balance.available = Math.round(balance.available * 100 - request.amountCents) / 100;
      balance.asOf = nowIso();
    }
    view.limits.sessionPayoutsLeft -= 1;
    view.limits.dailyCentsLeft -= request.amountCents;
  }

  function send(request: PayoutRequestView) {
    const batch = fakeHex(`batch:${request.requestId}`, 13).toUpperCase();
    request.status = "sent";
    request.timeline.push({ step: "sent", label: "Sent to PayPal", at: nowIso(), detail: `Batch ${batch}` });
    appendEvent();
    moveMoney(request);
    setTimeout(() => {
      request.status = "confirmed";
      request.timeline.push({ step: "confirmed", label: "PayPal confirmed", at: nowIso(), detail: "PayPal says the payout succeeded" });
      appendEvent();
    }, confirmAfterMs);
  }

  function sign(request: PayoutRequestView, body: SignBody): ActionResult {
    const role = body.actingAs;
    const title = roleTitle(role);
    if (!isOfficer(role)) return refuse(request, role, "not_an_officer", "Only an officer can sign a payout. A parent can see payouts, not approve them.");
    if (request.status !== "waiting") return refuse(request, role, "request_closed", "This payout has already left the queue.");
    if (request.riskPending) return refuse(request, role, "receipt_check_pending", "The AI is still reading the receipt. Sign once its check is in.");
    if (request.payee.role === role) {
      return refuse(request, role, "payee_cannot_sign", `The ${title} is the payee on this payout, so the ${title}'s key can't approve it.`);
    }
    if (request.signatures.some((s) => s.role === role)) {
      return refuse(request, role, "already_signed", `The ${title} already signed this payout. The second key has to come from a different officer.`);
    }
    if (needsAcknowledgement(request.risk) && !body.acknowledgedFlags) {
      return refuse(request, role, "flags_not_acknowledged", "This receipt has flags. Tick “I've read the flags” before you sign.");
    }

    const payee = payeeById(request.payee.id);
    request.signatures.push(
      fixtureSignature({
        requestHash: request.requestHash,
        payee: request.payee,
        payeeEmail: payee?.email ?? "",
        amountCents: request.amountCents,
        role,
        at: nowIso(),
        isRequest: false,
        riskCardHash: request.risk ? fakeHex(`card:${request.requestId}:${request.risk.checkedAt}`) : null,
        acknowledgedFlags: body.acknowledgedFlags,
        prevHash: view.chain.head,
      }),
    );
    request.eligibleSigners = [];
    request.timeline.push({ step: "signed", label: "Signed", at: nowIso(), detail: `Second key: the ${title}` });
    appendEvent();

    if (request.amountCents > view.limits.payoutCapCents) return block(request, "over_payout_cap", `Judge mode caps a payout at ${formatCents(PAYOUT_CAP_CENTS)}. Nothing was sent.`);
    if (view.limits.sessionPayoutsLeft <= 0) return block(request, "session_payout_limit", "This session has sent its 3 payouts. Nothing was sent.");
    if (view.limits.dailyCentsLeft < request.amountCents) return block(request, "daily_payout_limit", "The demo's daily limit is used up. Nothing was sent.");
    send(request);
    return { ok: true, request: clone(request) };
  }

  function rulesFindings(body: Pick<PayoutRequestView, "payee" | "amountCents" | "budgetLine">): RiskFinding[] {
    const findings: RiskFinding[] = [];
    if (body.payee.role) {
      const officer = OFFICER_DIRECTORY.find((o) => o.role === body.payee.role);
      findings.push({ severity: "warn", text: `The payee is an officer: the ${roleTitle(body.payee.role)}.`, evidence: `Payee: ${officer?.name ?? body.payee.name}, officer directory`, source: "rule" });
    }
    const line = budgetLineById(body.budgetLine);
    if (line && body.amountCents > budgetLeftCents(view.data, line)) {
      findings.push({ severity: "warn", text: `This is more than is left on the ${line.label.toLowerCase()} line.`, evidence: `${formatCents(budgetLeftCents(view.data, line))} left of ${formatCents(line.approvedCents)}`, source: "rule" });
    }
    return findings;
  }

  function create(body: CreatePayoutRequestBody): ActionResult {
    const payee = payeeById(body.payeeId);
    const receipt = sampleReceipt(body.receiptId);
    const description = body.description.trim();
    if (!isOfficer(body.actingAs)) return { ok: false, status: 403, code: "not_an_officer", message: "Only an officer can request a payout." };
    if (!payee || !receipt || !BUDGET_LINES.some((l) => l.id === body.budgetLine)) return { ok: false, status: 400, code: "bad_request", message: "Choose a payee, a budget line and a receipt from the lists." };
    if (!Number.isInteger(body.amountCents) || body.amountCents < 1 || body.amountCents > PAYOUT_CAP_CENTS) {
      return { ok: false, status: 400, code: "bad_request", message: `The amount must be between $0.01 and ${formatCents(PAYOUT_CAP_CENTS)}.` };
    }
    if (description === "" || description.length > 80) return { ok: false, status: 400, code: "bad_request", message: "Describe the payout in 80 characters or fewer." };
    if (payee.role === body.actingAs) {
      return { ok: false, status: 409, code: "payee_cannot_sign", message: `The ${roleTitle(body.actingAs)} can't request a payout to themselves. Ask another officer to request it.` };
    }

    created += 1;
    const requestId = `req_dev_${created}`;
    const requestHash = fakeHex(`request:${requestId}`);
    const at = nowIso();
    const requestedBy = body.actingAs as OfficerRole;
    const findings = rulesFindings({ payee, amountCents: body.amountCents, budgetLine: body.budgetLine });
    const risk: RiskCard = {
      verdict: findings.length > 0 ? "check" : "clear",
      summary: findings.length > 0 ? findings[0]!.text : "The rule checks found nothing to flag. The AI hasn't read the receipt yet.",
      findings,
      receipt: null,
      matchesRequest: null,
      origin: "rules",
      model: null,
      checkedAt: at,
    };
    const request: PayoutRequestView = {
      requestId,
      requestHash,
      sourceLabel: "live sandbox",
      payee: { id: payee.id, name: payee.name, role: payee.role },
      amountCents: body.amountCents,
      description,
      budgetLine: body.budgetLine,
      receipt: { id: receipt.id, label: receipt.label, imageUrl: receipt.imageUrl },
      requestedBy,
      createdAt: at,
      signatures: [
        fixtureSignature({ requestHash, payee, payeeEmail: payee.email, amountCents: body.amountCents, role: requestedBy, at, isRequest: true, riskCardHash: null, acknowledgedFlags: false, prevHash: view.chain.head }),
      ],
      eligibleSigners: OFFICERS.map((o) => o.role).filter((role) => role !== requestedBy && role !== payee.role),
      refusals: [],
      risk,
      riskPending: true,
      status: "waiting",
      timeline: [{ step: "requested", label: "Requested", at }],
    };
    const ledgerId = `J${created}`;
    ledgerIds.set(requestId, ledgerId);
    view.data.ledger.push({
      id: ledgerId,
      date: at.slice(0, 10),
      description,
      counterparty: payee.name,
      category: budgetLineById(body.budgetLine)!.category,
      direction: "out",
      amount: -body.amountCents / 100,
      status: "pending",
      eventId: null,
      requestedBy,
    });
    view.requests.unshift(request);
    appendEvent();
    return { ok: true, request: clone(request) };
  }

  /** The fake AI read: the receipt's real lines against the request. */
  function aiCard(request: PayoutRequestView): RiskCard {
    const sheet = RECEIPT_TOTALS[request.receipt.id]!;
    const totalCents = sheet.items.reduce((sum, item) => sum + item.amountCents, 0);
    const matches = totalCents === request.amountCents;
    const findings: RiskFinding[] = [...(request.risk?.findings.filter((f) => f.source === "rule") ?? [])];
    if (!matches) {
      findings.push({ severity: "stop", text: "The receipt total doesn't match the amount requested.", evidence: `Receipt total ${formatCents(totalCents)}; request ${formatCents(request.amountCents)}`, source: "ai" });
    }
    const lights = sheet.items.find((item) => item.description === "Patio string lights");
    if (lights) findings.push({ severity: "warn", text: "One line on the receipt is not a league item.", evidence: `Receipt line 2: patio string lights, ${formatCents(lights.amountCents)}`, source: "ai" });
    const verdict = findings.some((f) => f.severity === "stop") ? "stop" : findings.some((f) => f.severity === "warn") ? "check" : "clear";
    const summary = {
      clear: `The receipt matches the request: ${sheet.vendor}, ${formatCents(totalCents)}.`,
      check: findings.find((f) => f.severity === "warn")?.text ?? "One thing to check before signing.",
      stop: `The receipt says ${formatCents(totalCents)}, but the request asks for ${formatCents(request.amountCents)}.`,
    }[verdict];
    return {
      verdict,
      summary,
      findings,
      receipt: { vendor: sheet.vendor, date: request.createdAt.slice(0, 10), items: sheet.items, totalCents },
      matchesRequest: matches,
      origin: "live",
      model: "dev fixture (no AI call)",
      checkedAt: nowIso(),
    };
  }

  return {
    getView: () => reply(view),
    async sign(requestId, body) {
      await sleep(latencyMs);
      const request = find(requestId);
      if (!request) return { ok: false, status: 404, code: "unknown_request", message: "That payout request isn't in this session." };
      return sign(request, body);
    },
    async createRequest(body) {
      await sleep(latencyMs);
      return create(body);
    },
    async assessRisk(requestId) {
      const request = find(requestId);
      if (!request) return { ok: false, status: 404, code: "unknown_request", message: "That payout request isn't in this session." };
      if (request.riskPending) {
        await sleep(readAfterMs);
        request.risk = aiCard(request);
        request.riskPending = false;
        appendEvent();
      }
      return reply(request).then((r) => ({ ok: true as const, request: r }));
    },
    async replayOutsideSend() {
      // The real route runs the recorded rows through the classifier: a little longer than a read.
      await sleep(latencyMs * 2);
      if (replayFails) return { ok: false, status: 503, code: "replay_unavailable", message: "The replay isn't available just now. Try again in a moment." };
      return { ok: true, replay: fixtureReplay() };
    },
  };
}
