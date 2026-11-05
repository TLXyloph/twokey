-- Migration number: 0005 	 2026-11-05
-- The monthly close's sign-offs (src/close/, spec §5.6): the Reviewer, a non-signer, signs the
-- month's close with the server-held Reviewer demo key. One row per judge session and month,
-- append-only.
--
-- The signature is Ed25519 (base64url) over the canonical JSON of
--   {closeHash, keyId, month, role, signedAt, type: "twokey.close.signoff.v1"}
-- so every signed value is in the row; `close_hash` is SHA-256 (hex) of the close's figures
-- (src/close/october.ts). Inserts are INSERT ... ON CONFLICT DO NOTHING: a second sign-off for the
-- same session and month is a duplicate, answered with the first.

CREATE TABLE close_signoffs (
  session_id  TEXT NOT NULL,
  month       TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  close_hash  TEXT NOT NULL CHECK (length(close_hash) = 64),
  role        TEXT NOT NULL CHECK (role = 'reviewer'),
  key_id      TEXT NOT NULL CHECK (length(key_id) = 8),
  signature   TEXT NOT NULL,
  signed_at   TEXT NOT NULL,  -- ISO 8601 (toISOString), set by the server
  PRIMARY KEY (session_id, month)
);

-- History is never rewritten: refuse every UPDATE and DELETE.
CREATE TRIGGER close_signoffs_no_update
BEFORE UPDATE ON close_signoffs
BEGIN
  SELECT RAISE(ABORT, 'close_signoffs is append-only');
END;

CREATE TRIGGER close_signoffs_no_delete
BEFORE DELETE ON close_signoffs
BEGIN
  SELECT RAISE(ABORT, 'close_signoffs is append-only');
END;
