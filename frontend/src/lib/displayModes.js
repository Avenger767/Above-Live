// Above Live — display mode configurations.
// Each mode returns per-element globalAlpha values and render flags for
// SkyRenderer's draw loop. "projector" enforces a pure black background so
// the wall only lights up where there is data.

export const DISPLAY_MODES = {
  normal:      { label: 'Normal' },
  projector:   { label: 'Projector' },
  radar:       { label: 'Radar' },
  ambient:     { label: 'Ambient Sky' },
  calibration: { label: 'Calibration' },
};

export const DISPLAY_MODE_KEYS = Object.keys(DISPLAY_MODES);

// Radar overlay presets used by the control panel quick buttons.
export const RADAR_OVERLAY_ALL_ON = { rings: true, compass: true, nmLabels: true, crosshair: true };
export const RADAR_OVERLAY_CLEAN_SKY = { rings: false, compass: false, nmLabels: false, crosshair: false };

// Resolve which radar/compass overlay elements should render, from settings.
// Each element defaults to visible; an explicit `false` hides it. This only
// affects the radar overlay (rings, compass letters, nautical-mile labels,
// center crosshair) — aircraft, satellites, planets, ISS, stars and every other
// object layer are independent and always render per their own layer settings.
export function getRadarOverlay(settings) {
  const r = (settings && settings.display && settings.display.radar) || {};
  return {
    rings:     r.rings !== false,
    compass:   r.compass !== false,
    nmLabels:  r.nmLabels !== false,
    crosshair: r.crosshair !== false,
  };
}

// Celestial brightness defaults. 1.0 = the current full intended brightness
// (no visual change for existing installs); 0 hides that object type. These
// multiply on top of the active display mode's planet alpha, so they work the
// same in normal, radar, ambient and projector modes — and let projector mode
// dim the Sun/Moon/planets without touching aircraft.
export const DEFAULT_CELESTIAL_BRIGHTNESS = { sun: 1, moon: 1, planets: 1, labels: 1 };

// Resolve per-type celestial brightness (0..1) from settings, clamped safe.
export function getCelestialBrightness(settings) {
  const cb = (settings && settings.display && settings.display.celestialBrightness) || {};
  const clamp01 = (v, def) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.max(0, Math.min(1, n));
  };
  return {
    sun:     clamp01(cb.sun,     DEFAULT_CELESTIAL_BRIGHTNESS.sun),
    moon:    clamp01(cb.moon,    DEFAULT_CELESTIAL_BRIGHTNESS.moon),
    planets: clamp01(cb.planets, DEFAULT_CELESTIAL_BRIGHTNESS.planets),
    labels:  clamp01(cb.labels,  DEFAULT_CELESTIAL_BRIGHTNESS.labels),
  };
}

// Returns a render-config object for the draw loop.
//   mode        — one of the DISPLAY_MODE_KEYS
//   brightness  — master brightness slider [0..1]
//   brightnessMap — per-element overrides from settings.display.brightnessMap
export function getModeConfig(mode, brightness = 1, brightnessMap = {}) {
  const B = brightness;
  const bm = brightnessMap;
  // eb: per-element alpha, capped at 1.
  // Uses the user's slider value as a multiplier; falls back to `def`.
  const eb = (key, def = 1) => Math.min(1, B * (bm[key] ?? def));

  switch (mode) {
    case 'projector':
      return {
        solidBlack:       true,
        isCalibration:    false,
        noCanvasOverlays: true,   // no full-screen cloud/rain wash
        brightRings:      true,   // use theme.ringBright colors
        labelSize:        15,     // larger text survives cheap projector blur
        labelDimSize:     12,
        starBase:         0.6 * eb('stars', 0.6),  // dim stars to avoid wall glow
        rings:            eb('rings', 1),
        compass:          eb('rings', 1),
        center:           eb('aircraft', 1),
        aircraft:         eb('aircraft', 1),
        labels:           eb('labels', 1),
        trails:           eb('trails', 1),
        satellites:       eb('satellites', 1),
        iss:              eb('satellites', 1),
        starlink:         eb('starlink', 0.55),   // Starlink intentionally dim
        planets:          eb('planets', 0.85),
        weatherCanvas:    0,
      };

    case 'radar':
      return {
        solidBlack:       false,
        isCalibration:    false,
        noCanvasOverlays: false,
        brightRings:      true,   // rings prominent for radar work
        labelSize:        12,
        labelDimSize:     10,
        starBase:         0.6 * B * 0.45,
        rings:            B,
        compass:          B,
        center:           B,
        aircraft:         B,
        labels:           B,
        trails:           B * 0.7,
        satellites:       B,
        iss:              B,
        starlink:         B * 0.55,
        planets:          B * 0.85,
        weatherCanvas:    B,
      };

    case 'ambient':
      return {
        solidBlack:       false,
        isCalibration:    false,
        noCanvasOverlays: false,
        brightRings:      false,
        labelSize:        10,
        labelDimSize:     9,
        starBase:         Math.min(1, 0.6 * B * 1.6),  // starfield dominant
        rings:            B * 0.35,
        compass:          B * 0.45,
        center:           B * 0.6,
        aircraft:         B * 0.5,
        labels:           B * 0.4,
        trails:           B * 0.3,
        satellites:       Math.min(1, B * 1.0), // space objects more prominent in ambient
        iss:              Math.min(1, B * 1.0),
        starlink:         B * 0.55,
        planets:          Math.min(1, B * 1.0),
        weatherCanvas:    B * 0.8,
      };

    case 'calibration':
      return {
        solidBlack:       true,
        isCalibration:    true,
        noCanvasOverlays: true,
        brightRings:      false,
        labelSize:        12,
        labelDimSize:     10,
        starBase:         0,
        rings:            B,
        compass:          B,
        center:           B,
        aircraft:         B,
        labels:           B,
        trails:           B,
        satellites:       0,    // hide optional space objects in calibration mode
        iss:              0,
        starlink:         0,
        planets:          0,
        weatherCanvas:    0,
      };

    default: // 'normal'
      return {
        solidBlack:       false,
        isCalibration:    false,
        noCanvasOverlays: false,
        brightRings:      false,
        labelSize:        12,
        labelDimSize:     10,
        starBase:         0.6 * B,
        rings:            B,
        compass:          B,
        center:           B,
        aircraft:         B,
        labels:           B,
        trails:           B,
        satellites:       B,
        iss:              B,
        starlink:         B * 0.55,
        planets:          B * 0.9,
        weatherCanvas:    B,
      };
  }
}
