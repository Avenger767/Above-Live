// Above Live — settings diff helpers.
// Decides which subsystems must react to a settings change. Pure functions, no
// side effects, so they're unit-testable in the smoke check without spinning up
// the server or touching data/settings.json.

// Which settings, when changed, must reset the API fetch timer (re-fetch).
// Everything else (theme, labels, trails, brightness, glyphDebug, maxFps,
// calibration, motion, layers…) is display-only and must NOT invalidate the API.
export const API_RELEVANT_PATHS = [
  'provider',
  'rangeNm',
  'home.lat',
  'home.lon',
  'api.baseUrl',
  'api.apiKey',
  'api.pollIntervalMs',
  'api.rateLimitBackoffMs',
  'api.settingsDebounceMs',
];

// Changes that affect the poll cadence / active provider need a poll restart.
export const POLL_RELEVANT_PATHS = [
  'provider',
  'updateIntervalMs',
  'localAdsb.url',
  'localAdsb.path',
  'localAdsb.pollIntervalMs',
];

// Read a dotted path ("home.lat") out of a nested object.
export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// Return the subset of `paths` whose values differ between before/after.
export function changedPaths(before, after, paths) {
  return paths.filter((p) => getPath(before, p) !== getPath(after, p));
}

// Did any layer enable/config change? (layers.* + per-layer config blocks.)
export function layersChanged(before, after) {
  const enabled = JSON.stringify(before.layers || {}) !== JSON.stringify(after.layers || {});
  const cfg = ['weather', 'satellites', 'space'].some(
    (k) => JSON.stringify(before[k] || {}) !== JSON.stringify(after[k] || {})
  );
  return enabled || cfg;
}
