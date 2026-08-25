/* =========================================================
   game.js — the engine that holds it all together.

   States: idle (menu backdrop) → play → falling → hanging →
   result → play again. The walker's position on the webbing,
   the webbing's own motion and the balance model all feed
   each other, which is where the feel comes from.
   ========================================================= */

import * as THREE from '../lib/three.module.min.js';
import { LinePhysics, BalanceModel, Wind, clamp, lerp, FALL_TILT } from './physics.js';
import { Environment } from './environment.js';
import { Character, tryLoadWalker } from './character.js';
import { InputController } from './input.js';
import { audio } from './audio.js';
import { store } from './storage.js';
import { LOCATION_BY_ID } from './content.js';

const STEP_LENGTH = 0.62;        // metres per step
const LEASH_LENGTH = 4.2;        // metres of slack before the harness catches
const G = 9.81;

const QUALITY = {
  low:    { dpr: 1.0, aa: false },
  medium: { dpr: 1.6, aa: true },
  high:   { dpr: 2.0, aa: true }
};

export class Game {
  constructor (canvas) {
    this.canvas = canvas;
    this.state = 'idle';
    this.mode = 'freewalk';
    this.challenge = null;
    this.events = {};                 // name -> fn
    this.autoPilot = true;            // menu backdrop walks itself
    this.paused = false;
    this.clock = new THREE.Clock();
    this.tmpV = new THREE.Vector3();
    this.locationId = store.player.lastLocation || 'summit';
    this.focus = 3;
    this._scratchA = new THREE.Vector3();
    this._scratchB = new THREE.Vector3();
    this._scratchC = new THREE.Vector3();

    this._initRenderer();
    this._initSceneObjects();

    this.input = new InputController();
    this.input.onStep = () => this.requestStep();
    this.input.onSit = () => this.toggleSit();
    this.input.onTurn = () => this.requestTurn();

    this.setLocation(this.locationId, true);

    window.addEventListener('resize', () => this.resize());
    this.resize();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  on (name, fn) { this.events[name] = fn; return this; }
  emit (name, payload) { if (this.events[name]) this.events[name](payload); }

  /* ================= setup ================= */
  _initRenderer () {
    const q = QUALITY[store.settings.quality] || QUALITY.medium;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: q.aa, powerPreference: 'high-performance', alpha: false
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 6000);
    this.camera.position.set(0, 2, 6);
  }

