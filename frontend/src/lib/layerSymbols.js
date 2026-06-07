// Above Live — optional-layer canvas symbols.
// Small, self-contained drawing helpers for the optional layers so they read as
// clearly distinct from aircraft and never overpower them.

// Satellite glyph: a small bright core with two "solar panels", deliberately
// different from the aircraft jet shape. Context is pre-translated to position.
export function drawSatellite(ctx, size, color, glow) {
  const s = size;
  ctx.save();
  ctx.shadowColor = glow;
  ctx.shadowBlur = s * 1.2;

  // Solar panels (two thin bars either side).
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(-s * 0.9, -s * 0.18, s * 0.5, s * 0.36);
  ctx.fillRect(s * 0.4, -s * 0.18, s * 0.5, s * 0.36);

  // Bright core.
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.3, 0, Math.PI * 2);
  ctx.fill();

  // Subtle white center highlight.
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ISS glyph: a brighter satellite with a wider panel span and a cross-shaped
// truss, so it reads as distinct from generic satellites. Context pre-translated.
export function drawIss(ctx, size, color, glow) {
  const s = size;
  ctx.save();
  ctx.shadowColor = glow;
  ctx.shadowBlur = s * 1.6;
  ctx.fillStyle = color;

  // Long solar truss (horizontal) + panels.
  ctx.globalAlpha = 0.9;
  ctx.fillRect(-s * 1.3, -s * 0.1, s * 2.6, s * 0.2);
  ctx.globalAlpha = 0.8;
  ctx.fillRect(-s * 1.25, -s * 0.32, s * 0.5, s * 0.64);
  ctx.fillRect(s * 0.75, -s * 0.32, s * 0.5, s * 0.64);
  // Central module.
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.34, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Starlink: a tiny, faint dot — many of them, so deliberately minimal so they
// never compete with aircraft. Context pre-translated to position.
export function drawStarlinkDot(ctx, size, color, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(1, size * 0.5), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Celestial body (sun / moon / planet) drawn at (x,y). Subtle soft disc with a
// faint halo. `kind` selects sizing; `color` is the body's tint.
export function drawCelestial(ctx, x, y, kind, color, alpha) {
  const r = kind === 'sun' ? 9 : kind === 'moon' ? 8 : 4.5;
  ctx.save();
  ctx.translate(x, y);
  // Halo.
  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.4);
  halo.addColorStop(0, withAlpha(color, 0.28 * alpha));
  halo.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, r * 2.4, 0, Math.PI * 2);
  ctx.fill();
  // Disc.
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Per-body tint used for celestial objects (physically suggestive, not exact).
export const CELESTIAL_COLORS = {
  Sun: '#ffd36b',
  Moon: '#dfe6f0',
  Venus: '#fff1c9',
  Mars: '#ff7a59',
  Jupiter: '#f2d9b0',
  Saturn: '#e8d49a',
};

// Add an alpha to a hex color "#rrggbb" → rgba string.
function withAlpha(hex, a) {
  const s = String(hex).replace('#', '');
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

// Wind arrow drawn at (x,y), pointing in the direction the wind blows TO.
// Meteorological wind direction is the direction it comes FROM, so we add 180°.
export function drawWindArrow(ctx, x, y, fromDeg, color, len = 26) {
  const toRad = (Math.PI / 180) * (fromDeg + 180);
  const dx = Math.sin(toRad);
  const dy = -Math.cos(toRad);
  const x2 = x + dx * len;
  const y2 = y + dy * len;

  ctx.save();
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;

  // Shaft.
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  // Arrow head.
  const a = Math.atan2(dy, dx);
  const h = 7;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - h * Math.cos(a - 0.4), y2 - h * Math.sin(a - 0.4));
  ctx.lineTo(x2 - h * Math.cos(a + 0.4), y2 - h * Math.sin(a + 0.4));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
