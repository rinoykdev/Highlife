/* =========================================================
   character.js — the walker.

   No skinning, no imported model: a small hierarchy of
   primitives driven procedurally. Everything the player
   reads about their balance comes from this rig, so the
   lean, the arm counterweight and the foot shuffle matter
   far more than the polygon count.
   ========================================================= */

import * as THREE from '../lib/three.module.min.js';
import { clamp, lerp } from './physics.js';

const MAX_LEAN = 0.72;      // radians at full tilt — past this you are gone

export class Character {
  constructor (appearance) {
    this.root = new THREE.Group();          // world placement + facing
    this.lean = new THREE.Group();          // balance roll
    this.root.add(this.lean);

    this.mats = {
      skin:  new THREE.MeshLambertMaterial({ color: 0xc79a76 }),
      shirt: new THREE.MeshLambertMaterial({ color: new THREE.Color(appearance.shirt) }),
      pants: new THREE.MeshLambertMaterial({ color: new THREE.Color(appearance.pants) }),
      dark:  new THREE.MeshLambertMaterial({ color: 0x22201e }),
      hair:  new THREE.MeshLambertMaterial({ color: 0x33261d })
    };

    this._build();

    this.state = 'stand';
    this.stepPhase = 0;
    this.stepFoot = 1;        // 1 = right foot leads next
    this.turnPhase = 0;
    this.sitAmount = 0;
    this.fallTime = 0;
    this.armWave = 0;
    this.t = Math.random() * 10;
  }

