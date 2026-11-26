// FortWorld - shared deterministic map generation (server + client must match)
// Map size 8000x8000 units (~8km x 8km). Height function is pure math so both sides agree.

const MAP_SIZE = 8000;
const HALF = MAP_SIZE / 2;

// Expansion zones baked by tools/bake_maps.mjs into terrain stamps.
// See server/maps_data.js.
const EXPANSION_ZONES = require('./maps_data').zones;

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Gaussian hills + rolling sine terrain. Must be identical on client.
const HILLS = [
  { x: -600, z: -800, r: 700, h: 55 },
  { x: 900, z: -500, r: 800, h: 70 },
  { x: -1100, z: 600, r: 650, h: 48 },
  { x: 700, z: 900, r: 750, h: 62 },
  { x: 0, z: 0, r: 500, h: 30 },
  { x: -300, z: 1400, r: 600, h: 40 },
  { x: 1300, z: 300, r: 550, h: 45 },
  // outer ring (8000m map): gentle swells, kept far enough out that the
  // original island's coastline heights are essentially untouched
  { x: 2500, z: -600, r: 520, h: 34 },
  { x: -2300, z: -400, r: 480, h: 30 },
  { x: 300, z: -2700, r: 540, h: 36 },
  { x: -800, z: 2600, r: 500, h: 28 },
  { x: 2800, z: 1900, r: 560, h: 38 },
  { x: -2900, z: -1500, r: 520, h: 32 },
];

// Mountain massifs — real playable terrain (peaks ~180-290m). MUST match client world.js.
const MOUNTAINS = [
  { name: 'Mount Apex', x: -450, z: -1450, r: 620, h: 215 },
  { name: 'Razorback Ridge', x: -1550, z: -1250, r: 520, h: 190 },
  { name: 'Titan Peak', x: 850, z: -1600, r: 580, h: 210 },
  { name: 'Kings Crown', x: 1550, z: 150, r: 560, h: 180 },
  { name: 'Verde Highlands', x: -1550, z: 1100, r: 600, h: 170 },
  { name: 'Solstice Peaks', x: 700, z: 1650, r: 520, h: 175 },
  // outer range (8000m map): the island's new far peaks
  { name: 'Aurora Summit', x: 3450, z: -3050, r: 600, h: 200 },
  { name: 'Cinder Tooth', x: -3200, z: 3250, r: 560, h: 185 },
  { name: 'Breaker Spire', x: 3250, z: 3250, r: 540, h: 170 },
  { name: 'Westwall Range', x: -3450, z: -350, r: 580, h: 190 },
];

function terrainNative(x, z) {
  // base rolling
  let h = Math.sin(x * 0.004) * 8 + Math.cos(z * 0.005) * 8 + Math.sin((x + z) * 0.0022) * 6;
  // gaussian hills
  for (const hill of HILLS) {
    const dx = x - hill.x, dz = z - hill.z;
    const d2 = dx * dx + dz * dz;
    h += hill.h * Math.exp(-d2 / (hill.r * hill.r));
  }
  // Everest-style massifs: cone body, radiating arete ridges, fluted valleys,
  // steep summit pyramid, soft terracing that forms cliff bands & benches.
  // MUST match client world.js exactly.
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
  // island falloff to water at edges (8000m map: landmass reaches further)
  const edge = Math.max(Math.abs(x), Math.abs(z));
  if (edge > 3000) {
    const t = (edge - 3000) / 900;
    h = h * (1 - Math.min(1, t)) + (-14) * Math.min(1, t);
  }
  return h;
}

