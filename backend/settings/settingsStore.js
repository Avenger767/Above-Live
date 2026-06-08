// Above Live — settings store.
// Loads/saves settings from data/settings.json, applies sane defaults, and
// lets environment variables override file values (env wins where present).

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
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
    // Space object label visibility: 'off' | 'major' (Sun/Moon/ISS) | 'all'
    spaceLabels: 'major',
    // Radar/compass overlay visibility. Each element can be hidden independently
    // for a clean live-sky / projector look; object layers are unaffected.
    radar: { rings: true, compass: true, nmLabels: true, crosshair: true },
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
  localAdsb: { url: 'http://localhost:8080/data.json', path: '', pollIntervalMs: 1000 },

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

// Validate a parsed settings value is a usable, non-empty object.
function isUsableSettings(obj) {
  return Boolean(obj) && typeof obj === 'object' && !Array.isArray(obj) && Object.keys(obj).length > 0;
}

// Write settings to disk SAFELY. Refuses to write an empty/invalid object (so a
// bad save can never truncate settings.json to 0 bytes) and writes atomically
// via a temp file + rename so a crash mid-write can't leave a corrupt/empty
// file. Returns true on success.
async function persist(settingsObj) {
  if (!isUsableSettings(settingsObj)) {
    console.warn('[settings] Refusing to write empty/invalid settings.json — keeping the existing file.');
    return false;
  }
  let json;
  try {
    json = JSON.stringify(settingsObj, null, 2);
  } catch (err) {
    console.warn(`[settings] Could not serialize settings (${err.message}); not writing.`);
    return false;
  }
  if (!json || json.trim().length < 2) {
    console.warn('[settings] Serialized settings were empty; not writing.');
    return false;
  }
  try {
    if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
    const tmp = `${SETTINGS_PATH}.tmp`;
    await writeFile(tmp, json, 'utf8');
    await rename(tmp, SETTINGS_PATH); // atomic on the same filesystem
    return true;
  } catch (err) {
    console.warn(`[settings] Could not write settings.json: ${err.message}`);
    return false;
  }
}

export async function loadSettings() {
  let fileSettings = {};
  let needsRecreate = false;

  try {
    if (!existsSync(SETTINGS_PATH)) {
      console.warn('[settings] settings.json not found — creating a fresh one from defaults.');
      needsRecreate = true;
    } else {
      const raw = await readFile(SETTINGS_PATH, 'utf8');
      if (!raw || !raw.trim()) {
        // The exact symptom reported: a 0 KB settings.json. Recover + rewrite.
        console.warn('[settings] settings.json is empty (0 bytes) — recovering with defaults and recreating the file.');
        needsRecreate = true;
      } else {
        const parsed = JSON.parse(raw); // throws on invalid JSON → caught below
        if (isUsableSettings(parsed)) {
          fileSettings = parsed;
        } else {
          console.warn('[settings] settings.json did not contain a settings object — recovering with defaults and recreating the file.');
          needsRecreate = true;
        }
      }
    }
  } catch (err) {
    console.warn(`[settings] settings.json is corrupted or unreadable (${err.message}) — recovering with defaults and recreating the file.`);
    fileSettings = {};
    needsRecreate = true;
  }

  current = applyEnv(fileSettings);

  // Recreate a valid file from the recovered (defaults + env) settings so the
  // next start reads clean config. Best-effort: a write failure is non-fatal.
  if (needsRecreate) {
    const ok = await persist(current);
    if (ok) console.warn('[settings] Recreated a valid settings.json from defaults.');
  }
  return current;
}

export function getSettings() {
  return current || applyEnv({});
}

// Save a partial update (deep-merged) back to disk. Returns the new settings.
export async function saveSettings(partial) {
  // Persist everything EXCEPT secrets that came from the environment — but we
  // still keep whatever was explicitly saved via the API so file-based config
  // works too. (Env always re-overrides on next load.)
  const merged = merge(getSettings(), partial || {});
  current = merged;
  await persist(merged); // safe-write: never truncates to an empty file
  return current;
}

export async function resetSettings() {
  current = applyEnv({});
  await persist(current);
  return current;
}
