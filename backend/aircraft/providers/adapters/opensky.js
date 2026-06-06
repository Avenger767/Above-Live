// Above Live — OpenSky Network adapter.
// Free with anonymous access (rate-limited). Optional Basic Auth with a free
// account raises rate limits. Set API_KEY to "username:password" for auth.
// Docs: https://openskynetwork.github.io/opensky-api/rest.html

export const name = 'opensky';
export const label = 'OpenSky Network';
export const requiresKey = false;

export function isConfigured(_settings) {
  return true; // anonymous access is always available
}

export function buildRequest(settings) {
  const { lat, lon } = settings.home;
  const rangeNm = settings.rangeNm || 60;
  // Convert nautical miles to degrees for a rough bounding box.
  const latDeg = rangeNm / 60;
  const lonDeg = rangeNm / (60 * Math.cos((lat * Math.PI) / 180));
  const params = new URLSearchParams({
    lamin: (lat - latDeg).toFixed(4),
    lomin: (lon - lonDeg).toFixed(4),
    lamax: (lat + latDeg).toFixed(4),
    lomax: (lon + lonDeg).toFixed(4),
  });
  const headers = {};
  // API_KEY in "username:password" format enables authenticated access.
  const apiKey = settings?.api?.apiKey || '';
  if (apiKey && apiKey.includes(':')) {
    headers['Authorization'] = `Basic ${Buffer.from(apiKey).toString('base64')}`;
  }
  return {
    url: `https://opensky-network.org/api/states/all?${params}`,
    headers,
  };
}

// OpenSky state vector array indices (per API docs).
const F = { icao: 0, callsign: 1, lon: 5, lat: 6, baroAlt: 7, onGround: 8, vel: 9, track: 10 };
const M_TO_FT = 3.28084;
const MS_TO_KT = 1.94384;

export function parseResponse(data) {
  const states = data?.states;
  if (!Array.isArray(states)) return [];
  return states
    .filter((s) => s[F.lat] != null && s[F.lon] != null)
    .map((s) => ({
      hex: s[F.icao] || '',
      callsign: (s[F.callsign] || '').trim(),
      lat: s[F.lat],
      lon: s[F.lon],
      alt_baro: s[F.onGround] ? 0 : Math.round((s[F.baroAlt] ?? 0) * M_TO_FT),
      gs: Math.round((s[F.vel] ?? 0) * MS_TO_KT),
      track: s[F.track] ?? 0,
    }));
}
