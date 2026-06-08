// Above Live — aircraft motion model (smooth interpolation).
//
// The backend pushes a fresh aircraft snapshot roughly once per second. If we
// just drew each snapshot, planes would visibly "snap" forward once a second.
//
// Instead we keep a short, timestamped HISTORY of fixes for every aircraft and
// render the world a little bit IN THE PAST (renderDelayMs, ~1.15 s). Because
// that render time almost always falls *between* two fixes we already have, we
// can linearly interpolate between them — which is buttery smooth and never
// guesses. Only when we run past the newest fix do we briefly extrapolate
// ("dead reckon") along the reported heading/speed, capped to a few seconds so
// a dropped update can't fling a plane off into the distance.
//
// This is adapted from Skylight's renderer, kept in plain JavaScript and in
// lat/lon space so it plugs straight into Above Live's existing projector
// (frontend/src/lib/projectionMath.js) with no changes to the projection.

const NM_PER_DEG_LAT = 60;          // 1° latitude ≈ 60 nautical miles
const DEG2RAD = Math.PI / 180;

// Trail length bounds (seconds). The comet trail can be stretched well past the
// old 60 s cap for visual testing / projector work, up to 600 s.
export const TRAIL_MIN_SEC = 30;
export const TRAIL_MAX_SEC = 600;

/** Clamp a raw trailLength (seconds) to the supported range. */
export function clampTrailSec(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return TRAIL_MIN_SEC;
  return Math.max(TRAIL_MIN_SEC, Math.min(TRAIL_MAX_SEC, n));
}

/** Trail window in ms, derived from settings.trailLength (seconds), clamped. */
export function trailWindowMsFromSettings(settings) {
  return clampTrailSec(settings && settings.trailLength) * 1000;
}

// ---------------------------------------------------------------------------
// Small geo helpers (mirrors backend/aircraft/aircraftMath.js, kept local so
// the frontend has no backend import).
// ---------------------------------------------------------------------------

// Move a lat/lon point forward along `headingDeg` for `distanceNm`.
function advance(lat, lon, headingDeg, distanceNm) {
  const h = headingDeg * DEG2RAD;
  const dLat = (distanceNm / NM_PER_DEG_LAT) * Math.cos(h);
  const cosLat = Math.cos(lat * DEG2RAD) || 1e-6;
  const dLon = ((distanceNm / NM_PER_DEG_LAT) * Math.sin(h)) / cosLat;
  return { lat: lat + dLat, lon: lon + dLon };
}

