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

// One status block for an orbital layer (ISS / Satellites / Starlink): rendered
// count vs. TLE pool, TLE age, last update, and any fetch/cache error.
function OrbitalRow({ label, meta }) {
  const m = meta || {};
  const tleAge = m.tleAgeSeconds != null
    ? (m.tleAgeSeconds < 3600 ? `${Math.round(m.tleAgeSeconds / 60)}m` : `${Math.round(m.tleAgeSeconds / 3600)}h`)
    : '—';
  const statusText = m.blocked
    ? 'unavailable'
    : m.ok ? `${m.count}/${m.cap} shown`
    : m.lastError ? 'error'
    : 'loading';
  const statusClass = m.blocked || (!m.ok && m.lastError) ? 'bad' : m.ok ? 'ok' : '';
  const cacheAge = m.cacheAgeSeconds != null
    ? (m.cacheAgeSeconds < 3600 ? `${Math.round(m.cacheAgeSeconds / 60)}m` : `${Math.round(m.cacheAgeSeconds / 3600)}h`)
    : '—';
  return (
    <>
      <div className="status-row" style={{ marginTop: 8 }}>
        <span className="status-key">{label}</span>
        <span className={`status-val ${statusClass}`}>{statusText}</span>
      </div>
      {m.sourceUrl && (
        <div className="status-row">
          <span className="status-key">{label} source</span>
          <span className="status-val" style={{ maxWidth: '62%', textAlign: 'right', wordBreak: 'break-all', opacity: 0.8 }}>
            {m.sourceUrl}
          </span>
        </div>
      )}
      {m.blocked ? (
        <>
          <div className="status-row">
            <span className="status-key">{label} reason</span>
            <span className="status-val bad">blocked (HTTP 403{m.blockedCount > 1 ? ` ×${m.blockedCount}` : ''})</span>
          </div>
          <div className="status-row">
            <span className="status-key">{label} data</span>
            <span className="status-val">{m.count > 0 ? `cached (${cacheAge} old)` : 'none cached'}</span>
          </div>
          <div className="status-row">
            <span className="status-key">{label} next retry</span>
            <span className="status-val">{timeUntil(m.nextRetry)}</span>
          </div>
        </>
      ) : (
        <>
          <div className="status-row">
            <span className="status-key">{label} TLE</span>
            <span className="status-val">{m.tleCount ?? 0} cached · {tleAge} old</span>
          </div>
          <div className="status-row">
            <span className="status-key">{label} updated</span>
            <span className="status-val">{timeAgo(m.lastSuccess)}</span>
          </div>
          {m.lastError && (
            <div className="status-row">
              <span className="status-key">{label} error</span>
              <span className="status-val bad" style={{ maxWidth: '60%', textAlign: 'right', wordBreak: 'break-word' }}>
                {m.lastError}
              </span>
            </div>
          )}
        </>
      )}
    </>
  );
}

import { DEFAULT_SETTINGS } from '../lib/defaults.js';

