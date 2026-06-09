// Above Live — SkyRenderer.
// Canvas-based sky / radar display. Draws a starfield, radar rings, compass,
// fading comet trails, and heading-rotated, type-aware aircraft glyphs with
// labels. Display modes (projector / radar / ambient / calibration) are applied
// via getModeConfig, which returns per-element alpha values and render flags.
//
// Motion: instead of drawing each once-per-second snapshot directly (which
// makes planes "snap"), every fix is stamped with its arrival time and pushed
// to a per-aircraft history (frontend/src/lib/aircraftMotion.js). We render the
// world slightly in the past and interpolate between known fixes, so motion is
// smooth and never guesses. Performance is bounded by a maxFps cap so the loop
// stays light on a Raspberry Pi 4.

import React, { useEffect, useRef } from 'react';
import { getTheme } from '../lib/themes.js';
import { getModeConfig, getRadarOverlay, getCelestialBrightness } from '../lib/displayModes.js';
import {
  makeProjector,
  makeSkyProjector,
  projectHeading,
  getCalibration,
  getAircraftCalibration,
  getCelestialCalibration,
  labelRotationRad,
  isEmergencySquawk,
} from '../lib/projectionMath.js';
import {
  classifyAircraftGlyph,
  GLYPH_SCALE,
  drawAircraftShape,
  altitudeRamp,
  parseColorToRgb,
  rgba,
  glyphSeed,
} from '../lib/aircraftSymbols.js';
import {
  drawSatellite,
  drawWindArrow,
  drawIss,
  drawStarlinkDot,
  drawSpaceBody,
  CELESTIAL_COLORS,
} from '../lib/layerSymbols.js';
import { WeatherCard, SpaceCard } from './LayerCards.jsx';
import {
  updateAircraftTracks,
  sampleAircraftTrack,
  sampleTrackHeading,
  smoothHeading,
  pruneStaleTracks,
  updateTrackLife,
  staleMsFromSettings,
  renderDelayMs,
  effectiveMotionSettings,
  deadReckonBack,
  trailWindowMsFromSettings,
} from '../lib/aircraftMotion.js';

// Max trail segments drawn per aircraft. Longer trail windows are thinned down
// to this many points so a 600 s trail costs the same to draw as a short one
// (Raspberry Pi friendly).
const MAX_TRAIL_SEGMENTS = 48;

const WARN_RGB = [255, 90, 71]; // emergency highlight colour

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

