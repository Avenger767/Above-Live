// Above Live — Space layer (optional, OFF by default).
//
// A no-network scaffold computed locally: moon phase, a simple day/night +
// approximate sunrise/sunset at home, and a placeholder visible-planets list.
// The astronomy here is intentionally approximate — it's a clean interface to
// build on later, not an ephemeris. It never makes external calls and never
// throws into the aircraft path.

export function createSpaceLayer() {
  const name = 'space';

  let cache = null;
  let lastSuccess = 0;

  const pollIntervalMs = (s) => {
    const v = Number(s?.space?.pollIntervalMs);
    return Number.isFinite(v) && v > 0 ? v : 3600000; // 1 h (cheap to recompute)
  };

  // Recompute the (cheap) local snapshot. Async only to match the layer shape.
  async function refresh(s) {
    cache = compute(s.home, new Date());
    lastSuccess = Date.now();
  }

  function getData() {
    return cache;
  }

  function getMeta(s) {
    return {
      enabled: Boolean(s?.layers?.space),
      ok: Boolean(cache),
      moonPhase: cache?.moon?.name || null,
      isDay: cache?.sun?.isDay ?? null,
      lastSuccess: lastSuccess || null,
      pollIntervalMs: pollIntervalMs(s),
    };
  }

  function invalidate() {
    cache = null;
  }

  return { name, refresh, getData, getMeta, invalidate };
}

// --- Calculations (approximate, dependency-free) ---------------------------

function compute(home, date) {
  return {
    moon: moonPhase(date),
    sun: sunInfo(home.lat, home.lon, date),
    // Placeholder list — a real ephemeris can replace this later.
    planets: [
      { name: 'Venus', visible: null },
      { name: 'Mars', visible: null },
      { name: 'Jupiter', visible: null },
      { name: 'Saturn', visible: null },
    ],
    timestamp: Date.now(),
  };
}

// Moon phase from a known new moon, using the mean synodic month.
function moonPhase(date) {
  const SYNODIC = 29.530588853; // days
  const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14, 0); // 2000-01-06 18:14 UTC
  const days = (date.getTime() - knownNewMoon) / 86400000;
  let phase = (days % SYNODIC) / SYNODIC; // 0..1 (0 = new, 0.5 = full)
  if (phase < 0) phase += 1;
  const illumination = Math.round(((1 - Math.cos(2 * Math.PI * phase)) / 2) * 100);
  return { name: phaseName(phase), phase: Math.round(phase * 1000) / 1000, illumination };
}

function phaseName(p) {
  if (p < 0.03 || p >= 0.97) return 'New Moon';
  if (p < 0.22) return 'Waxing Crescent';
  if (p < 0.28) return 'First Quarter';
  if (p < 0.47) return 'Waxing Gibbous';
  if (p < 0.53) return 'Full Moon';
  if (p < 0.72) return 'Waning Gibbous';
  if (p < 0.78) return 'Last Quarter';
  return 'Waning Crescent';
}

// Approximate solar position → day/night + sunrise/sunset (NOAA-style, simplified).
function sunInfo(lat, lon, date) {
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;

  // Day of year.
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((date.getTime() - start) / 86400000);

  // Solar declination (deg).
  const decl = -23.44 * Math.cos(rad * (360 / 365) * (dayOfYear + 10));

  // Current solar elevation, to decide day/night now.
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60;
  const solarTime = hours + lon / 15; // approx local solar time (h)
  const hourAngle = (solarTime - 12) * 15; // deg
  const elevation =
    deg *
    Math.asin(
      Math.sin(lat * rad) * Math.sin(decl * rad) +
        Math.cos(lat * rad) * Math.cos(decl * rad) * Math.cos(hourAngle * rad)
    );

  // Sunrise/sunset hour angle. |cosH0|>1 → polar day/night (no event).
  const cosH0 = -Math.tan(lat * rad) * Math.tan(decl * rad);
  let sunrise = null;
  let sunset = null;
  if (cosH0 >= -1 && cosH0 <= 1) {
    const H0 = deg * Math.acos(cosH0); // deg
    const noonUtc = 12 - lon / 15; // approx solar noon in UTC hours
    sunrise = fmtUtcHour(noonUtc - H0 / 15);
    sunset = fmtUtcHour(noonUtc + H0 / 15);
  }

  return {
    isDay: elevation > 0,
    altitudeDeg: Math.round(elevation),
    sunrise, // "HH:MM" UTC (approx) or null
    sunset, // "HH:MM" UTC (approx) or null
    note: 'approx (UTC)',
  };
}

function fmtUtcHour(h) {
  let hh = ((h % 24) + 24) % 24;
  const m = Math.round((hh - Math.floor(hh)) * 60);
  const hr = (Math.floor(hh) + (m === 60 ? 1 : 0)) % 24;
  const mm = m === 60 ? 0 : m;
  return `${String(hr).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
