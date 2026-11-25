#!/usr/bin/env node
// Dropzone X — expansion-maps bake tool.
//
// Bakes terrain + props from expansion map sources into Dropzone X zones:
//   • authored .umm JSON maps (terrain heightfield + props + blocks)
//   • a seeded Perlin + hydraulic-erosion terrain generator
//     (tools/nuc_terrain.mjs) for the Ashen Highlands
//
// Each source landmass becomes a 480 m "zone" stamped into Dropzone X's
// 4000×4000 island rim. Heights are baked RELATIVE; at runtime each zone is
// anchored to the native terrain height at its centre (see server/map.js),
// so this tool never needs the native terrain formula.
//
// Usage:
//   node tools/bake_maps.mjs <dir-with-.umm-files>
//
// Outputs (generated — do not hand-edit):
//   server/maps_data.js    (CommonJS)
//   public/js/maps_data.js (ES module, identical data)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRealisticTerrain } from './nuc_terrain.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const GRID = 49;              // baked grid per zone (GRID×GRID heights)
const DISPLAY = 480;          // zone footprint in metres
const HALF = DISPLAY / 2;

// Zone placement on the island rim (centres chosen clear of POIs/mountains).
const ZONES = [
  { id: 'ashen', name: 'Ashen Highlands', gen: true, x: 1680, z: -1680, color: 0xa9552e, loot: 14 },
  { id: 'arena', file: 'Arena.umm', name: 'Arena', x: 1780, z: -820, color: 0xb8bfc9, amp: 1.0, loot: 8 },
  { id: 'silencevale', file: 'SilenceVale.umm', name: 'Silence Vale', x: 1720, z: 1720, color: 0x8fa382, amp: 1.35, loot: 8 },
  { id: 'gulled', file: 'Gulled.umm', name: 'Gulled', x: -880, z: 1740, color: 0xd9a066, amp: 1.35, loot: 8 },
  { id: 'loner', file: 'Loner.umm', name: 'Loner', x: -1780, z: 1780, color: 0x5a6b8a, amp: 1.3, loot: 8 },
  { id: 'drift', file: 'Drift.umm', name: 'Drift', x: -1780, z: -620, color: 0xa8b8c8, amp: 1.35, loot: 8 },
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = (v) => Math.round(v * 100) / 100;

function sampleGrid(fn) {
  const out = [];
  for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
    const lx = -HALF + (i / (GRID - 1)) * DISPLAY;
    const lz = -HALF + (j / (GRID - 1)) * DISPLAY;
    out.push(r2(fn(lx, lz)));
  }
  return out;
}

// Bilinear sample of a .umm heightfield (heights index [iz*(segs+1)+ix],
// world coords centred on 0 spanning terrain.size).
function ummSampler(j) {
  const { segs, size, heights } = j.terrain;
  const n = segs + 1;
  return (sx, sz) => {
    const u = clamp((sx / size + 0.5) * segs, 0, segs - 0.001);
    const v = clamp((sz / size + 0.5) * segs, 0, segs - 0.001);
    const ix = Math.floor(u), iz = Math.floor(v), fx = u - ix, fz = v - iz;
    const a = heights[iz * n + ix] * (1 - fx) + heights[iz * n + ix + 1] * fx;
    const b = heights[(iz + 1) * n + ix] * (1 - fx) + heights[(iz + 1) * n + ix + 1] * fx;
    return a * (1 - fz) + b * fz;
  };
}

function bakeUmm(j, zn) {
  const k = DISPLAY / j.terrain.size;         // source → display scale
  const sample = ummSampler(j);
  const heights = sampleGrid((lx, lz) => clamp(sample(lx / k, lz / k) * zn.amp, -7, 85));
  // trees: stride-cap for perf, converted to display-local coords
  const treeProps = (j.props || []).filter(p => p.model === 'tree.gltf');
  const stride = Math.max(1, Math.ceil(treeProps.length / 130));
  const trees = [];
  treeProps.forEach((p, i) => {
    if (i % stride) return;
    trees.push([r2(p.pos[0] * k), r2(p.pos[1] * k), r2(clamp((p.scale || 1) * 1.5, 0.8, 2.6))]);
  });
  // solid box blocks → buildings (Arena's authored layout)
  const blocks = (j.blocks || []).filter(b => b.prim === 'box' && b.solid !== false).map(b => ({
    x: r2(b.pos[0] * k), z: r2(b.pos[1] * k),
    w: r2((b.size?.[0] || 6) * k), d: r2((b.size?.[2] || 6) * k), h: r2((b.size?.[1] || 5) * k),
    rot: r2(b.rotY || 0),
  }));
  return { heights, trees, blocks, night: !!(j.night || j.midnight), pvp: !!j.pvp };
}

