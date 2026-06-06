// Above Live — MOCK provider.
// Generates believable fake aircraft that drift smoothly around the configured
// home location. Requires no API key and no hardware: this is the default and
// always-available data source, and the fallback for the other providers.

import { advancePosition, haversineNm, bearingDeg, clamp } from '../aircraftMath.js';
import { normalizeList } from '../aircraftNormalizer.js';

const AIRLINES = ['AAL', 'DAL', 'UAL', 'SWA', 'JBU', 'FFT', 'SKW', 'ASA', 'NKS', 'ENY'];
const TYPES = ['A321', 'A320', 'B738', 'B739', 'A319', 'E175', 'CRJ9', 'B752', 'A20N', 'B38M'];

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Each fake flight keeps its own state so motion is continuous between ticks.
function spawnAircraft(home, rangeNm) {
  // Spawn somewhere within ~80% of the range, at a random bearing from home.
  const dist = rand(rangeNm * 0.1, rangeNm * 0.8);
  const brg = rand(0, 360);
  const pos = advancePosition(home.lat, home.lon, brg, dist);
  return {
    id: pick(AIRLINES) + Math.floor(rand(100, 9999)),
    lat: pos.lat,
    lon: pos.lon,
    altitude: Math.round(rand(8000, 39000) / 500) * 500,
    speed: Math.round(rand(280, 480)),
    heading: rand(0, 360),
    aircraftType: pick(TYPES),
    // Slow drift applied to heading each tick for gentle, lifelike turns.
    turnRate: rand(-0.3, 0.3),
  };
}

export function createMockProvider() {
  const name = 'mock';
  let fleet = [];
  let lastTick = Date.now();
  let initializedFor = null;

  function ensureFleet(home, rangeNm) {
    // (Re)seed the fleet if empty or if the home location changed a lot.
    const key = `${home.lat.toFixed(2)},${home.lon.toFixed(2)}`;
    if (fleet.length === 0 || initializedFor !== key) {
      const count = Math.floor(rand(8, 13));
      fleet = Array.from({ length: count }, () => spawnAircraft(home, rangeNm));
      initializedFor = key;
    }
  }

  async function fetchAircraft(settings) {
    const home = settings.home;
    const rangeNm = settings.rangeNm || 60;
    ensureFleet(home, rangeNm);

    const now = Date.now();
    const dtSec = clamp((now - lastTick) / 1000, 0, 5);
    lastTick = now;

    for (const ac of fleet) {
      // Gentle heading drift.
      ac.heading = (ac.heading + ac.turnRate * dtSec + 360) % 360;

      // Advance by speed (knots) over elapsed time.
      const distNm = (ac.speed / 3600) * dtSec;
      const next = advancePosition(ac.lat, ac.lon, ac.heading, distNm);
      ac.lat = next.lat;
      ac.lon = next.lon;

      // If it strays too far, steer it back toward home so the display stays busy.
      const d = haversineNm(home.lat, home.lon, ac.lat, ac.lon);
      if (d > rangeNm * 1.1) {
        const back = bearingDeg(ac.lat, ac.lon, home.lat, home.lon);
        // Ease toward the home bearing rather than snapping.
        let diff = ((back - ac.heading + 540) % 360) - 180;
        ac.heading = (ac.heading + diff * 0.1 + 360) % 360;
      }

      // Occasional small altitude / speed wander for visual interest.
      if (Math.random() < 0.02) ac.altitude = clamp(ac.altitude + rand(-1000, 1000), 5000, 41000);
      if (Math.random() < 0.02) ac.speed = clamp(ac.speed + rand(-15, 15), 220, 510);
    }

    const raw = fleet.map((ac) => ({
      id: ac.id,
      callsign: ac.id,
      lat: ac.lat,
      lon: ac.lon,
      altitude: Math.round(ac.altitude),
      speed: Math.round(ac.speed),
      heading: Math.round(ac.heading),
      aircraftType: ac.aircraftType,
      timestamp: now,
    }));

    return normalizeList(raw, name, home);
  }

  return { name, fetchAircraft };
}
