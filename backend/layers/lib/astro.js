// Above Live — planetary / solar / lunar positions (compact, dependency-free).
//
// Implements Paul Schlyter's low-precision ephemeris ("How to compute planetary
// positions", stjarnhimlen.se) to get the Sun, Moon, Venus, Mars, Jupiter and
// Saturn as azimuth/elevation for the observer at `home`. Accuracy is ~1–2
// arc-minutes for the planets and ~1–2° for the Moon (lunar perturbations are
// omitted) — far better than this subtle display needs. No network, no deps.
//
// Output azimuth: 0° = North, 90° = East. Elevation: degrees above the horizon
// (negative = below). The renderer maps these onto a sky-dome (zenith = center).

const RAD = Math.PI / 180;
const sind = (x) => Math.sin(x * RAD);
const cosd = (x) => Math.cos(x * RAD);
const atan2d = (y, x) => Math.atan2(y, x) / RAD;
const asind = (x) => Math.asin(x) / RAD;
const rev = (x) => ((x % 360) + 360) % 360;

// Day number (Schlyter): days since 2000-01-01 00:00 UTC, with UT fraction.
function dayNumber(date) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const D = date.getUTCDate();
  const ut = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const d =
    367 * y -
    Math.floor((7 * (y + Math.floor((m + 9) / 12))) / 4) +
    Math.floor((275 * m) / 9) +
    D -
    730530;
  return d + ut / 24;
}

// Solve for eccentric anomaly (deg) from mean anomaly M (deg) and ecc e.
function eccentricAnomaly(M, e) {
  let E = M + e * (180 / Math.PI) * sind(M) * (1 + e * cosd(M));
  for (let k = 0; k < 5; k++) {
    const dE = (E - e * (180 / Math.PI) * sind(E) - M) / (1 - e * cosd(E));
    E -= dE;
    if (Math.abs(dE) < 1e-6) break;
  }
  return E;
}

// Heliocentric rectangular ecliptic coords for a planet's element set.
function helioRect(p, d) {
  const N = p.N(d), i = p.i(d), w = p.w(d), a = p.a(d), e = p.e(d), M = rev(p.M(d));
  const E = eccentricAnomaly(M, e);
  const xv = a * (cosd(E) - e);
  const yv = a * Math.sqrt(1 - e * e) * sind(E);
  const v = atan2d(yv, xv);
  const r = Math.sqrt(xv * xv + yv * yv);
  const vw = v + w;
  return {
    x: r * (cosd(N) * cosd(vw) - sind(N) * sind(vw) * cosd(i)),
    y: r * (sind(N) * cosd(vw) + cosd(N) * sind(vw) * cosd(i)),
    z: r * (sind(vw) * sind(i)),
    r,
  };
}

// Orbital element tables (deg / AU), each a function of day number d.
const PLANETS = {
  Venus:   { N: (d) => 76.6799 + 2.46590e-5 * d, i: (d) => 3.3946 + 2.75e-8 * d,  w: (d) => 54.8910 + 1.38374e-5 * d, a: () => 0.723330, e: (d) => 0.006773 - 1.302e-9 * d, M: (d) => 48.0052 + 1.6021302244 * d, mag: 'venus' },
  Mars:    { N: (d) => 49.5574 + 2.11081e-5 * d, i: (d) => 1.8497 - 1.78e-8 * d,  w: (d) => 286.5016 + 2.92961e-5 * d, a: () => 1.523688, e: (d) => 0.093405 + 2.516e-9 * d, M: (d) => 18.6021 + 0.5240207766 * d, mag: 'mars' },
  Jupiter: { N: (d) => 100.4542 + 2.76854e-5 * d, i: (d) => 1.3030 - 1.557e-7 * d, w: (d) => 273.8777 + 1.64505e-5 * d, a: () => 5.20256,  e: (d) => 0.048498 + 4.469e-9 * d, M: (d) => 19.8950 + 0.0830853001 * d, mag: 'jupiter' },
  Saturn:  { N: (d) => 113.6634 + 2.38980e-5 * d, i: (d) => 2.4886 - 1.081e-7 * d, w: (d) => 339.3939 + 2.97661e-5 * d, a: () => 9.55475,  e: (d) => 0.055546 - 9.499e-9 * d, M: (d) => 49.9444 + 0.0334442282 * d, mag: 'saturn' },
};

