// FortWorld match engine: authoritative combat, storm, loot, building, bots.
const { terrainHeight, POIS, BUILDINGS, TREES, ROCKS, LOOT_SPAWNS } = require('./map');
const { WEAPONS, ITEMS, RARITIES, RARITY_MULT, rollLoot } = require('./weapons');
const db = require('./db');

const BOT_NAMES = ['Vortex','Nova','Blaze','Echo','Rogue','Pixel','Zephyr','Onyx','Flux','Havoc','Lyra','Orion','Sable','Drift','Koda','Raven','Solstice','Mira','Jett','Wraith','Cinder','Atlas','Vega','Rune'];
const AMMO_FOR = { pistol: 'light', smg: 'light', ar: 'medium', lmg: 'medium', sniper: 'heavy', shotgun: 'shells', burst: 'medium', revolver: 'heavy', pump: 'shells', dmr: 'heavy' };
const MAT_HP = { wood: 150, stone: 250, metal: 350 };
const STORM_PHASES = [
  { radius: 1250, wait: 35, shrink: 30, dps: 1 },
  { radius: 850, wait: 25, shrink: 25, dps: 2 },
  { radius: 550, wait: 20, shrink: 20, dps: 5 },
  { radius: 320, wait: 18, shrink: 18, dps: 8 },
  { radius: 170, wait: 15, shrink: 15, dps: 10 },
  { radius: 80, wait: 12, shrink: 12, dps: 15 },
  { radius: 0, wait: 10, shrink: 12, dps: 20 },
];

let LOOT_SEQ = 1, STRUCT_SEQ = 1, ROOM_SEQ = 1, MOB_SEQ = 1;

// Bot skill tiers — a lobby mix of noobs, mids and pros. "Realism" knobs:
// reaction delay before the first shot, aim quality, turn speed, strafing,
// combat jumps, heal/flee brains and engagement range.
const BOT_SKILLS = {
  noob: { aim: 0.42, reaction: 850, engage: 62, turn: 2.2, strafe: 0.004, jump: 0, healAt: 0, fleeAt: 0, extraDelay: 300, spd: 0.9 },
  mid: { aim: 0.85, reaction: 420, engage: 95, turn: 4.2, strafe: 0.02, jump: 0.004, healAt: 42, fleeAt: 14, extraDelay: 150, spd: 1.0 },
  pro: { aim: 1.3, reaction: 170, engage: 125, turn: 7.5, strafe: 0.045, jump: 0.014, healAt: 58, fleeAt: 26, extraDelay: 60, spd: 1.08 },
};
function rollSkill() { const r = Math.random(); return r < 0.35 ? 'noob' : r < 0.75 ? 'mid' : 'pro'; }

// Wild mobs that roam the island (PvE). They aggro fighters, bite, and drop loot.
const MOB_KINDS = {
  boar: { name: 'Wild Boar', hp: 70, speed: 7.4, dmg: 9, aggro: 24, atkRange: 2.5, atkCd: 800, scale: 1 },
  stalker: { name: 'Night Stalker', hp: 120, speed: 9.6, dmg: 15, aggro: 34, atkRange: 2.7, atkCd: 950, scale: 1.3 },
};

// Solid world nodes (trees/rocks) in a spatial hash: bullets stop on trunks
// and boulders, and bots/mobs get pushed out of them. Server mirror of the
// client colliders in world.js (trunk r≈0.55·s, rock r≈1.9·s from the meshes).
const NODE_CELL = 40;
const NODE_HASH = new Map();
function hashNode(kind, i, n) {
  const isTree = kind === 0;
  const rec = { kind, i, x: n.x, z: n.z, r: isTree ? 0.55 * n.s : 1.9 * n.s, top: isTree ? 5.2 * n.s : 2.3 * n.s, base: terrainHeight(n.x, n.z) };
  const cx = Math.floor(n.x / NODE_CELL), cz = Math.floor(n.z / NODE_CELL);
  const key = cx + ',' + cz;
  if (!NODE_HASH.has(key)) NODE_HASH.set(key, []);
  NODE_HASH.get(key).push(rec);
}
TREES.forEach((t, i) => hashNode(0, i, t));
ROCKS.forEach((r, i) => hashNode(1, i, r));
function nodesNear(x, z, rad) {
  const out = [];
  const c0x = Math.floor((x - rad) / NODE_CELL), c1x = Math.floor((x + rad) / NODE_CELL);
  const c0z = Math.floor((z - rad) / NODE_CELL), c1z = Math.floor((z + rad) / NODE_CELL);
  for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
    const cell = NODE_HASH.get(cx + ',' + cz);
    if (cell) out.push(...cell);
  }
  return out;
}

function skinColor(skinId) {
  const s = db.SKINS.find(k => k.id === skinId);
  return s ? s.color : '#4d8fd1';
}
function dist2D(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return Math.hypot(dx, dz); }

function makeInventory() {
  // Everyone drops with a pistol in slot 2 — no more defenceless landings.
  return [
    { kind: 'weapon', weaponId: 'pickaxe', rarity: 0, mag: Infinity },
    { kind: 'weapon', weaponId: 'pistol', rarity: 0, mag: 12 },
    null, null, null,
  ];
}

