// FortWorld world building — AAA pass: procedural PBR textures, roads, instanced
// vegetation/props/lamps/cars, animated clouds, custom GLSL sky/water/storm.
import * as THREE from 'three';
import { MAPS_DATA } from './maps_data.js';

// Expansion zones baked by tools/bake_maps.mjs.
// MUST match server/map.js exactly.
const EXPANSION_ZONES = MAPS_DATA.zones;

// Must match server/map.js exactly
const HILLS = [
  { x: -600, z: -800, r: 700, h: 55 }, { x: 900, z: -500, r: 800, h: 70 },
  { x: -1100, z: 600, r: 650, h: 48 }, { x: 700, z: 900, r: 750, h: 62 },
  { x: 0, z: 0, r: 500, h: 30 }, { x: -300, z: 1400, r: 600, h: 40 },
  { x: 1300, z: 300, r: 550, h: 45 },
];
export const MOUNTAINS = [
  { name: 'Mount Apex', x: -450, z: -1450, r: 620, h: 215 },
  { name: 'Razorback Ridge', x: -1550, z: -1250, r: 520, h: 190 },
  { name: 'Titan Peak', x: 850, z: -1600, r: 580, h: 210 },
  { name: 'Kings Crown', x: 1550, z: 150, r: 560, h: 180 },
  { name: 'Verde Highlands', x: -1550, z: 1100, r: 600, h: 170 },
  { name: 'Solstice Peaks', x: 700, z: 1650, r: 520, h: 175 },
];
// Rivers: descending channels carved into the terrain (only ever cut down).
// MUST match server/map.js exactly. src/dst = channel bed elevations.
export const RIVERS = [
  { name: 'Apex River', w: 13, src: 42, dst: -4, pts: [[-350, -1050], [-260, -720], [-160, -380], [-240, 40], [-430, 430], [-640, 830], [-520, 1200], [-450, 1560], [-460, 1960]] },
  { name: 'Titan River', w: 14, src: 40, dst: -4, pts: [[520, -1330], [360, -1010], [170, -790], [260, -460], [360, -160], [440, 240], [520, 590], [760, 940], [960, 1240], [1150, 1960]] },
  { name: 'Verde Creek', w: 10, src: 30, dst: -4, pts: [[-1080, 960], [-680, 905], [-320, 990], [10, 1075], [170, 1240], [330, 1520], [300, 1960]] },
];
for (const rv of RIVERS) {
  rv.segs = []; rv.total = 0;
  let minX = 1e9, minZ = 1e9, maxX = -1e9, maxZ = -1e9;
  for (let i = 0; i + 1 < rv.pts.length; i++) {
    const [ax, az] = rv.pts[i], [bx, bz] = rv.pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    rv.segs.push({ ax, az, bx, bz, len, len2: len * len, cum: rv.total });
    rv.total += len;
    minX = Math.min(minX, ax, bx); maxX = Math.max(maxX, ax, bx);
    minZ = Math.min(minZ, az, bz); maxZ = Math.max(maxZ, az, bz);
  }
  rv.bb = [minX, minZ, maxX, maxZ];
}
// Nearest river field at a point: { d, bed, w, name } or null (client helper).
export function riverAt(x, z) {
  let best = null;
  for (const rv of RIVERS) {
    if (x < rv.bb[0] - rv.w || x > rv.bb[2] + rv.w || z < rv.bb[1] - rv.w || z > rv.bb[3] + rv.w) continue;
    for (const s of rv.segs) {
      const vx = s.bx - s.ax, vz = s.bz - s.az;
      let t = ((x - s.ax) * vx + (z - s.az) * vz) / s.len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = s.ax + vx * t, pz = s.az + vz * t;
      const d = Math.hypot(x - px, z - pz);
      const bed = rv.src + (rv.dst - rv.src) * ((s.cum + t * s.len) / rv.total);
      if (!best || d < best.d) best = { d, bed, w: rv.w, name: rv.name };
    }
  }
  return best;
}
function terrainNative(x, z) {
  let h = Math.sin(x * 0.004) * 8 + Math.cos(z * 0.005) * 8 + Math.sin((x + z) * 0.0022) * 6;
  for (const hill of HILLS) {
    const dx = x - hill.x, dz = z - hill.z;
    h += hill.h * Math.exp(-(dx * dx + dz * dz) / (hill.r * hill.r));
  }
  // Everest-style massifs: cone body, radiating arete ridges, fluted valleys,
  // steep summit pyramid, soft terracing that forms cliff bands & benches.
  // MUST match server/map.js exactly.
  let mMask = 0, mHeight = 0;
  for (let mi = 0; mi < MOUNTAINS.length; mi++) {
    const peak = MOUNTAINS[mi];
    const dx = x - peak.x, dz = z - peak.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const R = peak.r * 1.55;
    if (d >= R) continue;
    const p = 1 - d / R; // 1 at summit -> 0 at rim
    const ang = Math.atan2(dz, dx);
    const mid = Math.sin(Math.PI * Math.min(1, p * 1.12)); // fades at rim & summit
    let crest = 0;
    for (let k = 0; k < 3; k++) {
      const rd = mi * 2.39996 + k * 2.094 + Math.sin(mi * 7.3 + k * 3.1) * 0.35;
      const da = Math.atan2(Math.sin(ang - rd), Math.cos(ang - rd));
      const g = Math.exp(-(da * da) / 0.09);
      if (g > crest) crest = g;
    }
    let mh = peak.h * Math.pow(p, 1.35) * (0.82 + 0.18 * (1 - mid) + 0.18 * crest * mid);
    mh += peak.h * 0.30 * crest * Math.pow(mid, 1.4); // aretes stand proud of the faces
    const top = Math.max(0, (p - 0.55) / 0.45);
    mh += peak.h * 0.16 * top * top; // summit pyramid
    // soft terracing -> cliff bands with benches (fades at rim & point)
    const tStep = 6.5;
    const tt = mh / tStep, tf = Math.floor(tt), tfr = tt - tf;
    const terr = (tf + tfr * tfr * (3 - 2 * tfr)) * tStep;
    mh += (terr - mh) * 0.48 * Math.min(1, p * 3) * (1 - top * 0.7);
    mHeight += mh;
    const mHere = Math.pow(p, 1.5);
    if (mHere > mMask) mMask = mHere;
  }
  if (mMask > 0.01) {
    const rn1 = 1 - Math.abs(Math.sin(x * 0.009 + Math.sin(z * 0.007) * 1.7));
    const rn2 = 1 - Math.abs(Math.cos(z * 0.011 + Math.sin(x * 0.005) * 1.3));
    const ridge = rn1 * 0.62 + rn2 * 0.38;
    mHeight += mMask * (ridge - 0.48) * 40;
    mHeight += mMask * Math.sin(x * 0.045 + z * 0.033) * 3.5;
  }
  h += mHeight;
  // rivers: carve the descending channel (only cuts, never raises)
  for (const rv of RIVERS) {
    if (x < rv.bb[0] - rv.w || x > rv.bb[2] + rv.w || z < rv.bb[1] - rv.w || z > rv.bb[3] + rv.w) continue;
    let bestD2 = Infinity, bestBed = 0;
    for (const s of rv.segs) {
      if (x < Math.min(s.ax, s.bx) - rv.w || x > Math.max(s.ax, s.bx) + rv.w || z < Math.min(s.az, s.bz) - rv.w || z > Math.max(s.az, s.bz) + rv.w) continue;
      const vx = s.bx - s.ax, vz = s.bz - s.az;
      let t = ((x - s.ax) * vx + (z - s.az) * vz) / s.len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = s.ax + vx * t, pz = s.az + vz * t;
      const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (d2 < bestD2) { bestD2 = d2; bestBed = rv.src + (rv.dst - rv.src) * ((s.cum + t * s.len) / rv.total); }
    }
    if (bestD2 < rv.w * rv.w && h > bestBed) {
      const f = 1 - Math.sqrt(bestD2) / rv.w;
      const ch = f * f * (3 - 2 * f);
      h = h + (bestBed - h) * Math.pow(ch, 0.75);
    }
  }
  const edge = Math.max(Math.abs(x), Math.abs(z));
  if (edge > 1500) { const t = Math.min(1, (edge - 1500) / 500); h = h * (1 - t) + (-14) * t; }
  return h;
}
// Expansion-zone terrain stamps. MUST match server/map.js exactly.
export function terrainHeight(x, z) {
  let h = terrainNative(x, z);
  for (const zn of EXPANSION_ZONES) {
    const dx = x - zn.x, dz = z - zn.z;
    const R = zn.half + zn.blend;
    const d2 = dx * dx + dz * dz;
    if (d2 >= R * R) continue;
    const g = zn.grid - 1;
    let gx = (dx + zn.half) / (2 * zn.half) * g;
    let gz = (dz + zn.half) / (2 * zn.half) * g;
    gx = gx < 0 ? 0 : gx > g - 0.001 ? g - 0.001 : gx;
    gz = gz < 0 ? 0 : gz > g - 0.001 ? g - 0.001 : gz;
    const ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
    const H = zn.heights, n = zn.grid;
    const a = H[iz * n + ix] * (1 - fx) + H[iz * n + ix + 1] * fx;
    const b = H[(iz + 1) * n + ix] * (1 - fx) + H[(iz + 1) * n + ix + 1] * fx;
    const target = zn._b + a * (1 - fz) + b * fz;
    const d = Math.sqrt(d2);
    let w = 1;
    if (d > zn.half) { const t = (d - zn.half) / zn.blend; w = 1 - t * t * (3 - 2 * t); }
    h = h * (1 - w) + target * w;
  }
  return h;
}
for (const zn of EXPANSION_ZONES) zn._b = terrainNative(zn.x, zn.z);
// 0..1 mountain influence at a point (for colouring / scatter decisions)
export function mountainMask(x, z) {
  let m = 0;
  for (const peak of MOUNTAINS) {
    const dx = x - peak.x, dz = z - peak.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const p = Math.max(0, 1 - d / (peak.r * 1.55));
    const shaped = Math.pow(p, 1.5);
    if (shaped > m) m = shaped;
  }
  return m;
}
export function slopeAt(x, z, eps = 7) {
  const h = terrainHeight(x, z);
  return Math.min(1.6, (Math.abs(terrainHeight(x + eps, z) - h) + Math.abs(terrainHeight(x, z + eps) - h)) / (eps * 0.55));
}
export const WATER_Y = -2;

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = opts.aniso || 4;
  if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
  return t;
}
// grayscale detail used as terrain bump — cheap micro-detail at any distance
function detailBumpTex() {
  const t = canvasTex(256, 256, (g) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 256);
    const r = mulberry32(99);
    for (let i = 0; i < 9000; i++) {
      const v = 90 + Math.floor(r() * 90);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(r() * 256, r() * 256, 1 + r() * 3, 1 + r() * 3);
    }
    for (let i = 0; i < 260; i++) { // soft patches
      const v = 100 + Math.floor(r() * 60);
      g.fillStyle = `rgba(${v},${v},${v},0.25)`;
      g.beginPath(); g.arc(r() * 256, r() * 256, 6 + r() * 22, 0, 7); g.fill();
    }
  }, { repeat: [220, 220] });
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
function facadeTextures(seed, base) {
  const r = mulberry32(seed);
  const map = canvasTex(256, 256, (g) => {
    g.fillStyle = base; g.fillRect(0, 0, 256, 256);
    // panel seams + grime
    g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 2;
    for (let x = 0; x <= 256; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.05})`; g.fillRect(r() * 256, r() * 256, 8 + r() * 30, 20 + r() * 60); }
    // windows
    for (let y = 18; y < 235; y += 34) for (let x = 14; x < 235; x += 38) {
      g.fillStyle = '#1d2735'; g.fillRect(x, y, 24, 22);
      g.fillStyle = 'rgba(160,210,255,0.5)'; g.fillRect(x + 2, y + 2, 9, 8);
      g.strokeStyle = 'rgba(0,0,0,0.45)'; g.strokeRect(x, y, 24, 22);
    }
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 248, 256, 8);
  });
  const emissive = canvasTex(256, 256, (g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
    for (let y = 18; y < 235; y += 34) for (let x = 14; x < 235; x += 38) {
      if (r() < 0.30) { g.fillStyle = r() < 0.7 ? '#ffb45e' : '#bfe3ff'; g.fillRect(x + 1, y + 1, 22, 20); }
    }
  });
  return { map, emissive };
}
function asphaltTex() {
  return canvasTex(128, 128, (g) => {
    g.fillStyle = '#33363c'; g.fillRect(0, 0, 128, 128);
    const r = mulberry32(7);
    for (let i = 0; i < 1600; i++) { const v = 40 + r() * 30; g.fillStyle = `rgb(${v},${v},${v + 4})`; g.fillRect(r() * 128, r() * 128, 2, 2); }
    g.fillStyle = '#e8e8e8'; g.fillRect(2, 0, 3, 128); g.fillRect(123, 0, 3, 128);
    g.fillStyle = '#ffd94d'; g.fillRect(62, 6, 4, 46); // one dash per tile
  });
}
function concreteTex() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#9aa0a6'; g.fillRect(0, 0, w, h);
    const r = mulberry32(31);
    for (let i = 0; i < 2600; i++) { const v = 130 + r() * 60; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(r() * w, r() * h, 2, 2); }
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2;
    g.strokeRect(1, 1, w - 2, h - 2); g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  }, { repeat: [10, 10] });
}
function plankTex(base, line) {
  return canvasTex(128, 128, (g) => {
    g.fillStyle = base; g.fillRect(0, 0, 128, 128);
    const r = mulberry32(base.length * 13 + 5);
    for (let y = 0; y < 128; y += 18) {
      g.fillStyle = line; g.fillRect(0, y, 128, 2);
      for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(0,0,0,${0.04 + r() * 0.07})`; g.fillRect(r() * 128, y + 2 + r() * 14, 8 + r() * 26, 1.6); }
    }
    g.fillStyle = 'rgba(0,0,0,0.5)';
    for (const [x, y] of [[6, 8], [120, 8], [6, 116], [120, 116]]) { g.beginPath(); g.arc(x, y, 2.4, 0, 7); g.fill(); }
  }, { repeat: [2, 2] });
}
const STRUCT_TEX = {};
export function structureMaterial(name) {
  if (STRUCT_TEX[name]) return STRUCT_TEX[name];
  let mat;
  if (name === 'wood') mat = new THREE.MeshStandardMaterial({ map: plankTex('#a9743a', '#7d5527'), bumpMap: detailBumpTex(), bumpScale: 0.4, roughness: 0.92 });
  else if (name === 'stone') mat = new THREE.MeshStandardMaterial({ map: plankTex('#8f939c', '#6d7076'), bumpMap: detailBumpTex(), bumpScale: 0.7, roughness: 0.98 });
  else mat = new THREE.MeshStandardMaterial({ map: plankTex('#5d7d99', '#3d5a74'), roughness: 0.45, metalness: 0.75 });
  STRUCT_TEX[name] = mat;
  return mat;
}
function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
export const GLOW_TEX = typeof document !== 'undefined' ? null : null; // (created lazily in buildWorld)
let _glowTex = null;
export function getGlowTexture() { if (!_glowTex) _glowTex = glowTexture(); return _glowTex; }

