/* =========================================================
   physics.js — the part the whole game rests on.

   Three independent, testable pieces:
     Wind          continuous field with telegraphed gusts
     LinePhysics   1-D wave sim of the webbing (x + y)
     BalanceModel  inverted-pendulum-ish balance with a real
                   point of no return

   None of these touch Three.js, so they can be unit tested
   in plain node.
   ========================================================= */

export const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/* ---------- cheap deterministic value noise ---------- */
function hash (n) {
  const s = Math.sin(n) * 43758.5453123;
  return s - Math.floor(s);
}
export function noise1 (x) {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash(i), hash(i + 1), u) * 2 - 1;   // -1..1
}
export function fbm (x) {
  return noise1(x) * 0.55 + noise1(x * 2.13 + 11.7) * 0.3 + noise1(x * 4.7 + 3.1) * 0.15;
}

/* =========================================================
   WIND
   Slow base drift + layered turbulence + scheduled gusts.
   Gusts announce themselves (`warning`) about 1.6 s early so
   a player can learn to brace instead of being sniped.
   ========================================================= */
export class Wind {
  constructor (def, difficultyScale = 1) {
    this.def = def;
    this.scale = difficultyScale;
    this.t = Math.random() * 100;
    this.speed = def.windBase;            // km/h, for display
    this.lateral = 0;                     // -1..1 signed push on the walker
    this.dirDeg = 210;
    this.gustTimer = 4 + Math.random() * 6;
    this.gustState = 'calm';              // calm | warning | gust | fade
    this.gustPower = 0;
    this.warning = false;
    this.gustStrength = 0;
  }

  reset () {
    this.gustTimer = 5 + Math.random() * 6;
    this.gustState = 'calm';
    this.gustPower = 0;
    this.warning = false;
  }

  update (dt) {
    this.t += dt;
    const d = this.def;

    // Gust scheduler ------------------------------------------------
    this.gustTimer -= dt;
    if (this.gustState === 'calm' && this.gustTimer <= 0) {
      this.gustState = 'warning';
      this.gustTimer = 1.6;
      this.warning = true;
      this.gustStrength = 0.55 + Math.random() * 0.45;
    } else if (this.gustState === 'warning' && this.gustTimer <= 0) {
      this.gustState = 'gust';
      this.gustTimer = 1.5 + Math.random() * 2.2;
      this.warning = false;
    } else if (this.gustState === 'gust' && this.gustTimer <= 0) {
      this.gustState = 'fade';
      this.gustTimer = 2.2;
    } else if (this.gustState === 'fade' && this.gustTimer <= 0) {
      this.gustState = 'calm';
      this.gustTimer = 7 + Math.random() * 9;
    }

    // Envelope: ramps in during warning, holds, then decays.
    let target = 0;
    if (this.gustState === 'warning') target = 0.25 * this.gustStrength;
    else if (this.gustState === 'gust') target = this.gustStrength;
    else if (this.gustState === 'fade') target = 0.2 * this.gustStrength;
    this.gustPower = lerp(this.gustPower, target, clamp(dt * 1.6, 0, 1));

    // Turbulence ----------------------------------------------------
    const slow = fbm(this.t * 0.11);
    const fast = fbm(this.t * 0.9 + 40) * 0.45 + fbm(this.t * 2.7 + 90) * 0.2;
    const turb = (slow * 0.7 + fast) * d.windTurbulence;

    const gustKmh = this.gustPower * (d.windGust - d.windBase);
    this.speed = Math.max(0, d.windBase + gustKmh + turb * 3.5) * this.scale;

    // Signed lateral push. Base direction wanders slowly.
    const dirBias = Math.sin(this.t * 0.07) * 0.6 + noise1(this.t * 0.05) * 0.4;
    this.lateral = clamp((dirBias * 0.5 + turb * 0.55 + this.gustPower * Math.sign(dirBias || 1) * 0.9), -1.6, 1.6);
    this.dirDeg = 180 + dirBias * 90;
    return this.speed;
  }
}

/* =========================================================
   LINE PHYSICS
   Discrete string: N nodes, fixed ends, explicit integration
   of the 1-D wave equation on both axes. Gravity gives the
   sag for free; footsteps inject impulses that travel and
   reflect off the anchors.
   ========================================================= */
