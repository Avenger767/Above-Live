// Above Live — themes.
// Each theme is a palette tuned for a dark, projection-friendly night-sky look.
// Colors are kept high-contrast so they survive a dim projector and a bright
// monitor alike.

export const THEMES = {
  night: {
    label: 'Night Sky',
    bgInner: '#0a1226',
    bgOuter: '#04060d',
    star: 'rgba(180, 200, 255, 0.85)',
    ring: 'rgba(90, 130, 220, 0.28)',
    ringText: 'rgba(150, 180, 255, 0.7)',
    compass: 'rgba(150, 180, 255, 0.85)',
    aircraft: '#7fe0ff',
    aircraftGlow: 'rgba(127, 224, 255, 0.55)',
    trail: 'rgba(127, 224, 255, 0.5)',
    label: 'rgba(210, 235, 255, 0.95)',
    labelDim: 'rgba(160, 190, 230, 0.7)',
    center: '#9fe7ff',
    satellite: '#d8e8ff',
    satelliteGlow: 'rgba(150, 190, 255, 0.7)',
    wind: 'rgba(150, 200, 255, 0.8)',
    cloud: 'rgba(200, 215, 245, 1)',
  },
  amber: {
    label: 'Amber Radar',
    bgInner: '#15100a',
    bgOuter: '#070503',
    star: 'rgba(255, 220, 160, 0.7)',
    ring: 'rgba(255, 176, 64, 0.26)',
    ringText: 'rgba(255, 200, 120, 0.7)',
    compass: 'rgba(255, 200, 120, 0.85)',
    aircraft: '#ffc24d',
    aircraftGlow: 'rgba(255, 194, 77, 0.55)',
    trail: 'rgba(255, 194, 77, 0.5)',
    label: 'rgba(255, 232, 196, 0.95)',
    labelDim: 'rgba(230, 196, 140, 0.7)',
    center: '#ffd479',
    satellite: '#cfe0ff',
    satelliteGlow: 'rgba(150, 190, 255, 0.7)',
    wind: 'rgba(255, 210, 150, 0.8)',
    cloud: 'rgba(235, 220, 200, 1)',
  },
  green: {
    label: 'Green Scope',
    bgInner: '#04140a',
    bgOuter: '#020805',
    star: 'rgba(150, 255, 190, 0.6)',
    ring: 'rgba(64, 230, 130, 0.24)',
    ringText: 'rgba(120, 255, 170, 0.7)',
    compass: 'rgba(120, 255, 170, 0.85)',
    aircraft: '#54ff9f',
    aircraftGlow: 'rgba(84, 255, 159, 0.5)',
    trail: 'rgba(84, 255, 159, 0.5)',
    label: 'rgba(200, 255, 220, 0.95)',
    labelDim: 'rgba(150, 220, 180, 0.7)',
    center: '#7dffb8',
    satellite: '#cfe8ff',
    satelliteGlow: 'rgba(150, 200, 255, 0.7)',
    wind: 'rgba(150, 255, 200, 0.8)',
    cloud: 'rgba(205, 235, 215, 1)',
  },
};

export const THEME_KEYS = Object.keys(THEMES);

export function getTheme(name) {
  return THEMES[name] || THEMES.night;
}
