// Above Live — API provider (Airplanes.live adapter, caching + rate-limit backoff).
//
// Guarantees:
//   1. External API is called at most once per pollIntervalMs (default 60 s).
//   2. The 1-Hz poll/WebSocket loop NEVER triggers an external call — it reads
//      from the in-memory cache.
//   3. On HTTP 429, back off for rateLimitBackoffMs (default 120 s) and continue
//      serving the cached aircraft.  Only throw (triggering MOCK fallback) when
//      there is NO cached data at all.
//   4. invalidate() debounces re-fetches by settingsDebounceMs (default 3 s) so
//      rapid UI setting changes (range/home slider) are coalesced into a single
//      re-fetch after they settle — NOT one fetch per save.
//
// Log prefixes (always on, one line each):
//   [api] FETCH  → url        — external call starting
//   [api] DONE   ← N aircraft — successful response
//   [api] RATE   429 + backoffSecs — rate-limited; duration logged once
//   [api] INVAL  debounce Xs  — settings changed; next fetch delayed
//   [api] ERROR  message      — non-429 failure

import { normalizeList } from '../aircraftNormalizer.js';

const DEFAULT_BASE        = 'https://api.airplanes.live/v2';
const DEFAULT_POLL_MS     = 60_000;   // 60 s between external fetches
const DEFAULT_BACKOFF_MS  = 120_000;  // 2 min after 429
const DEFAULT_DEBOUNCE_MS = 3_000;    // wait after settings change before re-fetch

