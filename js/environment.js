/* =========================================================
   environment.js — the drop.

   Everything here is generated at runtime: no textures ship
   with the game except two tiny canvas-drawn ones. That keeps
   the PWA small enough to cache instantly and lets each
   location re-skin the same geometry budget.
   ========================================================= */

import * as THREE from '../lib/three.module.min.js';
import { fbm, noise1, clamp, lerp } from './physics.js';

/* ---------- canvas textures ---------- */
function cloudTexture () {
  const s = 128, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.clearRect(0, 0, s, s);
  // a few overlapping soft blobs = one puffy cloud
  for (let i = 0; i < 7; i++) {
    const x = s * (0.28 + Math.random() * 0.44);
    const y = s * (0.42 + Math.random() * 0.26);
    const r = s * (0.11 + Math.random() * 0.16);
    const rad = g.createRadialGradient(x, y, 0, x, y, r);
    rad.addColorStop(0, 'rgba(255,255,255,0.85)');
    rad.addColorStop(0.55, 'rgba(255,255,255,0.35)');
    rad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rad;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function cloudSeaTexture () {
  const s = 256, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,0.10)';
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 190; i++) {
    const x = Math.random() * s, y = Math.random() * s, r = 6 + Math.random() * 26;
    const rad = g.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.05 + Math.random() * 0.22;
    rad.addColorStop(0, `rgba(255,255,255,${a})`);
    rad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rad;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 6);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---------- sky dome ---------- */
const SKY_VERT = `
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
}`;

const SKY_FRAG = `
uniform vec3 topColor, horizonColor, groundColor, sunColor, sunDir;
uniform float sunSize;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col;
  if (h > 0.0) col = mix(horizonColor, topColor, pow(clamp(h,0.0,1.0), 0.55));
  else         col = mix(horizonColor, groundColor, pow(clamp(-h,0.0,1.0), 0.42));
  // sun disc + broad glow
  float c = max(dot(d, normalize(sunDir)), 0.0);
  float halo  = pow(c, 7.0) * 0.18 * sunSize;               // wide atmospheric bloom
  float glow  = pow(c, 120.0 / max(sunSize,0.3)) * 0.55;    // tight glow around the disc
  float disc  = smoothstep(0.99972 - sunSize*0.00035, 0.99993, c);
  col += sunColor * (halo + glow + disc * 1.35);
  // gentle band of haze right on the horizon
  col = mix(col, horizonColor, smoothstep(0.16, 0.0, abs(h)) * 0.45);
  gl_FragColor = vec4(col, 1.0);
}`;

/* ---------- rock ---------- */
function ridgeProfile (x, seed, rough) {
  return fbm(x * 0.6 + seed) * 0.65 + fbm(x * 1.9 + seed * 2.3) * 0.26 * rough + fbm(x * 5.1 + seed) * 0.09 * rough;
}

/**
 * A rocky mass built from a displaced cylinder. Cheap, reads as a cliff
 * or a spire depending on the taper, and takes vertex colours so snow
 * can sit on the up-facing faces without a texture.
 */
function makeCliff (opts) {
  const {
    rTop = 8, rBottom = 26, height = 120, seed = 1,
    rock = '#4c4136', lit = '#8d7355', snow = 0.4, rough = 1
  } = opts;
  const geo = new THREE.CylinderGeometry(rTop, rBottom, height, 22, 12, false);
  const pos = geo.attributes.position;
  const cRock = new THREE.Color(rock), cLit = new THREE.Color(lit), cSnow = new THREE.Color('#e9f1f6');
  const colors = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const ang = Math.atan2(v.z, v.x);
    const yN = (v.y + height / 2) / height;
    // two scales of displacement: broad buttresses plus finer gullies
    const n = ridgeProfile(ang * 2.4 + yN * 3.1, seed, rough);
    const fine = ridgeProfile(ang * 6.7 + yN * 8.3, seed * 1.7, rough) * 0.35;
    const radial = 1 + (n * 0.19 + fine * 0.07) * (0.5 + yN * 0.8);
    v.x *= radial; v.z *= radial;
    v.y += n * height * 0.035;
    pos.setXYZ(i, v.x, v.y, v.z);

    // colour: darker in the creases, lit on the shoulders, snow up top
    const t = clamp(0.5 + (n + fine) * 0.7, 0, 1);
    tmp.copy(cRock).lerp(cLit, t * (0.35 + yN * 0.65));
    const cover = snow * 0.45;                       // only the summits hold snow
    const snowAmt = clamp((yN - (1 - cover)) / Math.max(cover, 0.01), 0, 1) * clamp(0.35 + n, 0, 1);
    tmp.lerp(cSnow, snowAmt * snow * 0.9);
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * The rock the line is actually rigged to: a broad ledge with a flat rim at
 * y=0 that falls away into the void. Used instead of a tower at each anchor
 * so the walker looks *over* the far edge into the valley rather than at a
 * wall.
 */
function makeLedge (opts) {
  const {
    width = 26, depth = 30, drop = 220, seed = 2,
    rock = '#4c4136', lit = '#8d7355', snow = 0.4
  } = opts;
  const geo = new THREE.BoxGeometry(width, drop, depth, 8, 14, 8);
  const pos = geo.attributes.position;
  const cRock = new THREE.Color(rock), cLit = new THREE.Color(lit), cSnow = new THREE.Color('#e9f1f6');
  const colors = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  const tmp = new THREE.Color();
  const top = drop / 2;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const yN = (top - v.y) / drop;                 // 0 at the rim, 1 at the bottom
    const n = ridgeProfile(v.x * 0.22 + v.z * 0.17 + yN * 4.2, seed, 1);
    if (yN > 0.02) {                               // leave the rim itself flat to stand on
      const taper = 1 - yN * 0.45;                 // narrows as it falls away
      v.x = v.x * taper + n * width * 0.11 * yN;
      v.z = v.z * taper + n * depth * 0.10 * yN;
      v.y += n * drop * 0.02;
    } else {
      v.x += n * width * 0.035;
      v.z += n * depth * 0.03;
    }
    pos.setXYZ(i, v.x, v.y, v.z);

    const t = clamp(0.5 + n * 0.7, 0, 1);
    tmp.copy(cRock).lerp(cLit, t * (0.9 - yN * 0.75));
    if (top - v.y < 2.4) tmp.lerp(cSnow, snow * 0.5);   // a real dusting, ~2 m of rim
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

/** Flat silhouette ridge for the far distance — two triangles per span. */
function makeRidge (width, height, segments, seed, colorTop, colorBottom, rough) {
  const g = new THREE.BufferGeometry();
  const verts = [], cols = [];
  const cT = new THREE.Color(colorTop), cB = new THREE.Color(colorBottom);
  const hAt = i => {
    const x = i / segments;
    return height * (0.42 + ridgeProfile(x * 7 + seed, seed, rough) * 0.6 + Math.sin(x * 3.1 + seed) * 0.16);
  };
  for (let i = 0; i < segments; i++) {
    const x0 = (i / segments - 0.5) * width, x1 = ((i + 1) / segments - 0.5) * width;
    const h0 = hAt(i), h1 = hAt(i + 1);
    const yB = -height * 1.6;
    verts.push(x0, h0, 0, x1, h1, 0, x0, yB, 0);
    verts.push(x1, h1, 0, x1, yB, 0, x0, yB, 0);
    const push = (c) => cols.push(c.r, c.g, c.b);
    push(cT); push(cT); push(cB); push(cT); push(cB); push(cB);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  return g;
}

/* =========================================================
   Environment
   ========================================================= */
export class Environment {
  /**
   * @param {THREE.Scene} scene
   * @param {object} def   location definition from content.js
   * @param {string} quality  low | medium | high
   */
  constructor (scene, def, quality = 'medium') {
    this.scene = scene;
    this.def = def;
    this.quality = quality;
    this.group = new THREE.Group();
    this.disposables = [];
    scene.add(this.group);
    this.time = 0;

    const q = quality === 'low' ? 0.55 : quality === 'high' ? 1.25 : 1;
    this.q = q;

    this._buildSky();
    this._buildLights();
    this._buildCliffs();
    this._buildRidges();
    this._buildClouds();
    this._buildBirds();
    this._buildVegetation();
  }

  /* ---------- sky + fog ---------- */
  _buildSky () {
    const d = this.def;
    const sunDir = new THREE.Vector3(
      Math.sin(d.sun.azimuth), Math.max(0.02, d.sun.elevation), -Math.cos(d.sun.azimuth)
    ).normalize();
    this.sunDir = sunDir;

    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        topColor: { value: new THREE.Color(d.sky.top) },
        horizonColor: { value: new THREE.Color(d.sky.horizon) },
        groundColor: { value: new THREE.Color(d.sky.ground) },
        sunColor: { value: new THREE.Color(d.sun.color) },
        sunDir: { value: sunDir.clone() },
        sunSize: { value: d.sun.size }
      },
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG
    });
    const geo = new THREE.SphereGeometry(2600, 24, 14);
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.renderOrder = -1;
    this.group.add(this.sky);
    this.disposables.push(geo, mat);

    this.scene.fog = new THREE.FogExp2(new THREE.Color(d.fog.color), d.fog.density);
  }

  _buildLights () {
    const d = this.def;
    const sun = new THREE.DirectionalLight(new THREE.Color(d.sun.color), d.sun.intensity);
    sun.position.copy(this.sunDir).multiplyScalar(300);
    this.group.add(sun);

    // cool bounce from the valley + sky, keeps shadow sides readable
    const hemi = new THREE.HemisphereLight(new THREE.Color(d.sky.top), new THREE.Color(d.valley), 0.85);
    this.group.add(hemi);

    // rim light straight back at the walker for that golden edge
    const rim = new THREE.DirectionalLight(new THREE.Color(d.sun.color), 0.55);
    rim.position.set(-this.sunDir.x * 200, 60, -this.sunDir.z * 200);
    this.group.add(rim);

    this.sunLight = sun;
  }

  /* ---------- big rock ---------- */
  _buildCliffs () {
    const d = this.def;
    const half = d.lineLength / 2;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.disposables.push(mat);

    const add = (geo, x, y, z, ry, s = 1) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      m.scale.setScalar(s);
      this.group.add(m);
      this.disposables.push(geo);
      return m;
    };

    // near anchor (behind the player) and far anchor (the goal)
    // Anchor ledges: the rim sits a hair below the webbing so the line
    // visibly leaves the rock, and the far one is low enough to see over.
    // The rims sit below the webbing — real highlines are bolted under the
    // lip — which keeps the horizon and the sun open above the far anchor
    // instead of walling off the middle of the frame.
    const nearGeo = makeLedge({ width: 34, depth: 34, drop: 240, seed: 3.1, rock: d.rock, lit: d.rockLit, snow: d.snow });
    add(nearGeo, 0, -120 - 1.7, half + 16, 0.15);

    const farGeo = makeLedge({ width: 22, depth: 30, drop: 260, seed: 7.7, rock: d.rock, lit: d.rockLit, snow: d.snow });
    add(farGeo, 0, -130 - 2.6, -half - 14, -0.2);

    // massifs pushed well off-axis so the centre of frame stays open
    const sideA = makeCliff({ rTop: 30, rBottom: 70, height: 300, seed: 11.3, rock: d.rock, lit: d.rockLit, snow: d.snow * 0.7, rough: 1.2 });
    add(sideA, -128, -176, half + 40, 1.1, 1.1);
    const sideB = makeCliff({ rTop: 24, rBottom: 64, height: 340, seed: 5.5, rock: d.rock, lit: d.rockLit, snow: d.snow * 0.7, rough: 1.2 });
    add(sideB, 152, -196, -half - 70, 0.3, 1.15);
    const sideC = makeCliff({ rTop: 34, rBottom: 78, height: 280, seed: 17.9, rock: d.rock, lit: d.rockLit, snow: d.snow * 0.6, rough: 1.1 });
    add(sideC, -104, -190, -half - 130, 2.4, 1.2);

    // The far anchor needs something to belong to, or it reads as a slab
    // hanging in space. This sits behind and below it, off to one side of
    // the sun so the sky stays open.
    const backing = makeCliff({ rTop: 58, rBottom: 130, height: 420, seed: 23.4, rock: d.rock, lit: d.rockLit, snow: d.snow * 0.85, rough: 1.15 });
    add(backing, 46, -240, -half - 112, 1.7, 1.0);

    // a couple of mid-distance spires for parallax
    const n = this.quality === 'low' ? 2 : 4;
    for (let i = 0; i < n; i++) {
      const g = makeCliff({
        rTop: 20 + Math.random() * 22, rBottom: 46 + Math.random() * 34, height: 260 + Math.random() * 240,
        seed: 20 + i * 3.7, rock: d.rock, lit: d.rockLit, snow: d.snow * 0.9, rough: 1.1
      });
      const side = i % 2 ? 1 : -1;
      add(g, side * (240 + Math.random() * 300), -330 - Math.random() * 160, -420 - i * 300 - Math.random() * 240, Math.random() * 3);
    }
  }

  _buildRidges () {
    const d = this.def;
    const layers = this.quality === 'low' ? 2 : 3;
    const fog = new THREE.Color(d.fog.color);
    for (let i = 0; i < layers; i++) {
      const depth = 900 + i * 620;
      const t = i / Math.max(1, layers - 1);
      const top = new THREE.Color(d.rock).lerp(fog, 0.45 + t * 0.42);
      const bot = new THREE.Color(d.valley).lerp(fog, 0.35 + t * 0.4);
      const geo = makeRidge(depth * 2.6, 90 + i * 40, 46 - i * 10, 13 + i * 9, top, bot, 1 - t * 0.5);
      const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, depthWrite: false });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(0, -70 - i * 26, -depth);
      m.renderOrder = -1 + i * 0.01;
      this.group.add(m);
      this.disposables.push(geo, mat);
    }

    // cloud sea far below — the single strongest height cue
    const seaTex = cloudSeaTexture();
    const seaGeo = new THREE.PlaneGeometry(4200, 4200, 1, 1);
    const seaMat = new THREE.MeshBasicMaterial({
      map: seaTex, transparent: true, opacity: 0.55, depthWrite: false,
      // blended toward the haze so it sits far below rather than underfoot
      color: new THREE.Color(d.cloudColor).lerp(new THREE.Color(d.fog.color), 0.45),
      fog: false
    });
    this.sea = new THREE.Mesh(seaGeo, seaMat);
    this.sea.rotation.x = -Math.PI / 2;
    this.sea.position.y = d.cloudLevel;
    this.group.add(this.sea);
    this.disposables.push(seaGeo, seaMat, seaTex);

    // valley floor, mostly lost in haze
    const flGeo = new THREE.PlaneGeometry(6000, 6000);
    const flMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(d.valley), fog: false });
    const floor = new THREE.Mesh(flGeo, flMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = d.cloudLevel - 260;
    this.group.add(floor);
    this.disposables.push(flGeo, flMat);
  }

  /* ---------- clouds ---------- */
  _buildClouds () {
    const d = this.def;
    const tex = cloudTexture();
    this.disposables.push(tex);
    const count = Math.round(d.cloudCount * this.q);
    this.clouds = [];
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false, fog: false,
      color: new THREE.Color(d.cloudColor), opacity: 0.75
    });
    this.disposables.push(mat);
    for (let i = 0; i < count; i++) {
      const s = new THREE.Sprite(mat.clone());
      const scale = 60 + Math.random() * 220;
      s.scale.set(scale * (1.3 + Math.random() * 0.7), scale * 0.55, 1);
      s.position.set(
        (Math.random() - 0.5) * 1500,
        d.cloudLevel * (0.25 + Math.random() * 0.55) + (Math.random() - 0.3) * 90,
        -180 - Math.random() * 1500
      );
      s.material.opacity = 0.28 + Math.random() * 0.45;
      s.userData.speed = 1.6 + Math.random() * 3.4;
      s.userData.baseOpacity = s.material.opacity;
      this.group.add(s);
      this.clouds.push(s);
      this.disposables.push(s.material);
    }
  }

  /* ---------- birds ---------- */
  _buildBirds () {
    const d = this.def;
    const count = Math.max(2, Math.round(d.birds * this.q));
    const mat = new THREE.LineBasicMaterial({ color: 0x2a2622, transparent: true, opacity: 0.6 });
    this.disposables.push(mat);
    this.birds = [];
    for (let i = 0; i < count; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 0, 0.35, 0, 1, 0, 0], 3));
      const line = new THREE.Line(geo, mat);
      const r = 60 + Math.random() * 240;
      line.userData = {
        r, a: Math.random() * Math.PI * 2,
        speed: 0.06 + Math.random() * 0.13,
        y: -20 - Math.random() * 120,
        z: -80 - Math.random() * 420,
        flap: Math.random() * 6, scale: 1.4 + Math.random() * 2.6
      };
      line.scale.setScalar(line.userData.scale);
      this.group.add(line);
      this.birds.push(line);
      this.disposables.push(geo);
    }
  }

  /* ---------- vegetation at the anchors ---------- */
  _buildVegetation () {
    const d = this.def;
    if (d.snow > 0.6) { this.plants = []; return;  }   // nothing grows up there
    const half = d.lineLength / 2;
    const geo = new THREE.ConeGeometry(1.4, 6, 5);
    const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(d.valley).offsetHSL(0, 0.05, 0.06) });
    this.disposables.push(geo, mat);
    const count = this.quality === 'low' ? 6 : 12;
    this.plants = [];
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, mat);
      const near = i % 2 === 0;
      m.position.set(
        (Math.random() - 0.5) * 34,
        -4 - Math.random() * 8,
        (near ? half + 12 : -half - 14) + (Math.random() - 0.5) * 18
      );
      m.scale.setScalar(0.5 + Math.random() * 1.1);
      m.userData.phase = Math.random() * 6;
      m.userData.baseRot = (Math.random() - 0.5) * 0.1;
      this.group.add(m);
      this.plants.push(m);
    }
  }

  /* ---------- per-frame ---------- */
  update (dt, windLateral, windSpeed) {
    this.time += dt;
    const t = this.time;
    const drift = 1 + Math.abs(windLateral) * 1.6;

    for (const c of this.clouds) {
      c.position.x += c.userData.speed * dt * drift * Math.sign(windLateral || 1);
      if (c.position.x > 900) c.position.x = -900;
      if (c.position.x < -900) c.position.x = 900;
      c.material.opacity = c.userData.baseOpacity * (0.85 + 0.15 * Math.sin(t * 0.3 + c.position.z));
    }

    if (this.sea && this.sea.material.map) {
      const m = this.sea.material.map;
      m.offset.x += dt * 0.0035 * drift;
      m.offset.y += dt * 0.0012;
    }

    for (const b of this.birds) {
      const u = b.userData;
      u.a += u.speed * dt;
      b.position.set(Math.cos(u.a) * u.r, u.y + Math.sin(u.a * 1.7) * 6, u.z + Math.sin(u.a) * u.r * 0.6);
      b.rotation.z = Math.sin(u.a) * 0.3;
      b.rotation.y = -u.a + Math.PI / 2;
      const flap = Math.sin(t * 7 + u.flap);
      b.scale.set(u.scale, u.scale * (0.6 + flap * 0.5), u.scale);
    }

    if (this.plants) {
      for (const p of this.plants) {
        p.rotation.z = p.userData.baseRot + windLateral * 0.18 + Math.sin(t * 2.4 + p.userData.phase) * 0.035 * (1 + windSpeed * 0.05);
      }
    }
  }

  dispose () {
    this.scene.remove(this.group);
    this.group.traverse(o => { if (o.isSprite && o.material) o.material.dispose(); });
    for (const d of this.disposables) { if (d && d.dispose) d.dispose(); }
    this.disposables.length = 0;
    this.scene.fog = null;
  }
}
