/* =========================================================
   content.js — data that designers touch, not engineers.
   Locations describe both the look (palette, sun, fog) and
   the feel (line length, wind, exposure) of a place.
   ========================================================= */

export const LOCATIONS = [
  {
    id: 'summit', name: 'The Summit', region: 'Alps',
    image: 'assets/loc-summit.png',
    unlockText: '',
    time: 'Evening', temp: -4, altitude: 3480,
    lineLength: 150, lineHeight: 412, sag: 1.5,
    seed: 11, peakHeight: 380, gorgeDepth: 520, basinDepth: 340,
    snowLine: 95, treeLine: -8, grass: '#3d4433', tree: '#2a3524',
    windBase: 7, windGust: 16, windTurbulence: 0.85,
    sky: { top: '#1d2f52', horizon: '#f0a868', ground: '#241a20' },
    sun: { azimuth: -0.42, elevation: 0.10, color: '#ffd7a0', intensity: 1.15, size: 1.0 },
    fog: { color: '#c98f6a', density: 0.0016 },
    rock: '#372e26', rockLit: '#6d5942', snow: 0.55,
    cloudLevel: -32, cloudColor: '#f3c69c', cloudCount: 26,
    birds: 7, valley: '#3a3140'
  },
  {
    id: 'eagle', name: 'Eagle Peak', region: 'Yosemite',
    image: 'assets/loc-eagle.png',
    unlockText: 'Walk 50 m in one go',
    time: 'Midday', temp: 16, altitude: 1890,
    lineLength: 210, lineHeight: 640, sag: 1.9,
    seed: 23, peakHeight: 340, gorgeDepth: 640, basinDepth: 420,
    snowLine: 280, treeLine: 140, grass: '#46512f', tree: '#2f3d24',
    windBase: 5, windGust: 13, windTurbulence: 0.6,
    sky: { top: '#2a63a8', horizon: '#bcd8ea', ground: '#3c4436' },
    sun: { azimuth: 0.65, elevation: 0.62, color: '#fff4de', intensity: 1.35, size: 0.6 },
    fog: { color: '#a9c3d4', density: 0.0011 },
    rock: '#4e463d', rockLit: '#8a7c68', snow: 0.0,
    cloudLevel: -52, cloudColor: '#ffffff', cloudCount: 18,
    birds: 9, valley: '#43503a'
  },
  {
    id: 'cloud', name: 'Cloud Break', region: 'Patagonia',
    image: 'assets/loc-cloud.png',
    unlockText: 'Reach 120 m in one go',
    time: 'Dawn', temp: 2, altitude: 2760,
    lineLength: 260, lineHeight: 880, sag: 2.3,
    seed: 37, peakHeight: 440, gorgeDepth: 700, basinDepth: 380,
    snowLine: 60, treeLine: -40, grass: '#39423f', tree: '#26332b',
    windBase: 14, windGust: 30, windTurbulence: 1.25,
    sky: { top: '#243b58', horizon: '#dcb4bc', ground: '#1e2630' },
    sun: { azimuth: -1.15, elevation: 0.06, color: '#ffc9c2', intensity: 0.95, size: 0.85 },
    fog: { color: '#b9b4c4', density: 0.0022 },
    rock: '#333a44', rockLit: '#6b7480', snow: 0.7,
    cloudLevel: -26, cloudColor: '#e8e2ea', cloudCount: 34,
    birds: 4, valley: '#2b3440'
  },
  {
    id: 'golden', name: 'Golden Hour', region: 'Ladakh',
    image: 'assets/loc-golden.png',
    unlockText: 'Reach 250 m in one go',
    time: 'Sunset', temp: 9, altitude: 4210,
    lineLength: 320, lineHeight: 520, sag: 2.6,
    seed: 53, peakHeight: 400, gorgeDepth: 560, basinDepth: 300,
    snowLine: 330, treeLine: -60, grass: '#5a4630', tree: '#3d3122',
    windBase: 9, windGust: 22, windTurbulence: 1.0,
    sky: { top: '#3a2350', horizon: '#ff9d54', ground: '#2c1c1c' },
    sun: { azimuth: 0.12, elevation: 0.035, color: '#ffb168', intensity: 1.25, size: 1.35 },
    fog: { color: '#d99263', density: 0.0019 },
    rock: '#412f24', rockLit: '#8f6540', snow: 0.05,
    cloudLevel: -44, cloudColor: '#ffbf8d', cloudCount: 22,
    birds: 6, valley: '#4a3226'
  },
  {
    id: 'misty', name: 'Misty Falls', region: 'Norway',
    image: 'assets/loc-misty.png',
    unlockText: 'Finish 3 challenges',
    time: 'Morning', temp: 6, altitude: 1120,
    lineLength: 185, lineHeight: 740, sag: 1.7,
    seed: 71, peakHeight: 300, gorgeDepth: 620, basinDepth: 450,
    snowLine: 220, treeLine: 180, grass: '#39482f', tree: '#243021',
    windBase: 4, windGust: 11, windTurbulence: 0.5,
    sky: { top: '#4a6a7e', horizon: '#d5dfe2', ground: '#26302e' },
    sun: { azimuth: 1.0, elevation: 0.28, color: '#e7f1f5', intensity: 0.8, size: 0.7 },
    fog: { color: '#c2ced3', density: 0.0045 },
    rock: '#2e3736', rockLit: '#5c6864', snow: 0.12,
    cloudLevel: -20, cloudColor: '#dfe8ea', cloudCount: 40,
    birds: 5, valley: '#2f3a36'
  }
];

