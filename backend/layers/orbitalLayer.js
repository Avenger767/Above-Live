// Above Live — orbital layer factory (ISS / satellites / Starlink).
//
// One generic, isolated layer that:
//   1. Downloads a CelesTrak TLE group (cached for hours — NEVER per poll), and
//   2. Propagates the cached elements locally on a slower cadence to current
//      sub-point lat/lon (see lib/orbital.js).
//
// Three layers are built from this factory (ISS, satellites, Starlink). Like the
// other optional layers it caches, backs off on error, caps the rendered count,
// and never throws into the aircraft path. No external call ever happens in the
// 1 Hz aircraft loop — the server's layer timer drives refresh(), and the TLE
// download is gated by a long TTL.

import { parseTleText, parseGpJson, propagateAll } from './lib/orbital.js';

// Modern CelesTrak GP endpoint. FORMAT=json is preferred; FORMAT=tle is the
// fallback. (Both parse to the same element shape — see lib/orbital.js.)
const CELESTRAK_GP = (group, format) =>
  `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=${format}`;

// CelesTrak returns HTTP 403 to agentless / generic clients. A descriptive
// User-Agent is the single most important fix for "Starlink won't connect".
const USER_AGENT = 'AboveLive/1.0 (Raspberry Pi sky display; +https://github.com/avenger767/above-live)';

// Fetch formats to try, in order, per layer. Starlink uses the modern GP JSON
// endpoint first with a TLE fallback; ISS/satellites keep their existing TLE
// behavior unchanged (guardrail: do not change ISS/satellite data sources).
const FORMATS = {
  starlink: ['json', 'tle'],
};
const formatsFor = (key) => FORMATS[key] || ['tle'];

// Sensible defaults per layer (overridable via settings[key]).
const DEFAULTS = {
  iss:        { group: 'stations', cap: 1,  satFilter: [25544], tleTtlMs: 6 * 3600_000, pollIntervalMs: 5000 },
  satellites: { group: 'visual',   cap: 60, satFilter: null,    tleTtlMs: 6 * 3600_000, pollIntervalMs: 5000 },
  // Starlink GP data updates ~every 2 h; refetch no more often than every 2 h.
  starlink:   { group: 'starlink', cap: 25, satFilter: null,    tleTtlMs: 2 * 3600_000, pollIntervalMs: 8000 },
};

// Backoff windows after a source error.
const BACKOFF_403_FIRST_MS    = 6 * 3600_000;   // first 403: back off 6 h
const BACKOFF_403_REPEATED_MS = 24 * 3600_000;  // repeated 403s: back off 24 h
const BACKOFF_429_MS          = 30 * 60_000;    // rate limited: 30 min
const BACKOFF_ERROR_MS        = 5 * 60_000;     // transient error: 5 min