/* ============================== SKY ============================== */
export function createSky(scene) {
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3(0.5, 0.62, 0.35).normalize() } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vDir; uniform float uTime; uniform vec3 uSunDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.13; a*=.5; } return v; }
      void main(){
        vec3 dir = normalize(vDir);
        float h = clamp(dir.y, -0.08, 1.0);
        vec3 col = mix(vec3(1.0,0.76,0.52), vec3(0.36,0.62,0.99), smoothstep(0.0,0.55,h));
        col = mix(col, vec3(0.12,0.28,0.74), smoothstep(0.45,1.0,h));
        float sd = max(dot(dir, uSunDir), 0.0);
        col += vec3(1.0,0.85,0.55) * pow(sd, 900.0) * 3.0;
        col += vec3(1.0,0.62,0.28) * pow(sd, 10.0) * 0.38;
        col += vec3(0.9,0.95,1.0) * pow(sd, 90.0) * 0.25;
        // fbm cloud layer with silver lining
        vec2 uv = dir.xz / (abs(dir.y) + 0.30);
        float cl = fbm(uv * 1.35 + vec2(uTime*0.010, uTime*0.004));
        float cover = smoothstep(0.48, 0.72, cl);
        float shade = smoothstep(0.5, 0.85, fbm(uv * 3.1 - uTime*0.006));
        vec3 cloudCol = mix(vec3(1.07,0.87,0.79), vec3(0.57,0.60,0.85), shade*0.85);
        cloudCol += vec3(1.0,0.68,0.38) * pow(sd, 3.0) * 0.38;
        col = mix(col, cloudCol, cover * smoothstep(0.015, 0.22, dir.y) * 0.88);
        // high cirrus streaks
        float cir = fbm(vec2(uv.x*0.7 + uTime*0.014, uv.y*3.4));
        col += vec3(1.0) * smoothstep(0.62, 0.9, cir) * smoothstep(0.25, 0.6, dir.y) * 0.18;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(5200, 40, 20), skyMat);
  sky.frustumCulled = false;
  scene.add(sky);
  return skyMat;
}

/* ============================== WATER ============================== */
export function createWater(scene) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, fog: false,
    uniforms: { uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3(0.5, 0.62, 0.35).normalize() } },
    vertexShader: `
      uniform float uTime; varying vec3 vWorld; varying vec3 vNormW;
      float waveH(vec2 p, float t){
        return sin(p.x*0.045 + t*1.3)*cos(p.y*0.05 + t*1.05)*0.32
             + sin(p.x*0.16 - t*1.9)*0.10 + cos(p.y*0.21 + t*1.6)*0.08;
      }
      void main(){
        vec4 w = modelMatrix * vec4(position,1.0);
        float t = uTime;
        float h  = waveH(w.xz, t);
        float hx = waveH(w.xz + vec2(2.5,0.0), t);
        float hz = waveH(w.xz + vec2(0.0,2.5), t);
        w.y += h;
        vNormW = normalize(vec3(h-hx, 2.5, h-hz));
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uSunDir; varying vec3 vWorld; varying vec3 vNormW;
      void main(){
        vec3 N = normalize(vNormW);
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        vec3 deep = vec3(0.0,0.30,0.52), shallow = vec3(0.06,0.78,0.86);
        vec3 col = mix(deep, shallow, clamp(fres*0.85 + 0.18, 0.0, 1.0));
        // sun specular (Blinn-Phong)
        vec3 H = normalize(uSunDir + V);
        float spec = pow(max(dot(N, H), 0.0), 240.0);
        col += vec3(1.0,0.9,0.65) * spec * 1.6;
        float glitter = pow(max(dot(N,H),0.0), 720.0) * (0.7 + 0.6*sin(uTime*3.0 + vWorld.x*0.4));
        col += vec3(1.0) * glitter * 2.0;
        float dist = length(cameraPosition - vWorld);
        float alpha = mix(0.92, 0.75, clamp(dist/2600.0, 0.0, 1.0));
        gl_FragColor = vec4(col, alpha);
      }`,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(11000, 11000, 64, 64), mat);
  water.rotation.x = -Math.PI / 2; water.position.y = WATER_Y;
  scene.add(water);
  return mat;
}

