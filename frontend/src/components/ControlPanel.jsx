// Above Live — ControlPanel.
// Display + data controls. Edits are pushed up to App via onChange (which saves
// to the backend). Kept deliberately simple: native inputs styled by CSS.

import React, { useState, useEffect } from 'react';
import { THEMES, THEME_KEYS } from '../lib/themes.js';
import {
  DISPLAY_MODES,
  DISPLAY_MODE_KEYS,
  RADAR_OVERLAY_ALL_ON,
  RADAR_OVERLAY_CLEAN_SKY,
} from '../lib/displayModes.js';
import { DEFAULT_SETTINGS } from '../lib/defaults.js';

const PROVIDERS = ['MOCK', 'API', 'LOCAL_ADSB'];

const LAYER_TOGGLES = [
  { key: 'stars', label: 'Stars' },
  { key: 'iss', label: 'ISS' },
  { key: 'satellites', label: 'Satellites' },
  { key: 'starlink', label: 'Starlink' },
  { key: 'space', label: 'Planets / Moon / Sun' },
  { key: 'weather', label: 'Weather' },
];

// Individual element brightness sliders shown only in projector mode.
const BRIGHTNESS_ELEMENTS = [
  { key: 'aircraft', label: 'Aircraft' },
  { key: 'labels', label: 'Labels' },
  { key: 'trails', label: 'Trails' },
  { key: 'rings', label: 'Rings' },
  { key: 'stars', label: 'Stars' },
  { key: 'satellites', label: 'Satellites' },
];

// Per-type celestial dimming (Sun / Moon / planets / their labels). 0 hides,
// 1 = full intended brightness. Works in every display mode.
const CELESTIAL_BRIGHTNESS_ELEMENTS = [
  { key: 'sun', label: 'Sun' },
  { key: 'moon', label: 'Moon' },
  { key: 'planets', label: 'Planets' },
  { key: 'labels', label: 'Labels' },
];

// Validate lat/lon inputs. Returns an error string or null.
function validateHome(lat, lon) {
  const latN = Number(lat);
  const lonN = Number(lon);
  if (!Number.isFinite(latN) || latN < -90 || latN > 90)
    return 'Latitude must be a number between -90 and 90';
  if (!Number.isFinite(lonN) || lonN < -180 || lonN > 180)
    return 'Longitude must be a number between -180 and 180';
  return null;
}

