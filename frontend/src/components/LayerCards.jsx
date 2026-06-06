// Above Live — optional-layer info cards.
// Small, subtle corner cards for the weather and space layers. They are DOM
// overlays (crisp text) on top of the canvas and are intentionally low-key so
// they never compete with the aircraft display.

import React from 'react';

const MOON_ICON = {
  'New Moon': '🌑',
  'Waxing Crescent': '🌒',
  'First Quarter': '🌓',
  'Waxing Gibbous': '🌔',
  'Full Moon': '🌕',
  'Waning Gibbous': '🌖',
  'Last Quarter': '🌗',
  'Waning Crescent': '🌘',
};

export function WeatherCard({ weather }) {
  if (!weather) return null;
  const temp = Math.round(weather.temperature);
  const wind = Math.round(weather.windSpeed);
  const visKm = weather.visibility != null ? Math.round(weather.visibility / 1000) : null;
  return (
    <div className="layer-card weather-card">
      <div className="layer-card-title">{weather.condition}</div>
      <div className="layer-card-row">
        <span>{temp}°C</span>
        <span>{weather.cloudCover}% cloud</span>
      </div>
      <div className="layer-card-row">
        <span>{wind} kt</span>
        {visKm != null && <span>{visKm} km vis</span>}
      </div>
      {weather.precipitation > 0 && (
        <div className="layer-card-row precip">↓ {weather.precipitation} mm</div>
      )}
    </div>
  );
}

export function SpaceCard({ space }) {
  if (!space) return null;
  const moon = space.moon || {};
  const sun = space.sun || {};
  return (
    <div className="layer-card space-card">
      <div className="layer-card-row">
        <span>{MOON_ICON[moon.name] || '🌙'} {moon.name}</span>
        {moon.illumination != null && <span>{moon.illumination}%</span>}
      </div>
      <div className="layer-card-row">
        <span>{sun.isDay ? '☀ Day' : '🌙 Night'}</span>
        {sun.sunrise && sun.sunset && (
          <span className="dim">
            ↑{sun.sunrise} ↓{sun.sunset}
          </span>
        )}
      </div>
      {Array.isArray(space.planets) && space.planets.length > 0 && (
        <div className="layer-card-row dim">{space.planets.map((p) => p.name).join(' · ')}</div>
      )}
    </div>
  );
}