/* ============================== STORM ============================== */
export function createStormWall(scene) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      uniform float uTime; varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
      void main(){
        float swirl = noise(vec2(vUv.x*90.0 + uTime*0.7, vUv.y*7.0 - uTime*1.4));
        float stripes = sin(vUv.x*260.0 + uTime*2.0 + swirl*9.0) * 0.5 + 0.5;
        float vert = smoothstep(0.0, 0.22, vUv.y) * (1.0 - smoothstep(0.6, 1.0, vUv.y)*0.75);
        float bolts = step(0.995, noise(vec2(floor(vUv.x*160.0), floor(uTime*3.0)))) * (1.0-vUv.y);
        vec3 col = mix(vec3(0.42,0.08,0.85), vec3(0.78,0.38,1.0), stripes);
        col += vec3(0.9,0.85,1.0) * bolts * 1.6;
        gl_FragColor = vec4(col, ((0.15 + stripes*0.20 + swirl*0.12) * vert + 0.07));
      }`,
  });
  const geo = new THREE.CylinderGeometry(1, 1, 520, 96, 1, true);
  const wall = new THREE.Mesh(geo, mat);
  wall.position.y = 210; wall.frustumCulled = false;
  scene.add(wall);
  return { wall, mat };
}

export function lootBeamMaterial(colorHex) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: { value: Math.random() * 10 }, uColor: { value: new THREE.Color(colorHex) } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
      void main(){
        float pulse = 0.75 + 0.25*sin(uTime*3.2 + vUv.y*16.0);
        float a = pow(1.0 - vUv.y, 1.4) * 0.5 * pulse + smoothstep(0.0,0.25,vUv.y)*0.10;
        gl_FragColor = vec4(uColor * 1.4, a);
      }`,
  });
}

/* ============================== WORLD ============================== */
function roadRibbon(scene, from, to, mat) {
  const pts = [];
  const STEPS = Math.max(6, Math.floor(Math.hypot(to.x - from.x, to.z - from.z) / 26));
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    pts.push(new THREE.Vector3(from.x + (to.x - from.x) * t, 0, from.z + (to.z - from.z) * t));
  }
  const posArr = [], uvArr = [], idx = [];
  pts.forEach((p, i) => {
    const next = pts[Math.min(i + 1, STEPS)], prev = pts[Math.max(i - 1, 0)];
    const dir = new THREE.Vector3().subVectors(next, prev).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(7.5);
    const a = p.clone().add(side), b = p.clone().sub(side);
    a.y = terrainHeight(a.x, a.z) + 0.28; b.y = terrainHeight(b.x, b.z) + 0.28;
    posArr.push(a.x, a.y, a.z, b.x, b.y, b.z);
    uvArr.push(0, i * 2.2, 1, i * 2.2);
    if (i < STEPS) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  scene.add(m);
}

/* ---- distant ridge backdrops (layered GTA-style mountain silhouettes) ---- */
function ridgeRing(baseR, topMin, topVar, seed, colBottom, colMid, colTop) {
  const SEG = 180, rows = 3;
  const posArr = [], colArr = [], idx = [];
  const cols = [new THREE.Color(colBottom), new THREE.Color(colMid), new THREE.Color(colTop)];
  const peakH = [];
  for (let i = 0; i <= SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    const n = 0.5 + 0.28 * Math.sin(a * 7 + seed) + 0.16 * Math.sin(a * 17 + seed * 2.7) + 0.10 * Math.sin(a * 31 + seed * 5.1);
    const spike = Math.pow(Math.max(0, Math.sin(a * 11 + seed * 3.3)), 3) * 0.35;
    peakH.push(topMin + (n + spike) * topVar);
  }
  for (let i = 0; i <= SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const top = peakH[i];
    const rowData = [
      { r: baseR, y: -45 },
      { r: baseR + 90, y: top * 0.52 },
      { r: baseR + 190, y: top },
    ];
    rowData.forEach((row, ri) => {
      posArr.push(ca * row.r, row.y, sa * row.r);
      const c = cols[ri];
      colArr.push(c.r, c.g, c.b);
    });
    if (i < SEG) {
      const k = i * rows;
      for (let rI = 0; rI < rows - 1; rI++) idx.push(k + rI, k + rI + 1, k + rI + rows, k + rI + 1, k + rI + rows + 1, k + rI + rows);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colArr, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, side: THREE.DoubleSide }));
  m.frustumCulled = false;
  return m;
}
function createMountainBackdrop(scene) {
  scene.add(ridgeRing(2550, 200, 300, 1.7, 0x51637c, 0x7488a4, 0xe8f1fb));
  scene.add(ridgeRing(3500, 340, 420, 4.2, 0x5d7191, 0x8699b5, 0xf2f7fd));
}

/* ---- waterfall: ribbon following the downhill gradient, animated foam shader ---- */
const waterfallTime = { value: 0 };
function createWaterfall(scene, startX, startZ, pullX, pullZ) {
  const pts = [];
  let x = startX, z = startZ;
  for (let i = 0; i < 34; i++) {
    pts.push({ x, z, y: terrainHeight(x, z) });
    const e = 9;
    const gx = (terrainHeight(x + e, z) - terrainHeight(x - e, z)) / (2 * e);
    const gz = (terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
    let dx = -gx * 3.2 + (pullX - x) * 0.0016, dz = -gz * 3.2 + (pullZ - z) * 0.0016;
    const l = Math.hypot(dx, dz) || 1;
    x += (dx / l) * 13; z += (dz / l) * 13;
    if (terrainHeight(x, z) < 6) break;
  }
  if (pts.length < 6) return null;
  const posArr = [], uvArr = [], idx = [];
  let dist = 0;
  pts.forEach((p, i) => {
    const next = pts[Math.min(i + 1, pts.length - 1)], prev = pts[Math.max(i - 1, 0)];
    if (i > 0) dist += Math.hypot(p.x - prev.x, p.z - prev.z);
    let dx = next.x - prev.x, dz = next.z - prev.z;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const sx = -dz * 1.9, sz = dx * 1.9;
    posArr.push(p.x - sx, p.y + 0.5, p.z - sz, p.x + sx, p.y + 0.5, p.z + sz);
    uvArr.push(0, dist / 9, 1, dist / 9);
    if (i < pts.length - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uTime: waterfallTime },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      uniform float uTime; varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
      void main(){
        float flow = noise(vec2(vUv.x*7.0, vUv.y*6.0 - uTime*1.9));
        float streaks = 0.65 + 0.35*sin(vUv.y*90.0 - uTime*14.0 + flow*7.0);
        vec3 col = mix(vec3(0.62,0.83,0.98), vec3(1.0), flow*streaks);
        float edge = smoothstep(0.0,0.3,vUv.x) * smoothstep(1.0,0.7,vUv.x);
        float head = smoothstep(0.0, 2.5, vUv.y);
        gl_FragColor = vec4(col, 0.82 * edge * head);
      }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  scene.add(mesh);
  // foam glow at the plunge pool
  const end = pts[pts.length - 1];
  const foam = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTexture(), color: 0xdff4ff, transparent: true, opacity: 0.55, depthWrite: false }));
  foam.scale.set(17, 8, 1); foam.position.set(end.x, end.y + 1.6, end.z);
  scene.add(foam);
  return mesh;
}

/* ---- summit structures: observatory on Apex, radio tower on Titan ---- */
function createSummitProps(scene, colliders) {
  const concrete = new THREE.MeshStandardMaterial({ color: 0xb9bec7, roughness: 0.85 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x39424f, roughness: 0.4, metalness: 0.7 });
  // Observatory — Mount Apex
  const apex = MOUNTAINS[0];
  const ay = terrainHeight(apex.x, apex.z);
  const obs = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(8, 9.5, 6, 14), concrete); base.position.y = 3; base.castShadow = true;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(7.6, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe8edf4, roughness: 0.25, metalness: 0.55 }));
  dome.position.y = 6; dome.castShadow = true;
  const slit = new THREE.Mesh(new THREE.BoxGeometry(2.2, 5.5, 8.5), metal); slit.position.set(0, 8.6, 2.4); slit.rotation.x = -0.5;
  const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 7, 10), metal); scope.position.set(0, 9.4, 3.4); scope.rotation.x = -0.9;
  obs.add(base, dome, slit, scope);
  obs.position.set(apex.x, ay - 0.4, apex.z);
  scene.add(obs);
  colliders.push({ minX: apex.x - 9, maxX: apex.x + 9, minZ: apex.z - 9, maxZ: apex.z + 9, minY: ay - 0.5, maxY: ay + 6, type: 'building' });
  // Radio tower — Titan Peak
  const titan = MOUNTAINS[2];
  const ty = terrainHeight(titan.x, titan.z);
  const tower = new THREE.Group();
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 2.4, 44, 6), metal); mast.position.y = 22; mast.castShadow = true;
  tower.add(mast);
  for (let i = 1; i <= 4; i++) {
    const cross = new THREE.Mesh(new THREE.BoxGeometry(7 - i, 0.5, 0.5), metal);
    cross.position.y = i * 9; tower.add(cross);
    const cross2 = cross.clone(); cross2.rotation.y = Math.PI / 2; tower.add(cross2);
  }
  const dish = new THREE.Mesh(new THREE.SphereGeometry(3.4, 12, 6, 0, Math.PI * 2, 0, 0.9), new THREE.MeshStandardMaterial({ color: 0xdfe6ee, roughness: 0.3, metalness: 0.4, side: THREE.DoubleSide }));
  dish.position.set(2.6, 30, 0); dish.rotation.z = -0.9;
  const hut = new THREE.Mesh(new THREE.BoxGeometry(6, 3.4, 5), concrete); hut.position.set(6, 1.7, 3); hut.castShadow = true;
  tower.add(dish, hut);
  tower.position.set(titan.x, ty - 0.3, titan.z);
  scene.add(tower);
  colliders.push({ minX: titan.x - 3, maxX: titan.x + 9, minZ: titan.z - 3, maxZ: titan.z + 6, minY: ty - 0.5, maxY: ty + 4, type: 'building' });
  // blinking aviation light
  const lightMat = new THREE.SpriteMaterial({ map: getGlowTexture(), color: 0xff4444, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending });
  const beacon = new THREE.Sprite(lightMat);
  beacon.scale.set(9, 9, 1); beacon.position.set(titan.x, ty + 45, titan.z);
  scene.add(beacon);
  const apexBeacon = beacon.clone(); apexBeacon.material = lightMat;
  apexBeacon.position.set(apex.x, ay + 15, apex.z); apexBeacon.scale.set(7, 7, 1);
  scene.add(apexBeacon);
  return { beaconMat: lightMat };
}

