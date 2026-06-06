// Above Live — aircraft / geo math utilities.
// Small, dependency-free helpers shared across providers and the manager.

const EARTH_RADIUS_NM = 3440.065; // Earth radius in nautical miles
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export function toRad(deg) {
  return deg * DEG2RAD;
}

export function toDeg(rad) {
  return rad * RAD2DEG;
}

// Great-circle distance between two lat/lon points, in nautical miles.
export function haversineNm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_NM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Initial bearing (degrees, 0 = north, clockwise) from point 1 to point 2.
export function bearingDeg(lat1, lon1, lat2, lon2) {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Move a point forward given a heading (deg) and distance (nm).
// Returns a new { lat, lon }. Uses a simple equirectangular step, which is
// plenty accurate for the short per-tick distances used by the mock provider.
export function advancePosition(lat, lon, headingDeg, distanceNm) {
  const h = toRad(headingDeg);
  const dLat = (distanceNm / 60) * Math.cos(h);
  const cosLat = Math.cos(toRad(lat)) || 1e-6;
  const dLon = ((distanceNm / 60) * Math.sin(h)) / cosLat;
  return { lat: lat + dLat, lon: lon + dLon };
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
