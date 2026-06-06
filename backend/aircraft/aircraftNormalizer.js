// Above Live — aircraft normalizer.
// Turns provider-specific aircraft records into the single internal format
// the rest of the app relies on:
//
// {
//   id, callsign, lat, lon, altitude, speed, heading,
//   aircraftType, source, timestamp
// }
//
// Every provider routes its output through normalizeAircraft() so the
// renderer never has to care where the data came from.

import { haversineNm } from './aircraftMath.js';

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function str(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

// Normalize a single raw record. `source` is the provider name ("mock", "api",
// "local_adsb"). Returns null if the record has no usable position.
export function normalizeAircraft(raw, source) {
  if (!raw || typeof raw !== 'object') return null;

  // Accept a range of common field names so API/ADS-B sources map cleanly.
  const lat = num(raw.lat ?? raw.latitude ?? raw.Lat, NaN);
  const lon = num(raw.lon ?? raw.lng ?? raw.longitude ?? raw.Long, NaN);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const callsign =
    str(raw.callsign ?? raw.flight ?? raw.call ?? raw.ident) ||
    str(raw.id ?? raw.hex ?? raw.icao) ||
    'UNKNOWN';

  const id = str(raw.id ?? raw.hex ?? raw.icao ?? callsign) || callsign;

  return {
    id,
    callsign,
    lat,
    lon,
    altitude: Math.round(num(raw.altitude ?? raw.alt ?? raw.alt_baro ?? raw.altitudeFt)),
    speed: Math.round(num(raw.speed ?? raw.gs ?? raw.groundspeed ?? raw.velocity)),
    heading: Math.round(num(raw.heading ?? raw.track ?? raw.true_track)) % 360,
    aircraftType: str(raw.aircraftType ?? raw.type ?? raw.t ?? raw.model) || 'UNK',
    source,
    timestamp: num(raw.timestamp ?? raw.seen ?? Date.now(), Date.now()),
  };
}

// Normalize an array of raw records, dropping anything unusable, and attach a
// distance-from-home value (nm) which the frontend uses for labels/culling.
export function normalizeList(rawList, source, home) {
  if (!Array.isArray(rawList)) return [];
  const out = [];
  for (const raw of rawList) {
    const ac = normalizeAircraft(raw, source);
    if (!ac) continue;
    if (home) {
      ac.distanceNm = Math.round(haversineNm(home.lat, home.lon, ac.lat, ac.lon) * 10) / 10;
    }
    out.push(ac);
  }
  return out;
}
