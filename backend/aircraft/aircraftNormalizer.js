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

  // Altitude: prefer barometric, fall back to geometric (alt_geom) and others.
  const altitude = Math.round(
    num(raw.altitude ?? raw.alt ?? raw.alt_baro ?? raw.alt_geom ?? raw.altitudeFt)
  );

  // Timestamp: prefer an explicit ms timestamp. dump1090/readsb report "seen"
  // (and "seen_pos") as *seconds since last message*, not an absolute time —
  // convert that into a real timestamp so freshness reads correctly.
  let timestamp = Date.now();
  if (Number.isFinite(Number(raw.timestamp))) {
    timestamp = Number(raw.timestamp);
  } else {
    const seenSec = Number(raw.seen_pos ?? raw.seen);
    if (Number.isFinite(seenSec)) timestamp = Date.now() - seenSec * 1000;
  }

  const ac = {
    id,
    callsign,
    lat,
    lon,
    altitude,
    speed: Math.round(num(raw.speed ?? raw.gs ?? raw.groundspeed ?? raw.velocity)),
    heading: Math.round(num(raw.heading ?? raw.track ?? raw.true_track)) % 360,
    aircraftType: str(raw.aircraftType ?? raw.type ?? raw.t ?? raw.model) || 'UNK',
    source,
    timestamp,
  };

  // Carry a few optional ADS-B fields through when present (labels + type-aware
  // glyphs + emergency highlighting use them later; all harmless when absent).
  // Everything here is ADDITIVE: existing fields above are unchanged, so older
  // frontends that only read the core fields keep working.
  const squawk = str(raw.squawk);
  if (squawk) ac.squawk = squawk;
  const category = str(raw.category);
  if (category) ac.category = category;
  if (Number.isFinite(Number(raw.rssi))) ac.rssi = Number(raw.rssi);

  // ICAO type code (e.g. "B738"). dump1090 exposes it as `t`; we already map
  // that into `aircraftType`, but pass a dedicated `typeCode` through too so the
  // frontend glyph classifier has an unambiguous field to read.
  const typeCode = str(raw.typeCode ?? raw.t ?? raw.type ?? raw.icaoType);
  if (typeCode && typeCode !== 'UNK') ac.typeCode = typeCode;

  // Registration / tail number (dump1090 `r`).
  const registration = str(raw.registration ?? raw.r ?? raw.reg ?? raw.tail);
  if (registration) ac.registration = registration;

  // Vertical rate, ft/min (positive = climbing). dump1090 uses baro_rate /
  // geom_rate; APIs may use vert_rate / verticalRate.
  const vr = raw.verticalRate ?? raw.baro_rate ?? raw.geom_rate ?? raw.vert_rate ?? raw.vrate;
  if (Number.isFinite(Number(vr))) ac.verticalRate = Math.round(Number(vr));

  // On-ground flag. Providers coerce alt_baro "ground" → 0 before normalizing,
  // so they also set an explicit onGround we can read here.
  if (raw.onGround === true || raw.ground === true) ac.onGround = true;

  return ac;
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