export class LinePhysics {
  constructor (opts = {}) {
    this.n = opts.nodes || 48;
    this.length = opts.length || 68;      // metres, anchor to anchor
    this.sagTarget = opts.sag || 1.5;     // metres of sag at midpoint, unloaded
    this.spacing = this.length / (this.n - 1);   // metres between nodes
    this.tension = 3600;                  // wave speed² in node-index units
    this.damping = 1.35;
    this.x = new Float32Array(this.n);    // lateral offset (m)
    this.y = new Float32Array(this.n);    // vertical offset (m, negative = sag)
    this.vx = new Float32Array(this.n);
    this.vy = new Float32Array(this.n);
    this.fx = new Float32Array(this.n);
    this.fy = new Float32Array(this.n);
    this._ax = new Float32Array(this.n);
    this._ay = new Float32Array(this.n);
    // g chosen so the unloaded steady-state midpoint sag == sagTarget
    this.g = this.sagTarget * 8 * this.tension / ((this.n - 1) * (this.n - 1));
    this.settle(240);
  }

  /** Run the sim quietly so the line starts already sagging. */
  settle (steps) {
    for (let i = 0; i < steps; i++) this.step(1 / 120);
    for (let i = 0; i < this.n; i++) { this.vx[i] = 0; this.vy[i] = 0; }
  }

  /** t: 0..1 along the line -> continuous node index */
  idx (t) { return clamp(t, 0, 1) * (this.n - 1); }

  /** Sampled displacement at normalised position t. */
  sample (t) {
    const f = this.idx(t);
    const i = Math.floor(f), j = Math.min(i + 1, this.n - 1), a = f - i;
    return {
      x: lerp(this.x[i], this.x[j], a),
      y: lerp(this.y[i], this.y[j], a),
      vx: lerp(this.vx[i], this.vx[j], a),
      vy: lerp(this.vy[i], this.vy[j], a)
    };
  }

  /**
   * Local gradient of the webbing (dy/dx, dimensionless) at t. Divided by the
   * real node spacing so the value is an actual slope — feeding raw
   * metres-per-node into a rotation pitches the walker wildly on long lines.
   */
  slope (t) {
    const f = this.idx(t);
    const i = clamp(Math.floor(f), 1, this.n - 2);
    return (this.y[i + 1] - this.y[i - 1]) / (2 * this.spacing);
  }

  /** Spread a force over the two nodes either side of t. */
  addForce (t, fx, fy) {
    const f = this.idx(t);
    const i = Math.floor(f), j = Math.min(i + 1, this.n - 1), a = f - i;
    this.fx[i] += fx * (1 - a); this.fx[j] += fx * a;
    this.fy[i] += fy * (1 - a); this.fy[j] += fy * a;
  }

  /** Instant impulse (footstep, landing). */
  addImpulse (t, ix, iy) {
    const f = this.idx(t);
    const i = Math.floor(f), j = Math.min(i + 1, this.n - 1), a = f - i;
    this.vx[i] += ix * (1 - a); this.vx[j] += ix * a;
    this.vy[i] += iy * (1 - a); this.vy[j] += iy * a;
  }

  /**
   * Impulse smeared over a few nodes — a foot is not a point, and a
   * single-node kick is invisible on a 70 m line.
   */
  addImpulseSpread (t, ix, iy, width = 5) {
    const c = this.idx(t);
    const lo = Math.max(1, Math.floor(c - width));
    const hi = Math.min(this.n - 2, Math.ceil(c + width));
    let sum = 0;
    for (let i = lo; i <= hi; i++) sum += Math.exp(-((i - c) * (i - c)) / (2 * width * width * 0.25));
    if (sum <= 0) return;
    for (let i = lo; i <= hi; i++) {
      const w = Math.exp(-((i - c) * (i - c)) / (2 * width * width * 0.25)) / sum;
      this.vx[i] += ix * w * (hi - lo + 1) * 0.35;
      this.vy[i] += iy * w * (hi - lo + 1) * 0.35;
    }
  }

  step (dt) {
    const n = this.n, T = this.tension, D = this.damping, g = this.g;
    const x = this.x, y = this.y, vx = this.vx, vy = this.vy, fx = this.fx, fy = this.fy;
    const ax = this._ax, ay = this._ay;
    // pass 1 — accelerations sampled from the *old* state (symmetric stencil)
    for (let i = 1; i < n - 1; i++) {
      ax[i] = T * (x[i - 1] - 2 * x[i] + x[i + 1]) - D * vx[i] + fx[i];
      ay[i] = T * (y[i - 1] - 2 * y[i] + y[i + 1]) - D * vy[i] + fy[i] - g;
    }
    // pass 2 — semi-implicit Euler
    for (let i = 1; i < n - 1; i++) {
      vx[i] += ax[i] * dt; vy[i] += ay[i] * dt;
      x[i] += vx[i] * dt; y[i] += vy[i] * dt;
    }
    // anchors stay put
    x[0] = y[0] = x[n - 1] = y[n - 1] = 0;
    vx[0] = vy[0] = vx[n - 1] = vy[n - 1] = 0;
  }

