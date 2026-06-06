# Above Live

A browser-based **live aircraft sky / radar display** that runs on a Raspberry Pi 4 (or any
computer) and shows aircraft moving around a configurable home location. View it on a normal
monitor today; project it onto a ceiling or wall later.

Above Live works **immediately with mock data** — no ADS-B hardware, no antenna, no projector,
and no paid internet API required. It's built so you can switch to a real internet flight API
or local ADS-B (dump1090/readsb) data later, with no change to the renderer.

![concept](https://placehold.co/10x10/04060d/04060d.png)

---

## 1. What Above Live is

- A **Node.js + React** app: an Express backend streams aircraft over a WebSocket; a React +
  HTML Canvas frontend draws them on a glowing radar/sky display.
- **Three swappable aircraft providers**:
  1. **MOCK** — fake aircraft that drift smoothly around your home location. Default. Always works.
  2. **API** — a free internet flight API (Airplanes.live by default) with caching + 429 backoff.
  3. **LOCAL_ADSB** — reads a dump1090/readsb `aircraft.json` feed (HTTP or file) from your own
     RTL-SDR dongle + 1090 MHz antenna, with caching and graceful fallback.
- If API or ADS-B data is unavailable, Above Live **falls back to MOCK automatically** and tells
  you in the status panel. It never blocks startup.
- **Optional display layers** — weather, satellites/ISS, space (moon/sun/planets), and a starfield.
  All **off by default** (except stars), each isolated so aircraft always work (see §11d).
- No login, no cloud database, no payment system, no required hardware for testing.

---

## 2. Install dependencies

You need **Node.js 18+** (includes `npm` and a global `fetch`). Check with `node -v`.

```bash
cd above-live

# Backend
cd backend && npm install && cd ..

# Frontend
cd frontend && npm install && cd ..
```

---

## 3. Run the backend

```bash
cd backend
npm run dev
```

You should see logs like:

```
  Above Live — backend
  home:     Dallas, TX (32.7767, -96.797)
  provider: MOCK
[server] listening on http://localhost:4000
[provider] active: MOCK | aircraft: 11
```

The backend serves the REST API and the WebSocket on **port 4000**.

---

## 4. Run the frontend

In a second terminal:

```bash
cd frontend
npm run dev
```

Vite prints a local URL (default **http://localhost:5173**). The frontend proxies `/api` and
`/ws` to the backend automatically, so you don't need to configure anything.

> **Important — Vite port:** If something is already running on port 5173, Vite automatically
> bumps to **5174** (then 5175, etc.). Always check the URL Vite prints in the terminal. The
> backend is always on **4000**; only the frontend port can change.

> **One-command option:** from the project root run `./scripts/start-dev.sh` to start both at once.

---

## 5. Test with mock aircraft data

Mock mode is the **default**, so as soon as both servers are running you'll see ~8–12 aircraft
drifting around your home location with callsigns, altitude (as flight levels), speed, distance,
and fading trails. Nothing else to configure.

The mock fleet now includes a spread of aircraft types — airliners, widebodies, four-engine
heavies, light singles, turboprops, and helicopters — so you can see the **type-aware glyphs**,
**altitude colouring**, and tapered **comet trails** without any hardware.

To confirm the provider, open the **Status** tab in the side panel, or hit the API directly:

```bash
curl http://localhost:4000/api/status
curl http://localhost:4000/api/aircraft
```

### Testing smooth aircraft motion

Above Live renders the sky slightly in the past (≈1.15 s) and **interpolates between known
fixes** instead of snapping once per second, so traffic glides. MOCK mode is the easiest way to
see it (the fleet updates ~once per second, just like a real feed). Step by step:

1. **Start the backend:** `cd backend && npm run dev` (or `npm start`).
2. **Start the frontend:** `cd frontend && npm run dev`, then open **http://localhost:5173**.
3. **Use the MOCK provider** — it's the default. (Side panel → **Display → Provider → MOCK** if
   you changed it.)
4. In the **Display** panel, open **Motion & Performance** and set **Max FPS** to **30**.
5. Turn **Smooth motion** **on**. Watch a few aircraft — they should **glide** continuously.
6. Now toggle **Smooth motion** **off** and watch the same aircraft. They **jump/snap** once per
   second (the raw fix cadence).
7. Toggle it back **on** and confirm the gliding returns. That difference — glide vs. jump — is
   the smooth-motion model working.

`Max FPS` (default **30**, a safe Raspberry Pi 4 value; `Uncapped` uses the display refresh rate),
altitude colour, emergency highlight, and label density / Nearest-N all live in the **Display**
panel too.

### Testing API smooth motion (internet flight data)

API mode polls Airplanes.live every **60 seconds** — far too slow for per-second interpolation.
Above Live detects the API provider and automatically switches to a slow-feed motion model:
render delay 5 s, dead-reckoning up to 35 s, stale window 65 s. Aircraft move continuously
between fetches using heading + speed rather than jumping every 60 s then freezing.

To test it:

1. Switch **Provider → API** in the Display panel.
2. Open the **Status** tab. Confirm **Motion mode: Slow API prediction** appears.
3. Watch **Render delay: 5000 ms** and **Max extrapolation: 35 s** — these confirm the model is
   in API mode.
4. Also check **Data source** — it should show `live` once the first fetch succeeds (≤60 s).
5. Aircraft should glide continuously across the radar — no teleporting, no 4-second freeze.
6. Turn on **Labels → Glyph debug** (Display panel) to see each aircraft's ICAO type code and the
   glyph class it resolved to (e.g. `B738 · airliner`). Useful for confirming classification.
7. Switch back to **MOCK** — **Motion mode** returns to **Fast feed** and render delay drops to
   1150 ms (visible in the Status tab).
8. Note: **Status → Motion mode** always reflects the current effective configuration, so you can
   confirm which mode is active without diving into settings files.

---

## 6. Open on a normal monitor

Just open **http://localhost:5173** in any modern browser (Chrome/Chromium recommended) on the
machine running the frontend. The display scales to fill the window and is fully responsive.

To view from **another device on your network**, use the Pi/computer's IP, e.g.
`http://192.168.1.50:5173` (the dev server already listens on all interfaces).

---

## 7. Fullscreen mode

Click **☰** (top-right) to open the panel, go to **Display → Fullscreen**, or press your
browser's fullscreen key (usually `F11`). The "Fullscreen" button uses the browser Fullscreen
API and works great for a dedicated display. Press `Esc` (or `F11`) to exit.

---

## 8. Change home location

Home location determines the center of the radar. Edit
**`backend/data/settings.json`**:

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

## 9. Switch data providers

Three ways:

- **In the UI:** Side panel → **Display → Provider** → choose `MOCK`, `API`, or `LOCAL_ADSB`.
- **In settings.json:** set `"provider": "API"` (or `LOCAL_ADSB`).
- **Via environment variable:** `PROVIDER=LOCAL_ADSB` in `backend/.env` (env always wins).

If the chosen provider can't get data, the **Status** tab shows a "MOCK fallback" warning and the
display keeps running on mock data.

---

## 10. Connect an internet flight API (Airplanes.live by default)

The `API` provider ships configured for the **free Airplanes.live** point API — no key required.
To turn it on:

```bash
cd backend
cp .env.example .env      # optional; defaults already point at Airplanes.live
```
Then either set `PROVIDER=API` in `.env`, or pick **API** in the panel's Provider dropdown.

Above Live queries `{API_BASE_URL}/point/{home.lat}/{home.lon}/{rangeNm}` and reads the `ac[]`
array (the readsb/tar1090 schema). The normalizer maps the fields (`hex`, `flight`, `lat`,
`lon`, `alt_baro`, `gs`, `track`, `t`) into the internal format and converts `"ground"`
altitude to `0`.

**Rate limiting — this is the important part.** Public flight APIs throttle aggressively.
Above Live protects you automatically:

- **Cached polling.** The backend calls the external API only once every `API_POLL_INTERVAL_MS`
  (default **60000 = 60s**). The WebSocket/poll loop still updates the display ~once per second,
  but it serves **cached** aircraft between those fetches. The external API is *never* called on
  the 1-second loop.
- **429 backoff.** If the API returns HTTP 429, Above Live stops calling it for at least
  `API_RATE_LIMIT_BACKOFF_MS` (default **120000 = 120s**) and keeps showing the last successful
  real aircraft from cache.
- **Debounced settings changes.** Moving the Range slider (or changing home) doesn't fire a fetch
  per save — changes are coalesced and a single re-fetch runs `API_SETTINGS_DEBOUNCE_MS`
  (default **3000 = 3s**) after they settle. The poll interval and 429 backoff are never bypassed.
- **Cache preferred over mock.** It only falls back to MOCK when there is *no* cached API data
  at all (e.g. the very first request was rate-limited).
- **One source of truth.** All external calls happen in `apiProvider.js`. Nothing else (status,
  the WebSocket loop, even `/api/provider-test` while backing off) makes extra calls.

Tunable via `.env` (or `settings.json` under `"api"`):

```
PROVIDER=API
API_BASE_URL=https://api.airplanes.live/v2
API_POLL_INTERVAL_MS=60000        # how often to actually hit the API
API_RATE_LIMIT_BACKOFF_MS=120000  # how long to wait after an HTTP 429
API_SETTINGS_DEBOUNCE_MS=3000     # coalesce rapid settings changes before re-fetch
# API_KEY=                        # only for APIs that require a bearer key
```

**Using a different API?** Edit `buildUrl()` and the response-array line in
`backend/aircraft/providers/apiProvider.js`, and add any new field names to
`aircraftNormalizer.js`. The caching/backoff layer stays the same.

---

## 11. Local ADS-B with a USB dongle (`LOCAL_ADSB`)

This is for a real RTL-SDR (or similar) USB dongle + 1090 MHz antenna. **Above Live does not
decode raw radio.** You run a standard decoder — **dump1090-fa**, **readsb**, or **tar1090** —
which produces a small `aircraft.json`, and Above Live reads decoded aircraft from it.

### 11a. Setup assumptions

You have a decoder running and serving (or writing) `aircraft.json`. Typical installs:

- **dump1090-fa** (FlightAware): serves `http://<host>:8080/data/aircraft.json` and also writes
  `/run/dump1090-fa/aircraft.json`.
- **readsb**: writes `/run/readsb/aircraft.json` (often served under `/tar1090/data/`).
- **tar1090**: serves `http://<host>/tar1090/data/aircraft.json`.

Quick install on the Pi (one common path):
```bash
sudo bash -c "$(wget -O - https://raw.githubusercontent.com/flightaware/piaware/master/install.sh)"
# or the readsb installer of your choice
```
Confirm the feed is alive first, independent of Above Live:
```bash
curl http://localhost:8080/data/aircraft.json | head
```

### 11b. Point Above Live at the feed

Set **one** of these (URL is preferred if both are present). In `backend/.env`:

```
PROVIDER=LOCAL_ADSB
# Option 1 — HTTP endpoint (most common). Common locations:
LOCAL_ADSB_URL=http://localhost:8080/data/aircraft.json
#   http://localhost:8080/tar1090/data/aircraft.json
#   http://localhost/dump1090-fa/data/aircraft.json
# Option 2 — read the file on disk directly (leave URL empty to use this):
# LOCAL_ADSB_PATH=/run/dump1090-fa/aircraft.json   (or /run/readsb/aircraft.json)
# How often to read the local feed (local data is cheap):
LOCAL_ADSB_POLL_INTERVAL_MS=1000
```

`LOCAL_ADSB_FILE` is accepted as an alias for `LOCAL_ADSB_PATH`. You can also pick **LOCAL_ADSB**
from the panel's Provider dropdown.

The provider understands the dump1090/readsb schema (`hex`, `flight`, `lat`, `lon`, `alt_baro`,
`alt_geom`, `gs`, `track`, `squawk`, `t`/`type`, `category`, `seen`, `seen_pos`, `rssi`), drops
records with no position, and coerces `"ground"` altitude to `0`. It **caches** the last good
snapshot, so a single dropped read keeps the picture up briefly instead of flapping; only when
there's no usable data does it fall back to MOCK.

### 11c. Test it (before and after the dongle arrives)

```bash
# Status — shows configured / sourceType (url|file|none) / source / last read / errors
curl -s http://localhost:4000/api/status | python3 -m json.tool | grep -A8 localAdsb

# One-shot connectivity test of the LOCAL_ADSB feed specifically:
curl -s "http://localhost:4000/api/provider-test?provider=LOCAL_ADSB" | python3 -m json.tool
```
A healthy feed returns `"success": true` with a live `aircraftCount` and a few `sample` aircraft.
If it's not set up yet you'll get a clear `configured:false` / error message — and the main
display simply keeps running on MOCK.

You can rehearse the parsing **without hardware** by pointing it at the bundled sample file:
```bash
PROVIDER=LOCAL_ADSB LOCAL_ADSB_URL= LOCAL_ADSB_PATH=$(pwd)/backend/test/fixtures/aircraft.sample.json \
  npm --prefix backend start
```

---

## 11d. Optional display layers (weather, satellites, space, stars)

Above Live's mission is **aircraft**. Everything below is an **optional layer**, **off by default**
(except the local star background). Each layer has its **own cache + backoff**, runs on its own
timer, uses **simple mock/demo data** when a real source isn't configured, and **never blocks or
crashes the aircraft display** — if every layer fails, aircraft keep flying.

Toggle them in the panel under **Display → Layers**, or enable via env/settings.

**Weather** — centered on home. Default provider **Open-Meteo** (free, no key); set
`WEATHER_PROVIDER=mock` for offline demo data. Shows a subtle corner card (temperature,
condition, cloud %, wind, visibility), a wind arrow, a faint cloud wash scaled to cloud cover, and
a light rain tint when precipitation is active — all kept low so they never overpower aircraft.
```
WEATHER_ENABLED=true
WEATHER_PROVIDER=openmeteo
WEATHER_POLL_INTERVAL_MS=300000
```

**Satellites / ISS** — default provider **iss** fetches the ISS position from the free
wheretheiss.at API (no key); `SATELLITE_PROVIDER=mock` shows demo satellites near home. Satellites
draw with a distinct icon and blue/white glow (clearly not aircraft) and label when labels are on.
Most real passes fall outside the radar range and show in the status panel rather than on-screen.
```
SATELLITES_ENABLED=true
SATELLITE_PROVIDER=iss
SATELLITE_POLL_INTERVAL_MS=10000
```

**Space / Planets** — a no-network scaffold computed locally: moon phase + illumination, a simple
day/night indicator with approximate sunrise/sunset, and a placeholder visible-planets list, shown
in a small corner card.
```
SPACE_ENABLED=true
SPACE_POLL_INTERVAL_MS=3600000
```

**Stars** — a local generated starfield background (no network). On by default; toggle with
`STARS_ENABLED=false`.

Layer status (configured / ok / last update / errors) appears in the **Status** tab, and each
layer has a read-only endpoint: `/api/weather`, `/api/satellites`, `/api/space`.

> **Guarantee:** optional layers are isolated. Aircraft remain primary and keep working even if
> weather, satellite, and space sources are all unreachable.

---

## 12. Run on a Raspberry Pi

1. Install Node.js 18+ on the Pi:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt install -y nodejs
   ```
2. Copy the `above-live` folder to the Pi.
3. From the project root:
   ```bash
   ./scripts/start-pi.sh
   ```
   This installs dependencies (if needed), builds the frontend, then runs the backend and serves
   the built frontend. Open **http://localhost:5173** on the Pi, or `http://<pi-ip>:5173` from
   another device.

The Pi 4 handles the canvas renderer comfortably. Lower the **Range** or turn off **Trails** in
the panel if you want to save a few cycles on a very busy feed.

### Recommended Raspberry Pi 4 settings

A good starting point for a Pi 4 driving a projector or wall display (all in the **Display**
panel unless noted):

- **Max FPS:** `30` — smooth enough for the eye, easy on the GPU.
- **Provider:** `MOCK` for the very first test (no network/hardware needed), then switch to
  **`LOCAL_ADSB`** once dump1090/readsb is running (see §11), or **`API`** for internet data.
- **Altitude colour:** **on** — quick visual read of high vs. low traffic.
- **Label density:** **Nearest N**.
- **Nearest N:** `5` — keeps text readable and the draw light on a busy feed.
- **Optional layers (Satellites / Weather / Space):** **off** at first — bring them up one at a
  time after aircraft look right.
- **Display mode:** use **Projector** (pure-black background, brighter strokes) or
  **Calibration** (alignment grid) when setting up a ceiling/wall — see §13.

If a very busy feed ever feels heavy, drop **Range**, turn **Trails** off, or set **Max FPS** to
`24`.

---

## 13. Later: Chromium kiosk mode

For a dedicated ceiling/wall display, run Above Live fullscreen with no browser chrome:

```bash
# Make sure Above Live is already running (e.g. ./scripts/start-pi.sh in another terminal)
./scripts/start-kiosk.sh
```

This launches Chromium with `--kiosk` pointed at `http://localhost:5173`. Override the URL with
`ABOVE_LIVE_URL=http://...  ./scripts/start-kiosk.sh`.

To auto-start on boot, add the kiosk script to your Pi's autostart (e.g. an entry in
`~/.config/lxsession/LXDE-pi/autostart` or a systemd user service). Install Chromium first with
`sudo apt install chromium-browser`.

