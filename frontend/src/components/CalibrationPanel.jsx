// Above Live — CalibrationPanel.
// Aligns the projected image to a real surface. Includes a toggle for the
// on-screen test pattern (grid / center / ring / compass / corners) so you can
// fine-tune offset, scale, rotation and flips against a known reference.

import React from 'react';
import { ceilingPreset, clampScale } from '../lib/projectionMath.js';

const SUBCAL_DEFAULT = { scale: 1, offsetX: 0, offsetY: 0 };

export default function CalibrationPanel({ settings, onChange, testPattern, onToggleTest, onResetCalibration }) {
  const c = settings.calibration;
  const d = settings.display || {};
  const ac = c.aircraft || SUBCAL_DEFAULT;
  const cel = c.celestial || SUBCAL_DEFAULT;
  const set = (patch) => onChange({ calibration: { ...c, ...patch } });
  const setDisplay = (patch) => onChange({ display: { ...d, ...patch } });
  const setAircraft = (patch) => onChange({ calibration: { aircraft: { ...ac, ...patch } } });
  const setCelestial = (patch) => onChange({ calibration: { celestial: { ...cel, ...patch } } });
  const resetAircraft = () => onChange({ calibration: { aircraft: { ...SUBCAL_DEFAULT } } });
  const resetCelestial = () => onChange({ calibration: { celestial: { ...SUBCAL_DEFAULT } } });
  const applyCeilingPreset = () => onChange({ calibration: { ...c, ...ceilingPreset() } });

  return (
    <div className="panel-section">
      <h3>Calibration</h3>

      <label className="field toggle">
        <span>Test pattern</span>
        <input type="checkbox" checked={testPattern} onChange={(e) => onToggleTest(e.target.checked)} />
      </label>

      <label className="field">
        <span>Offset X ({Math.round(c.offsetX)})</span>
        <input
          type="range"
          min="-400"
          max="400"
          step="1"
          value={c.offsetX}
          onChange={(e) => set({ offsetX: Number(e.target.value) })}
        />
      </label>

      <label className="field">
        <span>Offset Y ({Math.round(c.offsetY)})</span>
        <input
          type="range"
          min="-400"
          max="400"
          step="1"
          value={c.offsetY}
          onChange={(e) => set({ offsetY: Number(e.target.value) })}
        />
      </label>

      <label className="field">
        <span>Scale: {Number(c.scale ?? 1).toFixed(2)}×</span>
        <input
          type="range"
          min="0.25"
          max="10"
          step="0.05"
          value={c.scale ?? 1}
          onChange={(e) => set({ scale: clampScale(Number(e.target.value)) })}
        />
      </label>
      <div className="btn-row">
        <button className="btn" onClick={() => set({ scale: 1 })}>Scale 1×</button>
        <button className="btn" onClick={() => set({ scale: 2 })}>2×</button>
        <button className="btn" onClick={() => set({ scale: 5 })}>5×</button>
        <button className="btn" onClick={() => set({ scale: 10 })}>10×</button>
      </div>
      <p className="field-hint">Expands the radar/projection view up to 10× — aircraft data is unchanged.</p>

      <label className="field">
        <span>Rotation ({Math.round(c.rotation)}°)</span>
        <input
          type="range"
          min="-180"
          max="180"
          step="1"
          value={c.rotation}
          onChange={(e) => set({ rotation: Number(e.target.value) })}
        />
      </label>

      <label className="field toggle">
        <span>Flip horizontal</span>
        <input type="checkbox" checked={c.flipH} onChange={(e) => set({ flipH: e.target.checked })} />
      </label>

      <label className="field toggle">
        <span>Flip vertical</span>
        <input type="checkbox" checked={c.flipV} onChange={(e) => set({ flipV: e.target.checked })} />
      </label>

      <label className="field">
        <span>Label rotation ({Math.round(d.labelRotationDeg || 0)}°)</span>
        <input
          type="range"
          min="-180"
          max="180"
          step="1"
          value={d.labelRotationDeg || 0}
          onChange={(e) => setDisplay({ labelRotationDeg: Number(e.target.value) })}
        />
      </label>
      <p className="field-hint">
        Rotates text only, so labels read upright from where you lie under a ceiling projector.
      </p>

      <button className="btn" onClick={applyCeilingPreset}>
        Ceiling preset
      </button>
      <p className="field-hint">
        Mirrors horizontally and resets offset/scale/rotation — a good start for a ceiling-mounted projector.
      </p>

      {/* ── Aircraft alignment (radar projection only) ─────────────────────── */}
      <h3>Aircraft Alignment</h3>
      <p className="field-hint">
        Fine-tunes only aircraft glyphs, trails and labels. Planets, Moon, Sun
        and satellites are not moved. Composes on top of the base scale above.
      </p>

      <label className="field">
        <span>Aircraft scale: {Number(ac.scale ?? 1).toFixed(2)}×</span>
        <input
          type="range" min="0.25" max="10" step="0.05"
          value={ac.scale ?? 1}
          onChange={(e) => setAircraft({ scale: clampScale(Number(e.target.value)) })}
        />
      </label>

      <label className="field">
        <span>Aircraft X offset ({Math.round(ac.offsetX ?? 0)})</span>
        <input
          type="range" min="-1000" max="1000" step="1"
          value={ac.offsetX ?? 0}
          onChange={(e) => setAircraft({ offsetX: Number(e.target.value) })}
        />
      </label>

      <label className="field">
        <span>Aircraft Y offset ({Math.round(ac.offsetY ?? 0)})</span>
        <input
          type="range" min="-1000" max="1000" step="1"
          value={ac.offsetY ?? 0}
          onChange={(e) => setAircraft({ offsetY: Number(e.target.value) })}
        />
      </label>

      <button className="btn" onClick={resetAircraft}>Reset aircraft alignment</button>

      {/* ── Celestial alignment (Sun / Moon / planets only) ────────────────── */}
      <h3>Celestial Alignment</h3>
      <p className="field-hint">
        Fine-tunes only the Sun, Moon, planets and Moon path. Aircraft and
        satellites are not moved.
      </p>

      <label className="field">
        <span>Celestial scale: {Number(cel.scale ?? 1).toFixed(2)}×</span>
        <input
          type="range" min="0.25" max="10" step="0.05"
          value={cel.scale ?? 1}
          onChange={(e) => setCelestial({ scale: clampScale(Number(e.target.value)) })}
        />
      </label>

      <label className="field">
        <span>Celestial X offset ({Math.round(cel.offsetX ?? 0)})</span>
        <input
          type="range" min="-1000" max="1000" step="1"
          value={cel.offsetX ?? 0}
          onChange={(e) => setCelestial({ offsetX: Number(e.target.value) })}
        />
      </label>

      <label className="field">
        <span>Celestial Y offset ({Math.round(cel.offsetY ?? 0)})</span>
        <input
          type="range" min="-1000" max="1000" step="1"
          value={cel.offsetY ?? 0}
          onChange={(e) => setCelestial({ offsetY: Number(e.target.value) })}
        />
      </label>

      <button className="btn" onClick={resetCelestial}>Reset celestial alignment</button>

      <button className="btn btn-danger" onClick={onResetCalibration}>
        Reset calibration
      </button>
    </div>
  );
}
