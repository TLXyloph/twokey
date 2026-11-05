/**
 * The Disbursements services wired for tests, London style: the ledger is the real in-memory
 * store, the demo keys are real throwaway keys, and the context boundaries are mocks: the
 * RiskAssessor, the PayPal client, the clock and the id source.
 */
import { vi } from "vitest";
import type { RiskAssessor, RiskCard } from "@/ledger/contracts";
import { createLedgerStore, type TwoKeyLedgerStore } from "@/ledger/ledger-store";
import { createInMemoryLedgerTable, type InMemoryLedgerTable } from "@/ledger/ledger-table";
import type { PaypalClient, PaypalJsonResponse } from "@/payments/paypal/client";
import { createSessionOpener } from "@/disbursements/open-session";
import { createSignatureVerifier, loadDemoSigner, type DemoSigner, type SignatureVerifier } from "@/disbursements/signing";
import { rulesCard, sequentialIds, steppingClock } from "../ledger/fixtures";
import { sharedTestDemoKeys, type TestDemoKeys } from "./demo-keys";

export const SESSION = "session-aaaaaaaaaaaaaaaa";

export function mockRisk(ai: RiskCard | null = null) {
  const rules = vi.fn<RiskAssessor["rulesCard"]>((_input, now) => rulesCard({ checkedAt: now.toISOString() }));
  const aiCard = vi.fn<RiskAssessor["aiCard"]>(async () => ai);
  return { assessor: { rulesCard: rules, aiCard } satisfies RiskAssessor, rulesCard: rules, aiCard };
}

export const batchCreated = (id = "BATCH-1", status = "PENDING"): PaypalJsonResponse => ({
  status: 201,
  body: { batch_header: { payout_batch_id: id, batch_status: status } },
});

export function mockPaypal(answer: () => PaypalJsonResponse | Promise<PaypalJsonResponse> = () => batchCreated()) {
  const postJson = vi.fn<PaypalClient["postJson"]>(async () => answer());
  const getJson = vi.fn<PaypalClient["getJson"]>(async () => ({ status: 404, body: undefined }));
  const client: PaypalClient = { apiBase: "https://api-m.sandbox.paypal.com", getAccessToken: async () => "token", postJson, getJson };
  return { client, postJson, getJson };
}

export interface Harness {
  keys: TestDemoKeys;
  table: InMemoryLedgerTable;
  ledger: TwoKeyLedgerStore;
  signer: DemoSigner;
  verifier: SignatureVerifier;
  risk: ReturnType<typeof mockRisk>;
  paypal: ReturnType<typeof mockPaypal>;
  now: () => Date;
  newId: () => string;
}

export async function harness(options: { ai?: RiskCard | null; paypal?: ReturnType<typeof mockPaypal> } = {}): Promise<Harness> {
  const keys = await sharedTestDemoKeys();
  const loaded = await loadDemoSigner(keys.env, keys.publicKeys);
  if (!loaded.ok) throw new Error(loaded.problems.join(","));
  const risk = mockRisk(options.ai ?? null);
  const table = createInMemoryLedgerTable();
  const now = steppingClock();
  const ledger = createLedgerStore(table, { opener: createSessionOpener({ signer: loaded.signer, risk: risk.assessor }), now, newId: sequentialIds() });
  return {
    keys,
    table,
    ledger,
    signer: loaded.signer,
    verifier: createSignatureVerifier(keys.publicKeys),
    risk,
    paypal: options.paypal ?? mockPaypal(),
    now,
    newId: sequentialIds("R"),
  };
}

/** The deps every service takes, from a harness. */
export const deps = (h: Harness) => ({
  ledger: h.ledger,
  signer: h.signer,
  verifier: h.verifier,
  risk: h.risk.assessor,
  paypal: h.paypal.client,
  now: h.now,
  newId: h.newId,
});
