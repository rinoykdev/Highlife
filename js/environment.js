/* =========================================================
   environment.js — the view.

   Rebuilt around a real heightfield instead of primitive
   shapes. One ridged-multifractal terrain carries the whole
   landscape: the gorge the line crosses, the rims it is
   anchored to, and the ranges marching to the horizon.

   Colour comes from altitude and slope, so snow settles on
   high flat ground while cliff faces stay bare — the rule real
   mountains follow, and most of why it reads as one.

   Still no downloaded textures: terrain, trees, clouds and sky
   are all generated at load.
   ========================================================= */

import * as THREE from '../lib/three.module.min.js';
import { clamp, lerp } from './physics.js';

/* ---------- deterministic value noise ---------- */
function makePerm (seed) {
  let s = (seed * 16807) % 2147483647;
  if (s <= 0) s += 2147483646;
  const rnd = () => (s = s * 16807 % 2147483647) / 2147483647;
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = base[i]; base[i] = base[j]; base[j] = t;
  }
  const p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  return p;
}

function makeNoise (seed) {
  const p = makePerm(seed);
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (h, x, y) => {
    switch (h & 3) {
      case 0: return x + y;
      case 1: return x - y;
      case 2: return -x + y;
      default: return -x - y;
    }
  };
  return function noise2 (x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = fade(xf), v = fade(yf);
    const aa = p[p[X] + Y], ab = p[p[X] + Y + 1];
    const ba = p[p[X + 1] + Y], bb = p[p[X + 1] + Y + 1];
    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v);
  };
}

/**
 * Ridged multifractal. Folding noise about zero turns rounded hills into
 * sharp crests; weighting each octave by the previous one keeps those
 * crests continuous instead of breaking up into gravel.
 */
function ridged (noise2, x, y, octaves, lacunarity = 2.05, gain = 0.5) {
  let sum = 0, freq = 1, amp = 0.5, prev = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(noise2(x * freq, y * freq));
    n *= n;
    n *= prev;
    prev = n;
    sum += n * amp;
    freq *= lacunarity;
    amp *= gain;
  }
  return sum;
}

