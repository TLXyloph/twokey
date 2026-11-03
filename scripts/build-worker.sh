#!/usr/bin/env bash
# Build the Cloudflare Worker WITHOUT baking local secrets into it.
#
# OpenNext embeds the project's .env, .env.<mode>, .env.local and .env.<mode>.local files into the
# Worker bundle (see node_modules/@opennextjs/cloudflare/dist/cli/utils/extract-project-env-vars.js).
# Our .env holds API secrets, so this script renames those files for the duration of the build and
# always renames them back, even if the build fails. Deployed secrets come from `wrangler secret put`.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILES=(.env .env.production .env.local .env.production.local)
SUFFIX=".build-aside"
moved=()

restore() {
  local f
  for f in "${moved[@]+"${moved[@]}"}"; do
    if [ -e "$f" ]; then
      echo "WARNING: $f reappeared during the build; your original is still at $f$SUFFIX" >&2
    else
      mv "$f$SUFFIX" "$f"
    fi
  done
}
trap restore EXIT

for f in "${ENV_FILES[@]}"; do
  if [ -e "$f" ]; then
    if [ -e "$f$SUFFIX" ]; then
      echo "Refusing to build: $f$SUFFIX already exists (a previous build may not have restored it)." >&2
      exit 1
    fi
    mv "$f" "$f$SUFFIX"
    moved+=("$f")
  fi
done

echo "Env files set aside for the build: ${moved[*]:-none}"
NEXT_TELEMETRY_DISABLED=1 npx opennextjs-cloudflare build