function makePlayer({ id, userId, username, isBot, skin, character, armor, enemy, color }) {
  return {
    id, userId: userId || null, username, isBot: !!isBot,
    skin: skin || 'default', color: color || skinColor(skin || 'default'),
    character: character || 'recruit', armor: armor || 'standard', enemy: enemy || null,
    x: 0, y: 300, z: 0, yaw: 0, pitch: 0,
    health: 100, shield: 0, alive: true, placement: 0,
    inBus: true, skydiving: false, gliding: false, onGround: false,
    kills: 0, damageDealt: 0, slot: 0,
    inventory: makeInventory(),
    materials: { wood: 50, stone: 0, metal: 0 },
    ammo: { light: 36, medium: 30, heavy: 0, shells: 0 },
    lastShootAt: 0, reloadingUntil: 0, usingUntil: 0, pendingUse: null,
    lastMoveAt: Date.now(), lastStormTick: 0, lastAiAt: 0, aiTarget: null, aiLoot: null, aiStrafe: 1, jumpAt: 0,
    skill: 'mid', spd: 1, foeId: null, foeSince: 0, hopUntil: 0, lastHealAt: 0,
    connected: true,
  };
}

class Room {
  constructor(io) {
    this.io = io;
    this.id = 'room_' + ROOM_SEQ++;
    this.phase = 'waiting'; // waiting | bus | playing | ended
    this.players = new Map(); // id -> player
    this.sockets = new Map(); // playerId -> socket
    this.loot = new Map();
    this.structures = new Map();
    this.nodeHealth = new Map(); // "tree:12" -> hp
    this.mobs = new Map(); // wild mobs (PvE)
    this.startTimer = null;
    this.tickTimer = null;
    this.bus = { x: -1900, z: (Math.random() - 0.5) * 1400, y: 345, speed: 95, dir: 1 };
    this.storm = { phaseIdx: -1, state: 'idle', timer: 20, cx: 0, cz: 0, radius: 1900, tcx: 0, tcz: 0, tradius: 1900, fromRadius: 1900, dps: 0, shrinkTotal: 1, shrinkElapsed: 0 };
    this.startedAt = 0;
    this.totalFighters = 0;
    this.rngState = (Date.now() % 2147483647) || 1;
  }

  rng() { // simple LCG for loot rolls
    this.rngState = (this.rngState * 16807) % 2147483647;
    return (this.rngState - 1) / 2147483646;
  }

  humans() { return [...this.players.values()].filter(p => !p.isBot); }
  alive() { return [...this.players.values()].filter(p => p.alive); }

  emit(event, data) { this.io.to(this.id).emit(event, data); }
  toPlayer(playerId, event, data) {
    const s = this.sockets.get(playerId);
    if (s) s.emit(event, data);
  }

  addHuman(socket, user) {
    const p = makePlayer({ id: socket.id, userId: user.id, username: user.username, skin: user.skin, character: user.character, armor: user.armor });
    this.players.set(p.id, p);
    this.sockets.set(p.id, socket);
    socket.join(this.id);
    socket.emit('roomJoined', { roomId: this.id, playerId: p.id, startsIn: 8 });
    this.broadcastLobby();
    if (!this.startTimer && this.phase === 'waiting') {
      this.startTimer = setTimeout(() => this.startMatch(), 8000);
    }
    if (this.humans().length >= 10) { clearTimeout(this.startTimer); this.startMatch(); }
    return p;
  }

  broadcastLobby() {
    this.emit('lobbyUpdate', { players: this.humans().map(p => ({ username: p.username, skin: p.skin })), count: this.players.size });
  }

  removeHuman(socketId) {
    const p = this.players.get(socketId);
    if (!p) return;
    this.sockets.delete(socketId);
    if (this.phase === 'waiting') {
      this.players.delete(socketId);
      this.broadcastLobby();
      if (this.humans().length === 0) this.destroy();
      return;
    }
    // mid-match disconnect counts as elimination
    p.connected = false;
    if (p.alive) this.eliminate(p, null, 'left the match');
    else this.players.delete(socketId);
    if (this.humans().filter(h => h.connected).length === 0) this.destroy();
  }

  startMatch() {
    if (this.phase !== 'waiting') return;
    this.phase = 'bus';
    this.startedAt = Date.now();
    // fill with bots to 24 fighters
    const want = 24;
    const botCount = Math.max(0, want - this.players.size);
    for (let i = 0; i < botCount; i++) {
      const name = BOT_NAMES[i % BOT_NAMES.length] + (i >= BOT_NAMES.length ? '_' + i : '');
      const foe = db.ENEMY_ROSTER[Math.floor(Math.random() * db.ENEMY_ROSTER.length)];
      const bot = makePlayer({ id: 'bot_' + this.id + '_' + i, username: name, isBot: true, skin: 'enemy', character: foe.character, armor: foe.armor, enemy: foe.name, color: foe.color });
      bot.skill = rollSkill();
      bot.spd = BOT_SKILLS[bot.skill].spd;
      bot.jumpAt = 0.15 + Math.random() * 0.7; // fraction of bus path
      this.players.set(bot.id, bot);
    }
    this.totalFighters = this.players.size;
    // spawn loot
    for (const pt of LOOT_SPAWNS) {
      if (this.rng() < 0.25) continue;
      const rolled = rollLoot(() => this.rng());
      this.spawnLoot(rolled, pt.x, pt.z);
    }
    this.spawnMobs();
    // everyone in bus
    for (const p of this.players.values()) { p.x = this.bus.x; p.y = this.bus.y; p.z = this.bus.z; }

    const payload = {
      roomId: this.id,
      bus: this.bus,
      pois: POIS, buildings: BUILDINGS, trees: TREES, rocks: ROCKS,
      loot: [...this.loot.values()],
      totalFighters: this.totalFighters,
      you: null,
    };
    for (const p of this.humans()) {
      payload.you = p.id;
      this.toPlayer(p.id, 'matchStart', payload);
    }
    this.tickTimer = setInterval(() => this.tick(), 50);
  }

