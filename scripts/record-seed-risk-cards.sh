#!/usr/bin/env bash
# Records the AI risk cards for the two seeded payout requests (development only).
# Without --yes it prints the spend estimate and stops; with --yes it SPENDS REAL MONEY
# (about $0.05 for both cards). See scripts/record-seed-risk-cards.ts.
#
# Usage, from the project root: bash scripts/record-seed-risk-cards.sh [--yes]
set -euo pipefail

cd "$(dirname "$0")/.."
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

# Bundles the TypeScript (tsconfig paths, the SDK and zod) into one ES module for Node.
node_modules/.bin/esbuild scripts/record-seed-risk-cards.ts --bundle --platform=node --format=esm \
  --target=node22 --outfile="$OUT/record-seed-risk-cards.mjs" --log-level=warning
node "$OUT/record-seed-risk-cards.mjs" "$@"
