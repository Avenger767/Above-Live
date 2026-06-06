#!/usr/bin/env bash
# Above Live — run on a Raspberry Pi (or any Linux box) in production-ish mode.
# Builds the frontend once, then serves it via Vite preview while the backend
# runs alongside. Open http://<pi-ip>:5173 from any device on the network.
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Above Live — Raspberry Pi launch"

# Install deps if missing.
[ -d "$ROOT/backend/node_modules" ] || ( cd "$ROOT/backend" && npm install )
[ -d "$ROOT/frontend/node_modules" ] || ( cd "$ROOT/frontend" && npm install )

# Build the frontend (faster + lighter than the dev server on a Pi).
( cd "$ROOT/frontend" && npm run build )

# Backend
( cd "$ROOT/backend" && npm start ) &
BACK_PID=$!

# Serve the built frontend.
( cd "$ROOT/frontend" && npm run preview -- --port 5173 ) &
FRONT_PID=$!

cleanup() { kill "$BACK_PID" "$FRONT_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "Above Live running."
echo "Open on this Pi:        http://localhost:5173"
echo "Open from another device: http://<this-pi-ip>:5173"
wait
