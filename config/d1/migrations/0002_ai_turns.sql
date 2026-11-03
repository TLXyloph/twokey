-- Migration number: 0002 	 2026-11-03
-- The AI route's event-sourced spend and rate state (src/agents/llm/d1-ai-turn-log.ts), the
-- recorded answers it replays when the live AI is unavailable, and the log of judge sessions
-- issued per client IP (src/agents/llm/d1-session-issuance-log.ts). All three are append-only.
--
-- ai_turn_events: one row per event; every limit is derived from it, never kept as a counter.
--   reserved  the turn's worst-case cost, appended BEFORE the model is called, and only if the
--             session's rate, the session's budget share and the hard total budget all allow it
--             (one INSERT ... SELECT ... WHERE, so the check and the append are atomic);
--   settled   the turn's actual cost, appended when the turn ends (any outcome);
--   replayed  a turn answered from a recording (hit) or with the "unavailable" message (miss).
-- Spend = SUM(settled cost) + SUM(cost of reservations that have no settled event yet).
-- Rate  = COUNT(reserved + replayed) for the session over the last window.
-- Money is in whole micro-dollars (1 USD = 1,000,000); times are milliseconds since epoch.

CREATE TABLE ai_turn_events (
  seq                INTEGER PRIMARY KEY,
  turn_id            TEXT NOT NULL,
  kind               TEXT NOT NULL CHECK (kind IN ('reserved', 'settled', 'replayed')),
  session_id         TEXT NOT NULL,
  occurred_at        INTEGER NOT NULL,
  model              TEXT,
  request_hash       TEXT,
  cost_micro_usd     INTEGER NOT NULL DEFAULT 0 CHECK (cost_micro_usd >= 0),
  outcome            TEXT,
  input_tokens       INTEGER,
  output_tokens      INTEGER,
  cache_read_tokens  INTEGER,
  cache_write_tokens INTEGER,
  UNIQUE (turn_id, kind),
  CHECK (kind <> 'reserved' OR (model IS NOT NULL AND request_hash IS NOT NULL AND outcome IS NULL)),
  CHECK (kind <> 'settled' OR (model IS NOT NULL AND outcome IS NOT NULL)),
  CHECK (kind <> 'replayed' OR (request_hash IS NOT NULL AND outcome IN ('hit', 'miss') AND cost_micro_usd = 0))
);

CREATE INDEX ai_turn_events_session_time ON ai_turn_events (session_id, occurred_at);

-- A turn is settled only after it was reserved, and by the same session.
CREATE TRIGGER ai_turn_events_settle_needs_reservation
BEFORE INSERT ON ai_turn_events
WHEN NEW.kind = 'settled' AND NOT EXISTS (
  SELECT 1 FROM ai_turn_events r
  WHERE r.turn_id = NEW.turn_id AND r.kind = 'reserved' AND r.session_id = NEW.session_id
)
BEGIN
  SELECT RAISE(ABORT, 'ai_turn_events: settled without a reservation');
END;

-- History is never rewritten: refuse every UPDATE and DELETE.
CREATE TRIGGER ai_turn_events_no_update
BEFORE UPDATE ON ai_turn_events
BEGIN
  SELECT RAISE(ABORT, 'ai_turn_events is append-only');
END;

CREATE TRIGGER ai_turn_events_no_delete
BEFORE DELETE ON ai_turn_events
BEGIN
  SELECT RAISE(ABORT, 'ai_turn_events is append-only');
END;

-- One recorded answer per replay key (src/agents/llm/replay-key.ts); the first recording wins
-- (INSERT ... ON CONFLICT DO NOTHING). `ndjson` is the turn's response as streamed, with
-- consecutive text and tool-argument deltas joined.
CREATE TABLE ai_turn_recordings (
  request_hash TEXT PRIMARY KEY NOT NULL,
  turn_id      TEXT NOT NULL,
  model        TEXT NOT NULL,
  recorded_at  INTEGER NOT NULL,
  ndjson       TEXT NOT NULL
);

CREATE TRIGGER ai_turn_recordings_no_update
BEFORE UPDATE ON ai_turn_recordings
BEGIN
  SELECT RAISE(ABORT, 'ai_turn_recordings is append-only');
END;

CREATE TRIGGER ai_turn_recordings_no_delete
BEFORE DELETE ON ai_turn_recordings
BEGIN
  SELECT RAISE(ABORT, 'ai_turn_recordings is append-only');
END;

-- One row per judge session issued. `ip_hmac` is HMAC-SHA256 of the client IP keyed with the
-- Worker secret TWOKEY_SESSION_SECRET (hex); the raw IP is never stored. The per-IP cap is a
-- COUNT over a rolling window, checked and appended in one INSERT ... SELECT ... WHERE.
CREATE TABLE ai_session_issuances (
  seq        INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  ip_hmac    TEXT NOT NULL,
  issued_at  INTEGER NOT NULL  -- ms since epoch
);

CREATE INDEX ai_session_issuances_ip_time ON ai_session_issuances (ip_hmac, issued_at);

CREATE TRIGGER ai_session_issuances_no_update
BEFORE UPDATE ON ai_session_issuances
BEGIN
  SELECT RAISE(ABORT, 'ai_session_issuances is append-only');
END;

CREATE TRIGGER ai_session_issuances_no_delete
BEFORE DELETE ON ai_session_issuances
BEGIN
  SELECT RAISE(ABORT, 'ai_session_issuances is append-only');
END;
