// Above Live — Airplanes.live adapter.
// Free, no API key required. Returns dump1090-compatible JSON.
// Docs: https://api.airplanes.live/

export const name = 'airplaneslive';
export const label = 'Airplanes.live';
export const requiresKey = false;

export function isConfigured(_settings) {
  return true; // always available, no key needed
}

export function buildRequest(settings) {
  const { lat, lon } = settings.home;
  const range = Math.round(settings.rangeNm || 60);
  return {
    url: `https://api.airplanes.live/v2/point/${lat}/${lon}/${range}`,
    headers: {},
  };
}

export function parseResponse(data) {
  return Array.isArray(data) ? data : (data.ac || []);
}
