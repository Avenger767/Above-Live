// Above Live — ADS-B Exchange adapter (via RapidAPI).
// Requires an API_KEY from https://rapidapi.com/adsbx/api/adsbexchange-com1
// Response format is identical to Airplanes.live (dump1090-compatible JSON).

export const name = 'adsbexchange';
export const label = 'ADS-B Exchange';
export const requiresKey = true;

export function isConfigured(settings) {
  return !!(settings?.api?.apiKey);
}

export function buildRequest(settings) {
  const { lat, lon } = settings.home;
  const dist = Math.round(settings.rangeNm || 60);
  return {
    url: `https://adsbexchange-com1.p.rapidapi.com/v2/lat/${lat}/lon/${lon}/dist/${dist}/`,
    headers: {
      'X-RapidAPI-Key': settings.api.apiKey,
      'X-RapidAPI-Host': 'adsbexchange-com1.p.rapidapi.com',
    },
  };
}

export function parseResponse(data) {
  return Array.isArray(data) ? data : (data.ac || []);
}
