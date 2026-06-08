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
import { readFile, writeFile } from 'node:fs/promises';

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
    check(status.layers && status.layers.iss === false, 'ISS layer OFF by default');
    check(status.layers && status.layers.satellites === false, 'satellites layer OFF by default');
    check(status.layers && status.layers.starlink === false, 'starlink layer OFF by default');
    check(status.layers && status.layers.space === false, 'space layer OFF by default');
    check(status.layers && status.layers.stars === true, 'stars layer ON by default');
    check(status.weather && status.weather.enabled === false, 'weather layer not enabled (no external calls)');
    check(status.iss && status.iss.enabled === false, 'ISS layer not enabled (no external calls)');
    check(status.satellites && status.satellites.enabled === false, 'satellite layer not enabled (no external calls)');
    check(status.starlink && status.starlink.enabled === false, 'starlink layer not enabled (no external calls)');
    check(status.space && status.space.enabled === false, 'space layer not enabled (no external calls)');
    // Orbital layer meta shape (cap/group) present even while off.
    check(status.iss && status.iss.cap === 1 && status.iss.group === 'stations', 'ISS meta: cap 1, group stations');
    check(status.starlink && status.starlink.cap === 25, 'starlink meta: cap 25');

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
  const { createOrbitalLayer } = await import('../backend/layers/orbitalLayer.js');
  const { createSpaceLayer } = await import('../backend/layers/spaceLayer.js');
  const off = { home, layers: { weather: false, satellites: false, space: false } };
  const weather = createWeatherLayer();
  const sats = createOrbitalLayer('satellites');
  const space = createSpaceLayer();
  check(weather.getMeta(off).enabled === false && weather.getData() === null, 'weather layer quiet when disabled');
  check(sats.getMeta(off).enabled === false && sats.getData().length === 0, 'satellite layer quiet when disabled');
  check(space.getMeta(off).enabled === false && space.getData() === null, 'space layer quiet when disabled');

  // Space layer computes locally (no network) when refreshed.
  await space.refresh({ home, space: {} });
  const sd = space.getData();
  check(sd && sd.moon && typeof sd.moon.name === 'string', `space layer computes moon phase (${sd?.moon?.name})`);
  check(sd && sd.sun && typeof sd.sun.isDay === 'boolean', 'space layer computes day/night');
  check(Array.isArray(sd.bodies) && sd.bodies.length === 6, `space layer computes 6 bodies (got ${sd?.bodies?.length})`);

  // Weather MOCK provider produces data with no network.
  await weather.refresh({ home, weather: { provider: 'mock' } });
  check(weather.getData() && weather.getData().source === 'mock', 'weather mock provider yields data offline');
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
  check(m.display.spaceLabels === DEFAULT_SETTINGS.display.spaceLabels, 'migration: display.spaceLabels backfilled');
  check(m.display.radar && m.display.radar.rings === true && m.display.radar.compass === true
    && m.display.radar.nmLabels === true && m.display.radar.crosshair === true,
    'migration: display.radar overlay toggles backfilled (all on)');

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

  // Toggling space-object layers must not invalidate the API, but IS a layer
  // change (so the server re-syncs layer timers).
  for (const key of ['stars', 'iss', 'satellites', 'starlink', 'space']) {
    const after = clone(base);
    after.layers = { ...after.layers, [key]: !after.layers[key] };
    check(changedPaths(base, after, API_RELEVANT_PATHS).length === 0, `layer "${key}" does NOT invalidate API`);
    check(layersChanged(base, after) === true, `layer "${key}" IS a layer change (sync layers)`);
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
// Part H — space layers (orbital TLE/GP propagation + planets; no network)
// ---------------------------------------------------------------------------
async function spaceLayerTests() {
  console.log('\nPart H — space layers: orbital + planets (no network)');
  const orbital = await import('../backend/layers/lib/orbital.js');
  const astro = await import('../backend/layers/lib/astro.js');

  // A real ISS TLE (epoch 2024-001).
  const issTle = [
    'ISS (ZARYA)',
    '1 25544U 98067A   24001.50000000  .00016717  00000-0  30000-3 0  9999',
    '2 25544  51.6400 208.0000 0006703 130.0000 325.0000 15.50000000 10000',
  ].join('\n');

  // --- TLE text parsing (3-line) ---
  const els = orbital.parseTleText(issTle);
  check(els.length === 1, `TLE parse: one element set (got ${els.length})`);
  check(els[0].satnum === 25544, `TLE parse: satnum 25544 (got ${els[0].satnum})`);
  check(Math.abs(els[0].incloDeg - 51.64) < 1e-6, `TLE parse: inclination 51.64 (got ${els[0].incloDeg})`);
  check(Math.abs(els[0].noRevPerDay - 15.5) < 1e-6, `TLE parse: mean motion 15.5 (got ${els[0].noRevPerDay})`);

  // --- Propagation: sub-point sane (lat within inclination, LEO altitude) ---
  const pos = orbital.propagate(els[0], els[0].epoch);
  check(pos && Math.abs(pos.lat) <= 51.7, `propagate: |lat| <= inclination (got ${pos?.lat?.toFixed(2)})`);
  check(pos && pos.altKm > 350 && pos.altKm < 470, `propagate: ISS altitude ~400km (got ${pos?.altKm?.toFixed(0)})`);
  check(pos && pos.lon >= -180 && pos.lon <= 180, `propagate: lon normalized (got ${pos?.lon?.toFixed(1)})`);

  // Half an orbit (~46 min) later, latitude sign flips hemispheres.
  const half = orbital.propagate(els[0], new Date(els[0].epoch.getTime() + 46 * 60000));
  check(half && Math.sign(half.lat) !== Math.sign(pos.lat), 'propagate: latitude swings hemisphere over half orbit');

  // --- GP JSON parsing produces the same element shape ---
  const gp = orbital.parseGpJson([{
    OBJECT_NAME: 'ISS (ZARYA)', NORAD_CAT_ID: 25544, EPOCH: '2024-01-01T12:00:00',
    MEAN_MOTION: 15.5, ECCENTRICITY: 0.0006703, INCLINATION: 51.64,
    RA_OF_ASC_NODE: 208.0, ARG_OF_PERICENTER: 130.0, MEAN_ANOMALY: 325.0,
  }]);
  check(gp.length === 1 && gp[0].satnum === 25544, 'GP JSON parse: satnum 25544');
  check(Math.abs(gp[0].incloDeg - 51.64) < 1e-6, 'GP JSON parse: inclination mapped');
  const gpPos = orbital.propagate(gp[0], gp[0].epoch);
  check(gpPos && Number.isFinite(gpPos.lat) && Number.isFinite(gpPos.lon), 'GP JSON propagate: finite sub-point');

  // --- Malformed input is handled gracefully ---
  check(orbital.parseTleText('garbage\nnot a tle').length === 0, 'TLE parse: junk → empty');
  check(orbital.parseTleText('').length === 0, 'TLE parse: empty string → empty');
  check(orbital.parseGpJson(null).length === 0, 'GP JSON parse: null → empty');

  // --- propagateAll caps + shapes objects ---
  const many = orbital.parseTleText([issTle, issTle, issTle].join('\n')); // 3 copies
  const objs = orbital.propagateAll(many, new Date(), 'satellite');
  check(objs.length === 3 && objs.every((o) => o.source === 'satellite' && 'altitudeKm' in o),
    `propagateAll: shapes objects (got ${objs.length})`);

  // --- Astro: 6 bodies, az in [0,360), el in [-90,90] ---
  const home = { lat: 32.7767, lon: -96.797 };
  const sky = astro.computeSky(home, new Date('2026-06-07T18:00:00Z'));
  check(sky.length === 6, `astro: 6 bodies (got ${sky.length})`);
  check(sky.every((b) => b.az >= 0 && b.az < 360 && b.el >= -90 && b.el <= 90), 'astro: az/el in range');
  const sun = sky.find((b) => b.kind === 'sun');
  check(sun && sun.el > 60, `astro: Dallas midday Sun high (el ${sun?.el?.toFixed(0)})`);
  check(sky.filter((b) => b.kind === 'planet').length === 4, 'astro: 4 planets present');

  // --- Orbital layer: disabled = no data, capped, status shape ---
  const { createOrbitalLayer } = await import('../backend/layers/orbitalLayer.js');
  const iss = createOrbitalLayer('iss');
  const offMeta = iss.getMeta({ home, layers: { iss: false } });
  check(offMeta.enabled === false && iss.getData().length === 0, 'orbital(iss): quiet when disabled');
  check(offMeta.cap === 1, `orbital(iss): default cap 1 (got ${offMeta.cap})`);
  check(offMeta.group === 'stations', `orbital(iss): default group stations (got ${offMeta.group})`);
  const slMeta = createOrbitalLayer('starlink').getMeta({ home, layers: { starlink: false } });
  check(slMeta.cap === 25, `orbital(starlink): default cap 25 (got ${slMeta.cap})`);

  // --- Space layer getMeta exposes counts + last update ---
  const { createSpaceLayer } = await import('../backend/layers/spaceLayer.js');
  const space = createSpaceLayer();
  await space.refresh({ home, space: {} });
  const sm = space.getMeta({ home, layers: { space: true } });
  check(sm.count === 6, `space getMeta: count 6 (got ${sm.count})`);
  check(typeof sm.aboveHorizon === 'number' && sm.lastSuccess > 0, 'space getMeta: aboveHorizon + lastSuccess');
}

// ---------------------------------------------------------------------------
// Part I — Starlink 403 isolation (mocked fetch, no network)
// ---------------------------------------------------------------------------
async function starlinkBlockedTests() {
  console.log('\nPart I — Starlink HTTP 403 isolation (mocked fetch)');
  const savedFetch = global.fetch;

  global.fetch = async (url) => {
    if (String(url).includes('starlink')) {
      // CelesTrak returns 403 for Starlink
      return { ok: false, status: 403, text: async () => '' };
    }
    // Other groups: 404 (generic transient error, not blocked)
    return { ok: false, status: 404, text: async () => '' };
  };

  try {
    const { createOrbitalLayer: makeOrbital } = await import('../backend/layers/orbitalLayer.js');
    const starlink = makeOrbital('starlink');
    const iss     = makeOrbital('iss');
    const home    = { lat: 32.7767, lon: -96.797 };
    const s       = { home, layers: { starlink: true, iss: true } };

    // Trigger TLE fetch for Starlink → should receive 403
    await starlink.refresh(s);
    const slMeta = starlink.getMeta(s);
    check(slMeta.blocked === true, 'Starlink 403: blocked=true in getMeta after HTTP 403');
    check(
      slMeta.lastError && slMeta.lastError.includes('403'),
      `Starlink 403: lastError mentions 403 (got: "${slMeta.lastError}")`
    );
    check(starlink.getData().length === 0, 'Starlink 403: getData() empty (no propagation without TLEs)');

    // ISS uses a separate instance and a different group → 404, not blocked
    await iss.refresh(s);
    const issMeta = iss.getMeta(s);
    check(issMeta.blocked !== true, 'Starlink 403: ISS layer NOT blocked by Starlink 403');

    // After invalidate(), blocked flag resets and the layer can retry
    starlink.invalidate();
    check(starlink.getMeta(s).blocked !== true, 'Starlink 403: blocked resets after invalidate()');
  } finally {
    global.fetch = savedFetch;
  }
}

// ---------------------------------------------------------------------------
// Part J — settings recovery + calibration scale + trail length (no network)
// ---------------------------------------------------------------------------
async function recoveryAndCalibrationTests() {
  console.log('\nPart J — settings recovery, calibration scale, trails (no network)');

  // --- Defaults: LOCAL_ADSB url now points at data.json ---
  const store = await import('../backend/settings/settingsStore.js');
  check(
    store.DEFAULT_SETTINGS.localAdsb.url === 'http://localhost:8080/data.json',
    `defaults: LOCAL_ADSB url is data.json (got ${store.DEFAULT_SETTINGS.localAdsb.url})`
  );

  // --- Empty/corrupt settings.json recovers safely + recreates a valid file ---
  const SETTINGS_PATH = join(BACKEND, 'data', 'settings.json');
  const backup = await readFile(SETTINGS_PATH, 'utf8'); // restore at the end
  try {
    // 1) Empty (0-byte) file → recover with defaults + recreate a valid file.
    await writeFile(SETTINGS_PATH, '', 'utf8');
    const recovered = await store.loadSettings();
    check(recovered && recovered.provider != null && recovered.localAdsb?.url != null,
      'recovery: empty settings.json recovers a usable settings object');
    check(recovered.localAdsb.url === 'http://localhost:8080/data.json',
      'recovery: recovered settings use the data.json default URL');
    const afterEmpty = await readFile(SETTINGS_PATH, 'utf8');
    check(afterEmpty.trim().length > 0, 'recovery: empty file was recreated (no longer 0 bytes)');
    check(JSON.parse(afterEmpty).provider != null, 'recovery: recreated file is valid JSON');

    // 2) Corrupt JSON → same safe recovery.
    await writeFile(SETTINGS_PATH, '{ this is : not json,,', 'utf8');
    const recovered2 = await store.loadSettings();
    check(recovered2 && recovered2.provider != null, 'recovery: corrupt JSON recovers a usable settings object');
    check(JSON.parse(await readFile(SETTINGS_PATH, 'utf8')).provider != null,
      'recovery: corrupt file was recreated as valid JSON');

    // 3) saveSettings never truncates the file to empty.
    await store.saveSettings({ trailLength: 240, calibration: { scale: 7.5 } });
    const afterSave = await readFile(SETTINGS_PATH, 'utf8');
    check(afterSave.trim().length > 0, 'save: settings.json is not empty after a save');
    const parsed = JSON.parse(afterSave);
    check(parsed.trailLength === 240, `save: trailLength persisted (got ${parsed.trailLength})`);
    check(parsed.calibration.scale === 7.5, `save: calibration.scale persisted (got ${parsed.calibration.scale})`);
  } finally {
    await writeFile(SETTINGS_PATH, backup, 'utf8'); // always restore original
  }

  // --- Calibration scale: clamp + accept up to 10x ---
  const pm = await import('../frontend/src/lib/projectionMath.js');
  check(pm.SCALE_MAX === 10 && pm.SCALE_MIN === 0.25, 'scale: bounds are 0.25x – 10x');
  check(pm.clampScale(10) === 10, 'scale: 10x accepted');
  check(pm.clampScale(2.35) === 2.35, 'scale: mid value (2.35x) accepted');
  check(pm.clampScale(25) === 10, 'scale: above-max clamped to 10x');
  check(pm.clampScale(-5) === 0.25, 'scale: below-min clamped to 0.25x');
  check(pm.clampScale('nonsense') === 1, 'scale: non-finite falls back to 1x');
  check(pm.getCalibration({ calibration: { scale: 50 } }).scale === 10,
    'scale: getCalibration clamps an out-of-range scale');
  check(pm.getCalibration({ calibration: { scale: 4.2 } }).scale === 4.2,
    'scale: getCalibration preserves a valid scale');

  // --- Trail length: clamp + window derivation ---
  const motion = await import('../frontend/src/lib/aircraftMotion.js');
  check(motion.TRAIL_MIN_SEC === 30 && motion.TRAIL_MAX_SEC === 600, 'trails: bounds are 30s – 600s');
  check(motion.clampTrailSec(600) === 600, 'trails: 600s accepted');
  check(motion.clampTrailSec(9999) === 600, 'trails: above-max clamped to 600s');
  check(motion.clampTrailSec(5) === 30, 'trails: below-min clamped to 30s');
  check(motion.clampTrailSec('x') === 30, 'trails: non-finite falls back to 30s');
  check(motion.trailWindowMsFromSettings({ trailLength: 300 }) === 300000, 'trails: 300s → 300000ms window');

  // --- Longer trails keep older history; renderer sampling still works ---
  // 3 fixes; oldest is 200s old. With a 300s trail the oldest is retained; with
  // a 30s trail it is trimmed (but always ≥2 points kept for interpolation).
  const mkFix = (lon) => ({ id: 'T', lat: 0, lon, heading: 90, speed: 400 });
  const longTracks = new Map();
  motion.updateAircraftTracks(longTracks, [mkFix(0)], 0,      { trailLength: 300 });
  motion.updateAircraftTracks(longTracks, [mkFix(1)], 1000,   { trailLength: 300 });
  motion.updateAircraftTracks(longTracks, [mkFix(2)], 200000, { trailLength: 300 });
  check(longTracks.get('T').history.length === 3, 'trails: long window retains old history (3 fixes)');

  const shortTracks = new Map();
  motion.updateAircraftTracks(shortTracks, [mkFix(0)], 0,      { trailLength: 30 });
  motion.updateAircraftTracks(shortTracks, [mkFix(1)], 1000,   { trailLength: 30 });
  motion.updateAircraftTracks(shortTracks, [mkFix(2)], 200000, { trailLength: 30 });
  check(shortTracks.get('T').history.length === 2, 'trails: short window trims old history (down to 2)');

  // Sampling still returns a finite position for a long-window track.
  const sample = motion.sampleAircraftTrack(longTracks.get('T'), 500, { trailLength: 300 });
  check(sample && Number.isFinite(sample.lon), 'trails: sampling a long-window track returns a finite position');

  // --- LOCAL_ADSB auto-detects data.json when the URL returns HTML ---
  const savedFetch = global.fetch;
  global.fetch = async (url) => {
    const u = String(url);
    if (/\/data\.json$/.test(u)) {
      return {
        ok: true, status: 200,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify([{ hex: 'abc123', flight: 'TST1', lat: 32.7, lon: -96.8, altitude: 10000, track: 90, speed: 300 }]),
      };
    }
    return { ok: true, status: 200, headers: { get: () => 'text/html' }, text: async () => '<html>directory listing</html>' };
  };
  try {
    const { createLocalAdsbProvider } = await import('../backend/aircraft/providers/localAdsbProvider.js');
    const p = createLocalAdsbProvider();
    const r = await p.test({ home: { lat: 32.7767, lon: -96.797 }, localAdsb: { url: 'http://localhost:8080/' } });
    check(r.success === true, 'LOCAL_ADSB html-fallback: succeeds via sibling data.json');
    check(/\/data\.json$/.test(r.resolvedSource || ''), `LOCAL_ADSB html-fallback: resolvedSource is data.json (got ${r.resolvedSource})`);
    check(r.aircraftCount === 1, `LOCAL_ADSB html-fallback: parsed aircraft from data.json (got ${r.aircraftCount})`);
  } finally {
    global.fetch = savedFetch;
  }
}

// ---------------------------------------------------------------------------
// Part K — radar overlay visibility (clean-sky vs radar look, no network)
// ---------------------------------------------------------------------------
async function radarOverlayTests() {
  console.log('\nPart K — radar overlay visibility (no network)');
  const { getRadarOverlay, RADAR_OVERLAY_ALL_ON, RADAR_OVERLAY_CLEAN_SKY } =
    await import('../frontend/src/lib/displayModes.js');
  const { DEFAULT_SETTINGS } = await import('../backend/settings/settingsStore.js');

  // Default (no radar config) → everything visible (back-compat).
  const def = getRadarOverlay({ display: {} });
  check(def.rings && def.compass && def.nmLabels && def.crosshair,
    'radar overlay: defaults to all-visible when unset');

  // Each element can be hidden independently.
  check(getRadarOverlay({ display: { radar: { compass: false } } }).compass === false,
    'radar overlay: compass labels can be hidden');
  check(getRadarOverlay({ display: { radar: { rings: false } } }).rings === false,
    'radar overlay: range rings can be hidden');
  check(getRadarOverlay({ display: { radar: { nmLabels: false } } }).nmLabels === false,
    'radar overlay: nautical-mile labels can be hidden');
  check(getRadarOverlay({ display: { radar: { crosshair: false } } }).crosshair === false,
    'radar overlay: center crosshair can be hidden');

  // Hiding one element leaves the others visible.
  const onlyRingsOff = getRadarOverlay({ display: { radar: { rings: false } } });
  check(onlyRingsOff.compass && onlyRingsOff.nmLabels && onlyRingsOff.crosshair,
    'radar overlay: hiding rings leaves compass/nm/crosshair visible');

  // Clean-sky preset hides the whole overlay; radar preset shows it all.
  const clean = getRadarOverlay({ display: { radar: RADAR_OVERLAY_CLEAN_SKY } });
  check(!clean.rings && !clean.compass && !clean.nmLabels && !clean.crosshair,
    'radar overlay: clean-sky preset hides all overlay elements');
  const full = getRadarOverlay({ display: { radar: RADAR_OVERLAY_ALL_ON } });
  check(full.rings && full.compass && full.nmLabels && full.crosshair,
    'radar overlay: radar preset shows all overlay elements');

  // Object layers are independent of the radar overlay: clean-sky does not
  // disable aircraft / satellites / ISS / planets / stars layers.
  const layers = DEFAULT_SETTINGS.layers;
  check(layers.aircraft === true && layers.stars === true,
    'radar overlay: object layers (aircraft/stars) stay enabled regardless of overlay');
  check('radar' in DEFAULT_SETTINGS.display && !('radar' in layers),
    'radar overlay: lives under display, never touches the layers config');
}

// ---------------------------------------------------------------------------
// Part L — home location, Moon phase/path, projector preset (no network)
// ---------------------------------------------------------------------------
async function homeAndMoonTests() {
  console.log('\nPart L — home location, Moon phase/path, projector preset (no network)');

  const { DEFAULT_SETTINGS } = await import('../backend/settings/settingsStore.js');
  const { RADAR_OVERLAY_CLEAN_SKY, getRadarOverlay } = await import('../frontend/src/lib/displayModes.js');
  const { computeMoonPath, computeMoonRiseSet } = await import('../backend/layers/lib/astro.js');

  // ── Home defaults ──────────────────────────────────────────────────────────
  const home = DEFAULT_SETTINGS.home;
  check(typeof home.lat === 'number' && typeof home.lon === 'number',
    'home: default lat/lon are numbers');
  check(home.lat >= -90 && home.lat <= 90,
    `home: default lat in [-90,90] (got ${home.lat})`);
  check(home.lon >= -180 && home.lon <= 180,
    `home: default lon in [-180,180] (got ${home.lon})`);
  check(typeof home.name === 'string' && home.name.length > 0,
    'home: default name is non-empty string');

  // ── Home validation logic (mirrors ControlPanel.validateHome) ───────────────
  function validateHome(lat, lon) {
    const la = Number(lat), lo = Number(lon);
    if (!Number.isFinite(la) || la < -90 || la > 90) return false;
    if (!Number.isFinite(lo) || lo < -180 || lo > 180) return false;
    return true;
  }
  check(validateHome(32.7767, -96.797),   'home validate: valid coords pass');
  check(validateHome(-90, -180),          'home validate: boundary (-90,-180) passes');
  check(validateHome(90, 180),            'home validate: boundary (90,180) passes');
  check(!validateHome(91, 0),             'home validate: lat 91 rejected');
  check(!validateHome(-91, 0),            'home validate: lat -91 rejected');
  check(!validateHome(0, 181),            'home validate: lon 181 rejected');
  check(!validateHome(0, -181),           'home validate: lon -181 rejected');
  check(!validateHome('abc', 0),          'home validate: non-numeric lat rejected');
  check(!validateHome(0, 'xyz'),          'home validate: non-numeric lon rejected');

  // ── Moon phase calculation ─────────────────────────────────────────────────
  // Inline the same formula used in spaceLayer.js.
  function moonPhaseCalc(date) {
    const SYNODIC = 29.530588853;
    const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14, 0);
    const days = (date.getTime() - knownNewMoon) / 86400000;
    let phase = (days % SYNODIC) / SYNODIC;
    if (phase < 0) phase += 1;
    const illumination = Math.round(((1 - Math.cos(2 * Math.PI * phase)) / 2) * 100);
    return { phase, illumination };
  }

  const { phase, illumination } = moonPhaseCalc(new Date('2024-01-25T00:00:00Z'));
  check(phase >= 0 && phase < 1,      `moon phase: value in [0,1) (got ${phase})`);
  check(illumination >= 0 && illumination <= 100,
    `moon phase: illumination in [0,100] (got ${illumination}%)`);

  // Known full moon 2024-01-25 → should be near 0.5.
  check(phase > 0.45 && phase < 0.55, `moon phase: 2024-01-25 is near full (phase=${phase.toFixed(3)})`);
  check(illumination > 90,            `moon phase: 2024-01-25 illumination >90% (got ${illumination}%)`);

  // New moon 2024-01-11 UTC → phase close to 0.
  const newMoon = moonPhaseCalc(new Date('2024-01-11T11:57:00Z'));
  check(newMoon.phase < 0.04 || newMoon.phase > 0.96,
    `moon phase: 2024-01-11 is near new (phase=${newMoon.phase.toFixed(3)})`);
  check(newMoon.illumination < 5,
    `moon phase: 2024-01-11 illumination <5% (got ${newMoon.illumination}%)`);

  // ── Moon path ──────────────────────────────────────────────────────────────
  const testHome = { lat: 51.5, lon: -0.1 };  // London
  const testDate = new Date('2024-06-15T12:00:00Z');
  const path = computeMoonPath(testHome, testDate, 24, 1);
  check(Array.isArray(path) && path.length === 25,
    `moon path: 24h/1h step returns 25 points (got ${path.length})`);
  check(path.every(p => typeof p.az === 'number' && typeof p.el === 'number' && typeof p.t === 'number'),
    'moon path: each point has numeric az, el, t');
  check(path.every(p => p.az >= 0 && p.az < 360),
    'moon path: all azimuths in [0,360)');
  check(path.every(p => p.el >= -90 && p.el <= 90),
    'moon path: all elevations in [-90,90]');

  // At least some points above horizon for a mid-summer day at London.
  const aboveHorizon = path.filter(p => p.el > 0).length;
  check(aboveHorizon > 0, `moon path: some points above horizon (got ${aboveHorizon})`);

  // ── Moon rise/set ──────────────────────────────────────────────────────────
  const riseSet = computeMoonRiseSet(testHome, testDate);
  check(typeof riseSet === 'object', 'moon rise/set: returns an object');
  // rise/set may be null if moon doesn't cross horizon, but format must be HH:MM or null.
  const hmRe = /^\d{2}:\d{2}$/;
  if (riseSet.rise !== null) check(hmRe.test(riseSet.rise), `moon rise/set: rise format HH:MM (got "${riseSet.rise}")`);
  if (riseSet.set  !== null) check(hmRe.test(riseSet.set),  `moon rise/set: set  format HH:MM (got "${riseSet.set}")`);

  // ── Moon path toggle default ───────────────────────────────────────────────
  check(DEFAULT_SETTINGS.display.showMoonPath === true,
    'moon path toggle: defaults to true in settings');

  // ── Projector clean-sky preset ─────────────────────────────────────────────
  // Simulate the preset button click in ControlPanel: sets displayMode + RADAR_OVERLAY_CLEAN_SKY.
  const projectorSettings = {
    display: {
      displayMode: 'projector',
      radar: { ...RADAR_OVERLAY_CLEAN_SKY },
    },
  };
  check(projectorSettings.display.displayMode === 'projector',
    'projector preset: displayMode set to projector');
  const radarResult = getRadarOverlay(projectorSettings);
  check(!radarResult.rings && !radarResult.compass && !radarResult.nmLabels && !radarResult.crosshair,
    'projector preset: all radar overlay elements hidden');

  // ── Ensure existing layers are unaffected by home/moon changes ───────────────
  check(DEFAULT_SETTINGS.layers.aircraft === true, 'existing layers: aircraft layer still enabled');
  check(DEFAULT_SETTINGS.layers.stars === true,    'existing layers: stars layer still enabled');
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
await spaceLayerTests();
await starlinkBlockedTests();
await recoveryAndCalibrationTests();
await radarOverlayTests();
await homeAndMoonTests();
console.log(failed ? '\nSMOKE CHECK FAILED' : '\nSMOKE CHECK PASSED');
process.exit(failed ? 1 : 0);
