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

// ---------------------------------------------------------------------------
// Calibration helpers — kept here so all projection/calibration math lives in
// one file (per project convention) rather than scattered across components.
// ---------------------------------------------------------------------------

const CALIBRATION_DEFAULTS = {
  offsetX: 0, offsetY: 0, scale: 1, rotation: 0, flipH: false, flipV: false,
};

// Merge a settings.calibration object onto safe defaults so a partial/missing
// calibration never produces NaNs in the projector.
export function getCalibration(settings) {
  return { ...CALIBRATION_DEFAULTS, ...((settings && settings.calibration) || {}) };
}

// Independent label rotation (radians). Lets text read upright from where the
// viewer lies without rotating the whole field. Looks first at
// display.labelRotationDeg, then calibration.labelRotationDeg, else 0.
export function labelRotationRad(settings) {
  const d = (settings && settings.display) || {};
  const c = (settings && settings.calibration) || {};
  const deg = Number.isFinite(d.labelRotationDeg)
    ? d.labelRotationDeg
    : Number.isFinite(c.labelRotationDeg)
      ? c.labelRotationDeg
      : 0;
  return (deg * Math.PI) / 180;
}

// A sensible starting point for a ceiling-mounted projector aimed straight up:
// mirror horizontally (so east/west read correctly when you look up at the
// ceiling) and reset offset/scale/rotation. The user can fine-tune from here.
export function ceilingPreset() {
  return { offsetX: 0, offsetY: 0, scale: 1, rotation: 0, flipH: true, flipV: false };
}

// Squawk codes that mark an emergency (hijack / radio failure / general).
export const EMERGENCY_SQUAWKS = new Set(['7500', '7600', '7700']);

export function isEmergencySquawk(squawk) {
  return squawk != null && EMERGENCY_SQUAWKS.has(String(squawk));
}
