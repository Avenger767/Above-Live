// Above Live — backend server.
// Express REST API + WebSocket live stream. Polls the active data provider on a
// timer, maintains the current aircraft snapshot + trails, and broadcasts to
// connected clients. Never blocks startup: if a provider fails, it falls back
// to MOCK mode and keeps running.
//
// Optional display layers (weather, satellites/ISS, space) run on their own
// independent timers and are OFF by default. They never block or crash the
// aircraft path: each caches and fails soft. Aircraft is always the mission.

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
import { createWeatherLayer } from './layers/weatherLayer.js';
import { createSatelliteLayer } from './layers/satelliteLayer.js';
import { createSpaceLayer } from './layers/spaceLayer.js';

const PORT = Number(process.env.PORT) || 4000;
const APP_NAME = 'Above Live';

// --- Aircraft provider registry ------------------------------------------
const providers = {
  MOCK: createMockProvider(),
  API: createApiProvider(),
  LOCAL_ADSB: createLocalAdsbProvider(),
};
const mockProvider = providers.MOCK;

// --- Optional layer registry ---------------------------------------------
const layers = {
  weather: createWeatherLayer(),
  satellites: createSatelliteLayer(),
  space: createSpaceLayer(),
};

// --- Runtime state --------------------------------------------------------
const state = {
  aircraft: [],
  trails: {},
  effectiveProvider: 'MOCK', // what actually produced the current data
  usingFallback: false, // true when requested provider failed and we used MOCK
  lastUpdate: 0,
  lastError: null,
};

let trailStore = createTrailStore(30);
let pollTimer = null;
let lastLoggedProvider = null;

// --- Core aircraft poll loop ---------------------------------------------
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
  const s = getSettings();
  const requested = (s.provider || 'MOCK').toUpperCase();
  // LOCAL_ADSB is local, so it can poll faster than API mode.
  let interval = s.updateIntervalMs || 1000;
  if (requested === 'LOCAL_ADSB' && s.localAdsb?.pollIntervalMs) {
    interval = s.localAdsb.pollIntervalMs;
  }
  interval = Math.max(250, interval);
  poll(); // immediate first tick
  pollTimer = setInterval(poll, interval);
}

// --- Optional layer manager ----------------------------------------------
// Each enabled layer refreshes on its own timer. Disabled layers do nothing
// (no timer, no network). Toggling a layer in settings starts/stops it live.
const layerTimers = {};

function startLayer(key) {
  stopLayer(key);
  const layer = layers[key];
  const s = getSettings();
  layer.refresh(s); // immediate first refresh
  const interval = Math.max(1000, layer.getMeta(s).pollIntervalMs || 60000);
  layerTimers[key] = setInterval(() => layer.refresh(getSettings()), interval);
  console.log(`[layer] ${key} enabled (every ${Math.round(interval / 1000)}s)`);
}

function stopLayer(key) {
  if (layerTimers[key]) {
    clearInterval(layerTimers[key]);
    layerTimers[key] = null;
  }
}

function syncLayers() {
  const enabled = getSettings().layers || {};
  for (const key of Object.keys(layers)) {
    if (enabled[key]) {
      if (!layerTimers[key]) startLayer(key);
    } else if (layerTimers[key]) {
      stopLayer(key);
      console.log(`[layer] ${key} disabled`);
    }
  }
}

// Current layer data for the wire. Disabled layers report null/empty so the
// renderer simply draws nothing for them.
function layerSnapshot() {
  const enabled = getSettings().layers || {};
  return {
    weather: enabled.weather ? layers.weather.getData() : null,
    satellites: enabled.satellites ? layers.satellites.getData() || [] : [],
    space: enabled.space ? layers.space.getData() : null,
    stars: Boolean(enabled.stars),
  };
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
    layers: layerSnapshot(),
  });
});

app.get('/api/weather', (_req, res) => {
  const s = getSettings();
  res.json({ data: s.layers?.weather ? layers.weather.getData() : null, meta: layers.weather.getMeta(s) });
});

