// Dropzone X — "Vercel Play" transport.
//
// When no persistent game server is reachable (e.g. the site is hosted on
// Vercel's serverless functions, which can't hold a Socket.IO room open),
// the client swaps the network socket for this drop-in replacement:
//
//   * SoloEngine — a faithful in-browser port of the authoritative room in
//     server/game.js: Battle Bus, 23 tiered bots, wild mobs, loot, storm,
//     building, harvesting. It speaks the exact same event protocol, so the
//     renderer/HUD in client.js can't tell the difference.
//   * SoloSocket — socket-shaped adapter + the live online layer: Supabase
//     Realtime presence & lobby chat, so you still see and talk to other
//     real players. Match results are posted to /api/match/result, which
//     grants the same XP / V-Bucks a hosted match would.
//
// If a dedicated game server IS running (local `npm start`, Render, or the
// ?server= override), none of this is used — the real Socket.IO path wins.

import { terrainHeight } from './world.js';

const STORM_PHASES = [
  { radius: 1250, wait: 35, shrink: 30, dps: 1 },
  { radius: 850, wait: 25, shrink: 25, dps: 2 },
  { radius: 550, wait: 20, shrink: 20, dps: 5 },
  { radius: 320, wait: 18, shrink: 18, dps: 8 },
  { radius: 170, wait: 15, shrink: 15, dps: 10 },
  { radius: 80, wait: 12, shrink: 12, dps: 15 },
  { radius: 0, wait: 10, shrink: 12, dps: 20 },
];
const BOT_NAMES = ['Vortex', 'Nova', 'Blaze', 'Echo', 'Rogue', 'Pixel', 'Zephyr', 'Onyx', 'Flux', 'Havoc', 'Lyra', 'Orion', 'Sable', 'Drift', 'Koda', 'Raven', 'Solstice', 'Mira', 'Jett', 'Wraith', 'Cinder', 'Atlas', 'Vega', 'Rune'];
const BOT_SKILLS = {
  noob: { aim: 0.42, reaction: 850, engage: 62, turn: 2.2, strafe: 0.004, jump: 0, healAt: 0, fleeAt: 0, extraDelay: 300, spd: 0.9 },
  mid: { aim: 0.85, reaction: 420, engage: 95, turn: 4.2, strafe: 0.02, jump: 0.004, healAt: 42, fleeAt: 14, extraDelay: 150, spd: 1.0 },
  pro: { aim: 1.3, reaction: 170, engage: 125, turn: 7.5, strafe: 0.045, jump: 0.014, healAt: 58, fleeAt: 26, extraDelay: 60, spd: 1.08 },
};
const MOB_KINDS = {
  boar: { name: 'Wild Boar', hp: 70, speed: 7.4, dmg: 9, aggro: 24, atkRange: 2.5, atkCd: 800, scale: 1 },
  stalker: { name: 'Night Stalker', hp: 120, speed: 9.6, dmg: 15, aggro: 34, atkRange: 2.7, atkCd: 950, scale: 1.3 },
};
const AMMO_FOR = { pistol: 'light', smg: 'light', ar: 'medium', lmg: 'medium', sniper: 'heavy', shotgun: 'shells', burst: 'medium', revolver: 'heavy', pump: 'shells', dmr: 'heavy' };
const MAT_HP = { wood: 150, stone: 250, metal: 350 };
const RARITY_MULT = [1, 1.08, 1.17, 1.27, 1.38];
const NODE_CELL = 40;

const dist2D = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const rollSkill = () => { const r = Math.random(); return r < 0.35 ? 'noob' : r < 0.75 ? 'mid' : 'pro'; };