export function buildWorld(scene, data, quality = {}) {
  const colliders = [];
  const grassCount = quality.grass != null ? quality.grass : 8000;
  const SEG = quality.seg || 192;
  const rng = mulberry32(20240);
  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();

  /* ---- terrain ---- */
  const geo = new THREE.PlaneGeometry(4000, 4000, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cGrass = new THREE.Color(0x43b02c), cGrass2 = new THREE.Color(0xb9e356), cSand = new THREE.Color(0xf7d774),
    cRock = new THREE.Color(0x8d8378), cRockDark = new THREE.Color(0x5d5a54), cSnow = new THREE.Color(0xffffff), cDirt = new THREE.Color(0xa8834f), cScorch = new THREE.Color(0x77a83b),
    cForest = new THREE.Color(0x1e6b30), cScree = new THREE.Color(0xa49a86), cWet = new THREE.Color(0x4f4a33);
  const tmp = new THREE.Color();
  const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);
    const slope = Math.min(1, (Math.abs(terrainHeight(x + 8, z) - h) + Math.abs(terrainHeight(x, z + 8) - h)) / 7);
    const n = 0.5 + 0.5 * Math.sin(x * 0.021 + z * 0.017) * Math.sin(x * 0.006 - z * 0.011);
    const mm = mountainMask(x, z);
    if (h < 1.2) tmp.copy(cSand).lerp(cDirt, n * 0.3);
    else {
      tmp.copy(cGrass).lerp(cGrass2, n);
      tmp.lerp(cScorch, Math.max(0, n - 0.72) * 0.8);
      tmp.lerp(cForest, mm * 0.55 * (1 - slope));                    // dark alpine forest floor
      tmp.lerp(cDirt, slope * 0.4);
      tmp.lerp(cScree, smooth(28, 70, h) * 0.45 * (1 - slope));      // scree aprons
      tmp.lerp(cRock, Math.max(0, slope - 0.34) * 1.25);             // exposed cliffs
      tmp.lerp(cRockDark, smooth(45, 120, h) * slope * 0.55);       // high dark rock
      const snow = smooth(76, 126, h + n * 30) * (1 - Math.max(0, slope - 0.55) * 1.6);
      tmp.lerp(cSnow, Math.max(0, Math.min(1, snow)));               // snowfields & caps
      if (h > 55) tmp.lerp(cRock, smooth(55, 95, h) * 0.25);
      // geological strata bands on exposed mountain rock
      if (mm > 0.12 && slope > 0.28) {
        const strata = 0.90 + 0.10 * Math.sin(h * 0.52 + n * 1.6) + 0.05 * Math.sin(h * 1.7);
        tmp.r *= strata; tmp.g *= strata; tmp.b *= strata;
      }
      // wet banks + dark bed inside river channels
      const rf = riverAt(x, z);
      if (rf && h < rf.bed + 2.6) {
        const wet = (1 - Math.max(0, h - rf.bed) / 2.6) * Math.min(1, Math.max(0, (rf.w - rf.d) / rf.w) + 0.25);
        tmp.lerp(cWet, Math.min(0.62, wet * 0.62));
      }
    }
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, bumpMap: detailBumpTex(), bumpScale: 1.4 });
  // procedural micro-detail: multi-scale ground speckle + dry patches so the
  // terrain reads as textured earth up close instead of flat vertex color
  terrainMat.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying vec3 vGW;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\n vGW = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = ('varying vec3 vGW;\n' +
      'float thash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n' +
      'float tnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(thash(i), thash(i + vec2(1, 0)), f.x), mix(thash(i + vec2(0, 1)), thash(i + vec2(1, 1)), f.x), f.y); }\n' +
      sh.fragmentShader).replace('#include <color_fragment>', `#include <color_fragment>
      float gnd1 = tnoise(vGW.xz * 0.33);
      float gnd2 = tnoise(vGW.xz * 0.045);
      float gnd3 = tnoise(vGW.xz * 2.7);
      diffuseColor.rgb *= 0.84 + gnd1 * 0.20 + gnd3 * 0.12;
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.07, 0.97, 0.80), smoothstep(0.55, 0.85, gnd2) * 0.45);
    `);
  };
  const terrain = new THREE.Mesh(geo, terrainMat);
  terrain.receiveShadow = true;
  scene.add(terrain);

  /* ---- roads & plazas ---- */
  const roadMat = new THREE.MeshStandardMaterial({ map: asphaltTex(), roughness: 0.94 });
  const hub = { x: 0, z: 0 };
  data.pois.forEach((p, i) => {
    roadRibbon(scene, p, hub, roadMat);
    if (i > 0) roadRibbon(scene, data.pois[i - 1], p, roadMat);
    const cg = new THREE.CircleGeometry(p.r * 0.58, 36);
    cg.rotateX(-Math.PI / 2);
    const cp = cg.attributes.position;
    for (let v = 0; v < cp.count; v++) cp.setY(v, terrainHeight(p.x + cp.getX(v), p.z + cp.getZ(v)) + 0.20);
    cg.computeVertexNormals();
    const plaza = new THREE.Mesh(cg, new THREE.MeshStandardMaterial({ map: concreteTex(), roughness: 0.95 }));
    plaza.position.set(p.x, 0, p.z); plaza.receiveShadow = true;
    scene.add(plaza);
  });

  /* ---- buildings (variants + doors + rooftop props) ---- */
  const facades = [facadeTextures(11, '#c8ccd4'), facadeTextures(23, '#cbb59a'), facadeTextures(37, '#aebfd0'), facadeTextures(51, '#d3a7a0')];
  const facadeMats = facades.map(f => new THREE.MeshStandardMaterial({ map: f.map, emissiveMap: f.emissive, emissive: new THREE.Color(0xffc98a), emissiveIntensity: 0.55, roughness: 0.88 }));
  const ROOF_COLORS = [0xb5442f, 0xd2691e, 0xc2571b, 0x8e3b46, 0x3f6d8e, 0x7a4a2f]; // key-art red/orange town roofs
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const buildingsGroup = new THREE.Group();
  const acMesh = new THREE.InstancedMesh(unitBox, new THREE.MeshStandardMaterial({ color: 0x9aa2ac, roughness: 0.6, metalness: 0.5 }), Math.max(1, data.buildings.length));
  const doorMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 3.6, 0.3), new THREE.MeshStandardMaterial({ color: 0x27324a, roughness: 0.4, metalness: 0.3 }), Math.max(1, data.buildings.length));
  let acI = 0;
  data.buildings.forEach((b, bi) => {
    const gy = terrainHeight(b.x, b.z);
    const poiTint = new THREE.Color(b.color);
    const m = new THREE.Mesh(unitBox, facadeMats[bi % facadeMats.length]);
    m.material = m.material.clone(); m.material.color = poiTint.lerp(new THREE.Color(0xffffff), 0.55);
    m.scale.set(b.w, b.h, b.d);
    m.position.set(b.x, gy + b.h / 2 - 0.5, b.z);
    m.rotation.y = b.rot || 0; m.castShadow = true; m.receiveShadow = true;
    const roof = new THREE.Mesh(unitBox, new THREE.MeshStandardMaterial({ color: ROOF_COLORS[bi % ROOF_COLORS.length], roughness: 0.95, bumpMap: detailBumpTex(), bumpScale: 0.8 }));
    roof.scale.set(b.w + 1.6, 1.1, b.d + 1.6);
    roof.position.set(b.x, gy + b.h + 0.05, b.z); roof.rotation.y = b.rot || 0; roof.castShadow = true;
    buildingsGroup.add(m, roof);
    dummy.position.set(b.x + (rng() - 0.5) * b.w * 0.4, gy + b.h + 1.3, b.z + (rng() - 0.5) * b.d * 0.4);
    dummy.scale.set(3.2, 1.6, 2.6); dummy.rotation.set(0, rng() * 3, 0); dummy.updateMatrix();
    acMesh.setMatrixAt(acI++, dummy.matrix);
    const doorOff = new THREE.Vector3(0, 0, b.d / 2 + 0.2).applyAxisAngle(new THREE.Vector3(0, 1, 0), b.rot || 0);
    dummy.position.set(b.x + doorOff.x, gy + 1.8, b.z + doorOff.z);
    dummy.scale.set(1, 1, 1); dummy.rotation.set(0, b.rot || 0, 0); dummy.updateMatrix();
    doorMesh.setMatrixAt(bi, dummy.matrix);
    colliders.push({ minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2, minY: gy - 0.5, maxY: gy + b.h, type: 'building' });
  });
  acMesh.count = acI;
  buildingsGroup.add(acMesh, doorMesh);
  scene.add(buildingsGroup);

  /* ---- street lamps (instanced + one additive Points glow) ---- */
  const lampPos = [];
  data.buildings.forEach(b => { if (rng() < 0.8) lampPos.push({ x: b.x + b.w / 2 + 3.5, z: b.z + b.d / 2 + 3.5 }); });
  const lampPole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.14, 5.6, 6), new THREE.MeshStandardMaterial({ color: 0x2c313a, roughness: 0.5, metalness: 0.6 }), Math.max(1, lampPos.length));
  const lampHead = new THREE.InstancedMesh(new THREE.SphereGeometry(0.34, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffe6b0, emissive: 0xffc873, emissiveIntensity: 2.4 }), Math.max(1, lampPos.length));
  const glowPts = [];
  lampPos.forEach((l, i) => {
    const y = terrainHeight(l.x, l.z);
    dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1);
    dummy.position.set(l.x, y + 2.8, l.z); dummy.updateMatrix(); lampPole.setMatrixAt(i, dummy.matrix);
    dummy.position.y = y + 5.7; dummy.updateMatrix(); lampHead.setMatrixAt(i, dummy.matrix);
    glowPts.push(l.x, y + 5.7, l.z);
  });
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.Float32BufferAttribute(glowPts, 3));
  const glow = new THREE.Points(glowGeo, new THREE.PointsMaterial({ map: getGlowTexture(), color: 0xffca7a, size: 7, sizeAttenuation: true, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(lampPole, lampHead, glow);

  /* ---- town dressing: welcome signs, benches, bins, hydrants, hedges ---- */
  {
    const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
    const collect = (arr, x, y, z, ry, sx = 1, sy = 1, sz = 1) => {
      _e.set(0, ry, 0); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(sx, sy, sz);
      _m4.compose(_p, _q, _s); arr.push(_m4.clone());
    };
    const benchM = [], binM = [], hydM = [], hedgeM = [];
    const postMat = new THREE.MeshStandardMaterial({ color: 0x54432c, roughness: 1 });
    const postGeo = new THREE.CylinderGeometry(0.09, 0.11, 2.7, 6);
    data.pois.forEach((poi) => {
      const dl = Math.hypot(poi.x, poi.z) || 1;
      const dirx = -poi.x / dl, dirz = -poi.z / dl; // toward map centre (road in)
      const sx = poi.x + dirx * poi.r * 0.62, sz = poi.z + dirz * poi.r * 0.62;
      const sign = new THREE.Group();
      sign.position.set(sx, terrainHeight(sx, sz), sz);
      sign.rotation.y = Math.atan2(dirx, dirz);
      const p1 = new THREE.Mesh(postGeo, postMat); p1.position.set(-1.9, 1.35, 0);
      const p2 = new THREE.Mesh(postGeo, postMat); p2.position.set(1.9, 1.35, 0);
      const boardTex = canvasTex(512, 160, (c2d, w2, h2) => {
        c2d.fillStyle = '#17325e'; c2d.fillRect(0, 0, w2, h2);
        c2d.strokeStyle = '#ffd23f'; c2d.lineWidth = 10; c2d.strokeRect(8, 8, w2 - 16, h2 - 16);
        c2d.font = '900 54px Segoe UI, sans-serif'; c2d.textAlign = 'center';
        c2d.fillStyle = '#ffd23f'; c2d.fillText(poi.name.toUpperCase(), w2 / 2, 76);
        c2d.font = '700 34px Segoe UI, sans-serif'; c2d.fillStyle = '#cfe3ff';
        c2d.fillText('· DROPZONE ISLAND ·', w2 / 2, 124);
      });
      boardTex.wrapS = boardTex.wrapT = THREE.ClampToEdgeWrapping;
      const board = new THREE.Mesh(new THREE.BoxGeometry(5.4, 1.7, 0.16), new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.7 }));
      board.position.y = 2.1; board.castShadow = true;
      sign.add(p1, p2, board);
      scene.add(sign);
      for (let k = 0; k < 5; k++) {
        const a = rng() * Math.PI * 2, rad = poi.r * (0.22 + rng() * 0.3);
        const bx = poi.x + Math.cos(a) * rad, bz = poi.z + Math.sin(a) * rad;
        collect(benchM, bx, terrainHeight(bx, bz), bz, a + Math.PI / 2);
      }
      for (let k = 0; k < 4; k++) {
        const a = rng() * Math.PI * 2, rad = poi.r * (0.2 + rng() * 0.35);
        const bx = poi.x + Math.cos(a) * rad, bz = poi.z + Math.sin(a) * rad;
        collect(binM, bx, terrainHeight(bx, bz), bz, a);
      }
      for (let k = 0; k < 3; k++) {
        const a = rng() * Math.PI * 2, rad = poi.r * (0.3 + rng() * 0.35);
        const bx = poi.x + Math.cos(a) * rad, bz = poi.z + Math.sin(a) * rad;
        collect(hydM, bx, terrainHeight(bx, bz), bz, a);
      }
      for (let k = 0; k < 12; k++) {
        if (rng() < 0.3) continue;
        const a = (k / 12) * Math.PI * 2 + rng() * 0.2, rad = poi.r * 0.5;
        const bx = poi.x + Math.cos(a) * rad, bz = poi.z + Math.sin(a) * rad;
        collect(hedgeM, bx, terrainHeight(bx, bz), bz, a + Math.PI / 2);
      }
    });
    const inst = (geo, mat, mats, colorFn) => {
      const im = new THREE.InstancedMesh(geo, mat, Math.max(1, mats.length));
      mats.forEach((m, i) => { im.setMatrixAt(i, m); if (colorFn) im.setColorAt(i, colorFn(i)); });
      im.count = mats.length;
      scene.add(im);
      return im;
    };
    const seatG = new THREE.BoxGeometry(1.9, 0.16, 0.55); seatG.translate(0, 0.46, 0);
    const backG = new THREE.BoxGeometry(1.9, 0.52, 0.12); backG.translate(0, 0.78, -0.24);
    const benchMat = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.9 });
    inst(seatG, benchMat, benchM); inst(backG, benchMat, benchM);
    const binG = new THREE.CylinderGeometry(0.3, 0.26, 0.8, 8); binG.translate(0, 0.4, 0);
    inst(binG, new THREE.MeshStandardMaterial({ color: 0x2e4a34, roughness: 0.6, metalness: 0.35 }), binM);
    const hydG = new THREE.CylinderGeometry(0.15, 0.19, 0.66, 8); hydG.translate(0, 0.33, 0);
    inst(hydG, new THREE.MeshStandardMaterial({ color: 0xc23b2e, roughness: 0.5 }), hydM);
    const hedgeG = new THREE.BoxGeometry(2.3, 0.7, 0.65); hedgeG.translate(0, 0.35, 0);
    inst(hedgeG, new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), hedgeM,
      () => tmpColor.setHSL(0.32 + rng() * 0.05, 0.42, 0.2 + rng() * 0.1));
  }

  /* ---- cars / crates / barrels (instanced) ---- */
  const carSpots = [];
  data.buildings.forEach(b => { if (rng() < 0.42) carSpots.push({ x: b.x + (rng() - 0.5) * (b.w + 14), z: b.z + b.d / 2 + 6 + rng() * 5, rot: Math.floor(rng() * 4) * Math.PI / 2 }); });
  const carBody = new THREE.InstancedMesh(new THREE.BoxGeometry(4.5, 1.05, 2.05), new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.65 }), Math.max(1, carSpots.length));
  const carTop = new THREE.InstancedMesh(new THREE.BoxGeometry(2.3, 0.85, 1.85), new THREE.MeshStandardMaterial({ color: 0x18222f, roughness: 0.15, metalness: 0.4 }), Math.max(1, carSpots.length));
  const carWheel = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10), new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.9 }), Math.max(1, carSpots.length * 4));
  const carPalette = [0xd64541, 0x3f77c9, 0xe8b93c, 0x9aa3ad, 0x37a06b, 0xe8e8ec, 0x7a4fd0];
  let wheelI = 0;
  carSpots.forEach((c, i) => {
    const y = terrainHeight(c.x, c.z);
    dummy.rotation.set(0, c.rot, 0);
    dummy.position.set(c.x, y + 0.85, c.z); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
    carBody.setMatrixAt(i, dummy.matrix); carBody.setColorAt(i, tmpColor.setHex(carPalette[i % carPalette.length]));
    dummy.position.y = y + 1.75; dummy.updateMatrix(); carTop.setMatrixAt(i, dummy.matrix);
    for (const [wx, wz] of [[-1.5, 1.0], [1.5, 1.0], [-1.5, -1.0], [1.5, -1.0]]) {
      const off = new THREE.Vector3(wx, 0, wz).applyAxisAngle(new THREE.Vector3(0, 1, 0), c.rot);
      dummy.position.set(c.x + off.x, y + 0.42, c.z + off.z);
      dummy.rotation.set(Math.PI / 2, 0, c.rot); dummy.updateMatrix();
      carWheel.setMatrixAt(wheelI++, dummy.matrix);
    }
  });
  carWheel.count = wheelI;
  carBody.castShadow = true;
  scene.add(carBody, carTop, carWheel);

  const crateSpots = [];
  data.buildings.forEach(b => { const n = Math.floor(rng() * 3); for (let k = 0; k < n; k++) crateSpots.push({ x: b.x + (rng() - 0.5) * (b.w + 10), z: b.z + (rng() - 0.5) * (b.d + 10), s: 0.9 + rng() * 0.9, r: rng() * 3 }); });
  const crates = new THREE.InstancedMesh(unitBox, new THREE.MeshStandardMaterial({ map: plankTex('#8f6a35', '#6d4f24'), roughness: 0.95 }), Math.max(1, crateSpots.length));
  crateSpots.forEach((c, i) => {
    dummy.position.set(c.x, terrainHeight(c.x, c.z) + c.s * 0.6, c.z);
    dummy.scale.setScalar(c.s * 1.4); dummy.rotation.set(0, c.r, 0); dummy.updateMatrix();
    crates.setMatrixAt(i, dummy.matrix);
  });
  crates.castShadow = true;
  scene.add(crates);

  /* ---- trees: trunk + two foliage blobs, per-instance colour ---- */
  const trunkMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.32, 0.6, 4.6, 7), new THREE.MeshStandardMaterial({ color: 0x74512e, roughness: 1, bumpMap: detailBumpTex(), bumpScale: 0.5 }), Math.max(1, data.trees.length));
  const folMat = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true });
  const canMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(3.4, 1), folMat, Math.max(1, data.trees.length));
  const canMesh2 = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.3, 1), folMat.clone(), Math.max(1, data.trees.length));
  canMesh.castShadow = true; canMesh2.castShadow = true;
  data.trees.forEach((t, i) => {
    const y = terrainHeight(t.x, t.z);
    dummy.rotation.set(0, t.r, 0);
    dummy.position.set(t.x, y + 2.1 * t.s, t.z); dummy.scale.set(t.s, t.s, t.s); dummy.updateMatrix();
    trunkMesh.setMatrixAt(i, dummy.matrix);
    dummy.position.set(t.x, y + 6.4 * t.s, t.z); dummy.scale.set(t.s, t.s * 1.15, t.s); dummy.updateMatrix();
    canMesh.setMatrixAt(i, dummy.matrix);
    canMesh.setColorAt(i, tmpColor.setHSL(0.29 + rng() * 0.06, 0.5, 0.3 + rng() * 0.14));
    dummy.position.set(t.x + 1.1 * t.s, y + 9.0 * t.s, t.z + 0.5 * t.s); dummy.scale.setScalar(t.s); dummy.updateMatrix();
    canMesh2.setMatrixAt(i, dummy.matrix);
    canMesh2.setColorAt(i, tmpColor.setHSL(0.27 + rng() * 0.07, 0.52, 0.34 + rng() * 0.14));
  });
  scene.add(trunkMesh, canMesh, canMesh2);

  /* ---- rocks ---- */
  const rockMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(2.3, 0), new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true, bumpMap: detailBumpTex(), bumpScale: 1.1 }), Math.max(1, data.rocks.length));
  rockMesh.castShadow = true;
  data.rocks.forEach((r, i) => {
    dummy.position.set(r.x, terrainHeight(r.x, r.z) + 0.5, r.z);
    dummy.scale.set(r.s, r.s * (0.7 + rng() * 0.5), r.s); dummy.rotation.set(r.r, r.r * 2, 0); dummy.updateMatrix();
    rockMesh.setMatrixAt(i, dummy.matrix);
    rockMesh.setColorAt(i, tmpColor.setHSL(0.08, 0.04 + rng() * 0.05, 0.42 + rng() * 0.18));
  });
  scene.add(rockMesh);

  /* ---- grass / bushes / flowers (wind-swayed instancing) ---- */
  const grassTime = { value: 0 };
  function scatter(count, placer) {
    const out = [];
    let guard = count * 30;
    while (out.length < count && guard-- > 0) {
      const x = (rng() - 0.5) * 3750, z = (rng() - 0.5) * 3750;
      const y = terrainHeight(x, z);
      if (y < 0.6) continue;
      let inPoi = false;
      for (const p of data.pois) { const dx = x - p.x, dz = z - p.z; if (dx * dx + dz * dz < (p.r * 0.55) ** 2) { inPoi = true; break; } }
      if (inPoi) continue;
      out.push(placer(x, y, z));
    }
    return out;
  }
  const grassCam = { value: new THREE.Vector3() };
  /* ==== SINGULAR GRASS BLADES — camera-wrapped infinite meadow ====
     Every instance is ONE individual blade. Blades live in a tile that wraps
     around the camera (uCamPos), so the meadow is always dense right where
     you stand. Ground height comes from a baked heightmap of the real
     deterministic terrain, hiding blades under water / in POI plazas /
     on cliffs via slope estimation. */
  const grassTile = grassCount >= 40000 ? 150 : grassCount >= 18000 ? 128 : 92;
  const HT = grassCount >= 40000 ? 1024 : 512;
  const hdata = new Uint16Array(HT * HT);
  for (let j = 0; j < HT; j++) for (let i = 0; i < HT; i++) {
    hdata[j * HT + i] = THREE.DataUtils.toHalfFloat(terrainHeight((i / (HT - 1)) * 4000 - 2000, (j / (HT - 1)) * 4000 - 2000));
  }
  const htex = new THREE.DataTexture(hdata, HT, HT, THREE.RedFormat, THREE.HalfFloatType);
  htex.minFilter = THREE.LinearFilter; htex.magFilter = THREE.LinearFilter;
  htex.wrapS = htex.wrapT = THREE.ClampToEdgeWrapping;
  htex.needsUpdate = true;
  const poiVecs = [];
  for (let i = 0; i < 10; i++) { const p = data.pois[i]; poiVecs.push(p ? new THREE.Vector4(p.x, p.z, p.r * 0.55, 0) : new THREE.Vector4(0, 0, -1, 0)); }
  const grassMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    fog: true,
    uniforms: {
      uTime: grassTime,
      uCamPos: grassCam,
      uHeight: { value: htex },
      uTile: { value: grassTile },
      uSunDir: { value: new THREE.Vector3(0.5, 0.62, 0.35).normalize() },
      uPois: { value: poiVecs },
      fogColor: { value: new THREE.Color(0xdcd7ee) },
      fogNear: { value: 320 },
      fogFar: { value: 4200 },
    },
    vertexShader: `
      attribute vec3 aOffset;
      attribute vec4 aRand;
      attribute float aH;
      uniform float uTime;
      uniform vec3 uCamPos;
      uniform sampler2D uHeight;
      uniform float uTile;
      uniform vec4 uPois[10];
      uniform vec3 uSunDir;
      varying float vH;
      varying float vJit;
      varying float vTrans;
      #include <fog_pars_vertex>
      float groundAt(vec2 w) { return texture2D(uHeight, (w + 2000.0) / 4000.0).r; }
      void main() {
        vH = aH;
        vJit = aRand.w;
        vec2 wrapped = mod(aOffset.xz - uCamPos.xz + uTile * 0.5, uTile) - uTile * 0.5;
        vec2 wxz = uCamPos.xz + wrapped;
        float g = groundAt(wxz);
        float slope = (abs(groundAt(wxz + vec2(5.0, 0.0)) - g) + abs(groundAt(wxz + vec2(0.0, 5.0)) - g)) * 0.2;
        float fade = (1.0 - smoothstep(uTile * 0.33, uTile * 0.49, length(wrapped)))
                   * (1.0 - smoothstep(0.45, 0.95, slope));
        if (g < 0.55) fade = 0.0;
        for (int i = 0; i < 10; i++) {
          vec2 dp = wxz - uPois[i].xy;
          float rr = uPois[i].z;
          if (rr > 0.0 && dot(dp, dp) < rr * rr) { fade = 0.0; break; }
        }
        float ca = cos(aRand.x), sa = sin(aRand.x);
        vec3 p = position;
        p.x *= 0.85 + aRand.w * 0.6;
        p.z += aRand.z * aH;                       // individual lean
        p = vec3(p.x * ca - p.z * sa, p.y * aRand.y, p.x * sa + p.z * ca);
        p *= fade;
        vec3 world = vec3(wxz.x, g - 0.1, wxz.y) + p;
        float gust = sin(uTime * 1.25 + wxz.x * 0.045 + wxz.y * 0.06) * 0.5 + 0.5;
        float flutter = sin(uTime * 2.3 + wxz.x * 0.33 + wxz.y * 0.27 + aRand.x * 7.0);
        float bendAmt = (flutter * 0.08 + gust * gust * 0.30) * aH * aH * aRand.y;
        world.x += bendAmt * 0.55;
        world.z += bendAmt * 0.30;
        vec3 vdir = world - uCamPos;
        vTrans = pow(max(dot(normalize(vdir), uSunDir), 0.0), 3.0) * aH;
        vec4 mvPosition = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      varying float vH;
      varying float vJit;
      varying float vTrans;
      #include <fog_pars_fragment>
      void main() {
        vec3 col = mix(vec3(0.10, 0.21, 0.045), vec3(0.44, 0.76, 0.19), vH);
        col *= 0.75 + vJit * 0.5;
        col *= 0.70 + 0.45 * vH;
        col += vec3(1.0, 0.88, 0.5) * vTrans * 0.5;
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }`,
  });
  const bladeGeo = new THREE.InstancedBufferGeometry();
  {
    // one blade: 4 levels, tapering, forward-curved
    const lv = [[0, 0.048, 0], [0.4, 0.038, 0.02], [0.75, 0.023, 0.08], [1, 0.002, 0.2]];
    const bp = [], bh = [], bi = [];
    lv.forEach(([y, w, bz]) => { bp.push(-w, y, bz, w, y, bz); bh.push(y, y); });
    for (let s = 0; s < 3; s++) { const a = s * 2; bi.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    bladeGeo.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
    bladeGeo.setAttribute('aH', new THREE.Float32BufferAttribute(bh, 1));
    bladeGeo.setIndex(bi);
    const n = Math.max(1, grassCount);
    const offs = new Float32Array(n * 3), rands = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      offs[i * 3] = rng() * grassTile; offs[i * 3 + 1] = 0; offs[i * 3 + 2] = rng() * grassTile;
      rands[i * 4] = rng() * Math.PI * 2;
      rands[i * 4 + 1] = 0.8 + rng() * 0.95;   // height 0.8–1.75 m
      rands[i * 4 + 2] = rng() * 0.35;          // lean
      rands[i * 4 + 3] = rng();                // color jitter
    }
    bladeGeo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offs, 3));
    bladeGeo.setAttribute('aRand', new THREE.InstancedBufferAttribute(rands, 4));
    bladeGeo.instanceCount = n;
  }
  const grassMesh = new THREE.Mesh(bladeGeo, grassMat);
  grassMesh.frustumCulled = false;
  scene.add(grassMesh);

  const vegScale = Math.max(0.5, Math.min(2.2, grassCount / 9000));
  const bushCount = Math.round(320 * vegScale);
  const bushMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.5, 1), new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), Math.max(1, bushCount));
  scatter(bushCount, (x, y, z) => {
    dummy.position.set(x, y + 0.8, z);
    dummy.scale.set(1 + rng() * 1.6, 0.7 + rng() * 0.7, 1 + rng() * 1.6);
    dummy.rotation.set(0, rng() * 3, 0); dummy.updateMatrix();
    return dummy.matrix.clone();
  }).forEach((m, i) => { bushMesh.setMatrixAt(i, m); bushMesh.setColorAt(i, tmpColor.setHSL(0.3, 0.45, 0.26 + rng() * 0.14)); });
  bushMesh.castShadow = true;
  scene.add(bushMesh);

  const flowerCount = Math.round(600 * vegScale);
  const flowerMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.17, 6, 5), new THREE.MeshStandardMaterial({ roughness: 0.6, emissiveIntensity: 0.25 }), Math.max(1, flowerCount));
  const flowerCols = [0xff5e8a, 0xffd94d, 0xffffff, 0xc77dff, 0xff8c42];
  scatter(flowerCount, (x, y, z) => {
    dummy.position.set(x, y + 0.5 + rng() * 0.4, z);
    dummy.scale.setScalar(0.8 + rng()); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
    return dummy.matrix.clone();
  }).forEach((m, i) => { flowerMesh.setMatrixAt(i, m); flowerMesh.setColorAt(i, tmpColor.setHex(flowerCols[i % flowerCols.length])); });
  scene.add(flowerMesh);

  /* ---- pebbles & ground clutter (micro-detail) ---- */
  const pebbleCount = Math.round(2400 * vegScale);
  const pebbleMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.34, 0), new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), Math.max(1, pebbleCount));
  scatter(pebbleCount, (x, y, z) => {
    dummy.position.set(x, y + 0.03, z);
    dummy.scale.set(0.5 + rng() * 1.6, 0.35 + rng() * 0.8, 0.5 + rng() * 1.6);
    dummy.rotation.set(rng() * 3, rng() * 3, rng() * 3); dummy.updateMatrix();
    return dummy.matrix.clone();
  }).forEach((m, i) => { pebbleMesh.setMatrixAt(i, m); pebbleMesh.setColorAt(i, tmpColor.setHSL(0.08, 0.04 + rng() * 0.08, 0.3 + rng() * 0.26)); });
  pebbleMesh.receiveShadow = true;
  scene.add(pebbleMesh);

  /* ---- fallen twigs & branches (ground clutter) ---- */
  const twigCount = Math.round(700 * vegScale);
  const twigMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.07, 1.7, 5), new THREE.MeshStandardMaterial({ color: 0x5d4126, roughness: 1 }), Math.max(1, twigCount));
  scatter(twigCount, (x, y, z) => {
    dummy.position.set(x, y + 0.07, z);
    dummy.scale.set(1, 0.7 + rng() * 0.9, 1);
    dummy.rotation.set(Math.PI / 2 + (rng() - 0.5) * 0.25, 0, rng() * Math.PI);
    dummy.updateMatrix();
    return dummy.matrix.clone();
  }).forEach((m, i) => twigMesh.setMatrixAt(i, m));
  scene.add(twigMesh);

  /* ---- dense decorative pine forests + cliff boulders (visual density) ---- */
  const roadSegs = [];
  data.pois.forEach((p, i) => {
    roadSegs.push([p, { x: 0, z: 0 }]);
    if (i > 0) roadSegs.push([data.pois[i - 1], p]);
  });
  function distToRoads(x, z) {
    let best = 1e9;
    for (const [a, b] of roadSegs) {
      const vx = b.x - a.x, vz = b.z - a.z;
      const wx = x - a.x, wz = z - a.z;
      const t = Math.max(0, Math.min(1, (wx * vx + wz * vz) / (vx * vx + vz * vz || 1)));
      const d = Math.hypot(x - (a.x + vx * t), z - (a.z + vz * t));
      if (d < best) best = d;
    }
    return best;
  }
  function scatterAccept(count, accept) {
    const out = [];
    let guard = count * 60;
    while (out.length < count && guard-- > 0) {
      const x = (rng() - 0.5) * 3800, z = (rng() - 0.5) * 3800;
      const y = terrainHeight(x, z);
      const v = accept(x, y, z);
      if (v) out.push(v);
    }
    return out;
  }
  const detailScale = Math.max(0.35, Math.min(2.4, grassCount / 8000));
  const pineCount = Math.round(2400 * detailScale);
  const pineSpots = scatterAccept(pineCount, (x, y, z) => {
    if (y < 6 || y > 118) return null;
    const mm = mountainMask(x, z);
    if (y < 30 && mm < 0.12 && rng() < 0.55) return null; // thickest on mountain slopes
    if (slopeAt(x, z) > 0.95) return null;
    if (distToRoads(x, z) < 13) return null;
    for (const p of data.pois) { const dx = x - p.x, dz = z - p.z; if (dx * dx + dz * dz < (p.r * 0.6) ** 2) return null; }
    return { x, y, z, s: 0.8 + rng() * 1.1, r: rng() * 3 };
  });
  const pineTrunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.42, 3.6, 6), new THREE.MeshStandardMaterial({ color: 0x5d4126, roughness: 1 }), Math.max(1, pineSpots.length));
  const pineFol = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true });
  const swayify = (mat) => {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = grassTime;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          vec4 pwp = instanceMatrix * vec4(0.0,0.0,0.0,1.0);
          float psw = sin(uTime*1.1 + pwp.x*0.05 + pwp.z*0.043) * 0.12 * smoothstep(-4.5, 4.5, position.y);
          transformed.x += psw; transformed.z += psw * 0.5;
        #endif
      `);
    };
    mat.customProgramCacheKey = () => 'pineSway';
    return mat;
  };
  swayify(pineFol);
  const pineCan = new THREE.InstancedMesh(new THREE.ConeGeometry(2.6, 8.5, 7), pineFol, Math.max(1, pineSpots.length));
  const pineCan2 = new THREE.InstancedMesh(new THREE.ConeGeometry(1.8, 6, 7), swayify(pineFol.clone()), Math.max(1, pineSpots.length));
  pineCan.castShadow = true;
  pineSpots.forEach((t, i) => {
    dummy.rotation.set(0, t.r, 0);
    dummy.position.set(t.x, t.y + 1.7 * t.s, t.z); dummy.scale.setScalar(t.s); dummy.updateMatrix();
    pineTrunk.setMatrixAt(i, dummy.matrix);
    dummy.position.y = t.y + 6.2 * t.s; dummy.updateMatrix();
    pineCan.setMatrixAt(i, dummy.matrix);
    pineCan.setColorAt(i, tmpColor.setHSL(0.33 + rng() * 0.05, 0.42, 0.2 + rng() * 0.1));
    dummy.position.y = t.y + 9.6 * t.s; dummy.scale.setScalar(t.s * 0.9); dummy.updateMatrix();
    pineCan2.setMatrixAt(i, dummy.matrix);
    pineCan2.setColorAt(i, tmpColor.setHSL(0.32 + rng() * 0.05, 0.4, 0.24 + rng() * 0.1));
  });
  scene.add(pineTrunk, pineCan, pineCan2);

  const cliffCount = Math.round(1100 * detailScale);
  const cliffSpots = scatterAccept(cliffCount, (x, y, z) => {
    if (y < 4) return null;
    const sl = slopeAt(x, z);
    if (sl < 0.34 && mountainMask(x, z) < 0.25) return null;
    if (distToRoads(x, z) < 10) return null;
    return { x, y, z, s: 0.8 + rng() * (sl > 0.6 ? 3.4 : 1.8), r: rng() * 3, sl };
  });
  const cliffMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(2.4, 0), new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true, bumpMap: detailBumpTex(), bumpScale: 1.2 }), Math.max(1, cliffSpots.length));
  cliffMesh.castShadow = true;
  cliffSpots.forEach((r, i) => {
    dummy.position.set(r.x, r.y + r.s * 0.3, r.z);
    dummy.scale.set(r.s * 1.3, r.s * (0.65 + rng() * 0.5), r.s);
    dummy.rotation.set(r.r, r.r * 1.7, rng() * 0.6); dummy.updateMatrix();
    cliffMesh.setMatrixAt(i, dummy.matrix);
    cliffMesh.setColorAt(i, tmpColor.setHSL(0.07, 0.03 + rng() * 0.06, 0.34 + rng() * 0.2));
  });
  scene.add(cliffMesh);

  /* ---- talus fields (fallen rock at cliff bases) + jagged summit crags ---- */
  const talusCount = Math.round(1200 * detailScale);
  const talusSpots = scatterAccept(talusCount, (x, y, z) => {
    if (y < 6 || y > 150) return null;
    if (mountainMask(x, z) < 0.18) return null;
    const sl = slopeAt(x, z);
    if (sl < 0.3 || sl > 1.25) return null;
    if (distToRoads(x, z) < 10) return null;
    return { x, y, z, s: 0.7 + rng() * 2.6, r: rng() * 3 };
  });
  const talusMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1.5, 0), new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), Math.max(1, talusSpots.length));
  talusSpots.forEach((r, i) => {
    dummy.position.set(r.x, r.y + r.s * 0.15, r.z);
    dummy.scale.set(r.s * 1.35, r.s * (0.5 + rng() * 0.45), r.s);
    dummy.rotation.set(rng() * 0.7, r.r, rng() * 0.7); dummy.updateMatrix();
    talusMesh.setMatrixAt(i, dummy.matrix);
    talusMesh.setColorAt(i, tmpColor.setHSL(0.07, 0.03 + rng() * 0.07, 0.3 + rng() * 0.24));
  });
  scene.add(talusMesh);

  const cragCount = Math.round(170 * detailScale);
  const cragSpots = scatterAccept(cragCount, (x, y, z) => {
    if (y < 100) return null; // high country only
    if (slopeAt(x, z) > 1.2) return null;
    return { x, y, z, s: 0.7 + rng() * 1.3, r: rng() * 3 };
  });
  const cragMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(2.2, 9, 5), new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), Math.max(1, cragSpots.length));
  cragMesh.castShadow = true;
  cragSpots.forEach((r, i) => {
    dummy.position.set(r.x, r.y + 2.4 * r.s, r.z);
    dummy.scale.set(r.s, r.s * (1.4 + rng() * 0.9), r.s);
    dummy.rotation.set((rng() - 0.5) * 0.24, r.r, (rng() - 0.5) * 0.24); dummy.updateMatrix();
    cragMesh.setMatrixAt(i, dummy.matrix);
    cragMesh.setColorAt(i, tmpColor.setHSL(0.6, 0.03 + rng() * 0.04, 0.3 + rng() * 0.2));
  });
  scene.add(cragMesh);

  /* ---- river water ribbons (flow-animated) ---- */
  const riverFlowTexs = [];
  function buildRiver(rv) {
    const pts = [];
    for (const s of rv.segs) {
      const n = Math.max(2, Math.round(s.len / 14));
      for (let i = 0; i < n; i++) {
        const t = i / n;
        pts.push({ x: s.ax + (s.bx - s.ax) * t, z: s.az + (s.bz - s.az) * t, bed: rv.src + (rv.dst - rv.src) * ((s.cum + t * s.len) / rv.total) });
      }
    }
    const lastPt = rv.pts[rv.pts.length - 1];
    pts.push({ x: lastPt[0], z: lastPt[1], bed: rv.dst });
    // water level: sits in the carved channel, clamped to terrain, then smoothed
    let ys = pts.map(p => Math.min(p.bed + 1.05, terrainHeight(p.x, p.z) + 0.4));
    for (let k = 0; k < 2; k++) ys = ys.map((y, i) => (ys[Math.max(0, i - 1)] + y * 2 + ys[Math.min(ys.length - 1, i + 1)]) / 4);
    const posArr = [], uvArr = [], idxArr = [];
    let dist = 0;
    pts.forEach((p, i) => {
      const q = pts[Math.min(pts.length - 1, i + 1)], q0 = pts[Math.max(0, i - 1)];
      let dx = q.x - q0.x, dz = q.z - q0.z;
      const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
      if (i > 0) dist += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
      const hw = rv.w * 0.44, y = ys[i];
      posArr.push(p.x - dz * hw, y, p.z + dx * hw, p.x + dz * hw, y, p.z - dx * hw);
      uvArr.push(0, dist / 22, 1, dist / 22);
      if (i > 0) { const a = (i - 1) * 2; idxArr.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2));
    g.setIndex(idxArr);
    g.computeVertexNormals();
    const tex = canvasTex(64, 256, (c2d, w2, h2) => {
      c2d.fillStyle = '#a8cbee'; c2d.fillRect(0, 0, w2, h2);
      const r = mulberry32(7);
      for (let i = 0; i < 42; i++) {
        c2d.fillStyle = `rgba(255,255,255,${0.10 + r() * 0.22})`;
        c2d.fillRect(r() * w2, r() * h2, 1.5 + r() * 2.5, 18 + r() * 60);
      }
    });
    tex.repeat.set(1, 1);
    riverFlowTexs.push(tex);
    const m = new THREE.Mesh(g, new THREE.MeshPhongMaterial({ map: tex, color: 0x6ea3d8, transparent: true, opacity: 0.82, shininess: 180, specular: 0xcfe6ff }));
    scene.add(m);
  }
  RIVERS.forEach(buildRiver);

  /* ---- GTA-scale scenery: layered backdrops, waterfalls, summits, birds ---- */
  createMountainBackdrop(scene);
  const summit = createSummitProps(scene, colliders);
  createWaterfall(scene, MOUNTAINS[0].x + 30, MOUNTAINS[0].z + 90, -150, -700);
  createWaterfall(scene, MOUNTAINS[4].x + 260, MOUNTAINS[4].z - 60, -900, 600);

  // mountain name labels
  for (const peak of MOUNTAINS) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 110;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(12,18,34,0.5)';
    if (g.roundRect) { g.beginPath(); g.roundRect(76, 18, 360, 66, 16); g.fill(); }
    else g.fillRect(76, 18, 360, 66);
    g.font = '900 36px Segoe UI, sans-serif'; g.textAlign = 'center';
    g.shadowColor = '#000'; g.shadowBlur = 8; g.fillStyle = '#cfe8ff';
    g.fillText('⛰ ' + peak.name.toUpperCase(), 256, 62);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.92 }));
    spr.scale.set(120, 26, 1);
    spr.position.set(peak.x, terrainHeight(peak.x, peak.z) + 58, peak.z);
    scene.add(spr);
  }

  // birds riding thermals over the peaks
  const birdGeo = new THREE.BufferGeometry();
  birdGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    -1.3, 0, 0, 0, 0, 0.35, 0, 0, -0.35,
    0, 0, 0.35, 1.3, 0, 0, 0, 0, -0.35,
  ], 3));
  birdGeo.computeVertexNormals();
  const birdMesh = new THREE.InstancedMesh(birdGeo, new THREE.MeshBasicMaterial({ color: 0x1d2836, side: THREE.DoubleSide }), 22);
  birdMesh.frustumCulled = false;
  const birds = [];
  for (let i = 0; i < 22; i++) {
    const peak = MOUNTAINS[i % MOUNTAINS.length];
    birds.push({ cx: peak.x, cz: peak.z, cy: terrainHeight(peak.x, peak.z) + 52 + rng() * 45, r: 55 + rng() * 95, sp: 0.05 + rng() * 0.05, ph: rng() * 9, s: 1.7 + rng() * 1.1 });
  }
  scene.add(birdMesh);

  const cloudGroup = new THREE.Group();
  const cloudMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.78, fog: false }), 90);
  for (let i = 0; i < 90; i++) {
    const cx = (rng() - 0.5) * 7000, cz = (rng() - 0.5) * 7000;
    dummy.position.set(cx, 300 + rng() * 160, cz);
    dummy.scale.set(26 + rng() * 46, 5 + rng() * 7, 14 + rng() * 22);
    dummy.rotation.set(0, rng() * 3, 0); dummy.updateMatrix();
    cloudMesh.setMatrixAt(i, dummy.matrix);
  }
  cloudGroup.add(cloudMesh);
  scene.add(cloudGroup);

  /* ---- POI labels with backing plate ---- */
  for (const poi of data.pois) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 110;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(10,14,30,0.55)';
    if (g.roundRect) { g.beginPath(); g.roundRect(56, 14, 400, 72, 18); g.fill(); g.strokeStyle = 'rgba(255,215,106,0.8)'; g.lineWidth = 3; g.stroke(); }
    else { g.fillRect(56, 14, 400, 72); g.strokeStyle = 'rgba(255,215,106,0.8)'; g.lineWidth = 3; g.strokeRect(56, 14, 400, 72); }
    g.font = '900 40px Segoe UI, sans-serif'; g.textAlign = 'center';
    g.shadowColor = '#000'; g.shadowBlur = 8; g.fillStyle = '#fff';
    g.fillText(poi.name.toUpperCase(), 256, 63);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    spr.scale.set(95, 20, 1);
    spr.position.set(poi.x, terrainHeight(poi.x, poi.z) + 64, poi.z);
    scene.add(spr);
  }

  let cloudT = 0;
  function updateWorld(t, dt, cameraPos) {
    grassTime.value = t;
    for (const tx of riverFlowTexs) tx.offset.y = -t * 0.45;
    waterfallTime.value = t;
    if (cameraPos) grassCam.value.copy(cameraPos);
    cloudT += dt * 2.2;
    cloudGroup.position.x = (cloudT % 900) - 450;
    if (summit && summit.beaconMat) summit.beaconMat.opacity = 0.45 + 0.55 * Math.abs(Math.sin(t * 2.4));
    // birds circling thermals
    if (typeof birdMesh !== 'undefined') {
      birds.forEach((b, i) => {
        const a = b.ph + t * b.sp * (i % 2 ? 1 : -1);
        dummy.position.set(b.cx + Math.cos(a) * b.r, b.cy + Math.sin(t * 0.7 + b.ph) * 5, b.cz + Math.sin(a) * b.r);
        dummy.rotation.set(0, -a + (i % 2 ? 0 : Math.PI), Math.sin(t * 8 + b.ph) * 0.38);
        dummy.scale.setScalar(b.s);
        dummy.updateMatrix();
        birdMesh.setMatrixAt(i, dummy.matrix);
      });
      birdMesh.instanceMatrix.needsUpdate = true;
    }
  }
  return { colliders, trunkMesh, canMesh, canMesh2, rockMesh, grassMesh, pineCan, cliffMesh, updateWorld };
}

export function hideNode(worldRefs, data, type, index) {
  const dummy = new THREE.Object3D();
  dummy.position.set(0, -120, 0); dummy.scale.setScalar(0.001); dummy.updateMatrix();
  const apply = (mesh) => { if (mesh) { mesh.setMatrixAt(index, dummy.matrix); mesh.instanceMatrix.needsUpdate = true; } };
  if (type === 'tree') { apply(worldRefs.canMesh); apply(worldRefs.canMesh2); apply(worldRefs.trunkMesh); }
  else apply(worldRefs.rockMesh);
}