  spawnLoot(rolled, x, z) {
    let y = terrainHeight(x, z);
    if (y < -3) { y = -3; }
    const item = { id: 'loot_' + LOOT_SEQ++, kind: rolled.kind, weaponId: rolled.weaponId || null, itemId: rolled.itemId || null, rarity: rolled.rarity || 0, x, y: Math.max(y, -2) + 0.6, z };
    this.loot.set(item.id, item);
    return item;
  }

  dropPlayerLoot(p) {
    for (let i = 1; i < p.inventory.length; i++) {
      const s = p.inventory[i];
      if (!s) continue;
      const x = p.x + (Math.random() - 0.5) * 4, z = p.z + (Math.random() - 0.5) * 4;
      const item = this.spawnLoot(s.kind === 'weapon' ? { kind: 'weapon', weaponId: s.weaponId, rarity: s.rarity } : { kind: 'item', itemId: s.itemId }, x, z);
      this.emit('lootUpdate', { added: [item], removed: [] });
    }
  }

  // ---------- combat ----------
  weaponOf(p) {
    const s = p.inventory[p.slot];
    if (!s || s.kind !== 'weapon') return null;
    return { slot: s, def: WEAPONS[s.weaponId] };
  }

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
      this.toPlayer(attacker.id, 'hitmarker', { damage: Math.round(amount), headshot: !!headshot, shieldHit: target.shield > 0 });
    }
    this.toPlayer(target.id, 'youTookDamage', { health: target.health, shield: target.shield, from: attacker ? attacker.username : (fromLabel || 'Storm') });
    if (target.health <= 0) {
      target.health = 0;
      this.eliminate(target, attacker, weaponName);
    }
  }

  eliminate(target, killer, weaponName) {
    if (!target.alive) return;
    target.alive = false;
    target.placement = this.alive().length; // alive() still includes target? no: set false first
    // recompute: placement = number alive after death + 1
    target.placement = this.alive().length + 1;
    if (killer && killer !== target) {
      killer.kills += 1;
      this.toPlayer(killer.id, 'youGotKill', { kills: killer.kills, victim: target.username });
      // +30 V-Bucks per elimination, credited instantly (accounts only)
      if (!killer.isBot && killer.userId) {
        const award = db.awardKill(killer.userId);
        if (award.awarded > 0) this.toPlayer(killer.id, 'vbucks', { amount: award.awarded, total: award.total, kills: killer.kills });
      }
    }
    this.dropPlayerLoot(target);
    this.emit('killfeed', { killer: killer ? killer.username : null, victim: target.username, weapon: weaponName || 'Storm', killerKills: killer ? killer.kills : 0 });
    this.emit('playerDied', { id: target.id, placement: target.placement });
    if (!target.isBot) {
      this.toPlayer(target.id, 'eliminated', { placement: target.placement, kills: target.kills, damage: Math.round(target.damageDealt), totalFighters: this.totalFighters });
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
        this.emit('matchEnd', { winner: winner.username, winnerId: winner.id, isBot: winner.isBot });
        this.toPlayer(winner.id, 'victory', { kills: winner.kills, damage: Math.round(winner.damageDealt) });
      }
      // persist stats for humans
      for (const p of this.players.values()) {
        if (!p.isBot && p.userId) {
          db.addMatchResult(p.userId, { placement: p.placement || this.totalFighters, kills: p.kills, damage: Math.round(p.damageDealt), won: winner && p.id === winner.id, totalPlayers: this.totalFighters });
        }
      }
      setTimeout(() => this.destroy(), 20000);
    }
  }

  // ray vs sphere (player capsule approximated)
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
      if (d < 1.05 && (!best || t < best.t)) {
        best = { player: p, t, point: { x: px, y: py, z: pz }, headshot: py > p.y + 1.55 };
      }
    }
    return best;
  }

  rayBlocked(origin, dir, maxT) {
    let best = null;
    const limit = () => (best === null ? maxT : Math.min(maxT, best));
    // buildings AABB
    for (const b of BUILDINGS) {
      const gy = terrainHeight(b.x, b.z);
      const minX = b.x - b.w / 2, maxX = b.x + b.w / 2, minZ = b.z - b.d / 2, maxZ = b.z + b.d / 2, minY = gy, maxY = gy + b.h;
      const t = rayAABB(origin, dir, minX, minY, minZ, maxX, maxY, maxZ);
      if (t !== null && t < limit()) best = t;
    }
    for (const s of this.structures.values()) {
      const t = rayAABB(origin, dir, s.x - 2.5, s.y, s.z - 2.5, s.x + 2.5, s.y + 5.2, s.z + 2.5);
      if (t !== null && t < limit()) best = t;
    }
    // solid trees & rocks (trunk/boulder cylinders), skipping felled nodes
    const nt = this.rayNodes(origin, dir, limit());
    if (nt !== null && (best === null || nt < best)) best = nt;
    return best;
  }

  rayNodes(origin, dir, maxT) {
    const ex = origin.x + dir.x * maxT, ez = origin.z + dir.z * maxT;
    const cand = nodesNear((origin.x + ex) / 2, (origin.z + ez) / 2, Math.hypot(ex - origin.x, ez - origin.z) / 2 + NODE_CELL);
    const denom = dir.x * dir.x + dir.z * dir.z;
    if (denom < 1e-9) return null;
    let best = null;
    for (const n of cand) {
      const key = (n.kind === 0 ? 'tree:' : 'rock:') + n.i;
      if (this.nodeHealth.has(key) && this.nodeHealth.get(key) <= 0) continue; // felled
      const t = ((n.x - origin.x) * dir.x + (n.z - origin.z) * dir.z) / denom;
      if (t < 0 || t > maxT) continue;
      const px = origin.x + dir.x * t, py = origin.y + dir.y * t, pz = origin.z + dir.z * t;
      const lat = Math.hypot(px - n.x, pz - n.z);
      if (lat < n.r && py > n.base - 1 && py < n.base + n.top && (best === null || t < best)) best = t;
    }
    return best;
  }

  // push a fighter/mob out of tree trunks & boulders (XZ)
  collideNodes(p, rad = 0.7) {
    for (const n of nodesNear(p.x, p.z, NODE_CELL)) {
      const key = (n.kind === 0 ? 'tree:' : 'rock:') + n.i;
      if (this.nodeHealth.has(key) && this.nodeHealth.get(key) <= 0) continue;
      const dx = p.x - n.x, dz = p.z - n.z;
      const d = Math.hypot(dx, dz), min = n.r + rad;
      if (d > 0.001 && d < min) { p.x = n.x + (dx / d) * min; p.z = n.z + (dz / d) * min; }
      else if (d <= 0.001) { p.x = n.x + min; }
    }
  }

  rayHitMob(origin, dir) {
    let best = null;
    for (const m of this.mobs.values()) {
      const cx = m.x, cy = m.y + 0.8 * m.scale, cz = m.z;
      const ox = cx - origin.x, oy = cy - origin.y, oz = cz - origin.z;
      const t = ox * dir.x + oy * dir.y + oz * dir.z;
      if (t < 0 || t > 420) continue;
      const px = origin.x + dir.x * t, py = origin.y + dir.y * t, pz = origin.z + dir.z * t;
      const d = Math.hypot(px - cx, py - cy, pz - cz);
      if (d < 1.05 * m.scale && (!best || t < best.t)) best = { mob: m, t, point: { x: px, y: py, z: pz }, headshot: py > m.y + 1.35 * m.scale };
    }
    return best;
  }

  damageMob(mob, attacker, dmg, headshot) {
    mob.hp -= dmg;
    if (attacker) {
      mob.aggroId = attacker.id;
      this.toPlayer(attacker.id, 'hitmarker', { damage: Math.round(dmg), headshot: !!headshot, shieldHit: false, mob: true });
    }
    if (mob.hp <= 0) {
      this.mobs.delete(mob.id);
      // mobs drop loot: usually supplies, sometimes a weapon
      const rolled = rollLoot(() => Math.random());
      const item = this.spawnLoot(rolled, mob.x, mob.z);
      this.emit('lootUpdate', { added: [item], removed: [] });
      this.emit('mobDied', { id: mob.id, kind: mob.kind, by: attacker ? attacker.username : null, x: mob.x, y: mob.y, z: mob.z });
    }
  }

  spawnMobs() {
    for (let i = 0; i < 34; i++) {
      let x = 0, z = 0, ok = false;
      for (let tries = 0; tries < 8 && !ok; tries++) {
        if (Math.random() < 0.65) {
          const poi = POIS[Math.floor(Math.random() * POIS.length)];
          const a = Math.random() * Math.PI * 2, d = 50 + Math.random() * 170;
          x = poi.x + Math.cos(a) * d; z = poi.z + Math.sin(a) * d;
        } else { x = (Math.random() - 0.5) * 3400; z = (Math.random() - 0.5) * 3400; }
        ok = terrainHeight(x, z) > 1 && Math.abs(x) < 1900 && Math.abs(z) < 1900;
      }
      if (!ok) continue;
      const kind = Math.random() < 0.3 ? 'stalker' : 'boar';
      const def = MOB_KINDS[kind];
      this.mobs.set('mob_' + MOB_SEQ, {
        id: 'mob_' + MOB_SEQ++, kind, x, y: terrainHeight(x, z), z, yaw: Math.random() * 6.28,
        hp: def.hp, maxHp: def.hp, scale: def.scale, homeX: x, homeZ: z,
        wx: x, wz: z, aggroId: null, nextAtk: 0, nextWander: 0,
      });
    }
  }

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
      this.collideNodes(m, 0.8);
      m.y = terrainHeight(m.x, m.z);
      if (target && d < def.atkRange && now >= m.nextAtk) {
        m.nextAtk = now + def.atkCd;
        this.applyDamage(target, null, def.dmg, def.name, false, def.name);
      }
    }
  }

  handleShoot(p, { dir, origin }) {
    if (!p.alive || p.inBus) return;
    const w = this.weaponOf(p);
    if (!w) return;
    const now = Date.now();
    if (now - p.lastShootAt < w.def.fireRate) return;
    if (now < p.reloadingUntil || now < p.usingUntil) return;
    p.lastShootAt = now;
    if (w.def.type === 'melee') return; // melee handled by harvest/attack event
    if (w.slot.mag <= 0) { this.toPlayer(p.id, 'needReload', {}); return; }
    w.slot.mag -= 1;
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const d = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
    const o = origin && isFinite(origin.x) ? origin : { x: p.x, y: p.y + 1.6, z: p.z };
    for (let pellet = 0; pellet < w.def.pellets; pellet++) {
      const spread = w.def.spread;
      const pd = {
        x: d.x + (Math.random() - 0.5) * spread * 2,
        y: d.y + (Math.random() - 0.5) * spread * 2,
        z: d.z + (Math.random() - 0.5) * spread * 2,
      };
      const pl = Math.hypot(pd.x, pd.y, pd.z); pd.x /= pl; pd.y /= pl; pd.z /= pl;
      const hit = this.rayHitPlayer(o, pd, p.id);
      const mobHit = this.rayHitMob(o, pd);
      const targetT = Math.min(hit ? hit.t : Infinity, mobHit ? mobHit.t : Infinity);
      const blockedT = this.rayBlocked(o, pd, targetT === Infinity ? w.def.range : targetT);
      const endT = blockedT !== null ? blockedT : (hit ? hit.t : w.def.range);
      const end = { x: o.x + pd.x * endT, y: o.y + pd.y * endT, z: o.z + pd.z * endT };
      this.emit('tracer', { from: o, to: end, weaponId: w.def.id, shooter: p.id });
      if (mobHit && blockedT === null && (!hit || mobHit.t <= hit.t)) {
        let dmg = w.def.damage * RARITY_MULT[w.slot.rarity || 0];
        if (mobHit.t > 50) dmg *= Math.max(0.55, 1 - (mobHit.t - 50) / 300);
        if (mobHit.headshot) dmg *= 1.8;
        this.damageMob(mobHit.mob, p, Math.round(dmg), mobHit.headshot);
      } else if (hit && blockedT === null) {
        let dmg = w.def.damage * RARITY_MULT[w.slot.rarity || 0];
        const dist = hit.t;
        if (dist > 50) dmg *= Math.max(0.55, 1 - (dist - 50) / 300);
        if (hit.headshot) dmg *= 1.8;
        this.applyDamage(hit.player, p, Math.round(dmg), w.def.name, hit.headshot);
      } else if (blockedT !== null) {
        this.damageStructureAt(o, pd, blockedT, w.def.damage, p);
      }
    }
    this.toPlayer(p.id, 'ammoUpdate', this.publicSelf(p));
  }

  damageStructureAt(origin, dir, t, damage, attacker) {
    const px = origin.x + dir.x * t, py = origin.y + dir.y * t, pz = origin.z + dir.z * t;
    for (const s of this.structures.values()) {
      if (Math.abs(px - s.x) <= 2.6 && py >= s.y - 0.5 && py <= s.y + 5.4 && Math.abs(pz - s.z) <= 2.6) {
        s.health -= damage;
        if (s.health <= 0) { this.structures.delete(s.id); this.emit('structureRemoved', { id: s.id }); }
        return;
      }
    }
  }

  handleMelee(p, { dir, origin }) {
    if (!p.alive) return;
    const now = Date.now();
    if (now - p.lastShootAt < 320) return;
    p.lastShootAt = now;
    const o = origin || { x: p.x, y: p.y + 1.4, z: p.z };
    const hit = this.rayHitPlayer(o, dir, p.id);
    if (hit && hit.t <= 4.2) this.applyDamage(hit.player, p, 20, 'Pickaxe', false);
    // harvest nodes
    let best = null;
    const check = (arr, type, hpDefault) => {
      arr.forEach((n, i) => {
        const key = type + ':' + i;
        if (this.nodeHealth.has(key) && this.nodeHealth.get(key) <= 0) return;
        const d = dist2D(p.x, p.z, n.x, n.z);
        if (d < 4.5 && (!best || d < best.d)) best = { type, index: i, key, d, node: n };
      });
    };
    check(TREES, 'tree'); check(ROCKS, 'rock');
    // buildings give stone/metal slowly too - skip
    if (best) {
      const isTree = best.type === 'tree';
      const cur = this.nodeHealth.has(best.key) ? this.nodeHealth.get(best.key) : (isTree ? 100 : 160);
      const next = cur - 50;
      this.nodeHealth.set(best.key, next);
      const mat = isTree ? 'wood' : 'stone';
      p.materials[mat] += 12;
      this.emit('nodeHit', { type: best.type, index: best.index, health: Math.max(0, next) });
      if (next <= 0) this.emit('nodeGone', { type: best.type, index: best.index });
      this.toPlayer(p.id, 'selfUpdate', this.publicSelf(p));
    }
  }

  handleMove(p, m) {
    if (!p.alive) return;
    const now = Date.now();
    const dt = Math.max(16, now - (p.lastMoveAt || now)) / 1000;
    p.lastMoveAt = now;
    const dx = m.x - p.x, dy = m.y - p.y, dz = m.z - p.z;
    const dist = Math.hypot(dx, dy, dz);
    const maxDist = (p.skydiving ? 90 : 22) * dt + 3;
    if (dist > maxDist && !p.inBus) {
      const s = maxDist / dist;
      p.x += dx * s; p.y += dy * s; p.z += dz * s;
    } else { p.x = m.x; p.y = m.y; p.z = m.z; }
    p.yaw = m.yaw || 0; p.pitch = m.pitch || 0;
    p.skydiving = !!m.skydiving; p.gliding = !!m.gliding; p.onGround = !!m.onGround;
    if (p.inBus && m.jumped) { /* handled by jump event */ }
  }

  handleJump(p) {
    if (!p.inBus) return;
    p.inBus = false; p.skydiving = true; p.gliding = false;
    p.x = this.bus.x; p.y = this.bus.y - 5; p.z = this.bus.z;
    this.toPlayer(p.id, 'youJumped', { x: p.x, y: p.y, z: p.z });
  }

  handlePickup(p, lootId) {
    const item = this.loot.get(lootId);
    if (!item || !p.alive) return;
    if (dist2D(p.x, p.z, item.x, item.z) > 5 || Math.abs(p.y - item.y) > 8) return;
    if (item.kind === 'weapon') {
      let idx = p.inventory.findIndex((s, i) => i > 0 && !s);
      if (idx === -1) idx = p.slot > 0 ? p.slot : 1;
      const def = WEAPONS[item.weaponId];
      p.inventory[idx] = { kind: 'weapon', weaponId: item.weaponId, rarity: item.rarity, mag: Math.min(def.mag, 999) === Infinity ? Infinity : def.mag };
      // give some ammo
      const at = AMMO_FOR[item.weaponId];
      if (at) p.ammo[at] += at === 'heavy' ? 6 : at === 'shells' ? 8 : 20;
    } else {
      const def = ITEMS[item.itemId];
      if (!def) return;
      if (def.type === 'ammo' || def.type === 'mat') {
        if (def.type === 'ammo') {
          const map = { ammo_light: 'light', ammo_medium: 'medium', ammo_heavy: 'heavy', ammo_shells: 'shells' };
          p.ammo[map[item.itemId]] += def.amount;
        } else p.materials[item.itemId] += def.amount;
      } else {
        let slot = p.inventory.find(s => s && s.kind === 'item' && s.itemId === item.itemId);
        if (slot) slot.count += 1;
        else {
          let idx = p.inventory.findIndex((s, i) => i > 0 && !s);
          if (idx === -1) { this.toPlayer(p.id, 'notice', { msg: 'Backpack full!' }); return; }
          p.inventory[idx] = { kind: 'item', itemId: item.itemId, count: 1 };
        }
      }
    }
    this.loot.delete(lootId);
    this.emit('lootUpdate', { added: [], removed: [lootId] });
    this.toPlayer(p.id, 'selfUpdate', this.publicSelf(p));
  }

  handleReload(p) {
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
      this.toPlayer(p.id, 'selfUpdate', this.publicSelf(p));
    }, w.def.reload);
  }

  handleUseItem(p, slotIdx) {
    const s = p.inventory[slotIdx];
    if (!s || s.kind !== 'item') return;
    const def = ITEMS[s.itemId];
    if (!def || (def.type !== 'heal' && def.type !== 'shield')) return;
    if (def.type === 'heal' && p.health >= 100) return;
    if (def.type === 'shield' && p.shield >= 100) return;
    if (def.type === 'heal' && s.itemId === 'bandage' && p.health > 75) return;
    p.usingUntil = Date.now() + def.useTime;
    p.pendingUse = { slotIdx, itemId: s.itemId };
    this.toPlayer(p.id, 'usingItem', { itemId: s.itemId, ms: def.useTime });
    setTimeout(() => {
      if (!p.alive || !p.pendingUse) return;
      const slot = p.inventory[slotIdx];
      if (!slot || slot.itemId !== s.itemId) return;
      if (def.type === 'heal') p.health = Math.min(100, p.health + def.amount);
      else p.shield = Math.min(100, p.shield + def.amount);
      slot.count -= 1;
      if (slot.count <= 0) p.inventory[slotIdx] = null;
      p.pendingUse = null;
      this.toPlayer(p.id, 'selfUpdate', this.publicSelf(p));
    }, def.useTime);
  }

  handleBuild(p, b) {
    if (!p.alive) return;
    const mat = b.material;
    if (!['wood', 'stone', 'metal'].includes(mat)) return;
    if (p.materials[mat] < 10) { this.toPlayer(p.id, 'notice', { msg: 'Not enough materials!' }); return; }
    if (dist2D(p.x, p.z, b.x, b.z) > 14) return;
    p.materials[mat] -= 10;
    const s = { id: 'st_' + STRUCT_SEQ++, type: b.type, x: b.x, y: b.y, z: b.z, rotY: b.rotY || 0, material: mat, health: MAT_HP[mat], owner: p.id };
    this.structures.set(s.id, s);
    this.emit('structurePlaced', s);
    this.toPlayer(p.id, 'selfUpdate', this.publicSelf(p));
  }

  publicSelf(p) {
    return {
      id: p.id, health: p.health, shield: p.shield, slot: p.slot,
      inventory: p.inventory.map(s => s ? { ...s, mag: s.mag === Infinity ? 999 : s.mag } : null),
      materials: p.materials, ammo: p.ammo, kills: p.kills,
    };
  }

  // ---------- bots ----------
  botThink(bot) {
    const now = Date.now();
    if (now - bot.lastAiAt < 150) return;
    bot.lastAiAt = now;
    if (bot.inBus) {
      const progress = (this.bus.x + 1900) / 3800;
      if (progress >= bot.jumpAt) { bot.inBus = false; bot.skydiving = true; bot.x = this.bus.x; bot.y = this.bus.y - 5; bot.z = this.bus.z; bot.aiTarget = POIS[Math.floor(Math.random() * POIS.length)]; }
      return;
    }
    const groundY = terrainHeight(bot.x, bot.z);
    if (bot.skydiving) {
      const t = bot.aiTarget || POIS[0];
      moveToward(bot, t.x, t.z, 22);
      bot.y -= bot.gliding ? 7 * 0.15 : 32 * 0.15;
      if (!bot.gliding && bot.y < groundY + 65) bot.gliding = true;
      if (bot.y <= groundY + 0.2) { bot.y = groundY; bot.skydiving = false; bot.gliding = false; bot.onGround = true; }
      return;
    }
    // storm avoidance has priority
    const dStorm = dist2D(bot.x, bot.z, this.storm.cx, this.storm.cz);
    const outside = dStorm > this.storm.radius - 30;
    // find enemy
    let enemy = null, enemyD = 1e9;
    for (const o of this.players.values()) {
      if (!o.alive || o.id === bot.id || o.inBus || o.skydiving) continue;
      const d = dist2D(bot.x, bot.z, o.x, o.z);
      if (d < enemyD) { enemyD = d; enemy = o; }
    }
    const hasGun = bot.inventory.some(s => s && s.kind === 'weapon' && s.weaponId !== 'pickaxe');
    if (!hasGun) {
      let best = null, bd = 1e9;
      for (const l of this.loot.values()) { const d = dist2D(bot.x, bot.z, l.x, l.z); if (d < bd) { bd = d; best = l; } }
      if (best) {
        if (bd < 3) { botPickup(this, bot, best); }
        else moveToward(bot, best.x, best.z, 8);
      } else moveToward(bot, this.storm.cx, this.storm.cz, 7);
    } else if (outside) {
      moveToward(bot, this.storm.cx, this.storm.cz, 9);
    } else if (enemy && enemyD < BOT_SKILLS[bot.skill].engage) {
      const sk = BOT_SKILLS[bot.skill];
      // reaction tracking: first sight of a new foe starts the clock
      if (bot.foeId !== enemy.id) { bot.foeId = enemy.id; bot.foeSince = now; }
      // smooth human-like turn toward the foe (no instant snap-aim)
      const wantYaw = Math.atan2(enemy.x - bot.x, enemy.z - bot.z);
      let dyaw = wantYaw - bot.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      const maxTurn = sk.turn * 0.15;
      bot.yaw += Math.max(-maxTurn, Math.min(maxTurn, dyaw));
      // disengage when hurt (mid/pro), heal up when the coast is clear
      if (sk.fleeAt && bot.health <= sk.fleeAt) {
        moveToward(bot, bot.x + (bot.x - enemy.x), bot.z + (bot.z - enemy.z), 9.5);
        if (Math.random() < 0.3) botShoot(this, bot, enemy, enemyD); // covering fire
      } else if (enemyD > 28) moveToward(bot, enemy.x, enemy.z, 8);
      else {
        // strafe with tier-flavoured direction changes + combat hops
        bot.aiStrafe = Math.random() < sk.strafe ? -bot.aiStrafe : bot.aiStrafe;
        bot.x += Math.cos(bot.yaw) * bot.aiStrafe * 0.5;
        bot.z -= Math.sin(bot.yaw) * bot.aiStrafe * 0.5;
        if (sk.jump && Math.random() < sk.jump) bot.hopUntil = now + 420;
        botShoot(this, bot, enemy, enemyD);
      }
      if (sk.healAt && bot.health < sk.healAt && enemyD > 55 && now - bot.lastHealAt > 8000) {
        bot.lastHealAt = now;
        bot.health = Math.min(100, bot.health + 35); // used a medkit
      }
    } else {
      // wander toward storm center / POI
      if (!bot.aiTarget || dist2D(bot.x, bot.z, bot.aiTarget.x, bot.aiTarget.z) < 15) bot.aiTarget = POIS[Math.floor(Math.random() * POIS.length)];
      moveToward(bot, bot.aiTarget.x, bot.aiTarget.z, 6.5);
      // opportunistic loot
      for (const l of this.loot.values()) { if (dist2D(bot.x, bot.z, l.x, l.z) < 3) botPickup(this, bot, l); }
    }
    this.collideNodes(bot, 0.7);
    bot.y = terrainHeight(bot.x, bot.z);
    if (bot.hopUntil > now) bot.y += Math.sin((1 - (bot.hopUntil - now) / 420) * Math.PI) * 1.15; // combat hop
    bot.onGround = true;
  }

  // ---------- main tick ----------
  tick() {
    if (this.phase === 'bus') {
      this.bus.x += this.bus.speed * 0.05;
      for (const p of this.players.values()) if (p.inBus) { p.x = this.bus.x; p.y = this.bus.y; p.z = this.bus.z; }
      if (this.bus.x > 1900) {
        for (const p of this.players.values()) if (p.inBus) { p.inBus = false; p.skydiving = true; p.y = this.bus.y - 5; if (!p.isBot) this.toPlayer(p.id, 'forceJump', {}); }
        this.phase = 'playing';
        this.storm.state = 'waiting'; this.storm.timer = STORM_PHASES[0].wait; this.storm.phaseIdx = 0;
        this.storm.tradius = STORM_PHASES[0].radius;
      }
    }
    if (this.phase === 'playing' || this.phase === 'bus') {
      this.updateStorm(0.05);
      for (const p of this.players.values()) {
        if (p.isBot && p.alive) this.botThink(p);
      }
      this.updateMobs(Date.now());
      // storm damage 1Hz
      const now = Date.now();
      for (const p of this.alive()) {
        if (p.inBus) continue;
        if (now - p.lastStormTick >= 1000) {
          p.lastStormTick = now;
          const d = dist2D(p.x, p.z, this.storm.cx, this.storm.cz);
          if (d > this.storm.radius && this.storm.dps > 0) {
            // direct health damage bypassing shield for storm? Fortnite storm hits health
            p.health -= this.storm.dps;
            if (!p.isBot) this.toPlayer(p.id, 'youTookDamage', { health: p.health, shield: p.shield, from: 'Storm' });
            if (p.health <= 0) { p.health = 0; this.eliminate(p, null, 'Storm'); }
          }
        }
      }
    }
    // snapshot
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
    this.emit('snapshot', snap);
  }

  updateStorm(dt) {
    const s = this.storm;
    if (s.state === 'idle') return;
    s.timer -= dt;
    if (s.state === 'waiting') {
      const conf = STORM_PHASES[s.phaseIdx];
      s.dps = s.phaseIdx === 0 ? 0 : STORM_PHASES[s.phaseIdx - 1].dps;
      if (s.timer <= 0) {
        s.state = 'shrinking';
        s.shrinkTotal = conf.shrink; s.shrinkElapsed = 0;
        s.fromRadius = s.radius;
        // pick target center offset within current circle
        const maxOff = Math.max(0, (s.radius - conf.radius) * 0.6);
        s.tcx = s.cx + (Math.random() - 0.5) * maxOff;
        s.tcz = s.cz + (Math.random() - 0.5) * maxOff;
        s.tradius = conf.radius;
        s.fromCx = s.cx; s.fromCz = s.cz;
        this.emit('stormWarning', { seconds: conf.shrink });
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

  destroy() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.startTimer) clearTimeout(this.startTimer);
    for (const s of this.sockets.values()) { s.leave(this.id); s.emit('roomClosed', {}); }
    this.players.clear(); this.sockets.clear();
    if (this.onDestroy) this.onDestroy(this);
  }
}

