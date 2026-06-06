// Above Live — backend server.
// Express REST API + WebSocket live stream. Polls the active data provider on a
// timer, maintains the current aircraft snapshot + trails, and broadcasts to
// connected clients. Never blocks startup: if a provider fails, it falls back
// to MOCK mode and keeps running.

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

import { loadSettings, getSettings, saveSettings, resetSettings } from './settings/settingsStore.js';
import { createMockProvider } from './aircraft/providers/mockProvider.js';
import { createApiProvider } from './aircraft/providers/apiProvider.js';
import { createLocalAdsbProvider } from './aircraft/providers/localAdsbProvider.js';
import { createTrailStore } from './aircraft/trailStore.js';
import { createSpaceProvider } from './space/spaceProvider.js';
import { createWeatherProvider } from './weather/weatherProvider.js';

const PORT = Number(process.env.PORT) || 4000;
const APP_NAME = 'Above Live';

// --- Provider registry ---------------------------------------------------
const providers = {
  MOCK: createMockProvider(),
  API: createApiProvider(),
  LOCAL_ADSB: createLocalAdsbProvider(),
};
const mockProvider = providers.MOCK;

// Space + weather are independent overlay layers (not aircraft providers).
const spaceProvider = createSpaceProvider();
const weatherProvider = createWeatherProvider();

// --- Runtime state --------------------------------------------------------
const state = {
  aircraft: [],
  trails: {},
  effectiveProvider: 'MOCK', // what actually produced the current data
  usingFallback: false, // true when requested provider failed and we used MOCK
  lastUpdate: 0,
  lastError: null,
  // Overlay layers.
  space: [], // satellites + ISS (sky-dome positions)
  spaceError: null,
  weather: null, // current conditions at home
  weatherError: null,
  lastSpaceUpdate: 0,
  lastWeatherUpdate: 0,
};

// Independent timers so a slow/unreachable space or weather API never stalls
// the aircraft poll loop. Both degrade gracefully and keep the display running.
let spaceTimer = null;
let weatherTimer = null;
const SPACE_INTERVAL_MS = 3000; // satellites move fast; refresh often
const WEATHER_INTERVAL_MS = 60000; // weather changes slowly; once a minute

async function pollSpace() {
  if (getSettings().layers?.satellites === false) return;
  try {
    state.space = await spaceProvider.fetchSpace(getSettings());
    state.spaceError = null;
    state.lastSpaceUpdate = Date.now();
  } catch (err) {
    state.spaceError = err.message;
  }
}

async function pollWeather() {
  if (getSettings().layers?.weather === false) return;
  try {
    state.weather = await weatherProvider.fetchWeather(getSettings());
    state.weatherError = null;
    state.lastWeatherUpdate = Date.now();
  } catch (err) {
    state.weatherError = err.message;
    // Keep the last good reading on screen; just note the error.
    console.warn(`[weather] ${err.message}`);
  }
}

function startOverlayPolling() {
  if (spaceTimer) clearInterval(spaceTimer);
  if (weatherTimer) clearInterval(weatherTimer);
  pollSpace();
  pollWeather();
  spaceTimer = setInterval(pollSpace, SPACE_INTERVAL_MS);
  weatherTimer = setInterval(pollWeather, WEATHER_INTERVAL_MS);
}

let trailStore = createTrailStore(30);
let pollTimer = null;
let lastLoggedProvider = null;

