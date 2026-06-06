# Above Live

A browser-based **live aircraft sky / radar display** that runs on a laptop or a Raspberry Pi 4
(or any computer) and shows aircraft moving around a configurable home location. View it on a
normal monitor today; project it onto a ceiling or wall later.

**V1 is aircraft-only and works immediately with mock data** — no ADS-B hardware, no antenna, no
projector, and no paid internet API required. It's built so you can switch to a real internet
flight API or local ADS-B (dump1090/readsb) data later, with no change to the renderer.

It is **cross-platform**: the same project runs on a laptop (macOS / Windows / Linux) and on a
Raspberry Pi 4 using only standard **Node.js, Express, React, Vite, HTML Canvas, and browser
APIs** — no Pi-only dependencies. Develop and test on your laptop, then copy the folder to the
Pi and run it there unchanged.

---

## 1. What Above Live is

- A **Node.js + React** app: an Express backend streams aircraft over a WebSocket; a React +
  HTML Canvas frontend draws them on a glowing radar/sky display.
- **Three swappable aircraft providers**:
  1. **MOCK** — fake aircraft that drift smoothly around your home location. Default. Always works.
  2. **API** — scaffold for a future internet flight API (you supply the URL + key later).
  3. **LOCAL_ADSB** — reads a dump1090/readsb `aircraft.json` feed for real local traffic later.
- If API or ADS-B data is unavailable, Above Live **falls back to MOCK automatically** and tells
  you in the Status panel. It never blocks startup.
- Controls, calibration, and fullscreen mode for getting the picture right on a monitor or a
  projected surface.
- No login, no cloud database, no payment system, no required hardware for testing.

