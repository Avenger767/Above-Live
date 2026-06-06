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
        satellites:       B * 0.9,
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
        satellites:       B,
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
        weatherCanvas:    B,
      };
  }
}
