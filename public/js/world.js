// FortWorld world building: terrain, custom GLSL shaders (sky / water / storm / loot beams), POIs.
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

function buildingTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#cfd3da'; g.fillRect(0, 0, 128, 256);
  g.fillStyle = '#2c3444';
  for (let y = 14; y < 240; y += 30) for (let x = 12; x < 112; x += 26) {
    g.fillStyle = Math.random() < 0.25 ? '#ffd76a' : '#2c3444';
    g.fillRect(x, y, 16, 19);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

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
      void main(){
        float h = clamp(vDir.y, -0.08, 1.0);
        vec3 col = mix(vec3(0.98,0.72,0.45), vec3(0.35,0.62,0.98), smoothstep(0.0,0.55,h));
        col = mix(col, vec3(0.12,0.28,0.72), smoothstep(0.45,1.0,h));
        float sun = pow(max(dot(normalize(vDir), uSunDir), 0.0), 600.0);
        float glow = pow(max(dot(normalize(vDir), uSunDir), 0.0), 8.0);
        col += vec3(1.0,0.85,0.55) * sun * 2.2 + vec3(1.0,0.6,0.3) * glow * 0.35;
        // animated clouds
        vec2 uv = vDir.xz / (abs(vDir.y) + 0.28);
        float cl = noise(uv * 1.6 + uTime * 0.008) * noise(uv * 3.4 - uTime * 0.005);
        col = mix(col, vec3(1.0), smoothstep(0.32, 0.62, cl) * smoothstep(0.02, 0.25, vDir.y) * 0.75);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(5200, 32, 18), skyMat);
  sky.frustumCulled = false;
  scene.add(sky);
  return skyMat;
}

export function createWater(scene) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, fog: false,
    uniforms: { uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3(0.5, 0.62, 0.35).normalize() } },
    vertexShader: `
      uniform float uTime; varying vec3 vWorld; varying float vWave;
      void main(){
        vec3 p = position;
        vec4 w = modelMatrix * vec4(p,1.0);
        float wave = sin(w.x*0.045 + uTime*1.4) * cos(w.z*0.05 + uTime*1.1);
        w.y += wave * 0.35; vWave = wave; vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uSunDir; varying vec3 vWorld; varying float vWave;
      void main(){
        vec3 viewDir = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(viewDir.y, 0.0), 2.0);
        vec3 deep = vec3(0.02,0.25,0.48), shallow = vec3(0.15,0.65,0.85);
        vec3 col = mix(deep, shallow, fres * 0.8 + vWave * 0.18);
        float sparkle = pow(max(0.0, sin(vWorld.x*1.7 + uTime*2.0) * sin(vWorld.z*1.9 - uTime*1.7)), 8.0);
        col += vec3(1.0,0.9,0.6) * sparkle * 0.35;
        gl_FragColor = vec4(col, 0.88);
      }`,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(11000, 11000, 48, 48), mat);
  water.rotation.x = -Math.PI / 2; water.position.y = WATER_Y;
  scene.add(water);
  return mat;
}

export function createStormWall(scene) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; varying vec3 vPos; void main(){ vUv=uv; vPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      uniform float uTime; varying vec2 vUv; varying vec3 vPos;
      void main(){
        float stripes = sin(vUv.x*220.0 + uTime*1.5 + sin(vUv.y*22.0 - uTime*2.2)*1.4) * 0.5 + 0.5;
        float vert = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.65, 1.0, vUv.y)*0.7);
        vec3 col = mix(vec3(0.45,0.1,0.85), vec3(0.75,0.35,1.0), stripes);
        gl_FragColor = vec4(col, (0.16 + stripes*0.22) * vert + 0.08);
      }`,
  });
  const geo = new THREE.CylinderGeometry(1, 1, 500, 72, 1, true);
  const wall = new THREE.Mesh(geo, mat);
  wall.position.y = 200; wall.frustumCulled = false;
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
        float a = (1.0 - vUv.y) * (0.35 + 0.2*sin(uTime*3.0 + vUv.y*14.0));
        gl_FragColor = vec4(uColor, a);
      }`,
  });
}