export const LOCATION_BY_ID = Object.fromEntries(LOCATIONS.map(l => [l.id, l]));

/** Unlock rules evaluated after every walk. */
export const UNLOCK_RULES = [
  { id: 'eagle',  test: s => s.player.longestWalk >= 50 },
  { id: 'cloud',  test: s => s.player.longestWalk >= 120 },
  { id: 'golden', test: s => s.player.longestWalk >= 250 },
  { id: 'misty',  test: s => s.challengesDone() >= 3 }
];

/* ---------------------------------------------------------
   Challenges. `type` drives how game.js tracks progress.
   --------------------------------------------------------- */
export const CHALLENGES = [
  { id: 'first',   name: 'First steps',   desc: 'Walk 25 m on The Summit',        icon: '↑', type: 'distance', target: 25,  location: 'summit' },
  { id: 'steady',  name: 'Steady',        desc: 'Walk 50 m without falling',      icon: '≡', type: 'distance', target: 50,  location: 'summit' },
  { id: 'century', name: 'Century',       desc: 'Reach 100 m in one walk',        icon: '◎', type: 'distance', target: 100, location: 'summit' },
  { id: 'gust',    name: 'Gust line',     desc: 'Stay up for 30 s above 20 km/h', icon: '≋', type: 'windTime', target: 30,  location: 'summit' },
  { id: 'cross',   name: 'Full crossing', desc: 'Reach the far anchor',           icon: '⇥', type: 'crossing', target: 1,   location: 'summit' },
  { id: 'longline',name: 'Longline',      desc: 'Reach 200 m in one walk',        icon: '⟶', type: 'distance', target: 200, location: 'summit' }
];

/* ---------------------------------------------------------
   Tricks. `ready:false` items are clearly labelled in the UI
   as future features rather than dead buttons.
   --------------------------------------------------------- */
export const TRICKS = [
  { id: 'sit',      name: 'Sit',           gesture: 'Swipe down',   ready: true,  unlock: 'start' },
  { id: 'knee',     name: 'Knee drop',     gesture: 'Soon',         ready: false, unlock: 'walk 150 m' },
  { id: 'turn180',  name: '180 turn',      gesture: 'Soon',         ready: false, unlock: 'in development' },
  { id: 'spin360',  name: '360 spin',      gesture: 'Soon',         ready: false, unlock: 'land 20 turns' },
  { id: 'surfer',   name: 'Surfer',        gesture: 'Soon',         ready: false, unlock: 'walk 300 m' },
  { id: 'yoga',     name: 'Yoga pose',     gesture: 'Soon',         ready: false, unlock: 'finish 4 challenges' },
  { id: 'backward', name: 'Backward walk', gesture: 'Soon',         ready: false, unlock: 'walk 100 m backward' }
];

export const QUOTES = [
  "Balance is not something you find, it's something you feel.",
  'The line only asks one thing of you: be here.',
  'Every wobble is information, not failure.',
  'Breathe out longer than you breathe in. The line will settle.',
  'Look at where you are going, not at where you might fall.',
  'Slow feet, quiet mind.',
  'The wind is not against you. It is simply there.'
];
