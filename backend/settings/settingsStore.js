// Above Live — settings store.
// Loads/saves settings from data/settings.json, applies sane defaults, and
// lets environment variables override file values (env wins where present).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const SETTINGS_PATH = join(DATA_DIR, 'settings.json');

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
    // Performance: cap the render loop. 0 = uncapped, 30 = safe Raspberry Pi default.
    maxFps: 30,
    // Colour glyphs/trails by altitude (theme colour is the fallback when off).
    altitudeColor: true,
    // Labels: how many to show, and an independent text rotation for ceilings.
    labelDensity: 'nearestN',   // 'all' | 'nearestN' | 'nearestOnly'
    nearestN: 5,
    labelRotationDeg: 0,
    // Subtle warning highlight for emergency squawks (7500/7600/7700).
    highlightEmergency: true,
    // Show typeCode + glyph class under each callsign (developer/debug aid).
    glyphDebug: false,
  },
  calibration: { offsetX: 0, offsetY: 0, scale: 1, rotation: 0, flipH: false, flipV: false },

  // Smooth-motion model (Skylight-style). The display renders slightly in the
  // past and interpolates between known fixes instead of snapping each second.
  motion: {
    interpolate: true,
    renderDelayMs: 1150,      // how far in the past we render (just over ~1 Hz fixes)
    maxExtrapolationSec: 4,   // cap dead-reckoning past the newest fix
    staleSec: 20,             // drop a track after this long with no update
  },
  api: {
    baseUrl: 'https://api.airplanes.live/v2',
    apiKey: '',
    pollIntervalMs: 60000,         // external fetch interval (1 per 60 s)
    rateLimitBackoffMs: 120000,    // backoff after 429 (2 min)
    settingsDebounceMs: 3000,      // coalesce rapid settings saves before re-fetch
  },
  localAdsb: { url: 'http://localhost:8080/data/aircraft.json', path: '', pollIntervalMs: 1000 },

  // Optional display layers. Aircraft is the mission; the rest are OFF by
  // default. "stars" is a free local starfield (no network) so it's on.
  layers: {
    aircraft: true,
    weather: false,
    iss: false,
    satellites: false,
    starlink: false,
    space: false,        // sun / moon / planets
    stars: true,
  },

  // Per-layer config (only used when the matching layer is enabled).
  weather: { provider: 'openmeteo', pollIntervalMs: 300000 },
  // Orbital layers (CelesTrak TLE group + local propagation). cap limits the
  // rendered objects; tleTtlMs is how long a TLE download is reused (hours);
  // pollIntervalMs is the LOCAL propagation cadence (no network).
  iss:        { group: 'stations', cap: 1,  pollIntervalMs: 5000,  tleTtlMs: 21600000 },
  satellites: { group: 'visual',   cap: 60, pollIntervalMs: 5000,  tleTtlMs: 21600000 },
  starlink:   { group: 'starlink', cap: 25, pollIntervalMs: 8000,  tleTtlMs: 43200000 },
  space: { pollIntervalMs: 60000 }, // sun/moon/planets recompute (1 min)
};

// Interpret common truthy strings from env vars ("1", "true", "yes", "on").
function truthy(v) {
  return ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase());
}

