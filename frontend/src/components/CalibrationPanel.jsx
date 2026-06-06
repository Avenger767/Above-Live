// Above Live — CalibrationPanel.
// Aligns the projected image to a real surface. Includes a toggle for the
// on-screen test pattern (grid / center / ring / compass / corners) so you can
// fine-tune offset, scale, rotation and flips against a known reference.

import React from 'react';
import { ceilingPreset } from '../lib/projectionMath.js';

export default function CalibrationPanel({ settings, onChange, testPattern, onToggleTest, onResetCalibration }) {
  const c = settings.calibration;
  const d = settings.display || {};
  const set = (patch) => onChange({ calibration: { ...c, ...patch } });
  const setDisplay = (patch) => onChange({ display: { ...d, ...patch } });
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
        <span>Scale ({c.scale.toFixed(2)}×)</span>
        <input
          type="range"
          min="0.3"
          max="3"
          step="0.01"
          value={c.scale}
          onChange={(e) => set({ scale: Number(e.target.value) })}
        />
      </label>

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

      <button className="btn btn-danger" onClick={onResetCalibration}>
        Reset calibration
      </button>
    </div>
  );
}
