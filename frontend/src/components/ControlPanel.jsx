// Above Live — ControlPanel.
// Display + data controls. Edits are pushed up to App via onChange (which saves
// to the backend). Kept deliberately simple: native inputs styled by CSS.

import React from 'react';
import { THEMES, THEME_KEYS } from '../lib/themes.js';
import {
  DISPLAY_MODES,
  DISPLAY_MODE_KEYS,
  RADAR_OVERLAY_ALL_ON,
  RADAR_OVERLAY_CLEAN_SKY,
} from '../lib/displayModes.js';

const PROVIDERS = ['MOCK', 'API', 'LOCAL_ADSB'];

const LAYER_TOGGLES = [
  { key: 'stars', label: 'Stars' },
  { key: 'iss', label: 'ISS' },
  { key: 'satellites', label: 'Satellites' },
  { key: 'starlink', label: 'Starlink' },
  { key: 'space', label: 'Planets' },
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

export default function ControlPanel({ settings, onChange, onToggleFullscreen, onReset, onOpenCalibration }) {
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

      <h3>Display</h3>

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
