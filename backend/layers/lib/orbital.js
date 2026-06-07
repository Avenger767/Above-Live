// Above Live — orbital propagation (TLE/GP → sub-point lat/lon).
//
// This is a compact, dependency-free propagator. It reads the mean orbital
// elements from a CelesTrak TLE (3-line) set or GP JSON record and propagates
// them with Keplerian motion plus J2 secular precession (the dominant long-term
// perturbation: nodal regression, apsidal precession, and the secular part of
// the mean-anomaly rate). It is NOT a full SGP4/SDP4 implementation — it omits
// atmospheric drag and short-period terms — but for low-Earth satellites with
// TLEs refreshed every few hours it is accurate to a few km, which is far below
// one pixel on this display. The interface (parse* → propagate) is deliberately
// SGP4-shaped so a full propagator can be dropped in later without touching the
// layers that call it.
//
// All angles are radians internally; inputs/outputs at the edges are degrees.

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const TWO_PI = Math.PI * 2;

const MU = 398600.4418;       // Earth GM (km^3/s^2)
const RE = 6378.137;          // Earth equatorial radius (km, WGS84)
const J2 = 1.08262668e-3;     // Earth second zonal harmonic
const E2 = 6.69437999014e-3;  // WGS84 first eccentricity squared
const MIN_PER_DAY = 1440;

// --- date / sidereal helpers ----------------------------------------------

function julianDate(date) {
  // Unix ms → Julian Date.
  return date.getTime() / 86400000 + 2440587.5;
}

// Greenwich Mean Sidereal Time (radians) for a given date.
export function gmst(date) {
  const jd = julianDate(date);
  const d = jd - 2451545.0;
  const T = d / 36525.0;
  let deg = 280.46061837 + 360.98564736629 * d + 0.000387933 * T * T - (T * T * T) / 38710000.0;
  deg = ((deg % 360) + 360) % 360;
  return deg * DEG2RAD;
}

// --- TLE / GP parsing ------------------------------------------------------

// Parse a CelesTrak TLE text block (repeating: name line, line1, line2) into
// element sets. Tolerant of blank lines and CRLF. Returns [] for junk input.
export function parseTleText(text) {
  if (typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).filter((l) => l.length > 0);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    // A TLE pair is two lines beginning "1 " and "2 ". An optional name line
    // precedes them (the common "3-line" / "TLE" format).
    if (lines[i].startsWith('1 ') && i + 1 < lines.length && lines[i + 1].startsWith('2 ')) {
      const el = parseTle('', lines[i], lines[i + 1]);
      if (el) out.push(el);
      i += 2;
    } else if (
      i + 2 < lines.length &&
      lines[i + 1].startsWith('1 ') &&
      lines[i + 2].startsWith('2 ')
    ) {
      const el = parseTle(lines[i], lines[i + 1], lines[i + 2]);
      if (el) out.push(el);
      i += 3;
    } else {
      i += 1; // skip unrecognized line
    }
  }
  return out;
}

// Parse one TLE pair (with optional name) into an element set. Returns null if
// the lines don't look like a TLE.
export function parseTle(name, line1, line2) {
  if (typeof line1 !== 'string' || typeof line2 !== 'string') return null;
  if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) return null;
  if (line1.length < 63 || line2.length < 63) return null;

  const satnum = parseInt(line1.substring(2, 7), 10);

  // Epoch: 2-digit year + fractional day-of-year.
  const epochYear = parseInt(line1.substring(18, 20), 10);
  const epochDay = parseFloat(line1.substring(20, 32));
  const fullYear = epochYear < 57 ? 2000 + epochYear : 1900 + epochYear;
  const epochMs = Date.UTC(fullYear, 0, 1) + (epochDay - 1) * 86400000;

  const inclo = parseFloat(line2.substring(8, 16));
  const raan = parseFloat(line2.substring(17, 25));
  const ecc = parseFloat('0.' + line2.substring(26, 33).trim());
  const argp = parseFloat(line2.substring(34, 42));
  const mo = parseFloat(line2.substring(43, 51));
  const noRevPerDay = parseFloat(line2.substring(52, 63));

  if (![inclo, raan, ecc, argp, mo, noRevPerDay].every(Number.isFinite)) return null;
  if (noRevPerDay <= 0) return null;

  return {
    name: (name || `SAT ${satnum}`).trim(),
    satnum,
    epoch: new Date(epochMs),
    incloDeg: inclo,
    raanDeg: raan,
    ecc,
    argpDeg: argp,
    maDeg: mo,
    noRevPerDay,
  };
}

