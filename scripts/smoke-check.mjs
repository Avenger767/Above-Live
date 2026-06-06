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
console.log(`Above Live — smoke check (port ${PORT})`);
await integrationTests();
await unitTests();
console.log(failed ? '\nSMOKE CHECK FAILED' : '\nSMOKE CHECK PASSED');
process.exit(failed ? 1 : 0);