// Expansion-zone terrain stamps: baked relative heightfields blended over the
// native terrain (full weight inside the zone, smoothstep ring outside).
// MUST match client world.js exactly.
function terrainHeight(x, z) {
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

// Rivers: descending channels carved into the terrain (only ever cut down).
// MUST match client world.js exactly. src/dst = channel bed elevations.
const RIVERS = [
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

const POIS = [
  { name: 'Dropzone City', x: 0, z: -200, r: 260, color: 0x8a8f98 },
  { name: 'Salty Springs', x: -800, z: -900, r: 180, color: 0xd9c27a },
  { name: 'Greasy Grove', x: 1000, z: -700, r: 170, color: 0x7fb069 },
  { name: 'Retail Row', x: 600, z: 400, r: 200, color: 0xe07a5f },
  { name: 'Pleasant Park', x: -900, z: 500, r: 190, color: 0x81b29a },
  { name: 'Lazy Lake', x: 200, z: 1100, r: 160, color: 0x6d9dc5 },
  { name: 'Frosty Flights', x: -1300, z: -300, r: 150, color: 0xdfe9f5 },
  { name: 'Sunny Sands', x: 1300, z: 1200, r: 150, color: 0xf2cc8f },
  { name: 'Misty Meadows', x: -400, z: 1500, r: 140, color: 0xa8dadc },
  { name: 'Lonely Lodge', x: 1400, z: -1200, r: 130, color: 0xbc6c25 },
];
// Expansion POIs ride at the end (keeps the original rng streams untouched).
for (const zn of EXPANSION_ZONES) {
  POIS.push({ name: zn.name, x: zn.x, z: zn.z, r: 230, color: zn.color, zoneId: zn.id, loot: zn.loot, night: zn.night || undefined });
}
// Outer-ring POIs for the 8000m map (appended last so existing generated
// buildings/nature/loot streams never shift for earlier POIs).
POIS.push(
  { name: 'Aurora Downs', x: 2900, z: -2900, r: 210, color: 0x9fd8e8, loot: 12 },
  { name: 'Cinder Hollow', x: -3050, z: 3050, r: 210, color: 0xe07a5f, loot: 12 },
  { name: 'Breakwater Bay', x: 3100, z: 2750, r: 200, color: 0x7fb4d9, loot: 12 },
  { name: 'Westwall Town', x: -3150, z: -450, r: 200, color: 0xb8a888, loot: 12 },
);

// Buildings per POI: deterministic boxes
function genBuildings() {
  const rng = mulberry32(1337);
  const buildings = [];
  for (const poi of POIS) {
    if (poi.zoneId) {
      const zn = EXPANSION_ZONES.find(z => z.id === poi.zoneId);
      if (zn.blocks.length) {
        // authored layout baked from the Arena map blocks
        for (const b of zn.blocks) {
          if (b.h < 1.5) continue; // floor slabs aren't buildings
          buildings.push({ x: zn.x + b.x, z: zn.z + b.z, w: b.w, d: b.d, h: Math.max(3, b.h), poi: poi.name, color: poi.color, rot: b.rot });
        }
      } else {
        // ring settlement in the zone's own colour; each slot probes a few
        // radii and keeps the flattest footing (server-side only placement)
        const flatness = (bx, bz, bw, bd) => {
          const y = terrainHeight(bx, bz);
          return Math.max(
            Math.abs(terrainHeight(bx + bw / 2, bz + bd / 2) - y), Math.abs(terrainHeight(bx - bw / 2, bz + bd / 2) - y),
            Math.abs(terrainHeight(bx + bw / 2, bz - bd / 2) - y), Math.abs(terrainHeight(bx - bw / 2, bz - bd / 2) - y));
        };
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + 0.4;
          const w = 18 + rng() * 26, dep = 18 + rng() * 26, h = 10 + rng() * 20;
          const rot = Math.floor(rng() * 4) * (Math.PI / 2);
          let bx = poi.x, bz = poi.z, bestF = Infinity;
          for (const rr of [0.32, 0.44, 0.56, 0.68]) for (const da of [0, -0.35, 0.35]) {
            const cx = poi.x + Math.cos(a + da) * poi.r * rr, cz = poi.z + Math.sin(a + da) * poi.r * rr;
            const f = flatness(cx, cz, w, dep);
            if (f < bestF) { bestF = f; bx = cx; bz = cz; }
          }
          buildings.push({ x: bx, z: bz, w, d: dep, h, poi: poi.name, color: poi.color, rot });
        }
        buildings.push({ x: poi.x, z: poi.z, w: 26, d: 26, h: 32 + rng() * 18, poi: poi.name, color: poi.color, rot: 0, tower: true });
      }
      continue;
    }
    const n = 8 + Math.floor(rng() * 6);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const d = rng() * poi.r * 0.7;
      const x = poi.x + Math.cos(a) * d;
      const z = poi.z + Math.sin(a) * d;
      const w = 18 + rng() * 30;
      const dep = 18 + rng() * 30;
      const h = 10 + rng() * 22;
      buildings.push({ x, z, w, d, h, poi: poi.name, color: poi.color, rot: Math.floor(rng() * 4) * (Math.PI / 2) });
    }
    // central tower
    buildings.push({ x: poi.x, z: poi.z, w: 26, d: 26, h: 34 + rng() * 20, poi: poi.name, color: poi.color, rot: 0, tower: true });
  }
  return buildings;
}

