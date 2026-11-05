#!/usr/bin/env bash
# Renders the four fictional sample receipts (demo data) to public/receipts/<id>.png with headless
# Chrome, then prints each PNG's SHA-256 for src/disbursements/risk/receipts.ts.
# tests/disbursements/risk/receipts.test.ts recomputes the hashes, so a re-render that changes
# the bytes fails the tests until receipts.ts is updated (and the recorded cards re-recorded).
#
# Usage, from the project root: bash public/receipts/src/render.sh
set -euo pipefail

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
SRC="$(cd "$(dirname "$0")" && pwd)"
OUT="$(dirname "$SRC")"
PROFILE="$(mktemp -d)"
trap 'rm -rf "$PROFILE"' EXIT

# id:height (px). Width is 720 px for all four.
for entry in gloves-team-supply:760 paint-bluebird-hardware:800 cones-team-supply:760 bibs-team-supply:760; do
  id="${entry%%:*}"
  height="${entry##*:}"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --user-data-dir="$PROFILE" --window-size="720,$height" \
    --screenshot="$PROFILE/$id.png" "file://$SRC/$id.html" >/dev/null 2>&1
  # 8-bit grayscale without a colour profile: a thermal receipt is monochrome, and the file is
  # about half the size (the AI gate reserves its worst case from the request's byte size).
  sips --matchTo "/System/Library/ColorSync/Profiles/Generic Gray Profile.icc" "$PROFILE/$id.png" --out "$PROFILE/$id-gray.png" >/dev/null
  sips -d profile "$PROFILE/$id-gray.png" --out "$OUT/$id.png" >/dev/null
done

shasum -a 256 "$OUT"/*.png
