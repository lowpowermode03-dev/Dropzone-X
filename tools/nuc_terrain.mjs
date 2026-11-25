// Seeded Perlin + hydraulic-erosion terrain generator, used OFFLINE by
// tools/bake_maps.mjs to bake the "Ashen Highlands" zone into Dropzone X.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function smoothstep(a, b, x) {
  if (a === b) return x < a ? 0 : 1;
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}



let _gx = 0, _gy = 0;

function gradDir(ix, iy, seed) {
  const k = 289 + seed;
  let x = ix % k;
  const y = iy % k;
  x = (((34 * x + 1) * x) % k) + y;
  x = ((34 * x + 1) * x) % k;
  x = (x / 41 - Math.floor(x / 41)) * 2 - 1;
  const dx = x - Math.floor(x + 0.5);
  const dy = Math.abs(x) - 0.5;
  const inv = 1 / Math.hypot(dx, dy);
  _gx = dx * inv;
  _gy = dy * inv;
}

function perlin(px, py, seed) {
  const ix = Math.floor(px), iy = Math.floor(py);
  const fx = px - ix, fy = py - iy;

  gradDir(ix, iy, seed);
  const d00 = _gx * fx + _gy * fy;
  gradDir(ix + 1, iy, seed);
  const d10 = _gx * (fx - 1) + _gy * fy;
  gradDir(ix, iy + 1, seed);
  const d01 = _gx * fx + _gy * (fy - 1);
  gradDir(ix + 1, iy + 1, seed);
  const d11 = _gx * (fx - 1) + _gy * (fy - 1);

  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = d00 + (d10 - d00) * ux;
  const b = d01 + (d11 - d01) * ux;
  return a + (b - a) * uy;
}




const NOISE_A = { scale: 750, lac: 2.26, pers: 0.382, layers: 8, seed: 321, remap: true };
const NOISE_B = { scale: 1000, lac: 2.25, pers: 0.335, layers: 1, seed: 629, remap: false };

function remapA(u) {
  return smoothstep(0.1, 1, clamp01(u));
}

function layered(x, z, o) {
  let scale = o.scale;
  let amp = 1;
  let sign = 1;
  let sum = 0;
  for (let i = 1; i <= o.layers; i++) {

    let n = 0.5 - perlin(x / scale, z / scale, o.seed) * 0.5;
    if (o.remap) n = remapA(n);
    sum += sign * n * amp;
    scale /= o.lac;
    amp *= o.pers;
    sign = -sign;
  }
  return o.remap
    ? Math.sign(sum) * remapA(Math.abs(sum))
    : Math.sign(sum) * clamp01(Math.abs(sum));
}



function levels(v, inLow, inMid, inHigh, outLow, outHigh) {
  if (v <= inMid) v = (v - inLow) / ((2 * inMid - inLow) - inLow);
  else v = (v - (2 * inMid - inHigh)) / (inHigh - (2 * inMid - inHigh));
  return outLow + (outHigh - outLow) * clamp01(v);
}


const SEA = 20;
const FIELD_R = 512;
const CELL = 3;
const GRID = Math.floor((FIELD_R * 2) / CELL) + 1;

