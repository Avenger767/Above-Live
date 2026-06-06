// Above Live — Generic REST API adapter.
// Use this when your API doesn't match any named adapter.
// Requires API_BASE_URL. Sends Bearer auth if API_KEY is set.
// Tries common response shapes: array, .aircraft, .states, .ac

export const name = 'generic';
export const label = 'Generic REST API';
export const requiresKey = false;

export function isConfigured(settings) {
  return !!(settings?.api?.baseUrl);
}

export function buildRequest(settings) {
  const { lat, lon } = settings.home;
  const range = Math.round(settings.rangeNm || 60);
  const base = (settings.api.baseUrl || '').replace(/\/$/, '');
  const headers = {};
  if (settings?.api?.apiKey) {
    headers['Authorization'] = `Bearer ${settings.api.apiKey}`;
  }
  return {
    url: `${base}/aircraft?lat=${lat}&lon=${lon}&radius=${range}`,
    headers,
  };
}

export function parseResponse(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.aircraft)) return data.aircraft;
  if (Array.isArray(data?.states)) return data.states;
  if (Array.isArray(data?.ac)) return data.ac;
  return [];
}
