-- Migration number: 0003 	 2026-11-05
-- The judge sessions' ledger (src/ledger/d1-ledger-table.ts, spec §2): one append-only,
-- hash-chained event stream per session. `hash` is SHA-256 of the canonical JSON
-- {sessionId, seq, type, payload, occurredAt, prevHash}; seq 1's `prev_hash` is the seed hash.
-- Appends are optimistic: read the head, insert seq + 1 (INSERT ... ON CONFLICT DO NOTHING), and
-- re-read and retry when another append took that seq first.
--
-- The lookup columns are copied from the payload at append time, for webhook linking and the
-- daily payout limit; `payload` stays the source of truth.
--   order_id         order.created, payment.captured
--   sender_batch_id  payout.requested (its request hash), payout.sent
--   payout_batch_id  payout.sent, payout.confirmed
--   request_id       every payout.*, approval.* and risk.* event
--   amount_cents     order.created, payment.captured, payout.requested (integer cents, never a float)

CREATE TABLE ledger_events (
  session_id      TEXT NOT NULL,
  seq             INTEGER NOT NULL CHECK (seq >= 1),
  event_id        TEXT NOT NULL UNIQUE,
  type            TEXT NOT NULL CHECK (type IN (
                    'session.opened', 'order.created', 'payment.captured', 'payment.confirmed',
                    'payout.requested', 'risk.assessed', 'approval.signed', 'approval.refused',
                    'payout.blocked', 'payout.sent', 'payout.failed', 'payout.confirmed')),
  payload         TEXT NOT NULL,  -- canonical JSON
  occurred_at     TEXT NOT NULL,  -- ISO 8601 (toISOString), set by the server
  prev_hash       TEXT NOT NULL,
  hash            TEXT NOT NULL,
  -- Scoped to the session: the seeded requests' keys ("seed:L14:request") repeat in every session.
  idempotency_key TEXT,
  order_id        TEXT,
  sender_batch_id TEXT,
  payout_batch_id TEXT,
  request_id      TEXT,
  amount_cents    INTEGER,
  PRIMARY KEY (session_id, seq),
  UNIQUE (session_id, idempotency_key)
);

CREATE INDEX ledger_events_order_id ON ledger_events (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX ledger_events_sender_batch_id ON ledger_events (sender_batch_id) WHERE sender_batch_id IS NOT NULL;
CREATE INDEX ledger_events_payout_batch_id ON ledger_events (payout_batch_id) WHERE payout_batch_id IS NOT NULL;
CREATE INDEX ledger_events_request ON ledger_events (session_id, request_id) WHERE request_id IS NOT NULL;
CREATE INDEX ledger_events_type_time ON ledger_events (type, occurred_at);

-- The chain holds in the database too: every event after the first must link to the event
-- right before it in its session.
CREATE TRIGGER ledger_events_chain
BEFORE INSERT ON ledger_events
WHEN NEW.seq > 1 AND NOT EXISTS (
  SELECT 1 FROM ledger_events p
  WHERE p.session_id = NEW.session_id AND p.seq = NEW.seq - 1 AND p.hash = NEW.prev_hash
)
BEGIN
  SELECT RAISE(ABORT, 'ledger_events: an event must link to the one before it');
END;

-- History is never rewritten: refuse every UPDATE and DELETE.
CREATE TRIGGER ledger_events_no_update
BEFORE UPDATE ON ledger_events
BEGIN
  SELECT RAISE(ABORT, 'ledger_events is append-only');
END;

CREATE TRIGGER ledger_events_no_delete
BEFORE DELETE ON ledger_events
BEGIN
  SELECT RAISE(ABORT, 'ledger_events is append-only');
END;
