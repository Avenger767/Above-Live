// Above Live — space provider.
// Fetches ISS live position via the free wheretheiss.at API.
// Generates 5 additional mock LEO satellites using simplified Keplerian orbital
// mechanics so the space layer is always populated. All objects are returned
// with both lat/lon (ground track) and azimuth/elevation (sky dome projection)
// as seen from the home location.

const ISS_URL = 'https://api.wheretheiss.at/v1/satellites/25544';
const Re = 6371;           // Earth radius km
const GM = 398600.4418;    // gravitational parameter km³/s²

function toRad(d) { return (d * Math.PI) / 180; }
function toDeg(r) { return (r * 180) / Math.PI; }

// Elevation and azimuth of a satellite as seen from an observer on the ground.
// Returns { elevation (deg), azimuth (deg) }.
// Elevation > 0 means the satellite is above the horizon.
function skyPosition(homeLat, homeLon, satLat, satLon, satAltKm) {
  const φ1 = toRad(homeLat), λ1 = toRad(homeLon);
  const φ2 = toRad(satLat),  λ2 = toRad(satLon);
  const Δλ = λ2 - λ1;

  // Central angle via haversine
  const a   = Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const rho = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  // Elevation from geometry: tan(el) = (cos(rho) − Re/(Re+h)) / sin(rho)
  const elevation = toDeg(Math.atan2(Math.cos(rho) - Re / (Re + satAltKm), Math.sin(rho)));

  // Azimuth: bearing from observer to sub-satellite point
  const y       = Math.sin(Δλ) * Math.cos(φ2);
  const x       = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const azimuth = (toDeg(Math.atan2(y, x)) + 360) % 360;

  return { elevation, azimuth };
}

// Simplified circular-orbit ground track.
// Keplerian elements: inclination, RAAN, mean anomaly at epoch=0, altitude.
// Earth rotation is accounted for via GMST. Accurate enough for a display.
function satGroundTrack(incDeg, raanDeg, m0Deg, altKm, nowSec) {
  const a = Re + altKm;
  const T = 2 * Math.PI * Math.sqrt(a ** 3 / GM); // orbital period, seconds
  const n = 2 * Math.PI / T;                        // mean motion, rad/s

  const M    = (toRad(m0Deg) + n * nowSec) % (2 * Math.PI);
  const inc  = toRad(incDeg);
  const raan = toRad(raanDeg);

  // ECI unit position (circular orbit: true anomaly = mean anomaly)
  const xECI = Math.cos(raan) * Math.cos(M) - Math.sin(raan) * Math.sin(M) * Math.cos(inc);
  const yECI = Math.sin(raan) * Math.cos(M) + Math.cos(raan) * Math.sin(M) * Math.cos(inc);
  const zECI = Math.sin(M) * Math.sin(inc);

  // Greenwich Mean Sidereal Time (simplified from J2000 epoch offset)
  const GMST = toRad((280.46061837 + (360.98564736629 / 86400) * nowSec) % 360);

  // ECI → ECEF rotation
  const xECEF =  xECI * Math.cos(GMST) + yECI * Math.sin(GMST);
  const yECEF = -xECI * Math.sin(GMST) + yECI * Math.cos(GMST);
  const zECEF =  zECI;

  // ECEF unit sphere → geodetic lat/lon
  const lat    = toDeg(Math.asin(Math.max(-1, Math.min(1, zECEF))));
  const lonRaw = toDeg(Math.atan2(yECEF, xECEF));
  const lon    = lonRaw > 180 ? lonRaw - 360 : lonRaw < -180 ? lonRaw + 360 : lonRaw;

  return { lat, lon, altKm, velKmH: Math.sqrt(GM / a) * 3600 };
}