function rayAABB(o, d, minX, minY, minZ, maxX, maxY, maxZ) {
  let tmin = 0, tmax = Infinity;
  const axes = [[o.x, d.x, minX, maxX], [o.y, d.y, minY, maxY], [o.z, d.z, minZ, maxZ]];
  for (const [oo, dd, mn, mx] of axes) {
    if (Math.abs(dd) < 1e-9) { if (oo < mn || oo > mx) return null; }
    else {
      let t1 = (mn - oo) / dd, t2 = (mx - oo) / dd;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

function makeInventory() {
  // Everyone drops with a pistol in slot 2 — no more defenceless landings.
  return [
    { kind: 'weapon', weaponId: 'pickaxe', rarity: 0, mag: Infinity },
    { kind: 'weapon', weaponId: 'pistol', rarity: 0, mag: 12 },
    null, null, null,
  ];
}

let SEQ = 1;

export class SoloEngine {
  // deps: { meta, world: {pois, buildings, trees, rocks}, me: {username, guest, vbucks, character, armor}, fire(ev, data), getPeers() }
  constructor(deps) {
    this.meta = deps.meta;
    this.world = deps.world;
    this.me = deps.me;
    this.fire = deps.fire;
    this.getPeers = deps.getPeers || (() => []);
    this.myId = 'solo_you';
    this.phase = 'idle'; // idle | waiting | bus | playing | ended
    this.players = new Map();
    this.loot = new Map();
    this.mobs = new Map();
    this.structures = new Map();
    this.nodeHealth = new Map();
    this.storm = { phaseIdx: -1, state: 'idle', timer: 20, cx: 0, cz: 0, radius: 1900, tcx: 0, tcz: 0, tradius: 1900, fromRadius: 1900, fromCx: 0, fromCz: 0, dps: 0, shrinkTotal: 1, shrinkElapsed: 0 };
    this.bus = { x: -1900, z: (Math.random() - 0.5) * 1400, y: 345, speed: 95, dir: 1 };
    this.totalFighters = 0;
    this.timer = null;
    this.queueTimer = null;
    this.humanDeadAt = 0;
    // spatial hash of solid nodes (trees/rocks) mirroring server/game.js
    this.nodeHash = new Map();
    const addNode = (kind, i, n) => {
      const isTree = kind === 'tree';
      const rec = { kind, i, x: n.x, z: n.z, r: isTree ? 0.55 * n.s : 1.9 * n.s, top: isTree ? 5.2 * n.s : 2.3 * n.s, base: terrainHeight(n.x, n.z) };
      const key = Math.floor(n.x / NODE_CELL) + ',' + Math.floor(n.z / NODE_CELL);
      if (!this.nodeHash.has(key)) this.nodeHash.set(key, []);
      this.nodeHash.get(key).push(rec);
    };
    (this.world.trees || []).forEach((n, i) => addNode('tree', i, n));
    (this.world.rocks || []).forEach((n, i) => addNode('rock', i, n));
  }

  // ---------- helpers ----------
  weapons() { return this.meta.weapons; }
  items() { return this.meta.items; }
  alive() { return [...this.players.values()].filter(p => p.alive); }
  human() { return this.players.get(this.myId); }
  nodesNear(x, z, rad) {
    const out = [];
    const c0x = Math.floor((x - rad) / NODE_CELL), c1x = Math.floor((x + rad) / NODE_CELL);
    const c0z = Math.floor((z - rad) / NODE_CELL), c1z = Math.floor((z + rad) / NODE_CELL);
    for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
      const cell = this.nodeHash.get(cx + ',' + cz);
      if (cell) out.push(...cell);
    }
    return out;
  }
  rollLoot() {
    const rng = Math.random;
    const r = rng();
    if (r < 0.45) {
      const ids = Object.keys(this.weapons()).filter(id => id !== 'pickaxe');
      const id = ids[Math.floor(rng() * ids.length)];
      const q = rng();
      let rarity = 0;
      if (q > 0.97) rarity = 4; else if (q > 0.90) rarity = 3; else if (q > 0.75) rarity = 2; else if (q > 0.5) rarity = 1;
      return { kind: 'weapon', weaponId: id, rarity };
    }
    if (r < 0.60) return { kind: 'item', itemId: ['shield_small', 'shield_big', 'medkit', 'bandage'][Math.floor(rng() * 4)] };
    if (r < 0.75) return { kind: 'item', itemId: ['ammo_light', 'ammo_medium', 'ammo_heavy', 'ammo_shells'][Math.floor(rng() * 4)] };
    return { kind: 'item', itemId: ['wood', 'stone', 'metal'][Math.floor(rng() * 3)] };
  }
  spawnLoot(rolled, x, z) {
    let y = terrainHeight(x, z);
    if (y < -3) y = -3;
    const item = { id: 'loot_' + (SEQ++), kind: rolled.kind, weaponId: rolled.weaponId || null, itemId: rolled.itemId || null, rarity: rolled.rarity || 0, x, y: Math.max(y, -2) + 0.6, z };
    this.loot.set(item.id, item);
    return item;
  }
  makePlayer({ id, username, isBot, character, armor, enemy, color }) {
    return {
      id, username, isBot: !!isBot,
      character: character || 'recruit', armor: armor || 'standard', enemy: enemy || null, color: color || 0x9db4c8,
      x: 0, y: 300, z: 0, yaw: 0, pitch: 0,
      health: 100, shield: 0, alive: true, placement: 0,
      inBus: true, skydiving: false, gliding: false, onGround: false,
      kills: 0, damageDealt: 0, slot: 0,
      inventory: makeInventory(),
      materials: { wood: 50, stone: 0, metal: 0 },
      ammo: { light: 36, medium: 30, heavy: 0, shells: 0 },
      lastShootAt: 0, reloadingUntil: 0, usingUntil: 0, pendingUse: null,
      lastStormTick: 0, lastAiAt: 0, aiTarget: null, aiStrafe: 1, jumpAt: 0,
      skill: 'mid', spd: 1, foeId: null, foeSince: 0, hopUntil: 0, lastHealAt: 0,
    };
  }
  weaponOf(p) {
    const slot = p.inventory[p.slot];
    if (!slot || slot.kind !== 'weapon') return null;
    return { slot, def: this.weapons()[slot.weaponId] };
  }
  publicSelf(p) {
    return {
      id: p.id, health: p.health, shield: p.shield, slot: p.slot,
      inventory: p.inventory.map(s => s ? { ...s, mag: s.mag === Infinity ? 999 : s.mag } : null),
      materials: p.materials, ammo: p.ammo, kills: p.kills,
    };
  }
  toHuman(ev, data) { this.fire(ev, data); }
  emitAll(ev, data) { this.fire(ev, data); } // single local player: "broadcast" == to human

  // ---------- queue / match lifecycle ----------
  queue() {
    if (this.phase === 'waiting' || this.phase === 'bus' || this.phase === 'playing') return;
    this.phase = 'waiting';
    let ticks = 0;
    const names = () => {
      const peers = this.getPeers().filter(n => n !== this.me.username);
      const bots = BOT_NAMES.slice(0, Math.min(BOT_NAMES.length, 4 + ticks * 5));
      return [this.me.username, ...peers, ...bots.filter(n => !peers.includes(n))].map(username => ({ username }));
    };
    this.fire('lobbyUpdate', { players: names() });
    this.queueTimer = setInterval(() => {
      ticks++;
      if (ticks >= 3) { clearInterval(this.queueTimer); this.queueTimer = null; this.startMatch(); }
      else this.fire('lobbyUpdate', { players: names() });
    }, 1600);
  }
  leaveQueue() {
    if (this.phase !== 'waiting') return;
    clearInterval(this.queueTimer); this.queueTimer = null;
    this.phase = 'idle';
  }
  startMatch() {
    this.players.clear(); this.loot.clear(); this.mobs.clear(); this.structures.clear(); this.nodeHealth.clear();
    this.bus = { x: -1900, z: (Math.random() - 0.5) * 1400, y: 345, speed: 95, dir: 1 };
    this.storm = { phaseIdx: -1, state: 'idle', timer: 20, cx: 0, cz: 0, radius: 1900, tcx: 0, tcz: 0, tradius: 1900, fromRadius: 1900, fromCx: 0, fromCz: 0, dps: 0, shrinkTotal: 1, shrinkElapsed: 0 };
    this.phase = 'bus';
    const me = this.makePlayer({ id: this.myId, username: this.me.username, character: this.me.character, armor: this.me.armor });
    this.players.set(me.id, me);
    // fill with bots to 24 fighters
    const foes = this.meta.enemyCharacters || [];
    const armors = this.meta.enemyArmors || [];
    for (let i = 0; i < 23; i++) {
      const foe = foes.length ? foes[i % foes.length] : null;
      const bot = this.makePlayer({
        id: 'bot_' + i, username: BOT_NAMES[i % BOT_NAMES.length] + (i >= BOT_NAMES.length ? '_' + i : ''), isBot: true,
        character: foe ? foe.id : 'recruit', armor: armors.length ? armors[i % armors.length].id : 'standard',
        enemy: foe ? foe.name : null, color: foe ? foe.suit : 0x9db4c8,
      });
      bot.skill = rollSkill();
      bot.spd = BOT_SKILLS[bot.skill].spd;
      bot.jumpAt = 0.15 + Math.random() * 0.7;
      this.players.set(bot.id, bot);
    }
    this.totalFighters = this.players.size;
    // loot: cluster around POIs/buildings like the hosted island
    const spawns = [];
    for (const poi of this.world.pois) for (let k = 0; k < 7; k++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * 55;
      spawns.push({ x: poi.x + Math.cos(a) * d, z: poi.z + Math.sin(a) * d });
    }
    for (const b of this.world.buildings) for (let k = 0; k < 2; k++) {
      spawns.push({ x: b.x + (Math.random() - 0.5) * (b.w + 8), z: b.z + (Math.random() - 0.5) * (b.d + 8) });
    }
    for (let k = 0; k < 130; k++) spawns.push({ x: (Math.random() - 0.5) * 3600, z: (Math.random() - 0.5) * 3600 });
    for (const pt of spawns) {
      if (Math.random() < 0.25) continue;
      if (terrainHeight(pt.x, pt.z) < 0.5) continue;
      this.spawnLoot(this.rollLoot(), pt.x, pt.z);
    }
    this.spawnMobs();
    for (const p of this.players.values()) { p.x = this.bus.x; p.y = this.bus.y; p.z = this.bus.z; }
    this.fire('matchStart', {
      roomId: 'solo', bus: this.bus,
      pois: this.world.pois, buildings: this.world.buildings, trees: this.world.trees, rocks: this.world.rocks,
      loot: [...this.loot.values()], totalFighters: this.totalFighters, you: this.myId,
    });
    this.toHuman('selfUpdate', this.publicSelf(me));
    this.timer = setInterval(() => this.tick(), 50);
  }
  spawnMobs() {
    const pois = this.world.pois;
    for (let i = 0; i < 34; i++) {
      let x = 0, z = 0, ok = false;
      for (let tries = 0; tries < 8 && !ok; tries++) {
        if (Math.random() < 0.65 && pois.length) {
          const poi = pois[Math.floor(Math.random() * pois.length)];
          const a = Math.random() * Math.PI * 2, d = 50 + Math.random() * 170;
          x = poi.x + Math.cos(a) * d; z = poi.z + Math.sin(a) * d;
        } else { x = (Math.random() - 0.5) * 3400; z = (Math.random() - 0.5) * 3400; }
        ok = terrainHeight(x, z) > 1 && Math.abs(x) < 1900 && Math.abs(z) < 1900;
      }
      if (!ok) continue;
      const kind = Math.random() < 0.3 ? 'stalker' : 'boar';
      const def = MOB_KINDS[kind];
      const id = 'mob_' + (SEQ++);
      this.mobs.set(id, {
        id, kind, x, y: terrainHeight(x, z), z, yaw: Math.random() * 6.28,
        hp: def.hp, maxHp: def.hp, scale: def.scale, homeX: x, homeZ: z,
        wx: x, wz: z, aggroId: null, nextAtk: 0, nextWander: 0,
      });
    }
  }
  destroy() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.queueTimer) { clearInterval(this.queueTimer); this.queueTimer = null; }
    if (this.phase !== 'idle') this.phase = 'ended';
  }

  // ---------- human inputs ----------
  handleMove(m) {
    const p = this.human();
    if (!p || !p.alive || !m || !isFinite(m.x)) return;
    p.x = m.x; p.y = m.y; p.z = m.z;
    p.yaw = m.yaw || 0; p.pitch = m.pitch || 0;
    if (!p.inBus) { p.skydiving = !!m.skydiving; p.gliding = !!m.gliding; }
    p.onGround = !!m.onGround;
  }
  handleJump() {
    const p = this.human();
    if (!p || !p.inBus) return;
    p.inBus = false; p.skydiving = true; p.gliding = false;
    p.x = this.bus.x; p.y = this.bus.y - 5; p.z = this.bus.z;
    this.toHuman('youJumped', { x: p.x, y: p.y, z: p.z });
  }
  setSlot(n) {
    const p = this.human();
    if (!p || n < 0 || n > 4) return;
    p.slot = n;
    this.toHuman('selfUpdate', this.publicSelf(p));
  }

  // ---------- combat ----------
  rayHitPlayer(origin, dir, excludeId) {
    let best = null;
    for (const p of this.players.values()) {
      if (!p.alive || p.id === excludeId || p.inBus) continue;
      const cx = p.x, cy = p.y + 1.0, cz = p.z;
      const ox = cx - origin.x, oy = cy - origin.y, oz = cz - origin.z;
      const t = ox * dir.x + oy * dir.y + oz * dir.z;
      if (t < 0 || t > 420) continue;
      const px = origin.x + dir.x * t, py = origin.y + dir.y * t, pz = origin.z + dir.z * t;
      const d = Math.hypot(px - cx, py - cy, pz - cz);
      if (d < 1.05 && (!best || t < best.t)) best = { player: p, t, headshot: py > p.y + 1.55 };
    }
    return best;
  }
  rayHitMob(origin, dir) {
    let best = null;
    for (const m of this.mobs.values()) {
      const r = 1.05 * (m.scale || 1);
      const cx = m.x, cy = m.y + 0.75 * (m.scale || 1), cz = m.z;
      const ox = cx - origin.x, oy = cy - origin.y, oz = cz - origin.z;
      const t = ox * dir.x + oy * dir.y + oz * dir.z;
      if (t < 0 || t > 420) continue;
      const px = origin.x + dir.x * t, py = origin.y + dir.y * t, pz = origin.z + dir.z * t;
      const d = Math.hypot(px - cx, py - cy, pz - cz);
      if (d < r && (!best || t < best.t)) best = { mob: m, t, headshot: py > m.y + 1.25 * (m.scale || 1) };
    }
    return best;
  }
  rayBlocked(origin, dir, maxT) {
    let best = null;
    const limit = () => (best === null ? maxT : Math.min(maxT, best));
    for (const b of this.world.buildings) {
      const gy = terrainHeight(b.x, b.z);
      const t = rayAABB(origin, dir, b.x - b.w / 2, gy, b.z - b.d / 2, b.x + b.w / 2, gy + b.h, b.z + b.d / 2);
      if (t !== null && t < limit()) best = t;
    }
    for (const s of this.structures.values()) {
      const t = rayAABB(origin, dir, s.x - 2.5, s.y, s.z - 2.5, s.x + 2.5, s.y + 5.2, s.z + 2.5);
      if (t !== null && t < limit()) best = t;
    }
    // solid trees & rocks (trunk/boulder cylinders), skipping felled nodes
    const ex = origin.x + dir.x * limit(), ez = origin.z + dir.z * limit();
    const cand = this.nodesNear((origin.x + ex) / 2, (origin.z + ez) / 2, Math.hypot(ex - origin.x, ez - origin.z) / 2 + NODE_CELL);
    const denom = dir.x * dir.x + dir.z * dir.z;
    if (denom > 1e-9) {
      for (const n of cand) {
        const key = n.kind + ':' + n.i;
        if (this.nodeHealth.has(key) && this.nodeHealth.get(key) <= 0) continue;
        const t = ((n.x - origin.x) * dir.x + (n.z - origin.z) * dir.z) / denom;
        if (t < 0 || t > limit()) continue;
        const px = origin.x + dir.x * t, py = origin.y + dir.y * t, pz = origin.z + dir.z * t;
        if (Math.hypot(px - n.x, pz - n.z) < n.r && py > n.base - 1 && py < n.base + n.top && (best === null || t < best)) best = t;
      }
    }
    return best;
  }
  damageStructureAt(origin, dir, t, damage) {
    const px = origin.x + dir.x * t, py = origin.y + dir.y * t, pz = origin.z + dir.z * t;
    for (const s of this.structures.values()) {
      if (Math.abs(px - s.x) <= 2.6 && py >= s.y - 0.5 && py <= s.y + 5.4 && Math.abs(pz - s.z) <= 2.6) {
        s.health -= damage;
        if (s.health <= 0) { this.structures.delete(s.id); this.emitAll('structureRemoved', { id: s.id }); }
        return;
      }
    }
  }
  handleShoot({ dir, origin } = {}) {
    const p = this.human();
    if (!p || !p.alive || p.inBus || !dir) return;
    const w = this.weaponOf(p);
    if (!w) return;
    const now = Date.now();
    if (now - p.lastShootAt < w.def.fireRate) return;
    if (now < p.reloadingUntil || now < p.usingUntil) return;
    p.lastShootAt = now;
    if (w.def.type === 'melee') return;
    if (w.slot.mag <= 0) { this.toHuman('needReload', {}); return; }
    w.slot.mag -= 1;
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const d = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
    const o = origin && isFinite(origin.x) ? origin : { x: p.x, y: p.y + 1.6, z: p.z };
    for (let pellet = 0; pellet < w.def.pellets; pellet++) {
      const spread = w.def.spread;
      const pd = { x: d.x + (Math.random() - 0.5) * spread * 2, y: d.y + (Math.random() - 0.5) * spread * 2, z: d.z + (Math.random() - 0.5) * spread * 2 };
      const pl = Math.hypot(pd.x, pd.y, pd.z); pd.x /= pl; pd.y /= pl; pd.z /= pl;
      const hit = this.rayHitPlayer(o, pd, p.id);
      const mobHit = this.rayHitMob(o, pd);
      const targetT = Math.min(hit ? hit.t : Infinity, mobHit ? mobHit.t : Infinity);
      const blockedT = this.rayBlocked(o, pd, targetT === Infinity ? w.def.range : targetT);
      const endT = blockedT !== null ? blockedT : (hit ? hit.t : (mobHit ? mobHit.t : w.def.range));
      const end = { x: o.x + pd.x * endT, y: o.y + pd.y * endT, z: o.z + pd.z * endT };
      this.emitAll('tracer', { from: o, to: end, weaponId: w.def.id, shooter: p.id });
      if (mobHit && blockedT === null && (!hit || mobHit.t <= hit.t)) {
        let dmg = w.def.damage * RARITY_MULT[w.slot.rarity || 0];
        if (mobHit.t > 50) dmg *= Math.max(0.55, 1 - (mobHit.t - 50) / 300);
        if (mobHit.headshot) dmg *= 1.8;
        this.damageMob(mobHit.mob, p, Math.round(dmg), mobHit.headshot);
      } else if (hit && blockedT === null) {
        let dmg = w.def.damage * RARITY_MULT[w.slot.rarity || 0];
        if (hit.t > 50) dmg *= Math.max(0.55, 1 - (hit.t - 50) / 300);
        if (hit.headshot) dmg *= 1.8;
        this.applyDamage(hit.player, p, Math.round(dmg), w.def.name, hit.headshot);
      } else if (blockedT !== null) {
        this.damageStructureAt(o, pd, blockedT, w.def.damage);
      }
    }
    this.toHuman('ammoUpdate', this.publicSelf(p));
  }
  handleMelee({ dir, origin } = {}) {
    const p = this.human();
    if (!p || !p.alive) return;
    const now = Date.now();
    if (now - p.lastShootAt < 320) return;
    p.lastShootAt = now;
    const o = origin || { x: p.x, y: p.y + 1.4, z: p.z };
    if (dir) {
      const hit = this.rayHitPlayer(o, dir, p.id);
      if (hit && hit.t <= 4.2) this.applyDamage(hit.player, p, 20, 'Pickaxe', false);
    }
    // harvest nearest standing node
    let best = null;
    for (const n of this.nodesNear(p.x, p.z, 6)) {
      const key = n.kind + ':' + n.i;
      if (this.nodeHealth.has(key) && this.nodeHealth.get(key) <= 0) continue;
      const d = dist2D(p.x, p.z, n.x, n.z);
      if (d < 4.5 && (!best || d < best.d)) best = { type: n.kind, index: n.i, key, d };
    }
    if (best) {
      const isTree = best.type === 'tree';
      const cur = this.nodeHealth.has(best.key) ? this.nodeHealth.get(best.key) : (isTree ? 100 : 160);
      const next = cur - 50;
      this.nodeHealth.set(best.key, next);
      p.materials[isTree ? 'wood' : 'stone'] += 12;
      this.emitAll('nodeHit', { type: best.type, index: best.index, health: Math.max(0, next) });
      if (next <= 0) this.emitAll('nodeGone', { type: best.type, index: best.index });
      this.toHuman('selfUpdate', this.publicSelf(p));
    }
  }
  handleReload() {
    const p = this.human();
    if (!p) return;
    const w = this.weaponOf(p);
    if (!w || w.def.type === 'melee') return;
    const at = AMMO_FOR[w.def.id];
    if (!at || p.ammo[at] <= 0 || w.slot.mag >= w.def.mag) return;
    p.reloadingUntil = Date.now() + w.def.reload;
    setTimeout(() => {
      if (!p.alive) return;
      const need = w.def.mag - w.slot.mag;
      const take = Math.min(need, p.ammo[at]);
      w.slot.mag += take; p.ammo[at] -= take;
      p.reloadingUntil = 0;
      this.toHuman('ammoUpdate', this.publicSelf(p));
    }, w.def.reload);
  }
  handlePickup(lootId) {
    const p = this.human();
    const item = this.loot.get(lootId);
    if (!item || !p || !p.alive) return;
    if (dist2D(p.x, p.z, item.x, item.z) > 5 || Math.abs(p.y - item.y) > 8) return;
    if (item.kind === 'weapon') {
      let idx = p.inventory.findIndex((s, i) => i > 0 && !s);
      if (idx === -1) idx = p.slot > 0 ? p.slot : 1;
      const def = this.weapons()[item.weaponId];
      p.inventory[idx] = { kind: 'weapon', weaponId: item.weaponId, rarity: item.rarity, mag: def.mag };
      const at = AMMO_FOR[item.weaponId];
      if (at) p.ammo[at] += at === 'heavy' ? 6 : at === 'shells' ? 8 : 20;
    } else {
      const def = this.items()[item.itemId];
      if (!def) return;
      if (def.type === 'ammo' || def.type === 'mat') {
        if (def.type === 'ammo') {
          const map = { ammo_light: 'light', ammo_medium: 'medium', ammo_heavy: 'heavy', ammo_shells: 'shells' };
          p.ammo[map[item.itemId]] += def.amount;
        } else p.materials[item.itemId] += def.amount;
      } else {
        const slot = p.inventory.find(s => s && s.kind === 'item' && s.itemId === item.itemId);
        if (slot) slot.count += 1;
        else {
          const idx = p.inventory.findIndex((s, i) => i > 0 && !s);
          if (idx === -1) { this.toHuman('notice', { msg: 'Backpack full!' }); return; }
          p.inventory[idx] = { kind: 'item', itemId: item.itemId, count: 1 };
        }
      }
    }
    this.loot.delete(lootId);
    this.emitAll('lootUpdate', { added: [], removed: [lootId] });
    this.toHuman('selfUpdate', this.publicSelf(p));
  }
  handleUseItem(slotIdx) {
    const p = this.human();
    if (!p) return;
    const s = p.inventory[slotIdx];
    if (!s || s.kind !== 'item') return;
    const def = this.items()[s.itemId];
    if (!def || (def.type !== 'heal' && def.type !== 'shield')) return;
    if (def.type === 'heal' && p.health >= 100) return;
    if (def.type === 'shield' && p.shield >= 100) return;
    if (def.type === 'heal' && s.itemId === 'bandage' && p.health > 75) return;
    p.usingUntil = Date.now() + def.useTime;
    p.pendingUse = { slotIdx, itemId: s.itemId };
    this.toHuman('usingItem', { itemId: s.itemId, ms: def.useTime });
    setTimeout(() => {
      if (!p.alive || !p.pendingUse) return;
      const slot = p.inventory[slotIdx];
      if (!slot || slot.itemId !== s.itemId) return;
      if (def.type === 'heal') p.health = Math.min(100, p.health + def.amount);
      else p.shield = Math.min(100, p.shield + def.amount);
      slot.count -= 1;
      if (slot.count <= 0) p.inventory[slotIdx] = null;
      p.pendingUse = null;
      this.toHuman('selfUpdate', this.publicSelf(p));
    }, def.useTime);
  }
  handleBuild(b) {
    const p = this.human();
    if (!p || !p.alive || !b) return;
    const mat = b.material;
    if (!['wood', 'stone', 'metal'].includes(mat)) return;
    if (p.materials[mat] < 10) { this.toHuman('notice', { msg: 'Not enough materials!' }); return; }
    if (dist2D(p.x, p.z, b.x, b.z) > 14) return;
    p.materials[mat] -= 10;
    const s = { id: 'st_' + (SEQ++), type: b.type, x: b.x, y: b.y, z: b.z, rotY: b.rotY || 0, material: mat, health: MAT_HP[mat], owner: p.id };
    this.structures.set(s.id, s);
    this.emitAll('structurePlaced', s);
    this.toHuman('selfUpdate', this.publicSelf(p));
  }

  // ---------- damage / elimination ----------
  applyDamage(target, attacker, amount, weaponName, headshot, fromLabel) {
    if (!target.alive || this.phase === 'ended') return;
    let dmg = amount;
    if (target.shield > 0) {
      const absorbed = Math.min(target.shield, dmg);
      target.shield -= absorbed; dmg -= absorbed;
    }
    target.health -= dmg;
    if (attacker && attacker !== target) {
      attacker.damageDealt += amount;
      if (!attacker.isBot) this.toHuman('hitmarker', { damage: Math.round(amount), headshot: !!headshot, shieldHit: target.shield > 0 });
    }
    if (!target.isBot) {
      this.toHuman('youTookDamage', { health: target.health, shield: target.shield, from: attacker ? attacker.username : (fromLabel || 'Storm'), ax: attacker ? attacker.x : null, az: attacker ? attacker.z : null });
    }
    if (target.health <= 0) {
      target.health = 0;
      this.eliminate(target, attacker, weaponName);
    }
  }
  eliminate(target, killer, weaponName) {
    if (!target.alive) return;
    target.alive = false;
    target.placement = this.alive().length + 1;
    if (killer && killer !== target) {
      killer.kills += 1;
      if (!killer.isBot) this.toHuman('youGotKill', { kills: killer.kills, victim: target.username });
      // +30 V-Bucks per elimination (accounts only; guests never progress)
      if (!killer.isBot && !this.me.guest) {
        this.toHuman('vbucks', { amount: 30, total: (this.me.vbucks || 0) + 30 * killer.kills });
      }
    }
    // drop the victim's gear as loot
    for (let i = 1; i < target.inventory.length; i++) {
      const s = target.inventory[i];
      if (!s) continue;
      const item = this.spawnLoot(s.kind === 'weapon' ? { kind: 'weapon', weaponId: s.weaponId, rarity: s.rarity } : { kind: 'item', itemId: s.itemId }, target.x + (Math.random() - 0.5) * 4, target.z + (Math.random() - 0.5) * 4);
      this.emitAll('lootUpdate', { added: [item], removed: [] });
    }
    this.emitAll('killfeed', { killer: killer ? killer.username : null, victim: target.username, weapon: weaponName || 'Storm', killerKills: killer ? killer.kills : 0 });
    this.emitAll('playerDied', { id: target.id, placement: target.placement });
    if (!target.isBot) {
      this.humanDeadAt = Date.now();
      this.toHuman('eliminated', { placement: target.placement, kills: target.kills, damage: Math.round(target.damageDealt), totalFighters: this.totalFighters });
    }
    if (target.isBot) this.players.delete(target.id);
    this.checkWin();
  }
  checkWin() {
    const alive = this.alive();
    if (this.phase !== 'ended' && alive.length <= 1 && this.totalFighters > 1) {
      this.phase = 'ended';
      const winner = alive[0];
      if (winner) {
        winner.placement = 1;
        this.emitAll('matchEnd', { winner: winner.username, winnerId: winner.id, isBot: winner.isBot });
        if (!winner.isBot) this.toHuman('victory', { kills: winner.kills, damage: Math.round(winner.damageDealt) });
      }
    }
  }
  damageMob(mob, attacker, dmg, headshot) {
    mob.hp -= dmg;
    if (attacker) {
      mob.aggroId = attacker.id;
      if (!attacker.isBot) this.toHuman('hitmarker', { damage: Math.round(dmg), headshot: !!headshot, shieldHit: false, mob: true });
    }
    if (mob.hp <= 0) {
      this.mobs.delete(mob.id);
      const item = this.spawnLoot(this.rollLoot(), mob.x, mob.z);
      this.emitAll('lootUpdate', { added: [item], removed: [] });
      this.emitAll('mobDied', { id: mob.id, kind: mob.kind, by: attacker ? attacker.username : null, x: mob.x, y: mob.y, z: mob.z });
    }
  }

  // ---------- bots ----------
  moveToward(bot, tx, tz, speed) {
    const dx = tx - bot.x, dz = tz - bot.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.5) return;
    bot.yaw = Math.atan2(dx, dz);
    const step = Math.min(d, speed * 0.15 * (bot.spd || 1));
    bot.x += (dx / d) * step;
    bot.z += (dz / d) * step;
  }
  botPickup(bot, lootItem) {
    if (!this.loot.has(lootItem.id)) return;
    if (lootItem.kind === 'weapon') {
      let idx = bot.inventory.findIndex((s, i) => i > 0 && !s);
      if (idx === -1) {
        idx = 1;
        if (bot.inventory[idx] && bot.inventory[idx].rarity >= lootItem.rarity) return;
      }
      bot.inventory[idx] = { kind: 'weapon', weaponId: lootItem.weaponId, rarity: lootItem.rarity, mag: 30 };
      bot.slot = idx;
    } else {
      const def = this.items()[lootItem.itemId];
      if (!def) return;
      if (def.type === 'ammo') {
        const map = { ammo_light: 'light', ammo_medium: 'medium', ammo_heavy: 'heavy', ammo_shells: 'shells' };
        bot.ammo[map[lootItem.itemId]] = (bot.ammo[map[lootItem.itemId]] || 0) + def.amount;
      } else if (def.type === 'mat') bot.materials[lootItem.itemId] += def.amount;
      else if (def.type === 'shield') bot.shield = Math.min(100, bot.shield + def.amount);
      else if (def.type === 'heal') bot.health = Math.min(100, bot.health + def.amount);
    }
    this.loot.delete(lootItem.id);
    this.emitAll('lootUpdate', { added: [], removed: [lootItem.id] });
  }
  botShoot(bot, enemy, dist) {
    const w = bot.inventory[bot.slot];
    if (!w || w.kind !== 'weapon' || w.weaponId === 'pickaxe') {
      const gi = bot.inventory.findIndex(s => s && s.kind === 'weapon' && s.weaponId !== 'pickaxe');
      if (gi > 0) bot.slot = gi;
      return;
    }
    const def = this.weapons()[w.weaponId];
    if (!def || def.type === 'melee') return;
    const sk = BOT_SKILLS[bot.skill || 'mid'];
    const now = Date.now();
    if (now - (bot.foeSince || 0) < sk.reaction) return;
    if (now - bot.lastShootAt < def.fireRate + 120 + sk.extraDelay) return;
    bot.lastShootAt = now;
    const from = { x: bot.x, y: bot.y + 1.6, z: bot.z };
    const to = { x: enemy.x, y: enemy.y + 1.1, z: enemy.z };
    this.emitAll('tracer', { from, to, weaponId: def.id, shooter: bot.id });
    const hitChance = Math.min(0.85, Math.max(0.03, (0.55 - dist / 220) * sk.aim));
    if (Math.random() < hitChance) {
      let dmg = def.damage * RARITY_MULT[w.rarity || 0] * (0.7 + Math.random() * 0.5);
      if (def.id === 'shotgun' || def.id === 'pump') dmg *= Math.max(0.3, 1 - dist / 50) * 3;
      this.applyDamage(enemy, bot, Math.round(dmg), def.name, false);
    }
  }
  botThink(bot) {
    const now = Date.now();
    if (now - bot.lastAiAt < 150) return;
    bot.lastAiAt = now;
    if (bot.inBus) {
      const progress = (this.bus.x + 1900) / 3800;
      if (progress >= bot.jumpAt) {
        bot.inBus = false; bot.skydiving = true;
        bot.x = this.bus.x; bot.y = this.bus.y - 5; bot.z = this.bus.z;
        const pois = this.world.pois;
        bot.aiTarget = pois.length ? pois[Math.floor(Math.random() * pois.length)] : { x: 0, z: 0 };
      }
      return;
    }
    const groundY = terrainHeight(bot.x, bot.z);
    if (bot.skydiving) {
      const t = bot.aiTarget || { x: 0, z: 0 };
      this.moveToward(bot, t.x, t.z, 22);
      bot.y -= bot.gliding ? 7 * 0.15 : 32 * 0.15;
      if (!bot.gliding && bot.y < groundY + 65) bot.gliding = true;
      if (bot.y <= groundY + 0.2) {
        bot.y = groundY; bot.skydiving = false; bot.gliding = false; bot.onGround = true;
        // most bots scavenge a real gun shortly after landing
        if (Math.random() < 0.65) {
          const rolled = this.rollLoot();
          if (rolled.kind === 'weapon') {
            const def = this.weapons()[rolled.weaponId];
            bot.inventory[1] = { kind: 'weapon', weaponId: rolled.weaponId, rarity: rolled.rarity, mag: def.mag };
            bot.slot = 1;
          }
        }
      }
      return;
    }
    const sk = BOT_SKILLS[bot.skill || 'mid'];
    // storm avoidance has priority
    const dStorm = dist2D(bot.x, bot.z, this.storm.cx, this.storm.cz);
    const outside = dStorm > this.storm.radius - 30;
    // find nearest grounded enemy inside this tier's engage range
    let enemy = null, enemyD = 1e9;
    for (const o of this.players.values()) {
      if (o === bot || !o.alive || o.inBus || o.skydiving) continue;
      const d = dist2D(bot.x, bot.z, o.x, o.z);
      if (d < enemyD) { enemyD = d; enemy = o; }
    }
    if (!enemy || enemyD > sk.engage) enemy = null;
    if (enemy) {
      if (bot.foeId !== enemy.id) { bot.foeId = enemy.id; bot.foeSince = now; }
    } else bot.foeId = null;
    if (outside) {
      this.moveToward(bot, this.storm.cx + (Math.random() - 0.5) * 30, this.storm.cz + (Math.random() - 0.5) * 30, 9);
      if (enemy && enemyD < 40 && Math.random() < 0.3) this.botShoot(bot, enemy, enemyD);
    } else if (enemy) {
      bot.yaw = Math.atan2(enemy.x - bot.x, enemy.z - bot.z); // face the fight so tracers/models line up
      if (sk.fleeAt && bot.health < sk.fleeAt && enemyD < 60) {
        this.moveToward(bot, bot.x + (bot.x - enemy.x), bot.z + (bot.z - enemy.z), 8.5);
        if (Math.random() < 0.3) this.botShoot(bot, enemy, enemyD);
      } else if (enemyD > 28) this.moveToward(bot, enemy.x, enemy.z, 8);
      else {
        bot.aiStrafe = Math.random() < sk.strafe ? -bot.aiStrafe : bot.aiStrafe;
        bot.x += Math.cos(bot.yaw) * bot.aiStrafe * 0.5;
        if (sk.jump && Math.random() < sk.jump) bot.hopUntil = now + 420;
        this.botShoot(bot, enemy, enemyD);
      }
      if (sk.healAt && bot.health < sk.healAt && enemyD > 55 && now - bot.lastHealAt > 8000) {
        bot.lastHealAt = now;
        bot.health = Math.min(100, bot.health + 35);
      }
    } else {
      // loot run or drift toward the circle
      let target = null;
      for (const l of this.loot.values()) {
        if (dist2D(bot.x, bot.z, l.x, l.z) < 3) this.botPickup(bot, l);
      }
      if (!bot.inventory.some(s => s && s.kind === 'weapon' && s.weaponId !== 'pickaxe' && s.weaponId !== 'pistol')) {
        let bd = 120;
        for (const l of this.loot.values()) {
          if (l.kind !== 'weapon') continue;
          const d = dist2D(bot.x, bot.z, l.x, l.z);
          if (d < bd) { bd = d; target = l; }
        }
      }
      if (target) this.moveToward(bot, target.x, target.z, 8);
      else if (dStorm > this.storm.radius * 0.55) this.moveToward(bot, this.storm.cx, this.storm.cz, 7);
      else if (Math.random() < 0.02) { bot.aiTarget = { x: bot.x + (Math.random() - 0.5) * 160, z: bot.z + (Math.random() - 0.5) * 160 }; }
      if (bot.aiTarget) this.moveToward(bot, bot.aiTarget.x, bot.aiTarget.z, 5);
    }
    // push out of solid trees/rocks
    for (const n of this.nodesNear(bot.x, bot.z, NODE_CELL)) {
      const key = n.kind + ':' + n.i;
      if (this.nodeHealth.has(key) && this.nodeHealth.get(key) <= 0) continue;
      const dx = bot.x - n.x, dz = bot.z - n.z;
      const d = Math.hypot(dx, dz), rr = n.r + 0.7;
      if (d > 0.001 && d < rr) { bot.x = n.x + (dx / d) * rr; bot.z = n.z + (dz / d) * rr; }
    }
    bot.y = terrainHeight(bot.x, bot.z);
    if (bot.hopUntil > now) bot.y += Math.sin((1 - (bot.hopUntil - now) / 420) * Math.PI) * 1.15;
    bot.onGround = true;
  }

  // ---------- mobs ----------
  updateMobs(now) {
    for (const m of this.mobs.values()) {
      const def = MOB_KINDS[m.kind];
      let target = m.aggroId ? this.players.get(m.aggroId) : null;
      if (target && (!target.alive || target.inBus || target.skydiving)) target = null;
      if (!target) {
        m.aggroId = null;
        let bd = def.aggro;
        for (const o of this.players.values()) {
          if (!o.alive || o.inBus || o.skydiving) continue;
          const d = dist2D(m.x, m.z, o.x, o.z);
          if (d < bd) { bd = d; target = o; }
        }
        if (target) m.aggroId = target.id;
      }
      let tx, tz, speed;
      if (target) { tx = target.x; tz = target.z; speed = def.speed; }
      else {
        if (now > m.nextWander || dist2D(m.x, m.z, m.wx, m.wz) < 2) {
          m.nextWander = now + 3500 + Math.random() * 4000;
          const a = Math.random() * Math.PI * 2, d = Math.random() * 38;
          m.wx = m.homeX + Math.cos(a) * d; m.wz = m.homeZ + Math.sin(a) * d;
        }
        tx = m.wx; tz = m.wz; speed = def.speed * 0.35;
      }
      const dx = tx - m.x, dz = tz - m.z, d = Math.hypot(dx, dz);
      if (d > 0.6) {
        m.yaw = Math.atan2(dx, dz);
        const step = Math.min(d, speed * 0.05);
        m.x += (dx / d) * step; m.z += (dz / d) * step;
      }
      for (const n of this.nodesNear(m.x, m.z, NODE_CELL)) {
        const key = n.kind + ':' + n.i;
        if (this.nodeHealth.has(key) && this.nodeHealth.get(key) <= 0) continue;
        const ddx = m.x - n.x, ddz = m.z - n.z;
        const dd = Math.hypot(ddx, ddz), rr = n.r + 0.8;
        if (dd > 0.001 && dd < rr) { m.x = n.x + (ddx / dd) * rr; m.z = n.z + (ddz / dd) * rr; }
      }
      m.y = terrainHeight(m.x, m.z);
      if (target && d < def.atkRange && now >= m.nextAtk) {
        m.nextAtk = now + def.atkCd;
        this.applyDamage(target, null, def.dmg, def.name, false, def.name);
      }
    }
  }

  // ---------- storm ----------
  updateStorm(dt) {
    const s = this.storm;
    if (s.state === 'idle') return;
    s.timer -= dt;
    if (s.state === 'waiting') {
      const conf = STORM_PHASES[s.phaseIdx];
      s.dps = s.phaseIdx === 0 ? 0 : STORM_PHASES[s.phaseIdx - 1].dps;
      if (s.timer <= 0 && conf) {
        s.state = 'shrinking';
        s.shrinkTotal = conf.shrink; s.shrinkElapsed = 0;
        s.fromRadius = s.radius; s.fromCx = s.cx; s.fromCz = s.cz;
        const maxOff = Math.max(0, (s.radius - conf.radius) * 0.6);
        s.tcx = s.cx + (Math.random() - 0.5) * maxOff;
        s.tcz = s.cz + (Math.random() - 0.5) * maxOff;
        s.tradius = conf.radius;
        this.emitAll('stormWarning', { seconds: conf.shrink });
      }
    } else if (s.state === 'shrinking') {
      const conf = STORM_PHASES[s.phaseIdx];
      s.dps = conf.dps;
      s.shrinkElapsed += dt;
      const t = Math.min(1, s.shrinkElapsed / s.shrinkTotal);
      s.radius = s.fromRadius + (s.tradius - s.fromRadius) * t;
      s.cx = s.fromCx + (s.tcx - s.fromCx) * t;
      s.cz = s.fromCz + (s.tcz - s.fromCz) * t;
      if (t >= 1) {
        s.phaseIdx += 1;
        if (s.phaseIdx >= STORM_PHASES.length) { s.state = 'idle'; s.dps = 20; }
        else { s.state = 'waiting'; s.timer = STORM_PHASES[s.phaseIdx].wait; }
      }
    }
  }

  // ---------- main tick ----------
  tick() {
    if (this.phase === 'bus') {
      this.bus.x += this.bus.speed * 0.05;
      for (const p of this.players.values()) if (p.inBus) { p.x = this.bus.x; p.y = this.bus.y; p.z = this.bus.z; }
      if (this.bus.x > 1900) {
        for (const p of this.players.values()) if (p.inBus) {
          p.inBus = false; p.skydiving = true; p.y = this.bus.y - 5;
          if (!p.isBot) this.toHuman('forceJump', {});
        }
        this.phase = 'playing';
        this.storm.state = 'waiting'; this.storm.timer = STORM_PHASES[0].wait; this.storm.phaseIdx = 0;
        this.storm.tradius = STORM_PHASES[0].radius;
      }
    }
    if (this.phase === 'playing' || this.phase === 'bus') {
      this.updateStorm(0.05);
      for (const p of this.players.values()) if (p.isBot && p.alive) this.botThink(p);
      this.updateMobs(Date.now());
      const now = Date.now();
      for (const p of this.alive()) {
        if (p.inBus) continue;
        if (now - p.lastStormTick >= 1000) {
          p.lastStormTick = now;
          const d = dist2D(p.x, p.z, this.storm.cx, this.storm.cz);
          if (d > this.storm.radius && this.storm.dps > 0) {
            p.health -= this.storm.dps;
            if (!p.isBot) this.toHuman('youTookDamage', { health: p.health, shield: p.shield, from: 'Storm' });
            if (p.health <= 0) { p.health = 0; this.eliminate(p, null, 'Storm'); }
          }
        }
      }
    }
    const snap = {
      ts: Date.now(), phase: this.phase, bus: { x: this.bus.x, y: this.bus.y, z: this.bus.z },
      storm: { cx: this.storm.cx, cz: this.storm.cz, radius: this.storm.radius, state: this.storm.state, timer: Math.ceil(this.storm.timer), dps: this.storm.dps },
      aliveCount: this.alive().length,
      players: [...this.players.values()].filter(p => p.alive || p.inBus).map(p => ({
        id: p.id, u: p.username, x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1), yaw: +p.yaw.toFixed(2), pitch: +(p.pitch || 0).toFixed(2),
        hp: Math.ceil(p.health), sh: Math.ceil(p.shield), bot: p.isBot, color: p.color, char: p.character, armor: p.armor, enemy: p.enemy, sky: p.skydiving, glide: p.gliding, bus: p.inBus, slot: p.slot,
        weapon: p.inventory[p.slot] && p.inventory[p.slot].kind === 'weapon' ? p.inventory[p.slot].weaponId : 'pickaxe',
      })),
      mobs: [...this.mobs.values()].map(m => ({ id: m.id, k: m.kind, x: +m.x.toFixed(1), y: +m.y.toFixed(1), z: +m.z.toFixed(1), yaw: +m.yaw.toFixed(2), hp: Math.ceil(m.hp) })),
    };
    this.fire('snapshot', snap);
    // once the local player is out and the result is on screen, wind down
    if (this.phase === 'ended' || (this.humanDeadAt && Date.now() - this.humanDeadAt > 5000)) this.destroy();
  }
}

