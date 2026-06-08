// Above Live — frontend default settings.
// Mirrors the backend defaults so the UI renders sensibly before the first
// /api/settings response arrives (or if the backend isn't up yet).

export const DEFAULT_SETTINGS = {
  home: { name: 'Dallas, TX', lat: 32.7767, lon: -96.797 },
  provider: 'MOCK',
  rangeNm: 60,
  updateIntervalMs: 1000,
  trailLength: 30,
  display: {
    theme: 'night', brightness: 1, labels: true, trails: true, aircraftSize: 1,
    displayMode: 'normal',
    brightnessMap: {},
    maxFps: 30,                 // render-loop cap; 0 = uncapped, 30 = Pi-safe default
    altitudeColor: true,        // colour glyphs/trails by altitude
    labelDensity: 'nearestN',   // 'all' | 'nearestN' | 'nearestOnly'
    nearestN: 5,
    labelRotationDeg: 0,        // rotate labels independently of the field
    highlightEmergency: true,   // subtle 7500/7600/7700 highlight
    glyphDebug: false,          // show typeCode + glyph class under each callsign
    spaceLabels: 'major',       // 'off' | 'major' (Sun/Moon/ISS) | 'all'
    showMoonPath: true,         // show Moon's daily arc across the sky dome
    // Radar/compass overlay visibility (object layers are unaffected). Turn
    // these off for a clean live-sky / projector look.
    radar: { rings: true, compass: true, nmLabels: true, crosshair: true },
    // Per-type brightness for Sun / Moon / planets / their labels (0..1).
    // 1 = current full brightness; 0 hides. Works in every display mode.
    celestialBrightness: { sun: 1, moon: 1, planets: 1, labels: 1 },
  },
  // Base alignment (rotation/flip/offset/scale shared by all layers) plus
  // independent aircraft and celestial scale/offset so the radar projection and
  // the sky-object projection can be tuned separately.
  calibration: {
    offsetX: 0, offsetY: 0, scale: 1, rotation: 0, flipH: false, flipV: false,
    aircraft:  { scale: 1, offsetX: 0, offsetY: 0 },
    celestial: { scale: 1, offsetX: 0, offsetY: 0 },
  },

  // Smooth-motion model (see frontend/src/lib/aircraftMotion.js).
  motion: { interpolate: true, renderDelayMs: 1150, maxExtrapolationSec: 4, staleSec: 20 },
  api: { baseUrl: 'https://api.airplanes.live/v2', apiKey: '', pollIntervalMs: 60000, rateLimitBackoffMs: 120000, settingsDebounceMs: 3000 },
  localAdsb: { url: 'http://localhost:8080/data.json', path: '', pollIntervalMs: 1000 },

  // Optional display layers (aircraft + stars on; the rest off by default).
  layers: { aircraft: true, weather: false, iss: false, satellites: false, starlink: false, space: false, stars: true },
  weather: { provider: 'openmeteo', pollIntervalMs: 300000 },
  iss:        { group: 'stations', cap: 1,  pollIntervalMs: 5000,  tleTtlMs: 21600000 },
  satellites: { group: 'visual',   cap: 60, pollIntervalMs: 5000,  tleTtlMs: 21600000 },
  starlink:   { group: 'starlink', cap: 25, pollIntervalMs: 8000,  tleTtlMs: 43200000 },
  space: { pollIntervalMs: 60000 },
};