export function createRealisticTerrain(seed = 0) {


  const ox = (seed % 9973) * 0.731 + 113.7;
  const oz = (seed % 9967) * 0.577 + 71.3;

  function graph01(sx, sz) {
    const x = sx + ox;
    const z = sz + oz;
    const a = layered(x, z, NOISE_A);
    const b = layered(x, z, NOISE_B);
    return levels(clamp01(a * b), 0, 0.5, 1, 0.05, 1);
  }

  function baseHeight(sx, sz) {
    const t = clamp01((graph01(sx, sz) - 0.09) / 0.42);
    const relief = 12 * smoothstep(0, 0.4, t) + 155 * Math.pow(t, 3);


    const x = sx + ox, z = sz + oz;
    const fine = perlin(x / 130, z / 130, 4721) * 0.7 + perlin(x / 45, z / 45, 5501) * 0.3;
    return SEA + 6 + relief + fine * (2.6 + 2.2 * t);
  }

  let field = null;


  function rngAt(cx, cz) {
    let s = (Math.imul(cx | 0, 374761393) ^ Math.imul(cz | 0, 668265263) ^ Math.imul(seed | 0, 1274126177)) >>> 0;
    return () => {
      s = (Math.imul(s ^ (s >>> 15), 2246822519) + 3266489917) >>> 0;
      s = (Math.imul(s ^ (s >>> 13), 3266489917) + 668265263) >>> 0;
      return ((s ^ (s >>> 16)) >>> 0) / 4294967296;
    };
  }

  function buildField(cx, cz) {
    const n = GRID * GRID;
    const h = new Float32Array(n);
    const x0 = cx - FIELD_R, z0 = cz - FIELD_R;
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        h[j * GRID + i] = baseHeight(x0 + i * CELL, z0 + j * CELL);
      }
    }
    const orig = h.slice();

    const at = (px, pz) => {
      const ix = Math.floor(px), iz = Math.floor(pz);
      const fx = px - ix, fz = pz - iz;
      const a = h[iz * GRID + ix] * (1 - fx) + h[iz * GRID + ix + 1] * fx;
      const b = h[(iz + 1) * GRID + ix] * (1 - fx) + h[(iz + 1) * GRID + ix + 1] * fx;
      return a * (1 - fz) + b * fz;
    };
    const move = (px, pz, amount) => {
      const ix = Math.floor(px), iz = Math.floor(pz);
      const fx = px - ix, fz = pz - iz;
      h[iz * GRID + ix] += amount * (1 - fx) * (1 - fz);
      h[iz * GRID + ix + 1] += amount * fx * (1 - fz);
      h[(iz + 1) * GRID + ix] += amount * (1 - fx) * fz;
      h[(iz + 1) * GRID + ix + 1] += amount * fx * fz;
    };

    const rnd = rngAt(cx, cz);
    const droplets = 26000;
    const inertia = 0.06;
    const capacityFactor = 4;
    const erodeSpeed = 0.35;
    const depositSpeed = 0.25;
    const evaporate = 0.015;

    for (let d = 0; d < droplets; d++) {
      let px = 4 + rnd() * (GRID - 9);
      let pz = 4 + rnd() * (GRID - 9);
      let dx = 0, dz = 0, speed = 1, water = 1, sediment = 0;
      for (let step = 0; step < 34; step++) {
        const oldH = at(px, pz);
        const gx = (at(px + 1, pz) - at(px - 1, pz)) * 0.5;
        const gz = (at(px, pz + 1) - at(px, pz - 1)) * 0.5;

        dx = dx * inertia - gx * (1 - inertia);
        dz = dz * inertia - gz * (1 - inertia);
        if (dx * dx + dz * dz < 1e-5) break;
        const len = Math.hypot(dx, dz);
        dx /= len;
        dz /= len;

        const nx = px + dx, nz = pz + dz;
        if (nx < 1 || nz < 1 || nx > GRID - 3 || nz > GRID - 3) break;
        const newH = at(nx, nz);
        const dh = newH - oldH;
        const capacity = Math.max(-dh, 0.01) * speed * water * capacityFactor;

        if (sediment > capacity || dh > 0) {
          const amount = dh > 0 ? Math.min(dh, sediment) : (sediment - capacity) * depositSpeed;
          sediment -= amount;
          move(px, pz, amount);
        } else {
          const amount = Math.min((capacity - sediment) * erodeSpeed, -dh);
          sediment += amount;
          move(px, pz, -amount);
        }

        speed = Math.sqrt(Math.max(0.001, speed * speed - dh));
        water *= 1 - evaporate;
        px = nx;
        pz = nz;
      }
    }


    const delta = new Float32Array(n);
    for (let i = 0; i < n; i++) delta[i] = h[i] - orig[i];
    field = { cx, cz, delta };
  }



  function erosionAt(sx, sz) {
    const fx = (sx - (field.cx - FIELD_R)) / CELL;
    const fz = (sz - (field.cz - FIELD_R)) / CELL;
    if (fx < 0 || fz < 0 || fx >= GRID - 1 || fz >= GRID - 1) return 0;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const ux = fx - ix, uz = fz - iz;
    const d = field.delta;
    const a = d[iz * GRID + ix] * (1 - ux) + d[iz * GRID + ix + 1] * ux;
    const b = d[(iz + 1) * GRID + ix] * (1 - ux) + d[(iz + 1) * GRID + ix + 1] * ux;
    const v = a * (1 - uz) + b * uz;
    const dist = Math.hypot(sx - field.cx, sz - field.cz);
    return v * (1 - smoothstep(FIELD_R * 0.78, FIELD_R * 0.98, dist));
  }

  function height(sx, sz) {
    const b = baseHeight(sx, sz);
    return field ? b + erosionAt(sx, sz) : b;
  }



  function recenter(x, z) {
    if (field && Math.hypot(x - field.cx, z - field.cz) < FIELD_R * 0.7) return;
    buildField(x, z);
  }

  function slopeDeg(sx, sz) {
    const e = 1.25;
    const hx = (height(sx + e, sz) - height(sx - e, sz)) / (2 * e);
    const hz = (height(sx, sz + e) - height(sx, sz - e)) / (2 * e);
    return Math.atan(Math.hypot(hx, hz)) * 57.29578;
  }



  function surface(sx, sz, y, surf) {
    const slope = slopeDeg(sx, sz);
    const rock = smoothstep(24, 40, slope);
    const alt = smoothstep(112, 150, y + 12 * perlin(sx * 0.03, sz * 0.03, 97));
    const snow = Math.max(alt * (1 - smoothstep(30, 44, slope)), surf === 'snow' ? smoothstep(70, 110, y) : 0);
    return { rock, snow: clamp01(snow) };
  }

  function mapColor(sx, sz, y, def) {
    const slope = slopeDeg(sx, sz);
    if (smoothstep(24, 40, slope) > 0.5) return [0.55, 0.53, 0.50];
    if (smoothstep(112, 150, y) > 0.45) return [0.93, 0.94, 0.96];
    return def?.top || [0.34, 0.55, 0.28];
  }

  return { height, surface, mapColor, slopeDeg, recenter, baseHeight };
}
