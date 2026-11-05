# TwoKey

**The treasurer shouldn't hold the keys.** Every club rulebook says two signatures on every payment, and the payee never signs. No bank and no payment app checks for the second one. TwoKey does.

TwoKey keeps a youth league's or PTA's money in its own PayPal Business account. Every payout needs an AI-checked receipt and two officers' signatures. An always-on Watchtower flags any money that leaves another way. Parents can see where the money went.

<!-- GIF: the two-key path in 15 seconds (to come) -->

- **Live demo (judge mode):** https://twokey.afterscroll.workers.dev/demo
- **Video (under 3 minutes):** to come
- Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/), November 2026.

---

## Try it in 3 minutes

Open https://twokey.afterscroll.workers.dev/demo on a desktop browser. Every browser session gets its own copy of a fictional club, "Riverbend Youth Football League (demo data)", so your actions never appear in another judge's session.

1. **Pick who you are.** The "Judge mode" band at the top switches between President, Treasurer, Secretary, Reviewer and Parent. Signatures use server-held demo keys, one per officer. A real club would give each officer a passkey.
2. **Click "Review 2 payouts".**
   - As the **Treasurer**, try to sign the field-paint reimbursement. The Treasurer is its payee, so the server refuses, and the refusal is recorded in the ledger.
   - Read its risk card: the AI read the receipt and found $12 of patio string lights on a field-paint claim.
   - Switch to the **President**: send it back with a reason, or tick "I've read the flags" and sign. Signing sends a real PayPal sandbox payout. Its timeline then reaches "PayPal confirmed" when PayPal's webhook arrives (about 40 seconds, measured).
3. **Request your own payout** (as any officer): a payee from the club's list, up to $50, and one of four sample receipts. The AI reads the receipt and writes the risk card.
4. **Buy banquet tickets** ("Buy banquet tickets (parent page)" in the band). Pay with PayPal or Venmo using the **sandbox test buyer** login shown on that page. The payment then appears on the board and the parent ledger.
5. **Watch the Watchtower.** Under the header: two $3.21 sends made from PayPal's own website on Nov 3, one of them to the Treasurer. TwoKey didn't make them, so the Watchtower flags them for every officer and parent. "Replay an outside send" replays the real event through the same checks, labelled as a replay.
6. **Ask the AI** on the board: "Where did the car-wash money go?"
7. **See the other screens** from the nav: the **parent ledger** (in the club's colours), the **monthly close** (the Reviewer signs it) and **key setup** (who holds which key).
8. **Start over** (in the band) gives you a fresh copy of the club from the seed. It counts as a new session: each network gets 5 an hour.

Limits in judge mode: $50 per payout, 3 payouts per session, and $500 a day across all sessions. The AI has a hard total budget. When it runs out, the AI features serve recorded answers labelled "replay".

---

## What it does

| The rulebook says | TwoKey makes it the default |
|---|---|
| Keep the money in an account in the club's name; no personal Venmo | Parents pay through the club's PayPal checkout (PayPal or Venmo), straight into the club's PayPal Business account |
| Two signatures on every payment; the payee never signs | A request is key 1; a second, different officer adds key 2; the payee can never sign. The **server** enforces it and records every refusal |
| Receipts for every payment, within the approved budget | The AI reads each receipt image and writes a risk card; plain-code rules check the budget line, the payee and split payments |
| Nobody can quietly change the books | An append-only, hash-chained ledger. Each signature binds the previous ledger hash. `/api/ledger/verify` re-checks the whole chain |
| Someone who isn't a signer reviews each month | The monthly close: the AI drafts the reconciliation, and the Reviewer signs it |
| No single person controls the account | Key setup moves the owner login to the President and makes the Treasurer a limited user; the public "Who holds the keys" panel shows it |
| Watch the account | The Watchtower reads PayPal's Transaction Search every 10 minutes and flags every debit TwoKey's two-key flow didn't make |

### How a payout works

1. An officer files a request with a receipt. The request's facts are hashed, and the request itself is signed: key 1.
2. Plain-code rules check it at once. Then the AI reads the receipt image and writes the risk card: "Looks right", "Check this" or "Stop".
3. A second officer signs (ticking "I've read the flags" if the card has flags), or sends it back with a reason.
4. Only when two valid signatures bind the same payee, amount and request does a **deterministic executor** send a PayPal Payout. The request hash is both the Payout's `sender_batch_id` and its `PayPal-Request-Id`, so a retry can't pay twice.
5. PayPal's verified webhook confirms the payout, and the ledger records it.

The AI never moves money: it has no payout tool. The executor is plain code that checks signatures.

### What the Watchtower catches

- **Money sent from PayPal's website, a bank withdrawal, a refund:** any debit row that isn't a TwoKey payout.
- **A payout without two valid signatures,** even one made with TwoKey's own credentials. It traces each payout row through PayPal's webhook records to the ledger, and checks both signatures.
- **Late reports:** PayPal's reporting usually runs within about 2 hours, and the Watchtower always shows PayPal's "as of" time. If the reports fall more than 3 hours behind, it says so.
- **Lost access:** if PayPal refuses TwoKey's credentials, every officer is told.
- **Its own silence:** if it hasn't checked in for 30 minutes, the board says so.

It never detects from the balance. In a measured test, a website send came with a same-time bank-funding row, so the balance never moved.

### Honest limits

- **The account owner can still bypass TwoKey.** Whoever holds PayPal's owner login can send money from PayPal's website. TwoKey can't block that. It detects it and shows it to every officer and parent, usually within about 2 hours, which is why key setup gives the owner login to the President, not the Treasurer.
- **Cash and cheques** paid into a bank stay outside TwoKey. Instead, each event's tally (for example, 87 cars at $15) sets an expected take, and the gap shows.
- **Demo keys:** in judge mode the server holds one signing key per role. A real club would use one passkey per officer.
- **Sandbox only.** The PayPal client refuses any base URL but the sandbox.

---

## How it's built

| Part | What |
|---|---|
| PayPal | **Payouts API** (money out); **Orders v2 + JS SDK v6** with the **PayPal and Venmo** buttons (money in); **Webhooks**, verified with PayPal's verification API and stored append-only; **Transaction Search** (the Watchtower); **Balances** reporting (the shared account's real balance) |
| AI | **Claude Opus 5.5** through the **Anthropic API**: it reads receipt images and returns structured risk cards; it drafts the monthly reconciliation; it powers the board's AI assistant as a custom primary agent that delegates to AG Studio's built-in agents. The public demo's AI calls go through per-session cookies, rate limits, reservations against a hard budget, and recorded fallbacks |
| AG Studio (AG Grid) | The officers' board and the parent ledger: custom widgets, two themes (an achromatic ledger for officers, the club's colours for parents), and the Studio agent framework |
| Platform | Next.js 16 on **Cloudflare Workers** (OpenNext), **Cloudflare D1** for the event store, a **Cron Trigger** for the Watchtower |
| Code | TypeScript (strict), zod at every boundary, bounded contexts (Ledger, Disbursements, Collections, Watchtower, Agents), event sourcing, about 1,300 Vitest tests |

