// Above Live — aircraft symbols (type-aware, luminous).
//
// Draws a stylized top-down aircraft glyph on a 2D canvas, in the same swept-
// wing house style for all types: light singles and turboprops get spinning
// props, four-engine heavies get a wider span, helicopters get a spinning
// rotor. The classifier (classifyAircraftGlyph) maps an aircraft's ICAO type
// code (or ADS-B emitter category) to one of six kinds; anything unknown falls
// back to the airliner glyph so nothing ever disappears.
//
// Glyphs are drawn in LOCAL space: the caller translates to the aircraft's
// screen position and rotates so that -y (up) points the direction of travel,
// then calls drawAircraftShape(). This matches the projector's heading
// convention (0° = north = up).
//
// Adapted from Skylight's aircraftGlyph.ts, converted to plain JavaScript.

// --- glyph kinds & relative sizes ------------------------------------------

export const GLYPH_KINDS = ['light', 'turboprop', 'airliner', 'widebody', 'quadjet', 'helicopter'];

// Size multiplier per kind (multiplies the configured glyph size).
export const GLYPH_SCALE = {
  light: 0.62,
  turboprop: 0.86,
  airliner: 1.0,
  widebody: 1.3,
  quadjet: 1.46,
  helicopter: 0.82,
};

// ICAO type-code lookup tables (subset; enough to classify common traffic).
const HELI = new Set([
  'EC20', 'EC25', 'EC30', 'EC35', 'EC45', 'EC55', 'AS50', 'AS55', 'AS65', 'AS32',
  'A109', 'A119', 'A139', 'A169', 'A189', 'B06', 'B06T', 'B407', 'B412', 'B427',
  'B429', 'B430', 'B505', 'S76', 'S92', 'S61', 'S64', 'H60', 'H500', 'MD52',
  'MD60', 'R22', 'R44', 'R66', 'EXEC', 'EXPL', 'GAZL', 'LYNX', 'NH90', 'PUMA',
  'UH1', 'B105', 'B212', 'B214', 'B222', 'H47', 'H64',
  // additional common rotorcraft
  'B206', 'B06L', 'H125', 'H130', 'H135', 'H145', 'H160', 'H175',
  'EC12', 'EC15', 'AW09', 'AW19', 'AW16', 'S300', 'S330', 'MD50', 'MD53',
  'SK61', 'SK76', 'SK92', 'V22',
]);
const QUAD = new Set([
  'B741', 'B742', 'B743', 'B744', 'B748', 'B74S', 'B74R', 'B74D', 'A388', 'A342',
  'A343', 'A345', 'A346', 'A124', 'C5M', 'A225', 'IL96', 'B52', 'A140',
]);
const WIDE = new Set([
  'A306', 'A30B', 'A310', 'A332', 'A333', 'A338', 'A339', 'A359', 'A35K', 'B762',
  'B763', 'B764', 'B772', 'B77L', 'B773', 'B77W', 'B778', 'B779', 'B788', 'B789',
  'B78X', 'MD11', 'IL86', 'DC10', 'L101', 'B767', 'B777', 'B787',
]);
const TPROP = new Set([
  'DH8A', 'DH8B', 'DH8C', 'DH8D', 'AT43', 'AT44', 'AT45', 'AT46', 'AT72', 'AT73',
  'AT75', 'AT76', 'SF34', 'SB20', 'SW3', 'SW4', 'E110', 'E120', 'C208', 'C212',
  'C408', 'PC12', 'B190', 'BE20', 'B350', 'B300', 'JS31', 'JS32', 'JS41', 'D228',
  'D328', 'F50', 'F27', 'ATP', 'TBM7', 'TBM8', 'TBM9', 'TBM0', 'PC6', 'C441',
  'C425', 'DHC6', 'DHC7', 'C130', 'AN12', 'AN26', 'AN32', 'SH36', 'CVLT',
]);
const LIGHT = new Set([
  'C150', 'C152', 'C162', 'C172', 'C72R', 'C175', 'C177', 'C180', 'C182', 'C185',
  'C188', 'C206', 'C207', 'C210', 'C310', 'C337', 'SR20', 'SR22', 'S22T', 'PA18',
  'PA22', 'PA24', 'PA28', 'P28A', 'P28B', 'P28R', 'P28T', 'PA32', 'P32R', 'PA34',
  'PA38', 'PA44', 'PA46', 'DA20', 'DA40', 'DA42', 'DA62', 'BE33', 'BE35', 'BE36',
  'BE58', 'BE76', 'BE19', 'BE23', 'BE24', 'M20P', 'M20T', 'M20V', 'AA1', 'AA5',
  'RV4', 'RV6', 'RV7', 'RV8', 'RV9', 'RV10', 'RV12', 'RV14', 'GA8', 'G115',
  'SF50', 'C140', 'C170', 'C195', 'G120', 'TOBA', 'SIRA', 'EVSS',
]);