// A modeled constellation so the sky dome stays populated even with no internet.
// A spread of orbital planes (RAAN) and phases (mean anomaly) keeps a handful of
// objects above the horizon at any given time, which is what a ceiling display
// wants. A few named, real-world satellites are mixed in for flavor.
function buildConstellation() {
  const sats = [
    { id: 'NOAA-15', name: 'NOAA-15', altKm: 813, incDeg: 98.7, raanDeg: 90, m0Deg: 60 },
    { id: 'NOAA-19', name: 'NOAA-19', altKm: 870, incDeg: 99.2, raanDeg: 250, m0Deg: 140 },
    { id: 'TERRA',   name: 'TERRA',   altKm: 705, incDeg: 98.2, raanDeg: 200, m0Deg: 180 },
    { id: 'AQUA',    name: 'AQUA',    altKm: 705, incDeg: 98.2, raanDeg: 20,  m0Deg: 300 },
    { id: 'HST',     name: 'HUBBLE',  altKm: 540, incDeg: 28.5, raanDeg: 130, m0Deg: 75 },
  ];
  // Starlink-like shell: many planes, several phases each (inclination 53°).
  // Dense enough that a handful are above the horizon at any moment — the sky
  // dome should rarely be empty for a ceiling display.
  let n = 1;
  const planes = 12;
  const slotsPerPlane = 4;
  for (let plane = 0; plane < planes; plane++) {
    for (let slot = 0; slot < slotsPerPlane; slot++) {
      sats.push({
        id: `STARLINK-${n}`,
        name: `STARLINK-${1000 + n++}`,
        altKm: 550,
        incDeg: 53,
        raanDeg: (plane * 360) / planes,
        m0Deg: ((plane * 360) / planes + (slot * 360) / slotsPerPlane) % 360,
      });
    }
  }
  return sats;
}

const MOCK_SATS = buildConstellation();

export function createSpaceProvider() {
  let issCache      = null;
  let issLastFetch  = 0;
  const ISS_TTL     = 5000; // refresh every 5 s (ISS moves 7.6 km/s)

  // Historical trail for the ISS (az/el pairs, kept 2.5 minutes at 5-s resolution)
  let issTrail = []; // [{azimuth, elevation, lat, lon, t}, ...]

  return {
    name: 'space',

    async fetchSpace(settings) {
      const home  = settings.home || { lat: 32.7767, lon: -96.797 };
      const nowMs = Date.now();
      const nowSc = nowMs / 1000;
      const objects = [];

      // --- ISS live position -------------------------------------------
      try {
        if (nowMs - issLastFetch >= ISS_TTL) {
          const resp = await fetch(ISS_URL, {
            signal: AbortSignal.timeout(5000),
            headers: { 'User-Agent': 'AboveLive/1.0' },
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          issCache     = await resp.json();
          issLastFetch = nowMs;
        }

        if (issCache) {
          const { latitude: lat, longitude: lon, altitude: altKm, velocity } = issCache;
          const sky = skyPosition(home.lat, home.lon, lat, lon, altKm);

          // Append trail point every 5 s; keep last 30 (~2.5 min of history)
          const last = issTrail[issTrail.length - 1];
          if (!last || nowMs - last.t >= 5000) {
            issTrail.push({ ...sky, lat, lon, t: nowMs });
            if (issTrail.length > 30) issTrail.shift();
          }

          objects.push({
            id:        'ISS',
            name:      'ISS',
            type:      'station',
            lat, lon, altKm,
            altFt:     Math.round(altKm * 3280.84),
            speedKmH:  velocity,
            azimuth:   sky.azimuth,
            elevation: sky.elevation,
            visible:   sky.elevation > -2,
            source:    'live',
            trail:     issTrail.slice(),
          });
        }
      } catch (err) {
        console.warn(`[space] ISS API: ${err.message}`);
        // Reset cache on prolonged failure so the next fetch retries.
        if (nowMs - issLastFetch > 60000) { issCache = null; issLastFetch = 0; }
      }

      // --- Mock satellites (always shown, derived from orbital mechanics) ---
      for (const s of MOCK_SATS) {
        const gt  = satGroundTrack(s.incDeg, s.raanDeg, s.m0Deg, s.altKm, nowSc);
        const sky = skyPosition(home.lat, home.lon, gt.lat, gt.lon, gt.altKm);
        objects.push({
          id:        s.id,
          name:      s.name,
          type:      'satellite',
          lat:       gt.lat,
          lon:       gt.lon,
          altKm:     gt.altKm,
          altFt:     Math.round(gt.altKm * 3280.84),
          speedKmH:  gt.velKmH,
          azimuth:   sky.azimuth,
          elevation: sky.elevation,
          visible:   sky.elevation > 0,
          source:    'mock',
          trail:     [],
        });
      }

      return objects;
    },
  };
}
