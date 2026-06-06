#!/usr/bin/env bash
# Above Live — launch Chromium in fullscreen kiosk mode pointing at the display.
# Assumes Above Live is already running (e.g. via scripts/start-pi.sh) and the
# frontend is reachable at the URL below. Designed for Raspberry Pi OS desktop.
set -e

URL="${ABOVE_LIVE_URL:-http://localhost:4000}"

# Try the common Chromium binary names on Raspberry Pi OS / Debian.
BROWSER=""
for cand in chromium-browser chromium google-chrome; do
  if command -v "$cand" >/dev/null 2>&1; then BROWSER="$cand"; break; fi
done

if [ -z "$BROWSER" ]; then
  echo "No Chromium/Chrome found. Install with: sudo apt install chromium-browser"
  exit 1
fi

# Hide the mouse cursor if 'unclutter' is available (optional, nice for ceilings).
command -v unclutter >/dev/null 2>&1 && unclutter -idle 0.5 &

echo "Above Live — launching kiosk at $URL"
exec "$BROWSER" \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --disable-translate \
  --check-for-update-interval=31536000 \
  --overscroll-history-navigation=0 \
  --app="$URL"