export function buildWorld(scene, data) {
  const colliders = [];
  // Terrain
  const SEG = 200, SIZE = 4000;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cGrass = new THREE.Color(0x69a83f), cGrass2 = new THREE.Color(0x8fbf4d), cSand = new THREE.Color(0xe3d29b),
    cRock = new THREE.Color(0x8a8578), cSnow = new THREE.Color(0xf4f8ff), cDirt = new THREE.Color(0x9a7b4f);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);
    const hx = terrainHeight(x + 8, z), hz = terrainHeight(x, z + 8);
    const slope = Math.min(1, (Math.abs(hx - h) + Math.abs(hz - h)) / 7);
    if (h < 1.5) tmp.copy(cSand);
    else if (h > 62) tmp.copy(cSnow).lerp(cRock, slope);
    else { tmp.copy(cGrass).lerp(cGrass2, 0.5 + 0.5 * Math.sin(x * 0.02 + z * 0.017)); tmp.lerp(cDirt, slope * 0.5); tmp.lerp(cRock, Math.max(0, slope - 0.45)); }
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  // Buildings
  const bTex = buildingTexture();
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.95 });
  const buildingsGroup = new THREE.Group();
  for (const b of data.buildings) {
    const gy = terrainHeight(b.x, b.z);
    const mat = new THREE.MeshStandardMaterial({ map: bTex, color: b.color, roughness: 0.9 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), mat);
    m.position.set(b.x, gy + b.h / 2 - 0.5, b.z);
    m.rotation.y = b.rot || 0; m.castShadow = true; m.receiveShadow = true;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(b.w + 1.5, 1.2, b.d + 1.5), roofMat);
    roof.position.set(b.x, gy + b.h + 0.1, b.z); roof.rotation.y = b.rot || 0;
    buildingsGroup.add(m, roof);
    colliders.push({ minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2, minY: gy - 0.5, maxY: gy + b.h, type: 'building' });
  }
  scene.add(buildingsGroup);

  // Trees (instanced)
  const trunkGeo = new THREE.CylinderGeometry(0.35, 0.55, 4, 6);
  const canGeo = new THREE.ConeGeometry(3.2, 9, 8);
  const trunkMesh = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 1 }), Math.max(1, data.trees.length));
  const canMesh = new THREE.InstancedMesh(canGeo, new THREE.MeshStandardMaterial({ color: 0x2f7d32, roughness: 1 }), Math.max(1, data.trees.length));
  canMesh.castShadow = true;
  const dummy = new THREE.Object3D();
  data.trees.forEach((t, i) => {
    const y = terrainHeight(t.x, t.z);
    dummy.position.set(t.x, y + 2 * t.s, t.z); dummy.scale.setScalar(t.s); dummy.rotation.set(0, t.r, 0); dummy.updateMatrix();
    trunkMesh.setMatrixAt(i, dummy.matrix);
    dummy.position.y = y + (4 + 4) * t.s; dummy.updateMatrix();
    canMesh.setMatrixAt(i, dummy.matrix);
  });
  scene.add(trunkMesh, canMesh);

  // Rocks (instanced)
  const rockMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(2.2, 0), new THREE.MeshStandardMaterial({ color: 0x8d8d94, roughness: 1, flatShading: true }), Math.max(1, data.rocks.length));
  rockMesh.castShadow = true;
  data.rocks.forEach((r, i) => {
    const y = terrainHeight(r.x, r.z);
    dummy.position.set(r.x, y + 0.6, r.z); dummy.scale.setScalar(r.s); dummy.rotation.set(r.r, r.r * 2, 0); dummy.updateMatrix();
    rockMesh.setMatrixAt(i, dummy.matrix);
  });
  scene.add(rockMesh);

  // POI floating labels
  for (const poi of data.pois) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 96;
    const g = c.getContext('2d');
    g.font = '900 44px Segoe UI, sans-serif'; g.textAlign = 'center';
    g.shadowColor = '#000'; g.shadowBlur = 10; g.fillStyle = '#fff';
    g.fillText(poi.name.toUpperCase(), 256, 58);
    const tex = new THREE.CanvasTexture(c);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    spr.scale.set(90, 17, 1);
    spr.position.set(poi.x, terrainHeight(poi.x, poi.z) + 62, poi.z);
    scene.add(spr);
  }

  return { colliders, trunkMesh, canMesh, rockMesh };
}

export function hideNode(worldRefs, data, type, index) {
  const mesh = type === 'tree' ? worldRefs.canMesh : worldRefs.rockMesh;
  const trunk = type === 'tree' ? worldRefs.trunkMesh : null;
  const dummy = new THREE.Object3D();
  dummy.position.set(0, -100, 0); dummy.scale.setScalar(0.001); dummy.updateMatrix();
  mesh.setMatrixAt(index, dummy.matrix); mesh.instanceMatrix.needsUpdate = true;
  if (trunk) { trunk.setMatrixAt(index, dummy.matrix); trunk.instanceMatrix.needsUpdate = true; }
}
