// Above Live — backend server.
// Express REST API + WebSocket live stream.  Polls the active data provider on a
// timer, maintains the aircraft snapshot + trails, and broadcasts to connected
// clients.  The API provider handles its own rate-gate and debounce internally —
// the poll loop is just "fetch from whoever is active, broadcast."
//
// Optional display layers (weather, satellites, space) run on their own timers
// and are OFF by default.  Aircraft is always the mission.

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

const PORT     = Number(process.env.PORT) || 4000;
const APP_NAME = 'Above Live';

// ── provider registry ─────────────────────────────────────────────────────────
const providers = {
  MOCK:       createMockProvider(),
  API:        createApiProvider(),
  LOCAL_ADSB: createLocalAdsbProvider(),
};
const mockProvider = providers.MOCK;

// ── optional layer registry ───────────────────────────────────────────────────
const layers = {
  weather:    createWeatherLayer(),
  satellites: createSatelliteLayer(),
  space:      createSpaceLayer(),
};

// ── runtime state ─────────────────────────────────────────────────────────────
const state = {
  aircraft:          [],
  trails:            {},
  effectiveProvider: 'MOCK',
  usingFallback:     false,
  lastUpdate:        0,
  lastError:         null,
};

let trailStore        = createTrailStore(30);
let pollTimer         = null;
let pollRestartTimer  = null;  // debounce for startPolling() on settings changes
let syncLayersTimer   = null;
let lastLoggedProvider = null;

// ── core aircraft poll loop ───────────────────────────────────────────────────
async function poll() {
  const settings = getSettings();
  const requested = (settings.provider || 'MOCK').toUpperCase();
  const provider  = providers[requested] || mockProvider;

  try {
    const aircraft = await provider.fetchAircraft(settings);
    state.aircraft          = aircraft;
    state.effectiveProvider = provider.name.toUpperCase();
    state.usingFallback     = false;
    state.lastError         = null;
  } catch (err) {
    state.lastError = err.message;
    if (requested !== 'MOCK') {
      // Only fall back to MOCK when there is NO cached real data.
      console.warn(`[provider] ${requested} failed: ${err.message} — falling back to MOCK`);
      try {
        state.aircraft = await mockProvider.fetchAircraft(settings);
      } catch (mockErr) {
        state.aircraft = [];
        console.error(`[provider] MOCK fallback also failed: ${mockErr.message}`);
      }
      state.effectiveProvider = 'MOCK';
      state.usingFallback     = true;
    } else {
      state.aircraft          = [];
      state.effectiveProvider = 'MOCK';
      state.usingFallback     = false;
      console.error(`[provider] MOCK failed: ${err.message}`);
    }
  }

  // Server-side trail history. The frontend now renders smooth trails from its
  // own per-track motion history, so this snapshot is currently informational —
  // it's kept on the wire for future history/status features and any non-smooth
  // client. Cheap to maintain; do not remove without updating those consumers.
  trailStore.setLimit(settings.trailLength);
  trailStore.update(state.aircraft);
  state.trails    = trailStore.snapshot();
  state.lastUpdate = Date.now();

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
  const s        = getSettings();
  const requested = (s.provider || 'MOCK').toUpperCase();
  let interval = s.updateIntervalMs || 1000;
  if (requested === 'LOCAL_ADSB' && s.localAdsb?.pollIntervalMs) {
    interval = s.localAdsb.pollIntervalMs;
  }
  interval = Math.max(250, interval);
  poll();
  pollTimer = setInterval(poll, interval);
}

// Debounced poll restart — prevents rapid settings saves from thrashing the timer.
function schedulePollRestart() {
  clearTimeout(pollRestartTimer);
  pollRestartTimer = setTimeout(startPolling, 300);
}

// ── optional layer manager ────────────────────────────────────────────────────
const layerTimers = {};

