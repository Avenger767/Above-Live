// Above Live — LOCAL_ADSB provider (dump1090 / readsb aircraft.json).
//
// Reads decoded aircraft from a local dump1090/readsb feed. Above Live does NOT
// decode raw radio — you run dump1090-fa / readsb (or tar1090) and point this at
// the small aircraft.json it serves.
//
// Two sources, in priority order:
//   1. HTTP URL   (settings.localAdsb.url)   — e.g. http://localhost:8080/data.json
//   2. File path  (settings.localAdsb.path)  — e.g. /run/dump1090-fa/aircraft.json
// URL wins if both are set. If neither is set, it reports "not configured".
//
// Supported JSON shapes:
//   A. Root-level array — older Windows dump1090 data.json:
//        [ { "hex": "abc123", "flight": "SWA55", "lat": …, "lon": …, … }, … ]
//   B. Wrapped object — modern dump1090-fa / readsb / tar1090 aircraft.json:
//        { "now": …, "aircraft": [ … ] }    ← preferred key "aircraft"
//        { "ac": [ … ] }                    ← alternate key used by some builds
//
// Common older field names are accepted alongside the modern ones:
//   hex / icao        → id
//   flight            → callsign (trimmed)
//   altitude          → altitude (numeric; "ground" coerced to 0)
//   track             → heading
//   speed             → speed (alongside gs / groundspeed)
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

  let cache         = null;   // last good normalized aircraft array
  let lastRawCount  = 0;      // raw item count from the last successful read
  let lastFormat    = null;   // 'dump1090-array' | 'readsb-aircraft' | 'unknown'
  let lastSuccess   = 0;      // ts of last successful read
  let lastError     = null;   // last error message
  let lastResolvedUrl = null; // URL actually used (may differ if we auto-found data.json)

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

  // Detect which JSON shape the feed uses and extract the raw aircraft array.
  // Returns { list: Array, format: string }.
  function extractList(data) {
    // Shape A — root-level array (older Windows dump1090 data.json).
    if (Array.isArray(data)) {
      return { list: data, format: 'dump1090-array' };
    }
    // Shape B — wrapped object with "aircraft" or "ac" key (modern dump1090-fa / readsb).
    if (data && typeof data === 'object') {
      const list = Array.isArray(data.aircraft) ? data.aircraft
                 : Array.isArray(data.ac)       ? data.ac
                 : null;
      if (list) return { list, format: 'readsb-aircraft' };
    }
    return { list: [], format: 'unknown' };
  }

  // Pre-process raw items before handing them to the normalizer.
  // Handles the on-ground flag and coerces the "ground" string to 0 for both
  // alt_baro (modern) and altitude (older dump1090).
  function preprocess(raw) {
    const altIsGround = raw.alt_baro === 'ground'
      || String(raw.altitude).toLowerCase() === 'ground';
    return {
      ...raw,
      onGround: raw.onGround === true || raw.ground === true || altIsGround,
      alt_baro: raw.alt_baro === 'ground' ? 0 : raw.alt_baro,
      altitude: altIsGround ? 0 : raw.altitude,
    };
  }

  // Fetch + JSON-parse one URL. Flags an HTML response (wrong endpoint, e.g. a
  // directory listing or tar1090 page) with err.html so the caller can try the
  // sibling "data.json" automatically.
  async function fetchJsonUrl(url) {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const text = await res.text();
    const looksHtml = ct.includes('text/html') || /^\s*</.test(text);
    if (looksHtml) {
      const err = new Error(`got HTML (not JSON) from ${url}`);
      err.html = true;
      throw err;
    }
    try {
      return JSON.parse(text);
    } catch {
      const err = new Error(`invalid JSON from ${url}`);
      err.html = true; // most likely pointed at the wrong endpoint
      throw err;
    }
  }

  // Derive a sibling ".../data.json" candidate from a URL that returned HTML.
  // e.g. http://host:8080/ → http://host:8080/data.json
  //      http://host:8080/tar1090/ → http://host:8080/tar1090/data.json
  // Returns null when the URL already ends in data.json (nothing to try).
  function dataJsonCandidate(url) {
    try {
      const u = new URL(url);
      if (/\/data\.json$/i.test(u.pathname)) return null;
      u.search = '';
      u.hash = '';
      u.pathname = u.pathname.replace(/\/[^/]*$/, '') + '/data.json';
      return u.toString();
    } catch {
      return null;
    }
  }

  // Read + parse the raw feed from the resolved source.
  // Returns { list: preprocessedArray, format }.  Throws on any failure.
  async function readRaw(src) {
    let data;
    if (src.type === 'file') {
      const text = await readFile(src.value, 'utf8');
      data = JSON.parse(text);
      lastResolvedUrl = null;
    } else if (src.type === 'url') {
      try {
        data = await fetchJsonUrl(src.value);
        lastResolvedUrl = src.value;
      } catch (err) {
        // If the configured URL served HTML, auto-detect the sibling data.json.
        const candidate = err.html ? dataJsonCandidate(src.value) : null;
        if (candidate) {
          data = await fetchJsonUrl(candidate); // may throw — surfaced as-is
          lastResolvedUrl = candidate;
          console.warn(`[local_adsb] ${src.value} returned HTML — using ${candidate} instead`);
        } else {
          throw err;
        }
      }
    } else {
      throw new Error('LOCAL_ADSB not configured (set LOCAL_ADSB_URL or LOCAL_ADSB_PATH)');
    }

    const { list, format } = extractList(data);
    return { list: list.map(preprocess), format };
  }

  // One read that updates cache/state. Returns normalized aircraft.
  async function readAndNormalize(s) {
    const src = resolveSource(s);
    const { list, format } = await readRaw(src);
    lastRawCount = list.length;
    lastFormat   = format;
    const aircraft = normalizeList(list, name, s.home); // drops records w/o lat/lon
    cache       = aircraft;
    lastSuccess = Date.now();
    lastError   = null;
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
      configured:        src.type !== 'none',
      sourceType:        src.type, // 'url' | 'file' | 'none'
      source:            src.value || null,
      resolvedSource:    lastResolvedUrl || src.value || null, // URL actually used
      rawAircraftCount:  lastRawCount,   // items received before normalizer filtering
      aircraftCount:     cache ? cache.length : 0,
      detectedFormat:    lastFormat,
      lastSuccess:       lastSuccess || null,
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
        rawCount: 0,
        aircraftCount: 0,
        normalizedCount: 0,
        detectedFormat: null,
        sampleNormalized: [],
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
        resolvedSource: lastResolvedUrl || src.value,
        rawCount: lastRawCount,
        aircraftCount: aircraft.length,
        normalizedCount: aircraft.length,
        detectedFormat: lastFormat,
        sampleNormalized: aircraft.slice(0, 3),
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
        resolvedSource: lastResolvedUrl || src.value,
        rawCount: lastRawCount,
        aircraftCount: cache ? cache.length : 0,
        normalizedCount: cache ? cache.length : 0,
        detectedFormat: lastFormat,
        sampleNormalized: cache ? cache.slice(0, 3) : [],
        sample: cache ? cache.slice(0, 3) : [],
        error: err.message,
      };
    }
  }

  return { name, fetchAircraft, getMeta, test };
}
