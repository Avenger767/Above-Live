// Above Live — frontend default settings.
// Mirrors the backend defaults so the UI renders sensibly before the first
// /api/settings response arrives (or if the backend isn't up yet).

export const DEFAULT_SETTINGS = {
  home: { name: 'Dallas, TX', lat: 32.7767, lon: -96.797 },
  provider: 'MOCK',
  rangeNm: 60,
  updateIntervalMs: 1000,
  trailLength: 30,
  display: { theme: 'night', brightness: 1, labels: true, trails: true, aircraftSize: 1 },
  layers: { aircraft: true, satellites: false, weather: false },
  calibration: { offsetX: 0, offsetY: 0, scale: 1, rotation: 0, flipH: false, flipV: false },
  api: { baseUrl: '', apiKey: '' },
  localAdsb: { url: 'http://localhost:8080/data/aircraft.json', path: '' },
};
