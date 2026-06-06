// Above Live — Weather layer (optional, OFF by default).
//
// Centered on the home location. Default provider is Open-Meteo (free, no key).
// Set provider to "mock" for offline/demo data. This layer is fully isolated:
// it caches its last good reading, backs off on errors, and NEVER throws into
// the aircraft path — if it has no data the renderer simply shows nothing.
//
// Swap providers later by editing buildUrl()/parse() or adding a branch.

const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';

// WMO weather interpretation codes → short condition text.
// https://open-meteo.com/en/docs (weather_code)
const WMO = {
  0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Light showers', 81: 'Showers', 82: 'Violent showers',
  85: 'Snow showers', 86: 'Snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm w/ hail', 99: 'Thunderstorm w/ hail',
};

export function createWeatherLayer() {
  const name = 'weather';

  let cache = null;
  let lastSuccess = 0;
  let lastAttempt = 0;
  let lastError = null;
  let backoffUntil = 0;

  const provider = (s) => (s?.weather?.provider || 'openmeteo').toLowerCase();
  const pollIntervalMs = (s) => {
    const v = Number(s?.weather?.pollIntervalMs);
    return Number.isFinite(v) && v > 0 ? v : 300000; // 5 min
  };

  function buildUrl(s) {
    const { lat, lon } = s.home;
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      current:
        'temperature_2m,precipitation,weather_code,cloud_cover,visibility,wind_speed_10m,wind_direction_10m',
      wind_speed_unit: 'kn',
      timezone: 'auto',
    });
    return `${OPEN_METEO}?${params}`;
  }

  function parse(data) {
    const c = data?.current || {};
    const code = Number(c.weather_code);
    return {
      temperature: num(c.temperature_2m), // °C
      windSpeed: num(c.wind_speed_10m), // kn
      windDirection: num(c.wind_direction_10m), // deg (FROM)
      cloudCover: num(c.cloud_cover), // %
      visibility: c.visibility != null ? num(c.visibility) : null, // m
      precipitation: num(c.precipitation), // mm
      condition: WMO[code] || 'Unknown',
      weatherCode: Number.isFinite(code) ? code : null,
      source: 'openmeteo',
      timestamp: Date.now(),
    };
  }

  // Deterministic, stable demo weather (no network). Used when provider==='mock'.
  function mockData() {
    return {
      temperature: 22,
      windSpeed: 12,
      windDirection: 240,
      cloudCover: 35,
      visibility: 16000,
      precipitation: 0,
      condition: 'Partly cloudy',
      weatherCode: 2,
      source: 'mock',
      timestamp: Date.now(),
    };
  }

  function due(now, s) {
    if (now < backoffUntil) return false;
    if (lastAttempt === 0) return true;
    return now - lastAttempt >= pollIntervalMs(s);
  }

  // Refresh cache if due. Never throws. Safe to call on a timer.
  async function refresh(s) {
    const now = Date.now();
    if (provider(s) === 'mock') {
      cache = mockData();
      lastSuccess = now;
      lastAttempt = now;
      lastError = null;
      return;
    }
    if (!due(now, s)) return;
    lastAttempt = now;
    try {
      const res = await fetch(buildUrl(s), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 429) {
        backoffUntil = Date.now() + Math.max(60000, pollIntervalMs(s));
        throw new Error('HTTP 429 (rate limited)');
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      cache = parse(await res.json());
      lastSuccess = Date.now();
      lastError = null;
      backoffUntil = 0;
    } catch (err) {
      lastError = err.message;
      console.warn(`[weather] ${err.message} (keeping last reading)`);
    }
  }

  function getData() {
    return cache;
  }

  function getMeta(s) {
    return {
      enabled: Boolean(s?.layers?.weather),
      provider: provider(s),
      ok: Boolean(cache),
      condition: cache?.condition || null,
      lastSuccess: lastSuccess || null,
      lastError,
      pollIntervalMs: pollIntervalMs(s),
    };
  }

  // Reset cache (e.g. home changed) so the next refresh fetches immediately.
  function invalidate() {
    lastAttempt = 0;
    backoffUntil = 0;
  }

  return { name, refresh, getData, getMeta, invalidate };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
