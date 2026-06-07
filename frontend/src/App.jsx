// Above Live — App.
// Top-level layout: a fullscreen sky/radar display with a slide-in side panel
// (Display, Calibration, Status). Loads settings + status from the backend,
// subscribes to the live aircraft feed, and persists setting changes.

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import SkyRenderer from './components/SkyRenderer.jsx';
import ControlPanel from './components/ControlPanel.jsx';
import CalibrationPanel from './components/CalibrationPanel.jsx';
import StatusPanel from './components/StatusPanel.jsx';
import * as api from './lib/api.js';
import { createAircraftFeed } from './lib/websocket.js';
import { DEFAULT_SETTINGS } from './lib/defaults.js';

export default function App() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [status, setStatus] = useState(null);
  const [aircraft, setAircraft] = useState([]);
  const [trails, setTrails] = useState({});
  const [layerData, setLayerData] = useState({ weather: null, iss: [], satellites: [], starlink: [], space: null, stars: true });
  const [connectionMode, setConnectionMode] = useState('connecting');
  const [wsApiState, setWsApiState] = useState({});
  const [panelOpen, setPanelOpen] = useState(true);
  const [tab, setTab] = useState('display'); // display | calibration | status
  const [testPattern, setTestPattern] = useState(false);
  const [renderStats, setRenderStats] = useState({ trackCount: 0, renderedCount: 0 });

  const saveTimer = useRef(null);
  const prevModeRef = useRef(settings.display.displayMode || 'normal');

  // Initial load of settings.
  useEffect(() => {
    api
      .getSettings()
      .then(setSettings)
      .catch(() => {
        /* keep defaults; backend may not be up yet */
      });
  }, []);

  // Poll status periodically (for fallback warning, counts, etc.).
  useEffect(() => {
    let alive = true;
    const tick = () =>
      api
        .getStatus()
        .then((s) => alive && setStatus(s))
        .catch(() => alive && setStatus({ backend: 'offline' }));
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Live aircraft feed (WebSocket, with polling fallback).
  useEffect(() => {
    const feed = createAircraftFeed({
      onData: (data) => {
        setAircraft(data.aircraft || []);
        // Backend trail snapshot — retained for future history/status use. The
        // renderer now builds smooth trails from per-track motion history, so
        // this is passed through but not drawn (see SkyRenderer).
        setTrails(data.trails || {});
        if (data.layers) setLayerData(data.layers);
        // Track API state from WS for real-time pill updates (faster than 3s status poll).
        setWsApiState({
          rateLimited:   data.apiRateLimited,
          usingCache:    data.apiUsingCache,
          usingFallback: data.usingFallback,
        });
      },
      onConnection: setConnectionMode,
    });
    return () => feed.close();
  }, []);

  // Persist a partial settings change (debounced so sliders don't spam).
  // Guard against no-op saves: if the merged result is identical to what we
  // already have, do nothing — no state update, no POST. This stops settings
  // we just received from the backend (or unchanged re-toggles) from being
  // echoed straight back, which used to reset the API fetch timer needlessly.
  const updateSettings = useCallback((patch) => {
    setSettings((prev) => {
      const next = mergeDeep(prev, patch);
      if (deepEqual(prev, next)) return prev; // nothing materially changed
      const changed = changedKeyPaths(prev, next);
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        if (changed.length) console.debug('[settings] saving changes:', changed.join(', '));
        api.saveSettings(next).catch(() => {});
      }, 250);
      return next;
    });
  }, []);

  // Auto-close the panel when switching to projector or calibration mode —
  // both are designed to be unobstructed.
  useEffect(() => {
    const mode = settings.display.displayMode || 'normal';
    if (mode !== prevModeRef.current) {
      prevModeRef.current = mode;
      if (mode === 'projector' || mode === 'calibration') setPanelOpen(false);
    }
  }, [settings.display.displayMode]);

  const handleReset = useCallback(async () => {
    try {
      const fresh = await api.resetSettings();
      setSettings(fresh);
      setTestPattern(false);
    } catch (_e) {
      setSettings(DEFAULT_SETTINGS);
    }
  }, []);

  const resetCalibration = useCallback(() => {
    updateSettings({ calibration: { ...DEFAULT_SETTINGS.calibration } });
  }, [updateSettings]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }, []);

  // Render stats from the canvas (track/rendered counts). Only commit to state
  // while the Status tab is open, so the 1 Hz updates don't re-render otherwise.
  const handleStats = useCallback(
    (s) => {
      if (tab === 'status') setRenderStats(s);
    },
    [tab]
  );

  const displayMode = settings.display.displayMode || 'normal';

  // Derive real-time API state from WS (updated every second) with status fallback.
  const usingFallback   = wsApiState.usingFallback  ?? status?.usingFallback;
  const apiRateLimited  = !usingFallback && (wsApiState.rateLimited  ?? status?.api?.rateLimited);
  const apiUsingCache   = !usingFallback && !apiRateLimited && (wsApiState.usingCache ?? status?.api?.usingCachedAircraft);

  return (
    <div className={`app mode-${displayMode}`}>
      <SkyRenderer
        settings={settings}
        aircraft={aircraft}
        trails={trails}
        layerData={layerData}
        testPattern={testPattern}
        onStats={handleStats}
      />

      {/* Top bar */}
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          Above Live
        </div>
        <div className="topbar-meta">
          {usingFallback  && <span className="pill warn-pill">MOCK fallback</span>}
          {apiRateLimited && <span className="pill warn-pill">API backoff</span>}
          {apiUsingCache  && <span className="pill">cached</span>}
          <span className="pill">{status?.effectiveProvider || settings.provider}</span>
          <span className="pill">{aircraft.length} ac</span>
          <button className="icon-btn" onClick={() => setPanelOpen((v) => !v)} title="Toggle panel">
            {panelOpen ? '✕' : '☰'}
          </button>
        </div>
      </header>

      {/* Side panel */}
      <aside className={`panel ${panelOpen ? 'open' : ''}`}>
        <div className="tabs">
          <button className={tab === 'display' ? 'active' : ''} onClick={() => setTab('display')}>
            Display
          </button>
          <button className={tab === 'calibration' ? 'active' : ''} onClick={() => setTab('calibration')}>
            Calibration
          </button>
          <button className={tab === 'status' ? 'active' : ''} onClick={() => setTab('status')}>
            Status
          </button>
        </div>

        <div className="panel-body">
          {tab === 'display' && (
            <ControlPanel
              settings={settings}
              onChange={updateSettings}
              onToggleFullscreen={toggleFullscreen}
              onReset={handleReset}
              onOpenCalibration={() => setTab('calibration')}
            />
          )}
          {tab === 'calibration' && (
            <CalibrationPanel
              settings={settings}
              onChange={updateSettings}
              testPattern={testPattern}
              onToggleTest={setTestPattern}
              onResetCalibration={resetCalibration}
            />
          )}
          {tab === 'status' && (
            <StatusPanel
              status={status}
              aircraftCount={aircraft.length}
              connectionMode={connectionMode}
              settings={settings}
              renderStats={renderStats}
            />
          )}
        </div>

        <footer className="panel-foot">
          {settings.home?.name} · {settings.home?.lat?.toFixed?.(3)}, {settings.home?.lon?.toFixed?.(3)}
        </footer>
      </aside>
    </div>
  );
}

// Small deep-merge for nested setting objects.
function mergeDeep(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object') {
      out[k] = mergeDeep(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Structural equality for plain settings objects (used to skip no-op saves).
function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => deepEqual(a[k], b[k]));
}

// Dotted paths of leaves that differ between two settings objects (for logging).
function changedKeyPaths(a, b, prefix = '') {
  const out = [];
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) {
    const pa = a ? a[k] : undefined;
    const pb = b ? b[k] : undefined;
    const path = prefix ? `${prefix}.${k}` : k;
    if (pa && pb && typeof pa === 'object' && typeof pb === 'object' && !Array.isArray(pa)) {
      out.push(...changedKeyPaths(pa, pb, path));
    } else if (!deepEqual(pa, pb)) {
      out.push(path);
    }
  }
  return out;
}