// NOTE: `trails` (the backend trailStore snapshot) is accepted for backward
// compatibility but is no longer used for drawing — smooth comet trails are now
// built from each track's own fix history in the motion model (see the trails
// block in draw()). The prop is kept so the backend trail feed stays available
// for future history/status features without changing this component's API.
export default function SkyRenderer({ settings, aircraft, trails, layerData, testPattern, onStats }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  // Persistent renderer state: per-aircraft motion tracks live here so they
  // survive React re-renders.
  const stateRef = useRef({
    tracks: new Map(),
    stars: [],
    w: 0,
    h: 0,
    lastAircraftRef: null, // identity of the last ingested aircraft array
    nextFrameDue: 0,       // schedule anchor for the maxFps cap
    frameT: 0,             // current frame time (s), animates props/rotors
    labelBoxes: [],        // placed label rects this frame (collision avoidance)
  });

  const propsRef = useRef({ settings, aircraft, trails, layerData, testPattern, onStats });
  propsRef.current = { settings, aircraft, trails, layerData, testPattern, onStats };

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
      raf = requestAnimationFrame(frame);

      // --- maxFps cap (Raspberry Pi friendly) ---
      // 0 = uncapped (draw every rAF tick). Otherwise advance a running "due"
      // time by whole frame intervals so cadence is even and skips whole frames
      // rather than doing pointless redraws.
      const st = stateRef.current;
      const fps = Number(propsRef.current.settings?.display?.maxFps);
      if (Number.isFinite(fps) && fps > 0) {
        const interval = 1000 / fps;
        if (st.nextFrameDue === 0) st.nextFrameDue = now;
        if (now < st.nextFrameDue) return; // not due yet — skip this tick
        st.nextFrameDue += interval;
        // If we've fallen >1 frame behind (tab backgrounded / a slow draw),
        // resync so we don't burst a pile of catch-up frames.
        if (now - st.nextFrameDue > interval) st.nextFrameDue = now + interval;
      } else {
        st.nextFrameDue = 0;
      }

      const dt = Math.min(0.1, (now - lastFrame) / 1000);
      lastFrame = now;
      draw(ctx, st, propsRef.current, dt, now);
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
      {layers.weather && ld.weather && <WeatherCard weather={ld.weather} />}
      {layers.space && ld.space && <SpaceCard space={ld.space} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Motion ingest: fold a fresh aircraft snapshot into the track store, but only
// when the array reference actually changed (App passes a new array each WS
// tick). Sampling/interpolation happens every frame regardless.
// ---------------------------------------------------------------------------
function ingestIfNew(st, effSettings, aircraft, now) {
  if (aircraft && aircraft !== st.lastAircraftRef) {
    updateAircraftTracks(st.tracks, aircraft, now, effSettings);
    st.lastAircraftRef = aircraft;
  }
  pruneStaleTracks(st.tracks, now, staleMsFromSettings(effSettings));
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------
function draw(ctx, st, props, dt, nowMs) {
  const { settings, aircraft, layerData, testPattern } = props;
  const { w, h } = st;
  if (!w || !h) return;

  st.frameT = nowMs / 1000;

  const theme = getTheme(settings.display.theme);
  const brightness = settings.display.brightness ?? 1;
  const displayMode = settings.display.displayMode || 'normal';
  const brightnessMap = settings.display.brightnessMap || {};
  const mc = getModeConfig(displayMode, brightness, brightnessMap);

  const center = { x: w / 2, y: h / 2 };
  const radiusPx = Math.min(w, h) / 2 - Math.min(w, h) * 0.06;
  const rangeNm = settings.rangeNm || 60;
  // Three calibrations, all driven by data coordinates (positions never change):
  //   cal          — base mounting transform (rotation/flip/offset/scale), used
  //                  for orbital objects (satellites / ISS / Starlink).
  //   aircraftCal  — base + independent aircraft scale/offset (aircraft only).
  //   celestialCal — base + independent celestial scale/offset (Sun/Moon/planets).
  const cal = getCalibration(settings);
  const aircraftCal = getAircraftCalibration(settings);
  const celestialCal = getCelestialCalibration(settings);
  const layers = settings.layers || {};
  const ld = layerData || {};

  // Apply provider-aware motion overrides (API feeds poll every ~60 s, so we
  // extend extrapolation and stale windows so planes keep moving between fetches).
  const effSettings = effectiveMotionSettings(settings);

  // Always keep the motion model fed + pruned, even in calibration mode, so the
  // sample aircraft in the debug overlay move smoothly too.
  const now = nowMs;
  ingestIfNew(st, effSettings, aircraft, now);
  updateTrackLife(st.tracks, now, dt, effSettings);

  // --- Background ---
  if (mc.solidBlack) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
  } else {
    const grad = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, Math.max(w, h) * 0.7);
    grad.addColorStop(0, theme.bgInner);
    grad.addColorStop(1, theme.bgOuter);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  // --- Starfield (optional layer; on by default) ---
  if (layers.stars !== false && mc.starBase > 0) {
    ctx.save();
    ctx.fillStyle = theme.star;
    for (const s of st.stars) {
      ctx.globalAlpha = Math.min(1, s.a * mc.starBase);
      ctx.beginPath();
      ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Projector/radar modes use brighter ring colors so rings read on a wall.
  const ringColor     = mc.brightRings ? (theme.ringBright     || theme.ring)     : theme.ring;
  const ringTextColor = mc.brightRings ? (theme.ringTextBright || theme.ringText) : theme.ringText;
  const compassColor  = mc.brightRings ? (theme.ringTextBright || theme.compass)  : theme.compass;

  // Radar/compass overlay element visibility (object layers are unaffected).
  // Lets the user switch between a technical radar look and a clean live-sky
  // look without touching aircraft / satellite / planet rendering.
  const radarOverlay = getRadarOverlay(settings);

  // --- Radar rings + range (nautical-mile) labels ---
  if (mc.rings > 0 && (radarOverlay.rings || radarOverlay.nmLabels)) {
    ctx.save();
    ctx.globalAlpha = mc.rings;
    ctx.lineWidth = mc.brightRings ? 1.5 : 1;
    const ringCount = 4;
    for (let i = 1; i <= ringCount; i++) {
      const r = (radiusPx * i) / ringCount;
      if (radarOverlay.rings) {
        ctx.beginPath();
        ctx.strokeStyle = ringColor;
        ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (radarOverlay.nmLabels) {
        ctx.fillStyle = ringTextColor;
        ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`${Math.round((rangeNm * i) / ringCount)} nm`, center.x + 4, center.y - r + 12);
      }
    }
    ctx.restore();
  }

  // --- Center crosshair lines ---
  if (mc.rings > 0 && radarOverlay.crosshair) {
    ctx.save();
    ctx.globalAlpha = mc.rings;
    ctx.lineWidth = mc.brightRings ? 1.5 : 1;
    ctx.strokeStyle = ringColor;
    ctx.beginPath();
    ctx.moveTo(center.x - radiusPx, center.y);
    ctx.lineTo(center.x + radiusPx, center.y);
    ctx.moveTo(center.x, center.y - radiusPx);
    ctx.lineTo(center.x, center.y + radiusPx);
    ctx.stroke();
    ctx.restore();
  }

  // --- Compass markers N / E / S / W ---
  if (mc.compass > 0 && radarOverlay.compass) {
    ctx.save();
    ctx.globalAlpha = mc.compass;
    ctx.fillStyle = compassColor;
    ctx.font = 'bold 16px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const off = radiusPx + 16;
    ctx.fillText('N', center.x, center.y - off);
    ctx.fillText('S', center.x, center.y + off);
    ctx.fillText('E', center.x + off, center.y);
    ctx.fillText('W', center.x - off, center.y);
    ctx.restore();
  }

  // --- Center marker (home) ---
  ctx.save();
  ctx.globalAlpha = mc.center;
  ctx.fillStyle = theme.center;
  ctx.shadowColor = theme.aircraftGlow;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(center.x, center.y, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Aircraft projector (aircraft glyphs/trails/labels). Orbital objects keep the
  // base projector so tuning aircraft alignment never drags satellites/ISS/Starlink.
  const project = makeProjector({ home: settings.home, rangeNm, center, radiusPx, calibration: aircraftCal });
  const projectOrbital = makeProjector({ home: settings.home, rangeNm, center, radiusPx, calibration: cal });

  // --- Calibration test pattern / debug overlay ---
  if (testPattern || mc.isCalibration) {
    drawTestPattern(ctx, w, h, center, radiusPx, theme, brightness);
    drawCalibrationHud(ctx, st, settings, effSettings, project, center, radiusPx, theme, brightness, now);
    return;
  }

  // --- Optional layers FIRST, so aircraft always paint on top of them ---
  // Render order (back → front): celestial bodies + Moon path, then orbital
  // objects (satellites / Starlink / ISS), then weather wash. The aircraft block
  // below draws after all of these, guaranteeing aircraft glyphs/labels are
  // never covered by the Sun, Moon, planets, satellites or their glow.
  //
  // `size` must be defined here (before the aircraft block that normally holds it)
  // because drawOptionalLayers uses it to scale satellite/ISS glyph sizes.
  const size = 14 * (settings.display.aircraftSize ?? 1);
  drawOptionalLayers(ctx, settings, mc, ld, theme, projectOrbital, w, h, size, {
    center,
    radiusPx,
    celestialCal,
    celestialBrightness: getCelestialBrightness(settings),
  });

  // --- Aircraft (motion-interpolated) ---
  const altColorOn = settings.display.altitudeColor !== false;
  const highlightEmergency = settings.display.highlightEmergency !== false;
  const baseRgb = parseColorToRgb(theme.aircraft);
  // `size` already defined above (needed before drawOptionalLayers to avoid TDZ).
  const showLabels = settings.display.labels !== false;
  const showTrails = settings.display.trails !== false;
  const renderTime = now - renderDelayMs(effSettings);
  const headingK = Math.min(1, dt * 5); // frame-rate-aware heading ease
  const trailWindowMs = trailWindowMsFromSettings(settings); // clamped 30–600 s

  // Build the visible set (skipped entirely when aircraft layer is off).
  const visible = [];
  if (layers.aircraft !== false) {
    for (const tr of st.tracks.values()) {
      const pos = sampleAircraftTrack(tr, renderTime, effSettings);
      if (!pos) continue;
      const p = project(pos.lat, pos.lon);
      if (p.x < -60 || p.x > w + 60 || p.y < -60 || p.y > h + 60) continue;

      // Heading: derive from motion, project through aircraft calibration, then ease.
      const geoHdg = sampleTrackHeading(tr, renderTime, effSettings);
      const projHdg = projectHeading(geoHdg, aircraftCal);
      tr.renderHeading = smoothHeading(tr.renderHeading, projHdg, headingK);

      const ac = tr.ac;
      const alt = ac.altitude ?? 0;
      const emergency = highlightEmergency && isEmergencySquawk(ac.squawk);
      const color = emergency ? WARN_RGB : altColorOn ? altitudeRamp(alt) : baseRgb;
      const dist = Number.isFinite(ac.distanceNm)
        ? ac.distanceNm
        : Math.hypot(p.x - center.x, p.y - center.y); // pixel fallback for sorting

      // Glyph classification is stable for an aircraft — recompute only when the
      // identifying metadata changes, not every frame (Pi-friendly).
      const classKey = `${ac.typeCode || ac.aircraftType || ''}|${ac.category || ''}`;
      if (tr.kindKey !== classKey) {
        tr.kind = classifyAircraftGlyph(ac);
        tr.kindKey = classKey;
      }

      visible.push({
        tr, ac, p, pos,
        heading: tr.renderHeading,
        geoHdg,
        kind: tr.kind,
        color,
        emergency,
        alpha: Math.max(0, Math.min(1, tr.life)),
        dist,
      });
    }

    // Trails first (under glyphs), built from each track's real history so the
    // tail lines up exactly with the interpolated head. Tapered + fading. On slow
    // (API) feeds there are often only 1–2 real fixes inside the window, so we
    // fall back to a short PREDICTED trail behind the aircraft, dead-reckoned from
    // its heading + speed, so the comet tail never vanishes between fetches.
    if (showTrails) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const v of visible) {
        const hist = v.tr.history || [];
        // Real history points inside the trail window.
        let pts = [];
        for (const sfix of hist) {
          if (sfix.t < renderTime - trailWindowMs || sfix.t > renderTime) continue;
          pts.push({ p: project(sfix.lat, sfix.lon), age: (renderTime - sfix.t) / trailWindowMs });
        }

        // Sparse history (slow feed): synthesize a predicted tail behind the head
        // by dead-reckoning backwards along the current track at ground speed.
        if (pts.length < 2) {
          const spd = v.ac.speed;
          if (Number.isFinite(spd) && spd > 0 && Number.isFinite(v.geoHdg)) {
            pts = [];
            const STEPS = 6;
            const spanSec = trailWindowMs / 1000;
            for (let k = STEPS; k >= 1; k--) {
              const back = (spanSec * k) / STEPS;            // seconds behind the head
              const bp = deadReckonBack(v.pos, v.geoHdg, spd, back);
              pts.push({ p: project(bp.lat, bp.lon), age: (back * 1000) / trailWindowMs });
            }
          }
        }

        pts.push({ p: v.p, age: 0 }); // head = interpolated/extrapolated position
        if (pts.length < 2) continue;
        // Thin uniformly (not by truncation) so the FULL time span is preserved
        // for long trails while the drawn segment count stays bounded.
        if (pts.length > MAX_TRAIL_SEGMENTS + 1) {
          const step = pts.length / (MAX_TRAIL_SEGMENTS + 1);
          const thinned = [];
          for (let i = 0; i < MAX_TRAIL_SEGMENTS; i++) thinned.push(pts[Math.floor(i * step)]);
          thinned.push(pts[pts.length - 1]); // always keep the head
          pts = thinned;
        }

        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1];
          const b = pts[i];
          const f = 1 - Math.min(1, b.age); // 1 at head, 0 at tail
          ctx.strokeStyle = rgba(v.color, 0.5 * f * v.alpha * mc.trails);
          ctx.lineWidth = 0.7 + 2.0 * f * (size / 14);
          ctx.beginPath();
          ctx.moveTo(a.p.x, a.p.y);
          ctx.lineTo(b.p.x, b.p.y);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // Glyphs (nearest painted last → on top).
    const farthestFirst = [...visible].sort((a, b) => b.dist - a.dist);
    for (const v of farthestFirst) {
      const s = size * (GLYPH_SCALE[v.kind] || 1);
      ctx.save();
      ctx.globalAlpha = mc.aircraft * v.alpha;
      ctx.translate(v.p.x, v.p.y);
      ctx.rotate((v.heading * Math.PI) / 180);
      if (v.emergency) {
        // Subtle warning ring behind the glyph (gentle pulse).
        const pulse = 0.35 + 0.25 * (0.5 + 0.5 * Math.sin(st.frameT * 4));
        ctx.save();
        ctx.rotate((-v.heading * Math.PI) / 180); // ring stays upright
        ctx.strokeStyle = rgba(WARN_RGB, pulse * v.alpha);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, s * 1.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      drawAircraftShape(ctx, v.kind, s, v.color, v.alpha, st.frameT, glyphSeed(v.ac.id));
      ctx.restore();
    }

    // Labels (density + collision avoidance + optional rotation).
    if (showLabels) {
      drawLabels(ctx, st, settings, visible, mc, w, h, size);
    }
  }

  // Report render stats up to the Status panel (throttled to ~1 Hz so it never
  // adds per-frame React churn on a Pi). Reports zero when aircraft layer is off.
  if (props.onStats && (!st.lastStatsAt || nowMs - st.lastStatsAt > 1000)) {
    st.lastStatsAt = nowMs;
    props.onStats({
      trackCount: st.tracks.size,
      renderedCount: visible.length,
      trailWindowSec: Math.round(trailWindowMs / 1000),
      trailSegmentCap: MAX_TRAIL_SEGMENTS,
    });
  }
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------
function labelLines(ac, glyphKind, glyphDebug) {
  const lines = [];
  lines.push({ text: ac.callsign || ac.id || '????', kind: 'title' });
  const fl = Math.round((ac.altitude ?? 0) / 100);
  const sub = `FL${fl}  ${ac.speed ?? 0}kt`;
  lines.push({ text: sub, kind: 'sub' });
  if (Number.isFinite(ac.distanceNm)) lines.push({ text: `${ac.distanceNm}nm`, kind: 'sub' });
  if (glyphDebug) {
    const tc = ac.typeCode || ac.aircraftType || '??';
    lines.push({ text: `${tc} · ${glyphKind}`, kind: 'sub' });
  }
  return lines;
}

function drawLabels(ctx, st, settings, visible, mc, w, h, size) {
  const density = settings.display.labelDensity || 'nearestN';
  const nearestN = Number.isFinite(settings.display.nearestN) ? settings.display.nearestN : 5;
  const labRot = labelRotationRad(settings);
  const glyphDebug = settings.display.glyphDebug === true;

  // Nearest first so they get priority placement and paint clearly.
  const nearestFirst = [...visible].sort((a, b) => a.dist - b.dist);
  const limit = density === 'all' ? nearestFirst.length : density === 'nearestOnly' ? 1 : nearestN;

  st.labelBoxes = [];
  const titleSize = mc.labelSize;
  const subSize = mc.labelDimSize;
  const lh = titleSize + 3;

  const collides = (b) => {
    const pad = 3;
    for (const o of st.labelBoxes) {
      if (b.x - pad < o.x + o.w && b.x + b.w + pad > o.x && b.y - pad < o.y + o.h && b.y + b.h + pad > o.y) {
        return true;
      }
    }
    return false;
  };
  const onScreen = (b) => b.x >= 6 && b.x + b.w <= w - 6 && b.y >= 6 && b.y + b.h <= h - 6;

  for (let i = 0; i < Math.min(limit, nearestFirst.length); i++) {
    const v = nearestFirst[i];
    const lines = labelLines(v.ac, v.kind, glyphDebug);

    // Measure.
    let lw = 0;
    for (const ln of lines) {
      ctx.font = ln.kind === 'title'
        ? `bold ${titleSize}px ui-monospace, Menlo, Consolas, monospace`
        : `${subSize}px ui-monospace, Menlo, Consolas, monospace`;
      lw = Math.max(lw, ctx.measureText(ln.text).width);
    }
    const bw = lw + 2;
    const bh = lines.length * lh;
    const gap = size * 0.7 + 8;

    // Try four quadrants around the glyph; then nudge down to dodge overlaps.
    const candidates = [
      { x: v.p.x + gap, y: v.p.y - gap - bh },
      { x: v.p.x + gap, y: v.p.y + gap },
      { x: v.p.x - gap - bw, y: v.p.y - gap - bh },
      { x: v.p.x - gap - bw, y: v.p.y + gap },
    ];
    let box = null;
    for (const c of candidates) {
      const b = { x: c.x, y: c.y, w: bw, h: bh };
      if (onScreen(b) && !collides(b)) { box = b; break; }
    }
    if (!box) {
      let b = { x: v.p.x + gap, y: v.p.y - gap - bh, w: bw, h: bh };
      for (let k = 0; k < 9 && (collides(b) || !onScreen(b)); k++) b = { ...b, y: b.y + lh + 2 };
      box = b;
    }
    // Keep on screen.
    box.x = Math.max(6, Math.min(box.x, w - 6 - bw));
    box.y = Math.max(6, Math.min(box.y, h - 6 - bh));
    st.labelBoxes.push(box);

    // Nearest brightest; gently dim farther ones but keep readable.
    const prom = 1 - i / Math.max(1, nearestFirst.length);
    const a = mc.labels * v.alpha * (0.7 + 0.3 * prom);
    if (a < 0.04) continue;

    // Leader line anchor (nearest edge of the box to the glyph).
    const anchorX = box.x + bw / 2 < v.p.x ? box.x + bw : box.x;
    const anchorY = Math.max(box.y, Math.min(v.p.y, box.y + bh));

    ctx.save();
    if (labRot) {
      // Rotate the label (leader + text) around the glyph so text reads upright
      // from where the viewer lies, without disturbing the field.
      ctx.translate(v.p.x, v.p.y);
      ctx.rotate(labRot);
      ctx.translate(-v.p.x, -v.p.y);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    // Hairline leader.
    ctx.strokeStyle = rgba(parseColorToRgb(getThemeLabelColor(settings)), 0.25 * a);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(v.p.x, v.p.y);
    ctx.lineTo(anchorX, anchorY);
    ctx.stroke();

    // Text.
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let y = box.y;
    for (const ln of lines) {
      if (ln.kind === 'title') {
        ctx.font = `bold ${titleSize}px ui-monospace, Menlo, Consolas, monospace`;
        ctx.fillStyle = v.emergency ? rgba(WARN_RGB, a) : `rgba(245,247,255,${a})`;
      } else {
        ctx.font = `${subSize}px ui-monospace, Menlo, Consolas, monospace`;
        ctx.fillStyle = `rgba(180,200,230,${0.85 * a})`;
      }
      ctx.fillText(ln.text, box.x, y);
      y += lh;
    }
    ctx.restore();
  }
}

function getThemeLabelColor(settings) {
  const t = getTheme(settings.display.theme);
  return t.labelDim || t.label || '#a0bee6';
}

// ---------------------------------------------------------------------------
// Optional layers
// ---------------------------------------------------------------------------
function drawOptionalLayers(ctx, settings, mc, ld, theme, projectOrbital, w, h, size, geom) {
  const layers = settings.layers || {};
  const showLabels = settings.display.labels !== false;
  const spaceLabels = settings.display.spaceLabels ?? 'major';
  // Orbital objects (satellites / ISS / Starlink) ride the base projector.
  const project = projectOrbital;
  // Per-type celestial brightness (Sun/Moon/planets/labels), 0..1.
  const cb = geom.celestialBrightness || { sun: 1, moon: 1, planets: 1, labels: 1 };

  // Weather: faint canvas wash + wind arrow. No overlay in projector mode.
  if (!mc.noCanvasOverlays && layers.weather && ld.weather) {
    const wx = ld.weather;
    const cloud = Math.max(0, Math.min(100, wx.cloudCover || 0)) / 100;
    if (cloud > 0.05) {
      ctx.save();
      ctx.globalAlpha = cloud * 0.10 * mc.weatherCanvas;
      ctx.fillStyle = theme.cloud;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
    if ((wx.precipitation || 0) > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.12, 0.04 + wx.precipitation * 0.02) * mc.weatherCanvas;
      ctx.fillStyle = 'rgba(80, 120, 200, 1)';
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
    if (Number.isFinite(wx.windDirection)) {
      ctx.save();
      ctx.globalAlpha = mc.weatherCanvas;
      drawWindArrow(ctx, 56, h - 56, wx.windDirection, theme.wind, 26);
      ctx.globalAlpha = 0.8 * mc.weatherCanvas;
      ctx.fillStyle = theme.labelDim;
      ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.round(wx.windSpeed || 0)}kt`, 56, h - 28);
      ctx.restore();
    }
  }

  const onScreen = (p) => p.x >= -40 && p.x <= w + 40 && p.y >= -40 && p.y <= h + 40;
  const acScale = settings.display.aircraftSize ?? 1;

  // --- Celestial bodies (sun / moon / planets) on the sky dome ---
  // Drawn first so orbital + aircraft sit on top. Subtle by design.
  if (layers.space && ld.space && geom) {
    const projectSky = makeSkyProjector({ center: geom.center, radiusPx: geom.radiusPx, calibration: geom.celestialCal });
    const moonPhaseData = ld.space.moon; // { phase, illumination, name, ... }

    // Moon path arc — drawn under the glyphs so it reads as a background guide.
    // Dimmed with the Moon's own brightness so a faint Moon keeps a faint path.
    if (settings.display?.showMoonPath !== false && Array.isArray(ld.space.moonPath) && mc.planets * cb.moon > 0) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.setLineDash([3, 8]);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = `rgba(200,215,235,${0.28 * mc.planets * cb.moon})`;
      ctx.beginPath();
      let moonPathStarted = false;
      for (const pt of ld.space.moonPath) {
        if (pt.el <= 0) { moonPathStarted = false; continue; }
        const pp = projectSky(pt.az, pt.el);
        if (!moonPathStarted) { ctx.moveTo(pp.x, pp.y); moonPathStarted = true; }
        else ctx.lineTo(pp.x, pp.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Body glyphs
    if (Array.isArray(ld.space.bodies)) {
      for (const body of ld.space.bodies) {
        if (!(body.el > 0)) continue; // below horizon
        // Per-type dimming: Sun, Moon and planets each carry their own brightness
        // (0 hides). The alpha drives glyph glow, fill and stroke together.
        const bright = body.kind === 'sun' ? cb.sun : body.kind === 'moon' ? cb.moon : cb.planets;
        const bodyAlpha = mc.planets * bright;
        if (bodyAlpha <= 0.002) continue; // brightness 0 → hidden
        const p = projectSky(body.az, body.el);
        const color = CELESTIAL_COLORS[body.name] || '#dfe6f0';
        const opts = body.kind === 'moon' ? { phase: moonPhaseData?.phase } : undefined;
        drawSpaceBody(ctx, p.x, p.y, body.name, body.kind, color, bodyAlpha, opts);
        // 'major' shows Sun + Moon labels; 'all' shows every body.
        const isMajorBody = body.kind === 'sun' || body.kind === 'moon';
        const showThisLabel = spaceLabels === 'all' || (spaceLabels === 'major' && isMajorBody);
        if (showThisLabel) {
          ctx.save();
          ctx.globalAlpha = mc.planets * 0.8 * cb.labels;
          ctx.shadowBlur = 0;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.font = `${Math.max(9, mc.labelDimSize - 1)}px ui-monospace, Menlo, Consolas, monospace`;
          ctx.fillStyle = color;
          // Moon label: add phase name when major labels are on
          const label = body.kind === 'moon' && moonPhaseData?.name
            ? `MOON · ${moonPhaseData.name}`
            : body.name.toUpperCase();
          ctx.fillText(label, p.x + 10, p.y - 7);
          ctx.restore();
        }
      }
    }
  }

  // --- Starlink (many, faint, capped backend-side) ---
  if (layers.starlink && Array.isArray(ld.starlink) && ld.starlink.length) {
    for (const sat of ld.starlink) {
      const p = project(sat.lat, sat.lon);
      if (!onScreen(p)) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      drawStarlinkDot(ctx, 2.4 * acScale, theme.satellite, mc.starlink);
      ctx.restore();
    }
  }

  // --- Satellites (generic) ---
  if (layers.satellites && Array.isArray(ld.satellites) && ld.satellites.length) {
    const satSize = 8 * acScale;
    for (const sat of ld.satellites) {
      const p = project(sat.lat, sat.lon);
      if (!onScreen(p)) continue;
      ctx.save();
      ctx.globalAlpha = mc.satellites;
      ctx.translate(p.x, p.y);
      drawSatellite(ctx, satSize, theme.satellite, theme.satelliteGlow);
      ctx.restore();
      if (spaceLabels === 'all') {
        ctx.save();
        ctx.globalAlpha = mc.satellites * 0.8;
        ctx.shadowBlur = 0;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.font = `${Math.max(9, mc.labelDimSize - 1)}px ui-monospace, Menlo, Consolas, monospace`;
        ctx.fillStyle = theme.satellite;
        ctx.fillText(sat.name || sat.id, p.x + satSize, p.y - satSize * 0.6);
        ctx.restore();
      }
    }
  }

  // --- ISS (distinct, brighter, labeled in 'major' and 'all') ---
  if (layers.iss && Array.isArray(ld.iss) && ld.iss.length) {
    const issSize = 11 * acScale;
    for (const sat of ld.iss) {
      const p = project(sat.lat, sat.lon);
      if (!onScreen(p)) continue;
      ctx.save();
      ctx.globalAlpha = mc.iss;
      ctx.translate(p.x, p.y);
      drawIss(ctx, issSize, theme.satellite, theme.satelliteGlow);
      ctx.restore();
      if (spaceLabels !== 'off') {
        ctx.save();
        ctx.globalAlpha = mc.iss * 0.95;
        ctx.shadowBlur = 0;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.font = `bold ${mc.labelSize}px ui-monospace, Menlo, Consolas, monospace`;
        ctx.fillStyle = '#ffffff';
        ctx.fillText('ISS', p.x + issSize * 1.2, p.y - issSize * 0.6);
        ctx.restore();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Calibration test pattern + debug HUD
// ---------------------------------------------------------------------------
// Calibration test pattern: grid + center dot + outer ring + compass + corners.
function drawTestPattern(ctx, w, h, center, radiusPx, theme, brightness) {
  ctx.save();
  ctx.globalAlpha = brightness;

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

  ctx.strokeStyle = theme.compass;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
  ctx.stroke();

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

  ctx.fillStyle = theme.compass;
  ctx.font = 'bold 18px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const off = radiusPx + 18;
  ctx.fillText('N', center.x, center.y - off);
  ctx.fillText('S', center.x, center.y + off);
  ctx.fillText('E', center.x + off, center.y);
  ctx.fillText('W', center.x - off, center.y);

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

// Debug HUD: current display mode + calibration values, plus a few sample
// aircraft glyphs so you can confirm orientation/scale before going live.
function drawCalibrationHud(ctx, st, settings, effSettings, project, center, radiusPx, theme, brightness, now) {
  // The passed-in `project` is the aircraft projector, so sample glyphs and
  // headings reflect aircraft alignment specifically.
  const base = getCalibration(settings);
  const cal = getAircraftCalibration(settings);
  const d = settings.display || {};

  // Sample aircraft: live tracks if any, otherwise four synthetic ones at the
  // cardinal mid-radius points so the overlay is useful even with no traffic.
  const renderTime = now - renderDelayMs(effSettings);
  let samples = [];
  for (const tr of st.tracks.values()) {
    const pos = sampleAircraftTrack(tr, renderTime, effSettings);
    if (!pos) continue;
    const p = project(pos.lat, pos.lon);
    if (p.x < 0 || p.x > st.w || p.y < 0 || p.y > st.h) continue;
    const geoHdg = sampleTrackHeading(tr, renderTime, settings);
    samples.push({ p, heading: projectHeading(geoHdg, cal), kind: classifyAircraftGlyph(tr.ac), id: tr.ac.id });
    if (samples.length >= 8) break;
  }
  if (samples.length === 0) {
    const r = radiusPx * 0.55;
    const synth = [
      { x: center.x, y: center.y - r, heading: projectHeading(0, cal) },
      { x: center.x + r, y: center.y, heading: projectHeading(90, cal) },
      { x: center.x, y: center.y + r, heading: projectHeading(180, cal) },
      { x: center.x - r, y: center.y, heading: projectHeading(270, cal) },
    ];
    samples = synth.map((s, i) => ({ p: { x: s.x, y: s.y }, heading: s.heading, kind: 'airliner', id: `sample${i}` }));
  }

  ctx.save();
  ctx.globalAlpha = brightness;
  for (const s of samples) {
    ctx.save();
    ctx.translate(s.p.x, s.p.y);
    ctx.rotate((s.heading * Math.PI) / 180);
    drawAircraftShape(ctx, s.kind, 14, [120, 224, 196], 0.9, st.frameT, glyphSeed(s.id));
    ctx.restore();
  }
  ctx.restore();

  // Calibration values panel (top-left). Shows the base mounting transform plus
  // the independent aircraft and celestial scale/offset.
  const ac = settings.calibration?.aircraft || {};
  const cel = settings.calibration?.celestial || {};
  const lines = [
    `MODE       ${(d.displayMode || 'normal').toUpperCase()}`,
    `BASE OFF   x ${Math.round(base.offsetX)}  y ${Math.round(base.offsetY)}`,
    `BASE SCALE ${Number(base.scale).toFixed(2)}x`,
    `ROTATION   ${Math.round(base.rotation)} deg`,
    `MIRROR     H ${base.flipH ? 'on' : 'off'}  V ${base.flipV ? 'on' : 'off'}`,
    `AIRCRAFT   ${Number(ac.scale ?? 1).toFixed(2)}x  x ${Math.round(ac.offsetX ?? 0)}  y ${Math.round(ac.offsetY ?? 0)}`,
    `CELESTIAL  ${Number(cel.scale ?? 1).toFixed(2)}x  x ${Math.round(cel.offsetX ?? 0)}  y ${Math.round(cel.offsetY ?? 0)}`,
    `LABEL ROT  ${Math.round(d.labelRotationDeg || 0)} deg`,
    `RANGE      ${settings.rangeNm || 60} nm`,
  ];
  ctx.save();
  ctx.globalAlpha = Math.min(1, brightness + 0.1);
  ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const padX = 14;
  const padY = 14;
  const lineH = 16;
  const boxW = 290;
  const boxH = lines.length * lineH + 16;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(padX - 6, padY - 6, boxW, boxH);
  ctx.fillStyle = theme.ringTextBright || theme.compass || '#9cf';
  lines.forEach((ln, i) => ctx.fillText(ln, padX, padY + i * lineH));
  ctx.restore();
}