  _mesh (geo, mat, parent, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  _build () {
    const M = this.mats;
    const G = (g) => g;   // geometry passthrough, kept for readability

    // --- pelvis is the anchor of the whole body ---
    this.pelvis = new THREE.Group();
    this.pelvis.position.y = 0.93;
    this.lean.add(this.pelvis);

    this._mesh(G(new THREE.CapsuleGeometry(0.115, 0.10, 3, 8)), M.pants, this.pelvis, 0, 0, 0);

    // --- torso ---
    this.torso = new THREE.Group();
    this.torso.position.y = 0.08;
    this.pelvis.add(this.torso);
    this._mesh(G(new THREE.CapsuleGeometry(0.135, 0.34, 4, 10)), M.shirt, this.torso, 0, 0.24, 0);

    // harness: a band plus two leg loops, the reason a fall is survivable
    this.harness = this._mesh(G(new THREE.CylinderGeometry(0.15, 0.155, 0.075, 12, 1, true)), M.dark, this.pelvis, 0, 0.01, 0);
    this.harness.material = new THREE.MeshLambertMaterial({ color: 0x2b2f36, side: THREE.DoubleSide });

    // --- head ---
    this.neck = new THREE.Group();
    this.neck.position.y = 0.47;
    this.torso.add(this.neck);
    this._mesh(G(new THREE.SphereGeometry(0.115, 12, 10)), M.skin, this.neck, 0, 0.10, 0);
    this._mesh(G(new THREE.SphereGeometry(0.062, 8, 8)), M.hair, this.neck, 0, 0.19, -0.055);

    // --- arms (the balance poles) ---
    this.armL = this._arm(-1);
    this.armR = this._arm(1);

    // --- legs ---
    this.legL = this._leg(-1);
    this.legR = this._leg(1);

    this.root.rotation.y = 0;   // facing -Z
  }

  _arm (side) {
    const M = this.mats;
    const shoulder = new THREE.Group();
    shoulder.position.set(0.145 * side, 0.42, 0);
    this.torso.add(shoulder);

    const upper = new THREE.Group();
    shoulder.add(upper);
    this._mesh(new THREE.CapsuleGeometry(0.045, 0.22, 3, 7), M.shirt, upper, 0.145 * side, 0, 0);
    upper.children[0].rotation.z = Math.PI / 2;

    const elbow = new THREE.Group();
    elbow.position.set(0.30 * side, 0, 0);
    upper.add(elbow);
    const fore = this._mesh(new THREE.CapsuleGeometry(0.038, 0.24, 3, 7), M.skin, elbow, 0.145 * side, 0, 0);
    fore.rotation.z = Math.PI / 2;
    this._mesh(new THREE.SphereGeometry(0.045, 7, 6), M.skin, elbow, 0.30 * side, 0, 0);

    return { shoulder, upper, elbow, side };
  }

  _leg (side) {
    const M = this.mats;
    const hip = new THREE.Group();
    hip.position.set(0.075 * side, -0.06, 0);
    this.pelvis.add(hip);

    const thigh = new THREE.Group();
    hip.add(thigh);
    this._mesh(new THREE.CapsuleGeometry(0.058, 0.34, 3, 7), M.pants, thigh, 0, -0.20, 0);

    const knee = new THREE.Group();
    knee.position.y = -0.40;
    thigh.add(knee);
    this._mesh(new THREE.CapsuleGeometry(0.048, 0.32, 3, 7), M.pants, knee, 0, -0.19, 0);

    const ankle = new THREE.Group();
    ankle.position.y = -0.38;
    knee.add(ankle);
    const foot = this._mesh(new THREE.BoxGeometry(0.075, 0.045, 0.24), M.dark, ankle, 0, -0.03, 0.03);

    return { hip, thigh, knee, ankle, foot, side };
  }

  setAppearance (a) {
    this.mats.shirt.color.set(a.shirt);
    this.mats.pants.color.set(a.pants);
  }

  /* ---------- gameplay hooks ---------- */
  startStep () {
    if (this.state !== 'stand') return false;
    this.state = 'step';
    this.stepPhase = 0;
    this.stepFoot *= -1;
    return true;
  }

  startTurn () {
    if (this.state !== 'stand') return false;
    this.state = 'turn';
    this.turnPhase = 0;
    return true;
  }

  setSitting (on) {
    if (on && this.state === 'stand') this.state = 'sit';
    else if (!on && this.state === 'sit') this.state = 'stand';
  }

  startFall () { this.state = 'fall'; this.fallTime = 0; }
  startHang () { this.state = 'hang'; }
  standUp () {
    this.state = 'stand';
    this.stepPhase = 0; this.sitAmount = 0; this.fallTime = 0;
    this.lean.rotation.set(0, 0, 0);
    this.lean.position.set(0, 0, 0);
  }

  /* ---------- per-frame ---------- */
  /**
   * @param {number} dt
   * @param {object} s  { tilt, tiltVel, danger, lineSlope, stepping, windLateral }
   * @returns {object}  { stepCompleted:boolean, footPlant:boolean }
   */
  update (dt, s) {
    this.t += dt;
    const out = { stepCompleted: false, footPlant: false };
    const tilt = clamp(s.tilt, -1, 1);
    const breath = Math.sin(this.t * 1.5) * 0.012;

    /* ---- body roll: the primary readout of balance ---- */
    if (this.state !== 'fall' && this.state !== 'hang') {
      const target = -tilt * MAX_LEAN;
      this.lean.rotation.z = lerp(this.lean.rotation.z, target, clamp(dt * 16, 0, 1));
      // hips shift the opposite way — a real walker counterweights, not just rotates
      this.lean.position.x = lerp(this.lean.position.x, tilt * 0.055, clamp(dt * 12, 0, 1));
      this.lean.rotation.x = lerp(this.lean.rotation.x, Math.atan(s.lineSlope) * 0.55, clamp(dt * 8, 0, 1));
    }

    /* ---- arms: counterweight, faster and wider the closer to the edge ---- */
    this.armWave = lerp(this.armWave, Math.abs(s.tiltVel) * 0.9 + s.danger * 0.7, clamp(dt * 8, 0, 1));
    const flap = Math.sin(this.t * (5 + this.armWave * 7)) * this.armWave * 0.28;
    // rotation.z is signed by side: positive raise = arm above horizontal
    const base = -0.12 + s.danger * 0.38 + (this.state === 'step' ? 0.06 : 0);
    for (const arm of [this.armL, this.armR]) {
      const sd = arm.side;
      // the arm on the side you are toppling toward comes up hardest
      const rise = clamp(-tilt * sd, -1, 1) * 0.5;
      arm.shoulder.rotation.z = sd * (base + rise + flap);
      arm.shoulder.rotation.x = Math.sin(this.t * 1.1 + sd) * 0.05 - s.danger * 0.12;
      arm.upper.rotation.y = -sd * (0.15 + this.armWave * 0.15);
      arm.elbow.rotation.y = sd * (0.1 + Math.abs(tilt) * 0.35);
      arm.elbow.rotation.z = -sd * (0.12 + this.armWave * 0.2);
    }

    /* ---- torso ---- */
    this.torso.rotation.z = tilt * 0.16;
    this.torso.rotation.x = -0.04 + breath + (this.state === 'sit' ? 0.12 : 0);
    this.neck.rotation.z = -tilt * 0.22;
    this.neck.rotation.x = 0.06 - s.danger * 0.1;

    /* ---- state machines ---- */
    switch (this.state) {
      case 'stand': this._poseStand(dt, tilt, s); break;
      case 'step':  out.stepCompleted = this._poseStep(dt, tilt, out); break;
      case 'sit':   this._poseSit(dt); break;
      case 'turn':  this._poseTurn(dt); break;
      case 'fall':  this._poseFall(dt); break;
      case 'hang':  this._poseHang(dt); break;
    }
    return out;
  }

  _poseStand (dt, tilt, s) {
    this.sitAmount = lerp(this.sitAmount, 0, clamp(dt * 6, 0, 1));
    const crouch = Math.abs(tilt) * 0.22 + this.sitAmount;
    const micro = Math.sin(this.t * 2.2) * 0.02;

    // front / back foot stance along the line
    const lead = this.stepFoot;
    for (const leg of [this.legL, this.legR]) {
      const isLead = leg.side === lead;
      const z = isLead ? -0.15 : 0.17;
      leg.hip.position.z = lerp(leg.hip.position.z, z, clamp(dt * 10, 0, 1));
      leg.hip.position.x = lerp(leg.hip.position.x, 0.028 * leg.side, clamp(dt * 10, 0, 1));
      leg.thigh.rotation.x = lerp(leg.thigh.rotation.x, (isLead ? 0.16 : -0.14) + crouch * 0.5 + micro, clamp(dt * 10, 0, 1));
      leg.knee.rotation.x = lerp(leg.knee.rotation.x, 0.12 + crouch * 0.9, clamp(dt * 10, 0, 1));
      leg.ankle.rotation.x = lerp(leg.ankle.rotation.x, -(leg.thigh.rotation.x + leg.knee.rotation.x) * 0.75, clamp(dt * 10, 0, 1));
      leg.ankle.rotation.z = lerp(leg.ankle.rotation.z, tilt * 0.35, clamp(dt * 10, 0, 1));
    }
    this.pelvis.position.y = lerp(this.pelvis.position.y, 0.93 - crouch * 0.12, clamp(dt * 8, 0, 1));
  }

  _poseStep (dt, tilt, out) {
    const DUR = 0.52;
    const prev = this.stepPhase;
    this.stepPhase += dt / DUR;
    const p = clamp(this.stepPhase, 0, 1);
    const swing = this.stepFoot;

    for (const leg of [this.legL, this.legR]) {
      const isSwing = leg.side === swing;
      if (isSwing) {
        const lift = Math.sin(p * Math.PI);
        leg.hip.position.z = lerp(0.17, -0.15, p);
        leg.hip.position.y = -0.06 + lift * 0.07;
        leg.thigh.rotation.x = lerp(-0.14, 0.16, p) - lift * 0.35;
        leg.knee.rotation.x = 0.12 + lift * 1.0;
        leg.ankle.rotation.x = -leg.thigh.rotation.x * 0.6 + lift * 0.2;
      } else {
        leg.hip.position.z = lerp(-0.15, 0.17, p * 0.55);
        leg.hip.position.y = -0.06;
        leg.thigh.rotation.x = lerp(0.16, -0.05, p);
        leg.knee.rotation.x = 0.2 + Math.sin(p * Math.PI) * 0.18;
        leg.ankle.rotation.x = -(leg.thigh.rotation.x + leg.knee.rotation.x) * 0.7;
      }
      leg.ankle.rotation.z = tilt * 0.35;
    }
    this.pelvis.position.y = 0.93 - Math.sin(p * Math.PI) * 0.035;

    if (prev < 0.5 && this.stepPhase >= 0.5) out.footPlant = true;
    if (this.stepPhase >= 1) {
      this.state = 'stand';
      this.stepPhase = 0;
      return true;
    }
    return false;
  }

  _poseSit (dt) {
    this.sitAmount = lerp(this.sitAmount, 1, clamp(dt * 4, 0, 1));
    const a = this.sitAmount;
    this.pelvis.position.y = lerp(0.93, 0.30, a);
    for (const leg of [this.legL, this.legR]) {
      leg.hip.position.z = lerp(leg.hip.position.z, leg.side * 0.02, clamp(dt * 6, 0, 1));
      leg.thigh.rotation.x = lerp(leg.thigh.rotation.x, -1.15 * a, clamp(dt * 6, 0, 1));
      leg.knee.rotation.x = lerp(leg.knee.rotation.x, 1.35 * a, clamp(dt * 6, 0, 1));
      leg.ankle.rotation.x = lerp(leg.ankle.rotation.x, -0.2 * a, clamp(dt * 6, 0, 1));
    }
  }

  /** 180 on the line: pivot on the balls of the feet over ~0.9 s. */
  _poseTurn (dt) {
    const DUR = 0.9;
    this.turnPhase += dt / DUR;
    const p = clamp(this.turnPhase, 0, 1);
    const e = p * p * (3 - 2 * p);
    this.lean.rotation.y = e * Math.PI;
    this.pelvis.position.y = 0.93 - Math.sin(p * Math.PI) * 0.09;
    for (const leg of [this.legL, this.legR]) {
      const lift = Math.sin(p * Math.PI) * (leg.side === this.stepFoot ? 1 : 0.4);
      leg.thigh.rotation.x = 0.1 - lift * 0.25;
      leg.knee.rotation.x = 0.15 + lift * 0.7;
      leg.hip.position.z = lerp(leg.hip.position.z, 0.02 * leg.side, clamp(dt * 6, 0, 1));
    }
    if (p >= 1) {
      // bake the turn into the root so lean.y goes back to zero
      this.lean.rotation.y = 0;
      this.root.rotation.y += Math.PI;
      this.state = 'stand';
      this.turnPhase = 0;
      return true;
    }
    return false;
  }

  _poseFall (dt) {
    this.fallTime += dt;
    const f = clamp(this.fallTime * 1.6, 0, 1);
    // limbs windmill, then give up
    const w = Math.sin(this.fallTime * 11) * (1 - f * 0.6);
    for (const arm of [this.armL, this.armR]) {
      arm.shoulder.rotation.z = arm.side * (1.6 + w * 0.5);
      arm.shoulder.rotation.x = -0.6 + w * 0.8;
      arm.elbow.rotation.y = arm.side * 0.5;
    }
    for (const leg of [this.legL, this.legR]) {
      leg.thigh.rotation.x = -0.5 + w * 0.5 * leg.side;
      leg.knee.rotation.x = 0.7 + Math.abs(w) * 0.5;
      leg.hip.position.z = 0;
    }
    this.torso.rotation.x = -0.35 * f;
    this.pelvis.position.y = 0.93;
  }

  _poseHang (dt) {
    // caught by the leash: legs down, one hand reaching for the line
    const sway = Math.sin(this.t * 1.7) * 0.08;
    for (const leg of [this.legL, this.legR]) {
      leg.thigh.rotation.x = lerp(leg.thigh.rotation.x, -0.15 + sway * 0.4, clamp(dt * 4, 0, 1));
      leg.knee.rotation.x = lerp(leg.knee.rotation.x, 0.35, clamp(dt * 4, 0, 1));
    }
    this.armL.shoulder.rotation.z = lerp(this.armL.shoulder.rotation.z, -2.5, clamp(dt * 4, 0, 1));
    this.armR.shoulder.rotation.z = lerp(this.armR.shoulder.rotation.z, 2.5, clamp(dt * 4, 0, 1));
    this.torso.rotation.x = lerp(this.torso.rotation.x, 0.25 + sway * 0.3, clamp(dt * 4, 0, 1));
  }

  /** World position of the harness loop — where the leash attaches. */
  harnessWorld (target) {
    this.pelvis.updateWorldMatrix(true, false);
    return target.setFromMatrixPosition(this.pelvis.matrixWorld);
  }

  dispose () {
    this.root.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    for (const k in this.mats) this.mats[k].dispose();
  }
}
