// Above Live — space symbols.
// Draws satellite and ISS glyphs on the sky-dome overlay. The context is assumed
// to be translated to the object's screen position; these only draw the shape.

// A small satellite: central body with two solar-panel wings.
export function drawSatellite(ctx, size, color, glow) {
  const s = size;
  ctx.save();
  ctx.shadowColor = glow;
  ctx.shadowBlur = s * 0.8;

  // Solar panels (left + right wings).
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.8;
  ctx.fillRect(-s * 0.9, -s * 0.22, s * 0.55, s * 0.44);
  ctx.fillRect(s * 0.35, -s * 0.22, s * 0.55, s * 0.44);

  // Body.
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.28, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// The ISS: a brighter, larger glyph with a truss + panels and a pulsing ring so
// it stands out as the live, crewed station. `pulse` is 0..1 (animation phase).
export function drawISS(ctx, size, color, glow, pulse = 0) {
  const s = size * 1.5; // ISS reads larger than generic satellites
  ctx.save();
  ctx.shadowColor = glow;
  ctx.shadowBlur = s * 1.1;
  ctx.fillStyle = color;

  // Long solar-array truss (horizontal).
  ctx.globalAlpha = 0.85;
  ctx.fillRect(-s * 1.0, -s * 0.12, s * 2.0, s * 0.24);
  // Four panel blocks.
  ctx.fillRect(-s * 0.95, -s * 0.34, s * 0.4, s * 0.68);
  ctx.fillRect(s * 0.55, -s * 0.34, s * 0.4, s * 0.68);

  // Core module (vertical).
  ctx.globalAlpha = 1;
  ctx.fillRect(-s * 0.13, -s * 0.45, s * 0.26, s * 0.9);

  // Pulsing ring to draw the eye.
  ctx.globalAlpha = 0.5 * (1 - pulse);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(0, 0, s * (0.8 + pulse * 1.4), 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}
