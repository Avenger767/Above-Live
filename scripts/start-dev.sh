#!/usr/bin/env bash
# Above Live — start backend + frontend together for local development.
# Runs both processes and shuts them down cleanly on Ctrl-C.
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Above Live — starting backend + frontend (dev)"

# Backend
( cd "$ROOT/backend" && npm run dev ) &
BACK_PID=$!

# Frontend
( cd "$ROOT/frontend" && npm run dev ) &
FRONT_PID=$!

cleanup() {
  echo ""
  echo "Above Live — shutting down..."
  kill "$BACK_PID" "$FRONT_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Backend  -> http://localhost:4000"
echo "Frontend -> http://localhost:5173"
wait
