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

/* ---------------------------------------------------------
   Optional rigged human.

   Primitives will never read as a real person. If a rigged
   glTF is present at assets/walker.glb it replaces the built
   rig entirely, and the balance animation drives its bones
   instead. Mixamo's naming is assumed because it is what the
   free exports use; anything close enough is matched loosely.

   The file is deliberately optional — nothing downloads at
   runtime, and with no model present the procedural walker
   is used exactly as before. See README.
   --------------------------------------------------------- */
export const MODEL_URL = 'assets/walker.glb';

const BONE_ALIASES = {
  hips:      ['hips', 'pelvis', 'root'],
  spine:     ['spine1', 'spine_01', 'spine'],
  chest:     ['spine2', 'chest', 'upperchest', 'spine_02'],
  head:      ['head'],
  armL:      ['leftarm', 'upperarm_l', 'shoulder_l', 'leftupperarm'],
  armR:      ['rightarm', 'upperarm_r', 'shoulder_r', 'rightupperarm'],
  foreL:     ['leftforearm', 'lowerarm_l', 'leftlowerarm'],
  foreR:     ['rightforearm', 'lowerarm_r', 'rightlowerarm'],
  legL:      ['leftupleg', 'thigh_l', 'leftthigh'],
  legR:      ['rightupleg', 'thigh_r', 'rightthigh'],
  shinL:     ['leftleg', 'calf_l', 'leftcalf'],
  shinR:     ['rightleg', 'calf_r', 'rightcalf']
};

/** Loosely match a bone by name, ignoring prefixes like `mixamorig:`. */
function findBones (root) {
  const found = {};
  const norm = (n) => n.toLowerCase().replace(/^mixamorig:?/, '').replace(/[._\s-]/g, '');
  root.traverse((o) => {
    if (!o.isBone) return;
    const n = norm(o.name);
    for (const key in BONE_ALIASES) {
      if (found[key]) continue;
      if (BONE_ALIASES[key].some(a => n === a.replace(/[._\s-]/g, ''))) found[key] = o;
    }
  });
  return found;
}

/**
 * Try to load the rigged model. Resolves to null when the file is absent,
 * which is the normal case — callers fall back to the procedural rig.
 */
export async function tryLoadWalker () {
  try {
    const head = await fetch(MODEL_URL, { method: 'HEAD' });
    if (!head.ok) return null;
  } catch (e) { return null; }
  try {
    const { GLTFLoader } = await import('../lib/GLTFLoader.js');
    const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
    return gltf;
  } catch (e) {
    console.warn('[highline] walker.glb present but could not be loaded', e);
    return null;
  }
}

const MAX_LEAN = 0.72;      // radians at full tilt — past this you are gone

