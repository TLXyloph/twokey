#!/usr/bin/env bash
# Generate the Reviewer's demo signing key (spec §5.6): one Ed25519 keypair. The Reviewer signs the
# monthly close and holds no payout key.
#
#   scripts/gen-reviewer-key.sh [--rotate] [--deploy]
#
# - The private key (PKCS8 DER, base64, one line) goes into .dev.vars as TWOKEY_DEMO_KEY_REVIEWER.
#   Only that line is created or replaced; every other line is kept. The file is chmod 600 and
#   gitignored: never commit it.
# - The public key (raw 32 bytes, base64) and its key id (the first 8 hex characters of SHA-256 over
#   the raw public key) go into src/close/reviewer-public-key.json. Commit that file.
# - --deploy pipes the private key into `npx wrangler secret put TWOKEY_DEMO_KEY_REVIEWER` on stdin.
# - An existing key (in .dev.vars, or a real key in the JSON) is never replaced without --rotate.
#   After a rotation, deploy the new secret AND the new JSON together: until both are live, the sign
#   route fails closed (503 reviewer_key_mismatch).
#
# The private key is never echoed, never logged and never passed as a command-line argument: it
# lives in a private temporary directory (umask 077, removed on exit) and moves only through files
# and stdin. Note: plain `next dev` reads .env files, not .dev.vars; .dev.vars is what wrangler (and
# the OpenNext preview) reads.
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEV_VARS="$ROOT/.dev.vars"
PUBLIC_JSON="$ROOT/src/close/reviewer-public-key.json"
NAME="TWOKEY_DEMO_KEY_REVIEWER"

die() {
  echo "gen-reviewer-key: $*" >&2
  exit 1
}

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
}

rotate=0
deploy=0
for arg in "$@"; do
  case "$arg" in
    --rotate) rotate=1 ;;
    --deploy) deploy=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) die "unknown option: $arg (see --help)" ;;
  esac
done

command -v openssl >/dev/null 2>&1 || die "openssl is not installed."
[ -f "$PUBLIC_JSON" ] || die "missing $PUBLIC_JSON"

existing=""
if [ -f "$DEV_VARS" ] && grep -q "^$NAME=" "$DEV_VARS"; then existing=".dev.vars"; fi
if grep -Eq '"publicKey": "[A-Za-z0-9+/]{43}="' "$PUBLIC_JSON"; then existing="${existing:+$existing and }reviewer-public-key.json"; fi
if [ -n "$existing" ] && [ "$rotate" -ne 1 ]; then
  die "a Reviewer key already exists ($existing). Re-run with --rotate to replace it (then deploy the new secret and the new JSON together)."
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

openssl genpkey -algorithm ed25519 -outform DER -out "$work/reviewer.der" 2>/dev/null ||
  die "this openssl can't make Ed25519 keys (macOS's LibreSSL may not; try Homebrew's openssl)."
openssl pkey -inform DER -in "$work/reviewer.der" -pubout -outform DER -out "$work/reviewer.spki" 2>/dev/null ||
  die "couldn't derive the public key."
# An Ed25519 SubjectPublicKeyInfo is 44 bytes: a 12-byte header, then the raw 32-byte key.
[ "$(wc -c <"$work/reviewer.spki" | tr -d ' ')" = "44" ] || die "unexpected public key length."
tail -c 32 "$work/reviewer.spki" >"$work/reviewer.raw"
base64 <"$work/reviewer.der" | tr -d '\n' >"$work/reviewer.b64"
[ -s "$work/reviewer.b64" ] || die "couldn't encode the private key."

# .dev.vars: keep every other line, replace only the Reviewer's line.
if [ -f "$DEV_VARS" ]; then
  grep -v "^$NAME=" "$DEV_VARS" >"$work/dev.vars" || true
else
  : >"$work/dev.vars"
fi
{
  printf '%s=' "$NAME"
  cat "$work/reviewer.b64"
  printf '\n'
} >>"$work/dev.vars"
cat "$work/dev.vars" >"$DEV_VARS.tmp"
chmod 600 "$DEV_VARS.tmp"
mv "$DEV_VARS.tmp" "$DEV_VARS"
chmod 600 "$DEV_VARS"

# The public key is not secret.
public_key="$(base64 <"$work/reviewer.raw" | tr -d '\n')"
key_id="$(openssl dgst -sha256 -r <"$work/reviewer.raw" | cut -c1-8)"
printf '{ "keyId": "%s", "publicKey": "%s" }\n' "$key_id" "$public_key" >"$work/public.json"
mv "$work/public.json" "$PUBLIC_JSON"
chmod 644 "$PUBLIC_JSON"

echo "Wrote the Reviewer's private demo key to .dev.vars (chmod 600) and its public key (key id $key_id) to src/close/reviewer-public-key.json."

if [ "$deploy" -eq 1 ]; then
  echo "Setting Worker secret $NAME (value on stdin)..."
  (cd "$ROOT" && npx wrangler secret put "$NAME" <"$work/reviewer.b64") || die "wrangler secret put $NAME failed."
  echo "Deployed the secret. Commit and deploy reviewer-public-key.json too, or the sign route answers 503 reviewer_key_mismatch."
else
  echo "Not deployed. To set the Worker secret, re-run with --rotate --deploy (or put it yourself, on stdin)."
fi