// ---------------------------------------------------------------------------
// SoloSocket — same on/emit surface as a Socket.IO socket.
// ---------------------------------------------------------------------------
export class SoloSocket {
  // opts: { token, user, onUserRefresh(user) }
  constructor(opts) {
    this.opts = opts;
    this.handlers = new Map();
    this.connected = true;
    this.solo = true;
    this.engine = null;
    this.meta = null;
    this.world = null;
    this.peers = [];
    this.sb = null;
    this.channel = null;
    this.chatWarned = false;
    this.resultSent = false;
    this.ready = this.init();
  }
  on(ev, fn) {
    if (!this.handlers.has(ev)) this.handlers.set(ev, []);
    this.handlers.get(ev).push(fn);
    return this;
  }
  fire(ev, data) {
    // record match results for registered progression before the UI sees them
    if ((ev === 'eliminated' || ev === 'victory') && !this.resultSent && this.engine) {
      this.resultSent = true;
      const h = this.engine.human();
      this.submitResult({
        placement: ev === 'victory' ? 1 : (data && data.placement) || (h ? h.placement : 24),
        kills: h ? h.kills : (data && data.kills) || 0,
        damage: h ? Math.round(h.damageDealt) : (data && data.damage) || 0,
        won: ev === 'victory',
        totalPlayers: this.engine.totalFighters || 24,
      });
    }
    const list = this.handlers.get(ev);
    if (list) for (const fn of list) { try { fn(data); } catch (e) { console.error('[solo]', ev, e); } }
  }
  async init() {
    try {
      const meta = await fetch('/api/meta').then(r => r.json());
      this.meta = meta;
      this.fire('welcome', { user: this.opts.user, meta });
    } catch { /* API unreachable — Play will retry on queue */ }
    this.connectRealtime();
  }
  async ensureWorld() {
    if (!this.world) this.world = await fetch('/api/world').then(r => r.json());
    return this.world;
  }
  async ensureEngine() {
    if (this.engine && this.engine.phase !== 'ended') return this.engine;
    if (!this.meta) await this.init();
    const world = await this.ensureWorld();
    const u = this.opts.user || {};
    this.resultSent = false;
    this.engine = new SoloEngine({
      meta: this.meta, world,
      me: { username: u.username || 'You', guest: !!u.guest, vbucks: u.vbucks || 0, character: u.character, armor: u.armor },
      fire: (ev, data) => this.fire(ev, data),
      getPeers: () => this.peers,
    });
    return this.engine;
  }
  emit(ev, data) {
    switch (ev) {
      case 'queue':
        this.ensureEngine().then(e => e.queue()).catch(() => this.fire('chat', { user: 'Dropzone X', text: '⚠️ Could not load the island data — check your connection and try again.' }));
        break;
      case 'leaveQueue': this.engine && this.engine.leaveQueue(); break;
      case 'chat': this.sendChat(String(data || '').slice(0, 120)); break;
      case 'move': this.engine && this.engine.handleMove(data); break;
      case 'jump': this.engine && this.engine.handleJump(); break;
      case 'shoot': this.engine && this.engine.handleShoot(data); break;
      case 'melee': this.engine && this.engine.handleMelee(data); break;
      case 'reload': this.engine && this.engine.handleReload(); break;
      case 'pickup': this.engine && this.engine.handlePickup(data); break;
      case 'useItem': this.engine && this.engine.handleUseItem(data); break;
      case 'build': this.engine && this.engine.handleBuild(data); break;
      case 'setSlot': this.engine && this.engine.setSlot(data); break;
      default: break;
    }
    return this;
  }
  disconnect() {
    if (this.engine) this.engine.destroy();
    if (this.channel && this.sb) { try { this.sb.removeChannel(this.channel); } catch { /* noop */ } }
    this.connected = false;
  }