export class Character {
  constructor (appearance) {
    this.root = new THREE.Group();          // world placement + facing
    this.lean = new THREE.Group();          // balance roll
    this.root.add(this.lean);

    this.mats = {
      skin:  new THREE.MeshLambertMaterial({ color: 0xb98a63 }),
      shirt: new THREE.MeshLambertMaterial({ color: new THREE.Color(appearance.shirt) }),
      pants: new THREE.MeshLambertMaterial({ color: new THREE.Color(appearance.pants) }),
      dark:  new THREE.MeshLambertMaterial({ color: 0x22201e }),
      hair:  new THREE.MeshLambertMaterial({ color: 0x2a1f17 })
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

    this._mesh(G(new THREE.CapsuleGeometry(0.108, 0.09, 4, 10)), M.pants, this.pelvis, 0, 0, 0);

    // --- torso ---
    this.torso = new THREE.Group();
    this.torso.position.y = 0.08;
    this.pelvis.add(this.torso);
    // chest tapers to the waist: two capsules read far more human than one
    const chest = this._mesh(G(new THREE.CapsuleGeometry(0.132, 0.20, 5, 12)), M.shirt, this.torso, 0, 0.33, 0);
    chest.scale.set(1.18, 1, 0.74);
    const waist = this._mesh(G(new THREE.CapsuleGeometry(0.104, 0.13, 4, 10)), M.shirt, this.torso, 0, 0.15, 0);
    waist.scale.set(1.06, 1, 0.78);

    // harness: a band plus two leg loops, the reason a fall is survivable
    this.harness = this._mesh(G(new THREE.CylinderGeometry(0.15, 0.155, 0.075, 12, 1, true)), M.dark, this.pelvis, 0, 0.01, 0);
    this.harness.material = new THREE.MeshLambertMaterial({ color: 0x2b2f36, side: THREE.DoubleSide });

    // --- head ---
    this.neck = new THREE.Group();
    this.neck.position.y = 0.47;
    this.torso.add(this.neck);
    this._mesh(G(new THREE.CylinderGeometry(0.042, 0.05, 0.07, 8)), M.skin, this.neck, 0, 0.02, 0);
    const head = this._mesh(G(new THREE.SphereGeometry(0.098, 14, 12)), M.skin, this.neck, 0, 0.14, 0);
    head.scale.set(0.92, 1.12, 1.0);
    const hair = this._mesh(G(new THREE.SphereGeometry(0.101, 12, 10)), M.hair, this.neck, 0, 0.152, -0.012);
    hair.scale.set(0.95, 1.02, 1.0);
    this._mesh(G(new THREE.SphereGeometry(0.048, 8, 8)), M.hair, this.neck, 0, 0.20, -0.062);

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
    const fore = this._mesh(new THREE.CapsuleGeometry(0.034, 0.24, 4, 8), M.skin, elbow, 0.145 * side, 0, 0);
    fore.rotation.z = Math.PI / 2;
    const hand = this._mesh(new THREE.SphereGeometry(0.042, 8, 7), M.skin, elbow, 0.305 * side, 0, 0);
    hand.scale.set(1.25, 0.85, 0.55);

    return { shoulder, upper, elbow, side };
  }

  _leg (side) {
    const M = this.mats;
    const hip = new THREE.Group();
    hip.position.set(0.075 * side, -0.06, 0);
    this.pelvis.add(hip);

    const thigh = new THREE.Group();
    hip.add(thigh);
    this._mesh(new THREE.CapsuleGeometry(0.062, 0.32, 4, 9), M.pants, thigh, 0, -0.20, 0);

    const knee = new THREE.Group();
    knee.position.y = -0.40;
    thigh.add(knee);
    this._mesh(new THREE.CapsuleGeometry(0.045, 0.30, 4, 9), M.pants, knee, 0, -0.19, 0);

    const ankle = new THREE.Group();
    ankle.position.y = -0.38;
    knee.add(ankle);
    const foot = this._mesh(new THREE.BoxGeometry(0.078, 0.05, 0.235), M.dark, ankle, 0, -0.032, 0.035);
    // a rounded toe stops the shoe reading as a brick
    const toe = this._mesh(new THREE.SphereGeometry(0.039, 8, 6), M.dark, ankle, 0, -0.03, 0.145);
    toe.scale.set(1, 0.62, 1.05);

    return { hip, thigh, knee, ankle, foot, side };
  }

  /**
   * Swap the primitive body for a rigged glTF. The lean group still carries
   * the balance roll, so all the existing animation keeps working; only the
   * limbs are re-targeted onto real bones.
   */
  adoptModel (gltf) {
    const model = gltf.scene || gltf.scenes[0];
    if (!model) return false;

    // scale so the model stands 1.75 m tall, whatever units it was authored in
    const box = new THREE.Box3().setFromObject(model);
    const h = box.max.y - box.min.y;
    if (h > 0.01) model.scale.setScalar(1.75 / h);
    model.position.y = -box.min.y * (1.75 / Math.max(h, 0.01));

    model.traverse(o => {
      if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; }
    });

    this.bones = findBones(model);
    this.model = model;
    this.usingModel = true;

    // hide the primitive body but keep the rig groups alive for the maths
    this.pelvis.visible = false;
    this.pelvis.traverse(o => { o.visible = false; });
    this.lean.add(model);

    for (const k in this.bones) {
      const b = this.bones[k];
      if (b) b.userData.rest = b.rotation.clone();
    }
    return true;
  }

