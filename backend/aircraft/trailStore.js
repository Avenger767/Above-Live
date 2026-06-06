// Above Live — trail store.
// Keeps a short rolling history of recent positions per aircraft id so the
// renderer can draw fading trails. Stale aircraft are pruned automatically.

const PRUNE_AFTER_MS = 30_000; // forget aircraft not seen for 30s

export function createTrailStore(maxPoints = 30) {
  // id -> { points: [{lat, lon, t}], lastSeen }
  const trails = new Map();
  let limit = maxPoints;

  function setLimit(n) {
    limit = Math.max(2, Math.min(200, Number(n) || maxPoints));
  }

  // Update trails from the latest aircraft snapshot.
  function update(aircraftList) {
    const now = Date.now();
    for (const ac of aircraftList) {
      let entry = trails.get(ac.id);
      if (!entry) {
        entry = { points: [], lastSeen: now };
        trails.set(ac.id, entry);
      }
      const last = entry.points[entry.points.length - 1];
      // Only push if the aircraft actually moved (avoids duplicate points).
      if (!last || last.lat !== ac.lat || last.lon !== ac.lon) {
        entry.points.push({ lat: ac.lat, lon: ac.lon, t: now });
        if (entry.points.length > limit) entry.points.shift();
      }
      entry.lastSeen = now;
    }
    // Prune aircraft we haven't seen recently.
    for (const [id, entry] of trails) {
      if (now - entry.lastSeen > PRUNE_AFTER_MS) trails.delete(id);
    }
  }

  // Returns a plain object: { [id]: [{lat, lon, t}, ...] }
  function snapshot() {
    const out = {};
    for (const [id, entry] of trails) out[id] = entry.points;
    return out;
  }

  function clear() {
    trails.clear();
  }

  return { update, snapshot, clear, setLimit };
}
