-- Migration number: 0004 	 2026-11-05
-- The Watchtower (src/watchtower/, spec .plans/watchtower-spec.md): one global poll of PayPal's
-- Transaction Search every 10 minutes. Both tables are append-only.
--
-- watchtower_runs: one row per run, appended when the run ends. `outcome` is 'ok' (PayPal
-- answered and every row was judged), 'no_access' (the token or search call answered 401/403)
-- or 'paypal_error' (anything else). `paypal_as_of` is PayPal's last_refreshed_datetime. `detail`
-- is a fixed code (e.g. 'search_http_500', 'unreadable_rows'), never a response body.
CREATE TABLE watchtower_runs (
  run_id       TEXT PRIMARY KEY NOT NULL,
  started_at   TEXT NOT NULL,  -- ISO 8601
  finished_at  TEXT NOT NULL,  -- ISO 8601
  outcome      TEXT NOT NULL CHECK (outcome IN ('ok', 'no_access', 'paypal_error')),
  paypal_as_of TEXT,
  rows_seen    INTEGER NOT NULL DEFAULT 0 CHECK (rows_seen >= 0),
  new_findings INTEGER NOT NULL DEFAULT 0 CHECK (new_findings >= 0),
  detail       TEXT
);

CREATE INDEX watchtower_runs_finished ON watchtower_runs (finished_at);
CREATE INDEX watchtower_runs_outcome_finished ON watchtower_runs (outcome, finished_at);

-- watchtower_findings: one row per flagged PayPal transaction id (INSERT ... ON CONFLICT DO
-- NOTHING, so two runs at once store it once). The WatchFinding fields, plus `custom_field` (the
-- payout's sender_item_id, which explanations may key on), `backfill` (found by the first
-- successful run, so the reporting delay isn't known) and the run that found it. Explanations
-- live in code (src/watchtower/explanations.ts); `explanation` records the one known at insert.
-- Counterparties are names or masked emails, never a full email.
CREATE TABLE watchtower_findings (
  transaction_id          TEXT PRIMARY KEY NOT NULL,
  kind                    TEXT NOT NULL CHECK (kind IN ('outside_debit', 'unsigned_payout')),
  event_code              TEXT NOT NULL,
  label                   TEXT NOT NULL,
  amount_cents            INTEGER NOT NULL CHECK (amount_cents > 0),
  counterparty            TEXT,
  counterparty_is_officer INTEGER NOT NULL CHECK (counterparty_is_officer IN (0, 1)),
  at                      TEXT NOT NULL,  -- when PayPal says the money moved
  first_seen_at           TEXT NOT NULL,
  reported_after_minutes  INTEGER CHECK (reported_after_minutes IS NULL OR reported_after_minutes >= 0),
  funded_by_bank          INTEGER NOT NULL CHECK (funded_by_bank IN (0, 1)),
  explanation             TEXT,
  custom_field            TEXT,
  backfill                INTEGER NOT NULL CHECK (backfill IN (0, 1)),
  run_id                  TEXT NOT NULL,
  CHECK (backfill = 0 OR reported_after_minutes IS NULL)
);

CREATE INDEX watchtower_findings_at ON watchtower_findings (at);

-- History is never rewritten: refuse every UPDATE and DELETE.
CREATE TRIGGER watchtower_runs_no_update
BEFORE UPDATE ON watchtower_runs
BEGIN
  SELECT RAISE(ABORT, 'watchtower_runs is append-only');
END;

CREATE TRIGGER watchtower_runs_no_delete
BEFORE DELETE ON watchtower_runs
BEGIN
  SELECT RAISE(ABORT, 'watchtower_runs is append-only');
END;

CREATE TRIGGER watchtower_findings_no_update
BEFORE UPDATE ON watchtower_findings
BEGIN
  SELECT RAISE(ABORT, 'watchtower_findings is append-only');
END;

CREATE TRIGGER watchtower_findings_no_delete
BEFORE DELETE ON watchtower_findings
BEGIN
  SELECT RAISE(ABORT, 'watchtower_findings is append-only');
END;

-- Tracing a T0001 payout (src/watchtower/d1-trace-sources.ts) looks up the stored
-- PAYMENT.PAYOUTS-ITEM.* webhook whose resource.transaction_id is the T0001's id (measured equal,
-- 2026-11-05). An index on that expression; json_valid guards it, so a payload SQLite can't parse
-- indexes as NULL instead of failing the webhook's insert. The query repeats the expression exactly.
CREATE INDEX paypal_events_resource_transaction_id
ON paypal_events (CASE WHEN json_valid(payload) THEN json_extract(payload, '$.resource.transaction_id') END);
