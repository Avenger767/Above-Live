// Above Live — local airport / runway dataset.
//
// Each airport stores ICAO, name, a reference lat/lon (for culling + label
// placement) and one or more runways. Each runway now stores explicit threshold
// coordinates (endA / endB) instead of deriving them at render-time from a
// center + heading, which allows real FAA-sourced data to be dropped in later.
//
// Fields:
//   id         runway identifier, e.g. '17R/35L'
//   endA       lower-numbered end { id, lat, lon }
//   endB       higher-numbered end { id, lat, lon }
//   lengthFt   published length in feet
//   widthFt    published width in feet
//   approximate  true = coordinates were derived from center + heading + length
//                (same accuracy as the old approach but in the new structure);
//                false = real FAA-sourced threshold positions.
//
// Coverage: Dallas–Fort Worth metro area. Structure is deliberately simple so a
// larger (continental or worldwide) database can be swapped in without touching
// the renderer — just populate more airports with approximate: false.

export const AIRPORTS = [
  {
    icao: 'KDFW', name: 'Dallas/Fort Worth Intl',
    lat: 32.8998, lon: -97.0403,
    runways: [
      {
        id: '17R/35L',
        endA: { id: '17R', lat: 32.8815, lon: -97.0384 },
        endB: { id: '35L', lat: 32.9181, lon: -97.0422 },
        lengthFt: 13401, widthFt: 200, approximate: true,
      },
      {
        id: '18L/36R',
        endA: { id: '18L', lat: 32.8815, lon: -97.0418 },
        endB: { id: '36R', lat: 32.9181, lon: -97.0388 },
        lengthFt: 13400, widthFt: 200, approximate: true,
      },
      {
        id: '13R/31L',
        endA: { id: '13R', lat: 32.8922, lon: -97.0287 },
        endB: { id: '31L', lat: 32.9074, lon: -97.0519 },
        lengthFt: 9000, widthFt: 150, approximate: true,
      },
    ],
  },
  {
    icao: 'KDAL', name: 'Dallas Love Field',
    lat: 32.8471, lon: -96.8518,
    runways: [
      {
        id: '13L/31R',
        endA: { id: '13L', lat: 32.8392, lon: -96.8409 },
        endB: { id: '31R', lat: 32.8550, lon: -96.8627 },
        lengthFt: 8800, widthFt: 150, approximate: true,
      },
      {
        id: '18/36',
        endA: { id: '18', lat: 32.8387, lon: -96.8518 },
        endB: { id: '36', lat: 32.8555, lon: -96.8518 },
        lengthFt: 6147, widthFt: 100, approximate: true,
      },
    ],
  },
  {
    icao: 'KADS', name: 'Addison',
    lat: 32.9686, lon: -96.8364,
    runways: [
      {
        id: '16/34',
        endA: { id: '16', lat: 32.9596, lon: -96.8316 },
        endB: { id: '34', lat: 32.9776, lon: -96.8412 },
        lengthFt: 7203, widthFt: 100, approximate: true,
      },
    ],
  },
  {
    icao: 'KGKY', name: 'Arlington Municipal',
    lat: 32.6638, lon: -97.0943,
    runways: [
      {
        id: '16/34',
        endA: { id: '16', lat: 32.6560, lon: -97.0909 },
        endB: { id: '34', lat: 32.6716, lon: -97.0977 },
        lengthFt: 6080, widthFt: 100, approximate: true,
      },
    ],
  },
  {
    icao: 'KRBD', name: 'Dallas Executive',
    lat: 32.6809, lon: -96.8682,
    runways: [
      {
        id: '13/31',
        endA: { id: '13', lat: 32.6751, lon: -96.8603 },
        endB: { id: '31', lat: 32.6867, lon: -96.8761 },
        lengthFt: 6451, widthFt: 100, approximate: true,
      },
      {
        id: '17/35',
        endA: { id: '17', lat: 32.6757, lon: -96.8677 },
        endB: { id: '35', lat: 32.6861, lon: -96.8688 },
        lengthFt: 3800, widthFt: 75, approximate: true,
      },
    ],
  },
  {
    icao: 'KAFW', name: 'Fort Worth Alliance',
    lat: 32.9876, lon: -97.3188,
    runways: [
      {
        id: '16L/34R',
        endA: { id: '16L', lat: 32.9752, lon: -97.3134 },
        endB: { id: '34R', lat: 33.0000, lon: -97.3242 },
        lengthFt: 9600, widthFt: 150, approximate: true,
      },
    ],
  },
  {
    icao: 'KFTW', name: 'Fort Worth Meacham Intl',
    lat: 32.8198, lon: -97.3624,
    runways: [
      {
        id: '16/34',
        endA: { id: '16', lat: 32.8101, lon: -97.3584 },
        endB: { id: '34', lat: 32.8295, lon: -97.3664 },
        lengthFt: 7502, widthFt: 100, approximate: true,
      },
    ],
  },
  {
    icao: 'KTKI', name: 'McKinney National',
    lat: 33.1781, lon: -96.5905,
    runways: [
      {
        id: '18/36',
        endA: { id: '18', lat: 33.1685, lon: -96.5905 },
        endB: { id: '36', lat: 33.1877, lon: -96.5905 },
        lengthFt: 7002, widthFt: 100, approximate: true,
      },
    ],
  },
];