// Trees & rocks scattered, avoiding POI centers. Treeline: no trees above ~100m;
// high slopes are rock country.
function genNature() {
  const rng = mulberry32(4242);
  const trees = [];
  const rocks = [];
  for (let i = 0; i < 1700; i++) {
    const x = (rng() - 0.5) * 7600;
    const z = (rng() - 0.5) * 7600;
    const h = terrainHeight(x, z);
    if (h < -4) continue; // water
    let inPoi = false;
    for (const p of POIS) {
      const dx = x - p.x, dz = z - p.z;
      if (dx * dx + dz * dz < p.r * p.r * 0.5) { inPoi = true; break; }
    }
    if (inPoi) continue;
    const rockChance = h > 100 ? 1 : h > 65 ? 0.65 : 0.26;
    if (rng() < rockChance) rocks.push({ x, z, s: 0.6 + rng() * (h > 65 ? 2.0 : 1.4), r: rng() * Math.PI * 2 });
    else trees.push({ x, z, s: 0.7 + rng() * 0.9, r: rng() * Math.PI * 2 });
  }
  return { trees, rocks };
}

// Anchor each zone to the native height at its centre (before any generation
// below samples terrainHeight).
for (const zn of EXPANSION_ZONES) zn._b = terrainNative(zn.x, zn.z);

// Mountain detail: boulders, crags and alpine pines scattered over the
// massifs so the high country is dressed like the authored maps (which carry
// hundreds of props). Deterministic; runs before BUILDINGS so nothing else
// shifts. Rocks/trees get real colliders (server game.js + client world.js).
function genMountainDetail(trees, rocks) {
  const rng = mulberry32(9099);
  const slopeAt = (x, z) => Math.max(Math.abs(terrainHeight(x + 6, z) - terrainHeight(x - 6, z)), Math.abs(terrainHeight(x, z + 6) - terrainHeight(x, z - 6))) / 12;
  for (const m of MOUNTAINS) {
    for (let i = 0; i < 210; i++) {
      const a = rng() * Math.PI * 2;
      const d = Math.sqrt(rng()) * m.r * 1.35;
      const x = m.x + Math.cos(a) * d, z = m.z + Math.sin(a) * d;
      if (Math.abs(x) > 3900 || Math.abs(z) > 3900) continue;
      const h = terrainHeight(x, z);
      if (h < 3) continue;
      let nearPoi = false;
      for (const p of POIS) { const dx = x - p.x, dz = z - p.z; if (dx * dx + dz * dz < (p.r + 40) * (p.r + 40)) { nearPoi = true; break; } }
      if (nearPoi) continue;
      const sl = slopeAt(x, z);
      if (h > 100 || sl > 0.55) {
        // high crags + steep-slope boulders (some huge)
        rocks.push({ x, z, s: 1.1 + rng() * (h > 120 ? 3.2 : 2.0), r: rng() * Math.PI * 2 });
      } else if (h > 45 && rng() < 0.6) {
        trees.push({ x, z, s: 1.1 + rng() * 1.1, r: rng() * Math.PI * 2 }); // alpine pines
      } else if (rng() < 0.5) {
        rocks.push({ x, z, s: 0.7 + rng() * 1.2, r: rng() * Math.PI * 2 }); // scree stones
      }
    }
  }
}

const BUILDINGS = genBuildings();
const { trees: TREES, rocks: ROCKS } = genNature();
// Trees authored in the expansion maps, converted to world coords.
for (const zn of EXPANSION_ZONES) {
  for (const t of zn.trees) {
    TREES.push({ x: zn.x + t[0], z: zn.z + t[1], s: t[2], r: Math.abs(((t[0] * 31 + t[1] * 17) % 628)) / 100 });
  }
}
genMountainDetail(TREES, ROCKS);


// Loot spawn points: POI centers + random
function genLootSpawns() {
  const rng = mulberry32(777);
  const pts = [];
  for (const p of POIS) {
    for (let i = 0; i < (p.loot || 8); i++) {
      const a = rng() * Math.PI * 2;
      const d = rng() * p.r * 0.8;
      pts.push({ x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d });
    }
  }
  for (let i = 0; i < 260; i++) {
    pts.push({ x: (rng() - 0.5) * 7000, z: (rng() - 0.5) * 7000 });
  }
  return pts;
}
const LOOT_SPAWNS = genLootSpawns();

module.exports = { MAP_SIZE, HALF, terrainHeight, terrainNative, POIS, BUILDINGS, TREES, ROCKS, LOOT_SPAWNS, HILLS, MOUNTAINS, RIVERS, EXPANSION_ZONES };