> **Not in V1 (and not required):** satellite / ISS tracking and weather overlays. The code for
> these still ships but is **off by default** and produces no network calls or warnings on
> startup. See [§13](#13-optional-satellites--weather-off-by-default) if you ever want to switch
> them on.

---

## 2. Requirements

You need **Node.js 18+** (includes `npm` and a global `fetch`). Check with `node -v`.

That's it for V1 — just Node.js and a modern browser (Chrome/Chromium recommended).

---

## 3. Run on a laptop (development)

```bash
cd above-live

# Install dependencies (once)
cd backend && npm install && cd ..
cd frontend && npm install && cd ..
```

Start both servers. **One-command option** from the project root:

```bash
./scripts/start-dev.sh
```

…or run them in two terminals:

```bash
# Terminal 1 — backend (REST API + WebSocket on port 4000)
cd backend && npm run dev

# Terminal 2 — frontend (Vite dev server on port 5173)
cd frontend && npm run dev
```

In dev mode the Vite dev server hosts the UI on **5173** and proxies `/api` and `/ws` to the
backend on **4000**, so you don't configure anything.

---

## 4. Test with mock aircraft data

Mock mode is the **default**, so as soon as both servers are running you'll see ~8–12 aircraft
drifting around your home location with callsigns, altitude (as flight levels), speed, distance,
and fading trails. Nothing else to configure.

To confirm the provider, open the **Status** tab in the side panel, or hit the API directly:

```bash
curl http://localhost:4000/api/status
curl http://localhost:4000/api/aircraft
```

---

## 5. Open the display on a regular monitor

Open **http://localhost:5173** in any modern browser on the laptop. The display scales to fill
the window and is fully responsive.

To view from **another device on your network**, use the laptop's IP, e.g.
`http://192.168.1.50:5173` (the dev server already listens on all interfaces).

**Fullscreen:** click **☰** (top-right), go to **Display → Fullscreen**, or press `F11`. Press
`Esc` (or `F11`) to exit. Great for a dedicated monitor.

---

## 6. Smoke check (verify it works)

A one-shot check that starts the backend, confirms it responds, and confirms mock aircraft are
flowing. Pure Node, so it runs the same on a laptop or a Pi:

```bash
# from the project root
node scripts/smoke-check.mjs

# …or from the backend folder
cd backend && npm run smoke
```

Expected output:

```
Above Live — smoke check (port 4100)
Starting backend...
  PASS  backend starts and responds
  PASS  /api/status backend = "ok" (got "ok")
  PASS  /api/status reports a provider (MOCK)
  PASS  /api/aircraft returns aircraft (count = 9)

SMOKE CHECK PASSED
```

It uses a side port (4100) so it won't clash with a server you already have running.

---

## 7. Run on a Raspberry Pi (production, single port)

In production the **backend serves everything on one port (4000)**: the built frontend (UI), the
REST API, and the WebSocket. You open a single URL — no second server, no proxy.

1. Install Node.js 18+ on the Pi:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt install -y nodejs
   ```
2. Copy the `above-live` folder to the Pi (USB stick, `scp`, or `git clone`). **Don't copy the
   `node_modules` folders** — they're reinstalled per machine.
3. From the project root:
   ```bash
   ./scripts/start-pi.sh
   ```
   This installs dependencies if missing, **builds the frontend** into `frontend/dist`, then
   starts the backend in production mode serving everything. It prints the URLs:
   ```
   On this machine:        http://localhost:4000
   From another device:    http://<pi-ip>:4000
   ```
4. Open **http://localhost:4000** on the Pi, or `http://<pi-ip>:4000` from another device.

> Under the hood `start-pi.sh` runs the backend with `NODE_ENV=production`, which makes it serve
> `frontend/dist`. You can do the same manually: `cd frontend && npm run build`, then
> `cd ../backend && NODE_ENV=production npm start`.

The Pi 4 handles the canvas renderer comfortably. Lower the **Range** or turn off **Trails** in
the panel to save a few cycles on a very busy feed.

---

## 8. Moving from laptop to Raspberry Pi (summary)

The project is identical on both machines. The recommended path:

1. Develop + test on the laptop with `./scripts/start-dev.sh` (§3–6).
2. Copy the folder to the Pi (skip `node_modules`). Your `backend/data/settings.json` (home
   location, range, calibration) copies over, so the Pi comes up configured like your laptop.
3. On the Pi, run `./scripts/start-pi.sh` and open `http://localhost:4000`.

---

## 9. Chromium kiosk mode (dedicated ceiling/wall display)

For a dedicated display, run Above Live fullscreen with no browser chrome:

```bash
# Make sure Above Live is already running (e.g. ./scripts/start-pi.sh in another terminal)
./scripts/start-kiosk.sh
```

This launches Chromium with `--kiosk` pointed at **http://localhost:4000**. Override the URL with
`ABOVE_LIVE_URL=http://...  ./scripts/start-kiosk.sh`.

To auto-start on boot, add the kiosk script to your Pi's autostart (e.g. an entry in
`~/.config/lxsession/LXDE-pi/autostart` or a systemd user service). Install Chromium first with
`sudo apt install chromium-browser`.

**Calibration tip:** open the side panel → **Calibration**, enable the **Test pattern**, then use
**Offset X/Y**, **Scale**, **Rotation**, and **Flip** to align the grid/compass to your projected
surface. The test pattern shows a grid, center dot, outer ring, N/E/S/W markers, and corner
markers for exact alignment.

---

## 10. Change home location

Home location determines the center of the radar. Edit **`backend/data/settings.json`**:

```json
"home": { "name": "Your City", "lat": 40.7128, "lon": -74.006 }
```

Restart the backend (or POST to the settings endpoint):

```bash
curl -X POST http://localhost:4000/api/settings \
  -H "Content-Type: application/json" \
  -d '{"home":{"name":"New York","lat":40.7128,"lon":-74.006}}'
```

Mock aircraft will reseed around the new location.

---

## 11. Switch data providers

Three ways:

- **In the UI:** Side panel → **Display → Provider** → choose `MOCK`, `API`, or `LOCAL_ADSB`.
- **In settings.json:** set `"provider": "API"` (or `LOCAL_ADSB`).
- **Via environment variable:** `PROVIDER=LOCAL_ADSB` in `backend/.env` (env always wins).

If the chosen provider can't get data, the **Status** tab shows a "MOCK fallback" warning and the
display keeps running on mock data.

### 11a. Later: connect an internet flight API

