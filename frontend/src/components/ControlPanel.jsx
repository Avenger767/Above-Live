// Above Live — ControlPanel.
// Display + data controls. Edits are pushed up to App via onChange (which saves
// to the backend). Kept deliberately simple: native inputs styled by CSS.

import React from 'react';
import { THEMES, THEME_KEYS } from '../lib/themes.js';

const PROVIDERS = ['MOCK', 'API', 'LOCAL_ADSB'];

export default function ControlPanel({ settings, onChange, onToggleFullscreen, onReset, onOpenCalibration }) {
  const d = settings.display;

  const setDisplay = (patch) => onChange({ display: { ...d, ...patch } });

  return (
    <div className="panel-section">
      <h3>Data</h3>

      <label className="field">
        <span>Provider</span>
        <select value={settings.provider} onChange={(e) => onChange({ provider: e.target.value })}>
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>

      {settings.provider === 'API' && (
        <div className="hint">
          Adapter: <b>{settings.api?.adapter || 'airplaneslive'}</b>
          {' — '}set <code>PROVIDER=API</code> in <code>backend/.env</code> to activate.
        </div>
      )}

      <label className="field">
        <span>Range</span>
        <select value={settings.rangeNm} onChange={(e) => onChange({ rangeNm: Number(e.target.value) })}>
          {[20, 40, 60, 100, 150, 250].map((r) => (
            <option key={r} value={r}>
              {r} nm
            </option>
          ))}
        </select>
      </label>

      <h3>Display</h3>

      <label className="field">
        <span>Theme</span>
        <select value={d.theme} onChange={(e) => setDisplay({ theme: e.target.value })}>
          {THEME_KEYS.map((k) => (
            <option key={k} value={k}>
              {THEMES[k].label}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Brightness</span>
        <input
          type="range"
          min="0.3"
          max="1"
          step="0.05"
          value={d.brightness}
          onChange={(e) => setDisplay({ brightness: Number(e.target.value) })}
        />
      </label>

      <label className="field">
        <span>Aircraft size</span>
        <input
          type="range"
          min="0.5"
          max="2.5"
          step="0.1"
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

      <div className="btn-row">
        <button className="btn" onClick={onToggleFullscreen}>
          Fullscreen
        </button>
        <button className="btn" onClick={onOpenCalibration}>
          Calibration
        </button>
      </div>

      <button className="btn btn-danger" onClick={onReset}>
        Reset all settings
      </button>
    </div>
  );
}
