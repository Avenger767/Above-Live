#!/usr/bin/env bash
# Above Live — run on a Raspberry Pi (or any computer) in PRODUCTION mode.
# Builds the frontend once, then runs the backend in production mode. The backend
# serves EVERYTHING on a single port: the built frontend (UI), the REST API, and
# the WebSocket stream. Open one URL — http://localhost:4000 — no second server.
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-4000}"

echo "Above Live — Raspberry Pi / production launch"

# Install deps if missing.
[ -d "$ROOT/backend/node_modules" ]  || ( echo "Installing backend deps...";  cd "$ROOT/backend"  && npm install )
[ -d "$ROOT/frontend/node_modules" ] || ( echo "Installing frontend deps..."; cd "$ROOT/frontend" && npm install )

# Build the frontend into frontend/dist (static files the backend will serve).
echo "Building frontend..."
( cd "$ROOT/frontend" && npm run build )

# Best-effort LAN IP for the "open from another device" hint.
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"

echo ""
echo "Above Live is starting in production mode on port $PORT."
echo "  On this machine:        http://localhost:$PORT"
[ -n "$IP" ] && echo "  From another device:    http://$IP:$PORT"
echo ""

# Start the backend in production mode. NODE_ENV=production makes it serve the
# built frontend from frontend/dist. exec keeps it in the foreground (clean for
# systemd / kiosk / Ctrl-C).
cd "$ROOT/backend"
NODE_ENV=production PORT="$PORT" exec npm start
