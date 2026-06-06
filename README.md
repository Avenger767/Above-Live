# Above Live

A browser-based **live sky display** that runs on a laptop or a Raspberry Pi 4 (or any
computer) and shows **three layers** around a configurable home location:

- ✈️ **Aircraft** — flights drifting around your home location (mock, internet API, or local ADS-B).
- 🛰️ **Space** — the live **ISS** plus a modeled satellite constellation, drawn on a sky dome
  (straight up = center of the display, horizon = outer ring).
- 🌦️ **Weather** — current conditions at home: cloud cover, wind, precipitation, temperature.

View it on a normal monitor today; project it onto a ceiling or wall later.

Above Live works **immediately with mock data** — no ADS-B hardware, no antenna, no projector,
and no paid internet API required. The space and weather layers use **free, key-less** public
APIs (the ISS feed and Open-Meteo); with no internet they degrade gracefully (space falls back
to its modeled satellites, weather shows the last good reading). It's built so you can switch
to a real internet flight API or local ADS-B (dump1090/readsb) data later, with no change to
the renderer.

It is **cross-platform**: the same project runs on a laptop (macOS / Windows / Linux) and on a
Raspberry Pi 4 using only standard **Node.js, Express, React, Vite, HTML Canvas, and browser
APIs** — no Pi-only dependencies. Develop and test on your laptop, then copy the folder to the
Pi and run it there unchanged.

![concept](https://placehold.co/10x10/04060d/04060d.png)

---

## 1. What Above Live is

- A **Node.js + React** app: an Express backend streams data over a WebSocket; a React +
  HTML Canvas frontend draws it on a glowing radar/sky display.
- **Three display layers** (each independently toggled in the Display panel):
  - **Aircraft**, **Space** (ISS + satellites), and **Weather**.
- **Three swappable aircraft providers**:
  1. **MOCK** — fake aircraft that drift smoothly around your home location. Default. Always works.
  2. **API** — scaffold for a future internet flight API (you supply the URL + key later).
  3. **LOCAL_ADSB** — reads a dump1090/readsb `aircraft.json` feed for real local traffic later.
- If API or ADS-B data is unavailable, Above Live **falls back to MOCK automatically** and tells
  you in the status panel. It never blocks startup.
- The **space + weather layers need no API key** and also fall back gracefully with no internet.
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

> **One-command option:** from the project root run `./scripts/start-dev.sh` to start both at once.

---

## 5. Test with mock aircraft data

Mock mode is the **default**, so as soon as both servers are running you'll see ~8–12 aircraft
drifting around your home location with callsigns, altitude (as flight levels), speed, distance,
and fading trails. Nothing else to configure.

To confirm the provider, open the **Status** tab in the side panel, or hit the API directly:

```bash
curl http://localhost:4000/api/status
curl http://localhost:4000/api/aircraft
```

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

## 9b. Space + Weather layers

Above Live draws two extra layers on top of the aircraft, both **on by default** and both
requiring **no API key**:

### 🛰️ Space (ISS + satellites)

- Tracks the **live International Space Station** using the free
  [`wheretheiss.at`](https://wheretheiss.at) API, refreshed every few seconds.
- Adds a **modeled satellite constellation** (Starlink-like shell plus a few named birds such as
  NOAA, Terra, Aqua, Hubble) computed locally with simplified orbital mechanics — so there's
  always something overhead even with **no internet**.
- Satellites are drawn on a **sky dome**, not the ground map: straight up (the **zenel**) is the
  center of the display and the **horizon** is the outer ring. Only objects currently **above your
  horizon** are shown — exactly what you'd see looking up. This is the natural view for a ceiling.
- The **ISS** is highlighted (larger glyph, pulsing ring, and a fading arc trail of its path
  across your sky). If the live ISS feed is unreachable, the Status tab notes it and the modeled
  satellites keep running.

### 🌦️ Weather

- Pulls **current conditions at your home location** from the free
  [Open-Meteo](https://open-meteo.com) API (no key), refreshed about once a minute.
- Renders **cloud cover** (drifting soft blobs that thicken with cover %), a **wind arrow**
  (direction + strength), animated **precipitation** streaks when it's raining/snowing, and a
  small **badge** with condition, temperature, and wind.
- If the weather feed is unreachable it keeps the last good reading (or shows nothing) and notes
  the error in the Status tab — it never blocks the display.

### Turning layers on/off

- **In the UI:** Side panel → **Display → Layers** → toggle **Aircraft**, **Satellites & ISS**,
  **Weather**.
- **In settings.json:** edit the `"layers"` block:
  ```json
  "layers": { "aircraft": true, "satellites": true, "weather": true }
  ```

> The space + weather layers respect your **Calibration** settings (offset / scale / rotation /
> flip) just like the aircraft, so everything stays aligned on a projected ceiling.

---

## 10. Later: connect an internet flight API

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

---

## 11. Later: connect dump1090 / readsb (`aircraft.json`)

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

The Pi 4 handles the canvas renderer comfortably. Lower the **Range**, turn off **Trails**, or
turn off the **Satellites** layer in the panel if you want to save a few cycles on a very busy
feed.

---

## 12b. Cross-platform workflow: laptop → Raspberry Pi

Above Live is the **same project** on both machines — standard Node.js, Express, React, Vite,
HTML Canvas, and browser APIs, with **no Pi-only dependencies**. The recommended path is to
develop and test on your laptop first, then copy the folder to the Pi.

**1) Run on a laptop (development)**

```bash
# macOS / Windows / Linux — needs Node.js 18+
cd above-live
cd backend && npm install && cd ..
cd frontend && npm install && cd ..
./scripts/start-dev.sh        # starts backend + frontend together
```

**2) Test with mock data**

Mock aircraft are the **default** — no hardware needed. The space layer shows modeled satellites
(plus the live ISS if you have internet) and the weather layer shows your home conditions. Confirm
the provider in the **Status** tab, or:

```bash
curl http://localhost:4000/api/status     # shows provider, aircraftCount, spaceCount, weather
curl http://localhost:4000/api/aircraft    # aircraft + trails + space + weather in one snapshot
```

**3) Open the display on a regular monitor**