function bakeEroded() {
  // Their features live at 750–1000 m scale, so compress ~2.2× into our 480 m
  // zone, and pick the seed whose window has the most relief (baseHeight scan
  // is cheap; the hydraulic-erosion field is only built for the winner).
  const K = 3.2;
  let best = null;
  for (const seed of [2026, 7, 42, 1337, 555, 9001, 31415]) {
    const t = createRealisticTerrain(seed);
    const hs = [];
    for (let j = 0; j < 17; j++) for (let i = 0; i < 17; i++)
      hs.push(t.baseHeight(-HALF * K + (i / 16) * DISPLAY * K, -HALF * K + (j / 16) * DISPLAY * K));
    hs.sort((a, b) => a - b);
    const relief = hs[Math.floor(hs.length * 0.97)] - hs[Math.floor(hs.length * 0.05)];
    if (!best || relief > best.relief) best = { seed, relief };
  }
  console.log(`  eroded seed ${best.seed} relief ${best.relief.toFixed(1)}m`);
  const terr = createRealisticTerrain(best.seed);
  terr.recenter(0, 0);                        // build the erosion field
  const hc = terr.height(0, 0);
  const raw = sampleGrid((lx, lz) => terr.height(lx * K, lz * K) - hc);
  // Percentile stretch: push the p98 up to ~+68 m so the zone reads as real
  // highlands regardless of which window the seed produced.
  const sorted = [...raw].sort((a, b) => a - b);
  const p98 = Math.max(8, sorted[Math.floor(sorted.length * 0.98)]);
  const heights = raw.map(v => r2(clamp(v * (68 / p98), -8, 95)));
  return { heights, trees: [], blocks: [], night: false, pvp: false };
}

function main() {
  const srcDir = process.argv[2];
  if (!srcDir) { console.error('usage: node tools/bake_maps.mjs <.umm maps dir>'); process.exit(1); }
  const zones = [];
  for (const zn of ZONES) {
    let baked;
    if (zn.gen) baked = bakeEroded();
    else {
      const file = path.join(srcDir, zn.file);
      baked = bakeUmm(JSON.parse(fs.readFileSync(file, 'utf8')), zn);
    }
    // Flatten a building pad around the centre (ring settlements need footing);
    // authored-block maps (Arena) are already flat. Keeps ~78% of centre height.
    if (!baked.blocks.length) {
      const H = baked.heights, c = H[Math.floor(GRID / 2) * GRID + Math.floor(GRID / 2)];
      for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
        const lx = -HALF + (i / (GRID - 1)) * DISPLAY, lz = -HALF + (j / (GRID - 1)) * DISPLAY;
        const d = Math.hypot(lx, lz);
        const t = clamp((d - 90) / 120, 0, 1);
        const f = 0.55 * (1 - t * t * (3 - 2 * t));
        H[j * GRID + i] = r2(H[j * GRID + i] * (1 - f) + c * f);
      }
    }
    zones.push({
      id: zn.id, name: zn.name, x: zn.x, z: zn.z, color: zn.color,
      loot: zn.loot, grid: GRID, half: HALF, blend: 130, night: baked.night, pvp: baked.pvp,
      heights: baked.heights, trees: baked.trees, blocks: baked.blocks,
    });
    console.log(`baked ${zn.name} (${zn.file || 'generator'}) trees=${baked.trees.length} blocks=${baked.blocks.length} h=[${Math.min(...baked.heights)}..${Math.max(...baked.heights)}]`);
  }
  const header = `// GENERATED by tools/bake_maps.mjs — do not hand-edit.\n// Heights are RELATIVE metres on a ${GRID}×${GRID} grid spanning ${DISPLAY} m; zones are\n// anchored to native terrain at runtime (server/map.js / public/js/world.js).\n`;
  const body = JSON.stringify({ zones });
  fs.writeFileSync(path.join(ROOT, 'server/maps_data.js'), header + `module.exports = ${body};\n`);
  fs.writeFileSync(path.join(ROOT, 'public/js/maps_data.js'), header + `export const MAPS_DATA = ${body};\n`);
  console.log('wrote server/maps_data.js + public/js/maps_data.js');
}
main();
