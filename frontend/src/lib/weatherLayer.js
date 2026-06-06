// Above Live — weather layer.
// Draws a subtle, projection-friendly weather overlay over the radar disc:
//   • cloud cover  → soft drifting blobs whose density scales with cover %
//   • wind         → an arrow through the center showing direction + strength
//   • precipitation→ animated falling streaks when it's raining/snowing
//   • a compact badge with condition, temperature and wind in the corner.
// `now` is a millisecond timestamp used to animate clouds and rain.

// Deterministic pseudo-random so cloud blobs are stable frame to frame.
function rand(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export function drawWeather(ctx, weather, geom, theme, brightness, now) {
  if (!weather) return;
  const { w, h, center, radiusPx } = geom;
  const cover = (weather.cloudCover ?? 0) / 100;
  const t = now / 1000;

  // --- Cloud cover: soft blobs drifting across the disc --------------------
  if (cover > 0.05) {
    ctx.save();
    // Clip to the radar disc so clouds stay inside the scope.
    ctx.beginPath();
    ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
    ctx.clip();

    const blobs = Math.round(4 + cover * 10);
    const drift = (t * 8) % (radiusPx * 2.4);
    for (let i = 0; i < blobs; i++) {
      const bx = center.x - radiusPx + ((rand(i + 1) * radiusPx * 2.4 + drift) % (radiusPx * 2.4));
      const by = center.y - radiusPx + rand(i + 99) * radiusPx * 2;
      const br = radiusPx * (0.18 + rand(i + 7) * 0.22);
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      g.addColorStop(0, theme.cloud);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = brightness * (0.5 + cover * 0.5);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // --- Wind arrow (points the way the wind is blowing TO) ------------------
  if ((weather.windSpeed ?? 0) > 0) {
    // Meteorological windDir is the direction wind comes FROM; arrow points to.
    const toDeg = (weather.windDir + 180) % 360;
    const a = (toDeg * Math.PI) / 180;
    const len = Math.min(radiusPx * 0.5, radiusPx * 0.18 + weather.windSpeed * 2.2);
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    const x0 = center.x - dx * len * 0.5;
    const y0 = center.y - dy * len * 0.5;
    const x1 = center.x + dx * len * 0.5;
    const y1 = center.y + dy * len * 0.5;

    ctx.save();
    ctx.globalAlpha = brightness * 0.85;
    ctx.strokeStyle = theme.wind;
    ctx.fillStyle = theme.wind;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    // Arrowhead.
    const ah = 9;
    const left = a + Math.PI * 0.75;
    const right = a - Math.PI * 0.75;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 + Math.sin(left) * ah, y1 - Math.cos(left) * ah);
    ctx.lineTo(x1 + Math.sin(right) * ah, y1 - Math.cos(right) * ah);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // --- Precipitation: animated streaks falling with the wind ---------------
  if ((weather.precipitation ?? 0) > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
    ctx.clip();

    const drops = Math.round(40 + Math.min(120, weather.precipitation * 120));
    const speed = 220 + weather.precipitation * 60;
    const lean = Math.sin(((weather.windDir + 180) % 360) * Math.PI / 180) * 6;
    ctx.strokeStyle = theme.precip;
    ctx.globalAlpha = brightness * 0.6;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < drops; i++) {
      const px = center.x - radiusPx + rand(i + 3) * radiusPx * 2;
      const span = radiusPx * 2;
      const py = center.y - radiusPx + ((rand(i + 17) * span + t * speed) % span);
      ctx.moveTo(px, py);
      ctx.lineTo(px + lean, py + 10);
    }
    ctx.stroke();
    ctx.restore();
  }

  // --- Weather badge (corner) ---------------------------------------------
  ctx.save();
  ctx.globalAlpha = brightness;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const bx = 14;
  const by = h - 64;
  ctx.font = 'bold 13px ui-monospace, Menlo, Consolas, monospace';
  ctx.fillStyle = theme.label;
  ctx.fillText(`${weather.condition}`, bx, by);
  ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
  ctx.fillStyle = theme.labelDim;
  ctx.fillText(`${weather.tempF}°F  ·  ${weather.cloudCover}% cloud`, bx, by + 16);
  ctx.fillText(`wind ${weather.windSpeed}kt @ ${weather.windDir}°`, bx, by + 30);
  ctx.restore();
}