Open **http://localhost:5173** in Chrome/Chromium on the laptop. To view from another device on
your network use the laptop's IP, e.g. `http://192.168.1.50:5173`. Use the **☰** panel →
**Display → Fullscreen** (or `F11`) for a clean full-screen view on the monitor.

**4) Move the project from laptop to Raspberry Pi**

```bash
# On the Pi, install Node.js 18+ first:
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Copy the whole folder to the Pi (pick one):
#   • USB stick, or
#   • scp from the laptop:
scp -r above-live pi@<pi-ip>:~/above-live
#   • or: git clone your repo on the Pi

# Then on the Pi, from the project root:
cd ~/above-live
./scripts/start-pi.sh          # installs deps, builds the frontend, serves everything
```

> **Tip:** don't copy the `node_modules` folders between machines — native/arch differences mean
> they should be reinstalled. `start-pi.sh` runs `npm install` for you if they're missing. Your
> `backend/data/settings.json` (home location, layers, calibration) **does** copy over, so the Pi
> comes up configured exactly like your laptop.

**5) Run on the Raspberry Pi (a regular monitor)**

Open **http://localhost:5173** on the Pi, or `http://<pi-ip>:5173` from another device. When
you're ready for a ceiling/wall projector, add the optional **Chromium kiosk mode** below.

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

## Project layout

```
above-live/
  backend/    Express server, providers, settings, math, trails
    aircraft/ aircraft providers (mock / api / local_adsb), normalizer, trails
    space/    ISS + modeled-satellite provider (sky-dome az/el)
    weather/  Open-Meteo current-conditions provider
  frontend/   React + Vite app, canvas renderer, panels
    src/lib/  projection math, themes, aircraft/space symbols, weather layer
  scripts/    start-dev.sh, start-pi.sh, start-kiosk.sh
```

## API reference (quick)

| Method | Path                   | Purpose                                         |
|--------|------------------------|-------------------------------------------------|
| GET    | `/api/aircraft`        | Aircraft snapshot + trails + space + weather    |
| GET    | `/api/space`           | Satellites + ISS (sky-dome az/el) + feed health |
| GET    | `/api/weather`         | Current conditions at home + feed health        |
| GET    | `/api/settings`        | Current settings                                |
| POST   | `/api/settings`        | Update settings (partial, deep-merged)          |
| POST   | `/api/settings/reset`  | Reset settings to defaults                      |
| GET    | `/api/status`          | Provider, counts, fallback state, layer health  |
| WS     | `/ws`                  | Live stream (aircraft + trails + space + weather) |

---

Built to be simple, clean, and demo-ready. Start in MOCK mode, get the look right, then plug in
real data when you're ready.