  // ---------- live lobby: Supabase Realtime presence + chat ----------
  async connectRealtime() {
    try {
      const cfg = await fetch('/api/public-config').then(r => r.json());
      if (!cfg || !cfg.supabaseUrl || !cfg.supabaseAnonKey) return;
      if (typeof window === 'undefined' || !window.supabase || !window.supabase.createClient) return;
      const username = (this.opts.user && this.opts.user.username) || 'guest';
      this.sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { realtime: { params: { eventsPerSecond: 8 } } });
      const ch = this.sb.channel('dzx-lobby-v1', { config: { presence: { key: username }, broadcast: { self: false } } });
      this.channel = ch;
      ch.on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState();
        this.peers = Object.keys(state);
        if (!this.engine || this.engine.phase === 'idle') {
          this.fire('lobbyUpdate', { players: this.peers.map(username => ({ username })) });
        }
      });
      ch.on('broadcast', { event: 'chat' }, ({ payload }) => {
        if (payload && payload.text) this.fire('chat', { user: payload.user || 'player', text: String(payload.text).slice(0, 120) });
      });
      ch.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') { try { await ch.track({ username, at: Date.now() }); } catch { /* noop */ } }
      });
    } catch { /* realtime is best-effort — solo play still works */ }
  }
  sendChat(text) {
    if (!text) return;
    const user = (this.opts.user && this.opts.user.username) || 'You';
    this.fire('chat', { user, text }); // local echo
    if (this.channel) {
      try { this.channel.send({ type: 'broadcast', event: 'chat', payload: { user, text, at: Date.now() } }); } catch { /* noop */ }
    } else if (!this.chatWarned) {
      this.chatWarned = true;
      setTimeout(() => this.fire('chat', { user: 'Dropzone X', text: 'ℹ️ Live chat is offline right now — your match still works, and chat reconnects automatically when the lobby connection is available.' }), 350);
    }
  }

  // ---------- progression ----------
  async submitResult(result) {
    try {
      const res = await fetch('/api/match/result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.opts.token },
        body: JSON.stringify(result),
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.user && this.opts.onUserRefresh) this.opts.onUserRefresh(data.user);
      }
    } catch { /* offline — result simply isn't saved */ }
  }
}