### AI tools used

- **Claude Opus 5.5 (Anthropic API):** in the product, as described above.
- **Claude Code:** the author built TwoKey with Claude Code. Claude models wrote and reviewed much of the code under the author's direction, with parallel agents for separate parts.

### Code map

```
src/
  ledger/         the event store, hash chain and the board's fold (contracts.ts is the shared contract)
  disbursements/  payout requests, eligibility, Ed25519 demo keys, the executor, risk/ (receipt checks)
  collections/    banquet orders (PayPal Orders v2)
  watchtower/     Transaction Search, classify, trace, store, the cron run
  close/          the monthly close
  agents/         the AI route (llm/), the board's agent (studio/), the receipt reader (treasurer/)
  payments/paypal the sandbox-only PayPal client, payouts, orders, webhooks, transactions
  ui/             the board, the judge band and drawer, the parent ledger, the pay page, the landing page
config/d1/migrations  append-only D1 tables (UPDATE and DELETE refused by triggers)
scripts/          key generation, secret setting (values on stdin, never printed), recordings
tests/            Vitest, mirroring src/
```

---

## Run it yourself

You need Node 22+, a Cloudflare account (Workers Paid, for CPU time), a PayPal developer account (free sandbox), an Anthropic API key and an AG Studio licence (a trial works).

1. **Install:** `npm ci`
2. **PayPal sandbox:**
   - Create a REST app in the [developer dashboard](https://developer.paypal.com/dashboard/applications/sandbox), with Payouts and Transaction Search enabled.
   - Copy its client id and secret.
   - Create a personal sandbox account to use as the test buyer.
3. **Settings:** copy `config/env.example` to `.env` and fill it in. Make the demo keys with `bash scripts/gen-demo-keys.sh` (it writes the private keys to `.dev.vars` and the public keys to `src/disbursements/demo-public-keys.json`; copy the `TWOKEY_DEMO_KEY_*` lines into `.env` for `next dev`). Make the Reviewer's key the same way with `bash scripts/gen-reviewer-key.sh` (public key in `src/close/reviewer-public-key.json`).
4. **Run locally:** `npm run dev`, then open http://localhost:3000/demo. Under `next dev` the ledger lives in memory.
5. **Test:** `npm test` and `npx tsc --noEmit`.
6. **Deploy to Cloudflare:**
   - Create the D1 database `twokey` and put its id in `wrangler.jsonc`.
   - Run `npx wrangler d1 migrations apply twokey --remote`.
   - Set each secret with `npx wrangler secret put NAME`, reading the value from stdin. `scripts/put-worker-secret.py`, `scripts/gen-demo-keys.sh --deploy` and `scripts/gen-reviewer-key.sh --deploy` do this without printing values.
   - Run `npm run deploy`, which builds without your `.env`, scans the bundle for secrets, and deploys.
7. **Webhooks:** register `https://<your-worker>/api/paypal/webhook` for all events (`python3 scripts/paypal-sandbox-spike.py webhook-register --url …`) and set `PAYPAL_WEBHOOK_ID`.

### Sandbox logins for testing

- **Test buyer:** shown on the live pay page (https://twokey.afterscroll.workers.dev/demo/pay/banquet).
- **Officers' payouts** go to the club's own sandbox accounts.

---

## Licence

MIT. See [LICENSE](LICENSE).
