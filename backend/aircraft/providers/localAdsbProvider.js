// Above Live — LOCAL_ADSB provider (dump1090 / readsb aircraft.json).
//
// Reads decoded aircraft from a local dump1090/readsb feed. Above Live does NOT
// decode raw radio — you run dump1090-fa / readsb (or tar1090) and point this at
// the small aircraft.json it serves.
//
// Two sources, in priority order:
//   1. HTTP URL   (settings.localAdsb.url)   — e.g. http://localhost:8080/data/aircraft.json
//   2. File path  (settings.localAdsb.path)  — e.g. /run/dump1090-fa/aircraft.json
// URL wins if both are set. If neither is set, it reports "not configured".
//
// It is stateful (like the API provider): it caches the last good snapshot and
// keeps serving it for a short staleness window if a read fails, so a single
// dropped poll doesn't flap the display down to MOCK. Only when there is no
// usable cache (or the cache is too old) does fetchAircraft throw, letting the
// server fall back to MOCK.

import { readFile } from 'node:fs/promises';
import { normalizeList } from '../aircraftNormalizer.js';

// How long a cached snapshot stays "good enough" to show after a failed read.
const DEFAULT_STALE_MS = 15000;

export function createLocalAdsbProvider() {
  const name = 'local_adsb';

  let cache = null; // last good normalized aircraft array
  let lastSuccess = 0; // ts of last successful read
  let lastError = null; // last error message

  // Resolve which source to use from settings. URL takes priority over file.
  function resolveSource(s) {
    const url = (s?.localAdsb?.url || '').trim();
    // Accept both "path" and "file" as the on-disk option.
    const path = (s?.localAdsb?.path || s?.localAdsb?.file || '').trim();
    if (url) return { type: 'url', value: url };
    if (path) return { type: 'file', value: path };
    return { type: 'none', value: '' };
  }

  function staleMs(s) {
    const v = Number(s?.localAdsb?.pollIntervalMs);
    // Tolerate up to ~15× the poll interval, but never less than the default.
    return Math.max(DEFAULT_STALE_MS, Number.isFinite(v) && v > 0 ? v * 15 : 0);
  }

  // Read + parse the raw feed from the resolved source. Throws on any failure.
  async function readRaw(src) {
    let data;
    if (src.type === 'file') {
      const text = await readFile(src.value, 'utf8');
      data = JSON.parse(text);
    } else if (src.type === 'url') {
      const res = await fetch(src.value, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${src.value}`);
      data = await res.json();
    } else {
      throw new Error('LOCAL_ADSB not configured (set LOCAL_ADSB_URL or LOCAL_ADSB_PATH)');
    }
    // dump1090/readsb put aircraft under "aircraft"; tolerate "ac" too.
    // alt_baro can be the string "ground"; coerce it to 0.
    const list = data.aircraft || data.ac || [];
    return list.map((a) => ({
      ...a,
      // Capture on-ground before "ground" is coerced to 0 (see normalizer).
      onGround: a.onGround === true || a.ground === true || a.alt_baro === 'ground',
      alt_baro: a.alt_baro === 'ground' ? 0 : a.alt_baro,
    }));
  }

  // One read that updates cache/state. Returns normalized aircraft.
  async function readAndNormalize(s) {
    const src = resolveSource(s);
    const rawList = await readRaw(src);
    const aircraft = normalizeList(rawList, name, s.home); // drops records w/o lat/lon
    cache = aircraft;
    lastSuccess = Date.now();
    lastError = null;
    return aircraft;
  }

  // Poll-loop entry point. Reads fresh data; on failure, briefly serves the last
  // good cache; throws (→ MOCK fallback) only when there's no usable cache.
  async function fetchAircraft(s) {
    try {
      return await readAndNormalize(s);
    } catch (err) {
      lastError = err.message;
      const fresh = cache && Date.now() - lastSuccess <= staleMs(s);
      if (fresh) {
        console.warn(`[local_adsb] read failed (${err.message}) — serving ${cache.length} cached`);
        return cache;
      }
      throw err; // no cache (or too old): let the server fall back to MOCK
    }
  }

  // Status info for /api/status.
  function getMeta(s) {
    const src = resolveSource(s);
    const usingCache = Boolean(cache) && Date.now() - lastSuccess > 2500;
    return {
      configured: src.type !== 'none',
      sourceType: src.type, // 'url' | 'file' | 'none'
      source: src.value || null,
      aircraftCount: cache ? cache.length : 0,
      lastSuccess: lastSuccess || null,
      lastError,
      usingCache,
    };
  }

  // One-shot manual test for /api/provider-test.
  async function test(s) {
    const src = resolveSource(s);
    if (src.type === 'none') {
      return {
        success: false,
        provider: 'LOCAL_ADSB',
        configured: false,
        sourceType: 'none',
        source: null,
        aircraftCount: 0,
        sample: [],
        error: 'LOCAL_ADSB not configured (set LOCAL_ADSB_URL or LOCAL_ADSB_PATH)',
      };
    }
    try {
      const aircraft = await readAndNormalize(s);
      return {
        success: true,
        provider: 'LOCAL_ADSB',
        configured: true,
        sourceType: src.type,
        source: src.value,
        aircraftCount: aircraft.length,
        sample: aircraft.slice(0, 3),
        error: null,
      };
    } catch (err) {
      lastError = err.message;
      return {
        success: false,
        provider: 'LOCAL_ADSB',
        configured: true,
        sourceType: src.type,
        source: src.value,
        aircraftCount: cache ? cache.length : 0,
        sample: cache ? cache.slice(0, 3) : [],
        error: err.message,
      };
    }
  }

  return { name, fetchAircraft, getMeta, test };
}
