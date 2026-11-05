#!/usr/bin/env bash
# Generate the officers' demo signing keys (spec §3): three Ed25519 keypairs, one per officer.
#
#   scripts/gen-demo-keys.sh [--rotate] [--deploy]
#
# - Private keys (PKCS8 DER, base64, one line each) go into .dev.vars as
#   TWOKEY_DEMO_KEY_PRESIDENT / _TREASURER / _SECRETARY. Only those lines are created or replaced;
#   every other line is kept. The file is chmod 600 and gitignored: never commit it.
# - Public keys (raw 32 bytes, base64) and their key ids (the first 8 hex characters of SHA-256 over
#   the raw public key) go into src/disbursements/demo-public-keys.json. Commit that file.
# - --deploy pipes each private key into `npx wrangler secret put NAME` on stdin.
# - Existing keys (in .dev.vars, or real keys in the JSON) are never replaced without --rotate.
#   After a rotation, deploy the new secrets AND the new JSON together: until both are live, the
#   judge routes fail closed (503 demo_keys_mismatch).
#
# A private key is never echoed, never logged and never passed as a command-line argument: it lives
# in a private temporary directory (umask 077, removed on exit) and moves only through files and
# stdin. Note: plain `next dev` reads .env files, not .dev.vars; .dev.vars is what wrangler (and the
# OpenNext preview) reads.
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEV_VARS="$ROOT/.dev.vars"
PUBLIC_JSON="$ROOT/src/disbursements/demo-public-keys.json"
ROLES=(president secretary treasurer)

die() {
  echo "gen-demo-keys: $*" >&2
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
if [ -f "$DEV_VARS" ] && grep -q '^TWOKEY_DEMO_KEY_' "$DEV_VARS"; then existing=".dev.vars"; fi
if grep -Eq '"publicKey": "[A-Za-z0-9+/]{43}="' "$PUBLIC_JSON"; then existing="${existing:+$existing and }demo-public-keys.json"; fi
if [ -n "$existing" ] && [ "$rotate" -ne 1 ]; then
  die "demo keys already exist ($existing). Re-run with --rotate to replace them (then deploy the new secrets and the new JSON together)."
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

upper() { printf '%s' "$1" | tr '[:lower:]' '[:upper:]'; }

for role in "${ROLES[@]}"; do
  openssl genpkey -algorithm ed25519 -outform DER -out "$work/$role.der" 2>/dev/null ||
    die "this openssl can't make Ed25519 keys (macOS's LibreSSL may not; try Homebrew's openssl)."
  openssl pkey -inform DER -in "$work/$role.der" -pubout -outform DER -out "$work/$role.spki" 2>/dev/null ||
    die "couldn't derive the $role public key."
  # An Ed25519 SubjectPublicKeyInfo is 44 bytes: a 12-byte header, then the raw 32-byte key.
  [ "$(wc -c <"$work/$role.spki" | tr -d ' ')" = "44" ] || die "unexpected $role public key length."
  tail -c 32 "$work/$role.spki" >"$work/$role.raw"
  base64 <"$work/$role.der" | tr -d '\n' >"$work/$role.b64"
  [ -s "$work/$role.b64" ] || die "couldn't encode the $role private key."
done

# .dev.vars: keep every other line, replace only the demo-key lines.
if [ -f "$DEV_VARS" ]; then
  grep -v '^TWOKEY_DEMO_KEY_' "$DEV_VARS" >"$work/dev.vars" || true
else
  : >"$work/dev.vars"
fi
for role in "${ROLES[@]}"; do
  {
    printf 'TWOKEY_DEMO_KEY_%s=' "$(upper "$role")"
    cat "$work/$role.b64"
    printf '\n'
  } >>"$work/dev.vars"
done
cat "$work/dev.vars" >"$DEV_VARS.tmp"
chmod 600 "$DEV_VARS.tmp"
mv "$DEV_VARS.tmp" "$DEV_VARS"
chmod 600 "$DEV_VARS"

# The public keys are not secret.
{
  printf '{\n'
  count=0
  for role in "${ROLES[@]}"; do
    count=$((count + 1))
    public_key="$(base64 <"$work/$role.raw" | tr -d '\n')"
    key_id="$(openssl dgst -sha256 -r <"$work/$role.raw" | cut -c1-8)"
    separator=","
    [ "$count" -eq "${#ROLES[@]}" ] && separator=""
    printf '  "%s": { "keyId": "%s", "publicKey": "%s" }%s\n' "$role" "$key_id" "$public_key" "$separator"
  done
  printf '}\n'
} >"$work/public.json"
mv "$work/public.json" "$PUBLIC_JSON"
chmod 644 "$PUBLIC_JSON"

echo "Wrote 3 private demo keys to .dev.vars (chmod 600) and their public keys to src/disbursements/demo-public-keys.json."

if [ "$deploy" -eq 1 ]; then
  for role in "${ROLES[@]}"; do
    name="TWOKEY_DEMO_KEY_$(upper "$role")"
    echo "Setting Worker secret $name (value on stdin)..."
    (cd "$ROOT" && npx wrangler secret put "$name" <"$work/$role.b64") || die "wrangler secret put $name failed."
  done
  echo "Deployed the 3 secrets. Commit and deploy demo-public-keys.json too, or the routes answer 503 demo_keys_mismatch."
else
  echo "Not deployed. To set the Worker secrets, re-run with --rotate --deploy (or put them yourself, on stdin)."
fi