1. Copy the env template and add your details:
   ```bash
   cd backend
   cp .env.example .env
   ```
   Then set in `.env`:
   ```
   PROVIDER=API
   API_BASE_URL=https://your-flight-api.example.com
   API_KEY=your_key_here
   ```
2. Open **`backend/aircraft/providers/apiProvider.js`** and adjust two things to match your
   chosen service:
   - the request URL/headers, and
   - the line that picks the aircraft array out of the response
     (`data.aircraft || data.states || ...`).
3. Every record is run through `aircraftNormalizer.js`, which already maps common field names
   (`lat/latitude`, `gs/groundspeed/velocity`, `track/heading`, `alt_baro/altitude`, etc.) into
   the internal format. If your API uses different names, add them there.
4. If the key/URL is missing or the request fails, Above Live falls back to MOCK automatically.

No paid API is hardcoded — you choose the provider.

### 11b. Later: connect dump1090 / readsb (`aircraft.json`)

If you add an SDR + antenna and run dump1090-fa or readsb, point Above Live at its feed:

- **Over HTTP** (most common — dump1090 serves a small JSON file):
  ```
  PROVIDER=LOCAL_ADSB
  LOCAL_ADSB_URL=http://localhost:8080/data/aircraft.json
  ```
- **Or directly from the file on disk:**
  ```
  PROVIDER=LOCAL_ADSB
  LOCAL_ADSB_PATH=/run/dump1090-fa/aircraft.json
  ```

The provider already understands the dump1090/readsb schema (`hex`, `flight`, `lat`, `lon`,
`alt_baro`, `gs`, `track`) and converts the `"ground"` altitude value to `0`. If the feed is
unreachable, it falls back to MOCK.

---

## 12. What is NOT required for V1

Everything below is **optional**. V1 runs and demos fully without any of it:

- **Projector** — only needed when you move from a monitor to a ceiling/wall.
- **RTL-SDR dongle + 1090 MHz antenna** — only for real local ADS-B (`LOCAL_ADSB` provider).
- **dump1090-fa / readsb** — only if you want to decode that local ADS-B yourself.
- **Internet flight API subscription** — only for the `API` provider's live worldwide data.
- **Satellite / ISS tracking and weather overlays** — off by default; not part of the V1 experience.
- **Raspberry Pi** — recommended target, but Above Live runs on any laptop/desktop too.

For testing and development you need **only Node.js and a browser**.

---

## 13. Optional: satellites & weather (off by default)

V1 focuses on aircraft, but the satellite/ISS and weather layers from earlier development still
ship in the code, **disabled by default**. While disabled they make **no network calls** and
print **no warnings** on startup. They are not exposed in the UI; enable them only via settings if
you want to experiment:

```json
"layers": { "aircraft": true, "satellites": true, "weather": true }
```

Edit `backend/data/settings.json` and restart the backend (or POST to `/api/settings`). They use
free, key-less public APIs (the ISS feed and Open-Meteo) and fall back gracefully with no
internet. These are experimental extras, not a supported part of V1.

---

## Project layout

```
above-live/
  backend/    Express server, providers, settings, math, trails
    aircraft/ aircraft providers (mock / api / local_adsb), normalizer, trails
    space/    (optional, off) ISS + modeled-satellite provider
    weather/  (optional, off) Open-Meteo current-conditions provider
  frontend/   React + Vite app, canvas renderer, panels
  scripts/    start-dev.sh, start-pi.sh, start-kiosk.sh, smoke-check.mjs
```

## API reference (quick)

| Method | Path                   | Purpose                                         |
|--------|------------------------|-------------------------------------------------|
| GET    | `/api/aircraft`        | Current aircraft snapshot + trails              |
| GET    | `/api/settings`        | Current settings                                |
| POST   | `/api/settings`        | Update settings (partial, deep-merged)          |
| POST   | `/api/settings/reset`  | Reset settings to defaults                      |
| GET    | `/api/status`          | Provider, counts, fallback state, health        |
| WS     | `/ws`                  | Live aircraft stream                            |

(`/api/space` and `/api/weather` also exist but return empty data while those optional layers are
off.)

---

Built to be simple, clean, and demo-ready. Start in MOCK mode, get the look right, then plug in
real data when you're ready.