/**
 * Classify an aircraft into a glyph kind from its ICAO type code, with ADS-B
 * emitter-category fallbacks. Reads typeCode first, then aircraftType (Above
 * Live's legacy field). Unknown → 'airliner' (safe default).
 * @param {object} ac normalized aircraft
 * @returns {'light'|'turboprop'|'airliner'|'widebody'|'quadjet'|'helicopter'}
 */
export function classifyAircraftGlyph(ac) {
  const code = String((ac && (ac.typeCode || ac.aircraftType)) || '').toUpperCase();
  const cat = ac && ac.category;
  if (cat === 'A7' || HELI.has(code)) return 'helicopter';
  if (QUAD.has(code)) return 'quadjet';
  if (WIDE.has(code) || cat === 'A5') return 'widebody';
  if (TPROP.has(code)) return 'turboprop';
  if (LIGHT.has(code) || cat === 'A1') return 'light';
  return 'airliner';
}

// --- colour helpers --------------------------------------------------------

// Altitude colour ramp — warm low, cool high, tuned to glow on black.
// amber (ground) → gold → teal → sky blue → periwinkle → near-white (40k+).
const ALT_STOPS = [
  [0, [255, 138, 61]],
  [4000, [255, 198, 92]],
  [10000, [120, 224, 196]],
  [20000, [110, 178, 255]],
  [30000, [150, 150, 255]],
  [40000, [232, 236, 255]],
];

/**
 * Map an altitude (ft) to an [r,g,b] colour along the ramp above.
 * @param {number} altFt
 * @returns {[number,number,number]}
 */
export function altitudeRamp(altFt) {
  const alt = Number.isFinite(altFt) ? altFt : 0;
  if (alt <= ALT_STOPS[0][0]) return ALT_STOPS[0][1];
  for (let i = 1; i < ALT_STOPS.length; i++) {
    if (alt <= ALT_STOPS[i][0]) {
      const [a0, c0] = ALT_STOPS[i - 1];
      const [a1, c1] = ALT_STOPS[i];
      const f = (alt - a0) / (a1 - a0);
      return [
        c0[0] + (c1[0] - c0[0]) * f,
        c0[1] + (c1[1] - c0[1]) * f,
        c0[2] + (c1[2] - c0[2]) * f,
      ];
    }
  }
  return ALT_STOPS[ALT_STOPS.length - 1][1];
}

/** Build an rgba() string from an [r,g,b] colour and alpha. */
export function rgba(c, a) {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}

/**
 * Parse a CSS colour (hex "#7fe0ff" / "#abc", or "rgb(...)"/"rgba(...)") into
 * an [r,g,b] triple. Used to turn a theme colour into the same numeric form as
 * the altitude ramp so both paths share the drawing code. Falls back to a soft
 * blue-white if it can't parse.
 */
export function parseColorToRgb(str) {
  if (Array.isArray(str)) return str;
  const s = String(str || '').trim();
  if (s.startsWith('#')) {
    let hex = s.slice(1);
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const n = parseInt(hex, 16);
    if (Number.isFinite(n)) return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(',').map((p) => parseFloat(p));
    if (parts.length >= 3) return [parts[0], parts[1], parts[2]];
  }
  return [232, 236, 255];
}

// --- glyph drawing ---------------------------------------------------------

const col = rgba;

/**
 * Draw a glyph in local space (already translated to position and rotated so
 * "up" / -y is the direction of travel). Draws a soft halo, the glowing
 * silhouette, engines/props/rotors, and a bright core.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} kind     a glyph kind from classifyAircraftGlyph
 * @param {number} s        glyph size in px (already scaled by GLYPH_SCALE)
 * @param {[number,number,number]} color  rgb triple
 * @param {number} alpha    0..1
 * @param {number} [t=0]    frame time in seconds (animates props/rotors)
 * @param {number} [seed=0] per-aircraft phase offset so props aren't in sync
 */
