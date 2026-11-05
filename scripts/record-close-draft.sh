#!/usr/bin/env bash
# Records the AI's draft of October 2026's monthly close (development only).
# Without --yes it prints the spend estimate and stops; with --yes it SPENDS REAL MONEY
# (about $0.03 for one call). See scripts/record-close-draft.ts.
#
# Usage, from the project root: bash scripts/record-close-draft.sh [--yes]
set -euo pipefail

cd "$(dirname "$0")/.."
# The physical path: on macOS the temp folder sits behind a symlink, and the script runs its main
# only when its own URL matches the path Node was given.
OUT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$OUT"' EXIT

# Bundles the TypeScript (tsconfig paths, the SDK and zod) into one ES module for Node.
node_modules/.bin/esbuild scripts/record-close-draft.ts --bundle --platform=node --format=esm \
  --target=node22 --outfile="$OUT/record-close-draft.mjs" --log-level=warning
node "$OUT/record-close-draft.mjs" "$@"
