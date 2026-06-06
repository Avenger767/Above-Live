// Above Live — StatusPanel.
// Shows live system status: active provider, aircraft count, backend health,
// last update time, connection mode, and a fallback warning when the requested
// provider failed and MOCK data is being shown instead.

import React from 'react';

function timeAgo(ts) {
  if (!ts) return '—';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 2) return 'just now';
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}

export default function StatusPanel({ status, aircraftCount, connectionMode }) {
  const s = status || {};
  const fallback = s.usingFallback;
  const isApi = (s.requestedProvider || '').toUpperCase() === 'API';
  const api = s.api || {};

  return (
    <div className="status">
      <div className="status-row">
        <span className="status-key">Backend</span>
        <span className={`status-val ${s.backend === 'ok' ? 'ok' : 'bad'}`}>
          {s.backend === 'ok' ? 'online' : 'offline'}
        </span>
      </div>
      <div className="status-row">
        <span className="status-key">Provider</span>
        <span className="status-val">{s.effectiveProvider || '—'}</span>
      </div>
      <div className="status-row">
        <span className="status-key">Requested</span>
        <span className="status-val">{s.requestedProvider || '—'}</span>
      </div>

      {/* API adapter rows — only when API is the requested provider */}
      {isApi && api.adapterLabel && (
        <div className="status-row">
          <span className="status-key">Adapter</span>
          <span className="status-val">{api.adapterLabel}</span>
        </div>
      )}
      {isApi && (
        <div className="status-row">
          <span className="status-key">API key</span>
          <span className={`status-val ${api.configured ? 'ok' : api.requiresKey ? 'bad' : ''}`}>
            {api.requiresKey
              ? api.configured ? 'set' : 'missing'
              : 'not required'}
          </span>
        </div>
      )}

      <div className="status-row">
        <span className="status-key">Aircraft</span>
        <span className="status-val">{aircraftCount ?? s.aircraftCount ?? 0}</span>
      </div>
      <div className="status-row">
        <span className="status-key">Feed</span>
        <span className="status-val">{connectionMode || '—'}</span>
      </div>
      <div className="status-row">
        <span className="status-key">Updated</span>
        <span className="status-val">{timeAgo(s.lastUpdate)}</span>
      </div>

      {/* Optional layers — only shown when enabled (off by default in V1). */}
      {s.spaceCount > 0 && (
        <div className="status-row">
          <span className="status-key">Satellites</span>
          <span className={`status-val ${s.spaceError ? 'bad' : ''}`}>{s.spaceCount} tracked</span>
        </div>
      )}
      {(s.weatherOk || s.weatherError) && (
        <div className="status-row">
          <span className="status-key">Weather</span>
          <span className={`status-val ${s.weatherError && !s.weatherOk ? 'bad' : s.weatherOk ? 'ok' : ''}`}>
            {s.weatherCondition || (s.weatherOk ? 'ok' : '—')}
          </span>
        </div>
      )}

      {s.spaceError && (
        <div className="warn">
          ⚠ ISS live feed unavailable — showing modeled satellites only.
          <div className="warn-detail">{s.spaceError}</div>
        </div>
      )}
      {s.weatherError && !s.weatherOk && (
        <div className="warn">
          ⚠ Weather feed unavailable.
          <div className="warn-detail">{s.weatherError}</div>
        </div>
      )}

      {fallback && (
        <div className="warn">
          ⚠ Requested provider <b>{s.requestedProvider}</b> is unavailable — showing
          <b> MOCK</b> data.
          {s.lastError ? <div className="warn-detail">{s.lastError}</div> : null}
        </div>
      )}
    </div>
  );
}
