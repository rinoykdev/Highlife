/* =========================================================
   audio.js — everything synthesised, nothing downloaded.

   A filtered noise bed doubles as the wind cue: the filter
   opens and the gain swells about a second before a gust
   actually hits, which is the warning a real highliner gets
   from the sound in the valley.
   ========================================================= */

export class AudioEngine {
  constructor () {
    this.ctx = null;
    this.enabled = true;
    this.ready = false;
    this.master = null;
  }

  /** Must be called from a user gesture on iOS. */
  init () {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();

    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.9 : 0;
    this.master.connect(ctx.destination);

    // --- wind bed: pink-ish noise through a moving band-pass ---
    const len = 2 * ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;

    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 380;
    this.windFilter.Q.value = 0.8;

    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.05;

    src.connect(this.windFilter).connect(this.windGain).connect(this.master);
    src.start();

    // --- distant valley drone, gives the height a size ---
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.035;
    droneGain.connect(this.master);
    for (const f of [55, 82.5, 110.5]) {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0.5;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + Math.random() * 0.06;
      const lg = ctx.createGain(); lg.gain.value = 0.35;
      lfo.connect(lg).connect(g.gain); lfo.start();
      o.connect(g).connect(droneGain); o.start();
    }
    this.ready = true;
  }

  setEnabled (v) {
    this.enabled = v;
    if (this.master) this.master.gain.setTargetAtTime(v ? 0.9 : 0, this.ctx.currentTime, 0.1);
    if (v && this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  suspend () { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume () { if (this.ctx && this.ctx.state === 'suspended' && this.enabled) this.ctx.resume(); }

  /** speed in km/h, warning=true during the pre-gust swell */
  updateWind (speedKmh, warning) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const n = Math.min(1, speedKmh / 34);
    this.windGain.gain.setTargetAtTime(0.03 + n * 0.22 + (warning ? 0.05 : 0), t, 0.35);
    this.windFilter.frequency.setTargetAtTime(320 + n * 900 + (warning ? 260 : 0), t, 0.5);
    this.windFilter.Q.setTargetAtTime(0.7 + n * 1.4, t, 0.5);
  }

  _blip (freq, dur, type = 'sine', vol = 0.2, slideTo = null) {
    if (!this.ready || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  _noiseBurst (dur, freq, q, vol) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = ctx.createBufferSource(); s.buffer = b;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = vol;
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
  }

  footstep () { this._noiseBurst(0.14, 900, 1.4, 0.16); this._blip(150, 0.09, 'sine', 0.08, 90); }
  wobble (intensity) { this._noiseBurst(0.12, 500 + intensity * 700, 2.5, 0.05 + intensity * 0.06); }
  fall () { this._blip(420, 1.5, 'sine', 0.14, 70); this._noiseBurst(1.2, 300, 0.6, 0.13); }
  catchRope () { this._noiseBurst(0.3, 190, 0.9, 0.28); this._blip(90, 0.35, 'triangle', 0.16, 55); }
  chime () { this._blip(880, 0.5, 'sine', 0.12, 1320); }
  tick () { this._blip(520, 0.05, 'square', 0.04); }
  breathe () { this._noiseBurst(0.9, 420, 0.7, 0.05); }
}

export const audio = new AudioEngine();
