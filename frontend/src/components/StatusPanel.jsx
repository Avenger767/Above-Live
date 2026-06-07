// Above Live — StatusPanel.
// Shows live system status: active provider, aircraft count, backend health,
// last update time, connection mode, and a fallback warning when the requested
// provider failed and MOCK data is being shown instead.

import React from 'react';
import { effectiveMotionSettings, motionMode } from '../lib/aircraftMotion.js';

function timeAgo(ts) {
  if (!ts) return '—';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 2) return 'just now';
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}

function timeUntil(ts) {
  if (!ts) return '—';
  const s = Math.max(0, Math.round((ts - Date.now()) / 1000));
  return s < 60 ? `${s}s` : `${Math.round(s / 60)}m`;
}

export default function StatusPanel({ status, aircraftCount, connectionMode, settings, renderStats }) {
  const s = status || {};
  const fallback = s.usingFallback;
  const api = s.api;
  const apiActive = (s.requestedProvider || '').toUpperCase() === 'API';
  const local = s.localAdsb;
  const localActive = (s.requestedProvider || '').toUpperCase() === 'LOCAL_ADSB';
  const layers = s.layers || {};
  const rs = renderStats || {};

  // Derive current motion configuration (provider-aware).
  const effMotion = effectiveMotionSettings(settings || {}).motion || {};
  const mode = motionMode(settings || {});
  const modeLabel = mode === 'api' ? 'Slow API prediction' : 'Fast feed';

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

      {/* Motion model configuration */}
      <div className="status-row" style={{ marginTop: 8 }}>
        <span className="status-key">Motion mode</span>
        <span className="status-val">{modeLabel}</span>
      </div>
      <div className="status-row">
        <span className="status-key">Render delay</span>
        <span className="status-val">{effMotion.renderDelayMs ?? 1150} ms</span>
      </div>
      <div className="status-row">
        <span className="status-key">Max extrapolation</span>
        <span className="status-val">{effMotion.maxExtrapolationSec ?? 4} s</span>
      </div>
      <div className="status-row">
        <span className="status-key">Stale timeout</span>
        <span className="status-val">{effMotion.staleSec ?? 20} s</span>
      </div>
      <div className="status-row">
        <span className="status-key">Tracks</span>
        <span className="status-val">{rs.trackCount ?? '—'} ({rs.renderedCount ?? '—'} rendered)</span>
      </div>
      <div className="status-row">
        <span className="status-key">Last save</span>
        <span className="status-val">{timeAgo(s.lastSettingsSaveAt)}</span>
      </div>

      {/* API adapter health (shown when API mode is requested) */}
      {api && apiActive && (
        <>
          <div className="status-row" style={{ marginTop: 8 }}>
            <span className="status-key">API adapter</span>
            <span className="status-val">{api.adapter || '—'}</span>
          </div>
          <div className="status-row">
            <span className="status-key">Last fetch</span>
            <span className="status-val">{timeAgo(api.lastSuccess)}</span>
          </div>
          <div className="status-row">
            <span className="status-key">Next fetch</span>
            <span className="status-val">{timeUntil(api.nextAllowedFetch)}</span>
          </div>
          <div className="status-row">
            <span className="status-key">Data source</span>
            <span className="status-val">
              {api.rateLimited ? 'cache (backoff)' : api.usingCachedAircraft ? 'cache (stale)' : api.hasCache ? 'live' : 'none'}
            </span>
          </div>
          {api.cacheAgeSeconds != null && (
            <div className="status-row">
              <span className="status-key">Cache age</span>
              <span className="status-val">{api.cacheAgeSeconds}s</span>
            </div>
          )}
          <div className="status-row">
            <span className="status-key">Rate limit</span>
            <span className={`status-val ${api.rateLimited ? 'bad' : 'ok'}`}>
              {api.rateLimited ? `backoff ${timeUntil(api.nextRetry)}` : 'ok'}
            </span>
          </div>
          <div className="status-row">
            <span className="status-key">Ext. fetches</span>
            <span className="status-val">{api.externalFetchCount ?? '—'} / {api.cacheHitCount ?? '—'} cache</span>
          </div>
          <div className="status-row">
            <span className="status-key">Poll / backoff</span>
            <span className="status-val">
              {api.pollIntervalMs != null ? Math.round(api.pollIntervalMs / 1000) : '—'}s
              {' / '}{api.backoffMs != null ? Math.round(api.backoffMs / 1000) : '—'}s
            </span>
          </div>
          <div className="status-row">
            <span className="status-key">Last invalidation</span>
            <span className="status-val">{timeAgo(api.lastInvalidationAt)}</span>
          </div>
          {api.lastInvalidationReason && (
            <div className="status-row">
              <span className="status-key">Invalidation reason</span>
              <span className="status-val" style={{ maxWidth: '60%', textAlign: 'right', wordBreak: 'break-word' }}>
                {api.lastInvalidationReason}
              </span>
            </div>
          )}
          {api.lastError && (
            <div className="status-row">
              <span className="status-key">API error</span>
              <span className="status-val bad" style={{ maxWidth: '60%', textAlign: 'right', wordBreak: 'break-word' }}>
                {api.lastError}
              </span>
            </div>
          )}
        </>
      )}

      {/* LOCAL_ADSB health (shown when LOCAL_ADSB mode is requested) */}
      {local && localActive && (
        <>
          <div className="status-row" style={{ marginTop: 8 }}>
            <span className="status-key">ADS-B source</span>
            <span className="status-val">{local.sourceType === 'none' ? 'not set' : local.sourceType}</span>
          </div>
          <div className="status-row">
            <span className="status-key">Format</span>
            <span className="status-val">{local.detectedFormat || '—'}</span>
          </div>
          <div className="status-row">
            <span className="status-key">Configured</span>
            <span className={`status-val ${local.configured ? 'ok' : 'bad'}`}>
              {local.configured ? 'yes' : 'no'}
            </span>
          </div>
          <div className="status-row">
            <span className="status-key">ADS-B read</span>
            <span className="status-val">{timeAgo(local.lastSuccess)}</span>
          </div>
          <div className="status-row">
            <span className="status-key">Raw / visible</span>
            <span className="status-val">
              {local.rawAircraftCount != null ? local.rawAircraftCount : '—'} raw / {local.aircraftCount ?? 0} with position
            </span>
          </div>
          <div className="status-row">
            <span className="status-key">Data source</span>
            <span className="status-val">{local.usingCache ? 'cache' : local.lastSuccess ? 'live' : 'none'}</span>
          </div>
          {local.lastError && (
            <div className="status-row">
              <span className="status-key">ADS-B error</span>
              <span className="status-val bad" style={{ maxWidth: '60%', textAlign: 'right', wordBreak: 'break-word' }}>
                {local.lastError}
              </span>
            </div>
          )}
        </>
      )}

      {/* Optional layers — only show rows for layers that are enabled */}
      {(layers.weather || layers.satellites || layers.space) && (
        <>
          {layers.weather && (
            <div className="status-row" style={{ marginTop: 8 }}>
              <span className="status-key">Weather</span>
              <span className={`status-val ${s.weather?.ok ? 'ok' : 'bad'}`}>
                {s.weather?.ok ? s.weather.condition || 'ok' : s.weather?.lastError || 'loading'}
              </span>
            </div>
          )}
          {layers.satellites && (
            <div className="status-row">
              <span className="status-key">Satellites</span>
              <span className={`status-val ${s.satellites?.ok ? 'ok' : 'bad'}`}>
                {s.satellites?.ok ? `${s.satellites.count} tracked` : s.satellites?.lastError || 'loading'}
              </span>
            </div>
          )}
          {layers.space && (
            <div className="status-row">
              <span className="status-key">Space</span>
              <span className={`status-val ${s.space?.ok ? 'ok' : ''}`}>
                {s.space?.ok ? s.space.moonPhase || 'ok' : 'loading'}
              </span>
            </div>
          )}
        </>
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
