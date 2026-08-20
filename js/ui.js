/* =========================================================
   ui.js — screens, HUD and everything the thumb touches.

   The 3D scene is always live behind the interface, so the
   UI's job is to stay out of the way: translucent cards,
   one idea per screen, and no permanent balance meter.
   ========================================================= */

import { store } from './storage.js';
import { LOCATIONS, LOCATION_BY_ID, CHALLENGES, TRICKS, QUOTES, UNLOCK_RULES } from './content.js';
import { audio } from './audio.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.floor(n).toLocaleString();

/* Small pictograms for the trick rail — drawn, not downloaded. */
function trickIcon (id) {
  const body = {
    sit:      '<circle cx="19" cy="8" r="3"/><rect x="17.6" y="11" width="2.8" height="9" rx="1.4"/><rect x="19" y="19" width="10" height="2.4" rx="1.2"/><rect x="8" y="19" width="12" height="2.4" rx="1.2"/><rect x="27" y="20" width="2.4" height="8" rx="1.2"/>',
    knee:     '<circle cx="19" cy="7" r="3"/><rect x="17.6" y="10" width="2.8" height="10" rx="1.4"/><rect x="8" y="13" width="22" height="2.2" rx="1.1"/><rect x="17.6" y="20" width="2.6" height="8" rx="1.3" transform="rotate(28 19 24)"/><rect x="14" y="27" width="9" height="2.2" rx="1.1"/>',
    turn180:  '<circle cx="19" cy="7" r="3"/><rect x="17.6" y="10" width="2.8" height="11" rx="1.4"/><rect x="7" y="13" width="24" height="2.2" rx="1.1"/><rect x="16.4" y="21" width="2.3" height="9" rx="1.1"/><rect x="19.4" y="21" width="2.3" height="9" rx="1.1"/><path d="M9 33 A10 5 0 0 0 29 33" fill="none" stroke="currentColor" stroke-width="1.4"/>',
    spin360:  '<circle cx="19" cy="7" r="3"/><rect x="17.6" y="10" width="2.8" height="11" rx="1.4"/><rect x="7" y="13" width="24" height="2.2" rx="1.1"/><rect x="16.4" y="21" width="2.3" height="9" rx="1.1"/><rect x="19.4" y="21" width="2.3" height="9" rx="1.1"/><ellipse cx="19" cy="33" rx="11" ry="4.5" fill="none" stroke="currentColor" stroke-width="1.4"/>',
    surfer:   '<circle cx="19" cy="6.5" r="3"/><rect x="17.6" y="9.5" width="2.8" height="12" rx="1.4"/><rect x="5" y="11" width="28" height="2.2" rx="1.1"/><rect x="15.4" y="21" width="2.4" height="9.5" rx="1.2" transform="rotate(-12 16.6 26)"/><rect x="20.2" y="21" width="2.4" height="9.5" rx="1.2" transform="rotate(12 21.4 26)"/>',
    yoga:     '<circle cx="19" cy="7" r="3"/><rect x="17.6" y="10" width="2.8" height="10" rx="1.4"/><rect x="17.6" y="4" width="2.8" height="0"/><path d="M19 20 L11 30 M19 20 L27 30" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M19 12 L11 8 M19 12 L27 8" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
    backward: '<circle cx="19" cy="7" r="3"/><rect x="17.6" y="10" width="2.8" height="11" rx="1.4"/><rect x="7" y="13" width="24" height="2.2" rx="1.1"/><rect x="16.4" y="21" width="2.3" height="9" rx="1.1"/><rect x="19.4" y="21" width="2.3" height="9" rx="1.1"/><path d="M25 34 L13 34 M16 31 L13 34 L16 37" stroke="currentColor" stroke-width="1.5" fill="none"/>'
  }[id] || '';
  return `<svg viewBox="0 0 38 40" fill="currentColor">${body}</svg>`;
}

export class UI {
  constructor (game) {
    this.game = game;
    this.stack = [];
    this.current = null;
    this.hudVisible = false;
    this._bind();
    this._buildLocations();
    this._buildTricks();
    this._buildCustomize();
    this._syncSettings();
    this.refreshMenu();
  }