// Bearing (deg, 0 = north) from point 1 to point 2.
function bearingDeg(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * DEG2RAD;
  const y = Math.sin(dLon) * Math.cos(lat2 * DEG2RAD);
  const x =
    Math.cos(lat1 * DEG2RAD) * Math.sin(lat2 * DEG2RAD) -
    Math.sin(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.cos(dLon);
  return (Math.atan2(y, x) / DEG2RAD + 360) % 360;
}

/**
 * Dead-reckon a position forward along its track at ground speed.
 * @param {{lat:number, lon:number}} position
 * @param {number} headingDeg   degrees, 0 = north
 * @param {number} speedKt      ground speed in knots
 * @param {number} dtSeconds    how far forward to project
 * @returns {{lat:number, lon:number}}
 */
export function deadReckonPosition(position, headingDeg, speedKt, dtSeconds) {
  if (!Number.isFinite(headingDeg) || !Number.isFinite(speedKt) || speedKt <= 0) {
    return { lat: position.lat, lon: position.lon };
  }
  // distance (nm) = speed (kt = nm/hour) × time (hours)
  const distanceNm = speedKt * (dtSeconds / 3600);
  return advance(position.lat, position.lon, headingDeg, distanceNm);
}

/**
 * Dead-reckon a position BACKWARD along its track — i.e. where the aircraft was
 * `secondsAgo` ago. Used to synthesize a predicted comet trail behind aircraft
 * on slow feeds (API) where real history fixes are sparse.
 * @returns {{lat:number, lon:number}}
 */
export function deadReckonBack(position, headingDeg, speedKt, secondsAgo) {
  return deadReckonPosition(position, headingDeg, speedKt, -Math.abs(secondsAgo));
}

/**
 * Ease one heading toward another along the SHORTEST arc, so an aircraft
 * turning from 350° to 010° rotates +20° (through north) instead of spinning
 * -340° the long way around.
 * @param {number|undefined} previousHeading  current rendered heading (deg) or undefined
 * @param {number} nextHeading                target heading (deg)
 * @param {number} [k=0.2]                     ease factor 0..1 (0 = no move, 1 = snap)
 * @returns {number} the new heading in [0, 360)
 */
export function smoothHeading(previousHeading, nextHeading, k = 0.2) {
  if (previousHeading == null || !Number.isFinite(previousHeading)) {
    return ((nextHeading % 360) + 360) % 360;
  }
  // Signed shortest delta in (-180, 180].
  const diff = ((nextHeading - previousHeading + 540) % 360) - 180;
  return ((previousHeading + diff * k) % 360 + 360) % 360;
}

// ---------------------------------------------------------------------------
// Track store
// ---------------------------------------------------------------------------

// Motion settings with safe fallbacks (so a partial settings object still works).
function motionCfg(settings) {
  const m = (settings && settings.motion) || {};
  return {
    interpolate: m.interpolate !== false,
    renderDelayMs: Number.isFinite(m.renderDelayMs) ? m.renderDelayMs : 1150,
    maxExtrapolationSec: Number.isFinite(m.maxExtrapolationSec) ? m.maxExtrapolationSec : 4,
    staleSec: Number.isFinite(m.staleSec) ? m.staleSec : 20,
  };
}

/**
 * Fold a fresh aircraft snapshot into the per-aircraft track map, stamping each
 * fix with the local arrival time `now` (pass performance.now()).
 *
 * Mutates and returns `tracks` (a Map keyed by aircraft id). Each track is:
 *   { ac, history:[{t,lat,lon,heading,speed}], firstSeen, lastSeen, life, renderHeading }
 *
 * @param {Map<string,object>} tracks
 * @param {Array<object>} aircraft  normalized aircraft (id, lat, lon, heading, speed, ...)
 * @param {number} now              performance.now()
 * @param {object} settings
 */
export function updateAircraftTracks(tracks, aircraft, now, settings) {
  const cfg = motionCfg(settings);
  // Keep a little more history than the longest thing that reads it (trails), so
  // longer trail windows actually have fixes to draw. Bounded by TRAIL_MAX_SEC.
  const keepMs = Math.max(60_000, trailWindowMsFromSettings(settings) + 5_000);

  for (const ac of aircraft || []) {
    if (ac == null || ac.id == null) continue;
    if (!Number.isFinite(ac.lat) || !Number.isFinite(ac.lon)) continue;

    let tr = tracks.get(ac.id);
    if (!tr) {
      tr = {
        ac,
        history: [],
        firstSeen: now,
        lastSeen: now,
        life: 0,            // fades 0→1 on spawn, →0 when stale
        renderHeading: Number.isFinite(ac.heading) ? ac.heading : undefined,
      };
      tracks.set(ac.id, tr);
    }
    tr.ac = ac;            // always keep the freshest metadata (alt/speed/squawk…)
    tr.lastSeen = now;

    const last = tr.history[tr.history.length - 1];
    // Dedup identical positions (feeds sometimes repeat the last fix).
    if (!last || last.lat !== ac.lat || last.lon !== ac.lon) {
      tr.history.push({
        t: now,
        lat: ac.lat,
        lon: ac.lon,
        heading: Number.isFinite(ac.heading) ? ac.heading : undefined,
        speed: Number.isFinite(ac.speed) ? ac.speed : undefined,
      });
    }
    // Trim ancient history but always keep at least two points to interpolate.
    while (tr.history.length > 2 && now - tr.history[0].t > keepMs) {
      tr.history.shift();
    }
  }
  return tracks;
}

/**
 * Position of a track at render time `renderTime` (a performance.now() value,
 * usually now - renderDelayMs).
 *
 * - Between two known fixes → linear interpolation (smooth, never guesses).
 * - Past the newest fix     → gentle dead reckoning, capped to maxExtrapolationSec.
 * - Before the oldest fix   → clamp to the oldest fix.
 *
 * @returns {{lat:number, lon:number}|null}
 */
export function sampleAircraftTrack(track, renderTime, settings) {
  const cfg = motionCfg(settings);
  const h = track && track.history;
  if (!h || h.length === 0) return null;

  // Before our earliest fix: just sit on it.
  if (renderTime <= h[0].t) return { lat: h[0].lat, lon: h[0].lon };

  const newest = h[h.length - 1];
  if (renderTime >= newest.t) {
    // Beyond the newest fix — extrapolate along heading/speed, capped.
    if (!cfg.interpolate) return { lat: newest.lat, lon: newest.lon };
    const dt = Math.min((renderTime - newest.t) / 1000, cfg.maxExtrapolationSec);
    return deadReckonPosition(newest, newest.heading, newest.speed, dt);
  }

  // Find the two fixes that bracket renderTime and blend between them.
  for (let i = h.length - 1; i > 0; i--) {
    const a = h[i - 1];
    const b = h[i];
    if (a.t <= renderTime && renderTime <= b.t) {
      const span = Math.max(1, b.t - a.t);
      const f = (renderTime - a.t) / span;   // 0 at a, 1 at b
      return {
        lat: a.lat + (b.lat - a.lat) * f,
        lon: a.lon + (b.lon - a.lon) * f,
      };
    }
  }
  return { lat: newest.lat, lon: newest.lon };
}

/**
 * Geographic heading (deg, 0 = north) for a track at `renderTime`.
 *
 * Preference order:
 *   1. Direction of travel derived from positions just before/after renderTime
 *      (robust, follows the actual motion).
 *   2. The reported heading on the freshest fix.
 *   3. 0.
 *
 * Returns a *raw* geographic heading; calibration rotation/flip is applied
 * later by projectHeading() in projectionMath.js. Smoothing between frames is
 * the caller's job via smoothHeading().
 */
export function sampleTrackHeading(track, renderTime, settings) {
  const a = sampleAircraftTrack(track, renderTime - 500, settings);
  const b = sampleAircraftTrack(track, renderTime + 500, settings);
  if (a && b) {
    const moved = Math.hypot(b.lat - a.lat, b.lon - a.lon);
    if (moved > 1e-7) return bearingDeg(a.lat, a.lon, b.lat, b.lon);
  }
  const ac = track && track.ac;
  if (ac && Number.isFinite(ac.heading)) return ((ac.heading % 360) + 360) % 360;
  return 0;
}

/**
 * Advance every track's fade ("life") toward 1 (visible) or 0 (going stale),
 * framerate-independently. Aircraft fade in when they appear and fade out as
 * they approach the stale cutoff.
 *
 * @param {Map} tracks
 * @param {number} now        performance.now()
 * @param {number} frameDt    seconds since last frame
 * @param {object} settings
 */
export function updateTrackLife(tracks, now, frameDt, settings) {
  const cfg = motionCfg(settings);
  const staleMs = cfg.staleSec * 1000;
  const ease = Math.min(1, frameDt * 3.5);
  for (const tr of tracks.values()) {
    const staleFor = now - tr.lastSeen;
    // Start fading out once we're halfway to the stale cutoff.
    const target = staleFor > staleMs * 0.5 ? 0 : 1;
    tr.life += (target - tr.life) * ease;
  }
}

/**
 * Delete tracks that haven't been updated within `staleMs` (defaults to the
 * configured staleSec). Returns the number removed.
 *
 * @param {Map} tracks
 * @param {number} now      performance.now()
 * @param {number} [staleMs]
 */
export function pruneStaleTracks(tracks, now, staleMs) {
  if (!Number.isFinite(staleMs)) staleMs = 20_000;
  let removed = 0;
  for (const [id, tr] of tracks) {
    if (now - tr.lastSeen > staleMs) {
      tracks.delete(id);
      removed++;
    }
  }
  return removed;
}

/** Convenience: the configured stale window in ms (for pruneStaleTracks). */
export function staleMsFromSettings(settings) {
  return motionCfg(settings).staleSec * 1000;
}

/** Convenience: render delay in ms (how far in the past we draw). */
export function renderDelayMs(settings) {
  return motionCfg(settings).renderDelayMs;
}

/**
 * Return settings with motion parameters scaled for the current provider.
 *
 * API feeds push data only every ~60 s. With default fast-feed values
 * (maxExtrapolationSec: 4, staleSec: 20) aircraft freeze 4 s after each
 * fetch and disappear before the next one arrives. This function overrides
 * those values so aircraft keep moving across the full API poll interval.
 *
 * MOCK and LOCAL_ADSB push every ~1 s, so their defaults work as-is.
 */
export function effectiveMotionSettings(settings) {
  if (!settings) return settings;
  if (String(settings.provider || 'MOCK').toUpperCase() !== 'API') return settings;
  const m = settings.motion || {};
  return {
    ...settings,
    motion: {
      ...m,
      renderDelayMs: 5000,       // stay inside the interpolation window
      maxExtrapolationSec: 70,   // dead-reckon across the full ~60 s poll interval
      staleSec: 100,             // survive a full cycle (plus margin) without an update
    },
  };
}

/**
 * Returns 'api' when API mode overrides are active, 'fast' otherwise.
 * Used by the Status panel to label the motion configuration.
 */
export function motionMode(settings) {
  return String((settings && settings.provider) || 'MOCK').toUpperCase() === 'API'
    ? 'api'
    : 'fast';
}