export function createOrbitalLayer(key) {
  const name = key;
  const def = DEFAULTS[key] || DEFAULTS.satellites;

  // ── state ────────────────────────────────────────────────────────────────
  let elements = [];        // parsed TLE element sets (cached for hours)
  let tleFetchedAt = 0;     // ts of last successful TLE download
  let tleCount = 0;         // number of element sets currently cached
  let cache = [];           // last propagated, capped object list
  let lastSuccess = 0;      // ts of last successful propagate
  let lastError = null;     // last error message (fetch or parse)
  let backoffUntil = 0;     // don't re-attempt TLE download before this
  let lastPropagateAt = 0;
  let blocked = false;      // true when CelesTrak returned HTTP 403
  let blockedCount = 0;     // consecutive 403s (drives escalating backoff)
  let lastSourceUrl = CELESTRAK_GP(def.group, formatsFor(key)[0]); // most recent / intended source URL

  // ── settings helpers ───────────────────────────────────────────────────────
  const cfg = (s) => (s && s[key]) || {};
  const group = (s) => String(cfg(s).group || def.group);
  const cap = (s) => { const v = Number(cfg(s).cap); return Number.isFinite(v) && v > 0 ? v : def.cap; };
  const tleTtlMs = (s) => { const v = Number(cfg(s).tleTtlMs); return Number.isFinite(v) && v > 0 ? v : def.tleTtlMs; };
  const pollIntervalMs = (s) => { const v = Number(cfg(s).pollIntervalMs); return Number.isFinite(v) && v > 0 ? v : def.pollIntervalMs; };
  const satFilter = (s) => {
    const f = cfg(s).satFilter ?? def.satFilter;
    return Array.isArray(f) && f.length ? new Set(f.map(Number)) : null;
  };

  // ── Element download (rare) ─────────────────────────────────────────────────
  // Try each configured format in order (Starlink: JSON → TLE; others: TLE).
  // A 403/429 is a source-level signal and aborts immediately (no point trying
  // the next format against the same blocked source); other errors fall through
  // to the next format before giving up.
  async function fetchElements(s) {
    const formats = formatsFor(key);
    let lastErr = null;
    for (const fmt of formats) {
      const url = CELESTRAK_GP(group(s), fmt);
      lastSourceUrl = url;
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': USER_AGENT,
            Accept: fmt === 'json' ? 'application/json' : 'text/plain',
          },
          signal: AbortSignal.timeout(10000),
        });
        if (res.status === 403) {
          const err = new Error('Blocked by source (HTTP 403)');
          err.blocked = true;
          throw err;
        }
        if (res.status === 429) {
          const err = new Error('HTTP 429 (CelesTrak rate limited)');
          err.rateLimited = true;
          throw err;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status} from CelesTrak`);

        let parsed;
        if (fmt === 'json') {
          const data = await res.json();
          parsed = parseGpJson(data);
        } else {
          const text = await res.text();
          parsed = parseTleText(text);
        }
        if (parsed.length === 0) throw new Error(`CelesTrak returned no usable elements (${fmt})`);
        return parsed;
      } catch (err) {
        lastErr = err;
        // Source-level blocks/limits: stop, let the caller apply backoff.
        if (err.blocked || err.rateLimited) throw err;
        // Otherwise try the next format (if any).
      }
    }
    throw lastErr || new Error('No elements fetched');
  }

  // Ensure TLEs are present + fresh. Gated by TTL + backoff so it costs nothing
  // on the common path.
  async function ensureTle(s, now) {
    const fresh = elements.length > 0 && now - tleFetchedAt < tleTtlMs(s);
    if (fresh || now < backoffUntil) return;
    try {
      elements = await fetchElements(s);
      tleFetchedAt = Date.now();
      tleCount = elements.length;
      lastError = null;
      backoffUntil = 0;
      blocked = false;
      blockedCount = 0;
      console.log(`[${key}] elements refreshed — ${tleCount} objects (group ${group(s)})`);
    } catch (err) {
      lastError = err.message;
      if (err.blocked) {
        // HTTP 403: source blocked this group. Don't spam — back off 6 h on the
        // first 403, escalating to 24 h on repeated 403s. Cached data keeps
        // rendering meanwhile.
        blocked = true;
        blockedCount += 1;
        const ms = blockedCount >= 2 ? BACKOFF_403_REPEATED_MS : BACKOFF_403_FIRST_MS;
        backoffUntil = Date.now() + ms;
        console.warn(`[${key}] source blocked (HTTP 403, #${blockedCount}) — retrying in ${Math.round(ms / 3600_000)} h`);
      } else if (err.rateLimited) {
        backoffUntil = Date.now() + BACKOFF_429_MS;
        console.warn(`[${key}] fetch rate-limited: ${err.message} (keeping cached elements)`);
      } else {
        backoffUntil = Date.now() + BACKOFF_ERROR_MS;
        console.warn(`[${key}] fetch failed: ${err.message} (keeping cached elements)`);
      }
    }
  }

  // ── refresh (called by the server layer timer; never throws) ────────────────
  async function refresh(s) {
    const now = Date.now();
    await ensureTle(s, now);
    if (elements.length === 0) return; // nothing to propagate yet

    // Local propagation — cheap, no network. Cadence-gated so we don't recompute
    // every single poll if the timer is fast.
    if (now - lastPropagateAt < Math.min(pollIntervalMs(s), 2000) && cache.length) return;
    lastPropagateAt = now;

    const filter = satFilter(s);
    const els = filter ? elements.filter((e) => filter.has(Number(e.satnum))) : elements;
    let objs = propagateAll(els, new Date(), key);

    // Cap rendered count. For ISS this is 1; for satellites/Starlink keep the
    // nearest by sub-point distance to home so the cap shows relevant objects.
    if (objs.length > cap(s) && s?.home) {
      const { lat, lon } = s.home;
      objs.sort((a, b) => dist2(a, lat, lon) - dist2(b, lat, lon));
      objs = objs.slice(0, cap(s));
    } else if (objs.length > cap(s)) {
      objs = objs.slice(0, cap(s));
    }

    cache = objs;
    lastSuccess = now;
  }

  function getData() {
    return cache;
  }

  function getMeta(s) {
    const now = Date.now();
    return {
      enabled: Boolean(s?.layers?.[key]),
      group: group(s),
      ok: cache.length > 0,
      count: cache.length,                 // rendered objects (after cap)
      cap: cap(s),
      tleCount,                            // element sets cached
      tleAgeSeconds: tleFetchedAt ? Math.round((now - tleFetchedAt) / 1000) : null,
      cacheAgeSeconds: lastSuccess ? Math.round((now - lastSuccess) / 1000) : null,
      lastSuccess: lastSuccess || null,    // last propagate
      lastTleFetch: tleFetchedAt || null,
      lastError,
      blocked,                             // true when HTTP 403 received
      blockedCount,                        // consecutive 403s
      sourceUrl: lastSourceUrl,            // most recent / intended fetch URL
      nextRetry: backoffUntil || null,     // ts when a re-fetch is next allowed
      ttlMs: tleTtlMs(s),                  // minimum time between refetches
      pollIntervalMs: pollIntervalMs(s),
    };
  }

  function invalidate() {
    // Force an element re-fetch + reseed on the next refresh (e.g. group changed).
    elements = [];
    tleFetchedAt = 0;
    tleCount = 0;
    cache = [];
    backoffUntil = 0;
    lastPropagateAt = 0;
    blocked = false;
    blockedCount = 0;
  }

  // Manual one-shot test for /api/provider-test-style debugging.
  async function test(s) {
    try {
      const els = await fetchElements(s);
      elements = els;
      tleFetchedAt = Date.now();
      tleCount = els.length;
      const filter = satFilter(s);
      const filtered = filter ? els.filter((e) => filter.has(Number(e.satnum))) : els;
      const objs = propagateAll(filtered, new Date(), key).slice(0, cap(s));
      cache = objs;
      lastSuccess = Date.now();
      lastError = null;
      return { success: true, layer: key, group: group(s), tleCount: els.length, rendered: objs.length, sample: objs.slice(0, 3), error: null };
    } catch (err) {
      lastError = err.message;
      return { success: false, layer: key, group: group(s), tleCount, rendered: cache.length, sample: cache.slice(0, 3), error: err.message };
    }
  }

  return { name, refresh, getData, getMeta, invalidate, test };
}

// Squared sub-point distance (deg^2) — cheap proximity sort, no trig needed.
function dist2(o, lat, lon) {
  const dLat = o.lat - lat;
  let dLon = o.lon - lon;
  if (dLon > 180) dLon -= 360; else if (dLon < -180) dLon += 360;
  return dLat * dLat + dLon * dLon;
}