  /** Advance with sub-stepping for stability, then clear forces. */
  update (dt) {
    const sub = 4;
    const h = Math.min(dt, 1 / 30) / sub;
    for (let s = 0; s < sub; s++) this.step(h);
    this.fx.fill(0); this.fy.fill(0);
  }
}

/* =========================================================
   BALANCE MODEL

   tilt: -1 (falling left) .. 0 (centred) .. +1 (falling right)
   Below ~0.35 the body self-centres slightly; past ~0.6 the
   destabilising term wins and the player has to work; past
   ~0.85 no amount of input can save it. That gradient is the
   entire game.
   ========================================================= */
export const FALL_TILT = 1.0;

export class BalanceModel {
  constructor () { this.reset(); }

  reset () {
    this.tilt = (Math.random() - 0.5) * 0.08;
    this.tiltVel = 0;
    this.t = Math.random() * 1000;
    this.stepPhase = 0;        // 0 = both feet planted, >0 = mid-step
    this.stepDir = 1;
    this.authority = 1;        // reduced while stepping / after a trick
    this.lastInput = 0;
  }

  /** Kick from taking a step: always destabilising, direction varies. */
  applyStep (strength = 1) {
    const bias = Math.sign(this.tilt || (Math.random() - 0.5));
    const kick = (0.42 + Math.random() * 0.36) * strength;
    // the step mostly pushes you further the way you were already going
    this.tiltVel += kick * bias * 0.75 + (Math.random() - 0.5) * kick * 0.9;
    this.stepPhase = 1;
  }

  /** Bigger, riskier disturbance for tricks. */
  applyTrick (strength = 1.6) {
    this.tiltVel += (Math.random() - 0.5) * 1.1 * strength;
    this.tilt += (Math.random() - 0.5) * 0.16 * strength;
    this.authority = 0.55;
  }

  /**
   * @param {number} dt
   * @param {object} p
   *   input        -1..1 analog player lean
   *   wind         -1..1 signed wind push
   *   lineAccel    lateral acceleration of the webbing underfoot
   *   steady       bool, holding breath/steadying
   *   sensitivity  0.6..1.5
   *   noiseScale   difficulty multiplier
   * @returns {'ok'|'fall'}
   */
  update (dt, p) {
    this.t += dt;
    const a = Math.abs(this.tilt);

    // recover step/trick authority
    if (this.stepPhase > 0) this.stepPhase = Math.max(0, this.stepPhase - dt * 2.2);
    this.authority = Math.min(1, this.authority + dt * 0.8);

    // 1. destabilising torque — grows super-linearly with lean
    const destab = 6.0 * this.tilt * (0.35 + 0.65 * a);

    // 2. passive body correction — vanishes once you're really committed
    const passiveGain = p.steady ? 6.6 : 5.2;
    const passive = passiveGain * this.tilt * Math.max(0, 1 - a * 1.15);

    // 3. micro tremor — you are never perfectly still
    const tremor = fbm(this.t * 1.35) * (p.steady ? 0.42 : 1.55) * (p.noiseScale ?? 1);

    // 4. player input, less effective the further you are gone
    const inp = clamp(p.input || 0, -1, 1);
    this.lastInput = inp;
    const player = inp * 7.0 * (1 - 0.4 * a) * (p.sensitivity ?? 1) *
                   this.authority * (this.stepPhase > 0 ? 0.78 : 1);

    // 5. wind + the webbing moving under the feet
    const wind = (p.wind || 0) * 1.35 * (p.steady ? 0.65 : 1);
    const line = -(p.lineAccel || 0) * 0.42;

    const damp = (p.steady ? 3.4 : 1.6) * this.tiltVel;

    const acc = destab - passive + tremor + player + wind + line - damp;
    this.tiltVel += acc * dt;
    this.tiltVel = clamp(this.tiltVel, -6, 6);
    this.tilt += this.tiltVel * dt;

    if (Math.abs(this.tilt) >= FALL_TILT) {
      this.tilt = clamp(this.tilt, -FALL_TILT, FALL_TILT);
      return 'fall';
    }
    return 'ok';
  }

  /** 0..1 — how close to gone. Used for camera, audio, haptics. */
  get danger () { return clamp(Math.abs(this.tilt) / FALL_TILT, 0, 1); }

  /** True once input alone can no longer save it. */
  get committed () { return Math.abs(this.tilt) > 0.86; }
}