// --- Core poll loop -------------------------------------------------------
async function poll() {
  const settings = getSettings();
  const requested = (settings.provider || 'MOCK').toUpperCase();
  const provider = providers[requested] || mockProvider;

  try {
    const aircraft = await provider.fetchAircraft(settings);
    state.aircraft = aircraft;
    state.effectiveProvider = provider.name.toUpperCase();
    state.usingFallback = false;
    state.lastError = null;
  } catch (err) {
    // Graceful fallback to MOCK — startup and runtime never break.
    state.lastError = err.message;
    if (requested !== 'MOCK') {
      console.warn(`[provider] ${requested} failed: ${err.message} — falling back to MOCK`);
      try {
        state.aircraft = await mockProvider.fetchAircraft(settings);
      } catch (mockErr) {
        state.aircraft = [];
        console.error(`[provider] MOCK fallback also failed: ${mockErr.message}`);
      }
      state.effectiveProvider = 'MOCK';
      state.usingFallback = true;
    } else {
      state.aircraft = [];
      state.effectiveProvider = 'MOCK';
      state.usingFallback = false;
      console.error(`[provider] MOCK failed: ${err.message}`);
    }
  }

  // Maintain trails + timestamp.
  trailStore.setLimit(settings.trailLength);
  trailStore.update(state.aircraft);
  state.trails = trailStore.snapshot();
  state.lastUpdate = Date.now();

  // Log provider changes clearly (which provider is active).
  const activeLabel = state.usingFallback
    ? `${requested} → MOCK (fallback)`
    : state.effectiveProvider;
  if (activeLabel !== lastLoggedProvider) {
    console.log(`[provider] active: ${activeLabel} | aircraft: ${state.aircraft.length}`);
    lastLoggedProvider = activeLabel;
  }

  broadcast();
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  const interval = Math.max(250, getSettings().updateIntervalMs || 1000);
  poll(); // immediate first tick
  pollTimer = setInterval(poll, interval);
}

// --- HTTP + WebSocket setup ----------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/aircraft', (_req, res) => {
  res.json({
    aircraft: state.aircraft,
    trails: state.trails,
    timestamp: state.lastUpdate,
    space: state.space,
    weather: state.weather,
  });
});

app.get('/api/space', (_req, res) => {
  res.json({
    objects: state.space,
    error: state.spaceError,
    timestamp: state.lastSpaceUpdate,
  });
});

app.get('/api/weather', (_req, res) => {
  res.json({
    weather: state.weather,
    error: state.weatherError,
    timestamp: state.lastWeatherUpdate,
  });
});

app.get('/api/settings', (_req, res) => {
  res.json(getSettings());
});

app.post('/api/settings', async (req, res) => {
  const updated = await saveSettings(req.body || {});
  // Restart polling so a changed interval / provider takes effect immediately.
  startPolling();
  // Restart overlay polling too so a re-enabled layer or new home fetches now.
  startOverlayPolling();
  res.json(updated);
});

app.post('/api/settings/reset', async (_req, res) => {
  const reset = await resetSettings();
  trailStore.clear();
  startPolling();
  res.json(reset);
});

app.get('/api/status', (_req, res) => {
  const settings = getSettings();
  res.json({
    app: APP_NAME,
    backend: 'ok',
    requestedProvider: (settings.provider || 'MOCK').toUpperCase(),
    effectiveProvider: state.effectiveProvider,
    usingFallback: state.usingFallback,
    aircraftCount: state.aircraft.length,
    lastUpdate: state.lastUpdate,
    lastError: state.lastError,
    home: settings.home,
    rangeNm: settings.rangeNm,
    // Overlay layer health.
    spaceCount: state.space.length,
    spaceError: state.spaceError,
    lastSpaceUpdate: state.lastSpaceUpdate,
    weatherOk: state.weather != null,
    weatherError: state.weatherError,
    weatherCondition: state.weather?.condition || null,
    lastWeatherUpdate: state.lastWeatherUpdate,
  });
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// One snapshot shape used by both the broadcast loop and the on-connect send.
function snapshot() {
  return {
    type: 'aircraft',
    aircraft: state.aircraft,
    trails: state.trails,
    effectiveProvider: state.effectiveProvider,
    usingFallback: state.usingFallback,
    timestamp: state.lastUpdate,
    // Overlay layers travel on the same frame so the renderer stays in sync.
    space: state.space,
    weather: state.weather,
  };
}

function broadcast() {
  if (wss.clients.size === 0) return;
  const payload = JSON.stringify(snapshot());
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
}

wss.on('connection', (ws) => {
  // Send a snapshot immediately on connect.
  ws.send(JSON.stringify(snapshot()));
});

// --- Boot -----------------------------------------------------------------
async function main() {
  await loadSettings();
  const s = getSettings();
  console.log('======================================================');
  console.log(`  ${APP_NAME} — backend`);
  console.log(`  home:     ${s.home.name} (${s.home.lat}, ${s.home.lon})`);
  console.log(`  provider: ${s.provider}`);
  console.log(`  range:    ${s.rangeNm} nm`);
  console.log('======================================================');

  startPolling();
  startOverlayPolling();

  server.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
    console.log(`[server] websocket on ws://localhost:${PORT}/ws`);
  });
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
