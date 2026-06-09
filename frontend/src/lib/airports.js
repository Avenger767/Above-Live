// Above Live — local airport / runway starter dataset.
//
// A small, dependency-free, LOCAL dataset so the runway layer works offline and
// never depends on a paid API. Each airport stores its ICAO code, name, a
// reference lat/lon, and one or more runways described by an identifier, a TRUE
// heading (degrees, 0 = north) and a length in feet. Runway endpoints are
// derived from the airport reference point + heading + length at render time
// (see runwayEndpoints), which keeps the data compact and easy to extend.
//
// This intentionally covers only the Dallas–Fort Worth area. The structure is
// deliberately simple so a larger (e.g. continental or worldwide) runway
// database can be dropped in later without touching the renderer.
//
// NOTE: runway geometry is approximate — runways radiate from the airport
// reference point rather than their individual thresholds — which is plenty
// accurate for a subtle ground-reference strip at this map scale.

export const AIRPORTS = [
  {
    icao: 'KDFW',
    name: 'Dallas/Fort Worth Intl',
    lat: 32.8998,
    lon: -97.0403,
    runways: [
      { id: '17R/35L', headingDeg: 175, lengthFt: 13401 },
      { id: '18L/36R', headingDeg: 184, lengthFt: 13400 },
      { id: '13R/31L', headingDeg: 128, lengthFt: 9000 },
    ],
  },
  {
    icao: 'KDAL',
    name: 'Dallas Love Field',
    lat: 32.8471,
    lon: -96.8518,
    runways: [
      { id: '13L/31R', headingDeg: 131, lengthFt: 8800 },
      { id: '18/36', headingDeg: 180, lengthFt: 6147 },
    ],
  },
  {
    icao: 'KADS',
    name: 'Addison',
    lat: 32.9686,
    lon: -96.8364,
    runways: [{ id: '16/34', headingDeg: 156, lengthFt: 7203 }],
  },
  {
    icao: 'KGKY',
    name: 'Arlington Municipal',
    lat: 32.6638,
    lon: -97.0943,
    runways: [{ id: '16/34', headingDeg: 160, lengthFt: 6080 }],
  },
  {
    icao: 'KRBD',
    name: 'Dallas Executive',
    lat: 32.6809,
    lon: -96.8682,
    runways: [
      { id: '13/31', headingDeg: 131, lengthFt: 6451 },
      { id: '17/35', headingDeg: 175, lengthFt: 3800 },
    ],
  },
  {
    icao: 'KAFW',
    name: 'Fort Worth Alliance',
    lat: 32.9876,
    lon: -97.3188,
    runways: [{ id: '16L/34R', headingDeg: 160, lengthFt: 9600 }],
  },
  {
    icao: 'KFTW',
    name: 'Fort Worth Meacham Intl',
    lat: 32.8198,
    lon: -97.3624,
    runways: [{ id: '16/34', headingDeg: 161, lengthFt: 7502 }],
  },
  {
    icao: 'KTKI',
    name: 'McKinney National',
    lat: 33.1781,
    lon: -96.5905,
    runways: [{ id: '18/36', headingDeg: 180, lengthFt: 7002 }],
  },
];

const NM_PER_DEG_LAT = 60;
const FT_PER_NM = 6076.12;

// Derive the two runway endpoints (lat/lon) from an airport reference point and
// a runway's true heading + length. Endpoints are placed symmetrically about
// the airport reference. Returns { lat1, lon1, lat2, lon2 }.
export function runwayEndpoints(airport, runway) {
  const halfLenNm = runway.lengthFt / FT_PER_NM / 2;
  const hdg = (runway.headingDeg * Math.PI) / 180;
  const cosLat = Math.cos((airport.lat * Math.PI) / 180) || 1e-6;
  const dLat = (halfLenNm / NM_PER_DEG_LAT) * Math.cos(hdg);          // north component
  const dLon = (halfLenNm / NM_PER_DEG_LAT) * Math.sin(hdg) / cosLat; // east component
  return {
    lat1: airport.lat + dLat,
    lon1: airport.lon + dLon,
    lat2: airport.lat - dLat,
    lon2: airport.lon - dLon,
  };
}

// Great-circle-ish nautical-mile distance from home to an airport (small-angle
// equirectangular approximation — fine for culling at this range).
export function airportDistanceNm(airport, home) {
  const cosLat = Math.cos((home.lat * Math.PI) / 180) || 1e-6;
  const dNorth = (airport.lat - home.lat) * NM_PER_DEG_LAT;
  const dEast = (airport.lon - home.lon) * NM_PER_DEG_LAT * cosLat;
  return Math.hypot(dNorth, dEast);
}
