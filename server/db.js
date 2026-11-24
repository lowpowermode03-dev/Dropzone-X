// Simple JSON-file user DB (no native deps). Swap for SQLite/Postgres in production.
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

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

function saveUsers() { writeJson(USERS_FILE, users); }
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
  return {
    id: u.id, username: u.username, email: u.email, createdAt: u.createdAt,
    stats: u.stats, level: u.level, xp: u.xp, vbucks: u.vbucks, skin: u.skin, ownedSkins: u.ownedSkins,
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
  matches.push({ userId, placement, kills, damage, won, totalPlayers, at: Date.now() });
  saveMatches();
}

function buySkin(userId, skinId) {
  const u = getUserById(userId);
  if (!u) throw new Error('User not found');
  const skin = SKINS.find(s => s.id === skinId);
  if (!skin) throw new Error('Skin not found');
  if (u.ownedSkins.includes(skinId)) throw new Error('Already owned');
  if (u.vbucks < skin.price) throw new Error('Not enough V-Bucks');
  u.vbucks -= skin.price;
  u.ownedSkins.push(skinId);
  u.skin = skinId;
  saveUsers();
  return publicUser(u);
}

function leaderboard(limit = 20) {
  return [...users]
    .sort((a, b) => (b.stats.wins - a.stats.wins) || (b.stats.kills - a.stats.kills))
    .slice(0, limit)
    .map(u => ({ username: u.username, level: u.level, wins: u.stats.wins, kills: u.stats.kills, matches: u.stats.matches, kd: u.stats.matches ? (u.stats.kills / u.stats.matches).toFixed(2) : '0.00' }));
}

module.exports = { register, login, publicUser, getUserById, getUserByUsername, updateUser, addMatchResult, buySkin, leaderboard, SKINS };