  applyQuality () {
    const q = QUALITY[store.settings.quality] || QUALITY.medium;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr));
    this.resize();
  }

  _initSceneObjects () {
    // --- the webbing: a flat ribbon updated every frame ---
    this.NODES = 48;
    const g = new THREE.BufferGeometry();
    const verts = new Float32Array(this.NODES * 2 * 3);
    const idx = [];
    for (let i = 0; i < this.NODES - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    g.setIndex(idx);
    this.lineGeo = g;
    this.lineMat = new THREE.MeshLambertMaterial({
      color: new THREE.Color(store.player.appearance.line), side: THREE.DoubleSide,
      emissive: new THREE.Color(store.player.appearance.line), emissiveIntensity: 0.12
    });
    this.lineMesh = new THREE.Mesh(g, this.lineMat);
    this.lineMesh.frustumCulled = false;
    this.scene.add(this.lineMesh);

    // --- leash from harness to the line ---
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
    this.leash = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xd8d2c8, transparent: true, opacity: 0.85 }));
    this.leash.frustumCulled = false;
    this.scene.add(this.leash);

    // --- anchors ---
    this.anchors = new THREE.Group();
    this.scene.add(this.anchors);
    // Anchor posts run from the webbing down into the rock below the rim.
    const aGeo = new THREE.CylinderGeometry(0.13, 0.17, 3.4, 8);
    const aMat = new THREE.MeshLambertMaterial({ color: 0x5f574b });
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(aGeo, aMat);
      this.anchors.add(m);
    }

    // --- walker ---
    this.character = new Character(store.player.appearance);
    this.scene.add(this.character.root);

    // If a rigged human has been dropped into assets/, use it. Absent that,
    // the procedural walker stays. Either way the game starts immediately.
    tryLoadWalker().then(gltf => {
      if (gltf && this.character.adoptModel(gltf)) {
        this.emit('toast', 'Rigged walker loaded');
      }
    });

    this.balance = new BalanceModel();
  }

  /* ================= location ================= */
  setLocation (id, silent) {
    const def = LOCATION_BY_ID[id] || LOCATION_BY_ID.summit;
    this.locationId = def.id;
    this.def = def;
    store.player.lastLocation = def.id;
    store.save();

    if (this.env) this.env.dispose();
    this.env = new Environment(this.scene, def, store.settings.quality);

    this.line = new LinePhysics({ nodes: this.NODES, length: def.lineLength, sag: def.sag });
    const diffScale = { calm: 0.6, standard: 1, exposed: 1.45 }[store.settings.difficulty] || 1;
    this.wind = new Wind(def, diffScale);
    this.noiseScale = { calm: 0.7, standard: 1, exposed: 1.3 }[store.settings.difficulty] || 1;

    const half = def.lineLength / 2;
    this.anchors.children[0].position.set(0, -1.6, half);
    this.anchors.children[1].position.set(0, -1.6, -half);

    this.resetWalker();
    if (this.state === 'idle') this.walkPos = def.lineLength * 0.45;   // nicer menu framing
    if (!silent) this.emit('location', def);
  }

  /** Put the walker back on the near anchor, fresh run. */
  resetWalker () {
    this.walkPos = 1.2;               // metres from the near anchor
    this.dir = 1;                     // +1 walks toward the far cliff (-Z)
    this.distance = 0;
    this.runSteps = 0;
    this.crossed = false;
    this._anchorLock = false;
    this.windTime = 0;
    this.balance.reset();
    this.breath = 1;
    this.sitTimer = 0;
    this.fallVel = new THREE.Vector3();
    this.fallAnchor = new THREE.Vector3();
    this.hangTimer = 0;
    this.character.standUp();
    this.character.root.rotation.y = 0;
    this.character.root.position.set(0, 0, this.def.lineLength / 2 - this.walkPos);
    this.leash.visible = true;
    if (this.state !== 'idle') this.state = 'play';
  }

  /* ================= session control ================= */
  startRun (mode, challenge) {
    this.bankRun();                 // restarting banks whatever you just walked
    this.mode = mode || 'freewalk';
    this.challenge = challenge || null;
    this.autoPilot = false;
    this.focus = 3;
    this.sessionBest = 0;
    store.loc(this.locationId).visits++;
    store.save();
    this.clearChallengeFlag();
    this.resetWalker();
    this.state = 'play';
    this.input.setEnabled(true);
    audio.init();
    this.emit('run-start', { mode: this.mode, challenge: this.challenge });
  }

  toMenu () {
    this.bankRun();                 // walking away still counts
    this.state = 'idle';
    this.autoPilot = true;
    this.input.setEnabled(false);
    this.resetWalker();
    this.state = 'idle';
    this.walkPos = this.def.lineLength * 0.45;
    this.menuAngle = 0.5;
  }

  setPaused (v) {
    this.paused = v;
    this.input.setEnabled(!v && this.state === 'play');
    if (v) audio.suspend(); else audio.resume();
  }

  /* ================= player actions ================= */
  requestStep () {
    if (this.state !== 'play' || this.paused) return;
    if (this.character.state === 'sit') { this.toggleSit(); return; }
    if (this.input.steady) return;                    // you cannot step mid-breath
    if (!this.character.startStep()) return;
    this.balance.applyStep(1);
    this.runSteps++;
    this.pendingStepMove = STEP_LENGTH;
    audio.footstep();
    this.haptic(8);
  }

  toggleSit () {
    if (this.state !== 'play' || this.paused) return;
    if (!store.player.unlockedTricks.includes('sit')) return;
    if (this.character.state === 'sit') {
      this.character.setSitting(false);
    } else if (this.character.state === 'stand' && Math.abs(this.balance.tilt) < 0.45) {
      this.character.setSitting(true);
      this.balance.applyTrick(0.7);
      this.sitTimer = 0;
      audio.breathe();
    }
  }

  /** Turning on the line is shelved for now — kept as a no-op hook. */
  requestTurn () { /* removed: see README */ }

  haptic (ms) {
    if (!store.settings.haptics) return;
    if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} }
  }

  /* ================= helpers ================= */
  get lineT () { return clamp(this.walkPos / this.def.lineLength, 0, 1); }

  worldZAt (metres) { return this.def.lineLength / 2 - metres; }

  /* ================= main loop ================= */
  /**
   * Fixed-timestep loop. The balance model is stiff enough that a variable
   * dt changes how the game *feels* between devices, so physics always runs
   * in 1/50 s steps and a slow frame simply runs a few of them. Capped at 5
   * so a backgrounded tab cannot fire off a minute of simulation at once.
   */
  _loop () {
    requestAnimationFrame(this._loop);
    const frame = Math.min(this.clock.getDelta(), 0.25);
    if (this.paused) { this.renderer.render(this.scene, this.camera); return; }

    const STEP = 1 / 50;
    this._acc = (this._acc || 0) + frame;
    let n = 0;
    while (this._acc >= STEP && n < 5) { this.update(STEP); this._acc -= STEP; n++; }
    if (n === 5) this._acc = 0;                 // give up on the backlog

    this.renderer.render(this.scene, this.camera);
  }

  update (dt) {
    const def = this.def;

    /* ---- wind ---- */
    this.wind.update(dt);
    audio.updateWind(this.wind.speed, this.wind.warning);
    this.env.update(dt, this.wind.lateral, this.wind.speed);

    /* ---- input ---- */
    this.input.update(dt);
    let lean = this.input.lean;
    let steady = this.input.steady;

    if (this.autoPilot) {
      // menu backdrop: a competent invisible walker keeps their feet
      lean = clamp(-(this.balance.tilt * 2.6 + this.balance.tiltVel * 0.45), -1, 1);
      steady = false;
    }

    /* ---- breath ---- */
    if (steady && this.breath > 0 && this.state === 'play') {
      this.breath = clamp(this.breath - dt * 0.34, 0, 1);
      if (this.breath <= 0) steady = false;
    } else {
      this.breath = clamp(this.breath + dt * 0.16, 0, 1);
      if (this.breath < 0.22) steady = false;
    }
    const sitting = this.character.state === 'sit';
    if (sitting) steady = true;

    /* ---- balance ---- */
    if (this.state === 'play') {
      const sample = this.line.sample(this.lineT);
      const lineAccel = (sample.vx - (this.prevLineVx || 0)) / Math.max(dt, 1e-4);
      this.prevLineVx = sample.vx;

      const facingSign = this.dir;   // input is always screen-relative
      const res = this.balance.update(dt, {
        input: lean * facingSign,
        wind: this.wind.lateral * (sitting ? 0.35 : 1) * facingSign,
        lineAccel: lineAccel * facingSign,
        steady,
        sensitivity: store.settings.sensitivity,
        noiseScale: this.noiseScale * (sitting ? 0.45 : 1)
      });

      if (res === 'fall') this._beginFall();

      // wobble feedback near the edge
      const dgr = this.balance.danger;
      if (dgr > 0.72 && !this._wobbleCooldown) {
        audio.wobble(dgr);
        this.haptic(dgr > 0.88 ? 24 : 10);
        this._wobbleCooldown = 0.45;
      }
      if (this._wobbleCooldown > 0) this._wobbleCooldown -= dt;
    } else if (this.state === 'idle') {
      const sample = this.line.sample(this.lineT);
      this.balance.update(dt, {
        input: lean, wind: this.wind.lateral * 0.6, lineAccel: 0,
        steady: false, sensitivity: 1, noiseScale: 0.55
      });
      if (Math.abs(this.balance.tilt) > 0.95) this.balance.reset();
      this.prevLineVx = sample.vx;
    }

    /* ---- character animation + step travel ---- */
    const slope = clamp(this.line.slope(this.lineT) * this.dir, -0.6, 0.6);
    const anim = this.character.update(dt, {
      tilt: this.balance.tilt,
      tiltVel: this.balance.tiltVel,
      arm: this.balance.arm,
      armVel: this.balance.armVel,
      atLimit: this.balance.atLimit,
      danger: this.balance.danger,
      lineSlope: slope,
      windLateral: this.wind.lateral
    });

    if (this.character.state === 'step' && this.pendingStepMove) {
      const move = Math.min(this.pendingStepMove, STEP_LENGTH * dt / 0.52);
      this.pendingStepMove -= move;
      this._advance(move);
    }
    if (anim.footPlant) {
      // the weight transfer is what actually kicks the webbing
      this.line.addImpulseSpread(this.lineT, 2.2 * Math.sign(this.balance.tilt || 1), -6.5, 10);
      audio.footstep();
    }
    /* ---- sitting counts as a landed trick after a couple of seconds ---- */
    if (sitting && this.state === 'play') {
      this.sitTimer += dt;
      if (this.sitTimer > 2 && !this._sitCredited) {
        this._sitCredited = true;
        store.player.tricksLanded++; store.save();
        this.emit('trick', 'Sit');
      }
    } else { this.sitTimer = 0; this._sitCredited = false; }

    /* ---- webbing ---- */
    if (this.state === 'play' || this.state === 'idle') {
      const load = sitting ? 190 : 150;
      this.line.addForce(this.lineT, this.balance.tilt * 62, -load);
    }
    if (this.state === 'hanging' || this.state === 'falling') {
      this.line.addForce(this.fallT || 0.5, 0, this.state === 'hanging' ? -110 : 0);
    }
    this.line.update(dt);
    this._updateLineMesh();

    /* ---- placement ---- */
    if (this.state === 'play' || this.state === 'idle') this._placeOnLine();
    else if (this.state === 'falling') this._updateFall(dt);
    else if (this.state === 'hanging') this._updateHang(dt);

    this._updateLeash();
    this._updateCamera(dt);

    /* ---- objectives ---- */
    if (this.state === 'play') this._trackObjectives(dt);

    /* ---- HUD ---- */
    this._hudTimer = (this._hudTimer || 0) + dt;
    if (this._hudTimer > 0.08) {
      this._hudTimer = 0;
      this.emit('hud', {
        distance: this.distance,
        best: store.loc(this.locationId).best,
        altitude: this.def.lineHeight + (this.character.root.position.y || 0),
        breath: this.breath,
        focus: this.focus ?? 3,
        wind: this.wind.speed,
        windDir: this.wind.dirDeg,
        warning: this.wind.warning,
        danger: this.balance.danger,
        steady
      });
    }
  }

  /** Move along the webbing, handling anchors and distance bookkeeping. */
  _advance (metres) {
    const len = this.def.lineLength;
    this.walkPos += metres * this.dir;
    this.distance += metres;

    if (this.walkPos > len - 1.0) {
      this.walkPos = len - 1.0;
      this._anchorReached();
    } else if (this.walkPos < 0.9) {
      this.walkPos = 0.9;
      this._anchorReached();
    }
  }

  /** Touching the far rock ends the run as a completed crossing. */
  _anchorReached () {
    if (this._anchorLock || this.state !== 'play') return;
    this._anchorLock = true;
    this.character.state = 'stand';
    this.crossed = true;
    audio.chime();
    this.haptic([20, 60, 20]);
    this.input.setEnabled(false);
    this.state = 'result';
    const { metres, record } = this.bankRun();
    this.emit('crossed', { distance: metres, record, focusLeft: this.focus ?? 3 });
  }

  _placeOnLine () {
    const t = this.lineT;
    const s = this.line.sample(t);
    const c = this.character.root;
    c.position.set(s.x, s.y, this.worldZAt(this.walkPos));
    c.rotation.y = this.dir > 0 ? 0 : Math.PI;
  }

  /* ================= falling ================= */
  _beginFall () {
    this.state = 'falling';
    this.fallT = this.lineT;
    const s = this.line.sample(this.fallT);
    this.fallAnchor.set(s.x, s.y, this.worldZAt(this.walkPos));
    const side = Math.sign(this.balance.tilt || 1);
    this.fallVel.set(side * (1.4 + Math.random() * 0.6), 0.4, -this.dir * 0.5);
    this.character.startFall();
    this.character.root.rotation.z = 0;
    this.input.setEnabled(false);
    this.line.addImpulseSpread(this.fallT, side * 6, 7, 12);
    audio.fall();
    this.haptic([18, 40, 22]);
    store.recordFall();
    this.emit('falling');
  }

  _updateFall (dt) {
    const c = this.character.root;
    this.fallVel.y -= G * dt;
    this.fallVel.x += this.wind.lateral * 0.6 * dt;
    c.position.addScaledVector(this.fallVel, dt);
    c.rotation.z += dt * 2.2 * Math.sign(this.fallVel.x || 1);
    c.rotation.x += dt * 1.1;

    const d = this.tmpV.copy(c.position).sub(this.fallAnchor).length();
    if (d >= LEASH_LENGTH) {
      // leash goes tight: kill most of the energy, keep a swing
      const dirv = this.tmpV.copy(c.position).sub(this.fallAnchor).normalize();
      c.position.copy(this.fallAnchor).addScaledVector(dirv, LEASH_LENGTH);
      const radial = dirv.dot(this.fallVel);
      this.fallVel.addScaledVector(dirv, -radial * 1.35);
      this.fallVel.multiplyScalar(0.42);
      this.state = 'hanging';
      this.hangTimer = 0;
      this.character.startHang();
      this.line.addImpulseSpread(this.fallT, this.fallVel.x * 1.2, -16, 14);
      audio.catchRope();
      this.haptic(45);
    }
  }

  _updateHang (dt) {
    const c = this.character.root;
    this.hangTimer += dt;
    // pendulum around the anchor point
    const radial = this._scratchA.copy(c.position).sub(this.fallAnchor).normalize();
    // gravity minus its radial component = the swing
    const tangential = this._scratchB.set(0, -G, 0);
    tangential.addScaledVector(radial, -tangential.dot(radial));
    this.fallVel.addScaledVector(tangential, dt);
    this.fallVel.addScaledVector(this.fallVel, -dt * 1.1);          // air + rope drag
    c.position.addScaledVector(this.fallVel, dt);
    // re-project onto the rope sphere
    const rel2 = this._scratchC.copy(c.position).sub(this.fallAnchor).normalize();
    c.position.copy(this.fallAnchor).addScaledVector(rel2, LEASH_LENGTH);
    c.rotation.z = lerp(c.rotation.z, rel2.x * 0.6, clamp(dt * 3, 0, 1));
    c.rotation.x = lerp(c.rotation.x, 0.1, clamp(dt * 3, 0, 1));

    if (this.hangTimer > 1.9 && this.state === 'hanging') {
      this.state = 'result';
      this._finishRun();
    }
  }

  /**
   * Commit the current walk to the save. Called when a run ends for any
   * reason — a fall, a restart, or simply leaving the line — so distance
   * is never silently lost.
   * @returns {{metres:number, record:boolean}}
   */
  bankRun () {
    const metres = Math.floor(this.distance);
    let record = false;
    if (metres >= 1) {
      record = store.recordWalk(this.locationId, metres, this.runSteps);
      this.emit('banked', { metres, record });
    }
    this.distance = 0;
    this.runSteps = 0;
    return { metres, record };
  }

  _finishRun () {
    const { metres, record } = this.bankRun();
    this.focus = Math.max(0, (this.focus ?? 3) - 1);
    this.emit('fell', {
      distance: metres,
      record,
      focusLeft: this.focus,
      challenge: this.challenge
    });
  }

  /** Climb back on after a fall. */
  recover () {
    if (this.focus <= 0) this.focus = 3;
    this.resetWalker();
    this.state = 'play';
    this.input.setEnabled(true);
    audio.chime();
  }

  /* ================= objectives ================= */
  _trackObjectives (dt) {
    if (this.wind.speed > 20) this.windTime += dt; else this.windTime = Math.max(0, this.windTime - dt * 0.5);
    if (this.distance > this.sessionBest) this.sessionBest = this.distance;

    if (!this.challenge) return;
    const c = this.challenge;
    let value = 0;
    if (c.type === 'distance') value = this.distance;
    else if (c.type === 'windTime') value = this.windTime;
    else if (c.type === 'crossing') value = this.crossed ? 1 : 0;

    this.emit('objective', { challenge: c, value });

    if (value >= c.target && !this._challengeDone) {
      this._challengeDone = true;
      const first = store.completeChallenge(c.id, Math.floor(value));
      audio.chime();
      this.emit('challenge-complete', { challenge: c, first, value: Math.floor(value) });
    }
  }

  clearChallengeFlag () { this._challengeDone = false; }

  /* ================= rendering helpers ================= */
  _updateLineMesh () {
    const pos = this.lineGeo.attributes.position;
    const n = this.NODES, len = this.def.lineLength, half = len / 2;
    const w = 0.028;
    for (let i = 0; i < n; i++) {
      const z = half - (i / (n - 1)) * len;
      const x = this.line.x[i], y = this.line.y[i];
      pos.setXYZ(i * 2, x - w, y, z);
      pos.setXYZ(i * 2 + 1, x + w, y, z);
    }
    pos.needsUpdate = true;
    this.lineGeo.computeVertexNormals();
  }

  _updateLeash () {
    const p = this.leash.geometry.attributes.position;
    const h = this.character.harnessWorld(this._scratchA);
    let ax, ay, az;
    if (this.state === 'falling' || this.state === 'hanging') {
      ax = this.fallAnchor.x; ay = this.fallAnchor.y; az = this.fallAnchor.z;
    } else {
      const s = this.line.sample(this.lineT);
      ax = s.x; ay = s.y; az = this.worldZAt(this.walkPos);
    }
    p.setXYZ(0, h.x, h.y, h.z);
    p.setXYZ(1, ax, ay, az);
    p.needsUpdate = true;
    this.leash.geometry.computeBoundingSphere();
  }

  _updateCamera (dt) {
    const c = this.camera;
    const target = this.character.root.position;
    const sway = store.settings.cameraSway;
    const swayScale = sway === 'off' ? 0 : sway === 'full' ? 1 : 0.5;

    if (this.state === 'idle') {
      // Menu drift: stay behind the walker and keep the far anchor (and the
      // sun) in frame. A full orbit would swing the camera into the near
      // cliff, which is the last thing the title screen should show.
      this.menuAngle = (this.menuAngle || 0) + dt * 0.055;
      const arc = 0.5 + Math.sin(this.menuAngle) * 0.30;        // swung off-axis, drifting
      const r = 6.8 + Math.sin(this.menuAngle * 0.6) * 0.9;
      c.position.set(
        target.x + Math.sin(arc) * r,
        target.y + 2.6 + Math.sin(this.menuAngle * 0.43) * 0.35,
        target.z + Math.cos(arc) * r
      );
      c.lookAt(target.x * 0.5, target.y + 0.2, target.z - 30);   // down the line
      c.rotation.z = 0;
      return;
    }

    const danger = this.balance.danger;
    const behind = this.dir > 0 ? 1 : -1;
    // Sit higher and look down the line rather than along it: the drop is the
    // whole point, and a camera at walker height cannot see any of it.
    let dist = 5.4 - danger * 1.2;
    let height = 2.55 + danger * 0.15;

    if (this.state === 'falling' || this.state === 'hanging' || this.state === 'result') {
      dist = 6.2; height = 1.2;
    }

    // Yaw the camera off the line's axis. Looking straight down the webbing
    // puts the far anchor wall dead centre and backlit — a black slab. Swung
    // round, the gorge itself opens along the frame: cloud sea, both rims
    // converging, ranges beyond. It is how every highline photograph is
    // composed, and it costs nothing.
    const YAW = 0.42;                                  // ~24 degrees
    const desired = this.tmpV.set(
      target.x * 0.55 + Math.sin(YAW) * dist * behind,
      target.y + height,
      target.z + Math.cos(YAW) * dist * behind
    );
    c.position.lerp(desired, clamp(dt * 3.2, 0, 1));

    const look = this._look || (this._look = new THREE.Vector3(target.x, target.y + 1.1, target.z - behind * 2.5));
    this._scratchB.set(
      target.x * 0.7 - Math.sin(0.42) * 5 * behind,
      target.y - 1.15,
      target.z - Math.cos(0.42) * 7.5 * behind
    );
    look.lerp(this._scratchB, clamp(dt * 4, 0, 1));
    c.lookAt(look);

    // a touch of roll and breathing FOV sells the exposure without nausea
    c.rotation.z += this.balance.tilt * 0.055 * swayScale;
    const targetFov = this.baseFov + danger * 4 * swayScale;
    c.fov = lerp(c.fov, targetFov, clamp(dt * 2, 0, 1));
    c.updateProjectionMatrix();
  }

  /* ================= misc ================= */
  refreshAppearance () {
    const a = store.player.appearance;
    this.character.setAppearance(a);
    this.lineMat.color.set(a.line);
    this.lineMat.emissive.set(a.line);
  }

  resize () {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    const portrait = h > w;
    this.baseFov = portrait ? 70 : 58;
    this.camera.fov = this.baseFov;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
