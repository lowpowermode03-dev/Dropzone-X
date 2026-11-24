// FortWorld - shared deterministic map generation (server + client must match)
// Map size 4000x4000 units (~4km x 4km). Height function is pure math so both sides agree.

const MAP_SIZE = 4000;
const HALF = MAP_SIZE / 2;

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
];

// Mountain massifs — real playable terrain (peaks ~180-290m). MUST match client world.js.
const MOUNTAINS = [
  { name: 'Mount Apex', x: -450, z: -1450, r: 620, h: 235 },
  { name: 'Razorback Ridge', x: -1550, z: -1250, r: 520, h: 190 },
  { name: 'Titan Peak', x: 850, z: -1600, r: 580, h: 210 },
  { name: 'Kings Crown', x: 1550, z: 150, r: 560, h: 180 },
  { name: 'Verde Highlands', x: -1550, z: 1100, r: 600, h: 170 },
  { name: 'Solstice Peaks', x: 700, z: 1650, r: 520, h: 175 },
];

function terrainHeight(x, z) {
  // base rolling
  let h = Math.sin(x * 0.004) * 8 + Math.cos(z * 0.005) * 8 + Math.sin((x + z) * 0.0022) * 6;
  // gaussian hills
  for (const hill of HILLS) {
    const dx = x - hill.x, dz = z - hill.z;
    const d2 = dx * dx + dz * dz;
    h += hill.h * Math.exp(-d2 / (hill.r * hill.r));
  }
  // mountain massifs with ridged detail
  let mMask = 0, mHeight = 0;
  for (const peak of MOUNTAINS) {
    const dx = x - peak.x, dz = z - peak.z;
    const d2 = dx * dx + dz * dz;
    const fall = Math.exp(-d2 / (peak.r * peak.r));
    const shaped = fall * fall * (3 - 2 * fall);
    mHeight += peak.h * shaped;
    if (shaped > mMask) mMask = shaped;
  }
  if (mMask > 0.01) {
    const rn1 = 1 - Math.abs(Math.sin(x * 0.009 + Math.sin(z * 0.007) * 1.7));
    const rn2 = 1 - Math.abs(Math.cos(z * 0.011 + Math.sin(x * 0.005) * 1.3));
    const ridge = rn1 * 0.62 + rn2 * 0.38;
    mHeight += mMask * (ridge - 0.48) * 44;
    mHeight += mMask * Math.sin(x * 0.045 + z * 0.033) * 3.5;
  }
  h += mHeight;
  // island falloff to water at edges
  const edge = Math.max(Math.abs(x), Math.abs(z));
  if (edge > 1500) {
    const t = (edge - 1500) / 500;
    h = h * (1 - Math.min(1, t)) + (-14) * Math.min(1, t);
  }
  return h;
}

const POIS = [
  { name: 'FortWorld City', x: 0, z: -200, r: 260, color: 0x8a8f98 },
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

// Buildings per POI: deterministic boxes
function genBuildings() {
  const rng = mulberry32(1337);
  const buildings = [];
  for (const poi of POIS) {
    const n = 6 + Math.floor(rng() * 5);
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
    const x = (rng() - 0.5) * 3800;
    const z = (rng() - 0.5) * 3800;
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

const BUILDINGS = genBuildings();
const { trees: TREES, rocks: ROCKS } = genNature();

// Loot spawn points: POI centers + random
function genLootSpawns() {
  const rng = mulberry32(777);
  const pts = [];
  for (const p of POIS) {
    for (let i = 0; i < 8; i++) {
      const a = rng() * Math.PI * 2;
      const d = rng() * p.r * 0.8;
      pts.push({ x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d });
    }
  }
  for (let i = 0; i < 60; i++) {
    pts.push({ x: (rng() - 0.5) * 3400, z: (rng() - 0.5) * 3400 });
  }
  return pts;
}
const LOOT_SPAWNS = genLootSpawns();

module.exports = { MAP_SIZE, HALF, terrainHeight, POIS, BUILDINGS, TREES, ROCKS, LOOT_SPAWNS, HILLS, MOUNTAINS };
