# Devpost submission: TwoKey (final, Thu Nov 12 2026)

Paste each section into the matching Devpost field. Everything below is live on the hosted demo as of
Thu Nov 12, 2026 (checked at 17:05 UTC). Measured numbers say so; nothing here is planned work
except under "What's next".

---

## Project name

TwoKey

## Elevator pitch (194 of 200 characters)

The treasurer shouldn't hold the keys. TwoKey takes the club's PayPal login away from any one officer, puts two signatures and an AI-checked receipt on every payout, and flags any other way out.

(Earlier version, also 194: "The treasurer shouldn't hold the keys. TwoKey keeps a club's money in its own PayPal account: two officers sign every payout, an AI checks each receipt, and a Watchtower flags any other way out.")

---

## About the project

### Inspiration

Club treasurers keep being charged with emptying the accounts they look after. In South Fayette, Pennsylvania, a youth football treasurer allegedly sent 70 Venmo payments, $56,450, to her husband. The board's spreadsheet showed more than $60,000; the account held $745 ([WPXI](https://www.wpxi.com/news/local/treasurer-accused-stealing-nearly-65k-local-youth-football-organization/FJ63BYOMHFGGLFRBW2OY7GJGTQ/)). In DeKalb County, Tennessee, a band boosters' car wash raised about $1,300 and $15 was deposited ([TN Comptroller](https://comptroller.tn.gov/content/dam/cot/ia/advanced-search/2026/school-support-organization/DeKalbCountyBandBoostersReport.pdf)).

The rules to stop this already exist. PTA and league rulebooks require two signatures on every payment and say the payee must never sign. State PTAs tell their units to stop using personal Venmo. But no bank and no payment app checks for the second signature, and in every case above one person held all the keys: the login, the books and the alerts.

### What it does

TwoKey moves a club's money into a PayPal Business account in the club's name, and makes the rulebook the default. A second signature only helps if no one can go around it, so TwoKey starts with who holds the account's keys, then puts two keys on every payout, then watches PayPal's own records for anything that left another way. The demo club is a fictional youth league, "Riverbend Youth Football League (demo data)".

- **Key setup.** A checklist walks the board through the PayPal settings no API can change: the owner login moves to the President with two-step login, the Treasurer becomes a limited user who can't send or withdraw, TwoKey becomes the only app with Payouts, and the club's personal Venmo is retired. A public "Who holds the keys" panel shows who holds which access, each officer's signing key, and the last signature each key made.
- **Money in.** Parents buy tickets on the club's own page (the demo sells end-of-season banquet tickets) with PayPal or Venmo buttons. The money goes straight into the club's PayPal account and onto the ledger; PayPal's webhook then confirms it (19 seconds after the capture, measured).
- **Two keys on every payout.** An officer files a payout request with a receipt: key 1. A second, different officer must sign before any money moves, and the payee or requester can never sign. The **server** enforces this, not the page: sign as the payee in the demo and the server refuses and records the refusal. Key 2 can also send a request back with a reason, which goes on its record.
- **An AI-checked receipt.** Before key 2, the AI reads the receipt image and writes a risk card ("Looks right", "Check this" or "Stop"). For example, it flags $12.00 of patio string lights on a field-paint reimbursement. Plain-code rules add their own checks: the payee is an officer, the request is over its budget line, the payments look split. If the card has flags, the second officer must tick "I've read the flags" before signing.
- **A deterministic executor.** Only when two valid signatures bind the same payee, amount and request does plain code send a PayPal Payout. The request's hash is the Payout's `sender_batch_id` and its `PayPal-Request-Id`, so a retry can't pay twice. PayPal's webhook confirms it about 40 seconds later (measured). The AI never moves money: it has no payout tool.
- **A ledger the treasurer can't edit.** Every payment, request, signature, refusal and payout is an event in an append-only, hash-chained ledger; each signature binds the previous ledger hash. `/api/ledger/verify` re-checks the whole chain, signatures included.
- **The Watchtower.** Every 10 minutes it reads PayPal's own Transaction Search and flags every debit the two-key flow didn't make: a send from PayPal's website, a withdrawal, a refund, even a payout made with TwoKey's own credentials but without two valid signatures. It always shows PayPal's "as of" time, and says so when PayPal's reports fall behind, when it loses access, or when it stops checking. The live demo shows two real $3.21 sends made from PayPal's website, one of them to the Treasurer; "Replay an outside send" runs that recorded event through the same checks, labelled as a replay.
- **The parent ledger.** Parents get a read-only view in the team's colours: money in and out, takings by event, the payouts waiting for a second key (amounts and payees, never emails) and the Watchtower's newest finding, pinned at the top.
- **The monthly close.** October's statement is computed in code from the ledger: opening balance, money in, money out, closing balance, each budget line, and the exceptions (the car wash: 87 cars at $15 = $1,305 expected, $15 received). The AI drafted the plain-words reconciliation (recorded once, labelled), and a Reviewer who holds no payout key signs the close's hash. Every other role is refused, with the reason.
- **An AI auditor on the board.** The officers' board is built in AG Studio. Ask its AI assistant "Where did the car-wash money go?" and it compares expected takings with what reached the account.

### How we built it

- **PayPal (sandbox):** the **Payouts API** for money out; **Orders v2 with the JS SDK v6** (PayPal and Venmo buttons) for money in; **Webhooks**, verified through PayPal's verification API and stored append-only; **Transaction Search** for the Watchtower; **Balances** reporting for the shared account's real balance.
- **AI:** **Claude Opus 5.5** through the **Anthropic API** reads receipt images and returns structured risk cards, drafted the monthly reconciliation, and powers the board's AI assistant as a custom primary agent that delegates to AG Studio's built-in agents. The public demo's AI is locked down: same-origin checks, a signed per-session cookie, 5 new sessions per network per hour, rate limits, reservations against a hard $10 total budget, and recorded answers (labelled "replay") when the live budget runs out.
- **AG Studio (AG Grid):** two Studio boards with two themes: an achromatic ledger for officers, and the club's maroon and gold for parents (built with `studioTheme.withParams`, read-only). Two custom widgets (the officers' live balances strip, which also joins the AI's widget catalogue, and the parent balance widget), two overrides of built-in widgets (a grid cell that prints a shortfall in the data colour, and a chart axis in whole dollars), custom page layouts, and the Studio agent framework with our own primary agent.
- **Platform:** Next.js 16 on **Cloudflare Workers** (OpenNext), **Cloudflare D1** for the append-only event store (UPDATE and DELETE refused by triggers), and a **Cron Trigger** for the Watchtower.
- **Code:** TypeScript (strict), zod at every boundary, bounded contexts (Ledger, Disbursements, Collections, Watchtower, Close, Agents), event sourcing, and 1,540 Vitest tests.
- **Built with Claude Code.** Claude models wrote and reviewed much of the code under the author's direction, with parallel agents building separate parts.

### Challenges we ran into

- **Outside money movement is slow to appear, and fires no webhook.** A send made on PayPal's website fired no webhook in 16 minutes, and reached Transaction Search 1 h 43 min later in one test, and 4 h 49 min later during a sandbox reporting stall. So the Watchtower says "usually within about 2 hours" and always shows PayPal's "as of" time.
- **The balance can lie.** That website send came with a same-time bank-funding row, so the available balance never moved. Detection has to come from transaction rows, never from the balance.
- **Webhooks arrive out of order.** A payout's PROCESSING event was created first but arrived last, so events are ordered by PayPal's create time, not arrival.
- **A public AI demo can be drained.** The AI route needed sessions, reservations against a hard budget and recorded fallbacks before it could go live.
- **PayPal's own approvals allow one approver.** The second key had to be built on top, enforced by the server, with the payee excluded every time.

### Accomplishments that we're proud of

- The whole two-key path runs end to end on the hosted demo against the PayPal sandbox: request, AI receipt check, a refused signature, the second key, a real sandbox Payout, and PayPal's webhook confirming it.
- The Watchtower caught real outside sends from PayPal's website, with PayPal's real timestamps, and traces every payout back through PayPal's webhooks to two verified signatures.
- Every refusal is recorded in the same hash-chained ledger as every payment, so "the system said no" is part of the audit trail.

### What we learned

Two keys only mean something if a single officer can't go around them. That's why TwoKey starts with key setup, not with the approval button: who holds PayPal's owner login matters more than any software rule. What TwoKey can't block (the owner sending money from PayPal's website), it detects and shows to everyone.

### What's next

- One passkey per officer instead of the demo's server-held keys.
- Faster detection of outside sends by reading PayPal's notification emails, confirmed by Transaction Search.
- A daily AI audit for softer patterns (split payments, round amounts), and tally logging by volunteers at events.
- A pilot with a real PTA or youth league on PayPal's live API.

### Honest limits

- The account owner can still send money from PayPal's website. TwoKey can't block that; it detects it, usually within about 2 hours, and shows it to every officer and parent. That's why key setup gives the owner login to the President, not the Treasurer.
- Cash and cheques paid into a bank stay outside TwoKey; each event's tally sets an expected take, and the gap shows.
- Judge mode uses server-held demo keys, one per role, labelled as such. Sandbox only.

---

## Built with

paypal, paypal-payouts, paypal-orders-v2, paypal-js-sdk-v6, venmo, paypal-webhooks, paypal-transaction-search, anthropic, claude, claude-opus-5-5, ag-grid, ag-studio, next.js, react, typescript, cloudflare-workers, cloudflare-d1, opennext, zod, vitest, claude-code

---

## Try it out (links)

- Hosted demo (judge mode): https://twokey.afterscroll.workers.dev/demo
- Landing page: https://twokey.afterscroll.workers.dev
- Code (MIT): https://github.com/TLXyloph/twokey
- Video: **[YouTube link]**

## Testing instructions (for judges)

1. Open https://twokey.afterscroll.workers.dev/demo on a desktop browser (1220 px or wider shows the AI assistant). Each browser session gets its own copy of the demo club, so your actions never appear in another judge's session.
2. The "Judge mode" band at the top picks who you act as: President, Treasurer, Secretary, Reviewer or Parent, and links the four screens: Board, Parent ledger, Monthly close, Key setup.
3. Click **Review 2 payouts**. As the **Treasurer**, try to sign the field-paint reimbursement: you're its payee, so the server refuses and records it. Read its risk card (the patio string lights). Switch to the **President**: send it back with a reason, or tick "I've read the flags" and sign the goalkeeper gloves. A real sandbox Payout goes out, and its timeline reaches "PayPal confirmed" in about 40 seconds.
4. **Request a payout** (as any officer): a payee, up to $50, and one of four sample receipts. The AI reads the receipt and writes the risk card.
5. **Buy tickets (parent page):** copy the sandbox test buyer's email shown on the ticket, click "Pay with PayPal", paste it, and type the password from the ticket (PayPal's window covers the page while it's open). Then open the Parent ledger.
6. **Watchtower:** the board's header shows the real $3.21 sends from PayPal's website. Click "Replay an outside send" to watch the alert fire.
7. **Monthly close:** switch to the **Reviewer** and sign October's close. **Key setup:** mark the five steps done and watch "Who holds the keys" change.
8. Ask the AI assistant: "Where did the car-wash money go?"
9. **Start over** in the band gives you a fresh copy of the club (5 new sessions per network per hour).

Limits in judge mode: $50 per payout, 3 payouts per session, $500 a day across all sessions. The AI has a hard total budget; when it runs out, the AI features serve recorded answers labelled "replay".

---

## For the AG Grid (AG Studio) prize

- **Two AG Studio boards, two themes:** the officers' board in an achromatic ledger theme, and the parent ledger in the club's maroon and gold (`studioTheme.withParams`), read-only for parents.
- **Custom widgets:** the officers' "Live Balance" strip (added to the widget menu, so the AI can place it too) and the parent balance widget; plus two overrides of built-in widgets: the grid's shortfall cell and a whole-dollar money axis on grouped column charts.
- **Studio agent framework:** our own primary agent (`tools.delegateTo`) runs on Claude Opus 5.5 through our locked-down `/api/ai/turn` route and delegates to AG Studio's built-in Page and Widget agents; four prompt starters, including "Show the car-wash rows", which adds a grid to the board.