export default function StatusPanel({ status, aircraftCount, connectionMode, settings, renderStats, homeSource }) {
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

  // Determine home source if not explicitly provided.
  const home = settings?.home || {};
  const defHome = DEFAULT_SETTINGS.home;
  const derivedSource = homeSource
    || (home.lat === defHome.lat && home.lon === defHome.lon ? 'default' : 'settings');

  return (
    <div className="status">

      {/* ── Home / center location ── */}
      <div className="status-row">
        <span className="status-key">Home label</span>
        <span className="status-val">{home.name || '—'}</span>
      </div>
      <div className="status-row">
        <span className="status-key">Home lat</span>
        <span className="status-val">{home.lat != null ? Number(home.lat).toFixed(4) : '—'}</span>
      </div>
      <div className="status-row">
        <span className="status-key">Home lon</span>
        <span className="status-val">{home.lon != null ? Number(home.lon).toFixed(4) : '—'}</span>
      </div>
      <div className="status-row">
        <span className="status-key">Center source</span>
        <span className={`status-val ${derivedSource === 'default' ? '' : 'ok'}`}>
          {derivedSource || '—'}
        </span>
      </div>
      <div className="status-row">
        <span className="status-key">Range</span>
        <span className="status-val">{settings?.rangeNm ?? '—'} nm</span>
      </div>
      <div className="status-row" style={{ marginTop: 8 }}>
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
        <span className="status-key">Trail window</span>
        <span className="status-val">
          {rs.trailWindowSec != null ? `${rs.trailWindowSec}s` : '—'}
          {rs.trailSegmentCap != null ? ` · ${rs.trailSegmentCap} seg cap` : ''}
        </span>
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
          {(local.resolvedSource || local.source) && (
            <div className="status-row">
              <span className="status-key">ADS-B URL</span>
              <span className="status-val" style={{ maxWidth: '60%', textAlign: 'right', wordBreak: 'break-all' }}>
                {local.resolvedSource || local.source}
              </span>
            </div>
          )}
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
      {(layers.weather || layers.iss || layers.satellites || layers.starlink || layers.space) && (
        <>
          {layers.weather && (
            <div className="status-row" style={{ marginTop: 8 }}>
              <span className="status-key">Weather</span>
              <span className={`status-val ${s.weather?.ok ? 'ok' : 'bad'}`}>
                {s.weather?.ok ? s.weather.condition || 'ok' : s.weather?.lastError || 'loading'}
              </span>
            </div>
          )}
          {layers.iss && <OrbitalRow label="ISS" meta={s.iss} />}
          {layers.satellites && <OrbitalRow label="Satellites" meta={s.satellites} />}
          {layers.starlink && <OrbitalRow label="Starlink" meta={s.starlink} />}
          {layers.space && (
            <>
              <div className="status-row" style={{ marginTop: 8 }}>
                <span className="status-key">Sky objects</span>
                <span className={`status-val ${s.space?.ok ? 'ok' : ''}`}>
                  {s.space?.ok ? `${s.space.aboveHorizon ?? 0}/${s.space.count ?? 0} up` : 'loading'}
                </span>
              </div>
              <div className="status-row">
                <span className="status-key">Sky updated</span>
                <span className="status-val">{timeAgo(s.space?.lastSuccess)}</span>
              </div>
              {s.space?.ok && (
                <>
                  <div className="status-row" style={{ marginTop: 4 }}>
                    <span className="status-key">Moon phase</span>
                    <span className="status-val">{s.space.moonPhase || '—'}</span>
                  </div>
                  {s.space.moonIllumination != null && (
                    <div className="status-row">
                      <span className="status-key">Moon illum.</span>
                      <span className="status-val">{s.space.moonIllumination}%</span>
                    </div>
                  )}
                  {s.space.moonEl != null && (
                    <div className="status-row">
                      <span className="status-key">Moon az/el</span>
                      <span className="status-val">
                        {s.space.moonAz ?? '—'}° / {s.space.moonEl}°
                        {s.space.moonEl <= 0 ? ' (below horizon)' : ''}
                      </span>
                    </div>
                  )}
                  {(s.space.moonRise || s.space.moonSet) && (
                    <div className="status-row">
                      <span className="status-key">Moon rise/set</span>
                      <span className="status-val">
                        {s.space.moonRise ? `↑ ${s.space.moonRise}` : '—'}
                        {' / '}
                        {s.space.moonSet ? `↓ ${s.space.moonSet}` : '—'}
                        <span style={{ opacity: 0.6 }}> UTC</span>
                      </span>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}

      {/* Airport runways — frontend-only layer; counts come from the renderer */}
      {settings?.layers?.runways && (
        <>
          <div className="status-row" style={{ marginTop: 8 }}>
            <span className="status-key">Runways</span>
            <span className="status-val ok">
              {rs.runwaysVisible ?? '—'} visible / {rs.runwaysLoaded ?? '—'} loaded
            </span>
          </div>
          <div className="status-row">
            <span className="status-key">Runway labels</span>
            <span className="status-val">{rs.runwayLabels ?? '—'} shown</span>
          </div>
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
