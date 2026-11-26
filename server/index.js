// FortWorld server: Express + Socket.IO, accounts (JWT), matchmaking, game rooms.
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const db = require('./db');
const { Room } = require('./game');
const { WEAPONS, ITEMS, RARITIES, RARITY_COLORS } = require('./weapons');
const { terrainHeight, POIS, BUILDINGS, TREES, ROCKS } = require('./map');

const JWT_SECRET = process.env.JWT_SECRET || 'fortworld-dev-secret-change-me';
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Hydrate the database (Supabase or local JSON) once; API calls wait for it.
// On Vercel this runs per cold start, which is why Supabase is recommended there.
const dbReady = db.init();
app.use((req, res, next) => { dbReady.then(() => next(), () => next()); });

function authMiddleware(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.getUserById(payload.uid);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch { return res.status(401).json({ error: 'Invalid token' }); }
}

// ---------- REST: accounts ----------
app.post('/api/register', async (req, res) => {
  try {
    const user = await db.register(req.body.username, req.body.password, req.body.email);
    const token = jwt.sign({ uid: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const user = await db.login(req.body.username, req.body.password);
    const token = jwt.sign({ uid: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Guest account (instant play) - creates a persistent guest user
app.post('/api/guest', async (req, res) => {
  try {
    const name = 'Guest_' + Math.random().toString(36).slice(2, 7);
    const user = await db.register(name, Math.random().toString(36).slice(2) + 'Aa1!', '', { guest: true });
    const token = jwt.sign({ uid: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

const COSMETICS_META = () => ({ skins: db.SKINS, characters: db.CHARACTERS, armors: db.ARMORS, enemyCharacters: db.ENEMY_CHARACTERS, enemyArmors: db.ENEMY_ARMORS });

app.get('/api/me', authMiddleware, (req, res) => res.json({ user: db.publicUser(req.user) }));
app.get('/api/daily', authMiddleware, (req, res) => res.json({ daily: db.dailyStatus(req.user) }));
app.post('/api/daily/claim', authMiddleware, (req, res) => {
  try { res.json(db.claimDaily(req.user.id)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/leaderboard', (req, res) => res.json({ leaderboard: db.leaderboard(20), ...COSMETICS_META() }));
app.get('/api/skins', (req, res) => res.json({ skins: db.SKINS }));

app.post('/api/shop/buy', authMiddleware, (req, res) => {
  try {
    const kind = req.body.kind || 'skin';
    const id = req.body.id || req.body.skinId;
    res.json({ user: db.buyCosmetic(req.user.id, kind, id) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/shop/equip', authMiddleware, (req, res) => {
  try {
    const kind = req.body.kind || 'skin';
    const id = req.body.id || req.body.skinId;
    res.json({ user: db.equipCosmetic(req.user.id, kind, id) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/meta', (req, res) => res.json({ weapons: WEAPONS, items: ITEMS, rarities: RARITIES, rarityColors: RARITY_COLORS, ...COSMETICS_META() }));
// Static island data so the menu/lobby can render the 3D world backdrop
app.get('/api/world', (req, res) => res.json({ pois: POIS, buildings: BUILDINGS, trees: TREES, rocks: ROCKS }));

// Public client config for "Vercel Play": when no persistent game server is
// reachable, the browser runs bot-filled matches locally and uses Supabase
// Realtime for the live lobby (presence + chat). The anon/publishable key is
// safe to expose — it only grants access to public Realtime channels.
app.get('/api/public-config', (req, res) => res.json({
  supabaseUrl: process.env.SUPABASE_URL || null,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || null,
  serverless: !!process.env.VERCEL,
}));

// Vercel Play match results. The browser simulates the match (there is no
// long-lived server on Vercel), so results are client-reported: values are
// hard-capped and submissions are rate-limited. Registered accounts then get
// exactly the same rewards a server-hosted match would grant (XP via
// addMatchResult, +30 V-Bucks per kill via awardKill, +50 win bonus);
// guests keep basic stats only — no XP/V-Bucks progression, as everywhere.
const lastResultAt = new Map();
app.post('/api/match/result', authMiddleware, (req, res) => {
  const b = req.body || {};
  const clampInt = (v, lo, hi) => { const n = Math.floor(Number(v)); return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };
  const placement = clampInt(b.placement, 1, 64);
  const kills = clampInt(b.kills, 0, 40);
  const damage = clampInt(b.damage, 0, 30000);
  const totalPlayers = clampInt(b.totalPlayers, 2, 64) || 24;
  if (placement === null || kills === null || damage === null) return res.status(400).json({ error: 'Invalid match result' });
  const now = Date.now();
  if (now - (lastResultAt.get(req.user.id) || 0) < 40000) return res.status(429).json({ error: 'Match result submitted too soon after the previous one' });
  lastResultAt.set(req.user.id, now);
  const won = !!b.won && placement === 1;
  db.addMatchResult(req.user.id, { placement, kills, damage, won, totalPlayers });
  const fresh = db.getUserById(req.user.id);
  if (fresh && !fresh.guest) for (let i = 0; i < kills; i++) db.awardKill(req.user.id);
  res.json({ saved: true, user: db.publicUser(db.getUserById(req.user.id)) });
});

// ---------- Socket.IO ----------
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const rooms = new Set();
let openRoom = null;

function getOpenRoom() {
  if (openRoom && openRoom.phase === 'waiting' && openRoom.humans().length < 20) return openRoom;
  const room = new Room(io);
  room.onDestroy = (r) => { rooms.delete(r); if (openRoom === r) openRoom = null; };
  rooms.add(room);
  openRoom = room;
  return room;
}

const socketUser = new Map();

io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.getUserById(payload.uid);
    if (!user) return next(new Error('User not found'));
    socket.data.user = db.publicUser(user);
    next();
  } catch { next(new Error('Invalid token')); }
});

io.on('connection', (socket) => {
  const user = socket.data.user;
  socketUser.set(socket.id, user);
  console.log(`[connect] ${user.username} (${socket.id})`);
  socket.emit('welcome', { user, meta: { weapons: WEAPONS, items: ITEMS, rarities: RARITIES, rarityColors: RARITY_COLORS, ...COSMETICS_META() } });

  let currentRoom = null;

  socket.on('queue', () => {
    if (currentRoom) return;
    currentRoom = getOpenRoom();
    currentRoom.addHuman(socket, db.getUserById(user.id));
    socket.emit('queued', { roomId: currentRoom.id });
  });

  socket.on('leaveQueue', () => {
    if (currentRoom && currentRoom.phase === 'waiting') { currentRoom.removeHuman(socket.id); currentRoom = null; }
  });

  const inRoom = () => currentRoom && currentRoom.players.get(socket.id);

  socket.on('move', (m) => { const p = inRoom(); if (p && m && isFinite(m.x)) currentRoom.handleMove(p, m); });
  socket.on('jump', () => { const p = inRoom(); if (p) currentRoom.handleJump(p); });
  socket.on('shoot', (d) => { const p = inRoom(); if (p && d && d.dir) currentRoom.handleShoot(p, d); });
  socket.on('melee', (d) => { const p = inRoom(); if (p && d && d.dir) currentRoom.handleMelee(p, d); });
  socket.on('reload', () => { const p = inRoom(); if (p) currentRoom.handleReload(p); });
  socket.on('pickup', (lootId) => { const p = inRoom(); if (p) currentRoom.handlePickup(p, lootId); });
  socket.on('useItem', (slot) => { const p = inRoom(); if (p) currentRoom.handleUseItem(p, slot); });
  socket.on('build', (b) => { const p = inRoom(); if (p && b) currentRoom.handleBuild(p, b); });
  socket.on('setSlot', (slot) => { const p = inRoom(); if (p && slot >= 0 && slot < 5) { p.slot = slot; socket.emit('selfUpdate', currentRoom.publicSelf(p)); } });
  socket.on('chat', (msg) => {
    const text = String(msg || '').slice(0, 120);
    if (!text) return;
    const payload = { user: user.username, text, at: Date.now() };
    if (currentRoom) io.to(currentRoom.id).emit('chat', payload);
    else io.emit('chat', payload);
  });

  socket.on('disconnect', () => {
    console.log(`[disconnect] ${user.username}`);
    socketUser.delete(socket.id);
    if (currentRoom) { currentRoom.removeHuman(socket.id); currentRoom = null; }
  });
});

app.get('/api/health', (req, res) => res.json({ ok: true, backend: db.isSupabase() ? 'supabase' : 'json', serverless: !!process.env.VERCEL }));

// Long-lived mode (npm start / Render / Railway / your PC): listen on a port.
// Serverless mode (Vercel): the platform imports the exported Express app.
if (require.main === module) {
  dbReady.then(() => {
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`\n🎮 Dropzone X server running on http://0.0.0.0:${PORT}`);
      console.log(`   Map: 8000x8000 | POIs: ${POIS.length} (10 native + 6 expansion + 4 outer ring) | Bots fill matches to 24 fighters`);
      console.log(`   Database: ${db.isSupabase() ? '☁️  Supabase (Postgres)' : '💾 Local JSON (data/)'}\n`);
    });
  });
}

module.exports = app;