// Sun (geocentric) — returns ecliptic longitude, distance, and rectangular xs/ys.
function sunData(d) {
  const w = 282.9404 + 4.70935e-5 * d;
  const e = 0.016709 - 1.151e-9 * d;
  const M = rev(356.0470 + 0.9856002585 * d);
  const E = eccentricAnomaly(M, e);
  const xv = cosd(E) - e;
  const yv = Math.sqrt(1 - e * e) * sind(E);
  const v = atan2d(yv, xv);
  const r = Math.sqrt(xv * xv + yv * yv);
  const lon = rev(v + w);
  const Ls = rev(M + w); // mean longitude (for sidereal time)
  return { lon, r, Ls, xs: r * cosd(lon), ys: r * sind(lon) };
}

// Convert geocentric equatorial (RA/Dec, deg) → az/el for observer.
function equatorialToAzEl(ra, dec, lat, lst) {
  const ha = rev(lst * 15 - ra); // hour angle (deg)
  const x = cosd(ha) * cosd(dec);
  const y = sind(ha) * cosd(dec);
  const z = sind(dec);
  const xhor = x * sind(lat) - z * cosd(lat);
  const yhor = y;
  const zhor = x * cosd(lat) + z * sind(lat);
  const az = rev(atan2d(yhor, xhor) + 180); // 0 = N, 90 = E
  const el = asind(zhor);
  return { az, el };
}

// Compute the visible-sky snapshot: Sun, Moon, and the four bright planets, each
// as { name, kind, az, el }. `home` is { lat, lon } (lon east-positive).
export function computeSky(home, date = new Date()) {
  const d = dayNumber(date);
  const ecl = 23.4393 - 3.563e-7 * d;
  const sun = sunData(d);

  // Local sidereal time (hours).
  const ut = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const gmst0 = sun.Ls / 15 + 12; // hours
  const lst = rev((gmst0 + ut + home.lon / 15) * 15) / 15;

  const out = [];

  // Sun.
  {
    const xe = sun.xs;
    const ye = sun.ys * cosd(ecl);
    const ze = sun.ys * sind(ecl);
    const ra = rev(atan2d(ye, xe));
    const dec = atan2d(ze, Math.sqrt(xe * xe + ye * ye));
    const { az, el } = equatorialToAzEl(ra, dec, home.lat, lst);
    out.push({ name: 'Sun', kind: 'sun', az, el });
  }

  // Moon (geocentric; lunar perturbations omitted).
  {
    const N = 125.1228 - 0.0529538083 * d;
    const i = 5.1454;
    const w = 318.0634 + 0.1643573223 * d;
    const a = 60.2666;
    const e = 0.054900;
    const M = rev(115.3654 + 13.0649929509 * d);
    const E = eccentricAnomaly(M, e);
    const xv = a * (cosd(E) - e);
    const yv = a * Math.sqrt(1 - e * e) * sind(E);
    const v = atan2d(yv, xv);
    const r = Math.sqrt(xv * xv + yv * yv);
    const vw = v + w;
    const xh = r * (cosd(N) * cosd(vw) - sind(N) * sind(vw) * cosd(i));
    const yh = r * (sind(N) * cosd(vw) + cosd(N) * sind(vw) * cosd(i));
    const zh = r * (sind(vw) * sind(i));
    const xe = xh;
    const ye = yh * cosd(ecl) - zh * sind(ecl);
    const ze = yh * sind(ecl) + zh * cosd(ecl);
    const ra = rev(atan2d(ye, xe));
    const dec = atan2d(ze, Math.sqrt(xe * xe + ye * ye));
    const { az, el } = equatorialToAzEl(ra, dec, home.lat, lst);
    out.push({ name: 'Moon', kind: 'moon', az, el });
  }

  // Planets.
  for (const [pname, p] of Object.entries(PLANETS)) {
    const h = helioRect(p, d);
    const xg = h.x + sun.xs;
    const yg = h.y + sun.ys;
    const zg = h.z;
    const xe = xg;
    const ye = yg * cosd(ecl) - zg * sind(ecl);
    const ze = yg * sind(ecl) + zg * cosd(ecl);
    const ra = rev(atan2d(ye, xe));
    const dec = atan2d(ze, Math.sqrt(xe * xe + ye * ye));
    const { az, el } = equatorialToAzEl(ra, dec, home.lat, lst);
    out.push({ name: pname, kind: 'planet', az, el });
  }

  return out;
}
