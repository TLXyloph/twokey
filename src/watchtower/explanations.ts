/**
 * Findings a person has explained (spec: .plans/watchtower-spec.md "Explained findings"). A
 * committed list, keyed by PayPal's transaction id or by the payout's `custom_field` (our
 * `sender_item_id`). An explained finding is stored and shown under "Explained" with its note; it
 * is never hidden. The view applies this list when it reads, so a new entry also explains a
 * finding stored before it was added.
 *
 * The two outside website sends (T0000 22N17109956532336 and 1TY14748YE721631B) stay open on
 * purpose: they are the real outside sends the judge demo is built around.
 */

export interface Explanation {
  transactionId?: string;
  customField?: string;
  note: string;
}

const SETUP_TEST =
  "TwoKey's setup test, Nov 2–3: a $1 payout sent by a developer script with the app's own credentials, before the two-key flow existed.";

export const EXPLANATIONS: readonly Explanation[] = [
  { transactionId: "3XT37311AK7894010", note: SETUP_TEST },
  { transactionId: "23Y96953CP0068646", note: SETUP_TEST },
  {
    customField: "eedb2122-9cd6-4fa4-8ef0-8ca52e4eab15",
    note: "TwoKey's local test, Nov 5: signed by two demo keys on a developer's machine, so it isn't in the hosted ledger.",
  },
];

export function explanationFor(transactionId: string, customField: string | null): string | null {
  const entry = EXPLANATIONS.find(
    (candidate) => candidate.transactionId === transactionId || (customField !== null && candidate.customField === customField),
  );
  return entry?.note ?? null;
}