  /** Drive the loaded skeleton from the same balance state. */
  _poseModel (dt, tilt, s) {
    const B = this.bones || {};
    const arm = clamp(s.arm ?? 0, -1, 1);
    const rest = (b) => b.userData.rest || { x: 0, y: 0, z: 0 };
    const ease = clamp(dt * 12, 0, 1);

    if (B.spine) {
      const r = rest(B.spine);
      B.spine.rotation.z = lerp(B.spine.rotation.z, r.z + tilt * 0.10, ease);
      B.spine.rotation.y = lerp(B.spine.rotation.y, r.y + arm * 0.12, ease);
    }
    if (B.chest) {
      const r = rest(B.chest);
      B.chest.rotation.z = lerp(B.chest.rotation.z, r.z + tilt * 0.12, ease);
    }
    if (B.head) {
      const r = rest(B.head);
      B.head.rotation.z = lerp(B.head.rotation.z, r.z - tilt * 0.34, ease);
    }
    // arms: the see-saw that actually generates the correcting torque
    const pairs = [[B.armL, -1], [B.armR, 1]];
    for (const [bone, sd] of pairs) {
      if (!bone) continue;
      const r = rest(bone);
      const seesaw = -arm * sd * 1.05;
      const spread = 1.25 + s.danger * 0.25;      // out to the sides
      bone.rotation.z = lerp(bone.rotation.z, r.z + sd * (spread + seesaw), ease);
      bone.rotation.x = lerp(bone.rotation.x, r.x - Math.abs(arm) * 0.25, ease);
    }
    for (const [bone, sd] of [[B.foreL, -1], [B.foreR, 1]]) {
      if (!bone) continue;
      const r = rest(bone);
      bone.rotation.y = lerp(bone.rotation.y, r.y + sd * (0.2 - clamp(s.atLimit ?? 0, 0, 1) * 0.18), ease);
    }
    // legs take a small crouch as things get hairy
    const crouch = Math.abs(tilt) * 0.3 + (this.state === 'sit' ? 1.1 : 0);
    for (const [bone, sd] of [[B.legL, -1], [B.legR, 1]]) {
      if (!bone) continue;
      const r = rest(bone);
      bone.rotation.x = lerp(bone.rotation.x, r.x - crouch * 0.5 + (this.state === 'step' ? Math.sin(this.stepPhase * Math.PI) * 0.5 * (sd === this.stepFoot ? 1 : -0.3) : 0), ease);
    }
    for (const [bone] of [[B.shinL], [B.shinR]]) {
      if (!bone) continue;
      const r = rest(bone);
      bone.rotation.x = lerp(bone.rotation.x, r.x + crouch * 0.9, ease);
    }
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

    /* ---- arms: the primary control surface, not decoration ----
       `s.arm` is the balance model's own arm state, so what you see is
       literally what is generating the correcting torque. Swinging the
       arms right means the right arm drops and the left one climbs —
       the whole pair rotates about the shoulders like a see-saw. */
    const armState = clamp(s.arm ?? 0, -1, 1);
    const armSpeed = Math.abs(s.armVel ?? 0);
    this.armWave = lerp(this.armWave, armSpeed * 0.22 + s.danger * 0.5, clamp(dt * 10, 0, 1));
    // a fast swing throws the forearms out; at full stretch they lock straight
    const strain = clamp(s.atLimit ?? 0, 0, 1);
    const flutter = Math.sin(this.t * (6 + this.armWave * 6)) * this.armWave * 0.16;

    for (const arm of [this.armL, this.armR]) {
      const sd = arm.side;
      // see-saw: +arm raises the LEFT arm and lowers the RIGHT
      const seesaw = -armState * sd * 0.95;
      const spread = -0.10 + s.danger * 0.30 + (this.state === 'step' ? 0.08 : 0);
      arm.shoulder.rotation.z = sd * (spread + seesaw + flutter);
      // arms also sweep forward slightly as they rise, like a real counterweight
      arm.shoulder.rotation.x = -Math.abs(armState) * 0.22 - s.danger * 0.10
                                + Math.sin(this.t * 1.1 + sd) * 0.04;
      arm.shoulder.rotation.y = armState * 0.20 * sd;
      // elbow straightens under strain, bends when relaxed
      arm.elbow.rotation.y = sd * (0.26 - strain * 0.22 + Math.abs(armState) * 0.10);
      arm.elbow.rotation.z = -sd * (0.16 - strain * 0.12);
      arm.upper.rotation.y = -sd * (0.12 + this.armWave * 0.10);
    }

    // the shoulders lead the hips: the torso is dragged round by the arms
    this.torso.rotation.y = lerp(this.torso.rotation.y, armState * 0.16, clamp(dt * 9, 0, 1));

    /* ---- torso ---- */
    this.torso.rotation.z = tilt * 0.16 + (s.arm ?? 0) * 0.05;
    this.torso.rotation.x = -0.04 + breath + (this.state === 'sit' ? 0.12 : 0);
    // eyes stay level with the horizon — a walker never looks at their feet
    this.neck.rotation.z = -tilt * 0.42;
    this.neck.rotation.x = 0.06 - s.danger * 0.1;

    if (this.usingModel) this._poseModel(dt, tilt, s);

    /* ---- state machines ---- */
    switch (this.state) {
      case 'stand': this._poseStand(dt, tilt, s); break;
      case 'step':  out.stepCompleted = this._poseStep(dt, tilt, out); break;
      case 'sit':   this._poseSit(dt); break;
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
