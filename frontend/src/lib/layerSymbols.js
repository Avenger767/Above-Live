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
  // Wide warm corona glow
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 3.5);
  glow.addColorStop(0, withAlpha(color, 0.50 * alpha));
  glow.addColorStop(0.4, withAlpha(color, 0.18 * alpha));
  glow.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, r * 3.5, 0, Math.PI * 2);
  ctx.fill();
  // 8 short radial rays with rounded caps
  ctx.strokeStyle = withAlpha(color, 0.70 * alpha);
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const cos = Math.cos(a), sin = Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(cos * r * 1.25, sin * r * 1.25);
    ctx.lineTo(cos * r * 2.1, sin * r * 2.1);
    ctx.stroke();
  }
  // Disc
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  // Limb darkening (warmer/darker at edge)
  const limb = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, r);
  limb.addColorStop(0, 'rgba(0,0,0,0)');
  limb.addColorStop(1, `rgba(80,20,0,${0.22 * alpha})`);
  ctx.fillStyle = limb;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  // Bright inner highlight
  ctx.fillStyle = `rgba(255,255,220,${0.60 * alpha})`;
  ctx.beginPath();
  ctx.arc(-r * 0.18, -r * 0.18, r * 0.38, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Phase-aware Moon. opts.phase: 0=new, 0.25=first quarter, 0.5=full, 0.75=last quarter.
function drawMoonAt(ctx, color, alpha, opts) {
  const r = 8;
  const phase = (opts && typeof opts.phase === 'number') ? opts.phase : 0.35;
  const illum = (1 - Math.cos(2 * Math.PI * phase)) / 2; // 0=new, 1=full

  ctx.save();
  ctx.globalAlpha = alpha;

  // Soft atmospheric halo
  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.2);
  halo.addColorStop(0, withAlpha(color, 0.20));
  halo.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, r * 2.2, 0, Math.PI * 2);
  ctx.fill();

  if (illum < 0.04) {
    // New moon: very dim disc only
    ctx.globalAlpha = alpha * 0.12;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  // Full lit disc
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();

  if (illum > 0.96) {
    // Full moon: nothing more to do
    ctx.restore();
    return;
  }

  // Draw dark side clipped to disc using bezier terminator technique.
  // kx: terminator ellipse x-scale (0=line/quarter, ±1=full circle/new+full).
  // waxing (phase<0.5): dark on LEFT, kx = 1-2*illum (shrinks right as moon fills).
  // waning (phase>0.5): dark on RIGHT, kx = 2*illum-1 (shrinks left as moon fades).
  const waxing = phase <= 0.5;
  const kx = waxing ? (1 - 2 * illum) : (2 * illum - 1);
  const cpX = kx * r * 0.5523; // bezier magic constant for ellipse approximation
  const cpY = r * 0.5523;

  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = `rgba(0,5,30,${0.92 * alpha})`;
  ctx.beginPath();
  if (waxing) {
    // Dark on left — arc goes CW (through left side): bottom → top
    ctx.arc(0, 0, r, Math.PI / 2, -Math.PI / 2, false);
    // Terminator: bezier from top (0,-r) to bottom (0,r) curving right when kx>0
    ctx.bezierCurveTo(cpX, -cpY, cpX, cpY, 0, r);
  } else {
    // Dark on right — arc goes CCW (through right side): bottom → top
    ctx.arc(0, 0, r, Math.PI / 2, -Math.PI / 2, true);
    // Terminator: bezier from top to bottom curving left when kx>0
    ctx.bezierCurveTo(-cpX, -cpY, -cpX, cpY, 0, r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.restore();
}

function drawVenusAt(ctx, color, alpha) {
  const r = 5;
  ctx.save();
  // Very bright glow — Venus is the brightest natural object after the Sun and Moon
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 3.2);
  glow.addColorStop(0, withAlpha(color, 0.50 * alpha));
  glow.addColorStop(0.45, withAlpha(color, 0.15 * alpha));
  glow.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, r * 3.2, 0, Math.PI * 2);
  ctx.fill();
  // Disc
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  // Decorative ring at 1.75r
  ctx.strokeStyle = withAlpha(color, 0.45 * alpha);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.75, 0, Math.PI * 2);
  ctx.stroke();
  // Four short tick marks (crosshair-style) extending beyond the ring
  ctx.strokeStyle = withAlpha(color, 0.55 * alpha);
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const cos = Math.cos(a), sin = Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(cos * r * 1.75, sin * r * 1.75);
    ctx.lineTo(cos * r * 2.2, sin * r * 2.2);
    ctx.stroke();
  }
  // Bright specular highlight (thick Venusian cloud tops)
  ctx.fillStyle = `rgba(255,255,255,${0.75 * alpha})`;
  ctx.beginPath();
  ctx.arc(-r * 0.22, -r * 0.22, r * 0.32, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawMarsAt(ctx, color, alpha) {
  const r = 4.5;
  ctx.save();
  // Rusty glow
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.6);
  glow.addColorStop(0, withAlpha(color, 0.35 * alpha));
  glow.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, r * 2.6, 0, Math.PI * 2);
  ctx.fill();
  // Disc
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  // Decorative ring
  ctx.strokeStyle = withAlpha(color, 0.40 * alpha);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.75, 0, Math.PI * 2);
  ctx.stroke();
  // Short ticks at cardinal points
  ctx.strokeStyle = withAlpha(color, 0.50 * alpha);
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const cos = Math.cos(a), sin = Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(cos * r * 1.75, sin * r * 1.75);
    ctx.lineTo(cos * r * 2.15, sin * r * 2.15);
    ctx.stroke();
  }
  ctx.restore();
}

