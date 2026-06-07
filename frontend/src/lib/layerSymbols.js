// Above Live — optional-layer canvas symbols.
// Small, self-contained drawing helpers for the optional layers so they read as
// clearly distinct from aircraft and never overpower them.

// Satellite glyph: small diamond body + two thin solar-panel bars.
// Context is pre-translated to position.
export function drawSatellite(ctx, size, color, glow) {
  const s = size;
  ctx.save();
  ctx.shadowColor = glow;
  ctx.shadowBlur = s * 1.2;
  ctx.fillStyle = color;

  // Solar panels (two thin bars either side).
  ctx.globalAlpha = 0.8;
  ctx.fillRect(-s * 0.9, -s * 0.14, s * 0.45, s * 0.28);
  ctx.fillRect(s * 0.45, -s * 0.14, s * 0.45, s * 0.28);

  // Diamond core (rotated square).
  ctx.globalAlpha = 1;
  ctx.save();
  ctx.rotate(Math.PI / 4);
  ctx.fillRect(-s * 0.25, -s * 0.25, s * 0.5, s * 0.5);
  ctx.restore();

  // White center highlight.
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.1, 0, Math.PI * 2);
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

// Per-body tint used for celestial objects (physically suggestive, not exact).
export const CELESTIAL_COLORS = {
  Sun: '#ffd36b',
  Moon: '#dfe6f0',
  Venus: '#fff1c9',
  Mars: '#ff7a59',
  Jupiter: '#f2d9b0',
  Saturn: '#e8d49a',
};

// ── Per-body drawing helpers (all drawn at canvas origin; caller translates) ──

function drawSunAt(ctx, color, alpha) {
  const r = 9;
  ctx.save();
  // Outer corona glow
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 3.2);
  glow.addColorStop(0, withAlpha(color, 0.42 * alpha));
  glow.addColorStop(0.5, withAlpha(color, 0.1 * alpha));
  glow.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, r * 3.2, 0, Math.PI * 2);
  ctx.fill();
  // 8 radial rays
  ctx.strokeStyle = withAlpha(color, 0.65 * alpha);
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 1.3, Math.sin(a) * r * 1.3);
    ctx.lineTo(Math.cos(a) * r * 2.4, Math.sin(a) * r * 2.4);
    ctx.stroke();
  }
  // Disc
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  // Bright highlight
  ctx.fillStyle = 'rgba(255,255,220,0.55)';
  ctx.beginPath();
  ctx.arc(-r * 0.2, -r * 0.2, r * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawMoonAt(ctx, color, alpha) {
  const r = 8;
  ctx.save();
  ctx.globalAlpha = alpha;
  // Soft halo
  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.5);
  halo.addColorStop(0, withAlpha(color, 0.22));
  halo.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, r * 2.5, 0, Math.PI * 2);
  ctx.fill();
  // Lit disc
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  // Phase shading: dark gradient offset to the right to suggest a crescent
  const shade = ctx.createRadialGradient(r * 0.45, 0, 0, r * 0.45, 0, r * 1.35);
  shade.addColorStop(0, `rgba(0,5,25,${0.78 * alpha})`);
  shade.addColorStop(0.55, `rgba(0,5,25,${0.28 * alpha})`);
  shade.addColorStop(1, `rgba(0,5,25,0)`);
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawJupiterAt(ctx, color, alpha) {
  const r = 5.5;
  ctx.save();
  ctx.globalAlpha = alpha;
  // Disc
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  // Two horizontal cloud bands (clipped to disc)
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = `rgba(110,72,36,${0.4 * alpha})`;
  ctx.fillRect(-r, -r * 0.42, r * 2, r * 0.32);
  ctx.fillRect(-r, r * 0.14, r * 2, r * 0.3);
  ctx.restore();
  ctx.restore();
}

function drawSaturnAt(ctx, color, alpha) {
  const r = 5.5;
  ctx.save();
  ctx.globalAlpha = alpha;
  // Back half of ring (behind the disc)
  ctx.strokeStyle = withAlpha(color, 0.6);
  ctx.lineWidth = r * 0.4;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 2.0, r * 0.52, 0, Math.PI, Math.PI * 2);
  ctx.stroke();
  // Disc
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  // Front half of ring (on top of disc)
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 2.0, r * 0.52, 0, 0, Math.PI);
  ctx.stroke();
  ctx.restore();
}

function drawPlanetDotAt(ctx, color, alpha) {
  const r = 4.5;
  ctx.save();
  // Glow halo
  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.4);
  halo.addColorStop(0, withAlpha(color, 0.28 * alpha));
  halo.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, r * 2.4, 0, Math.PI * 2);
  ctx.fill();
  // Disc
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Dispatcher: draws the correct glyph for each solar system body.
// x, y are absolute canvas coordinates.
export function drawSpaceBody(ctx, x, y, name, kind, color, alpha) {
  ctx.save();
  ctx.translate(x, y);
  if (kind === 'sun') drawSunAt(ctx, color, alpha);
  else if (kind === 'moon') drawMoonAt(ctx, color, alpha);
  else if (name === 'Jupiter') drawJupiterAt(ctx, color, alpha);
  else if (name === 'Saturn') drawSaturnAt(ctx, color, alpha);
  else drawPlanetDotAt(ctx, color, alpha);
  ctx.restore();
}

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