export function drawAircraftShape(ctx, kind, s, color, alpha = 1, t = 0, seed = 0) {
  // Soft halo — restrained so the silhouette still reads as an aircraft.
  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 1.7);
  halo.addColorStop(0, col(color, 0.16 * alpha));
  halo.addColorStop(1, col(color, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, s * 1.7, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowColor = col(color, 0.85 * alpha);
  ctx.shadowBlur = s * 0.7;
  ctx.fillStyle = col(color, Math.min(1, alpha * 1.08));

  switch (kind) {
    case 'widebody':
      jetBody(ctx, s, { fw: 0.22, nose: -1.16, tail: 1.06, span: 1.16 });
      fillAndEngines(ctx, s, color, alpha, [0.42, 0.66]);
      core(ctx, s, alpha, 0.1);
      break;
    case 'quadjet':
      jetBody(ctx, s, { fw: 0.22, nose: -1.2, tail: 1.08, span: 1.2 });
      fillAndEngines(ctx, s, color, alpha, [0.34, 0.55, 0.74, 0.95].map((x) => x * 0.95));
      core(ctx, s, alpha, 0.1);
      break;
    case 'turboprop':
      jetBody(ctx, s, { fw: 0.2, nose: -1.0, tail: 0.96, span: 1.04, straight: true });
      ctx.fill();
      ctx.shadowBlur = 0;
      propDisc(ctx, -0.5 * s, 0.18 * s, 0.26 * s, color, alpha, t * 9 + seed);
      propDisc(ctx, 0.5 * s, 0.18 * s, 0.26 * s, color, alpha, -t * 9 + seed);
      core(ctx, s, alpha, 0.09);
      break;
    case 'light':
      lightBody(ctx, s);
      ctx.fill();
      ctx.shadowBlur = 0;
      propDisc(ctx, 0, -0.95 * s, 0.34 * s, color, alpha, t * 11 + seed);
      break;
    case 'helicopter':
      heliBody(ctx, s);
      ctx.fill();
      ctx.shadowBlur = 0;
      propDisc(ctx, 0.04 * s, 1.18 * s, 0.22 * s, color, alpha, t * 16 + seed, 2);
      mainRotor(ctx, s, color, alpha, t * 6 + seed);
      break;
    case 'airliner':
    default:
      jetBody(ctx, s, { fw: 0.2, nose: -1.06, tail: 0.98, span: 1.05 });
      fillAndEngines(ctx, s, color, alpha, [0.46]);
      core(ctx, s, alpha, 0.1);
      break;
  }
  ctx.shadowBlur = 0;
}

// Trace fuselage + swept (or straight) wings + tailplane into the current path.
function jetBody(ctx, s, o) {
  const sweep = o.straight ? 0.18 : 0.54; // wing leading-edge sweep depth
  ctx.beginPath();
  roundRect(ctx, (-o.fw * s) / 2, o.nose * s, o.fw * s, (o.tail - o.nose) * s, (o.fw * s) / 2);
  // Main wings.
  ctx.moveTo(-0.09 * s, -0.02 * s);
  ctx.lineTo(-o.span * s, sweep * s);
  ctx.lineTo(-(o.span - 0.1) * s, (sweep + 0.06) * s);
  ctx.lineTo(-0.09 * s, 0.3 * s);
  ctx.lineTo(0.09 * s, 0.3 * s);
  ctx.lineTo((o.span - 0.1) * s, (sweep + 0.06) * s);
  ctx.lineTo(o.span * s, sweep * s);
  ctx.lineTo(0.09 * s, -0.02 * s);
  ctx.closePath();
  // Tailplane.
  const ty = o.tail - 0.24;
  ctx.moveTo(-0.08 * s, ty * s);
  ctx.lineTo(-0.44 * s, (ty + 0.23) * s);
  ctx.lineTo(-0.37 * s, (ty + 0.27) * s);
  ctx.lineTo(-0.08 * s, (ty + 0.12) * s);
  ctx.lineTo(0.08 * s, (ty + 0.12) * s);
  ctx.lineTo(0.37 * s, (ty + 0.27) * s);
  ctx.lineTo(0.44 * s, (ty + 0.23) * s);
  ctx.lineTo(0.08 * s, ty * s);
  ctx.closePath();
}

// Fill the traced jet body, then add engine nacelles at the given |x| offsets.
function fillAndEngines(ctx, s, color, alpha, xs) {
  for (const ex of xs) {
    for (const sign of [-1, 1]) {
      ctx.moveTo(sign * ex * s + 0.07 * s, 0.24 * s);
      ctx.ellipse(sign * ex * s, 0.24 * s, 0.07 * s, 0.13 * s, 0, 0, Math.PI * 2);
    }
  }
  ctx.fillStyle = col(color, Math.min(1, alpha * 1.08));
  ctx.fill();
}

// Small high-wing single (Cessna-like).
function lightBody(ctx, s) {
  ctx.beginPath();
  roundRect(ctx, -0.11 * s, -0.85 * s, 0.22 * s, 1.7 * s, 0.11 * s);
  ctx.moveTo(-0.1 * s, -0.34 * s);
  ctx.lineTo(-1.0 * s, -0.18 * s);
  ctx.lineTo(-1.0 * s, -0.02 * s);
  ctx.lineTo(-0.1 * s, -0.08 * s);
  ctx.lineTo(0.1 * s, -0.08 * s);
  ctx.lineTo(1.0 * s, -0.02 * s);
  ctx.lineTo(1.0 * s, -0.18 * s);
  ctx.lineTo(0.1 * s, -0.34 * s);
  ctx.closePath();
  ctx.moveTo(-0.09 * s, 0.6 * s);
  ctx.lineTo(-0.42 * s, 0.78 * s);
  ctx.lineTo(-0.42 * s, 0.88 * s);
  ctx.lineTo(-0.09 * s, 0.74 * s);
  ctx.lineTo(0.09 * s, 0.74 * s);
  ctx.lineTo(0.42 * s, 0.88 * s);
  ctx.lineTo(0.42 * s, 0.78 * s);
  ctx.lineTo(0.09 * s, 0.6 * s);
  ctx.closePath();
}

// Helicopter: teardrop cabin + tail boom + tail fin.
function heliBody(ctx, s) {
  ctx.beginPath();
  ctx.ellipse(0, -0.15 * s, 0.34 * s, 0.55 * s, 0, 0, Math.PI * 2);
  ctx.moveTo(-0.07 * s, 0.3 * s);
  ctx.lineTo(-0.05 * s, 1.12 * s);
  ctx.lineTo(0.05 * s, 1.12 * s);
  ctx.lineTo(0.07 * s, 0.3 * s);
  ctx.closePath();
  ctx.moveTo(-0.05 * s, 1.0 * s);
  ctx.lineTo(-0.22 * s, 1.22 * s);
  ctx.lineTo(-0.05 * s, 1.22 * s);
  ctx.closePath();
}

// A spinning propeller / small rotor disc.
function propDisc(ctx, cx, cy, r, color, alpha, spin, blades = 4) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(spin);
  ctx.globalAlpha = 1;
  ctx.fillStyle = col(color, 0.14 * alpha);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = col(color, 0.7 * alpha);
  ctx.lineWidth = Math.max(1, r * 0.16);
  ctx.lineCap = 'round';
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    ctx.stroke();
  }
  ctx.fillStyle = col([255, 255, 255], 0.7 * alpha);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Large two-blade main rotor over the helicopter body.
