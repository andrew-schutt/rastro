#!/usr/bin/env bash
# Re-record docs/demo.gif.
#
# Drives the demo app in one headless Chrome while screenshotting the dashboard in another,
# so the capture shows the flow graph growing from real use. Two browsers rather than two
# tabs: Chrome throttles rendering in background tabs, and a backgrounded dashboard paints
# stale frames.
#
# Requires: Google Chrome, ImageMagick (`brew install imagemagick`), and a built workspace.
# Usage:    ./scripts/record-demo.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
trap 'rm -rf "$WORK"; kill $(jobs -p) 2>/dev/null || true' EXIT

cd "$ROOT"
rm -f apps/collector/rastro.sqlite*

pnpm --filter collector dev >"$WORK/collector.log" 2>&1 &
pnpm --filter demo-app  dev >"$WORK/demo.log" 2>&1 &
pnpm --filter dashboard dev >"$WORK/dashboard.log" 2>&1 &
sleep 6

"$CHROME" --headless --disable-gpu --no-sandbox --hide-scrollbars \
  --remote-debugging-port=9222 --user-data-dir="$WORK/chromeA" about:blank >/dev/null 2>&1 &
"$CHROME" --headless --disable-gpu --no-sandbox --hide-scrollbars \
  --remote-debugging-port=9223 --user-data-dir="$WORK/chromeB" about:blank >/dev/null 2>&1 &
sleep 4

node scripts/record-demo.mjs "$WORK/frames"

# +dither because the palette is nearly all dark greys, and dithering them speckles every
# node fill. Optimize collapses the long runs of identical frames between dashboard polls,
# which is why the result is ~100KB rather than several MB.
magick -delay 12 "$WORK/frames"/*.png \
  -delay 260 "$(ls "$WORK/frames"/*.png | tail -1)" \
  -loop 0 +dither -colors 256 -layers Optimize docs/demo.gif

echo "wrote docs/demo.gif ($(du -h docs/demo.gif | cut -f1))"
