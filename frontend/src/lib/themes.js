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
    satellite: '#c9b8ff',
    satelliteGlow: 'rgba(201, 184, 255, 0.6)',
    iss: '#ffe27f',
    issGlow: 'rgba(255, 226, 127, 0.7)',
    satTrail: 'rgba(201, 184, 255, 0.45)',
    cloud: 'rgba(150, 175, 220, 0.16)',
    wind: 'rgba(130, 200, 255, 0.7)',
    precip: 'rgba(140, 200, 255, 0.55)',
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
    satellite: '#ffd9a0',
    satelliteGlow: 'rgba(255, 217, 160, 0.6)',
    iss: '#fff2c4',
    issGlow: 'rgba(255, 242, 196, 0.75)',
    satTrail: 'rgba(255, 217, 160, 0.45)',
    cloud: 'rgba(230, 190, 130, 0.16)',
    wind: 'rgba(255, 200, 120, 0.7)',
    precip: 'rgba(255, 210, 150, 0.55)',
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
    satellite: '#b8ffd9',
    satelliteGlow: 'rgba(184, 255, 217, 0.6)',
    iss: '#eaffc4',
    issGlow: 'rgba(234, 255, 196, 0.75)',
    satTrail: 'rgba(184, 255, 217, 0.45)',
    cloud: 'rgba(120, 220, 160, 0.15)',
    wind: 'rgba(120, 255, 170, 0.7)',
    precip: 'rgba(150, 255, 200, 0.55)',
  },
};

export const THEME_KEYS = Object.keys(THEMES);

export function getTheme(name) {
  return THEMES[name] || THEMES.night;
}
