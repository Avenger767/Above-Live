// Above Live — projection math.
// Converts geographic positions (lat/lon) into screen pixels for the radar
// display, then applies user calibration (offset / scale / rotation / flip) so
// the picture can be aligned to a real ceiling or wall later.

import { THEME_KEYS } from './themes.js';

const NM_PER_DEG_LAT = 60;

// Build a projector function for the current frame.
//   home        : { lat, lon }
//   rangeNm     : radius (nm) that maps to the on-screen radar radius
//   center      : { x, y } screen center in pixels
//   radiusPx    : on-screen radar radius in pixels
//   calibration : { offsetX, offsetY, scale, rotation, flipH, flipV }
export function makeProjector({ home, rangeNm, center, radiusPx, calibration }) {
  const cal = calibration || {};
  const scale = (cal.scale ?? 1) * (radiusPx / rangeNm); // pixels per nm
  const rot = ((cal.rotation ?? 0) * Math.PI) / 180;
  const flipH = cal.flipH ? -1 : 1;
  const flipV = cal.flipV ? -1 : 1;
  const cosLat = Math.cos((home.lat * Math.PI) / 180) || 1e-6;

  return function project(lat, lon) {
    // Offsets from home in nautical miles (east-x, north-y).
    const dNorthNm = (lat - home.lat) * NM_PER_DEG_LAT;
    const dEastNm = (lon - home.lon) * NM_PER_DEG_LAT * cosLat;

    // Base pixel position: east -> +x, north -> -y (screen y grows downward).
    let x = dEastNm * scale * flipH;
    let y = -dNorthNm * scale * flipV;

    // Apply rotation about the center.
    const rx = x * Math.cos(rot) - y * Math.sin(rot);
    const ry = x * Math.sin(rot) + y * Math.cos(rot);

    return {
      x: center.x + rx + (cal.offsetX ?? 0),
      y: center.y + ry + (cal.offsetY ?? 0),
    };
  };
}

// Build a sky-dome projector for satellites / the ISS.
// Maps az/el (where an object actually is overhead) onto the radar disc:
// the zenith (straight up, el=90) sits at the center and the horizon (el=0)
// at the outer ring — the natural view when projecting onto a ceiling.
// Applies the same calibration transforms as makeProjector so the satellite
// layer stays aligned with the aircraft map and the projected surface.
export function makeSkyProjector({ center, radiusPx, calibration }) {
  const cal = calibration || {};
  const scale = cal.scale ?? 1;
  const rot = ((cal.rotation ?? 0) * Math.PI) / 180;
  const flipH = cal.flipH ? -1 : 1;
  const flipV = cal.flipV ? -1 : 1;

  return function projectSky(azimuthDeg, elevationDeg) {
    // Distance from zenith: clamp below horizon so it parks at the rim.
    const el = Math.max(0, Math.min(90, elevationDeg));
    const r = (radiusPx * (90 - el)) / 90;
    const az = (azimuthDeg * Math.PI) / 180;

    // North (az=0) points up (-y), East (az=90) to the right (+x).
    let x = r * Math.sin(az) * scale * flipH;
    let y = -r * Math.cos(az) * scale * flipV;

    const rx = x * Math.cos(rot) - y * Math.sin(rot);
    const ry = x * Math.sin(rot) + y * Math.cos(rot);

    return {
      x: center.x + rx + (cal.offsetX ?? 0),
      y: center.y + ry + (cal.offsetY ?? 0),
    };
  };
}

// Adjust a heading so the drawn aircraft glyph matches the rotated/flipped map.
export function projectHeading(headingDeg, calibration) {
  const cal = calibration || {};
  let h = headingDeg + (cal.rotation ?? 0);
  if (cal.flipH) h = 360 - h;
  if (cal.flipV) h = 180 - h;
  return ((h % 360) + 360) % 360;
}

export function isValidTheme(name) {
  return THEME_KEYS.includes(name);
}
