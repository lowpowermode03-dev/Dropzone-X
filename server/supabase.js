// Optional Supabase (Postgres) backend for Dropzone X.
// Activated when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set in the server
// environment (see supabase/schema.sql and the README setup guide). The game
// server talks to Postgres with the service-role key; the key must NEVER be
// exposed to browsers or committed to git. When the env vars are missing (or
// Supabase is unreachable) the game falls back to the local JSON database.
const { createClient } = require('@supabase/supabase-js');

// Local convenience: load KEY=VALUE pairs from a gitignored .env in the repo
// root before reading the environment (real env vars always win).
try {
  const fs = require('fs'), path = require('path');
  const envFile = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch { /* .env is optional */ }

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let client = null;
if (url && serviceKey) {
  client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

const DEFAULT_STATS = () => ({ matches: 0, wins: 0, kills: 0, deaths: 0, top10: 0, damage: 0 });

function userToRow(u) {
  return {
    id: u.id,
    username: u.username,
    email: u.email || '',
    password_hash: u.passwordHash,
    created_at: new Date(u.createdAt || Date.now()).toISOString(),
    stats: u.stats || DEFAULT_STATS(),
    level: u.level || 1,
    xp: u.xp || 0,
    vbucks: u.vbucks || 0,
    skin: u.skin || 'default',
    owned_skins: u.ownedSkins || ['default'],
    character: u.character || 'recruit',
    owned_characters: u.ownedCharacters || ['recruit'],
    armor: u.armor || 'standard',
    owned_armors: u.ownedArmors || ['standard'],
    guest: !!u.guest,
  };
}

function rowToUser(r) {
  return {
    id: r.id,
    username: r.username,
    email: r.email || '',
    passwordHash: r.password_hash,
    createdAt: r.created_at ? Date.parse(r.created_at) : Date.now(),
    stats: r.stats || DEFAULT_STATS(),
    level: r.level != null ? r.level : 1,
    xp: r.xp || 0,
    vbucks: r.vbucks != null ? r.vbucks : 500,
    skin: r.skin || 'default',
    ownedSkins: r.owned_skins || ['default'],
    character: r.character || 'recruit',
    ownedCharacters: r.owned_characters || ['recruit'],
    armor: r.armor || 'standard',
    ownedArmors: r.owned_armors || ['standard'],
    guest: !!r.guest,
  };
}

function rowToMatch(r) {
  return {
    userId: r.user_id, placement: r.placement, kills: r.kills, damage: r.damage,
    won: r.won, totalPlayers: r.total_players, at: r.at ? Date.parse(r.at) : Date.now(),
  };
}

async function fetchState() {
  if (!client) throw new Error('Supabase not configured');
  const players = await client.from('players').select('*');
  if (players.error) throw new Error(players.error.message);
  const matchRows = await client.from('matches').select('*').order('id', { ascending: false }).limit(500);
  if (matchRows.error) throw new Error(matchRows.error.message);
  return { users: (players.data || []).map(rowToUser), matches: (matchRows.data || []).map(rowToMatch).reverse() };
}

async function upsertUsers(users) {
  if (!client || !users.length) return;
  const { error } = await client.from('players').upsert(users.map(userToRow), { onConflict: 'id' });
  if (error) throw new Error(error.message);
}

async function insertMatch(m) {
  if (!client) return;
  const { error } = await client.from('matches').insert({
    user_id: m.userId, placement: m.placement, kills: m.kills, damage: Math.round(m.damage || 0),
    won: !!m.won, total_players: m.totalPlayers, at: new Date(m.at || Date.now()).toISOString(),
  });
  if (error) throw new Error(error.message);
}

module.exports = { enabled: !!client, fetchState, upsertUsers, insertMatch, userToRow, rowToUser };