/* ---------- canvas textures ---------- */
function cloudSprite (seed) {
  const s = 128, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  let r = (seed * 9301) % 233280;
  const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < 9; i++) {
    const x = s * (0.26 + rnd() * 0.48);
    const y = s * (0.40 + rnd() * 0.28);
    const rad = s * (0.10 + rnd() * 0.17);
    const grd = g.createRadialGradient(x, y - rad * 0.2, 0, x, y, rad);
    grd.addColorStop(0, 'rgba(255,255,255,0.92)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.36)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * @param {number} density 0..1 — how much of the sheet is solid cloud.
 *   The bottom layer wants near-total coverage so the unlit basin never
 *   shows through as black holes; the layers above stay broken and puffy.
 */
function cloudSeaTexture (density = 0.5) {
  const s = 256, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const img = g.createImageData(s, s);
  const n1 = makeNoise(7), n2 = makeNoise(19);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const u = x / s * 5, v = y / s * 5;
      let f = 0, amp = 0.5, fr = 1;
      for (let o = 0; o < 4; o++) { f += Math.abs(n1(u * fr, v * fr)) * amp; fr *= 2.1; amp *= 0.52; }
      const puff = clamp((f - (0.30 - density * 0.30)) * (1.6 + density * 2.4), 0, 1);
      const hi = clamp(n2(u * 2.4, v * 2.4) * 0.5 + 0.5, 0, 1);
      const i = (y * s + x) * 4;
      const shade = 208 + hi * 47;
      img.data[i] = shade; img.data[i + 1] = shade; img.data[i + 2] = shade;
      img.data[i + 3] = puff * 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(5, 5);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---------- sky ---------- */
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
  float c = max(dot(d, normalize(sunDir)), 0.0);

  vec3 col;
  if (h > 0.0) col = mix(horizonColor, topColor, pow(clamp(h,0.0,1.0), 0.42));
  else         col = mix(horizonColor, groundColor, pow(clamp(-h,0.0,1.0), 0.38));

  // warm wash spreading sideways from the sun along the horizon
  float band = exp(-abs(h) * 7.0);
  col = mix(col, sunColor, band * pow(c, 2.2) * 0.55);

  float halo = pow(c, 6.0) * 0.20 * sunSize;
  float glow = pow(c, 130.0 / max(sunSize, 0.3)) * 0.60;
  float disc = smoothstep(0.99972 - sunSize * 0.00035, 0.99993, c);
  col += sunColor * (halo + glow + disc * 1.5);

  col = mix(col, horizonColor, smoothstep(0.13, 0.0, abs(h)) * 0.40);
  gl_FragColor = vec4(col, 1.0);
}`;

/* ---------- minimal geometry merge (position + index only) ---------- */
function mergeGeometries (geos) {
  let vCount = 0, iCount = 0;
  for (const g of geos) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const position = new Float32Array(vCount * 3);
  const index = new Uint32Array(iCount);
  let vo = 0, io = 0;
  for (const g of geos) {
    const p = g.attributes.position;
    position.set(p.array, vo * 3);
    const idx = g.index;
    if (idx) for (let i = 0; i < idx.count; i++) index[io++] = idx.getX(i) + vo;
    else for (let i = 0; i < p.count; i++) index[io++] = i + vo;
    vo += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeVertexNormals();
  return out;
}

/* =========================================================
   Environment
   ========================================================= */
export class Environment {
  constructor (scene, def, quality = 'medium') {
    this.scene = scene;
    this.def = def;
    this.quality = quality;
    this.group = new THREE.Group();
    this.disposables = [];
    scene.add(this.group);
    this.time = 0;

    this.seg = quality === 'low' ? 112 : quality === 'high' ? 216 : 160;
    this.q = quality === 'low' ? 0.55 : quality === 'high' ? 1.25 : 1;

    this.noise = makeNoise(def.seed || 11);
    this.detail = makeNoise((def.seed || 11) + 77);

    this._buildSky();
    this._buildLights();
    this._buildTerrain();
    this._buildTrees();
    this._buildCloudSea();
    this._buildClouds();
    this._buildBirds();
  }

  /**
   * World height in metres at (x, z). The gorge is carved along the x-axis
   * so the line, which runs down z, crosses it. Both rims land near y = -2
   * where the anchors are bolted.
   */
  height (x, z) {
    const d = this.def;
    const S = 0.00115;
    const gorgeHalf = d.lineLength * 0.5;

    const r = ridged(this.noise, x * S + 40, z * S + 40, 6);
    const detail = this.detail(x * S * 4.2, z * S * 4.2) * 0.5 + 0.5;
    // Mid and fine octaves. Without these the only wavelength in the terrain
    // is ~900 m, so anything within a few hundred metres of the walker reads
    // as a featureless smooth hill.
    const mid = this.detail(x * S * 9, z * S * 9);
    const fine = this.noise(x * S * 34, z * S * 34);

    const distZ = Math.abs(z), distX = Math.abs(x);
    // Mountains have to grow over KILOMETRES. Ramping the massing over a few
    // hundred metres put 400 m peaks 400 m away — a 42-degree wall across the
    // whole view. Nothing tall starts until well past the rim plateau, and
    // full height only arrives around 2.4 km out.
    const RIM = 55;                           // narrow ledge you rig from
    const BASIN = 150;                        // the ground plunges fast past the ledge
    const RANGE = 3000;                       // distance over which peaks build
    const beyond = clamp((distZ - gorgeHalf - 850) / RANGE, 0, 1);
    // Directional variation, or the ranges form a perfectly even ring around
    // the player like a crater rim. Some bearings get big massifs, others
    // open out into low country.
    const bearing = this.noise(x * 0.00028 + 9, z * 0.00028 + 9) * 0.5 + 0.5;
    const massing = Math.pow(beyond, 1.25) * (0.34 + 1.05 * bearing);

    // Beyond the rim the ground FALLS AWAY into a wide bowl before the ranges
    // climb back out of it. Without this the rim was a flat plateau that hid
    // the drop entirely, and the cloud sea had nowhere to sit.
    const bt = clamp((distZ - gorgeHalf - RIM) / BASIN, 0, 1);
    const bowl = lerp(-2.2, -d.basinDepth, bt * bt * (3 - 2 * bt));
    const base = lerp(bowl, 0, massing);

    let h = base + (r - 0.24) * d.peakHeight * (0.10 + massing * 1.80);
    h += (detail - 0.5) * 26 * (0.25 + massing * 1.4);

    // High-frequency octaves have to fade with distance or they alias into
    // needles once the warped grid reaches 200 m cells out at the horizon.
    const dist = Math.sqrt(x * x + z * z);
    const detailFade = clamp(1 - dist / 1700, 0, 1);
    h += mid * 21 * (0.55 + massing) * detailFade;
    h += fine * 5.5 * detailFade;

    // the ledge itself: flat enough to stand on, and it narrows away from the line
    const rimBlend = 1 - clamp((distZ - gorgeHalf) / RIM, 0, 1);
    const shelf = -2.2 - Math.pow(clamp(distX / 260, 0, 1), 2) * 30;
    h = lerp(h, shelf, rimBlend * 0.9);

    // carve the gorge
    if (distZ < gorgeHalf) {
      const t = distZ / gorgeHalf;
      const wall = Math.pow(t, 2.6);
      const floor = -d.gorgeDepth + (detail - 0.5) * 90;
      h = lerp(floor, Math.min(h, -2.2), wall);
    }
    return h;
  }

  /**
   * A uniform grid cannot do this job: the gorge is ~150 m across but the
   * landscape runs to 2.6 km, so an even 5 km plane spends all its vertices
   * on empty distance and renders the gorge in four cells. Instead the grid
   * is warped — vertex spacing follows |u|^2.5, giving roughly 8 m cells
   * around the line and 200 m ones out at the horizon, from a single seamless
   * mesh with no LOD popping.
   */
  _warpAxis (i, seg, halfExtent) {
    const u = (i / seg) * 2 - 1;              // -1 .. 1
    const t = Math.pow(Math.abs(u), 2.5);
    return Math.sign(u) * t * halfExtent;
  }

  _buildTerrain () {
    const d = this.def;
    const seg = this.seg;
    const HALF = 3800;
    const n = seg + 1;

    const positions = new Float32Array(n * n * 3);
    const colors = new Float32Array(n * n * 3);
    const indices = new Uint32Array(seg * seg * 6);

    const xs = new Float32Array(n), zs = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = this._warpAxis(i, seg, HALF);
      zs[i] = this._warpAxis(i, seg, HALF);
    }

    let p = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = xs[i], z = zs[j];
        positions[p] = x;
        positions[p + 1] = this.height(x, z);
        positions[p + 2] = z;
        p += 3;
      }
    }

    let k = 0;
    for (let j = 0; j < seg; j++) {
      for (let i = 0; i < seg; i++) {
        const a = j * n + i, b = a + 1, c = a + n, e = c + 1;
        indices[k++] = a; indices[k++] = c; indices[k++] = b;
        indices[k++] = b; indices[k++] = c; indices[k++] = e;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();

    // colour by altitude and slope — snow on high flat ground, bare rock on
    // anything steep, green in the sheltered low country
    const cRock = new THREE.Color(d.rock);
    const cRockLit = new THREE.Color(d.rockLit);
    const cGrass = new THREE.Color(d.grass || '#3f4a32');
    const cSnow = new THREE.Color('#eef4fa');
    const cDeep = new THREE.Color(d.valley);
    const tmp = new THREE.Color();
    const nrm = geo.attributes.normal;
    const snowLine = d.snowLine ?? 120;

    for (let i = 0; i < n * n; i++) {
      const y = positions[i * 3 + 1];
      const slope = 1 - clamp(nrm.getY(i), 0, 1);
      const alt = (y - snowLine) / 260;

      tmp.copy(cGrass).lerp(cRock, clamp(slope * 2.4 + clamp(alt + 0.5, 0, 1) * 0.7, 0, 1));
      tmp.lerp(cRockLit, clamp((1 - slope) * 0.45 + alt * 0.25, 0, 1) * 0.55);

      const snowAmt = clamp(alt, 0, 1) * clamp(1 - slope * 1.75, 0, 1) * (d.snow ?? 0.5);
      tmp.lerp(cSnow, clamp(snowAmt * 1.6, 0, 1));

      const depth = clamp(-y / (d.gorgeDepth * 0.9), 0, 1);
      tmp.lerp(cDeep, depth * 0.3);

      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrain.frustumCulled = false;
    this.group.add(this.terrain);
    this.disposables.push(geo, mat);
  }

  _buildTrees () {
    const d = this.def;
    if ((d.treeLine ?? 0) <= 0) { this.trees = null; return; }

    const count = Math.round((this.quality === 'low' ? 240 : 560) * this.q);
    const trunk = new THREE.CylinderGeometry(0.18, 0.26, 2.2, 5); trunk.translate(0, 1.1, 0);
    const skirt = new THREE.ConeGeometry(1.9, 4.6, 7); skirt.translate(0, 3.9, 0);
    const top = new THREE.ConeGeometry(1.25, 4.0, 7); top.translate(0, 6.4, 0);
    const merged = mergeGeometries([trunk, skirt, top]);
    trunk.dispose(); skirt.dispose(); top.dispose();

    const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(d.tree || '#2c3a26') });
    const mesh = new THREE.InstancedMesh(merged, mat, count);
    mesh.frustumCulled = false;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const scl = new THREE.Vector3();
    const posV = new THREE.Vector3();
    const half = d.lineLength * 0.5;
    let placed = 0, guard = 0;

    while (placed < count && guard++ < count * 16) {
      const side = Math.random() < 0.5 ? 1 : -1;
      const z = side * (half + Math.pow(Math.random(), 1.7) * 420);
      const x = (Math.random() - 0.5) * 1500;
      const y = this.height(x, z);
      if (y < -60 || y > d.treeLine) continue;

      // no trees on cliff faces
      const hx = this.height(x + 6, z) - y;
      const hz = this.height(x, z + 6) - y;
      if (Math.hypot(hx, hz) / 6 > 0.62) continue;
      // keep the webbing corridor clear
      if (Math.abs(x) < 9 && Math.abs(Math.abs(z) - half) < 26) continue;

      const s = 0.55 + Math.random() * 0.95;
      posV.set(x, y - 0.4, z);
      scl.set(s * (0.8 + Math.random() * 0.4), s * (0.85 + Math.random() * 0.5), s * (0.8 + Math.random() * 0.4));
      q.setFromAxisAngle(up, Math.random() * Math.PI);
      m.compose(posV, q, scl);
      mesh.setMatrixAt(placed++, m);
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    this.trees = mesh;
    this.disposables.push(merged, mat);
  }

  _buildCloudSea () {
    const d = this.def;
    this.seaLayers = [];
    // Layers stack DOWNWARD from cloudLevel. Offsetting them upward was fine
    // when the sea sat 430 m down, but now that it pools just under the rim it
    // put a 5 km sheet a metre below the walker's feet, across the whole view.
    const heights = [d.cloudLevel - 210, d.cloudLevel - 120, d.cloudLevel - 52, d.cloudLevel];
    const opac = [1.0, 0.78, 0.46, 0.24];
    const dens = [1.0, 0.55, 0.42, 0.30];
    const texes = dens.map(v => cloudSeaTexture(v));
    for (const t of texes) this.disposables.push(t);
    for (let i = 0; i < heights.length; i++) {
      const tex = texes[i];
      const geo = new THREE.PlaneGeometry(5200, 5200);
      // Unlit on purpose: a horizontal plane under a 6-degree sun gets almost
      // no diffuse light, which turned the cloud sea black exactly when it
      // should be the brightest thing in the gorge.
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: opac[i], depthWrite: false,
        color: new THREE.Color(d.cloudColor).multiplyScalar(1 - i * 0.12),
        side: THREE.DoubleSide
      });
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = i * 0.7;
      m.position.y = heights[i];
      tex.offset.set(i * 0.31, i * 0.17);
      m.renderOrder = 1 + i;
      this.group.add(m);
      this.seaLayers.push(m);
      this.disposables.push(geo, mat);
    }
  }

  _buildClouds () {
    const d = this.def;
    const count = Math.round(d.cloudCount * this.q);
    this.clouds = [];
    const texes = [cloudSprite(3), cloudSprite(11), cloudSprite(29)];
    for (const t of texes) this.disposables.push(t);

    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({
        map: texes[i % texes.length], transparent: true, depthWrite: false,
        color: new THREE.Color(d.cloudColor), fog: false
      });
      const s = new THREE.Sprite(mat);
      const high = Math.random() < 0.45;
      const scale = high ? 260 + Math.random() * 520 : 90 + Math.random() * 300;
      s.scale.set(scale * (1.4 + Math.random() * 0.8), scale * (high ? 0.28 : 0.5), 1);
      s.position.set(
        (Math.random() - 0.5) * 3400,
        high ? 240 + Math.random() * 420 : d.cloudLevel * (0.2 + Math.random() * 0.5) + 120,
        -400 - Math.random() * 2600
      );
      mat.opacity = high ? 0.20 + Math.random() * 0.35 : 0.30 + Math.random() * 0.45;
      s.userData.speed = 1.4 + Math.random() * 3.6;
      s.userData.baseOpacity = mat.opacity;
      this.group.add(s);
      this.clouds.push(s);
      this.disposables.push(mat);
    }
  }

  _buildBirds () {
    const d = this.def;
    const count = Math.max(2, Math.round(d.birds * this.q));
    const mat = new THREE.LineBasicMaterial({ color: 0x2a2622, transparent: true, opacity: 0.55 });
    this.disposables.push(mat);
    this.birds = [];
    for (let i = 0; i < count; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 0, 0.35, 0, 1, 0, 0], 3));
      const line = new THREE.Line(geo, mat);
      line.userData = {
        r: 90 + Math.random() * 320, a: Math.random() * Math.PI * 2,
        speed: 0.05 + Math.random() * 0.11,
        y: -30 - Math.random() * 180, z: -120 - Math.random() * 520,
        flap: Math.random() * 6, scale: 1.6 + Math.random() * 3
      };
      this.group.add(line);
      this.birds.push(line);
      this.disposables.push(geo);
    }
  }

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
    const geo = new THREE.SphereGeometry(4200, 28, 16);
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.renderOrder = -1;
    this.group.add(this.sky);
    this.disposables.push(geo, mat);

    this.scene.fog = new THREE.FogExp2(new THREE.Color(d.fog.color), d.fog.density);
  }

  _buildLights () {
    const d = this.def;
    const sun = new THREE.DirectionalLight(new THREE.Color(d.sun.color), d.sun.intensity);
    sun.position.copy(this.sunDir).multiplyScalar(600);
    this.group.add(sun);
    this.sunLight = sun;

    const hemi = new THREE.HemisphereLight(new THREE.Color(d.sky.top), new THREE.Color(d.valley), 0.95);
    this.group.add(hemi);

    const fill = new THREE.DirectionalLight(new THREE.Color(d.sky.horizon), 0.55);
    fill.position.set(-this.sunDir.x * 400, 220, -this.sunDir.z * 400);
    this.group.add(fill);

    // A backlit sunset leaves every near face in shadow. A little ambient
    // keeps those faces as readable silhouettes instead of black holes.
    this.group.add(new THREE.AmbientLight(new THREE.Color(d.fog.color), 0.62));
  }

  update (dt, windLateral, windSpeed) {
    this.time += dt;
    const t = this.time;
    const drift = 1 + Math.abs(windLateral) * 1.4;
    const dir = Math.sign(windLateral || 1);

    for (const c of this.clouds) {
      c.position.x += c.userData.speed * dt * drift * dir;
      if (c.position.x > 1900) c.position.x = -1900;
      if (c.position.x < -1900) c.position.x = 1900;
      c.material.opacity = c.userData.baseOpacity * (0.85 + 0.15 * Math.sin(t * 0.25 + c.position.z));
    }

    for (let i = 0; i < this.seaLayers.length; i++) {
      const m = this.seaLayers[i].material.map;
      if (!m) continue;
      m.offset.x += dt * (0.0022 + i * 0.0016) * drift * dir;
      m.offset.y += dt * 0.0009;
    }

    for (const b of this.birds) {
      const u = b.userData;
      u.a += u.speed * dt;
      b.position.set(Math.cos(u.a) * u.r, u.y + Math.sin(u.a * 1.7) * 8, u.z + Math.sin(u.a) * u.r * 0.6);
      b.rotation.z = Math.sin(u.a) * 0.3;
      b.rotation.y = -u.a + Math.PI / 2;
      const flap = Math.sin(t * 7 + u.flap);
      b.scale.set(u.scale, u.scale * (0.6 + flap * 0.5), u.scale);
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
