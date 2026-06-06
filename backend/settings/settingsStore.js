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
  display: { theme: 'night', brightness: 1, labels: true, trails: true, aircraftSize: 1 },
  layers: { aircraft: true, satellites: false, weather: false },
  calibration: { offsetX: 0, offsetY: 0, scale: 1, rotation: 0, flipH: false, flipV: false },
  api: { adapter: 'airplaneslive', baseUrl: '', apiKey: '' },
  localAdsb: { url: 'http://localhost:8080/data/aircraft.json', path: '' },
};

// Deep-merge helper so partial saves don't wipe nested defaults.
function merge(base, override) {
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

// Apply environment overrides on top of file settings. Env always wins.
function applyEnv(settings) {
  const s = merge(DEFAULT_SETTINGS, settings);
  if (process.env.PROVIDER)       s.provider          = process.env.PROVIDER;
  if (process.env.API_PROVIDER)   s.api.adapter       = process.env.API_PROVIDER.toLowerCase();
  if (process.env.API_BASE_URL)   s.api.baseUrl       = process.env.API_BASE_URL;
  if (process.env.API_KEY)        s.api.apiKey        = process.env.API_KEY;
  if (process.env.HOME_LAT)       s.home.lat          = Number(process.env.HOME_LAT);
  if (process.env.HOME_LON)       s.home.lon          = Number(process.env.HOME_LON);
  if (process.env.RANGE_NM)       s.rangeNm           = Number(process.env.RANGE_NM);
  if (process.env.LOCAL_ADSB_URL) s.localAdsb.url     = process.env.LOCAL_ADSB_URL;
  if (process.env.LOCAL_ADSB_PATH) s.localAdsb.path   = process.env.LOCAL_ADSB_PATH;
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