const NM_PER_DEG_LAT = 60;
const FT_PER_NM = 6076.12;

// Return the two runway endpoints as { lat1, lon1, lat2, lon2 }.
// Uses stored endA/endB coordinates when available (new format).
// Falls back to center + heading + length derivation for legacy records.
export function runwayEndpoints(airport, runway) {
  if (runway.endA && runway.endB) {
    return {
      lat1: runway.endA.lat, lon1: runway.endA.lon,
      lat2: runway.endB.lat, lon2: runway.endB.lon,
    };
  }
  // Legacy fallback: derive from center + heading + length.
  const halfLenNm = runway.lengthFt / FT_PER_NM / 2;
  const hdg = (runway.headingDeg * Math.PI) / 180;
  const cosLat = Math.cos((airport.lat * Math.PI) / 180) || 1e-6;
  const dLat = (halfLenNm / NM_PER_DEG_LAT) * Math.cos(hdg);
  const dLon = (halfLenNm / NM_PER_DEG_LAT) * Math.sin(hdg) / cosLat;
  return {
    lat1: airport.lat + dLat, lon1: airport.lon + dLon,
    lat2: airport.lat - dLat, lon2: airport.lon - dLon,
  };
}

// Compute the true heading (degrees, 0=N) from endA toward endB so the
// renderer can orient runway number labels correctly.
export function runwayHeadingDeg(runway) {
  if (!runway.endA || !runway.endB) return runway.headingDeg ?? 0;
  const dLat = runway.endB.lat - runway.endA.lat;
  const cosLat = Math.cos((runway.endA.lat * Math.PI) / 180) || 1e-6;
  const dLon = (runway.endB.lon - runway.endA.lon) * cosLat;
  return ((Math.atan2(dLon, dLat) * 180 / Math.PI) + 360) % 360;
}

// Equirectangular distance from home to an airport reference point (NM).
// Used for culling airports that are outside the selected range.
export function airportDistanceNm(airport, home) {
  const cosLat = Math.cos((home.lat * Math.PI) / 180) || 1e-6;
  const dNorth = (airport.lat - home.lat) * NM_PER_DEG_LAT;
  const dEast  = (airport.lon - home.lon) * NM_PER_DEG_LAT * cosLat;
  return Math.hypot(dNorth, dEast);
}

// Counts of approximate vs. real-endpoint runways across the whole dataset.
// Used by the Status panel to indicate data provenance.
export const RUNWAY_DATASET_STATS = (() => {
  let total = 0, approx = 0;
  for (const ap of AIRPORTS) {
    for (const rw of ap.runways) {
      total++;
      if (rw.approximate) approx++;
    }
  }
  return { total, approx, exact: total - approx, airports: AIRPORTS.length };
})();