function drawJupiterAt(ctx, color, alpha) {
  const r = 7;
  ctx.save();
  // Warm glow
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.0);
  glow.addColorStop(0, withAlpha(color, 0.25 * alpha));
  glow.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, r * 2.0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = alpha;
  // Disc
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  // Horizontal cloud bands (clipped to disc)
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = `rgba(100,58,18,${0.48 * alpha})`;
  ctx.fillRect(-r, -r * 0.56, r * 2, r * 0.36);
  ctx.fillStyle = `rgba(100,58,18,${0.32 * alpha})`;
  ctx.fillRect(-r, r * 0.15, r * 2, r * 0.28);
  ctx.restore();
  // Subtle limb darkening
  const limb = ctx.createRadialGradient(0, 0, r * 0.55, 0, 0, r);
  limb.addColorStop(0, 'rgba(0,0,0,0)');
  limb.addColorStop(1, `rgba(0,0,0,${0.22 * alpha})`);
  ctx.fillStyle = limb;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSaturnAt(ctx, color, alpha) {
  const r = 6;
  const rx = r * 2.3;  // ring semi-major axis
  const ry = r * 0.48; // ring semi-minor axis (tilted appearance)
  const tilt = 0.22;   // slight clockwise tilt for naturalism
  ctx.save();
  ctx.globalAlpha = alpha;
  // Back ring half (behind disc)
  ctx.strokeStyle = withAlpha(color, 0.58);
  ctx.lineWidth = r * 0.52;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, tilt, Math.PI, Math.PI * 2);
  ctx.stroke();
  // Disc
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  // Front ring half (on top of disc)
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, tilt, 0, Math.PI);
  ctx.stroke();
  // Cassini division suggestion on front arc
  ctx.strokeStyle = `rgba(0,0,0,${0.28 * alpha})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx * 0.80, ry * 0.80, tilt, 0, Math.PI);
  ctx.stroke();
  ctx.restore();
}

// Fallback for any planet not given a dedicated renderer.
function drawPlanetDotAt(ctx, color, alpha) {
  const r = 4;
  ctx.save();
  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.4);
  halo.addColorStop(0, withAlpha(color, 0.28 * alpha));
  halo.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, r * 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Dispatcher: draws the correct glyph for each solar system body.
// x, y are absolute canvas coordinates.
// opts: optional per-body data (e.g. opts.phase for the Moon).
export function drawSpaceBody(ctx, x, y, name, kind, color, alpha, opts) {
  ctx.save();
  ctx.translate(x, y);
  if (kind === 'sun') drawSunAt(ctx, color, alpha);
  else if (kind === 'moon') drawMoonAt(ctx, color, alpha, opts);
  else if (name === 'Venus') drawVenusAt(ctx, color, alpha);
  else if (name === 'Mars') drawMarsAt(ctx, color, alpha);
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