export default function ControlPanel({ settings, onChange, onHomeChange, onToggleFullscreen, onReset, onOpenCalibration }) {
  const d = settings.display;
  const layers = settings.layers || {};
  const bm = d.brightnessMap || {};
  const motion = settings.motion || {};
  const radar = d.radar || {};

  const setDisplay = (patch) => onChange({ display: { ...d, ...patch } });
  const setLayer = (key, value) => onChange({ layers: { ...layers, [key]: value } });
  const setRadar = (key, value) => setDisplay({ radar: { ...radar, [key]: value } });
  const setRadarAll = (preset) => setDisplay({ radar: { ...preset } });
  const setMotion = (patch) => onChange({ motion: { ...motion, ...patch } });
  const setBrightnessMap = (key, val) =>
    setDisplay({ brightnessMap: { ...bm, [key]: val } });
  const cbright = d.celestialBrightness || {};
  const setCelestialBrightness = (key, val) =>
    setDisplay({ celestialBrightness: { ...cbright, [key]: val } });

  // ── Home location local edit state ──────────────────────────────────────────
  const [homeName, setHomeName] = useState(settings.home?.name ?? '');
  const [homeLat,  setHomeLat]  = useState(String(settings.home?.lat ?? ''));
  const [homeLon,  setHomeLon]  = useState(String(settings.home?.lon ?? ''));
  const [homeError, setHomeError] = useState(null);
  const [geoStatus, setGeoStatus] = useState(null); // 'locating' | 'ok' | 'error'

  // Sync the input fields when settings.home changes externally (e.g., reset).
  useEffect(() => {
    setHomeName(settings.home?.name ?? '');
    setHomeLat(String(settings.home?.lat ?? ''));
    setHomeLon(String(settings.home?.lon ?? ''));
    setHomeError(null);
  }, [settings.home?.lat, settings.home?.lon, settings.home?.name]);

  function applyHome() {
    const err = validateHome(homeLat, homeLon);
    if (err) { setHomeError(err); return; }
    setHomeError(null);
    const homeObj = {
      name: homeName.trim() || 'Home',
      lat: Math.round(Number(homeLat) * 1e6) / 1e6,
      lon: Math.round(Number(homeLon) * 1e6) / 1e6,
    };
    if (onHomeChange) onHomeChange(homeObj, 'settings');
    else onChange({ home: homeObj });
  }

  function resetHome() {
    const def = DEFAULT_SETTINGS.home;
    setHomeName(def.name);
    setHomeLat(String(def.lat));
    setHomeLon(String(def.lon));
    setHomeError(null);
    if (onHomeChange) onHomeChange({ ...def }, 'default');
    else onChange({ home: { ...def } });
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setHomeError('Geolocation is not supported by this browser.');
      return;
    }
    setGeoStatus('locating');
    setHomeError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Math.round(pos.coords.latitude  * 1e6) / 1e6;
        const lon = Math.round(pos.coords.longitude * 1e6) / 1e6;
        const homeObj = { name: homeName.trim() || 'My location', lat, lon };
        setHomeLat(String(lat));
        setHomeLon(String(lon));
        setGeoStatus('ok');
        if (onHomeChange) onHomeChange(homeObj, 'browser');
        else onChange({ home: homeObj });
      },
      (err) => {
        setGeoStatus('error');
        setHomeError(`Location denied or unavailable: ${err.message}`);
      },
      { timeout: 10000, maximumAge: 60000 }
    );
  }

  return (
    <div className="panel-section">
      <h3>Data</h3>

      <label className="field">
        <span>Provider</span>
        <select value={settings.provider} onChange={(e) => onChange({ provider: e.target.value })}>
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Range</span>
        <select value={settings.rangeNm} onChange={(e) => onChange({ rangeNm: Number(e.target.value) })}>
          {[20, 40, 60, 100, 150, 250].map((r) => (
            <option key={r} value={r}>{r} nm</option>
          ))}
        </select>
      </label>

      {/* ── Home location ──────────────────────────────────────────────────── */}
      <h3>Home Location</h3>
      <p className="field-hint">
        Sets the map center and range origin. Aircraft, satellites, planets and
        the Moon all use this position. Changes persist after restart.
      </p>

      <label className="field">
        <span>Label</span>
        <input
          type="text"
          value={homeName}
          maxLength={48}
          placeholder="e.g. Home, Office, Backyard"
          onChange={(e) => setHomeName(e.target.value)}
        />
      </label>

      <label className="field">
        <span>Latitude</span>
        <input
          type="text"
          inputMode="decimal"
          value={homeLat}
          placeholder="-90 to 90"
          onChange={(e) => setHomeLat(e.target.value)}
          onBlur={applyHome}
        />
      </label>

      <label className="field">
        <span>Longitude</span>
        <input
          type="text"
          inputMode="decimal"
          value={homeLon}
          placeholder="-180 to 180"
          onChange={(e) => setHomeLon(e.target.value)}
          onBlur={applyHome}
        />
      </label>

      {homeError && <p className="field-error">{homeError}</p>}
      {geoStatus === 'locating' && <p className="field-hint">Locating…</p>}
      {geoStatus === 'ok' && <p className="field-hint" style={{ color: '#4caf97' }}>Location applied.</p>}

      <div className="btn-row">
        <button className="btn" onClick={applyHome}>Apply</button>
        <button className="btn" onClick={resetHome}>Reset default</button>
        <button className="btn" onClick={useMyLocation}>Use my location</button>
      </div>

      <h3>Display</h3>

      <div className="btn-row">
        <button
          className="btn"
          onClick={() => onChange({ display: { ...d, displayMode: 'projector', radar: { ...RADAR_OVERLAY_CLEAN_SKY } } })}
        >
          Projector clean sky
        </button>
      </div>
      <p className="field-hint">Sets projector mode + hides all radar overlay elements.</p>

      <label className="field">
        <span>Mode</span>
        <select value={d.displayMode || 'normal'} onChange={(e) => setDisplay({ displayMode: e.target.value })}>
          {DISPLAY_MODE_KEYS.map((k) => (
            <option key={k} value={k}>{DISPLAY_MODES[k].label}</option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Theme</span>
        <select value={d.theme} onChange={(e) => setDisplay({ theme: e.target.value })}>
          {THEME_KEYS.map((k) => (
            <option key={k} value={k}>{THEMES[k].label}</option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Brightness</span>
        <input
          type="range" min="0.3" max="1" step="0.05"
          value={d.brightness}
          onChange={(e) => setDisplay({ brightness: Number(e.target.value) })}
        />
      </label>

      <label className="field">
        <span>Aircraft size</span>
        <input
          type="range" min="0.5" max="2.5" step="0.1"
          value={d.aircraftSize}
          onChange={(e) => setDisplay({ aircraftSize: Number(e.target.value) })}
        />
      </label>

      <label className="field toggle">
        <span>Labels</span>
        <input type="checkbox" checked={d.labels} onChange={(e) => setDisplay({ labels: e.target.checked })} />
      </label>

      <label className="field toggle">
        <span>Trails</span>
        <input type="checkbox" checked={d.trails} onChange={(e) => setDisplay({ trails: e.target.checked })} />
      </label>

      {d.trails && (
        <>
          <label className="field">
            <span>Trail length ({settings.trailLength ?? 30}s)</span>
            <input
              type="range" min="30" max="600" step="10"
              value={settings.trailLength ?? 30}
              onChange={(e) => onChange({ trailLength: Number(e.target.value) })}
            />
          </label>
          <p className="field-hint">
            Longer trails are thinned to stay light on a Raspberry Pi. 30s short · 300s default max · 600s for testing.
          </p>
        </>
      )}

      <label className="field toggle">
        <span>Altitude colour</span>
        <input
          type="checkbox"
          checked={d.altitudeColor !== false}
          onChange={(e) => setDisplay({ altitudeColor: e.target.checked })}
        />
      </label>

      <label className="field toggle">
        <span>Emergency highlight</span>
        <input
          type="checkbox"
          checked={d.highlightEmergency !== false}
          onChange={(e) => setDisplay({ highlightEmergency: e.target.checked })}
        />
      </label>

      <h3>Labels</h3>

      <label className="field">
        <span>Show</span>
        <select
          value={d.labelDensity || 'nearestN'}
          onChange={(e) => setDisplay({ labelDensity: e.target.value })}
        >
          <option value="all">All</option>
          <option value="nearestN">Nearest N</option>
          <option value="nearestOnly">Nearest only</option>
        </select>
      </label>

      {(d.labelDensity || 'nearestN') === 'nearestN' && (
        <label className="field">
          <span>Nearest N ({d.nearestN ?? 5})</span>
          <input
            type="range" min="1" max="20" step="1"
            value={d.nearestN ?? 5}
            onChange={(e) => setDisplay({ nearestN: Number(e.target.value) })}
          />
        </label>
      )}

      <label className="field toggle">
        <span>Glyph debug</span>
        <input
          type="checkbox"
          checked={Boolean(d.glyphDebug)}
          onChange={(e) => setDisplay({ glyphDebug: e.target.checked })}
        />
      </label>
      <p className="field-hint">Shows type code and glyph class below each callsign.</p>

      <label className="field">
        <span>Space labels</span>
        <select
          value={d.spaceLabels || 'major'}
          onChange={(e) => setDisplay({ spaceLabels: e.target.value })}
        >
          <option value="off">Off</option>
          <option value="major">Major (Sun, Moon, ISS)</option>
          <option value="all">All objects</option>
        </select>
      </label>

      <label className="field toggle">
        <span>Moon path arc</span>
        <input
          type="checkbox"
          checked={d.showMoonPath !== false}
          onChange={(e) => setDisplay({ showMoonPath: e.target.checked })}
        />
      </label>
      <p className="field-hint">Shows the Moon's daily arc across the sky (when Planets layer is on).</p>

      <h3>Celestial Brightness</h3>
      <p className="field-hint">
        Dim the Sun, Moon and planets so they never overpower aircraft. 0% hides,
        100% is full brightness. Aircraft are unaffected and always draw on top.
      </p>
      {CELESTIAL_BRIGHTNESS_ELEMENTS.map(({ key, label }) => (
        <label className="field" key={key}>
          <span>{label} ({Math.round((cbright[key] ?? 1) * 100)}%)</span>
          <input
            type="range" min="0" max="1" step="0.05"
            value={cbright[key] ?? 1}
            onChange={(e) => setCelestialBrightness(key, Number(e.target.value))}
          />
        </label>
      ))}

      <h3>Radar Overlay</h3>
      <p className="field-hint">
        Hide the radar/compass guides for a clean live-sky look. Aircraft,
        satellites, planets, ISS and stars keep rendering normally.
      </p>

      <div className="btn-row">
        <button className="btn" onClick={() => setRadarAll(RADAR_OVERLAY_ALL_ON)}>Radar (all on)</button>
        <button className="btn" onClick={() => setRadarAll(RADAR_OVERLAY_CLEAN_SKY)}>Clean sky</button>
      </div>

      <label className="field toggle">
        <span>Range rings</span>
        <input
          type="checkbox"
          checked={radar.rings !== false}
          onChange={(e) => setRadar('rings', e.target.checked)}
        />
      </label>

      <label className="field toggle">
        <span>Compass labels</span>
        <input
          type="checkbox"
          checked={radar.compass !== false}
          onChange={(e) => setRadar('compass', e.target.checked)}
        />
      </label>

      <label className="field toggle">
        <span>Nautical-mile labels</span>
        <input
          type="checkbox"
          checked={radar.nmLabels !== false}
          onChange={(e) => setRadar('nmLabels', e.target.checked)}
        />
      </label>

      <label className="field toggle">
        <span>Center crosshair</span>
        <input
          type="checkbox"
          checked={radar.crosshair !== false}
          onChange={(e) => setRadar('crosshair', e.target.checked)}
        />
      </label>

      <h3>Motion &amp; Performance</h3>

      <label className="field toggle">
        <span>Smooth motion</span>
        <input
          type="checkbox"
          checked={motion.interpolate !== false}
          onChange={(e) => setMotion({ interpolate: e.target.checked })}
        />
      </label>
      <p className="field-hint">Interpolates between aircraft updates.</p>

      <label className="field">
        <span>Max FPS</span>
        <select
          value={String(d.maxFps ?? 30)}
          onChange={(e) => setDisplay({ maxFps: Number(e.target.value) })}
        >
          <option value="0">Uncapped</option>
          <option value="24">24</option>
          <option value="30">30 (Pi safe)</option>
          <option value="60">60</option>
        </select>
      </label>
      <p className="field-hint">30 FPS is a good default on a Raspberry Pi 4.</p>

      {/* Per-element brightness controls — projector mode only */}
      {d.displayMode === 'projector' && (
        <>
          <h3>Projector Levels</h3>
          <p className="field-hint">Fine-tune each element for your projector and room.</p>
          {BRIGHTNESS_ELEMENTS.map(({ key, label }) => (
            <label className="field" key={key}>
              <span>{label}</span>
              <input
                type="range" min="0" max="1" step="0.05"
                value={bm[key] ?? 1}
                onChange={(e) => setBrightnessMap(key, Number(e.target.value))}
              />
            </label>
          ))}
        </>
      )}

      <h3>Layers</h3>

      <label className="field toggle">
        <span>Aircraft</span>
        <input
          type="checkbox"
          checked={Boolean(layers.aircraft !== false)}
          onChange={(e) => setLayer('aircraft', e.target.checked)}
        />
      </label>
      {LAYER_TOGGLES.map((l) => (
        <label className="field toggle" key={l.key}>
          <span>{l.label}</span>
          <input
            type="checkbox"
            checked={Boolean(layers[l.key])}
            onChange={(e) => setLayer(l.key, e.target.checked)}
          />
        </label>
      ))}
      <p className="field-hint">
        Optional layers are off by default and never affect the aircraft display.
        ISS, Satellites &amp; Starlink use cached CelesTrak orbits; Planets are computed locally.
      </p>

      <div className="btn-row">
        <button className="btn" onClick={onToggleFullscreen}>Fullscreen</button>
        <button className="btn" onClick={onOpenCalibration}>Calibration</button>
      </div>

      <button className="btn btn-danger" onClick={onReset}>Reset all settings</button>
    </div>
  );
}
