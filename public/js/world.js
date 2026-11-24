// FortWorld world building — AAA pass: procedural PBR textures, roads, instanced
// vegetation/props/lamps/cars, animated clouds, custom GLSL sky/water/storm.
import * as THREE from 'three';

// Must match server/map.js exactly
const HILLS = [
  { x: -600, z: -800, r: 700, h: 55 }, { x: 900, z: -500, r: 800, h: 70 },
  { x: -1100, z: 600, r: 650, h: 48 }, { x: 700, z: 900, r: 750, h: 62 },
  { x: 0, z: 0, r: 500, h: 30 }, { x: -300, z: 1400, r: 600, h: 40 },
  { x: 1300, z: 300, r: 550, h: 45 },
];
export function terrainHeight(x, z) {
  let h = Math.sin(x * 0.004) * 8 + Math.cos(z * 0.005) * 8 + Math.sin((x + z) * 0.0022) * 6;
  for (const hill of HILLS) {
    const dx = x - hill.x, dz = z - hill.z;
    h += hill.h * Math.exp(-(dx * dx + dz * dz) / (hill.r * hill.r));
  }
  const edge = Math.max(Math.abs(x), Math.abs(z));
  if (edge > 1500) { const t = Math.min(1, (edge - 1500) / 500); h = h * (1 - t) + (-14) * t; }
  return h;
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
        vec3 col = mix(vec3(0.98,0.72,0.45), vec3(0.35,0.62,0.98), smoothstep(0.0,0.55,h));
        col = mix(col, vec3(0.10,0.26,0.72), smoothstep(0.45,1.0,h));
        float sd = max(dot(dir, uSunDir), 0.0);
        col += vec3(1.0,0.85,0.55) * pow(sd, 900.0) * 3.0;
        col += vec3(1.0,0.62,0.28) * pow(sd, 10.0) * 0.38;
        col += vec3(0.9,0.95,1.0) * pow(sd, 90.0) * 0.25;
        // fbm cloud layer with silver lining
        vec2 uv = dir.xz / (abs(dir.y) + 0.30);
        float cl = fbm(uv * 1.35 + vec2(uTime*0.010, uTime*0.004));
        float cover = smoothstep(0.48, 0.72, cl);
        float shade = smoothstep(0.5, 0.85, fbm(uv * 3.1 - uTime*0.006));
        vec3 cloudCol = mix(vec3(1.02), vec3(0.62,0.68,0.82), shade*0.8);
        cloudCol += vec3(1.0,0.7,0.4) * pow(sd, 3.0) * 0.25;
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
        vec3 deep = vec3(0.015,0.22,0.46), shallow = vec3(0.12,0.62,0.85);
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
  const cGrass = new THREE.Color(0x5da23c), cGrass2 = new THREE.Color(0x93c24e), cSand = new THREE.Color(0xe6d29b),
    cRock = new THREE.Color(0x8a8578), cSnow = new THREE.Color(0xf4f8ff), cDirt = new THREE.Color(0x9a7b4f), cScorch = new THREE.Color(0x6f7f3a);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);
    const slope = Math.min(1, (Math.abs(terrainHeight(x + 8, z) - h) + Math.abs(terrainHeight(x, z + 8) - h)) / 7);
    const n = 0.5 + 0.5 * Math.sin(x * 0.021 + z * 0.017) * Math.sin(x * 0.006 - z * 0.011);
    if (h < 1.2) tmp.copy(cSand).lerp(cDirt, n * 0.3);
    else if (h > 60) tmp.copy(cSnow).lerp(cRock, slope * 1.1);
    else { tmp.copy(cGrass).lerp(cGrass2, n); tmp.lerp(cScorch, Math.max(0, n - 0.72) * 0.8); tmp.lerp(cDirt, slope * 0.45); tmp.lerp(cRock, Math.max(0, slope - 0.42) * 1.1); }
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, bumpMap: detailBumpTex(), bumpScale: 1.4 });
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
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x3f3a36, roughness: 1, bumpMap: detailBumpTex(), bumpScale: 0.8 });
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
    const roof = new THREE.Mesh(unitBox, roofMat);
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
  const grassMat = new THREE.MeshStandardMaterial({ roughness: 1, side: THREE.DoubleSide });
  grassMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = grassTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      #ifdef USE_INSTANCING
        vec4 ipos = instanceMatrix * vec4(0.0,0.0,0.0,1.0);
        float sway = sin(uTime*1.9 + ipos.x*0.14 + ipos.z*0.19) * 0.22 * max(position.y + 0.55, 0.0);
        transformed.x += sway; transformed.z += sway * 0.6;
      #endif
    `);
  };
  const grassMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(0.16, 1.15, 4), grassMat, Math.max(1, grassCount));
  scatter(grassCount, (x, y, z) => {
    dummy.position.set(x, y + 0.45, z);
    dummy.scale.set(1.4 + rng(), 1 + rng() * 1.5, 1.4 + rng());
    dummy.rotation.set((rng() - 0.5) * 0.35, rng() * 3, (rng() - 0.5) * 0.35); dummy.updateMatrix();
    return dummy.matrix.clone();
  }).forEach((m, i) => { grassMesh.setMatrixAt(i, m); grassMesh.setColorAt(i, tmpColor.setHSL(0.26 + rng() * 0.08, 0.55, 0.3 + rng() * 0.18)); });
  scene.add(grassMesh);

  const bushMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.5, 1), new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), 320);
  scatter(320, (x, y, z) => {
    dummy.position.set(x, y + 0.8, z);
    dummy.scale.set(1 + rng() * 1.6, 0.7 + rng() * 0.7, 1 + rng() * 1.6);
    dummy.rotation.set(0, rng() * 3, 0); dummy.updateMatrix();
    return dummy.matrix.clone();
  }).forEach((m, i) => { bushMesh.setMatrixAt(i, m); bushMesh.setColorAt(i, tmpColor.setHSL(0.3, 0.45, 0.26 + rng() * 0.14)); });
  bushMesh.castShadow = true;
  scene.add(bushMesh);

  const flowerMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.17, 6, 5), new THREE.MeshStandardMaterial({ roughness: 0.6, emissiveIntensity: 0.25 }), 600);
  const flowerCols = [0xff5e8a, 0xffd94d, 0xffffff, 0xc77dff, 0xff8c42];
  scatter(600, (x, y, z) => {
    dummy.position.set(x, y + 0.5 + rng() * 0.4, z);
    dummy.scale.setScalar(0.8 + rng()); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
    return dummy.matrix.clone();
  }).forEach((m, i) => { flowerMesh.setMatrixAt(i, m); flowerMesh.setColorAt(i, tmpColor.setHex(flowerCols[i % flowerCols.length])); });
  scene.add(flowerMesh);

  /* ---- distant mountain ring + clouds ---- */
  const mtnMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 6), new THREE.MeshStandardMaterial({ color: 0x6f86a8, roughness: 1, flatShading: true }), 16);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rng() * 0.2;
    const rad = 2700 + rng() * 800;
    dummy.position.set(Math.cos(a) * rad, -12, Math.sin(a) * rad);
    dummy.scale.set(500 + rng() * 420, 480 + rng() * 430, 500 + rng() * 420);
    dummy.rotation.set(0, rng() * 3, 0); dummy.updateMatrix();
    mtnMesh.setMatrixAt(i, dummy.matrix);
  }
  scene.add(mtnMesh);

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
  function updateWorld(t, dt) {
    grassTime.value = t;
    cloudT += dt * 2.2;
    cloudGroup.position.x = (cloudT % 900) - 450;
  }
  return { colliders, trunkMesh, canMesh, canMesh2, rockMesh, grassMesh, updateWorld };
}

export function hideNode(worldRefs, data, type, index) {
  const dummy = new THREE.Object3D();
  dummy.position.set(0, -120, 0); dummy.scale.setScalar(0.001); dummy.updateMatrix();
  const apply = (mesh) => { if (mesh) { mesh.setMatrixAt(index, dummy.matrix); mesh.instanceMatrix.needsUpdate = true; } };
  if (type === 'tree') { apply(worldRefs.canMesh); apply(worldRefs.canMesh2); apply(worldRefs.trunkMesh); }
  else apply(worldRefs.rockMesh);
}