// Deep-merge helper so partial saves don't wipe nested defaults. Exported so the
// smoke check can verify that older settings files (missing newer keys) still
// migrate safely: defaults are the base, the file overrides only present keys.
export function merge(base, override) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(override || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object') {
      out[k] = merge(out[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

// Apply environment overrides on top of file settings.
function applyEnv(settings) {
  const s = merge(DEFAULT_SETTINGS, settings);
  if (process.env.PROVIDER) s.provider = process.env.PROVIDER;
  if (process.env.API_BASE_URL) s.api.baseUrl = process.env.API_BASE_URL;
  if (process.env.API_KEY) s.api.apiKey = process.env.API_KEY;
  if (process.env.API_POLL_INTERVAL_MS) s.api.pollIntervalMs = Number(process.env.API_POLL_INTERVAL_MS);
  if (process.env.API_RATE_LIMIT_BACKOFF_MS)
    s.api.rateLimitBackoffMs = Number(process.env.API_RATE_LIMIT_BACKOFF_MS);
  if (process.env.API_SETTINGS_DEBOUNCE_MS)
    s.api.settingsDebounceMs = Number(process.env.API_SETTINGS_DEBOUNCE_MS);
  if (process.env.LOCAL_ADSB_URL) s.localAdsb.url = process.env.LOCAL_ADSB_URL;
  // Accept both LOCAL_ADSB_PATH and LOCAL_ADSB_FILE for the on-disk source.
  if (process.env.LOCAL_ADSB_PATH) s.localAdsb.path = process.env.LOCAL_ADSB_PATH;
  if (process.env.LOCAL_ADSB_FILE) s.localAdsb.path = process.env.LOCAL_ADSB_FILE;
  if (process.env.LOCAL_ADSB_POLL_INTERVAL_MS)
    s.localAdsb.pollIntervalMs = Number(process.env.LOCAL_ADSB_POLL_INTERVAL_MS);

  // Optional layer enables + config (env wins; all off by default).
  if (process.env.WEATHER_ENABLED) s.layers.weather = truthy(process.env.WEATHER_ENABLED);
  if (process.env.WEATHER_PROVIDER) s.weather.provider = process.env.WEATHER_PROVIDER;
  if (process.env.WEATHER_POLL_INTERVAL_MS)
    s.weather.pollIntervalMs = Number(process.env.WEATHER_POLL_INTERVAL_MS);

  if (process.env.ISS_ENABLED) s.layers.iss = truthy(process.env.ISS_ENABLED);
  if (process.env.SATELLITES_ENABLED) s.layers.satellites = truthy(process.env.SATELLITES_ENABLED);
  if (process.env.SATELLITE_GROUP) s.satellites.group = process.env.SATELLITE_GROUP;
  if (process.env.SATELLITE_POLL_INTERVAL_MS)
    s.satellites.pollIntervalMs = Number(process.env.SATELLITE_POLL_INTERVAL_MS);
  if (process.env.STARLINK_ENABLED) s.layers.starlink = truthy(process.env.STARLINK_ENABLED);

  if (process.env.SPACE_ENABLED) s.layers.space = truthy(process.env.SPACE_ENABLED);
  if (process.env.SPACE_POLL_INTERVAL_MS)
    s.space.pollIntervalMs = Number(process.env.SPACE_POLL_INTERVAL_MS);

  if (process.env.STARS_ENABLED) s.layers.stars = truthy(process.env.STARS_ENABLED);
  if (process.env.DISPLAY_MODE) s.display.displayMode = process.env.DISPLAY_MODE;
  return s;
}

let current = null;

export async function loadSettings() {
  let fileSettings = {};
  try {
    if (existsSync(SETTINGS_PATH)) {
      fileSettings = JSON.parse(await readFile(SETTINGS_PATH, 'utf8'));
    }
  } catch (err) {
    console.warn(`[settings] Could not read settings.json (${err.message}); using defaults.`);
  }
  current = applyEnv(fileSettings);
  return current;
}

export function getSettings() {
  return current || applyEnv({});
}

// Save a partial update (deep-merged) back to disk. Returns the new settings.
export async function saveSettings(partial) {
  const merged = merge(getSettings(), partial || {});
  current = merged;
  try {
    if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
    // Persist everything EXCEPT secrets that came from the environment — but we
    // still keep whatever was explicitly saved via the API so file-based config
    // works too. (Env always re-overrides on next load.)
    await writeFile(SETTINGS_PATH, JSON.stringify(merged, null, 2), 'utf8');
  } catch (err) {
    console.warn(`[settings] Could not write settings.json: ${err.message}`);
  }
  return current;
}

export async function resetSettings() {
  current = applyEnv({});
  try {
    await writeFile(SETTINGS_PATH, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf8');
  } catch (err) {
    console.warn(`[settings] Could not reset settings.json: ${err.message}`);
  }
  return current;
}
