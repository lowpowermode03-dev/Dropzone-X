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

function terrainHeight(x, z) {
  // base rolling
  let h = Math.sin(x * 0.004) * 8 + Math.cos(z * 0.005) * 8 + Math.sin((x + z) * 0.0022) * 6;
  // gaussian hills
  for (const hill of HILLS) {
    const dx = x - hill.x, dz = z - hill.z;
    const d2 = dx * dx + dz * dz;
    h += hill.h * Math.exp(-d2 / (hill.r * hill.r));
  }
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

// Trees & rocks scattered, avoiding POI centers slightly
function genNature() {
  const rng = mulberry32(4242);
  const trees = [];
  const rocks = [];
  for (let i = 0; i < 900; i++) {
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
    if (rng() < 0.72) trees.push({ x, z, s: 0.7 + rng() * 0.9, r: rng() * Math.PI * 2 });
    else rocks.push({ x, z, s: 0.6 + rng() * 1.4, r: rng() * Math.PI * 2 });
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

module.exports = { MAP_SIZE, HALF, terrainHeight, POIS, BUILDINGS, TREES, ROCKS, LOOT_SPAWNS, HILLS };