// Parse a CelesTrak GP JSON array (FORMAT=json) into element sets. Each record
// carries the mean elements directly, so no column slicing is needed.
export function parseGpJson(records) {
  if (!Array.isArray(records)) return [];
  const out = [];
  for (const r of records) {
    if (!r || typeof r !== 'object') continue;
    const noRevPerDay = Number(r.MEAN_MOTION);
    const ecc = Number(r.ECCENTRICITY);
    const inclo = Number(r.INCLINATION);
    const raan = Number(r.RA_OF_ASC_NODE);
    const argp = Number(r.ARG_OF_PERICENTER);
    const ma = Number(r.MEAN_ANOMALY);
    const epoch = r.EPOCH ? new Date(r.EPOCH) : null;
    if (![noRevPerDay, ecc, inclo, raan, argp, ma].every(Number.isFinite)) continue;
    if (!epoch || isNaN(epoch.getTime()) || noRevPerDay <= 0) continue;
    out.push({
      name: String(r.OBJECT_NAME || r.OBJECT_ID || `SAT ${r.NORAD_CAT_ID || ''}`).trim(),
      satnum: Number(r.NORAD_CAT_ID) || 0,
      epoch,
      incloDeg: inclo,
      raanDeg: raan,
      ecc,
      argpDeg: argp,
      maDeg: ma,
      noRevPerDay,
    });
  }
  return out;
}

// --- propagation -----------------------------------------------------------

// Solve Kepler's equation M = E - e·sinE for E (radians) by Newton iteration.
function solveKepler(M, e) {
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 12; k++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-10) break;
  }
  return E;
}

// Propagate an element set to `date`. Returns { lat, lon, altKm } sub-point, or
// null if the elements are unusable. `lon` is in [-180, 180].
export function propagate(el, date) {
  if (!el) return null;
  const n0 = (el.noRevPerDay * TWO_PI) / 86400; // mean motion, rad/s
  const a = Math.cbrt(MU / (n0 * n0));          // semi-major axis, km
  const e = el.ecc;
  const i = el.incloDeg * DEG2RAD;
  if (!Number.isFinite(a) || a <= 0) return null;

  const dt = (date.getTime() - el.epoch.getTime()) / 1000; // seconds since epoch

  // J2 secular rates.
  const p = a * (1 - e * e);
  const cosi = Math.cos(i);
  const sin2i = Math.sin(i) * Math.sin(i);
  const factor = 1.5 * J2 * (RE / p) * (RE / p) * n0;
  const raanDot = -factor * cosi;
  const argpDot = factor * (2 - 2.5 * sin2i);
  const mDot = n0 + factor * Math.sqrt(1 - e * e) * (1 - 1.5 * sin2i);

  const raan = el.raanDeg * DEG2RAD + raanDot * dt;
  const argp = el.argpDeg * DEG2RAD + argpDot * dt;
  let M = el.maDeg * DEG2RAD + mDot * dt;
  M = ((M % TWO_PI) + TWO_PI) % TWO_PI;

  const E = solveKepler(M, e);
  const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  const r = a * (1 - e * Math.cos(E));

  // Perifocal → ECI (TEME-aligned) using argument of latitude u = argp + nu.
  const u = argp + nu;
  const cosR = Math.cos(raan), sinR = Math.sin(raan);
  const cosU = Math.cos(u), sinU = Math.sin(u);
  const X = r * (cosR * cosU - sinR * sinU * cosi);
  const Y = r * (sinR * cosU + cosR * sinU * cosi);
  const Z = r * (sinU * Math.sin(i));

  // ECI → geodetic sub-point.
  const theta = gmst(date);
  let lon = Math.atan2(Y, X) - theta;
  lon = ((lon * RAD2DEG + 540) % 360) - 180; // normalize to [-180, 180]

  const rho = Math.sqrt(X * X + Y * Y);
  let lat = Math.atan2(Z, rho);
  let N = RE;
  for (let k = 0; k < 5; k++) {
    const sinLat = Math.sin(lat);
    N = RE / Math.sqrt(1 - E2 * sinLat * sinLat);
    lat = Math.atan2(Z + N * E2 * sinLat, rho);
  }
  const altKm = rho / Math.cos(lat) - N;

  return { lat: lat * RAD2DEG, lon, altKm };
}

// Convenience: propagate an array of element sets, returning normalized objects
// suitable for the layer snapshot. Filters out anything that fails to propagate.
export function propagateAll(elements, date, source) {
  const out = [];
  for (const el of elements) {
    const pos = propagate(el, date);
    if (!pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lon)) continue;
    out.push({
      id: String(el.satnum || el.name),
      name: el.name,
      lat: pos.lat,
      lon: pos.lon,
      altitudeKm: Math.round(pos.altKm),
      source: source || 'satellite',
      timestamp: date.getTime(),
    });
  }
  return out;
}