  /* ---------------- screen plumbing ---------------- */
  show (name, push = true) {
    const el = $('screen-' + name);
    if (!el) return;
    if (this.current) $('screen-' + this.current).hidden = true;
    if (push && this.current && this.current !== name) this.stack.push(this.current);
    el.hidden = false;
    this.current = name;
    this.hud(false);
    if (name === 'locations') this._refreshLocations();
    if (name === 'challenges') this._buildChallenges();
    if (name === 'tricks') this._buildTricks();
    if (name === 'stats') this._buildStats();
    if (name === 'menu') this.refreshMenu();
  }

  hideAll () {
    for (const s of document.querySelectorAll('.screen')) s.hidden = true;
    this.current = null;
  }

  back () {
    const prev = this.stack.pop() || 'menu';
    if (this.current) $('screen-' + this.current).hidden = true;
    this.current = null;
    this.show(prev, false);
  }

  hud (on) {
    this.hudVisible = on;
    $('hud').hidden = !on;
  }

  toast (msg, ms = 2200) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('on'), ms);
  }

  coach (msg) {
    const c = $('coach');
    if (!msg) { c.hidden = true; return; }
    c.textContent = msg;
    c.hidden = false;
  }

  /* ---------------- main menu ---------------- */
  refreshMenu () {
    const loc = LOCATION_BY_ID[this.game.locationId] || LOCATIONS[0];
    $('continue-sub').textContent = `${loc.name} · best ${fmt(store.loc(loc.id).best)} m`;
    $('env-time').textContent = loc.time;
    $('env-temp').textContent = `${loc.temp}°C`;
    const w = this.game.wind ? this.game.wind.speed : loc.windBase;
    $('env-wind').textContent = w < 8 ? 'Light wind' : w < 18 ? 'Moderate wind' : 'Strong wind';
    $('env-ico').textContent = loc.time === 'Sunset' || loc.time === 'Evening' ? '⛅' : loc.time === 'Dawn' ? '☁' : '☀';
    const day = Math.floor(Date.now() / 86400000);
    $('quote-text').textContent = QUOTES[day % QUOTES.length];
  }

  /* ---------------- locations ---------------- */
  _buildLocations () {
    const rail = $('loc-rail');
    rail.innerHTML = '';
    for (const l of LOCATIONS) {
      const card = document.createElement('button');
      card.className = 'loc-card';
      card.dataset.id = l.id;
      card.innerHTML = `
        <img src="${l.image}" alt="" loading="lazy">
        <span class="shade"></span>
        <span class="loc-badge" data-badge></span>
        <span class="loc-req" data-req></span>
        <span class="loc-meta"><b>${l.name}</b><i>${l.region}</i></span>`;
      card.addEventListener('click', () => this._pickLocation(l));
      rail.appendChild(card);
    }
    const dots = $('loc-dots');
    dots.innerHTML = LOCATIONS.map(() => '<i></i>').join('');
    rail.addEventListener('scroll', () => {
      const i = Math.round(rail.scrollLeft / (rail.scrollWidth / LOCATIONS.length));
      [...dots.children].forEach((d, k) => d.classList.toggle('on', k === Math.min(i, LOCATIONS.length - 1)));
    }, { passive: true });
    this._refreshLocations();
  }

  _refreshLocations () {
    for (const card of document.querySelectorAll('.loc-card')) {
      const l = LOCATION_BY_ID[card.dataset.id];
      const save = store.loc(l.id);
      const badge = card.querySelector('[data-badge]');
      const req = card.querySelector('[data-req]');
      card.classList.toggle('sel', l.id === this.game.locationId);
      if (!save.unlocked) {
        badge.textContent = '🔒'; badge.classList.remove('ok');
        req.textContent = l.unlockText;
      } else {
        badge.textContent = l.id === this.game.locationId ? '✓' : '→';
        badge.classList.toggle('ok', l.id === this.game.locationId);
        req.textContent = save.best > 0 ? `Best ${fmt(save.best)} m` : '';
      }
    }
    [...$('loc-dots').children].forEach((d, k) => d.classList.toggle('on', k === 0));
  }

  _pickLocation (l) {
    const save = store.loc(l.id);
    if (!save.unlocked) { this.toast(`Locked — ${l.unlockText.toLowerCase()}`); return; }
    audio.tick();
    this.game.setLocation(l.id);
    this._refreshLocations();
    this.refreshMenu();
    // arriving here from Free walk means "take me there now"
    if (this.pendingStart) { this.pendingStart = false; this.startRun('freewalk', null); }
    else this.toast(`${l.name} rigged`);
  }

  /* ---------------- challenges ---------------- */
  _buildChallenges () {
    const list = $('chal-list');
    list.innerHTML = '';
    for (const c of CHALLENGES) {
      const save = store.challenge(c.id);
      const el = document.createElement('button');
      el.className = 'chal' + (save.done ? ' done' : '');
      el.innerHTML = `
        <span class="chal-ico">${save.done ? '✓' : c.icon}</span>
        <span class="chal-txt"><b>${c.name}</b><i>${c.desc}</i></span>
        <span class="chal-prog">${save.done ? 'Done' : 'Start'}</span>`;
      el.addEventListener('click', () => {
        audio.tick();
        this.startRun('challenge', c);
      });
      list.appendChild(el);
    }
    $('chal-count').textContent = `${store.challengesDone()} / ${CHALLENGES.length}`;
  }

  /* ---------------- tricks ---------------- */
  _buildTricks () {
    const rail = $('trick-rail');
    rail.innerHTML = '';
    const unlocked = store.player.unlockedTricks;
    for (const t of TRICKS) {
      const on = unlocked.includes(t.id);
      const el = document.createElement('div');
      el.className = 'trick' + (on && t.ready ? ' on' : '') + (on ? '' : ' locked');
      el.innerHTML = `${trickIcon(t.id)}<b>${t.name}</b><i>${on && t.ready ? t.gesture : t.ready ? t.unlock : 'Coming soon'}</i>`;
      rail.appendChild(el);
    }
    $('trick-count').textContent = `${unlocked.length} / ${TRICKS.length}`;
  }

  /* ---------------- customize ---------------- */
  _buildCustomize () {
    const sets = {
      'sw-shirt': { key: 'shirt', colors: ['#4a5a4e', '#c9c4b8', '#2f4858', '#8a4b3c', '#d8a24a', '#1f2225'] },
      'sw-pants': { key: 'pants', colors: ['#31415c', '#4b4640', '#20242a', '#6d5a44', '#3d5245', '#7a7d84'] },
      'sw-line':  { key: 'line',  colors: ['#c8543a', '#e0b23c', '#3f7fb5', '#7dbf6a', '#b1b6bd', '#8452b8'] }
    };
    for (const id in sets) {
      const wrap = $(id);
      wrap.innerHTML = '';
      for (const c of sets[id].colors) {
        const b = document.createElement('button');
        b.className = 'sw';
        b.style.background = c;
        b.dataset.color = c;
        b.addEventListener('click', () => {
          store.player.appearance[sets[id].key] = c;
          store.save();
          this.game.refreshAppearance();
          this._syncSwatches();
          audio.tick();
        });
        wrap.appendChild(b);
      }
    }
    this._syncSwatches();
  }

  _syncSwatches () {
    const a = store.player.appearance;
    const map = { 'sw-shirt': a.shirt, 'sw-pants': a.pants, 'sw-line': a.line };
    for (const id in map) {
      for (const b of $(id).children) b.classList.toggle('on', b.dataset.color.toLowerCase() === map[id].toLowerCase());
    }
  }

  /* ---------------- stats ---------------- */
  _buildStats () {
    const p = store.player;
    const items = [
      ['Longest walk', `${fmt(p.longestWalk)} m`],
      ['Total distance', `${fmt(p.totalDistance)} m`],
      ['Steps taken', fmt(p.totalSteps)],
      ['Falls', fmt(p.totalFalls)],
      ['Tricks landed', fmt(p.tricksLanded)],
      ['Challenges', `${store.challengesDone()} / ${CHALLENGES.length}`],
      ['Lines unlocked', `${Object.values(store.data.locations).filter(l => l.unlocked).length} / ${LOCATIONS.length}`],
      ['Best here', `${fmt(store.loc(this.game.locationId).best)} m`]
    ];
    $('stat-grid').innerHTML = items.map(([k, v]) => `<div class="stat"><i>${k}</i><b>${v}</b></div>`).join('');
  }

  /* ---------------- settings ---------------- */
  _syncSettings () {
    const s = store.settings;
    $('set-sens').value = Math.round(s.sensitivity * 100);
    $('val-sens').textContent = Math.round(s.sensitivity * 100) + '%';
    $('set-sound').checked = s.sound;
    $('set-haptics').checked = s.haptics;
    $('set-hand').checked = s.lefty;
    document.body.classList.toggle('lefty', s.lefty);
    for (const seg of document.querySelectorAll('.seg')) {
      const key = seg.dataset.key;
      for (const b of seg.children) b.classList.toggle('on', b.dataset.v === s[key]);
    }
  }

  /* ---------------- run flow ---------------- */
  startRun (mode, challenge) {
    this.hideAll();
    this.hud(true);
    $('overlay-fall').hidden = true;
    $('overlay-pause').hidden = true;
    this.game.startRun(mode, challenge);
    const objective = $('hud-objective');
    if (challenge) {
      objective.hidden = false;
      $('obj-title').textContent = challenge.name;
      $('obj-sub').textContent = challenge.desc;
    } else objective.hidden = true;

    if (!store.settings.seenTutorial) {
      this.coach('Hold left or right to balance · swipe up to step');
      setTimeout(() => { store.setSetting('seenTutorial', true); this.coach(null); }, 9000);
    } else this.coach(null);
  }

  leaveRun () {
    const walked = this.game.distance;
    this.hud(false);
    $('overlay-fall').hidden = true;
    $('overlay-pause').hidden = true;
    this.game.toMenu();
    this.show('menu', false);
    this.stack.length = 0;
    if (walked >= 1) this.toast(`${fmt(walked)} m banked`);
  }

  /* ---------------- HUD ---------------- */
  updateHUD (d) {
    $('hud-dist').textContent = `${fmt(d.distance)} m`;
    $('hud-best').textContent = `${fmt(d.best)} m`;
    $('hud-alt').textContent = `${fmt(d.altitude)} m`;
    const bf = $('breath-fill');
    bf.style.width = (d.breath * 100).toFixed(0) + '%';
    bf.classList.toggle('low', d.breath < 0.3);
    const dots = $('focus-dots').children;
    for (let i = 0; i < dots.length; i++) dots[i].classList.toggle('spent', i >= d.focus);
    $('wb-val').textContent = `${Math.round(d.wind)} km/h`;
    $('wb-arrow').style.transform = `rotate(${Math.round(d.windDir)}deg)`;
    $('wind-badge').classList.toggle('gusting', d.warning || d.wind > 22);
    $('gust-flash').classList.toggle('on', d.warning);
    $('btn-steady').classList.toggle('on', d.steady);
  }

  updateObjective (o) {
    const c = o.challenge;
    const unit = c.type === 'windTime' ? 's' : 'm';
    $('obj-sub').textContent = `${Math.floor(o.value)} / ${c.target} ${unit}`;
  }

  /* ---------------- fall result ---------------- */
  showFall (info) {
    const ov = $('overlay-fall');
    const out = info.focusLeft <= 0;
    $('ov-eyebrow').textContent = out ? 'Session over' : 'Caught by the leash';
    $('ov-big').textContent = `${fmt(info.distance)} m`;
    $('ov-sub').textContent = info.record
      ? 'A new best on this line.'
      : out
        ? 'Three falls. Rest your legs and start again.'
        : `${info.focusLeft} focus ${info.focusLeft === 1 ? 'mark' : 'marks'} left.`;
    $('ov-again').textContent = out ? 'Start again' : 'Climb back on';
    ov.hidden = false;
  }

  hideFall () { $('overlay-fall').hidden = true; }

  /* ---------------- unlocks ---------------- */
  checkUnlocks () {
    for (const rule of UNLOCK_RULES) {
      if (!store.loc(rule.id).unlocked && rule.test(store)) {
        store.unlockLocation(rule.id);
        const l = LOCATION_BY_ID[rule.id];
        this.toast(`${l.name} unlocked`);
        audio.chime();
      }
    }
  }

  /* ---------------- events ---------------- */
  _bind () {
    // menu buttons
    for (const b of document.querySelectorAll('[data-action]')) {
      b.addEventListener('click', () => {
        const a = b.dataset.action;
        audio.init(); audio.tick();
        if (a === 'back') this.back();
        else if (a === 'continue') this.startRun('freewalk', null);
        else if (a === 'freewalk') { this.pendingStart = true; this.show('locations'); }
        else { if (a === 'locations') this.pendingStart = false; this.show(a); }
      });
    }

    $('btn-pause').addEventListener('click', () => {
      this.game.setPaused(true);
      $('pause-loc').textContent = LOCATION_BY_ID[this.game.locationId].name;
      $('overlay-pause').hidden = false;
    });
    $('pz-resume').addEventListener('click', () => { $('overlay-pause').hidden = true; this.game.setPaused(false); });
    $('pz-restart').addEventListener('click', () => {
      $('overlay-pause').hidden = true;
      this.game.setPaused(false);
      this.startRun(this.game.mode, this.game.challenge);
    });
    $('pz-settings').addEventListener('click', () => {
      $('overlay-pause').hidden = true;
      this.hud(false);
      this.stack = ['menu'];
      this.show('settings', false);
      this.game.setPaused(false);
    });
    $('pz-menu').addEventListener('click', () => { this.game.setPaused(false); this.leaveRun(); });

    $('ov-again').addEventListener('click', () => { this.hideFall(); this.game.clearChallengeFlag(); this.game.recover(); });
    $('ov-menu').addEventListener('click', () => this.leaveRun());

    // in-run action buttons
    const steady = $('btn-steady');
    const press = (on) => (e) => { e.preventDefault(); this.game.input.setButtonSteady(on); };
    steady.addEventListener('pointerdown', press(true));
    steady.addEventListener('pointerup', press(false));
    steady.addEventListener('pointercancel', press(false));
    steady.addEventListener('pointerleave', press(false));
    $('btn-trick').addEventListener('click', (e) => { e.preventDefault(); this.game.requestTurn(); });

    // settings
    $('set-sens').addEventListener('input', (e) => {
      const v = parseInt(e.target.value, 10) / 100;
      store.setSetting('sensitivity', v);
      $('val-sens').textContent = Math.round(v * 100) + '%';
    });
    for (const seg of document.querySelectorAll('.seg')) {
      seg.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        const key = seg.dataset.key;
        store.setSetting(key, b.dataset.v);
        this._syncSettings();
        audio.tick();
        if (key === 'quality') { this.game.applyQuality(); this.game.setLocation(this.game.locationId, true); }
        if (key === 'difficulty') this.game.setLocation(this.game.locationId, true);
      });
    }
    $('set-sound').addEventListener('change', (e) => { store.setSetting('sound', e.target.checked); audio.setEnabled(e.target.checked); });
    $('set-haptics').addEventListener('change', (e) => store.setSetting('haptics', e.target.checked));
    $('set-hand').addEventListener('change', (e) => {
      store.setSetting('lefty', e.target.checked);
      document.body.classList.toggle('lefty', e.target.checked);
    });
    $('btn-reset').addEventListener('click', () => {
      if (!this._confirmReset) {
        this._confirmReset = true;
        $('btn-reset').textContent = 'Tap again to erase everything';
        setTimeout(() => { this._confirmReset = false; $('btn-reset').textContent = 'Erase all progress'; }, 4000);
        return;
      }
      store.reset();
      location.reload();
    });
  }
}
