// Above Live — Satellite / ISS layer (optional, OFF by default).
//
// Default provider "iss" fetches the ISS's current position from the free
// wheretheiss.at API (no key). Provider "mock" generates a couple of satellites
// drifting near home so the layer visibly does something offline / for demos.
//
// Like the weather layer, this is fully isolated: it caches, backs off on error,
// and never throws into the aircraft path. Satellites are returned as a list so
// more objects (Hubble, Starlink, named birds) can be added later.

import { advancePosition } from '../aircraft/aircraftMath.js';

const ISS_URL = 'https://api.wheretheiss.at/v1/satellites/25544';

export function createSatelliteLayer() {
  const name = 'satellites';

  let cache = []; // array of satellite objects
  let lastSuccess = 0;
  let lastAttempt = 0;
  let lastError = null;
  let backoffUntil = 0;

  // Mock satellite seed state (only used in provider==='mock').
  let mockSeeded = false;
  let mockSats = [];

  const provider = (s) => (s?.satellites?.provider || 'iss').toLowerCase();
  const pollIntervalMs = (s) => {
    const v = Number(s?.satellites?.pollIntervalMs);
    return Number.isFinite(v) && v > 0 ? v : 10000; // 10 s
  };

  function due(now, s) {
    if (now < backoffUntil) return false;
    if (lastAttempt === 0) return true;
    return now - lastAttempt >= pollIntervalMs(s);
  }

  async function fetchIss() {
    const res = await fetch(ISS_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 429) {
      const err = new Error('HTTP 429 (rate limited)');
      err.rateLimited = true;
      throw err;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    return [
      {
        id: 'iss',
        name: 'ISS',
        lat: Number(d.latitude),
        lon: Number(d.longitude),
        altitudeKm: Math.round(Number(d.altitude)),
        speedKmh: Math.round(Number(d.velocity)),
        source: 'satellite',
        timestamp: Date.now(),
      },
    ];
  }

  // A couple of fake satellites that orbit near home, so the toggle shows
  // something even with no internet. They drift each refresh.
  function mockStep(s) {
    const { lat, lon } = s.home;
    if (!mockSeeded) {
      mockSats = [
        { id: 'mock-sat-1', name: 'SAT-1', lat: lat + 0.25, lon: lon - 0.2, hdg: 80, altitudeKm: 540, speedKmh: 27000 },
        { id: 'iss', name: 'ISS', lat: lat - 0.18, lon: lon + 0.3, hdg: 120, altitudeKm: 420, speedKmh: 27600 },
      ];
      mockSeeded = true;
    }
    // Advance each a small step and wrap them loosely around home.
    mockSats = mockSats.map((m) => {
      const next = advancePosition(m.lat, m.lon, m.hdg, 6); // ~6nm/step
      let { lat: nlat, lon: nlon } = next;
      if (Math.abs(nlat - lat) > 0.6 || Math.abs(nlon - lon) > 0.6) {
        // Re-seed near home with a new heading when it wanders too far.
        nlat = lat + (Math.random() - 0.5) * 0.4;
        nlon = lon + (Math.random() - 0.5) * 0.4;
        m.hdg = Math.random() * 360;
      }
      return { ...m, lat: nlat, lon: nlon };
    });
    return mockSats.map((m) => ({
      id: m.id,
      name: m.name,
      lat: m.lat,
      lon: m.lon,
      altitudeKm: m.altitudeKm,
      speedKmh: m.speedKmh,
      source: 'satellite',
      timestamp: Date.now(),
    }));
  }

  // Refresh cache if due. Never throws.
  async function refresh(s) {
    const now = Date.now();
    if (provider(s) === 'mock') {
      cache = mockStep(s);
      lastSuccess = now;
      lastAttempt = now;
      lastError = null;
      return;
    }
    if (!due(now, s)) return;
    lastAttempt = now;
    try {
      cache = await fetchIss();
      lastSuccess = Date.now();
      lastError = null;
      backoffUntil = 0;
    } catch (err) {
      lastError = err.message;
      if (err.rateLimited) backoffUntil = Date.now() + Math.max(60000, pollIntervalMs(s));
      console.warn(`[satellites] ${err.message} (keeping last positions)`);
    }
  }

  function getData() {
    return cache;
  }

  function getMeta(s) {
    return {
      enabled: Boolean(s?.layers?.satellites),
      provider: provider(s),
      ok: cache.length > 0,
      count: cache.length,
      lastSuccess: lastSuccess || null,
      lastError,
      pollIntervalMs: pollIntervalMs(s),
    };
  }

  function invalidate() {
    lastAttempt = 0;
    backoffUntil = 0;
    mockSeeded = false;
  }

  return { name, refresh, getData, getMeta, invalidate };
}
