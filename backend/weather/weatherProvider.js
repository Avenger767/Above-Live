// Above Live — weather provider.
// Fetches current conditions from Open-Meteo (free, no API key required).
// Results are cached for 5 minutes since weather changes slowly.

const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
const CACHE_TTL  = 5 * 60 * 1000; // 5 minutes

// WMO weather interpretation codes → human-readable condition string.
const WMO = {
  0: 'Clear', 1: 'Mostly Clear', 2: 'Partly Cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Icy Fog',
  51: 'Light Drizzle', 53: 'Drizzle', 55: 'Heavy Drizzle',
  61: 'Light Rain', 63: 'Rain', 65: 'Heavy Rain',
  71: 'Light Snow', 73: 'Snow', 75: 'Heavy Snow',
  77: 'Snow Grains',
  80: 'Light Showers', 81: 'Showers', 82: 'Heavy Showers',
  85: 'Snow Showers', 86: 'Heavy Snow Showers',
  95: 'Thunderstorm', 96: 'Thunderstorm + Hail', 99: 'Thunderstorm + Hail',
};

export function createWeatherProvider() {
  let cache     = null;
  let lastFetch = 0;

  return {
    name: 'weather',

    async fetchWeather(settings) {
      const home = settings.home || { lat: 32.7767, lon: -96.797 };
      const now  = Date.now();

      if (cache && now - lastFetch < CACHE_TTL) return cache;

      const url =
        `${OPEN_METEO}?latitude=${home.lat}&longitude=${home.lon}` +
        `&current=temperature_2m,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation,weather_code` +
        `&wind_speed_unit=kn&temperature_unit=fahrenheit&timezone=auto`;

      const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();

      const c = data.current || {};
      cache = {
        tempF:         Math.round(c.temperature_2m      ?? 0),
        windSpeed:     Math.round(c.wind_speed_10m      ?? 0),  // knots
        windDir:       Math.round(c.wind_direction_10m  ?? 0),  // degrees (FROM direction)
        cloudCover:    Math.round(c.cloud_cover         ?? 0),  // percent
        precipitation: parseFloat((c.precipitation     ?? 0).toFixed(2)), // mm
        weatherCode:   c.weather_code ?? 0,
        condition:     WMO[c.weather_code] || 'Unknown',
        timestamp:     now,
      };
      lastFetch = now;
      return cache;
    },
  };
}