export function createApiProvider() {
  const name = 'api';

  // ── state ──────────────────────────────────────────────────────────────────
  let cache            = null;  // last successful normalized aircraft array
  let cacheKey         = '';    // settings fingerprint for the cached data
  let lastSuccess      = 0;     // ts of last successful external fetch
  let lastAttempt      = 0;     // ts of last external fetch attempt
  let lastError        = null;  // last error message
  let rateLimitedUntil = 0;     // don't call API before this timestamp
  let nextFetchDue     = 0;     // earliest fetch allowed after invalidate debounce
  let refreshing       = null;  // in-flight fetch promise (deduplication)
  let externalFetchCount = 0;
  let cacheHitCount    = 0;

  // ── settings helpers ───────────────────────────────────────────────────────
  const cfgPollMs     = (s) => { const v = Number(s?.api?.pollIntervalMs);     return v > 0 ? v : DEFAULT_POLL_MS;     };
  const cfgBackoffMs  = (s) => { const v = Number(s?.api?.rateLimitBackoffMs); return v > 0 ? v : DEFAULT_BACKOFF_MS;  };
  const cfgDebounceMs = (s) => { const v = Number(s?.api?.settingsDebounceMs); return v > 0 ? v : DEFAULT_DEBOUNCE_MS; };

  function getBaseUrl(s) {
    return ((s?.api?.baseUrl || '').trim() || DEFAULT_BASE).replace(/\/+$/, '');
  }
  function adapterName(s) {
    try { return new URL(getBaseUrl(s)).host; } catch { return 'api'; }
  }
  function buildUrl(s) {
    const { lat, lon } = s.home;
    const radius = Math.min(250, Math.max(1, Math.round(s.rangeNm || 60)));
    return `${getBaseUrl(s)}/point/${lat}/${lon}/${radius}`;
  }
  function makeKey(s) {
    return `${s?.home?.lat},${s?.home?.lon},${s?.rangeNm || 60},${getBaseUrl(s)}`;
  }

  // ── refresh-due gate ───────────────────────────────────────────────────────
  function refreshDue(now, s) {
    if (now < rateLimitedUntil) return false;  // inside backoff window
    if (nextFetchDue > 0) {
      if (now < nextFetchDue) return false;    // debounce still active
      nextFetchDue = 0;                        // debounce elapsed → fire once
      return true;
    }
    if (lastAttempt === 0) return true;        // very first run
    return now - lastAttempt >= cfgPollMs(s); // normal interval
  }

  // ── single external request ────────────────────────────────────────────────
  async function doRequest(s) {
    const url = buildUrl(s);
    const headers = { Accept: 'application/json', 'User-Agent': 'Above-Live/1.0' };
    if (s?.api?.apiKey) headers.Authorization = `Bearer ${s.api.apiKey}`;

    console.log(`[api] FETCH  → ${url}`);
    externalFetchCount++;

    const res = await fetch(url, { headers });
    if (res.status === 429) {
      const err = new Error('HTTP 429 (rate limited by API)');
      err.rateLimited = true;
      throw err;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);

    const data = await res.json();
    const rawList = (
      data.ac || data.aircraft || data.states || (Array.isArray(data) ? data : [])
    ).map((a) => ({
      ...a,
      // Capture the on-ground state before coercing the "ground" string to 0,
      // otherwise the normalizer can't tell parked traffic from sea-level fixes.
      onGround: a.onGround === true || a.ground === true || a.alt_baro === 'ground',
      alt_baro: a.alt_baro === 'ground' ? 0 : a.alt_baro,
    }));
    return normalizeList(rawList, name, s.home);
  }

  // ── maybeRefresh (safe to call every tick) ─────────────────────────────────
  // Deduplicates concurrent calls, rate-gates via refreshDue, never throws.
  function maybeRefresh(s) {
    const now = Date.now();
    if (refreshing) return refreshing;          // in-flight: deduplicate
    if (!refreshDue(now, s)) return Promise.resolve(); // silent skip

    refreshing = (async () => {
      lastAttempt = Date.now();
      try {
        const ac = await doRequest(s);
        cache        = ac;
        cacheKey     = makeKey(s);
        lastSuccess  = Date.now();
        lastError    = null;
        rateLimitedUntil = 0;
        console.log(`[api] DONE   ← ${ac.length} aircraft`);
      } catch (err) {
        lastError = err.message;
        if (err.rateLimited) {
          const backoff = cfgBackoffMs(s);
          rateLimitedUntil = Date.now() + backoff;
          console.warn(
            `[api] RATE   429 — backing off ${Math.round(backoff / 1000)}s` +
            ` (${cache ? cache.length + ' cached ac' : 'no cache — MOCK fallback active'})`
          );
        } else {
          console.warn(`[api] ERROR  ${err.message}`);
        }
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  // ── public API ─────────────────────────────────────────────────────────────

  // Called by the poll loop every tick. Returns cached aircraft and triggers a
  // background refresh when one is due. Only throws (noCache) when cache is null,
  // so the manager falls back to MOCK only on cold-start failure.
  async function fetchAircraft(s) {
    if (!cache) {
      await maybeRefresh(s); // blocking on first run — need data before returning
    } else {
      cacheHitCount++;
      maybeRefresh(s); // background; never delays the 1-Hz poll loop
    }
    if (cache) return cache;
    const err = new Error(lastError || 'No API data available yet');
    err.noCache = true;
    throw err;
  }

  // Called when settings change (home, range, provider config). Uses a debounce
  // so rapid UI saves (range slider) are coalesced into a single re-fetch.
  // NEVER resets lastAttempt — that would bypass the rate gate.
  function invalidate(s) {
    const debounce = cfgDebounceMs(s);
    nextFetchDue = Date.now() + debounce;
    console.log(`[api] INVAL  settings changed — next fetch in ${Math.round(debounce / 1000)}s`);
  }

  function getMeta(s) {
    const now = Date.now();
    const rateLimited = now < rateLimitedUntil;
    const pollMs = cfgPollMs(s);
    const cacheAgeMs = cache && lastSuccess ? now - lastSuccess : null;

    // "using cached" = rate-limited, or data is older than the poll interval
    const usingCachedAircraft = Boolean(cache) &&
      (rateLimited || (lastAttempt > 0 && now - lastAttempt > pollMs + 5000));

    let nextAllowedFetch = null;
    if (rateLimited) {
      nextAllowedFetch = rateLimitedUntil;
    } else if (nextFetchDue > now) {
      nextAllowedFetch = nextFetchDue;
    } else if (lastAttempt > 0) {
      nextAllowedFetch = lastAttempt + pollMs;
    }

    return {
      adapter:              adapterName(s),
      configured:           true,
      hasCache:             Boolean(cache),
      aircraftCount:        cache ? cache.length : 0,
      lastFetchAttempt:     lastAttempt || null,
      lastSuccess:          lastSuccess || null,
      lastError,
      rateLimited,
      nextAllowedFetch,
      usingCachedAircraft,
      cacheAgeSeconds:      cacheAgeMs != null ? Math.round(cacheAgeMs / 1000) : null,
      currentCacheKey:      cacheKey || null,
      externalFetchCount,
      cacheHitCount,
      pollIntervalMs:       pollMs,
      backoffMs:            cfgBackoffMs(s),
      settingsDebounceMs:   cfgDebounceMs(s),
      // Legacy names kept for smoke-check / StatusPanel compat
      cached:               Boolean(cache) && now - lastSuccess > pollMs + 2000,
      nextRetry:            rateLimited ? rateLimitedUntil : null,
    };
  }

  // Manual one-shot test for /api/provider-test.
  // Respects backoff by default; force=true bypasses it (debug only).
  async function test(s, { force = false } = {}) {
    const now = Date.now();
    const adapter = adapterName(s);

    if (!force && now < rateLimitedUntil) {
      return {
        success: Boolean(cache),
        adapter, configured: true,
        aircraftCount: cache ? cache.length : 0,
        usingCache: true,
        rateLimited: true,
        lastSuccess: lastSuccess || null, lastError,
        nextRetry: rateLimitedUntil,
        warning: `Rate-limited. Not contacting ${adapter}. Add ?force=true to override (use sparingly).`,
      };
    }

    try {
      const ac = await doRequest(s);
      cache = ac; cacheKey = makeKey(s);
      lastSuccess = Date.now(); lastAttempt = Date.now();
      lastError = null; rateLimitedUntil = 0;
      console.log(`[api] TEST   OK — ${ac.length} aircraft`);
      return { success: true, adapter, configured: true, aircraftCount: ac.length,
               usingCache: false, rateLimited: false, lastSuccess, lastError: null, nextRetry: null };
    } catch (err) {
      lastError = err.message; lastAttempt = Date.now();
      if (err.rateLimited) {
        rateLimitedUntil = Date.now() + cfgBackoffMs(s);
        console.warn(`[api] TEST   429 — backoff started`);
      }
      return { success: Boolean(cache), adapter, configured: true,
               aircraftCount: cache ? cache.length : 0,
               usingCache: Boolean(cache), rateLimited: err.rateLimited === true,
               lastSuccess: lastSuccess || null, lastError,
               nextRetry: rateLimitedUntil > Date.now() ? rateLimitedUntil : null };
    }
  }

  return { name, fetchAircraft, getMeta, test, invalidate };
}