function startLayer(key) {
  stopLayer(key);
  const layer = layers[key];
  const s     = getSettings();
  layer.refresh(s);
  const interval = Math.max(1000, layer.getMeta(s).pollIntervalMs || 60000);
  layerTimers[key] = setInterval(() => layer.refresh(getSettings()), interval);
  console.log(`[layer] ${key} enabled (every ${Math.round(interval / 1000)}s)`);
}

function stopLayer(key) {
  if (layerTimers[key]) { clearInterval(layerTimers[key]); layerTimers[key] = null; }
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

function debouncedSyncLayers() {
  clearTimeout(syncLayersTimer);
  syncLayersTimer = setTimeout(syncLayers, 300);
}

function layerSnapshot() {
  const enabled = getSettings().layers || {};
  return {
    weather:    enabled.weather    ? layers.weather.getData()           : null,
    satellites: enabled.satellites ? layers.satellites.getData() || [] : [],
    space:      enabled.space      ? layers.space.getData()             : null,
    stars:      Boolean(enabled.stars),
  };
}

// ── HTTP + WebSocket setup ────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/aircraft', (_req, res) => {
  res.json({
    aircraft: state.aircraft,
    trails:   state.trails,
    timestamp: state.lastUpdate,
    layers:   layerSnapshot(),
  });
});

app.get('/api/weather',    (_req, res) => { const s = getSettings(); res.json({ data: s.layers?.weather    ? layers.weather.getData()           : null, meta: layers.weather.getMeta(s)    }); });
app.get('/api/satellites', (_req, res) => { const s = getSettings(); res.json({ data: s.layers?.satellites ? layers.satellites.getData()         : [],   meta: layers.satellites.getMeta(s) }); });
app.get('/api/space',      (_req, res) => { const s = getSettings(); res.json({ data: s.layers?.space      ? layers.space.getData()              : null, meta: layers.space.getMeta(s)      }); });

app.get('/api/settings', (_req, res) => res.json(getSettings()));

app.post('/api/settings', async (req, res) => {
  const updated = await saveSettings(req.body || {});
  // Debounce the API re-fetch so rapid slider saves don't hammer the API.
  providers.API.invalidate?.(updated);
  for (const key of Object.keys(layers)) layers[key].invalidate?.();
  schedulePollRestart();
  debouncedSyncLayers();
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
  const s       = getSettings();
  const apiMeta = providers.API.getMeta(s);
  const localMeta = providers.LOCAL_ADSB.getMeta(s);
  res.json({
    app: APP_NAME, backend: 'ok',
    requestedProvider: (s.provider || 'MOCK').toUpperCase(),
    effectiveProvider: state.effectiveProvider,
    usingFallback:     state.usingFallback,
    aircraftCount:     state.aircraft.length,
    lastUpdate:        state.lastUpdate,
    lastError:         state.lastError,
    home:    s.home,
    rangeNm: s.rangeNm,
    // Full API adapter health (valid whether or not API mode is active).
    api: {
      adapter:              apiMeta.adapter,
      configured:           apiMeta.configured,
      hasCache:             apiMeta.hasCache,
      aircraftCount:        apiMeta.aircraftCount,
      lastFetchAttempt:     apiMeta.lastFetchAttempt,
      lastSuccess:          apiMeta.lastSuccess,
      lastError:            apiMeta.lastError,
      rateLimited:          apiMeta.rateLimited,
      nextAllowedFetch:     apiMeta.nextAllowedFetch,
      usingCachedAircraft:  apiMeta.usingCachedAircraft,
      cacheAgeSeconds:      apiMeta.cacheAgeSeconds,
      currentCacheKey:      apiMeta.currentCacheKey,
      externalFetchCount:   apiMeta.externalFetchCount,
      cacheHitCount:        apiMeta.cacheHitCount,
      pollIntervalMs:       apiMeta.pollIntervalMs,
      backoffMs:            apiMeta.backoffMs,
      settingsDebounceMs:   apiMeta.settingsDebounceMs,
      // Legacy names
      cached:    apiMeta.cached,
      nextRetry: apiMeta.nextRetry,
    },
    localAdsb: {
      configured:  localMeta.configured,
      sourceType:  localMeta.sourceType,
      source:      localMeta.source,
      aircraftCount: localMeta.aircraftCount,
      lastSuccess: localMeta.lastSuccess,
      lastError:   localMeta.lastError,
      usingCache:  localMeta.usingCache,
      fallback:    (s.provider || '').toUpperCase() === 'LOCAL_ADSB' && state.usingFallback,
    },
    layers:     s.layers,
    weather:    layers.weather.getMeta(s),
    satellites: layers.satellites.getMeta(s),
    space:      layers.space.getMeta(s),
  });
});

