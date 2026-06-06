// Above Live — aircraft symbols.
// Draws a stylized top-down aircraft glyph on a 2D canvas context, rotated to
// match its heading. The context is assumed to be already translated to the
// aircraft's screen position; this only handles the rotation + shape.

// Draw an aircraft pointing "up" (north) then rotated by headingDeg.
// size ~ overall length in pixels.
export function drawAircraft(ctx, headingDeg, size, color, glow) {
  const s = size;
  ctx.save();
  ctx.rotate((headingDeg * Math.PI) / 180);

  ctx.shadowColor = glow;
  ctx.shadowBlur = s * 0.9;
  ctx.fillStyle = color;

  // A simple jet silhouette: nose, swept wings, tail.
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.6); // nose
  ctx.lineTo(s * 0.12, -s * 0.1);
  ctx.lineTo(s * 0.6, s * 0.18); // right wingtip
  ctx.lineTo(s * 0.6, s * 0.3);
  ctx.lineTo(s * 0.12, s * 0.2);
  ctx.lineTo(s * 0.16, s * 0.5); // right tailplane
  ctx.lineTo(s * 0.3, s * 0.62);
  ctx.lineTo(s * 0.3, s * 0.72);
  ctx.lineTo(0, s * 0.6); // tail center
  ctx.lineTo(-s * 0.3, s * 0.72);
  ctx.lineTo(-s * 0.3, s * 0.62);
  ctx.lineTo(-s * 0.16, s * 0.5); // left tailplane
  ctx.lineTo(-s * 0.12, s * 0.2);
  ctx.lineTo(-s * 0.6, s * 0.3); // left wingtip
  ctx.lineTo(-s * 0.6, s * 0.18);
  ctx.lineTo(-s * 0.12, -s * 0.1);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

// Pick a label tint based on altitude so high/low traffic reads at a glance.
export function altitudeTint(altitude) {
  // 0 -> warm, 40k -> cool. Returns an rgba string.
  const t = Math.max(0, Math.min(1, altitude / 40000));
  const r = Math.round(255 - t * 130);
  const g = Math.round(200 + t * 30);
  const b = Math.round(150 + t * 105);
  return `rgba(${r}, ${g}, ${b}, 0.95)`;
}