**Calibration tip:** open the side panel → **Calibration**, enable the **Test pattern**, then use
**Offset X/Y**, **Scale**, **Rotation**, and **Flip** to align the grid/compass to your projected
surface. The test pattern shows a grid, center dot, outer ring, N/E/S/W markers, and corner
markers for exact alignment.

---

## 14. Optional hardware (NOT required for software testing)

Everything below is **optional**. The software runs and demos fully without any of it:

- **Projector** — only needed when you move from a monitor to a ceiling/wall.
- **RTL-SDR dongle + 1090 MHz antenna** — only for real local ADS-B (`LOCAL_ADSB` provider).
- **dump1090-fa / readsb** — only if you want to decode that local ADS-B yourself.
- **Internet flight API subscription** — only for the `API` provider's live worldwide data.
- **Raspberry Pi** — recommended target, but Above Live runs on any laptop/desktop too.

For testing and development you need **only Node.js and a browser**.

---

## Testing API mode & rate limiting (laptop)

**1. Start in API mode.** In `backend/.env` set `PROVIDER=API` (defaults already use
Airplanes.live), then run the backend and frontend as in sections 3–4. Or just pick **API** in
the panel's Provider dropdown while running.

**2. Check `/api/status`:**
```bash
curl -s http://localhost:4000/api/status | python3 -m json.tool
```
Look at the `api` block:
- `adapter` — e.g. `api.airplanes.live`
- `lastSuccess` — timestamp of the last real fetch (should advance every ~60s)
- `externalFetchCount` / `cacheHitCount` — real API calls vs. cache reads; the ratio proves
  the 1s loop is served from cache
