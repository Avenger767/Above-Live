// Above Live — API provider (Airplanes.live adapter, with caching + backoff).
//
// This is the ONLY place that talks to the external flight API. It is stateful:
//   - It fetches from the API at most once per `api.pollIntervalMs` (default 30s).
//   - Between fetches it serves the last successful aircraft from an in-memory
//     cache, so the 1 Hz poll/WebSocket loop never triggers an external call.
//   - On HTTP 429 it enters a backoff (default 60s) and stops calling the API,
//     while continuing to serve the cached aircraft.
//   - It only "fails" (so the manager falls back to MOCK) when there is NO
//     cached data at all.
//
// Defaults target Airplanes.live's free point endpoint:
//   https://api.airplanes.live/v2/point/{lat}/{lon}/{radiusNm}
// To use a different API, change DEFAULT_BASE / buildUrl() and the line in
// doRequest() that picks the aircraft array out of the response.

import { normalizeList } from '../aircraftNormalizer.js';

const DEFAULT_BASE = 'https://api.airplanes.live/v2';

export function createApiProvider() {
  const name = 'api';

  // --- Internal cache + timing state (centralized) ---
  let cache = null; // last successful normalized aircraft array
  let lastSuccess = 0; // ts of last successful fetch
  let lastAttempt = 0; // ts of last fetch attempt (success or fail)
  let lastError = null; // last error message
  let rateLimitedUntil = 0; // ts before which we must not call the API
  let refreshing = null; // in-flight refresh promise (dedupes concurrent calls)

  // --- Config helpers ---
  function baseUrl(s) {
    const b = (s?.api?.baseUrl || '').trim();
    return (b || DEFAULT_BASE).replace(/\/+$/, '');
  }
  function pollIntervalMs(s) {
    const v = Number(s?.api?.pollIntervalMs);
    return Number.isFinite(v) && v > 0 ? v : 30000;
  }
  function backoffMs(s) {
    const v = Number(s?.api?.rateLimitBackoffMs);
    return Number.isFinite(v) && v > 0 ? v : 60000;
  }
  function adapterName(s) {
    try {
      return new URL(baseUrl(s)).host;
    } catch {
      return 'api';
    }
  }

  function buildUrl(s) {
    const { lat, lon } = s.home;
    const radius = Math.min(250, Math.max(1, Math.round(s.rangeNm || 60)));
    // Airplanes.live point query: aircraft within `radius` nm of lat/lon.
    return `${baseUrl(s)}/point/${lat}/${lon}/${radius}`;
  }

  // The single external request. Throws err.rateLimited on HTTP 429.
  async function doRequest(s) {
    const url = buildUrl(s);
    const headers = { Accept: 'application/json', 'User-Agent': 'Above-Live/1.0' };
    // Optional bearer auth for APIs that need a key (Airplanes.live does not).
    if (s?.api?.apiKey) headers.Authorization = `Bearer ${s.api.apiKey}`;

    const res = await fetch(url, { headers });
    if (res.status === 429) {
      const err = new Error('HTTP 429 (rate limited by API)');
      err.rateLimited = true;
      throw err;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);

    const data = await res.json();
    // Airplanes.live / readsb put the array under "ac". Fall back to other
    // common shapes so this also tolerates similar APIs.
    const rawList = (data.ac || data.aircraft || data.states || (Array.isArray(data) ? data : [])).map(
      (a) => ({ ...a, alt_baro: a.alt_baro === 'ground' ? 0 : a.alt_baro })
    );
    return normalizeList(rawList, name, s.home);
  }

  // Is an external fetch due right now? Bounds external calls to <= 1 per
  // pollInterval and never fetches while rate-limited.
  function refreshDue(now, s) {
    if (now < rateLimitedUntil) return false; // in backoff
    if (lastAttempt === 0) return true; // first run
    return now - lastAttempt >= pollIntervalMs(s);
  }

  // Refresh the cache if due. Safe to call every tick; dedupes and rate-gates
  // internally. Never throws (errors are recorded in state).
  function maybeRefresh(s) {
    const now = Date.now();
    if (refreshing) return refreshing;
    if (!refreshDue(now, s)) return Promise.resolve();
    refreshing = (async () => {
      lastAttempt = Date.now();
      try {
        const ac = await doRequest(s);
        cache = ac;
        lastSuccess = Date.now();
        lastError = null;
        rateLimitedUntil = 0;
      } catch (err) {
        lastError = err.message;
        if (err.rateLimited) {
          rateLimitedUntil = Date.now() + backoffMs(s);
          console.warn(
            `[api] rate limited — backing off ${Math.round(backoffMs(s) / 1000)}s ` +
              `(serving ${cache ? cache.length + ' cached' : 'no cached'} aircraft)`
          );
        } else {
          console.warn(`[api] fetch failed: ${err.message}`);
        }
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  // Called by the poll loop every tick. Cheap: returns cached aircraft and only
  // triggers a background external fetch when one is due. Throws ONLY when there
  // is no cached data, so the manager can fall back to MOCK in that case.
  async function fetchAircraft(s) {
    if (!cache) {
      // No cache yet (startup / just switched to API): fill it now.
      await maybeRefresh(s);
    } else {
      // Have data: refresh in the background, never blocking the 1 Hz loop.
      maybeRefresh(s);
    }
    if (cache) return cache;
    const err = new Error(lastError || 'No API data available yet');
    err.noCache = true;
    throw err;
  }

  // Force the next tick to re-fetch (e.g. home/range changed). Keeps existing
  // cache visible until fresh data arrives, and respects active backoff.
  function invalidate() {
    lastAttempt = 0;
  }

  // Introspection for /api/status.
  function getMeta(s) {
    const now = Date.now();
    return {
      adapter: adapterName(s),
      configured: true, // Airplanes.live needs no key; a usable endpoint always exists
      hasCache: Boolean(cache),
      aircraftCount: cache ? cache.length : 0,
      lastSuccess: lastSuccess || null,
      lastError,
      rateLimited: now < rateLimitedUntil,
      nextRetry: now < rateLimitedUntil ? rateLimitedUntil : null,
      // "cached" = we are serving data older than one poll interval (i.e. a
      // refresh is overdue — typically during backoff or repeated failures).
      cached: Boolean(cache) && now - lastSuccess > pollIntervalMs(s) + 2000,
      pollIntervalMs: pollIntervalMs(s),
      backoffMs: backoffMs(s),
    };
  }

  // One manual test request for /api/provider-test. If recently rate-limited it
  // does NOT contact the API (so it can't make throttling worse); it warns and
  // returns cached info instead. On a real request it also refreshes the shared
  // cache, so it doubles as that cycle's poll rather than interfering with it.
  async function test(s) {
    const now = Date.now();
    const adapter = adapterName(s);

    if (now < rateLimitedUntil) {
      return {
        success: Boolean(cache),
        adapter,
        configured: true,
        aircraftCount: cache ? cache.length : 0,
        usingCache: true,
        lastSuccess: lastSuccess || null,
        lastError,
        nextRetry: rateLimitedUntil,
        warning: `Recently rate-limited; not contacting ${adapter}. Retry after ${new Date(
          rateLimitedUntil
        ).toISOString()}.`,
      };
    }

    try {
      const ac = await doRequest(s);
      cache = ac;
      lastSuccess = Date.now();
      lastAttempt = Date.now();
      lastError = null;
      rateLimitedUntil = 0;
      return {
        success: true,
        adapter,
        configured: true,
        aircraftCount: ac.length,
        usingCache: false,
        lastSuccess,
        lastError: null,
        nextRetry: null,
      };
    } catch (err) {
      lastError = err.message;
      lastAttempt = Date.now();
      if (err.rateLimited) rateLimitedUntil = Date.now() + backoffMs(s);
      return {
        success: Boolean(cache),
        adapter,
        configured: true,
        aircraftCount: cache ? cache.length : 0,
        usingCache: Boolean(cache),
        lastSuccess: lastSuccess || null,
        lastError,
        nextRetry: rateLimitedUntil > Date.now() ? rateLimitedUntil : null,
      };
    }
  }

  return { name, fetchAircraft, getMeta, test, invalidate };
}
