#!/usr/bin/env node
// Above Live — smoke check.
// Two parts, no network required:
//   A) Integration: spawn the backend and verify MOCK aircraft + the status/
//      provider-test endpoints (including the new layer + LOCAL_ADSB fields).
//   B) Unit: import the providers/layers directly and verify LOCAL_ADSB parsing,
//      the not-configured case, and that optional layers stay off/quiet.
// Exits 0 on success, 1 on failure. Pure Node so it runs the same on a laptop
// and a Raspberry Pi.  Run it with:
//   node scripts/smoke-check.mjs        (from the project root)
//   npm run smoke                       (from the backend folder)

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BACKEND = join(ROOT, 'backend');
const PORT = process.env.PORT || 4100; // side port so we don't clash with a running server
const BASE = `http://localhost:${PORT}`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = false;
function check(ok, msg) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failed = true;
}

async function getJson(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

async function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await getJson('/api/status');
      return true;
    } catch {
      await wait(500);
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Part A — integration (spawned backend, MOCK mode)
// ---------------------------------------------------------------------------
async function integrationTests() {
  console.log('\nPart A — backend integration (MOCK mode)');
  const server = spawn('node', ['server.js'], {
    cwd: BACKEND,
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  server.stdout.on('data', (d) => (out += d));
  server.stderr.on('data', (d) => (out += d));

  try {
    const up = await waitForServer();
    check(up, 'backend starts and responds');
    if (!up) {
      console.log('\n--- backend output ---\n' + out);
      return;
    }

    const status = await getJson('/api/status');
    check(status.backend === 'ok', `/api/status backend = "ok" (got "${status.backend}")`);
    check(status.effectiveProvider === 'MOCK', `provider is MOCK (got ${status.effectiveProvider})`);

    const data = await getJson('/api/aircraft');
    const n = Array.isArray(data.aircraft) ? data.aircraft.length : 0;
    check(n > 0, `/api/aircraft returns aircraft (count = ${n})`);

    // API adapter meta present (cache/backoff layer) even while in MOCK mode.
    check(status.api && typeof status.api.pollIntervalMs === 'number', '/api/status has api{} cache/backoff meta');

    // LOCAL_ADSB meta present with a sourceType.
    check(status.localAdsb && typeof status.localAdsb.sourceType === 'string', '/api/status has localAdsb{} meta');

    // Optional layers present and OFF by default (except stars).
    check(status.layers && status.layers.weather === false, 'weather layer OFF by default');
    check(status.layers && status.layers.satellites === false, 'satellites layer OFF by default');
    check(status.layers && status.layers.space === false, 'space layer OFF by default');
    check(status.weather && status.weather.enabled === false, 'weather layer not enabled (no external calls)');
    check(status.satellites && status.satellites.enabled === false, 'satellite layer not enabled (no external calls)');
    check(status.space && status.space.enabled === false, 'space layer not enabled (no external calls)');

    // provider-test for MOCK works.
    const pt = await getJson('/api/provider-test?provider=MOCK');
    check(pt.success === true && pt.aircraftCount > 0, `provider-test MOCK ok (count = ${pt.aircraftCount})`);

    // provider-test for API returns a structured result (success OR graceful failure).
    const ptApi = await getJson('/api/provider-test?provider=API');
    check(
      typeof ptApi.success === 'boolean' && 'adapter' in ptApi,
      `provider-test API returns structured result (success=${ptApi.success})`
    );

    // provider-test for LOCAL_ADSB returns a structured result with sourceType.
    const ptLocal = await getJson('/api/provider-test?provider=LOCAL_ADSB');
    check(
      typeof ptLocal.success === 'boolean' && 'sourceType' in ptLocal,
      `provider-test LOCAL_ADSB returns structured result (sourceType=${ptLocal.sourceType})`
    );
  } catch (err) {
    check(false, `unexpected error: ${err.message}`);
    console.log('\n--- backend output ---\n' + out);
  } finally {
    server.kill('SIGTERM');
    await wait(300);
    try { server.kill('SIGKILL'); } catch { /* gone */ }
  }
}

// ---------------------------------------------------------------------------
// Part B — unit tests (import modules directly, no network)
// ---------------------------------------------------------------------------
async function unitTests() {
  console.log('\nPart B — provider & layer units (no network)');
  const home = { name: 'Test', lat: 32.7767, lon: -96.797 };

  // LOCAL_ADSB: not configured when neither url nor path is set.
  const { createLocalAdsbProvider } = await import('../backend/aircraft/providers/localAdsbProvider.js');
  const local = createLocalAdsbProvider();
  const notConfigured = await local.test({ home, localAdsb: { url: '', path: '' } });
  check(
    notConfigured.success === false && notConfigured.configured === false && notConfigured.sourceType === 'none',
    'LOCAL_ADSB reports not-configured when no url/path'
  );

  // LOCAL_ADSB: parses the sample dump1090/readsb fixture from a file path.
  const fixture = join(BACKEND, 'test', 'fixtures', 'aircraft.sample.json');
  const parsed = await local.test({ home, localAdsb: { url: '', path: fixture } });
  // Fixture has 4 records; one ("NOPOS1") has no lat/lon and must be dropped → 3.
  check(parsed.success === true && parsed.sourceType === 'file', 'LOCAL_ADSB reads aircraft.json from a file path');
  check(parsed.aircraftCount === 3, `LOCAL_ADSB filters records without lat/lon (got ${parsed.aircraftCount}, want 3)`);

  // Field mapping spot-check on the first sample aircraft.
  const sample = parsed.sample[0];
  check(sample.id === 'a1b2c3', `LOCAL_ADSB maps hex → id (got ${sample.id})`);
  check(sample.callsign === 'AAL123', `LOCAL_ADSB trims flight → callsign (got ${sample.callsign})`);
  check(sample.altitude === 34000, `LOCAL_ADSB maps alt_baro → altitude (got ${sample.altitude})`);
  check(sample.aircraftType === 'A321', `LOCAL_ADSB maps t → aircraftType (got ${sample.aircraftType})`);

  // "ground" altitude coerces to 0.
  const ground = parsed.sample.find((a) => a.id === 'd4e5f6');
  check(ground && ground.altitude === 0, 'LOCAL_ADSB coerces "ground" altitude to 0');

  // alt_geom fallback when alt_baro is absent.
  const geom = await local.test({ home, localAdsb: { path: fixture } });
  const ga = geom.sample.find((a) => a.id === '778899');
  check(ga && ga.altitude === 5500, `LOCAL_ADSB falls back alt_baro → alt_geom (got ${ga && ga.altitude})`);

  // Layers: disabled layers do nothing and make no calls.
  const { createWeatherLayer } = await import('../backend/layers/weatherLayer.js');
  const { createSatelliteLayer } = await import('../backend/layers/satelliteLayer.js');
  const { createSpaceLayer } = await import('../backend/layers/spaceLayer.js');
  const off = { home, layers: { weather: false, satellites: false, space: false } };
  const weather = createWeatherLayer();
  const sats = createSatelliteLayer();
  const space = createSpaceLayer();
  check(weather.getMeta(off).enabled === false && weather.getData() === null, 'weather layer quiet when disabled');
  check(sats.getMeta(off).enabled === false && sats.getData().length === 0, 'satellite layer quiet when disabled');
  check(space.getMeta(off).enabled === false && space.getData() === null, 'space layer quiet when disabled');

  // Space layer computes locally (no network) when refreshed.
  await space.refresh({ home, space: {} });
  const sd = space.getData();
  check(sd && sd.moon && typeof sd.moon.name === 'string', `space layer computes moon phase (${sd?.moon?.name})`);
  check(sd && sd.sun && typeof sd.sun.isDay === 'boolean', 'space layer computes day/night');

  // Weather + satellite MOCK providers produce data with no network.
  await weather.refresh({ home, weather: { provider: 'mock' } });
  check(weather.getData() && weather.getData().source === 'mock', 'weather mock provider yields data offline');
  await sats.refresh({ home, satellites: { provider: 'mock' } });
  check(sats.getData().length > 0, `satellite mock provider yields sats offline (${sats.getData().length})`);
}

// ---------------------------------------------------------------------------
// Part C — API provider cache / rate-limit behavior (no network, mocked fetch)
// ---------------------------------------------------------------------------
async function apiProviderTests() {
  console.log('\nPart C — API provider cache/rate-limit (mocked fetch, no network)');

  const savedFetch = global.fetch;
  const mockAc = [
    { hex: 'abc123', flight: 'TEST1 ', lat: 32.7, lon: -96.8, alt_baro: 35000, gs: 400, track: 90 },
  ];

  // Settings with short timings for fast tests.
  const s = (overrides = {}) => ({
    home: { lat: 32.7767, lon: -96.797, name: 'Test' },
    rangeNm: 60,
    api: {
      baseUrl: 'https://fake.test/v2',
      pollIntervalMs:    200,  // 200 ms interval
      rateLimitBackoffMs: 400, // 400 ms backoff
      settingsDebounceMs: 150, // 150 ms debounce
      ...overrides,
    },
  });

  const { createApiProvider } = await import('../backend/aircraft/providers/apiProvider.js');

  // ── Test 1: Poll interval gate ─────────────────────────────────────────────
  // 10 rapid fetchAircraft calls must produce exactly 1 external request.
  // After the poll interval elapses a second request is allowed.
  {
    let fetchCount = 0;
    global.fetch = async () => {
      fetchCount++;
      return { ok: true, status: 200, json: async () => ({ ac: mockAc }) };
    };

    const p = createApiProvider();
    const cfg = s();

    // 10 sequential calls; the first blocks until the fetch completes, the rest hit cache.
    for (let i = 0; i < 10; i++) await p.fetchAircraft(cfg);
    await wait(50); // let background tasks settle
    check(fetchCount === 1, `API poll: 10 rapid calls → 1 external fetch (got ${fetchCount})`);

    // Past the poll interval — one more fetch should fire.
    await wait(250);
    await p.fetchAircraft(cfg);
    await wait(50);
    check(fetchCount === 2, `API poll: after ${cfg.api.pollIntervalMs}ms interval, 1 more fetch (got ${fetchCount})`);
  }

  // ── Test 2: invalidate() debounce ──────────────────────────────────────────
  // 5 rapid invalidates must NOT trigger 5 fetches — only 1 fetch after the
  // debounce window expires.
  {
    let fetchCount = 0;
    global.fetch = async () => {
      fetchCount++;
      return { ok: true, status: 200, json: async () => ({ ac: mockAc }) };
    };

    const p   = createApiProvider();
    const cfg = s({ pollIntervalMs: 30000 }); // long interval so only invalidate triggers

    // Seed the cache with an initial fetch.
    await p.fetchAircraft(cfg);
    await wait(50);
    const baseline = fetchCount; // should be 1
    check(baseline === 1, `API debounce: initial fetch (baseline=${baseline})`);

    // 5 rapid invalidates — each resets the debounce window to now+150ms.
    for (let i = 0; i < 5; i++) { p.invalidate(cfg); await wait(30); } // total ~150ms

    // Debounce still active (last invalidate was ≤150ms ago).
    await p.fetchAircraft(cfg);
    await wait(40);
    check(fetchCount === baseline, `API debounce: no fetch while debounce active (${fetchCount})`);

    // Wait past the debounce — exactly 1 new fetch should fire.
    await wait(200);
    await p.fetchAircraft(cfg);
    await wait(50);
    check(fetchCount === baseline + 1,
      `API debounce: exactly 1 fetch after debounce settles (got ${fetchCount}, want ${baseline + 1})`);
  }

  // ── Test 3: 429 with cached data — serves cache, does not throw ────────────
  {
    let callIndex = 0;
    global.fetch = async () => {
      callIndex++;
      if (callIndex === 1) return { ok: true, status: 200, json: async () => ({ ac: mockAc }) };
      return { ok: false, status: 429, json: async () => ({}) };
    };

    const p   = createApiProvider();
    const cfg = s({ pollIntervalMs: 100 });

    // Seed cache.
    await p.fetchAircraft(cfg);
    await wait(50);

    // Wait past poll interval so next fetch triggers 429.
    await wait(150);

    let threw = false;
    let result;
    try {
      result = await p.fetchAircraft(cfg);
    } catch (e) {
      threw = true;
    }
    await wait(100); // let background 429 fetch settle

    check(!threw,                    'API 429+cache: does not throw (cache served)');
    check(Array.isArray(result),     'API 429+cache: returns aircraft array');
    const meta = p.getMeta(cfg);
    check(meta.rateLimited === true, 'API 429+cache: rateLimited flag set');
    check(meta.hasCache === true,    'API 429+cache: cache preserved');
  }

  // ── Test 4: 429 with NO cached data — throws noCache so manager falls back ─
  {
    global.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });

    const p   = createApiProvider();
    const cfg = s();
    let noCache = false;
    try {
      await p.fetchAircraft(cfg);
    } catch (e) {
      noCache = e.noCache === true;
    }
    check(noCache, 'API 429+nocache: throws noCache=true (triggers MOCK fallback)');
    const meta = p.getMeta(cfg);
    check(meta.rateLimited === true, 'API 429+nocache: rateLimited flag set');
    check(meta.hasCache    === false,'API 429+nocache: cache still empty');
  }

  global.fetch = savedFetch;
}

// ---------------------------------------------------------------------------
// Part D — motion model + normalizer passthrough (no network, pure units)
// ---------------------------------------------------------------------------
async function motionAndNormalizerTests() {
  console.log('\nPart D — motion model + normalizer passthrough (no network)');

  // --- aircraftMotion.js (plain JS, importable in Node) ---
  const motion = await import('../frontend/src/lib/aircraftMotion.js');
  const cfg = { motion: { interpolate: true, renderDelayMs: 1150, maxExtrapolationSec: 4, staleSec: 20 } };

  // smoothHeading takes the shortest arc (350° → 10° goes UP through 0°, +20°).
  const sh = motion.smoothHeading(350, 10, 0.5);
  check(sh > 355 || sh < 5, `smoothHeading shortest-arc 350→10 (got ${sh.toFixed(1)})`);
  check(motion.smoothHeading(undefined, 42) === 42, 'smoothHeading seeds from undefined');

  // deadReckon: due east at 3600 kt for 1 s ≈ +1 nm ≈ +0.01667° lon at equator.
  const dr = motion.deadReckonPosition({ lat: 0, lon: 0 }, 90, 3600, 1);
  check(Math.abs(dr.lon - 0.01667) < 0.0005 && Math.abs(dr.lat) < 1e-6,
    `deadReckon east 1nm (got lon ${dr.lon.toFixed(5)})`);

  // Interpolation between two fixes 1 s apart → exact midpoint at +0.5 s.
  const tracks = new Map();
  motion.updateAircraftTracks(tracks, [{ id: 'A', lat: 0, lon: 0, heading: 90, speed: 600 }], 1000, cfg);
  motion.updateAircraftTracks(tracks, [{ id: 'A', lat: 0, lon: 2, heading: 90, speed: 600 }], 2000, cfg);
  const mid = motion.sampleAircraftTrack(tracks.get('A'), 1500, cfg);
  check(Math.abs(mid.lon - 1.0) < 1e-6, `interpolation midpoint (got lon ${mid.lon.toFixed(4)}, want 1.0)`);

  // Sampling before the oldest fix clamps to it.
  const before = motion.sampleAircraftTrack(tracks.get('A'), 500, cfg);
  check(Math.abs(before.lon) < 1e-6, `clamp before oldest fix (got lon ${before.lon.toFixed(4)})`);

  // Extrapolation past the newest fix is capped (≤ maxExtrapolationSec) and finite.
  const after = motion.sampleAircraftTrack(tracks.get('A'), 9000, cfg); // 7 s past, capped at 4 s
  check(Number.isFinite(after.lon) && after.lon > 2 && after.lon < 2.1,
    `extrapolation capped + finite (got lon ${after.lon.toFixed(4)})`);

  // Heading derived from motion (eastward) ≈ 90°.
  const hdg = motion.sampleTrackHeading(tracks.get('A'), 1500, cfg);
  check(Math.abs(hdg - 90) < 1, `heading from motion eastward (got ${hdg.toFixed(1)})`);

  // Stale pruning removes tracks past the window.
  motion.pruneStaleTracks(tracks, 2000 + 21000, 20000);
  check(tracks.size === 0, `pruneStaleTracks drops stale (size ${tracks.size})`);

  // Provider-aware motion: API mode stretches extrapolation/stale to cover the
  // ~60 s poll interval; MOCK/LOCAL keep the fast-feed defaults untouched.
  const apiEff = motion.effectiveMotionSettings({ provider: 'API', motion: cfg.motion }).motion;
  check(apiEff.maxExtrapolationSec >= 60 && apiEff.maxExtrapolationSec <= 80,
    `API motion maxExtrapolationSec ~70 (got ${apiEff.maxExtrapolationSec})`);
  check(apiEff.staleSec >= 90 && apiEff.staleSec <= 110,
    `API motion staleSec ~100 (got ${apiEff.staleSec})`);
  const mockEff = motion.effectiveMotionSettings({ provider: 'MOCK', motion: cfg.motion }).motion;
  check(mockEff.maxExtrapolationSec === 4 && mockEff.staleSec === 20,
    `MOCK motion keeps fast defaults (extrap ${mockEff.maxExtrapolationSec}, stale ${mockEff.staleSec})`);
  check(motion.motionMode({ provider: 'API' }) === 'api' && motion.motionMode({ provider: 'MOCK' }) === 'fast',
    'motionMode reports api vs fast');

  // deadReckonBack walks the track backwards (where it WAS), opposite of forward.
  const backPos = motion.deadReckonBack({ lat: 0, lon: 1 }, 90, 3600, 1); // 1 s ago, heading east
  check(backPos.lon < 1, `deadReckonBack moves behind the aircraft (got lon ${backPos.lon.toFixed(4)})`);

  // --- normalizer passthrough (backward-compatible additive fields) ---
  const { normalizeAircraft } = await import('../backend/aircraft/aircraftNormalizer.js');
  const raw = {
    hex: 'abc123', flight: 'AAL1 ', lat: 32.8, lon: -96.8, alt_baro: 35000,
    gs: 430, track: 270, t: 'B77W', r: 'N123AB', squawk: '1200',
    category: 'A5', baro_rate: -640, onGround: false,
  };
  const ac = normalizeAircraft(raw, 'api');
  check(ac.aircraftType === 'B77W', `normalizer keeps aircraftType (got ${ac.aircraftType})`);
  check(ac.typeCode === 'B77W', `normalizer passes typeCode (got ${ac.typeCode})`);
  check(ac.registration === 'N123AB', `normalizer passes registration (got ${ac.registration})`);
  check(ac.verticalRate === -640, `normalizer passes verticalRate (got ${ac.verticalRate})`);
  check(ac.squawk === '1200', `normalizer keeps squawk (got ${ac.squawk})`);

  // On-ground flows through from the "ground" string the providers flag.
  const groundAc = normalizeAircraft({ hex: 'd1', lat: 32.7, lon: -96.7, altitude: 0, onGround: true }, 'local_adsb');
  check(groundAc.onGround === true, 'normalizer passes onGround flag');

  // A bare record (no optional fields) still normalizes and omits the extras.
  const bare = normalizeAircraft({ id: 'x', lat: 1, lon: 2 }, 'mock');
  check(bare && bare.typeCode === undefined && bare.registration === undefined,
    'normalizer stays backward-compatible (omits absent optional fields)');
}

// ---------------------------------------------------------------------------
// Part E — settings migration (older files merge safely with new defaults)
// ---------------------------------------------------------------------------
async function migrationTests() {
  console.log('\nPart E — settings migration (no network)');
  const { merge, DEFAULT_SETTINGS } = await import('../backend/settings/settingsStore.js');

  // Simulate an OLD settings file that predates the smooth-motion / display
  // upgrades: it has no display.maxFps etc. and no motion{} block at all.
  const oldFile = {
    home: { name: 'Old Town', lat: 40.0, lon: -75.0 },
    provider: 'API',
    rangeNm: 100,
    display: { theme: 'amber', brightness: 0.8, labels: true, trails: true, aircraftSize: 1.2 },
    api: { baseUrl: 'https://api.airplanes.live/v2', apiKey: '', pollIntervalMs: 30000, rateLimitBackoffMs: 60000 },
  };
  const m = merge(DEFAULT_SETTINGS, oldFile);

  // User's explicit old values survive.
  check(m.home.name === 'Old Town' && m.provider === 'API' && m.rangeNm === 100,
    'migration: keeps user values (home/provider/range)');
  check(m.display.theme === 'amber' && m.display.brightness === 0.8,
    'migration: keeps user display values (theme/brightness)');

  // New display keys are backfilled from defaults.
  check(m.display.maxFps === DEFAULT_SETTINGS.display.maxFps, 'migration: display.maxFps backfilled');
  check(m.display.altitudeColor === DEFAULT_SETTINGS.display.altitudeColor, 'migration: display.altitudeColor backfilled');
  check(m.display.labelDensity === DEFAULT_SETTINGS.display.labelDensity, 'migration: display.labelDensity backfilled');
  check(m.display.nearestN === DEFAULT_SETTINGS.display.nearestN, 'migration: display.nearestN backfilled');
  check(m.display.labelRotationDeg === DEFAULT_SETTINGS.display.labelRotationDeg, 'migration: display.labelRotationDeg backfilled');
  check(m.display.highlightEmergency === DEFAULT_SETTINGS.display.highlightEmergency, 'migration: display.highlightEmergency backfilled');
  check(m.display.glyphDebug === false, 'migration: display.glyphDebug backfilled');

  // The whole motion{} block (absent in the old file) comes from defaults.
  check(m.motion && m.motion.interpolate === true, 'migration: motion.interpolate backfilled');
  check(m.motion.renderDelayMs === DEFAULT_SETTINGS.motion.renderDelayMs, 'migration: motion.renderDelayMs backfilled');
  check(m.motion.maxExtrapolationSec === DEFAULT_SETTINGS.motion.maxExtrapolationSec, 'migration: motion.maxExtrapolationSec backfilled');
  check(m.motion.staleSec === DEFAULT_SETTINGS.motion.staleSec, 'migration: motion.staleSec backfilled');

  // settingsDebounceMs (added later) is backfilled even though the old api{} omitted it.
  check(m.api.settingsDebounceMs === DEFAULT_SETTINGS.api.settingsDebounceMs,
    'migration: api.settingsDebounceMs backfilled (old file kept its poll/backoff)');
}

// ---------------------------------------------------------------------------
// Part F — settings-change relevance (which saves invalidate the API)
// ---------------------------------------------------------------------------
async function invalidationRelevanceTests() {
  console.log('\nPart F — settings-change relevance (no network)');
  const { API_RELEVANT_PATHS, POLL_RELEVANT_PATHS, changedPaths, layersChanged } =
    await import('../backend/settings/settingsDiff.js');

  const base = {
    provider: 'API', rangeNm: 60,
    home: { name: 'Home', lat: 32.7, lon: -96.8 },
    updateIntervalMs: 1000,
    display: { theme: 'night', brightness: 1, labels: true, trails: true, aircraftSize: 1, glyphDebug: false, maxFps: 30, altitudeColor: true },
    calibration: { offsetX: 0, rotation: 0 },
    motion: { interpolate: true },
    api: { baseUrl: 'https://api.airplanes.live/v2', apiKey: '', pollIntervalMs: 60000, rateLimitBackoffMs: 120000, settingsDebounceMs: 3000 },
    localAdsb: { url: 'http://localhost:8080/data/aircraft.json', path: '', pollIntervalMs: 1000 },
    layers: { aircraft: true, weather: false, satellites: false, space: false, stars: true },
    weather: {}, satellites: {}, space: {},
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // --- display-only changes must NOT invalidate the API ---
  const displayOnly = [
    ['theme', (s) => { s.display.theme = 'amber'; }],
    ['brightness', (s) => { s.display.brightness = 0.6; }],
    ['labels', (s) => { s.display.labels = false; }],
    ['trails', (s) => { s.display.trails = false; }],
    ['altitudeColor', (s) => { s.display.altitudeColor = false; }],
    ['glyphDebug', (s) => { s.display.glyphDebug = true; }],
    ['aircraftSize', (s) => { s.display.aircraftSize = 1.5; }],
    ['maxFps', (s) => { s.display.maxFps = 60; }],
    ['calibration', (s) => { s.calibration.rotation = 90; }],
    ['motion', (s) => { s.motion.interpolate = false; }],
  ];
  for (const [label, mutate] of displayOnly) {
    const after = clone(base);
    mutate(after);
    const changed = changedPaths(base, after, API_RELEVANT_PATHS);
    check(changed.length === 0, `display-only "${label}" does NOT invalidate API`);
  }

  // Toggling stars (a layer unrelated to aircraft fetch) must not invalidate API.
  {
    const after = clone(base); after.layers.stars = false;
    check(changedPaths(base, after, API_RELEVANT_PATHS).length === 0, 'layer "stars" does NOT invalidate API');
    check(layersChanged(base, after) === true, 'layer "stars" IS a layer change (sync layers)');
  }

  // --- aircraft-fetch-relevant changes MUST invalidate the API ---
  {
    const after = clone(base); after.provider = 'LOCAL_ADSB';
    check(changedPaths(base, after, API_RELEVANT_PATHS).includes('provider'), 'provider change invalidates API');
    check(changedPaths(base, after, POLL_RELEVANT_PATHS).includes('provider'), 'provider change restarts poll');
  }
  {
    const after = clone(base); after.rangeNm = 150;
    check(changedPaths(base, after, API_RELEVANT_PATHS).includes('rangeNm'), 'rangeNm change invalidates API');
  }
  {
    const after = clone(base); after.home = { ...after.home, lat: 40.0, lon: -75.0 };
    const ch = changedPaths(base, after, API_RELEVANT_PATHS);
    check(ch.includes('home.lat') && ch.includes('home.lon'), 'home location change invalidates API');
  }
  {
    const after = clone(base); after.api.pollIntervalMs = 90000;
    check(changedPaths(base, after, API_RELEVANT_PATHS).includes('api.pollIntervalMs'), 'api poll change invalidates API');
  }
  {
    const after = clone(base); after.api.baseUrl = 'https://example.test/v2';
    check(changedPaths(base, after, API_RELEVANT_PATHS).includes('api.baseUrl'), 'api baseUrl change invalidates API');
  }

  // An identical save (no material change) invalidates nothing.
  {
    const after = clone(base);
    check(changedPaths(base, after, API_RELEVANT_PATHS).length === 0, 'identical save does NOT invalidate API');
    check(layersChanged(base, after) === false, 'identical save is NOT a layer change');
  }
}

// ---------------------------------------------------------------------------
// Part G — LOCAL_ADSB format variations (older Windows dump1090 + readsb)
// ---------------------------------------------------------------------------
async function localAdsbFormatTests() {
  console.log('\nPart G — LOCAL_ADSB format parsing (no network)');
  const { createLocalAdsbProvider } = await import('../backend/aircraft/providers/localAdsbProvider.js');
  const home = { name: 'Test', lat: 32.7767, lon: -96.797 };
  const settings = (path) => ({ home, localAdsb: { url: '', path } });

  // --- Format A: root-level array (older Windows dump1090 data.json) ---
  const arrayFixture = join(BACKEND, 'test', 'fixtures', 'aircraft.dump1090-array.json');
  {
    const p = createLocalAdsbProvider();
    const r = await p.test(settings(arrayFixture));
    check(r.success === true, 'dump1090-array: test succeeds');
    check(r.detectedFormat === 'dump1090-array', `dump1090-array: format detected (got ${r.detectedFormat})`);
    // 4 records, 1 has no lat/lon (NOPOS2) → 3 with position
    check(r.rawCount === 4, `dump1090-array: rawCount 4 (got ${r.rawCount})`);
    check(r.normalizedCount === 3, `dump1090-array: normalizedCount 3 (got ${r.normalizedCount})`);
  }

  // --- Field mapping for dump1090-array ---
  {
    const p = createLocalAdsbProvider();
    const r = await p.test(settings(arrayFixture));
    const ac = r.sampleNormalized.find((a) => a.id === 'ac6204');
    check(ac != null, 'dump1090-array: hex → id (found ac6204)');
    check(ac && ac.callsign === 'SWA55', `dump1090-array: flight → callsign trimmed (got ${ac?.callsign})`);
    check(ac && ac.altitude === 15075, `dump1090-array: altitude numeric (got ${ac?.altitude})`);
    check(ac && ac.heading === 206, `dump1090-array: track → heading (got ${ac?.heading})`);
    check(ac && ac.speed === 320, `dump1090-array: speed → speed (got ${ac?.speed})`);
  }

  // --- "ground" altitude in dump1090-array format ---
  {
    const p = createLocalAdsbProvider();
    const r = await p.test(settings(arrayFixture));
    const ground = r.sampleNormalized.find((a) => a.id === 'c0ffee');
    check(ground != null, 'dump1090-array: ground aircraft found');
    check(ground && ground.altitude === 0, `dump1090-array: altitude "ground" → 0 (got ${ground?.altitude})`);
    check(ground && ground.onGround === true, 'dump1090-array: altitude "ground" sets onGround flag');
  }

  // --- getMeta() exposes raw/normalized counts and format ---
  {
    const p = createLocalAdsbProvider();
    await p.test(settings(arrayFixture));
    const meta = p.getMeta(settings(arrayFixture));
    check(meta.rawAircraftCount === 4, `getMeta rawAircraftCount 4 (got ${meta.rawAircraftCount})`);
    check(meta.aircraftCount === 3, `getMeta aircraftCount 3 (got ${meta.aircraftCount})`);
    check(meta.detectedFormat === 'dump1090-array', `getMeta detectedFormat (got ${meta.detectedFormat})`);
  }

  // --- Format B: { aircraft: [...] } — readsb/tar1090 ---
  const readsb = join(BACKEND, 'test', 'fixtures', 'aircraft.sample.json');
  {
    const p = createLocalAdsbProvider();
    const r = await p.test(settings(readsb));
    check(r.success === true, 'readsb-aircraft: test succeeds');
    check(r.detectedFormat === 'readsb-aircraft', `readsb-aircraft: format detected (got ${r.detectedFormat})`);
    check(r.rawCount === 4, `readsb-aircraft: rawCount 4 (got ${r.rawCount})`);
    check(r.normalizedCount === 3, `readsb-aircraft: normalizedCount 3 (got ${r.normalizedCount})`);
  }

  // --- Aircraft missing optional fields do not get dropped ---
  {
    const p = createLocalAdsbProvider();
    const r = await p.test(settings(arrayFixture));
    // SWA55 has hex/flight/lat/lon/altitude/track/speed but no squawk, category,
    // nav_heading, seen_pos, t, r, etc. It must still normalize and appear.
    const min = r.sampleNormalized.find((a) => a.id === 'ac6204');
    check(min != null, 'dump1090-array: aircraft with only core fields is kept');
    check(min && min.squawk === undefined, 'dump1090-array: absent squawk → undefined (not empty string)');
    check(min && min.typeCode === undefined, 'dump1090-array: absent typeCode → undefined');
  }

  // --- Direct normalizeAircraft for the exact user-reported format ---
  {
    const { normalizeAircraft } = await import('../backend/aircraft/aircraftNormalizer.js');
    const raw = {
      hex: 'ac6204', flight: 'SWA55', lat: 32.67869, lon: -96.884198,
      altitude: 15075, track: 206, speed: 320,
    };
    const ac = normalizeAircraft(raw, 'local_adsb');
    check(ac !== null, 'normalizer: exact user-reported dump1090 record normalizes');
    check(ac && ac.id === 'ac6204', `normalizer: hex → id (got ${ac?.id})`);
    check(ac && ac.callsign === 'SWA55', `normalizer: flight → callsign (got ${ac?.callsign})`);
    check(ac && Math.abs(ac.lat - 32.67869) < 1e-5, `normalizer: lat preserved (got ${ac?.lat})`);
    check(ac && ac.altitude === 15075, `normalizer: altitude numeric (got ${ac?.altitude})`);
    check(ac && ac.heading === 206, `normalizer: track → heading (got ${ac?.heading})`);
    check(ac && ac.speed === 320, `normalizer: speed → speed (got ${ac?.speed})`);
  }
}

// ---------------------------------------------------------------------------
console.log(`Above Live — smoke check (port ${PORT})`);
await integrationTests();
await unitTests();
await apiProviderTests();
await motionAndNormalizerTests();
await migrationTests();
await invalidationRelevanceTests();
await localAdsbFormatTests();
console.log(failed ? '\nSMOKE CHECK FAILED' : '\nSMOKE CHECK PASSED');
process.exit(failed ? 1 : 0);