function moveToward(bot, tx, tz, speed) {
  const dx = tx - bot.x, dz = tz - bot.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.5) return;
  bot.yaw = Math.atan2(dx, dz);
  const step = Math.min(d, speed * 0.15 * (bot.spd || 1));
  bot.x += (dx / d) * step;
  bot.z += (dz / d) * step;
}

function botPickup(room, bot, lootItem) {
  if (!room.loot.has(lootItem.id)) return;
  if (lootItem.kind === 'weapon') {
    let idx = bot.inventory.findIndex((s, i) => i > 0 && !s);
    if (idx === -1) {
      // replace worst weapon if better rarity
      idx = 1;
      if (bot.inventory[idx] && bot.inventory[idx].rarity >= lootItem.rarity) return;
    }
    bot.inventory[idx] = { kind: 'weapon', weaponId: lootItem.weaponId, rarity: lootItem.rarity, mag: 30 };
    bot.slot = idx;
  } else {
    const def = ITEMS[lootItem.itemId];
    if (def && def.type === 'heal') bot.health = Math.min(100, bot.health + 20);
    if (def && def.type === 'shield') bot.shield = Math.min(100, bot.shield + 25);
    if (def && def.type === 'mat') bot.materials[lootItem.itemId] += def.amount;
  }
  room.loot.delete(lootItem.id);
  room.emit('lootUpdate', { added: [], removed: [lootItem.id] });
}

