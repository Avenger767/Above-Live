// Above Live — SkyRenderer.
// The canvas-based sky / radar display. Draws a starfield, radar rings,
// compass, fading trails, and heading-rotated aircraft glyphs with labels.
// Aircraft motion is smoothed by easing each plane's rendered position toward
// its latest reported position every animation frame.

import React, { useEffect, useRef } from 'react';
import { getTheme } from '../lib/themes.js';
import { makeProjector, projectHeading } from '../lib/projectionMath.js';
import { drawAircraft } from '../lib/aircraftSymbols.js';
import { drawSatellite, drawWindArrow } from '../lib/layerSymbols.js';
import { WeatherCard, SpaceCard } from './LayerCards.jsx';

// Deterministic starfield so stars don't twinkle-jump on every resize.
function makeStars(count, w, h, seed = 1234) {
  let s = seed;
  const rand = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  return Array.from({ length: count }, () => ({
    x: rand(),
    y: rand(),
    r: 0.3 + rand() * 1.1,
    a: 0.2 + rand() * 0.8,
  }));
}

export default function SkyRenderer({ settings, aircraft, trails, layerData, testPattern }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const stateRef = useRef({ rendered: new Map(), stars: [], w: 0, h: 0 });

  // Keep the freshest props available to the animation loop without restarting it.
  const propsRef = useRef({ settings, aircraft, trails, layerData, testPattern });
  propsRef.current = { settings, aircraft, trails, layerData, testPattern };

  const layers = settings.layers || {};
  const ld = layerData || {};

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let raf = 0;
    let lastFrame = performance.now();

    function resize() {
      const wrap = wrapRef.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const st = stateRef.current;
      st.w = w;
      st.h = h;
      st.stars = makeStars(Math.round((w * h) / 6000), w, h);
    }

    const ro = new ResizeObserver(resize);
    ro.observe(wrapRef.current);
    resize();

    function frame(now) {
      const dt = Math.min(0.1, (now - lastFrame) / 1000);
      lastFrame = now;
      draw(ctx, stateRef.current, propsRef.current, dt);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={wrapRef} className="sky-wrap">
      <canvas ref={canvasRef} />
      {/* Subtle corner info cards for optional layers (only when enabled). */}
      {layers.weather && ld.weather && <WeatherCard weather={ld.weather} />}
      {layers.space && ld.space && <SpaceCard space={ld.space} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------
function draw(ctx, st, props, dt) {
  const { settings, aircraft, trails, layerData, testPattern } = props;
  const { w, h } = st;
  if (!w || !h) return;

  const theme = getTheme(settings.display.theme);
  const brightness = settings.display.brightness ?? 1;
  const center = { x: w / 2, y: h / 2 };
  const radiusPx = Math.min(w, h) / 2 - Math.min(w, h) * 0.06;
  const rangeNm = settings.rangeNm || 60;
  const cal = settings.calibration || {};
  const layers = settings.layers || {};
  const ld = layerData || {};

  // --- Background gradient ---
  const grad = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, Math.max(w, h) * 0.7);
  grad.addColorStop(0, theme.bgInner);
  grad.addColorStop(1, theme.bgOuter);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // --- Starfield (optional "stars" layer; on by default) ---
  if (layers.stars !== false) {
    ctx.save();
    ctx.globalAlpha = 0.6 * brightness;
    for (const s of st.stars) {
      ctx.beginPath();
      ctx.fillStyle = theme.star;
      ctx.globalAlpha = s.a * 0.6 * brightness;
      ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // --- Radar rings + range labels ---
  ctx.save();
  ctx.globalAlpha = brightness;
  ctx.lineWidth = 1;
  const rings = 4;
  for (let i = 1; i <= rings; i++) {
    const r = (radiusPx * i) / rings;
    ctx.beginPath();
    ctx.strokeStyle = theme.ring;
    ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
    ctx.stroke();
    // Range label on each ring.
    ctx.fillStyle = theme.ringText;
    ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${Math.round((rangeNm * i) / rings)} nm`, center.x + 4, center.y - r + 12);
  }
  // Cross-hairs.
  ctx.strokeStyle = theme.ring;
  ctx.beginPath();
  ctx.moveTo(center.x - radiusPx, center.y);
  ctx.lineTo(center.x + radiusPx, center.y);
  ctx.moveTo(center.x, center.y - radiusPx);
  ctx.lineTo(center.x, center.y + radiusPx);
  ctx.stroke();
  ctx.restore();

  // --- Compass markers N / E / S / W ---
  ctx.save();
  ctx.globalAlpha = brightness;
  ctx.fillStyle = theme.compass;
  ctx.font = 'bold 16px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const off = radiusPx + 16;
  ctx.fillText('N', center.x, center.y - off);
  ctx.fillText('S', center.x, center.y + off);
  ctx.fillText('E', center.x + off, center.y);
  ctx.fillText('W', center.x - off, center.y);
  ctx.restore();

  // --- Center marker (home) ---
  ctx.save();
  ctx.globalAlpha = brightness;
  ctx.fillStyle = theme.center;
  ctx.shadowColor = theme.aircraftGlow;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(center.x, center.y, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // --- Calibration test pattern (overrides aircraft when active) ---
  if (testPattern) {
    drawTestPattern(ctx, w, h, center, radiusPx, theme, brightness);
    return;
  }

  // --- Aircraft + trails ---
  const project = makeProjector({ home: settings.home, rangeNm, center, radiusPx, calibration: cal });
  const size = 14 * (settings.display.aircraftSize ?? 1);
  const showLabels = settings.display.labels !== false;
  const showTrails = settings.display.trails !== false;

  // Smoothly ease rendered lat/lon toward reported positions.
  const seen = new Set();
  const lerpK = Math.min(1, dt * 6); // ease factor
  for (const ac of aircraft || []) {
    seen.add(ac.id);
    let r = st.rendered.get(ac.id);
    if (!r) {
      r = { lat: ac.lat, lon: ac.lon };
      st.rendered.set(ac.id, r);
    } else {
      r.lat += (ac.lat - r.lat) * lerpK;
      r.lon += (ac.lon - r.lon) * lerpK;
    }
  }
  for (const id of [...st.rendered.keys()]) if (!seen.has(id)) st.rendered.delete(id);

  // Trails first (under the glyphs).
  if (showTrails && trails) {
    ctx.save();
    ctx.globalAlpha = brightness;
    ctx.lineWidth = 1.6;
    for (const ac of aircraft || []) {
      const pts = trails[ac.id];
      if (!pts || pts.length < 2) continue;
      for (let i = 1; i < pts.length; i++) {
        const a = project(pts[i - 1].lat, pts[i - 1].lon);
        const b = project(pts[i].lat, pts[i].lon);
        const fade = i / pts.length; // newer = brighter
        ctx.strokeStyle = theme.trail;
        ctx.globalAlpha = fade * 0.55 * brightness;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // Aircraft glyphs + labels.
  ctx.save();
  ctx.globalAlpha = brightness;
  for (const ac of aircraft || []) {
    const r = st.rendered.get(ac.id);
    const p = project(r.lat, r.lon);

    // Cull anything far off-screen.
    if (p.x < -60 || p.x > w + 60 || p.y < -60 || p.y > h + 60) continue;

    const hdg = projectHeading(ac.heading, cal);

    ctx.save();
    ctx.translate(p.x, p.y);
    drawAircraft(ctx, hdg, size, theme.aircraft, theme.aircraftGlow);
    ctx.restore();

    if (showLabels) {
      ctx.shadowBlur = 0;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const lx = p.x + size * 0.7;
      const ly = p.y - size * 0.6;
      ctx.font = 'bold 12px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = theme.label;
      ctx.fillText(ac.callsign, lx, ly);
      ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = theme.labelDim;
      const fl = Math.round(ac.altitude / 100); // flight level
      const dist = ac.distanceNm != null ? `${ac.distanceNm}nm` : '';
      ctx.fillText(`FL${fl}  ${ac.speed}kt`, lx, ly + 14);
      if (dist) ctx.fillText(dist, lx, ly + 26);
    }
  }
  ctx.restore();

  // --- Optional layers (subtle; must never overpower aircraft) -------------

  // Weather: faint cloud/haze wash + rain tint + a small wind arrow. The in-sky
  // cards (temp/condition) are DOM overlays; this is just the ambient feel.
  if (layers.weather && ld.weather) {
    const wx = ld.weather;
    const cloud = Math.max(0, Math.min(100, wx.cloudCover || 0)) / 100;
    if (cloud > 0.05) {
      ctx.save();
      // Cap the wash low so the display stays readable.
      ctx.globalAlpha = cloud * 0.10 * brightness;
      ctx.fillStyle = theme.cloud;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
    if ((wx.precipitation || 0) > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.12, 0.04 + wx.precipitation * 0.02) * brightness;
      ctx.fillStyle = 'rgba(80, 120, 200, 1)'; // cool rain tint
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
    if (Number.isFinite(wx.windDirection)) {
      drawWindArrow(ctx, 56, h - 56, wx.windDirection, theme.wind, 26);
      ctx.save();
      ctx.globalAlpha = 0.8 * brightness;
      ctx.fillStyle = theme.labelDim;
      ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.round(wx.windSpeed || 0)}kt`, 56, h - 28);
      ctx.restore();
    }
  }

  // Satellites / ISS: distinct icon + glow, clearly not aircraft. Projected the
  // same way; most pass outside radar range and are simply culled (the card
  // still reports them). Mock provider keeps a couple near home for demos.
  if (layers.satellites && Array.isArray(ld.satellites) && ld.satellites.length) {
    const satSize = 9 * (settings.display.aircraftSize ?? 1);
    ctx.save();
    ctx.globalAlpha = brightness;
    for (const sat of ld.satellites) {
      const p = project(sat.lat, sat.lon);
      if (p.x < -40 || p.x > w + 40 || p.y < -40 || p.y > h + 40) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      drawSatellite(ctx, satSize, theme.satellite, theme.satelliteGlow);
      ctx.restore();
      if (showLabels) {
        ctx.shadowBlur = 0;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.font = 'bold 11px ui-monospace, Menlo, Consolas, monospace';
        ctx.fillStyle = theme.satellite;
        ctx.fillText(sat.name || sat.id, p.x + satSize, p.y - satSize * 0.6);
      }
    }
    ctx.restore();
  }
}

// Calibration test pattern: grid + center dot + outer ring + compass + corners.
function drawTestPattern(ctx, w, h, center, radiusPx, theme, brightness) {
  ctx.save();
  ctx.globalAlpha = brightness;

  // Grid.
  ctx.strokeStyle = theme.ring;
  ctx.lineWidth = 1;
  const step = Math.max(40, Math.min(w, h) / 14);
  ctx.beginPath();
  for (let x = center.x % step; x < w; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let y = center.y % step; y < h; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();

  // Outer ring.
  ctx.strokeStyle = theme.compass;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
  ctx.stroke();

  // Center dot + crosshair.
  ctx.strokeStyle = theme.center;
  ctx.beginPath();
  ctx.moveTo(center.x - 24, center.y);
  ctx.lineTo(center.x + 24, center.y);
  ctx.moveTo(center.x, center.y - 24);
  ctx.lineTo(center.x, center.y + 24);
  ctx.stroke();
  ctx.fillStyle = theme.center;
  ctx.beginPath();
  ctx.arc(center.x, center.y, 5, 0, Math.PI * 2);
  ctx.fill();

  // Compass markers.
  ctx.fillStyle = theme.compass;
  ctx.font = 'bold 18px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const off = radiusPx + 18;
  ctx.fillText('N', center.x, center.y - off);
  ctx.fillText('S', center.x, center.y + off);
  ctx.fillText('E', center.x + off, center.y);
  ctx.fillText('W', center.x - off, center.y);

  // Corner markers.
  const m = 14;
  ctx.strokeStyle = theme.aircraft;
  ctx.lineWidth = 3;
  const corner = (cx, cy, dx, dy) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy + dy * m);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + dx * m, cy);
    ctx.stroke();
  };
  const pad = 8;
  corner(pad, pad, 1, 1);
  corner(w - pad, pad, -1, 1);
  corner(pad, h - pad, 1, -1);
  corner(w - pad, h - pad, -1, -1);

  ctx.restore();
}
