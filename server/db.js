// Simple JSON-file user DB (no native deps). Swap for SQLite/Postgres in production.
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const sb = require('./supabase');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MATCHES_FILE = path.join(DATA_DIR, 'matches.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function readJson(file, fallback) {
  ensureDir();
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return fallback; }
}
function writeJson(file, data) {
  ensureDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let users = readJson(USERS_FILE, []);
let matches = readJson(MATCHES_FILE, []);

// Backend: 'supabase' when env-configured AND reachable at boot, else local JSON.
let backend = sb.enabled ? 'supabase' : 'json';
let sbTimer = null;
const isSupabase = () => backend === 'supabase';

async function init() {
  if (!sb.enabled) { console.log('[db] Local JSON database (set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to use Supabase)'); return; }
  try {
    const state = await sb.fetchState();
    if (state.users.length || state.matches.length) {
      users = state.users; matches = state.matches;
      users.forEach(ensureCosmetics);
      console.log(`[db] ☁️  Supabase connected — ${users.length} players, ${matches.length} matches loaded`);
    } else if (users.length) {
      users.forEach(ensureCosmetics);
      await sb.upsertUsers(users);
      console.log(`[db] ☁️  Supabase connected — migrated ${users.length} local players`);
    } else {
      console.log('[db] ☁️  Supabase connected (fresh database)');
    }
  } catch (e) {
    backend = 'json';
    console.error('[db] Supabase unavailable (' + e.message + ') — falling back to local JSON');
  }
}

function saveUsers() {
  writeJson(USERS_FILE, users); // local cache / offline fallback + migration seed
  if (backend !== 'supabase') return;
  clearTimeout(sbTimer);
  sbTimer = setTimeout(() => { sb.upsertUsers(users).catch(e => console.error('[db] Supabase upsert failed:', e.message)); }, 250);
  if (sbTimer.unref) sbTimer.unref();
}
function saveMatches() { writeJson(MATCHES_FILE, matches.slice(-500)); }

const SKINS = [
  { id: 'default', name: 'Recruit', color: '#4d8fd1', price: 0 },
  { id: 'neon', name: 'Neon Striker', color: '#39ff88', price: 800 },
  { id: 'shadow', name: 'Shadow Ops', color: '#2b2b3a', price: 1200 },
  { id: 'gold', name: 'Golden Knight', color: '#e8a33d', price: 2000 },
  { id: 'crimson', name: 'Crimson Viper', color: '#e63946', price: 1500 },
  { id: 'frost', name: 'Frostbite', color: '#a8dadc', price: 1000 },
  { id: 'toxic', name: 'Toxic Sludge', color: '#8ac926', price: 900 },
  { id: 'galaxy', name: 'Galaxy', color: '#9b5de5', price: 2500 },
];

// Playable characters: body build + headgear + skin tone (suit color still comes from your outfit skin)
const CHARACTERS = [
  { id: 'recruit', name: 'Rookie Ranger', desc: 'Balanced all-round hero of Dropzone Island.', price: 0, suit: '#4d8fd1', accent: '#ffd23f', skinTone: '#f2c79b', build: 'balanced', headgear: 'cap' },
  { id: 'scout', name: 'Viper Scout', desc: 'Lean recon specialist with a hooded stealth rig.', price: 400, suit: '#3f9e63', accent: '#b6ff5e', skinTone: '#c98d64', build: 'slim', headgear: 'hood' },
  { id: 'heavy', name: 'Bulwark Heavy', desc: 'Towering front-liner in a full combat helmet.', price: 1000, suit: '#68707f', accent: '#ffb020', skinTone: '#8a5a3b', build: 'heavy', headgear: 'helmet' },
  { id: 'specter', name: 'Specter Operative', desc: 'Sleek black-ops phantom with a glowing mask.', price: 1600, suit: '#252836', accent: '#8f6bff', skinTone: '#e8b48c', build: 'sleek', headgear: 'mask' },
];

// Equippable armor cosmetics: layered plates/pauldrons/guards rendered over the character
const ARMORS = [
  { id: 'standard', name: 'Standard Issue', desc: 'Basic chest rig and backpack.', price: 0, plate: '#2a2d38', accent: '#9fb4c8', trim: '#596273', tier: 0 },
  { id: 'vanguard', name: 'Vanguard Armor', desc: 'Pauldrons, plated chest and limb guards.', price: 500, plate: '#37648f', accent: '#ffd23f', trim: '#d7e6f5', tier: 1 },
  { id: 'aegis', name: 'Aegis Warplate', desc: 'Heavy warplate with a glowing power core.', price: 1000, plate: '#7a8794', accent: '#37e0ff', trim: '#f2f6fa', tier: 2 },
  { id: 'obsidian', name: 'Obsidian Warplate', desc: 'Blackened plate with blood-red energy trim.', price: 1600, plate: '#171923', accent: '#ff3d5e', trim: '#5c2333', tier: 3 },
  { id: 'solar', name: 'Solar Champion', desc: 'Golden champion plate with a radiant halo.', price: 2200, plate: '#d9b45b', accent: '#fff3b0', trim: '#fff8e1', tier: 3 },
];

// Enemy-only characters (bots) — never sold in the shop
const ENEMY_CHARACTERS = [
  { id: 'raider', name: 'Wasteland Raider', suit: '#7a3b2e', accent: '#ffb020', skinTone: '#c98d64', build: 'balanced', headgear: 'spikes' },
  { id: 'marauder', name: 'Iron Marauder', suit: '#3f454f', accent: '#ff3d5e', skinTone: '#8a6a4f', build: 'heavy', headgear: 'horns' },
  { id: 'warhound', name: 'Warhound', suit: '#5d4a2f', accent: '#ffd23f', skinTone: '#a87950', build: 'slim', headgear: 'fins' },
  { id: 'reaper', name: 'Void Reaper', suit: '#211d2e', accent: '#b18cff', skinTone: '#6f7d8c', build: 'sleek', headgear: 'reaper' },
];
const ENEMY_ARMORS = [
  { id: 'raider_plate', name: 'Raider Scrap Plate', plate: '#5a3a30', accent: '#ffb020', trim: '#2e2019', tier: 2 },
  { id: 'war_plate', name: 'Marauder Warplate', plate: '#23262d', accent: '#ff3d5e', trim: '#4a2028', tier: 3 },
  { id: 'hound_plate', name: 'Warhound Leathers', plate: '#4c3d28', accent: '#ffd23f', trim: '#2c2115', tier: 1 },
  { id: 'void_plate', name: 'Void Reaper Plate', plate: '#14101f', accent: '#b18cff', trim: '#2c2145', tier: 3 },
];
const ENEMY_ROSTER = ENEMY_CHARACTERS.map((c, i) => ({ character: c.id, armor: ENEMY_ARMORS[i].id, color: c.suit, name: c.name }));

const COSMETIC_KINDS = {
  skin: { list: SKINS, ownedKey: 'ownedSkins', equippedKey: 'skin', label: 'Skin' },
  character: { list: CHARACTERS, ownedKey: 'ownedCharacters', equippedKey: 'character', label: 'Character' },
  armor: { list: ARMORS, ownedKey: 'ownedArmors', equippedKey: 'armor', label: 'Armor' },
};

// Backfill cosmetics fields for accounts created before characters/armor existed
function ensureCosmetics(u) {
  if (!u) return u;
  if (!Array.isArray(u.ownedSkins) || !u.ownedSkins.length) u.ownedSkins = ['default'];
  if (!SKINS.find(s => s.id === u.skin)) u.skin = 'default';
  if (!Array.isArray(u.ownedCharacters) || !u.ownedCharacters.length) u.ownedCharacters = ['recruit'];
  if (!u.ownedCharacters.includes('recruit')) u.ownedCharacters.unshift('recruit');
  if (!CHARACTERS.find(c => c.id === u.character)) u.character = 'recruit';
  if (!Array.isArray(u.ownedArmors) || !u.ownedArmors.length) u.ownedArmors = ['standard'];
  if (!u.ownedArmors.includes('standard')) u.ownedArmors.unshift('standard');
  if (!ARMORS.find(a => a.id === u.armor)) u.armor = 'standard';
  return u;
}
users.forEach(ensureCosmetics);

async function register(username, password, email) {
  username = (username || '').trim().toLowerCase();
  if (!/^[a-z0-9_]{3,16}$/.test(username)) throw new Error('Username must be 3-16 chars: letters, numbers, underscore');
  if (!password || password.length < 6) throw new Error('Password must be at least 6 characters');
  if (users.find(u => u.username === username)) throw new Error('Username already taken');
  const hash = await bcrypt.hash(password, 10);
  const user = {
    id: 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    username,
    email: (email || '').trim().toLowerCase(),
    passwordHash: hash,
    createdAt: Date.now(),
    stats: { matches: 0, wins: 0, kills: 0, deaths: 0, top10: 0, damage: 0 },
    level: 1, xp: 0, vbucks: 500, skin: 'default', ownedSkins: ['default'],
    character: 'recruit', ownedCharacters: ['recruit'], armor: 'standard', ownedArmors: ['standard'],
  };
  users.push(user);
  saveUsers();
  return publicUser(user);
}

async function login(username, password) {
  const user = users.find(u => u.username === (username || '').trim().toLowerCase());
  if (!user) throw new Error('Invalid username or password');
  const ok = await bcrypt.compare(password || '', user.passwordHash);
  if (!ok) throw new Error('Invalid username or password');
  return publicUser(user);
}

function publicUser(u) {
  if (!u) return null;
  ensureCosmetics(u);
  return {
    id: u.id, username: u.username, email: u.email, createdAt: u.createdAt,
    stats: u.stats, level: u.level, xp: u.xp, vbucks: u.vbucks, skin: u.skin, ownedSkins: u.ownedSkins,
    character: u.character, ownedCharacters: u.ownedCharacters, armor: u.armor, ownedArmors: u.ownedArmors,
  };
}

function getUserById(id) { return users.find(u => u.id === id) || null; }
function getUserByUsername(name) { return users.find(u => u.username === name) || null; }

function updateUser(id, patch) {
  const u = getUserById(id);
  if (!u) return null;
  Object.assign(u, patch);
  saveUsers();
  return publicUser(u);
}

function addMatchResult(userId, { placement, kills, damage, won, totalPlayers }) {
  const u = getUserById(userId);
  if (!u) return;
  u.stats.matches += 1;
  u.stats.kills += kills;
  u.stats.deaths += 1;
  u.stats.damage += damage;
  if (won) u.stats.wins += 1;
  if (placement <= 10) u.stats.top10 += 1;
  const xpGain = 50 + kills * 25 + (won ? 200 : 0) + Math.max(0, 20 - placement) * 5;
  u.xp += xpGain;
  const need = u.level * 1000;
  if (u.xp >= need) { u.xp -= need; u.level += 1; u.vbucks += 100; }
  if (won) u.vbucks += 50;
  saveUsers();
  const matchRow = { userId, placement, kills, damage, won, totalPlayers, at: Date.now() };
  matches.push(matchRow);
  saveMatches();
  if (backend === 'supabase') sb.insertMatch(matchRow).catch(e => console.error('[db] Supabase match insert failed:', e.message));
}

function buyCosmetic(userId, kind, id) {
  const u = getUserById(userId);
  if (!u) throw new Error('User not found');
  ensureCosmetics(u);
  const cfg = COSMETIC_KINDS[kind];
  if (!cfg) throw new Error('Unknown cosmetic type');
  const item = cfg.list.find(s => s.id === id);
  if (!item) throw new Error(cfg.label + ' not found');
  if (u[cfg.ownedKey].includes(id)) throw new Error('Already owned');
  if (u.vbucks < item.price) throw new Error('Not enough V-Bucks');
  u.vbucks -= item.price;
  u[cfg.ownedKey].push(id);
  u[cfg.equippedKey] = id;
  saveUsers();
  return publicUser(u);
}

function equipCosmetic(userId, kind, id) {
  const u = getUserById(userId);
  if (!u) throw new Error('User not found');
  ensureCosmetics(u);
  const cfg = COSMETIC_KINDS[kind];
  if (!cfg) throw new Error('Unknown cosmetic type');
  if (!u[cfg.ownedKey].includes(id)) throw new Error(cfg.label + ' not owned');
  u[cfg.equippedKey] = id;
  saveUsers();
  return publicUser(u);
}

function buySkin(userId, skinId) { return buyCosmetic(userId, 'skin', skinId); }

function leaderboard(limit = 20) {
  return [...users]
    .sort((a, b) => (b.stats.wins - a.stats.wins) || (b.stats.kills - a.stats.kills))
    .slice(0, limit)
    .map(u => ({ username: u.username, level: u.level, wins: u.stats.wins, kills: u.stats.kills, matches: u.stats.matches, kd: u.stats.matches ? (u.stats.kills / u.stats.matches).toFixed(2) : '0.00' }));
}

module.exports = { register, login, publicUser, getUserById, getUserByUsername, updateUser, addMatchResult, buySkin, buyCosmetic, equipCosmetic, leaderboard, init, isSupabase, SKINS, CHARACTERS, ARMORS, ENEMY_CHARACTERS, ENEMY_ARMORS, ENEMY_ROSTER };