function mainRotor(ctx, s, color, alpha, spin) {
  const r = 1.15 * s;
  ctx.save();
  ctx.translate(0, -0.15 * s);
  ctx.rotate(spin);
  ctx.fillStyle = col(color, 0.08 * alpha);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = col(color, 0.55 * alpha);
  ctx.lineWidth = Math.max(1.2, r * 0.06);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-r, 0);
  ctx.lineTo(r, 0);
  ctx.stroke();
  ctx.fillStyle = col([255, 255, 255], 0.85 * alpha);
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function core(ctx, s, alpha, r) {
  ctx.shadowBlur = 0;
  ctx.fillStyle = col([255, 255, 255], 0.75 * alpha);
  ctx.beginPath();
  ctx.arc(0, 0, s * r, 0, Math.PI * 2);
  ctx.fill();
}

// roundRect polyfill — Chromium on older Raspberry Pi OS may lack ctx.roundRect.
function roundRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
}

/** Stable per-aircraft phase offset (0..2π) so props/rotors aren't in sync. */
export function glyphSeed(id) {
  let n = 0;
  const str = String(id || '');
  for (let i = 0; i < str.length; i++) n = (n * 31 + str.charCodeAt(i)) % 360;
  return (n / 360) * Math.PI * 2;
}

// --- back-compat -----------------------------------------------------------

// Legacy entry point: draw an airliner pointing "up" then rotated by
// headingDeg, in a single colour. Kept so any caller of the old API still
// works; new code should translate+rotate and call drawAircraftShape directly.
export function drawAircraft(ctx, headingDeg, size, color, glow) {
  ctx.save();
  ctx.rotate((headingDeg * Math.PI) / 180);
  drawAircraftShape(ctx, 'airliner', size, parseColorToRgb(color), 1);
  ctx.restore();
}

// Legacy altitude tint (rgba string). Superseded by altitudeRamp([r,g,b]).
export function altitudeTint(altitude) {
  const c = altitudeRamp(altitude);
  return rgba(c, 0.95);
}
