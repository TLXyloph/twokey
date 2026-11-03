-- Migration number: 0001 	 2026-11-03
-- The append-only log of verified PayPal webhook events (src/ledger/event-store.ts).
-- One row per PayPal event id; a redelivery is a no-op (INSERT ... ON CONFLICT DO NOTHING).
-- The summary columns are copied from the event for querying; `payload` is the event text
-- exactly as PayPal sent it, so every summary can be re-derived from it.

CREATE TABLE paypal_events (
  event_id         TEXT PRIMARY KEY NOT NULL,
  event_type       TEXT NOT NULL,
  resource_type    TEXT,
  resource_id      TEXT,
  resource_status  TEXT,
  amount_value     TEXT,  -- a decimal string as PayPal sends it ("500.00"), never a float
  amount_currency  TEXT,
  event_created_at TEXT,  -- the event's create_time
  received_at      TEXT NOT NULL,  -- ISO 8601, when this Worker stored it
  payload          TEXT NOT NULL
);

-- History is never rewritten: refuse every UPDATE and DELETE.
CREATE TRIGGER paypal_events_no_update
BEFORE UPDATE ON paypal_events
BEGIN
  SELECT RAISE(ABORT, 'paypal_events is append-only');
END;

CREATE TRIGGER paypal_events_no_delete
BEFORE DELETE ON paypal_events
BEGIN
  SELECT RAISE(ABORT, 'paypal_events is append-only');
END;
