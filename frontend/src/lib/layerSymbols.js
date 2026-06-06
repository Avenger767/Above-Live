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
