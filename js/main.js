/* =========================================================
   main.js — boot, wiring, lifecycle.
   ========================================================= */

import { Game } from './game.js';
import { UI } from './ui.js';
import { store } from './storage.js';
import { audio } from './audio.js';

const $ = (id) => document.getElementById(id);

/* ---------- boot progress ---------- */
let bootPct = 0;
const bootHints = ['Rigging the line', 'Tensioning the webbing', 'Reading the wind', 'Finding the light'];
const bootTimer = setInterval(() => {
  bootPct = Math.min(92, bootPct + 6 + Math.random() * 10);
  $('boot-fill').style.width = bootPct + '%';
  $('boot-hint').textContent = bootHints[Math.floor(bootPct / 26) % bootHints.length] + '…';
}, 160);

function finishBoot () {
  clearInterval(bootTimer);
  $('boot-fill').style.width = '100%';
  setTimeout(() => {
    $('boot').classList.add('gone');
    setTimeout(() => { $('boot').hidden = true; }, 700);
  }, 220);
}

/* ---------- start ---------- */
let game, ui;
try {
  game = new Game($('gl'));
  ui = new UI(game);
} catch (err) {
  clearInterval(bootTimer);
  $('boot-hint').textContent = 'This browser could not start WebGL.';
  console.error(err);
  throw err;
}

audio.enabled = store.settings.sound;

/* ---------- game → ui ---------- */
game.on('hud', d => { if (ui.hudVisible) ui.updateHUD(d); });
game.on('objective', o => { if (ui.hudVisible) ui.updateObjective(o); });
game.on('toast', msg => ui.toast(msg));
game.on('trick', name => ui.toast(`${name} landed`));
game.on('falling', () => ui.coach(null));

game.on('banked', () => ui.checkUnlocks());

game.on('crossed', info => {
  ui.showCrossing(info);
  ui.checkUnlocks();
});

game.on('fell', info => {
  ui.showFall(info);
  ui.checkUnlocks();
});

game.on('challenge-complete', ({ challenge, first, value }) => {
  ui.toast(first ? `Challenge complete — ${challenge.name}` : `${challenge.name} again: ${value}`);
  ui.checkUnlocks();
});

/* ---------- first paint ---------- */
requestAnimationFrame(() => requestAnimationFrame(() => {
  ui.show('menu', false);
  finishBoot();
}));

/* ---------- orientation ---------- */
function checkOrientation () {
  const portrait = window.innerHeight > window.innerWidth;
  const smallish = Math.min(window.innerWidth, window.innerHeight) < 520;
  const show = portrait && smallish && !store.settings.seenRotate;
  $('rotate').hidden = !show;
}
window.addEventListener('resize', checkOrientation);
window.addEventListener('orientationchange', () => setTimeout(checkOrientation, 250));
$('rot-dismiss').addEventListener('click', () => {
  store.setSetting('seenRotate', true);
  $('rotate').hidden = true;
});
checkOrientation();

/* ---------- lifecycle ---------- */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    store.saveNow();
    if (game.state === 'play') { game.setPaused(true); ui.hudVisible && ($('overlay-pause').hidden = false); }
    audio.suspend();
  } else {
    audio.resume();
  }
});
window.addEventListener('pagehide', () => store.saveNow());

// iOS needs a gesture before any sound exists at all
const firstTouch = () => {
  if (store.settings.sound) audio.init();
  window.removeEventListener('pointerdown', firstTouch);
};
window.addEventListener('pointerdown', firstTouch);

// stop iOS Safari from bouncing the page while playing
document.addEventListener('touchmove', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());

/* ---------- service worker ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(err => {
      console.warn('[highline] service worker not registered', err);
    });
  });
}

// handy for debugging from Safari's console
window.highline = { game, ui, store };