app.get('/api/satellites', (_req, res) => {
  const s = getSettings();
  res.json({ data: s.layers?.satellites ? layers.satellites.getData() : [], meta: layers.satellites.getMeta(s) });
});

app.get('/api/space', (_req, res) => {
  const s = getSettings();
  res.json({ data: s.layers?.space ? layers.space.getData() : null, meta: layers.space.getMeta(s) });
});

app.get('/api/settings', (_req, res) => {
  res.json(getSettings());
});

app.post('/api/settings', async (req, res) => {
  const updated = await saveSettings(req.body || {});
  // If home/range/api config changed, force a fresh fetch on the next tick
  // (keeps showing existing cache until fresh data arrives; respects backoff).
  providers.API.invalidate?.();
  for (const key of Object.keys(layers)) layers[key].invalidate?.();
  // Restart polling so a changed interval / provider takes effect immediately.
  startPolling();
  syncLayers(); // start/stop layers to match new toggles
  res.json(updated);
});

app.post('/api/settings/reset', async (_req, res) => {
  const reset = await resetSettings();
  trailStore.clear();
  startPolling();
  syncLayers();
  res.json(reset);
});

app.get('/api/status', (_req, res) => {
  const settings = getSettings();
  const apiMeta = providers.API.getMeta(settings);
  const localMeta = providers.LOCAL_ADSB.getMeta(settings);
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
    // API adapter health — useful whether or not API mode is currently active.
    api: {
      adapter: apiMeta.adapter,
      configured: apiMeta.configured,
      hasCache: apiMeta.hasCache,
      cached: apiMeta.cached,
      aircraftCount: apiMeta.aircraftCount,
      lastSuccess: apiMeta.lastSuccess,
      lastError: apiMeta.lastError,
      rateLimited: apiMeta.rateLimited,
      nextRetry: apiMeta.nextRetry,
      pollIntervalMs: apiMeta.pollIntervalMs,
      backoffMs: apiMeta.backoffMs,
    },
    // LOCAL_ADSB health (configured/source/cache/fallback state).
    localAdsb: {
      configured: localMeta.configured,
      sourceType: localMeta.sourceType,
      source: localMeta.source,
      aircraftCount: localMeta.aircraftCount,
      lastSuccess: localMeta.lastSuccess,
      lastError: localMeta.lastError,
      usingCache: localMeta.usingCache,
      // true when LOCAL_ADSB is requested but we're actually showing MOCK
      fallback: (settings.provider || '').toUpperCase() === 'LOCAL_ADSB' && state.usingFallback,
    },
    // Optional layers.
    layers: settings.layers,
    weather: layers.weather.getMeta(settings),
    satellites: layers.satellites.getMeta(settings),
    space: layers.space.getMeta(settings),
  });
});

// Manual one-shot test of the requested (or ?provider=) aircraft provider.
// API mode does not contact the API during rate-limit backoff; it warns instead.
app.get('/api/provider-test', async (req, res) => {
  const settings = getSettings();
  const which = String(req.query.provider || settings.provider || 'MOCK').toUpperCase();
  try {
    if (which === 'API') return res.json(await providers.API.test(settings));
    if (which === 'LOCAL_ADSB') return res.json(await providers.LOCAL_ADSB.test(settings));
    // MOCK: always works.
    const ac = await providers.MOCK.fetchAircraft(settings);
    return res.json({
      success: true,
      provider: 'MOCK',
      configured: true,
      aircraftCount: ac.length,
      sample: ac.slice(0, 3),
      error: null,
    });
  } catch (err) {
    res.status(500).json({ success: false, provider: which, error: err.message });
  }
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
    layers: layerSnapshot(),
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
  const on = Object.entries(s.layers || {}).filter(([, v]) => v).map(([k]) => k);
  console.log(`  layers:   ${on.join(', ') || 'none'}`);
  console.log('======================================================');

  startPolling();
  syncLayers();

  server.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
    console.log(`[server] websocket on ws://localhost:${PORT}/ws`);
  });
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