- `usingCachedAircraft` — `true` when serving stale cache (overdue refresh / backoff)
- `nextAllowedFetch` — when the next external call is permitted
- `rateLimited` + `nextRetry` — backoff state and when the next API call is allowed
- `lastError` — last API error (e.g. the 429 message), or `null`

For the full internal provider state (cache key, counters, timers) hit the debug endpoint:
```bash
curl -s http://localhost:4000/api/debug/provider | python3 -m json.tool
```

Top-level `effectiveProvider` should read `API` and `usingFallback` should be `false` whenever
there is cached real data — even during a backoff.

**3. Check `/api/provider-test`:**
```bash
curl -s http://localhost:4000/api/provider-test | python3 -m json.tool
```
Returns `success`, `adapter`, `configured`, `aircraftCount`, `usingCache`, `lastSuccess`,
`lastError`, and `nextRetry`. When healthy you'll see `usingCache:false` and a live count. If
you've recently been rate-limited it returns `usingCache:true` with a `warning` and `nextRetry`
**without contacting the API** (so it can't make throttling worse).

**4. Confirm it is NOT over-polling Airplanes.live.** Watch the backend terminal — it logs each
real fetch on one line, and on a 429 prints:
```
[api] FETCH  → https://api.airplanes.live/v2/point/32.7767/-96.797/60
[api] DONE   ← 39 aircraft
[api] RATE   429 — backing off 120s (39 cached ac)
```
Cache hits on the 1s loop are silent (no log spam). Moving the Range slider prints
`[api] INVAL  settings changed — next fetch in 3s` once per change, then a single `FETCH` after
the debounce — not one fetch per slider step.

You can also poll `/api/status` a few times within a minute: `aircraftCount` updates smoothly
every second (cached), but `api.lastSuccess` only changes about once per `API_POLL_INTERVAL_MS`
(60s). That gap is the proof the external API is hit on the slow cadence, not the 1s loop.

To make over-polling impossible to miss while testing, temporarily lower the interval, e.g.
`API_POLL_INTERVAL_MS=5000`, and confirm `api.lastSuccess` advances only every ~5s while the
display keeps updating each second. Set it back to `60000` for normal use.

**If you hit a 429:** the display keeps showing your last real aircraft from cache, the top bar
shows an **API backoff** pill (and a **cached** pill), the panel's **Status** tab shows
`backoff Ns`, and after `API_RATE_LIMIT_BACKOFF_MS` Above Live tries the API again automatically.
No restart needed. (`MOCK fallback` only appears when there's no cached real data at all.)

---



```
above-live/
  backend/    Express server, providers, settings, math, trails
    aircraft/ aircraft providers (mock / api / local_adsb) + normalizer
    layers/   optional layers (weather / satellites / space)
    test/     sample dump1090/readsb fixture
  frontend/   React + Vite app, canvas renderer, panels
  scripts/    start-dev.sh, start-pi.sh, start-kiosk.sh, smoke-check.mjs
```

## Smoke check

A pure-Node check (no network) that verifies MOCK aircraft, the status/provider-test endpoints,
LOCAL_ADSB parsing of the sample fixture (and the not-configured case), that optional layers
stay off/quiet by default, the API cache/rate-limit behaviour, and — added with the motion
upgrade — the smooth-motion math (interpolation, capped extrapolation, shortest-arc heading,
stale pruning) and the backward-compatible normalizer field passthrough (typeCode, registration,
verticalRate, onGround):

```bash
node scripts/smoke-check.mjs      # from the project root
# or:  cd backend && npm run smoke
```

## Display & motion settings

The motion upgrade adds a handful of settings. **All are optional and backward-compatible** —
older `settings.json` files keep working because both the backend store and the frontend defaults
deep-merge these keys in when they're missing.

Under `display`:

| Key                 | Default      | Meaning                                                        |
|---------------------|--------------|----------------------------------------------------------------|
| `maxFps`            | `30`         | Render-loop cap. `0` = uncapped. 30 is a safe Raspberry Pi 4 value. |
| `altitudeColor`     | `true`       | Colour glyphs/trails by altitude (theme colour is the fallback when off). |
| `labelDensity`      | `"nearestN"` | `"all"`, `"nearestN"`, or `"nearestOnly"`.                     |
| `nearestN`          | `5`          | How many labels to show when `labelDensity` is `nearestN`.     |
| `labelRotationDeg`  | `0`          | Rotate label text only, independent of the field (for ceilings). |
| `highlightEmergency`| `true`       | Subtle highlight for 7500/7600/7700 squawks.                   |

Top-level `motion` object:

| Key                  | Default | Meaning                                                       |
|----------------------|---------|---------------------------------------------------------------|
| `interpolate`        | `true`  | Smooth interpolation on/off (off = snap to each fix).         |
| `renderDelayMs`      | `1150`  | How far in the past to render, so we can interpolate between known fixes. |
| `maxExtrapolationSec`| `4`     | Cap on dead-reckoning past the newest fix.                    |
| `staleSec`           | `20`    | Drop a track after this long with no update.                  |

## API reference (quick)

| Method | Path                          | Purpose                                          |
|--------|-------------------------------|--------------------------------------------------|
| GET    | `/api/aircraft`               | Current aircraft snapshot + trails + layer data  |
| GET    | `/api/settings`               | Current settings                                 |
| POST   | `/api/settings`               | Update settings (partial, deep-merged)           |
| POST   | `/api/settings/reset`         | Reset settings to defaults                       |
| GET    | `/api/status`                 | Provider, counts, API + LOCAL_ADSB + layer health|
| GET    | `/api/provider-test`          | Manual test of the active provider…              |
| GET    | `/api/provider-test?provider=`| …or a specific one: `MOCK` / `API` / `LOCAL_ADSB`|
| GET    | `/api/weather`                | Weather layer data + status (when enabled)       |
| GET    | `/api/satellites`             | Satellite/ISS layer data + status (when enabled) |
| GET    | `/api/space`                  | Space layer data + status (when enabled)         |
| WS     | `/ws`                         | Live aircraft + layer stream                     |

---

Built to be simple, clean, and demo-ready. Start in MOCK mode, get the look right, then plug in
real data when you're ready.