function botShoot(room, bot, enemy, dist) {
  const w = bot.inventory[bot.slot];
  if (!w || w.kind !== 'weapon' || w.weaponId === 'pickaxe') {
    const gi = bot.inventory.findIndex(s => s && s.kind === 'weapon' && s.weaponId !== 'pickaxe');
    if (gi > 0) bot.slot = gi;
    return;
  }
  const def = WEAPONS[w.weaponId];
  const sk = BOT_SKILLS[bot.skill || 'mid'];
  const now = Date.now();
  if (now - (bot.foeSince || 0) < sk.reaction) return; // human reaction time before first shot
  if (now - bot.lastShootAt < def.fireRate + 120 + sk.extraDelay) return;
  bot.lastShootAt = now;
  const from = { x: bot.x, y: bot.y + 1.6, z: bot.z };
  const to = { x: enemy.x, y: enemy.y + 1.1, z: enemy.z };
  room.emit('tracer', { from, to, weaponId: def.id, shooter: bot.id });
  // hit chance falls with distance, scaled by tier aim
  const hitChance = Math.min(0.85, Math.max(0.03, (0.55 - dist / 220) * sk.aim));
  if (Math.random() < hitChance) {
    let dmg = def.damage * RARITY_MULT[w.rarity || 0] * (0.7 + Math.random() * 0.5);
    if (def.id === 'shotgun') dmg *= Math.max(0.3, 1 - dist / 50) * 3;
    room.applyDamage(enemy, bot, Math.round(dmg), def.name, false);
  }
}

function rayAABB(o, d, minX, minY, minZ, maxX, maxY, maxZ) {
  let tmin = 0, tmax = Infinity;
  const axes = [
    [o.x, d.x, minX, maxX], [o.y, d.y, minY, maxY], [o.z, d.z, minZ, maxZ],
  ];
  for (const [oo, dd, mn, mx] of axes) {
    if (Math.abs(dd) < 1e-8) { if (oo < mn || oo > mx) return null; }
    else {
      let t1 = (mn - oo) / dd, t2 = (mx - oo) / dd;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin > 0.01 ? tmin : null;
}

module.exports = { Room, skinColor };