// Debug endpoint — full internal provider state snapshot.
app.get('/api/debug/provider', (_req, res) => {
  const s = getSettings();
  res.json({
    requested:     (s.provider || 'MOCK').toUpperCase(),
    effective:     state.effectiveProvider,
    usingFallback: state.usingFallback,
    lastUpdate:    state.lastUpdate,
    aircraftCount: state.aircraft.length,
    api:           providers.API.getMeta(s),
    localAdsb:     providers.LOCAL_ADSB.getMeta(s),
    layers: {
      weather:    layers.weather.getMeta(s),
      satellites: layers.satellites.getMeta(s),
      space:      layers.space.getMeta(s),
    },
  });
});

// Manual provider test. API respects backoff by default; ?force=true bypasses.
app.get('/api/provider-test', async (req, res) => {
  const s     = getSettings();
  const which = String(req.query.provider || s.provider || 'MOCK').toUpperCase();
  const force = req.query.force === 'true';
  try {
    if (which === 'API')       return res.json(await providers.API.test(s, { force }));
    if (which === 'LOCAL_ADSB') return res.json(await providers.LOCAL_ADSB.test(s));
    const ac = await providers.MOCK.fetchAircraft(s);
    return res.json({ success: true, provider: 'MOCK', configured: true, aircraftCount: ac.length, sample: ac.slice(0, 3), error: null });
  } catch (err) {
    res.status(500).json({ success: false, provider: which, error: err.message });
  }
});

// ── WebSocket ─────────────────────────────────────────────────────────────────
const server = createServer(app);
const wss    = new WebSocketServer({ server, path: '/ws' });

function snapshot() {
  const s       = getSettings();
  const apiMeta = providers.API.getMeta(s);
  return {
    type:              'aircraft',
    aircraft:          state.aircraft,
    trails:            state.trails,
    effectiveProvider: state.effectiveProvider,
    usingFallback:     state.usingFallback,
    // Real-time API state — lets the frontend pill update without waiting for
    // the 3-second /api/status poll.
    apiRateLimited:    apiMeta.rateLimited,
    apiUsingCache:     apiMeta.usingCachedAircraft,
    timestamp:         state.lastUpdate,
    layers:            layerSnapshot(),
  };
}

function broadcast() {
  if (wss.clients.size === 0) return;
  const payload = JSON.stringify(snapshot());
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
}

wss.on('connection', (ws) => ws.send(JSON.stringify(snapshot())));

// ── boot ──────────────────────────────────────────────────────────────────────
async function main() {
  await loadSettings();
  const s = getSettings();
  console.log('======================================================');
  console.log(`  ${APP_NAME} — backend`);
  console.log(`  home:     ${s.home.name} (${s.home.lat}, ${s.home.lon})`);
  console.log(`  provider: ${s.provider}`);
  console.log(`  range:    ${s.rangeNm} nm`);
  console.log(`  api poll: ${s.api.pollIntervalMs / 1000}s  backoff: ${s.api.rateLimitBackoffMs / 1000}s  debounce: ${s.api.settingsDebounceMs / 1000}s`);
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

main().catch((err) => { console.error('[fatal]', err); process.exit(1); });
