/* =========================================================
   storage.js — versioned local save
   Everything lives in one LocalStorage key. The shape is
   versioned so later releases can migrate instead of wipe.
   ========================================================= */

const KEY = 'highline.save';
export const SAVE_VERSION = 1;

/** Defaults are also the migration target: missing keys get filled in. */
function defaults () {
  return {
    version: SAVE_VERSION,
    player: {
      lastLocation: 'summit',
      totalDistance: 0,
      totalFalls: 0,
      totalSteps: 0,
      longestWalk: 0,
      tricksLanded: 0,
      unlockedTricks: ['sit'],
      appearance: { shirt: '#4a5a4e', pants: '#31415c', line: '#c8543a' }
    },
    locations: {
      summit:   { unlocked: true,  best: 0, visits: 0 },
      eagle:    { unlocked: false, best: 0, visits: 0 },
      cloud:    { unlocked: false, best: 0, visits: 0 },
      golden:   { unlocked: false, best: 0, visits: 0 },
      misty:    { unlocked: false, best: 0, visits: 0 }
    },
    challenges: {},          // id -> { done:bool, best:number }
    settings: {
      sensitivity: 1.0,
      difficulty: 'standard',
      quality: 'medium',
      cameraSway: 'subtle',
      sound: true,
      haptics: true,
      lefty: false,
      seenTutorial: false,
      seenRotate: false
    }
  };
}

/** Deep-fill missing keys from defaults without clobbering saved values. */
function merge (base, saved) {
  if (!saved || typeof saved !== 'object') return base;
  for (const k of Object.keys(base)) {
    const b = base[k], s = saved[k];
    if (s === undefined || s === null) continue;
    if (Array.isArray(b)) base[k] = Array.isArray(s) ? s.slice() : b;
    else if (typeof b === 'object') base[k] = merge(b, s);
    else if (typeof s === typeof b) base[k] = s;
  }
  // carry over unknown challenge entries verbatim
  if (saved.challenges && typeof saved.challenges === 'object') {
    base.challenges = Object.assign({}, saved.challenges);
  }
  return base;
}

class Store {
  constructor () {
    this.data = defaults();
    this.load();
    this._pending = 0;
  }

  load () {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { /* private mode */ }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      this.data = merge(defaults(), parsed);
      this.data.version = SAVE_VERSION;
    } catch (e) {
      console.warn('[highline] save unreadable, starting fresh');
      this.data = defaults();
    }
  }

  /** Debounced write — safe to call on every frame-ish event. */
  save () {
    if (this._pending) return;
    this._pending = setTimeout(() => {
      this._pending = 0;
      try { localStorage.setItem(KEY, JSON.stringify(this.data)); }
      catch (e) { console.warn('[highline] could not save', e); }
    }, 220);
  }

  saveNow () {
    if (this._pending) { clearTimeout(this._pending); this._pending = 0; }
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) {}
  }

  get settings () { return this.data.settings; }
  get player ()   { return this.data.player; }

  setSetting (k, v) { this.data.settings[k] = v; this.save(); }

  loc (id) {
    if (!this.data.locations[id]) this.data.locations[id] = { unlocked: false, best: 0, visits: 0 };
    return this.data.locations[id];
  }

  /** Records a completed walk. Returns true when it beat the location best. */
  recordWalk (locationId, metres, steps) {
    const L = this.loc(locationId);
    const p = this.data.player;
    p.totalDistance += Math.max(0, metres);
    p.totalSteps += steps || 0;
    if (metres > p.longestWalk) p.longestWalk = metres;
    let record = false;
    if (metres > L.best) { L.best = metres; record = true; }
    this.save();
    return record;
  }

  recordFall () { this.data.player.totalFalls++; this.save(); }

  challenge (id) {
    if (!this.data.challenges[id]) this.data.challenges[id] = { done: false, best: 0 };
    return this.data.challenges[id];
  }

  completeChallenge (id, value) {
    const c = this.challenge(id);
    const first = !c.done;
    c.done = true;
    if (value > c.best) c.best = value;
    this.save();
    return first;
  }

  challengesDone () {
    return Object.values(this.data.challenges).filter(c => c.done).length;
  }

  unlockLocation (id) {
    const L = this.loc(id);
    if (L.unlocked) return false;
    L.unlocked = true;
    this.save();
    return true;
  }

  unlockTrick (id) {
    const t = this.data.player.unlockedTricks;
    if (t.includes(id)) return false;
    t.push(id);
    this.save();
    return true;
  }

  reset () {
    this.data = defaults();
    this.saveNow();
  }
}

export const store = new Store();
