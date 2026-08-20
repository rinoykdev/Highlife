/* =========================================================
   input.js — touch first, keyboard for the desk.

   Left half of the glass = lean left, right half = lean right,
   and how far out you press decides how hard. Hold both sides
   at once and the walker settles into a steadying breath.
   Swipe up to take a step, down to sit, and the two HUD
   buttons cover steady + turn for one-thumb play.
   ========================================================= */

import { clamp, lerp } from './physics.js';

const SWIPE_MIN = 42;       // px of travel before a flick counts
const SWIPE_TIME = 480;     // ms window
const TAP_SLOP = 14;        // px a "tap" is allowed to wander
const DOUBLE_TAP = 320;     // ms

export class InputController {
  constructor () {
    this.pointers = new Map();
    this.lean = 0;            // smoothed -1..1 delivered to the balance model
    this.rawLean = 0;
    this.steady = false;
    this.buttonSteady = false;
    this.enabled = false;
    this.lastTapTime = 0;
    this.onStep = () => {};
    this.onSit = () => {};
    this.onTurn = () => {};
    this.keys = new Set();
    this._bind();
  }

  setEnabled (v) {
    this.enabled = v;
    if (!v) { this.pointers.clear(); this.rawLean = 0; this.lean = 0; this.steady = false; }
  }

  _ignores (e) {
    const t = e.target;
    if (!t || !t.closest) return false;
    return !!t.closest('button, input, .screen, .overlay, #rotate, .boot');
  }

  _bind () {
    const opts = { passive: false };

    window.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this._ignores(e)) return;
      e.preventDefault();
      this.pointers.set(e.pointerId, {
        x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
        t0: performance.now(), moved: 0, consumed: false
      });
      this._recalc();
    }, opts);

    window.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      e.preventDefault();
      p.moved = Math.max(p.moved, Math.hypot(e.clientX - p.x0, e.clientY - p.y0));
      p.x = e.clientX; p.y = e.clientY;

      // a flick resolves as soon as it clears the threshold
      if (!p.consumed) {
        const dy = p.y - p.y0, dx = p.x - p.x0;
        const dt = performance.now() - p.t0;
        if (dt < SWIPE_TIME && Math.abs(dy) > SWIPE_MIN && Math.abs(dy) > Math.abs(dx) * 1.25) {
          p.consumed = true;
          if (dy < 0) this.onStep();
          else this.onSit();
        }
      }
      this._recalc();
    }, opts);

    const up = (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dt = performance.now() - p.t0;
      if (!p.consumed && p.moved < TAP_SLOP && dt < 260) {
        const now = performance.now();
        if (now - this.lastTapTime < DOUBLE_TAP) { this.onTurn(); this.lastTapTime = 0; }
        else this.lastTapTime = now;
      }
      this.pointers.delete(e.pointerId);
      this._recalc();
    };
    window.addEventListener('pointerup', up, opts);
    window.addEventListener('pointercancel', up, opts);

    // ---- keyboard (desktop testing / accessibility) ----
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      const k = e.key.toLowerCase();
      if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' ', 'a', 'd', 'w', 's', 'q'].includes(k)) e.preventDefault();
      if (e.repeat) return;
      if (k === 'arrowup' || k === 'w') this.onStep();
      else if (k === 'arrowdown' || k === 's') this.onSit();
      else if (k === 'q') this.onTurn();
      this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => { this.keys.clear(); this.pointers.clear(); this._recalc(); });
  }

  /** Recompute the analog lean from every active touch. */
  _recalc () {
    const w = window.innerWidth || 1;
    const mid = w / 2;
    let left = false, right = false, sum = 0;
    for (const p of this.pointers.values()) {
      if (p.consumed) continue;
      const dx = (p.x - mid) / (w * 0.34);          // ±1 near the screen edges
      const mag = clamp(Math.abs(dx), 0.2, 1);
      if (p.x < mid) { left = true; sum -= mag; }
      else { right = true; sum += mag; }
    }
    this.rawLean = clamp(sum, -1, 1);
    // one thumb each side = a steadying breath, and the leans cancel
    this.steady = (left && right) || this.buttonSteady;
  }

  setButtonSteady (v) {
    this.buttonSteady = v;
    this._recalc();
  }

  /** Smooth toward the raw value so input feels like weight, not a switch. */
  update (dt) {
    this._recalc();                       // pointers + steady button
    let target = this.rawLean;
    if (this.keys.has('arrowleft') || this.keys.has('a')) target -= 1;
    if (this.keys.has('arrowright') || this.keys.has('d')) target += 1;
    if (this.keys.has(' ') || this.keys.has('shift')) this.steady = true;
    this.lean = lerp(this.lean, clamp(target, -1, 1), clamp(dt * 11, 0, 1));
    return this.lean;
  }
}
