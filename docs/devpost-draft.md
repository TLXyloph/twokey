# Devpost draft: TwoKey (for the Nov 5 eligibility check)

Paste each section into the matching Devpost field. Everything below is live on the hosted demo as of
Thu Nov 5, 2026, unless it's marked "next".

---

## Project name

TwoKey

## Elevator pitch (200 characters max)

A youth league's money in its own PayPal Business account. Every payout needs an AI-checked receipt and two officers' signatures, and the payee can never sign.

---

## About the project

### Inspiration

Club treasurers keep being charged with emptying the accounts they look after. In South Fayette, Pennsylvania, a youth football treasurer allegedly sent 70 Venmo payments, $56,450, to her husband. The board's spreadsheet showed more than $60,000; the account held $745 ([WPXI](https://www.wpxi.com/news/local/treasurer-accused-stealing-nearly-65k-local-youth-football-organization/FJ63BYOMHFGGLFRBW2OY7GJGTQ/)). In DeKalb County, Tennessee, a band boosters' car wash raised about $1,300 and $15 was deposited ([TN Comptroller](https://comptroller.tn.gov/content/dam/cot/ia/advanced-search/2026/school-support-organization/DeKalbCountyBandBoostersReport.pdf)).

The rules to stop this already exist. PTA and league rulebooks require two signatures on every payment, and say the payee must never sign. State PTAs tell their units to stop using personal Venmo and to use PayPal instead. But no bank and no payment app checks for the second signature. In every case above, one person held all the keys.

### What it does

TwoKey moves a club's money into a PayPal Business account in the club's name, and makes the rulebook the default:

- **Money in.** Parents pay through PayPal or Venmo on the club's event page (the demo sells end-of-season banquet tickets). The money goes straight into the club's PayPal account, never into anyone's personal Venmo.
- **Two keys on every payout.** An officer files a payout request with a receipt. That request is the first key. A second, different officer must sign before any money moves. The payee can never sign. The server enforces these rules, not the page: try to sign as the payee in the demo and the server refuses and records the refusal.
- **An AI-checked receipt.** Before the second key, an AI reads the receipt image and writes a risk card: what the receipt shows, whether it matches the request, and anything to check. For example, it flags $12 of patio string lights on a field-paint reimbursement. Plain-code rules add their own checks: the payee is an officer, the request is over its budget line, or the payments look split. If the card has flags, the second officer must tick "I've read the flags" before signing.
- **A deterministic executor.** Only when two valid signatures bind the same payee, amount and request does the server send a PayPal Payout. The request's hash is the Payout's `sender_batch_id` and its `PayPal-Request-Id`, so a retry can't pay twice. PayPal's webhooks then confirm it in the ledger, usually within a minute.
- **A ledger the treasurer can't edit.** Every payment, request, signature, refusal and payout is an event in an append-only, hash-chained ledger. Each signature binds the previous ledger hash, so history can't be rewritten without the chain breaking. Each session can re-check its whole chain, signatures included, at `/api/ledger/verify`.
- **An AI auditor on the board.** The board (built in AG Studio) shows the club's account, takings by event, and the payouts waiting for a second key. Ask the AI assistant "Where did the car-wash money go?" and it compares expected takings (87 cars at $15) with what reached the account ($15), using AG Studio's built-in agents.

### How we built it

- **PayPal (sandbox):** Payouts API for money out; Orders v2 with the JS SDK v6 for the PayPal and Venmo buttons; verified Webhooks for payout and capture events; the Balances reporting API for the shared account's real balance.
- **AI:** Claude Opus 5.5 (Anthropic API) reads receipt images and returns a structured risk card, and powers the AI assistant on the board as a custom primary agent that delegates to AG Studio's built-in agents. The public demo's AI spend is locked down: a per-session cookie, per-session and total hard budgets, rate limits, and recorded answers (labelled "replay") when the live budget runs out.
- **AG Studio (AG Grid):** the board, a custom balances widget, a custom theme, and the AI agent framework.
- **Platform:** Next.js 16 on Cloudflare Workers (OpenNext), with Cloudflare D1 for the event store. TypeScript, zod at every boundary, and about 1,100 Vitest tests.
- **Built with Claude Code**, with Anthropic's Claude models writing and reviewing much of the code under the author's direction.

### Challenges we ran into

- **Outside money movement is slow to appear.** A send made on PayPal's website fired no webhook, and showed up in Transaction Search 1 h 43 min later in one test and 4 h 49 min later during a sandbox reporting stall. So the auditor must say "usually within about 2 hours" and always show PayPal's "as of" time, never promise minutes.
- **The balance can lie.** That website send came with a same-time funding row, so the available balance never moved. Detection has to come from transaction rows, never from the balance.
- **Webhooks arrive out of order.** A payout's PROCESSING event was created first but arrived last, so events are ordered by PayPal's create time, not arrival.
- **A public AI demo can be drained.** The AI route needed sessions, reservations against a hard budget, and recorded fallbacks before it could go live.

### Accomplishments that we're proud of

- The whole two-key path runs end to end on the hosted demo against the PayPal sandbox: request, AI receipt check, a refused signature, the second key, a real sandbox Payout, and PayPal's webhook confirming it.
- Every refusal is recorded in the same hash-chained ledger as every payment, so "the system said no" is part of the audit trail too.

### What we learned

PayPal Payouts' own approvals allow one approver. The second key has to be built on top, and it only means something if the server, not the page, enforces it, and if the payee is excluded every time.

### What's next

- **The Watchtower (next):** poll Transaction Search every 10 minutes and alert every officer about any debit TwoKey didn't make, with a stale-report alert when PayPal's reporting falls behind.
- **Key setup (next):** a checklist that moves the owner login to the president and makes the treasurer a limited user, so TwoKey is the only app that can pay out.
- A real club would give each officer a passkey. The demo uses server-held "demo keys", one per role, and labels them.

---

## Built with

paypal, paypal-payouts, paypal-orders-v2, paypal-js-sdk-v6, venmo, paypal-webhooks, anthropic, claude, claude-opus-5-5, ag-grid, ag-studio, next.js, typescript, cloudflare-workers, cloudflare-d1, opennext, zod, vitest, claude-code

---

## Try it out

- Hosted demo: https://twokey.afterscroll.workers.dev
- The board (judge mode): https://twokey.afterscroll.workers.dev/demo
- The parent's payment page: https://twokey.afterscroll.workers.dev/demo/pay/banquet
- Code: https://github.com/TLXyloph/twokey (**private until the Nov 10 code freeze; then public under the MIT licence**)
- Video: (to come, Nov 9)

## Testing instructions

1. Open https://twokey.afterscroll.workers.dev/demo on a desktop browser (1220 px or wider shows the AI assistant open).
2. The "Judge mode" band at the top picks who you act as: President, Treasurer, Secretary or Parent. The officers' signatures use server-held demo keys.
3. Click **Review 2 payouts**. As the **Treasurer**, try to sign the field-paint reimbursement: you are its payee, so the server refuses and records it. Switch to the **President**, tick "I've read the flags", and sign: a real sandbox Payout goes out, and its timeline reaches "PayPal confirmed".
4. **Request a payout** (as any officer): pick a payee, an amount up to $50 and a sample receipt. The AI reads the receipt and writes the risk card.
5. **Buy banquet tickets (parent page)**: pay with PayPal or Venmo using the sandbox test-buyer login shown on that page. Your payment then appears in the board's ledger.
6. Ask the AI assistant one of the starters, e.g. "Where did the car-wash money go?".

Each browser session gets its own copy of the demo club (labelled "demo data"); your actions never appear in another judge's session. Limits: $50 per payout, 3 payouts per session.
