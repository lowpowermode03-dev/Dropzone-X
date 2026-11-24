// FortWorld client: auth, lobby, shop, FPS gameplay, building, HUD.
import * as THREE from 'three';
import { terrainHeight, createSky, createWater, createStormWall, lootBeamMaterial, buildWorld, hideNode, WATER_Y } from './world.js';

const $ = (id) => document.getElementById(id);
const RARITY_COLORS = ['#b1b1b1', '#60aa3c', '#4d8fd1', '#b04dd1', '#e8a33d'];
const RARITY_NAMES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
const WEAPON_ICONS = { pickaxe: '⛏️', pistol: '🔫', smg: '💨', ar: '🎯', shotgun: '💥', sniper: '🔭', lmg: '🔥' };
const ITEM_ICONS = { shield_small: '🧪', shield_big: '🛡️', medkit: '❤️', bandage: '🩹', ammo_light: '•', ammo_medium: '•', ammo_heavy: '•', ammo_shells: '•', wood: '🪵', stone: '🧱', metal: '🔩' };
const AMMO_FOR = { pistol: 'light', smg: 'light', ar: 'medium', lmg: 'medium', sniper: 'heavy', shotgun: 'shells' };
const AMMO_NAMES = { light: 'Light', medium: 'Medium', heavy: 'Heavy', shells: 'Shells' };

let token = localStorage.getItem('fortworld_token') || null;
let currentUser = null;
let socket = null;
let META = null;

// ---------------- audio (tiny synth, no assets) ----------------
let AC = null;
function audio() { if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)(); return AC; }
function playNoise(dur = 0.08, freq = 1800, vol = 0.12) {
  try {
    const ac = audio(); const len = ac.sampleRate * dur;
    const buf = ac.createBuffer(1, len, ac.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ac.createBufferSource(); src.buffer = buf;
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = ac.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(ac.destination); src.start();
  } catch {}
}
function playTone(freq, dur = 0.07, vol = 0.08, type = 'square') {
  try {
    const ac = audio(); const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = freq; g.gain.setValueAtTime(vol, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + dur);
  } catch {}
}

// ---------------- API ----------------
async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(opts.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ---------------- screens ----------------
function show(id) {
  for (const s of ['authScreen', 'lobbyScreen', 'loadingScreen', 'endScreen']) $(s).classList.add('hidden');
  if (id) $(id).classList.remove('hidden');
}

// ---------------- auth ----------------
$('tabLogin').onclick = () => { $('tabLogin').classList.add('active'); $('tabRegister').classList.remove('active'); $('loginForm').classList.remove('hidden'); $('registerForm').classList.add('hidden'); };
$('tabRegister').onclick = () => { $('tabRegister').classList.add('active'); $('tabLogin').classList.remove('active'); $('registerForm').classList.remove('hidden'); $('loginForm').classList.add('hidden'); };

async function onAuthed(data) {
  token = data.token; currentUser = data.user;
  localStorage.setItem('fortworld_token', token);
  connectSocket();
  await refreshLobby();
  show('lobbyScreen');
}
$('btnLogin').onclick = async () => {
  $('authError').textContent = '';
  try { await onAuthed(await api('/api/login', { method: 'POST', body: JSON.stringify({ username: $('loginUser').value, password: $('loginPass').value }) })); }
  catch (e) { $('authError').textContent = e.message; }
};
$('btnRegister').onclick = async () => {
  $('authError').textContent = '';
  try { await onAuthed(await api('/api/register', { method: 'POST', body: JSON.stringify({ username: $('regUser').value, email: $('regEmail').value, password: $('regPass').value }) })); }
  catch (e) { $('authError').textContent = e.message; }
};
$('btnGuest').onclick = async () => {
  $('authError').textContent = '';
  try { await onAuthed(await api('/api/guest', { method: 'POST', body: '{}' })); }
  catch (e) { $('authError').textContent = e.message; }
};
$('btnLogout').onclick = () => { localStorage.removeItem('fortworld_token'); location.reload(); };
$('loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnLogin').click(); });
$('regPass').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnRegister').click(); });

// ---------------- lobby ----------------
async function refreshLobby() {
  try {
    const { user } = await api('/api/me');
    currentUser = user;
    $('lobbyName').textContent = user.username;
    $('lobbyLevel').textContent = `Level ${user.level} · ${user.xp} XP`;
    $('lobbyVbucks').textContent = user.vbucks;
    $('lobbyAvatar').textContent = user.username[0].toUpperCase();
    const s = user.stats;
    const kd = s.matches ? (s.kills / Math.max(1, s.matches)).toFixed(2) : '0.00';
    const winRate = s.matches ? Math.round((s.wins / s.matches) * 100) : 0;
    $('myStats').innerHTML = [
      ['Matches', s.matches], ['Victory Royales 👑', s.wins], ['Win rate', winRate + '%'],
      ['Eliminations', s.kills], ['Avg kills / match', kd], ['Top 10 finishes', s.top10], ['Damage dealt', Math.round(s.damage)],
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    const lb = await api('/api/leaderboard');
    $('leaderboard').innerHTML = lb.leaderboard.length
      ? lb.leaderboard.map((r, i) => `<div><span>${i + 1}. ${r.username} <span class="tiny">Lv${r.level}</span></span><b>👑${r.wins} · ⚔️${r.kills}</b></div>`).join('')
      : '<div class="tiny">No matches played yet — be the first legend!</div>';
    renderShop(lb.skins);
  } catch (e) { console.warn(e); }
}

function renderShop(skins) {
  if (!skins || !currentUser) return;
  $('skinGrid').innerHTML = skins.map(sk => {
    const owned = currentUser.ownedSkins.includes(sk.id);
    const equipped = currentUser.skin === sk.id;
    return `<div class="skin-card ${owned ? 'owned' : ''} ${equipped ? 'equipped' : ''}">
      <div class="skin-swatch" style="background:${sk.color}"></div>
      <div><b>${sk.name}</b></div><div class="tiny">${owned ? (equipped ? 'Equipped' : 'Owned') : '🪙 ' + sk.price}</div>
      <button data-skin="${sk.id}" ${equipped ? 'disabled' : ''}>${equipped ? 'EQUIPPED' : owned ? 'EQUIP' : 'BUY'}</button>
    </div>`;
  }).join('');
  $('skinGrid').querySelectorAll('button[data-skin]').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.skin;
      try {
        const owned = currentUser.ownedSkins.includes(id);
        const r = owned ? await api('/api/shop/equip', { method: 'POST', body: JSON.stringify({ skinId: id }) })
                        : await api('/api/shop/buy', { method: 'POST', body: JSON.stringify({ skinId: id }) });
        currentUser = r.user; refreshLobby();
      } catch (e) { alert(e.message); }
    };
  });
}

$('btnPlay').onclick = () => { socket && socket.emit('queue'); $('btnPlay').classList.add('hidden'); $('queueBox').classList.remove('hidden'); };
$('btnCancelQueue').onclick = () => { socket && socket.emit('leaveQueue'); $('btnPlay').classList.remove('hidden'); $('queueBox').classList.add('hidden'); };

function sendChat() {
  const v = $('chatInput').value.trim();
  if (v && socket) { socket.emit('chat', v); $('chatInput').value = ''; }
}
$('btnChat').onclick = sendChat;
$('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
function addChat(user, text) {
  const el = document.createElement('div');
  el.innerHTML = `<b></b> <span></span>`;
  el.querySelector('b').textContent = user + ':';
  el.querySelector('span').textContent = text;
  $('chatLog').appendChild(el);
  $('chatLog').scrollTop = 99999;
  while ($('chatLog').children.length > 40) $('chatLog').firstChild.remove();
}

// ---------------- socket ----------------
function connectSocket() {
  if (socket) return;
  socket = io({ auth: { token } });
  socket.on('welcome', (d) => { META = d.meta; });
  socket.on('chat', (m) => addChat(m.user, m.text));
  socket.on('lobbyUpdate', (d) => { $('queuePlayers').textContent = `Players ready: ${d.players.map(p => p.username).join(', ') || '…'} — match starts soon, bots will fill the lobby`; });
  socket.on('matchStart', (data) => startMatch(data));
  socket.on('snapshot', (snap) => { if (G.active) onSnapshot(snap); });
  socket.on('selfUpdate', (s) => { G.self = s; renderInventory(); });
  socket.on('ammoUpdate', (s) => { G.self = s; renderInventory(); });
  socket.on('lootUpdate', (u) => { if (G.active) { (u.added || []).forEach(addLootMesh); (u.removed || []).forEach(removeLootMesh); } });
  socket.on('structurePlaced', (s) => { if (G.active) addStructureMesh(s); });
  socket.on('structureRemoved', (d) => { if (G.active) removeStructureMesh(d.id); });
  socket.on('nodeGone', (d) => { if (G.world) hideNode(G.world, G.data, d.type, d.index); });
  socket.on('tracer', (t) => { if (G.active) spawnTracer(t); });
  socket.on('hitmarker', (h) => { flashHitmarker(h); if (navigator.vibrate) {} playTone(h.headshot ? 1200 : 700, 0.05, 0.06); });
  socket.on('youTookDamage', () => { const v = $('damageVignette'); v.style.opacity = 1; setTimeout(() => v.style.opacity = 0, 160); playNoise(0.05, 500, 0.08); });
  socket.on('killfeed', (k) => addKillfeed(k));
  socket.on('youGotKill', (k) => showNotice(`☠️ Eliminated ${k.victim}! (${k.kills} kills)`, '#2e7d32'));
  socket.on('notice', (n) => showNotice(n.msg));
  socket.on('needReload', () => showNotice('Press R to reload!'));
  socket.on('usingItem', (u) => startUseBar(u.ms));
  socket.on('youJumped', () => { G.mode = 'skydiving'; $('busPrompt').classList.add('hidden'); tryLock(); });
  socket.on('forceJump', () => { G.mode = 'skydiving'; $('busPrompt').classList.add('hidden'); });
  socket.on('eliminated', (d) => endMatch(false, d));
  socket.on('victory', (d) => { G.won = true; });
  socket.on('matchEnd', (d) => { if (G.active) endMatch(d.winnerId === G.myId || G.won, { placement: d.winnerId === G.myId ? 1 : (G.myPlacement || 2), winner: d.winner }); });
  socket.on('roomClosed', () => { if (G.active && !G.ended) location.reload(); });
  socket.on('stormWarning', () => showNotice('🌩️ Storm shrinking!', '#5e35b1'));
  socket.on('disconnect', () => { if (G.active) showNotice('Disconnected from server', '#7d1d1d'); });
}

// ---------------- game state ----------------
const G = {
  active: false, ended: false, won: false, mode: 'bus', // bus | skydiving | ground
  scene: null, camera: null, renderer: null, world: null, data: null, myId: null, self: null,
  pos: new THREE.Vector3(0, 240, 0), velY: 0, yaw: 0, pitch: 0, onGround: false, gliding: false,
  remotes: new Map(), loot: new Map(), structures: new Map(), tracers: [],
  keys: {}, mouseDown: false, clicked: false, lastShot: 0, lastMoveSend: 0, lastMinimap: 0,
  buildMode: false, buildType: 'wall', buildMat: 'wood', slot: 0, swingAt: 0,
  storm: { cx: 0, cz: 0, radius: 1900, timer: 0, state: 'idle' }, aliveCount: 24, busPos: { x: -1900, y: 230, z: 0 },
  skyMat: null, waterMat: null, stormWall: null, busGroup: null, ghost: null, viewmodel: null, vmWeapon: '', myPlacement: 0,
};

function initRenderer() {
  if (G.renderer) return;
  G.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  G.renderer.setSize(innerWidth, innerHeight);
  G.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  G.renderer.shadowMap.enabled = true;
  G.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  G.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  G.renderer.toneMappingExposure = 1.05;
  G.renderer.domElement.className = 'game';
  G.renderer.domElement.style.cssText = 'position:fixed;inset:0;z-index:0';
  document.body.appendChild(G.renderer.domElement);
  G.camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.1, 9000);
  addEventListener('resize', () => { G.camera.aspect = innerWidth / innerHeight; G.camera.updateProjectionMatrix(); G.renderer.setSize(innerWidth, innerHeight); });
}

function startMatch(data) {
  show('loadingScreen');
  $('loadingFill').style.width = '35%'; $('loadingText').textContent = 'Building island (4000 × 4000)…';
  setTimeout(() => {
    initRenderer();
    G.data = data; G.myId = data.you; G.active = true; G.ended = false; G.won = false;
    G.mode = 'bus'; G.slot = 0; G.buildMode = false;
    G.pos.set(data.bus.x, data.bus.y, data.bus.z);
    G.remotes.clear(); G.loot.clear(); G.structures.clear(); G.self = null;
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x9fc6ee, 250, 3800);
    G.scene = scene;
    G.skyMat = createSky(scene);
    G.waterMat = createWater(scene);
    const sw = createStormWall(scene); G.stormWall = sw;
    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x4a7c43, 0.95); scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2cf, 2.0);
    sun.position.set(400, 700, 250); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -130; sun.shadow.camera.right = 130; sun.shadow.camera.top = 130; sun.shadow.camera.bottom = -130;
    sun.shadow.camera.far = 1800; sun.name = 'sun';
    scene.add(sun); scene.add(sun.target);
    G.world = buildWorld(scene, data);
    $('loadingFill').style.width = '75%'; $('loadingText').textContent = 'Dropping loot & building Battle Bus…';
    // Battle bus
    G.busGroup = makeBus(); scene.add(G.busGroup);
    data.loot.forEach(addLootMesh);
    // viewmodel
    G.viewmodel = new THREE.Group();
    G.camera.add(G.viewmodel); scene.add(G.camera);
    buildViewmodel('pickaxe');
    // ghost preview
    G.ghost = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 0.35), new THREE.MeshBasicMaterial({ color: 0x37d67a, transparent: true, opacity: 0.4, depthWrite: false }));
    G.ghost.visible = false; scene.add(G.ghost);
    show(null);
    $('hud').classList.remove('hidden');
    $('busPrompt').classList.remove('hidden');
    $('btnPlay').classList.remove('hidden'); $('queueBox').classList.add('hidden');
    $('killfeed').innerHTML = '';
    renderInventory();
    requestAnimationFrame(loop);
  }, 60);
}

function makeBus() {
  const g = new THREE.Group();
  const balloon = new THREE.Mesh(new THREE.SphereGeometry(13, 20, 16), new THREE.MeshStandardMaterial({ color: 0x2f7fe0, roughness: 0.5 }));
  balloon.scale.set(1.5, 1, 1); balloon.position.y = 16;
  const stripe = new THREE.Mesh(new THREE.SphereGeometry(13.15, 20, 8, 0, Math.PI * 2, 1.2, 0.7), new THREE.MeshStandardMaterial({ color: 0xffd23f }));
  stripe.scale.copy(balloon.scale); stripe.position.y = 16;
  const bus = new THREE.Mesh(new THREE.BoxGeometry(15, 4.2, 4.6), new THREE.MeshStandardMaterial({ color: 0x3b6fd4 }));
  const roof = new THREE.Mesh(new THREE.BoxGeometry(15.4, 0.7, 5), new THREE.MeshStandardMaterial({ color: 0xffd23f }));
  roof.position.y = 2.4;
  const winMat = new THREE.MeshStandardMaterial({ color: 0xbfe9ff, emissive: 0x6fb7ff, emissiveIntensity: 0.5 });
  for (let i = -3; i <= 3; i++) { const w = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 4.75), winMat); w.position.set(i * 2, 0.5, 0); bus.add(w); }
  bus.add(roof); g.add(balloon, stripe, bus);
  return g;
}

function makeCharacter(colorHex, username) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(colorHex || '#4d8fd1'), roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 0.85, 4, 10), mat);
  body.position.y = 1.05; body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.37, 14, 12), new THREE.MeshStandardMaterial({ color: 0xf2c79b, roughness: 0.7 }));
  head.position.y = 2.0; head.castShadow = true;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.39, 14, 8, 0, Math.PI * 2, 0, 1.25), mat);
  cap.position.y = 2.04;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.22, 1.05), new THREE.MeshStandardMaterial({ color: 0x22242e }));
  gun.position.set(0.42, 1.35, 0.45);
  const glider = new THREE.Mesh(new THREE.SphereGeometry(2.6, 14, 6, 0, Math.PI * 2, 0, 1.15), new THREE.MeshStandardMaterial({ color: 0xff7847, side: THREE.DoubleSide }));
  glider.position.y = 3.4; glider.scale.y = 0.45; glider.visible = false; glider.name = 'glider';
  // nameplate
  const c = document.createElement('canvas'); c.width = 256; c.height = 52;
  const ctx = c.getContext('2d'); ctx.font = '800 26px Segoe UI'; ctx.textAlign = 'center';
  ctx.shadowColor = '#000'; ctx.shadowBlur = 6; ctx.fillStyle = '#fff'; ctx.fillText(username, 128, 34);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  spr.scale.set(5.4, 1.1, 1); spr.position.y = 2.75;
  g.add(body, head, cap, gun, glider, spr);
  g.userData = { gun, glider, body };
  return g;
}

function addLootMesh(item) {
  if (!G.scene || G.loot.has(item.id)) return;
  const grp = new THREE.Group();
  const color = item.kind === 'weapon' ? RARITY_COLORS[item.rarity || 0] : '#ffe082';
  const base = new THREE.Mesh(
    item.kind === 'weapon' ? new THREE.BoxGeometry(1.15, 0.32, 0.42) : new THREE.BoxGeometry(0.55, 0.55, 0.55),
    new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color), emissiveIntensity: 0.55, roughness: 0.4 })
  );
  base.position.y = 0.55;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 9, 10, 1, true), lootBeamMaterial(color));
  beam.position.y = 4.8;
  grp.add(base, beam);
  grp.position.set(item.x, item.y, item.z);
  grp.userData = { item, base, beam };
  G.scene.add(grp);
  G.loot.set(item.id, grp);
}
function removeLootMesh(id) {
  const m = G.loot.get(id);
  if (m) { G.scene.remove(m); G.loot.delete(id); }
}

function structMaterial(mat) {
  return new THREE.MeshStandardMaterial({ color: mat === 'wood' ? 0x9c6b30 : mat === 'stone' ? 0x90909a : 0x5f7f9c, roughness: 0.9 });
}
function addStructureMesh(s) {
  if (G.structures.has(s.id)) return;
  let mesh;
  if (s.type === 'floor') mesh = new THREE.Mesh(new THREE.BoxGeometry(5, 0.35, 5), structMaterial(s.material));
  else if (s.type === 'ramp') { mesh = new THREE.Mesh(new THREE.BoxGeometry(5, 0.35, 7.3), structMaterial(s.material)); mesh.rotation.x = -Math.atan2(5, 7.3) + 0.0; mesh.rotation.x = -0.6; }
  else mesh = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 0.35), structMaterial(s.material));
  const grp = new THREE.Group();
  grp.add(mesh);
  grp.position.set(s.x, s.type === 'wall' ? s.y + 2.5 : s.y, s.z);
  if (s.type === 'ramp') { grp.position.y = s.y + 2.4; }
  grp.rotation.y = s.rotY || 0;
  mesh.castShadow = true; mesh.receiveShadow = true;
  G.scene.add(grp);
  G.structures.set(s.id, { mesh: grp, data: s });
}
function removeStructureMesh(id) {
  const s = G.structures.get(id);
  if (s) { G.scene.remove(s.mesh); G.structures.delete(id); }
}

function buildViewmodel(weaponId) {
  if (!G.viewmodel) return;
  while (G.viewmodel.children.length) G.viewmodel.remove(G.viewmodel.children[0]);
  G.vmWeapon = weaponId;
  const grp = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x23242e, roughness: 0.5, metalness: 0.4 });
  if (weaponId === 'pickaxe') {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.62), new THREE.MeshStandardMaterial({ color: 0x8a5a2b }));
    handle.rotation.x = 0.7;
    const headM = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.09, 0.09), new THREE.MeshStandardMaterial({ color: 0xb8c4d4, metalness: 0.7, roughness: 0.3 }));
    headM.position.set(0, 0.22, -0.14);
    grp.add(handle, headM);
  } else {
    const len = { pistol: 0.34, smg: 0.5, ar: 0.72, shotgun: 0.78, sniper: 1.0, lmg: 0.85 }[weaponId] || 0.6;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.15, len), dark);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3), dark);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.03, -len / 2 - 0.12);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.1), dark); mag.position.set(0, -0.15, 0.03); mag.rotation.x = 0.25;
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.12), dark); sight.position.y = 0.11;
    grp.add(body, barrel, mag, sight);
    if (weaponId === 'sniper') { const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.22), dark); scope.rotation.x = Math.PI / 2; scope.position.y = 0.14; grp.add(scope); }
  }
  grp.position.set(0.34, -0.34, -0.55);
  grp.rotation.y = 0.06;
  G.viewmodel.add(grp);
  G.viewmodel.visible = G.mode !== 'bus';
}

// ---------------- HUD ----------------
function slotItemHTML(s) {
  if (!s) return '';
  if (s.kind === 'weapon') return `<div class="ic">${WEAPON_ICONS[s.weaponId] || '🔫'}</div><div>${META ? META.weapons[s.weaponId].name.split(' ')[0] : s.weaponId}</div>`;
  const cnt = s.count > 1 ? `<span class="cnt">×${s.count}</span>` : '';
  return `<div class="ic">${ITEM_ICONS[s.itemId] || '🎁'}</div><div>${META ? META.items[s.itemId].name.split(' ')[0] : s.itemId}</div>${cnt}`;
}
function renderInventory() {
  const inv = G.self ? G.self.inventory : [null, null, null, null, null];
  $('inventory').innerHTML = inv.map((s, i) => `<div class="slot r${s && s.kind === 'weapon' ? (s.rarity || 0) : 0} ${i === G.slot ? 'sel' : ''}"><span class="key">${i + 1}</span>${slotItemHTML(s)}</div>`).join('');
  if (G.self) $('mats').innerHTML = `🪵 ${G.self.materials.wood} &nbsp; 🧱 ${G.self.materials.stone} &nbsp; 🔩 ${G.self.materials.metal}`;
  updateAmmoBox();
  const s = inv[G.slot];
  const wid = s && s.kind === 'weapon' ? s.weaponId : 'pickaxe';
  if (wid !== G.vmWeapon) buildViewmodel(wid);
}
function currentSlot() { return G.self && G.self.inventory[G.slot]; }
function updateAmmoBox() {
  const s = currentSlot();
  if (!s) { $('ammoMag').textContent = '—'; $('ammoReserve').textContent = ''; $('weaponName').textContent = 'Empty slot'; return; }
  if (s.kind === 'item') { $('ammoMag').textContent = 'USE'; $('ammoReserve').textContent = '×' + (s.count || 1); $('weaponName').textContent = META.items[s.itemId].name; return; }
  const def = META.weapons[s.weaponId];
  $('weaponName').textContent = def.name + (s.rarity ? ' · ' + RARITY_NAMES[s.rarity] : '');
  if (s.weaponId === 'pickaxe') { $('ammoMag').textContent = '∞'; $('ammoReserve').textContent = ''; }
  else { $('ammoMag').textContent = s.mag; const at = AMMO_FOR[s.weaponId]; $('ammoReserve').textContent = '/ ' + G.self.ammo[at] + ' ' + AMMO_NAMES[at]; }
}
function showNotice(msg, bg) {
  const n = $('notice'); n.textContent = msg; n.style.background = bg || '#7d1d1d';
  n.classList.remove('hidden'); clearTimeout(showNotice._t);
  showNotice._t = setTimeout(() => n.classList.add('hidden'), 2400);
}
function flashHitmarker(h) {
  const el = $('hitmarker');
  el.textContent = h.headshot ? '💥' : '✕';
  el.style.color = h.headshot ? '#ff5252' : '#ffd23f';
  el.style.opacity = 1; clearTimeout(flashHitmarker._t);
  flashHitmarker._t = setTimeout(() => el.style.opacity = 0, 130);
}
function addKillfeed(k) {
  const div = document.createElement('div');
  div.textContent = k.killer ? `⚔️ ${k.killer} eliminated ${k.victim} (${k.weapon})` : `🌩️ ${k.victim} was lost to the storm`;
  $('killfeed').prepend(div);
  while ($('killfeed').children.length > 6) $('killfeed').lastChild.remove();
  setTimeout(() => div.remove(), 5200);
}
let useStart = 0, useDur = 0;
function startUseBar(ms) { useStart = performance.now(); useDur = ms; $('usingBox').classList.remove('hidden'); }

function endMatch(won, d) {
  if (G.ended) return;
  G.ended = true; G.active = false;
  document.exitPointerLock && document.exitPointerLock();
  $('hud').classList.add('hidden');
  show('endScreen');
  $('endTitle').textContent = won ? '#1 VICTORY ROYALE! 👑' : '#' + (d.placement || '?');
  $('endSub').textContent = won ? `You outlasted everyone${d.winner ? '' : ''}! +50 V-Bucks bonus` : (d.winner ? `Winner: ${d.winner}` : 'You were eliminated');
  $('endStats').innerHTML = [
    ['Eliminations', G.self ? G.self.kills : (d.kills ?? '—')],
    ['Damage dealt', d.damage ?? '—'],
    ['Placement', (d.placement || '?') + ' / ' + (G.data ? G.data.totalFighters : 24)],
  ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  playTone(won ? 880 : 220, 0.4, 0.1, 'triangle');
  if (won) setTimeout(() => playTone(1320, 0.5, 0.1, 'triangle'), 250);
}
$('btnBackLobby').onclick = () => location.reload();

// ---------------- snapshots / remotes ----------------
function onSnapshot(snap) {
  G.aliveCount = snap.aliveCount;
  G.busPos = snap.bus;
  G.storm = snap.storm;
  $('aliveInfo').textContent = '👥 ' + snap.aliveCount;
  $('stormInfo').textContent = snap.storm.state === 'shrinking' ? `🌩️ Storm shrinking! (${snap.storm.dps}/s)` : snap.phase === 'bus' ? '🚌 Battle Bus incoming…' : `⛈️ Storm shrinks in ${snap.storm.timer}s`;
  const sun = G.scene.getObjectByName('sun');
  // bus
  if (G.busGroup) { G.busGroup.position.set(snap.bus.x, snap.bus.y + 6, snap.bus.z); G.busGroup.visible = snap.phase === 'bus'; }
  // storm wall
  if (G.stormWall) {
    G.stormWall.wall.position.x = snap.storm.cx; G.stormWall.wall.position.z = snap.storm.cz;
    G.stormWall.wall.scale.set(Math.max(1, snap.storm.radius), 1, Math.max(1, snap.storm.radius));
  }
  const seen = new Set();
  for (const p of snap.players) {
    seen.add(p.id);
    if (p.id === G.myId) {
      // sync HUD vitals
      $('healthBar').style.width = Math.max(0, p.hp) + '%'; $('healthText').textContent = Math.max(0, p.hp);
      $('shieldBar').style.width = Math.max(0, p.sh) + '%'; $('shieldText').textContent = Math.max(0, p.sh);
      if (G.mode === 'bus' && !p.bus) G.mode = 'skydiving';
      if (p.bus) { G.pos.set(p.x, p.y, p.z); }
      if (sun) { sun.position.set(G.pos.x + 400, G.pos.y + 700, G.pos.z + 250); sun.target.position.copy(G.pos); }
      continue;
    }
    let r = G.remotes.get(p.id);
    if (!r) {
      const mesh = makeCharacter(p.color, p.u);
      G.scene.add(mesh);
      r = { mesh, target: new THREE.Vector3(p.x, p.y, p.z), yaw: p.yaw, alive: true };
      G.remotes.set(p.id, r);
    }
    r.target.set(p.x, p.y, p.z); r.yawTarget = p.yaw; r.pitch = p.pitch;
    r.mesh.visible = !p.bus;
    r.mesh.userData.glider.visible = !!p.glide;
    r.mesh.userData.gun.rotation.x = -(p.pitch || 0);
    const wid = p.weapon;
    if (r.weapon !== wid) { r.weapon = wid; }
  }
  for (const [id, r] of G.remotes) {
    if (!seen.has(id)) { G.scene.remove(r.mesh); G.remotes.delete(id); }
  }
}

// ---------------- tracers ----------------
function spawnTracer(t) {
  if (!G.scene) return;
  const from = new THREE.Vector3(t.from.x, t.from.y, t.from.z);
  const to = new THREE.Vector3(t.to.x, t.to.y, t.to.z);
  if (from.distanceTo(G.camera.position) > 400) return;
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: t.weaponId === 'sniper' ? 0xffe082 : 0xffc46b, transparent: true, opacity: 0.9 }));
  G.scene.add(line);
  G.tracers.push({ line, ttl: 0.07 });
  if (t.shooter !== G.myId && from.distanceTo(G.camera.position) < 90) playNoise(0.06, 1400, 0.05);
}

// ---------------- physics helpers ----------------
function groundAt(x, z) {
  let g = terrainHeight(x, z);
  if (G.world) for (const c of G.world.colliders) {
    if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ) g = Math.max(g, c.maxY);
  }
  for (const { data: s } of G.structures.values()) {
    if (s.type === 'floor' && Math.abs(x - s.x) < 2.5 && Math.abs(z - s.z) < 2.5) g = Math.max(g, s.y + 0.2);
    if (s.type === 'ramp') {
      const dx = x - s.x, dz = z - s.z;
      const cos = Math.cos(-(s.rotY || 0)), sin = Math.sin(-(s.rotY || 0));
      const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
      if (Math.abs(lx) < 2.5 && Math.abs(lz) < 3.6) g = Math.max(g, s.y + ((lz + 3.6) / 7.2) * 4.6);
    }
  }
  return g;
}
function horizontalCollide(prev) {
  if (!G.world) return;
  const r = 0.65;
  for (const c of G.world.colliders) {
    if (G.pos.x > c.minX - r && G.pos.x < c.maxX + r && G.pos.z > c.minZ - r && G.pos.z < c.maxZ + r) {
      if (G.pos.y < c.maxY - 0.6 && G.pos.y + 1.8 > c.minY) {
        // push out on smallest axis (only if we weren't already on top)
        if (prev.y >= c.maxY - 0.6) continue;
        const pushL = G.pos.x - (c.minX - r), pushR = (c.maxX + r) - G.pos.x;
        const pushB = G.pos.z - (c.minZ - r), pushF = (c.maxZ + r) - G.pos.z;
        const m = Math.min(pushL, pushR, pushB, pushF);
        if (m === pushL) G.pos.x = c.minX - r; else if (m === pushR) G.pos.x = c.maxX + r;
        else if (m === pushB) G.pos.z = c.minZ - r; else G.pos.z = c.maxZ + r;
      }
    }
  }
}

// ---------------- input ----------------
addEventListener('keydown', (e) => {
  G.keys[e.code] = true;
  if (!G.active) return;
  if (e.code === 'Space') e.preventDefault();
  if (G.mode === 'bus' && (e.code === 'KeyF' || e.code === 'Space')) { socket.emit('jump'); }
  if (G.mode === 'skydiving' && e.code === 'Space' && !G.gliding) { G.gliding = true; }
  if (e.code.startsWith('Digit')) {
    const n = parseInt(e.code.slice(5)) - 1;
    if (n >= 0 && n < 5) { G.slot = n; socket.emit('setSlot', n); renderInventory(); }
  }
  if (e.code === 'KeyR') socket.emit('reload');
  if (e.code === 'KeyE') tryPickup();
  if (e.code === 'KeyQ') { G.buildMode = !G.buildMode; $('buildBox').classList.toggle('hidden', !G.buildMode); G.ghost.visible = false; }
  if (G.buildMode && e.code === 'KeyF') {
    G.buildType = G.buildType === 'wall' ? 'floor' : G.buildType === 'floor' ? 'ramp' : 'wall';
    $('buildType').textContent = G.buildType[0].toUpperCase() + G.buildType.slice(1);
  }
  if (G.buildMode && e.code === 'KeyX') {
    G.buildMat = G.buildMat === 'wood' ? 'stone' : G.buildMat === 'stone' ? 'metal' : 'wood';
    $('buildMat').textContent = G.buildMat;
  }
});
addEventListener('keyup', (e) => { G.keys[e.code] = false; });
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement && G.active && G.mode !== 'bus') {
    G.yaw -= e.movementX * 0.0021;
    G.pitch -= e.movementY * 0.0021;
    G.pitch = Math.max(-1.45, Math.min(1.45, G.pitch));
  }
});
document.addEventListener('mousedown', (e) => {
  if (!G.active) return;
  if (G.mode !== 'bus' && !document.pointerLockElement) { tryLock(); return; }
  if (e.button === 0) { G.mouseDown = true; G.clicked = true; }
});
document.addEventListener('mouseup', (e) => { if (e.button === 0) G.mouseDown = false; });
function tryLock() {
  const el = G.renderer && G.renderer.domElement;
  if (el && !document.pointerLockElement) {
    try { const p = el.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch {}
  }
}
document.addEventListener('pointerlockchange', () => { if (G.viewmodel) G.viewmodel.visible = !!document.pointerLockElement || G.mode !== 'bus'; });

function tryPickup() {
  let best = null, bd = 25;
  for (const [id, grp] of G.loot) {
    const d = grp.position.distanceTo(G.pos);
    if (d < bd) { bd = d; best = grp.userData.item; }
  }
  if (best) { socket.emit('pickup', best.id); playTone(900, 0.05, 0.05); }
}

// ---------------- main loop ----------------
let lastT = performance.now();
function loop(now) {
  if (!G.active && !G.ended) return;
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  const t = now / 1000;
  if (G.skyMat) G.skyMat.uniforms.uTime.value = t;
  if (G.waterMat) G.waterMat.uniforms.uTime.value = t;
  if (G.stormWall) G.stormWall.mat.uniforms.uTime.value = t;

  // ----- local movement -----
  const camDir = new THREE.Vector3();
  G.camera.getWorldDirection(camDir);
  const fwd = new THREE.Vector3(camDir.x, 0, camDir.z).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
  const move = new THREE.Vector3();
  if (G.keys.KeyW) move.add(fwd);
  if (G.keys.KeyS) move.sub(fwd);
  if (G.keys.KeyD) move.add(right);
  if (G.keys.KeyA) move.sub(right);

  const prev = G.pos.clone();
  if (G.mode === 'bus') {
    // cinematic bus camera
    const bp = G.busPos;
    const orbit = t * 0.08;
    G.camera.position.set(bp.x + Math.cos(orbit) * 42, bp.y + 16, bp.z + Math.sin(orbit) * 42);
    G.camera.lookAt(bp.x, bp.y, bp.z);
    if (G.viewmodel) G.viewmodel.visible = false;
  } else if (G.mode === 'skydiving') {
    const ground = groundAt(G.pos.x, G.pos.z);
    if (!G.gliding && G.pos.y < ground + 55) G.gliding = true;
    const fallSpeed = G.gliding ? -7 : -52;
    const hSpeed = G.gliding ? 17 : 13;
    if (move.lengthSq() > 0) { move.normalize(); G.pos.addScaledVector(move, hSpeed * dt); G.yaw = Math.atan2(-move.x, -move.z); }
    else if (G.gliding) { const f = new THREE.Vector3(-Math.sin(G.yaw), 0, -Math.cos(G.yaw)); G.pos.addScaledVector(f, hSpeed * 0.7 * dt); }
    G.pos.y += fallSpeed * dt;
    if (G.pos.y <= ground) { G.pos.y = ground; G.mode = 'ground'; G.gliding = false; playNoise(0.12, 400, 0.1); }
    G.camera.position.set(G.pos.x, G.pos.y + 1.62, G.pos.z);
    G.camera.rotation.order = 'YXZ'; G.camera.rotation.set(G.pitch, G.yaw, 0);
    if (G.viewmodel) G.viewmodel.visible = true;
  } else {
    // ground movement
    const sprint = G.keys.ShiftLeft || G.keys.ShiftRight;
    const crouch = G.keys.ControlLeft || G.keys.KeyC;
    const speed = crouch ? 3.4 : sprint ? 10.5 : 6.8;
    if (move.lengthSq() > 0) { move.normalize(); G.pos.addScaledVector(move, speed * dt); }
    const ground = Math.max(groundAt(G.pos.x, G.pos.z), WATER_Y - 0.4);
    G.velY -= 24 * dt;
    G.pos.y += G.velY * dt;
    if (G.pos.y <= ground) {
      if (!G.onGround && G.velY < -16) playNoise(0.08, 300, 0.06);
      G.pos.y = ground; G.velY = 0; G.onGround = true;
    } else if (G.pos.y > ground + 0.05) G.onGround = false;
    if (G.onGround && G.keys.Space) { G.velY = 8.6; G.onGround = false; G.pos.y += 0.1; }
    horizontalCollide(prev);
    G.camera.position.set(G.pos.x, G.pos.y + (crouch ? 1.25 : 1.62), G.pos.z);
    G.camera.rotation.order = 'YXZ'; G.camera.rotation.set(G.pitch, G.yaw, 0);
    if (G.viewmodel) G.viewmodel.visible = true;
    // head bob
    if (move.lengthSq() > 0 && G.onGround) G.camera.position.y += Math.sin(t * (sprint ? 13 : 10)) * 0.045;
  }

  // swimming slowdown is implicit via water ground clamp

  // ----- combat / building -----
  const slotItem = currentSlot();
  if (G.mouseDown || G.clicked) {
    if (G.buildMode && G.clicked && G.ghost.visible) {
      socket.emit('build', { type: G.buildType, x: G.ghost.position.x, y: G.buildType === 'wall' ? G.ghost.position.y - 2.5 : G.ghost.position.y, z: G.ghost.position.z, rotY: Math.round(G.yaw / (Math.PI / 2)) * (Math.PI / 2), material: G.buildMat });
      playNoise(0.05, 900, 0.07);
    } else if (slotItem && slotItem.kind === 'item' && G.clicked) {
      socket.emit('useItem', G.slot);
    } else if (slotItem && slotItem.kind === 'weapon') {
      const def = META.weapons[slotItem.weaponId];
      const isMelee = def.type === 'melee';
      const canFire = isMelee ? (now - G.lastShot > 330) : def.auto ? (now - G.lastShot > def.fireRate) : (G.clicked && now - G.lastShot > def.fireRate);
      if (canFire && G.mode === 'ground') {
        G.lastShot = now;
        const dir = new THREE.Vector3(); G.camera.getWorldDirection(dir);
        const origin = G.camera.position.clone();
        if (isMelee) { socket.emit('melee', { dir: { x: dir.x, y: dir.y, z: dir.z }, origin: { x: origin.x, y: origin.y, z: origin.z } }); G.swingAt = now; playNoise(0.05, 2500, 0.04); }
        else {
          if (slotItem.mag <= 0) { socket.emit('reload'); }
          else {
            socket.emit('shoot', { dir: { x: dir.x, y: dir.y, z: dir.z }, origin: { x: origin.x, y: origin.y, z: origin.z } });
            playNoise(slotItem.weaponId === 'sniper' ? 0.22 : 0.09, slotItem.weaponId === 'shotgun' ? 700 : 1600, slotItem.weaponId === 'sniper' ? 0.2 : 0.1);
            G.pitch += slotItem.weaponId === 'sniper' ? 0.012 : 0.0035;
            if (G.viewmodel) G.viewmodel.position.z = 0.09;
          }
        }
      }
    }
  }
  G.clicked = false;
  if (G.viewmodel) {
    G.viewmodel.position.z += (0 - G.viewmodel.position.z) * 0.35;
    const sinceSwing = now - G.swingAt;
    G.viewmodel.rotation.x = sinceSwing < 330 ? -Math.sin((sinceSwing / 330) * Math.PI) * 1.1 : 0;
  }

  // build ghost
  if (G.buildMode && G.mode === 'ground') {
    const dir = new THREE.Vector3(); G.camera.getWorldDirection(dir);
    const tx = G.pos.x + dir.x * 6, tz = G.pos.z + dir.z * 6;
    const sx = Math.round(tx / 5) * 5, sz = Math.round(tz / 5) * 5;
    const gy = groundAt(sx, sz);
    G.ghost.visible = true;
    G.ghost.scale.set(1, G.buildType === 'wall' ? 1 : 0.07, G.buildType === 'floor' ? 14.3 : G.buildType === 'ramp' ? 20 : 0.07);
    G.ghost.position.set(sx, G.buildType === 'wall' ? gy + 2.5 : gy + 0.2, sz);
    G.ghost.rotation.set(G.buildType === 'ramp' ? -0.6 : 0, Math.round(G.yaw / (Math.PI / 2)) * (Math.PI / 2), 0);
    const canAfford = G.self && G.self.materials[G.buildMat] >= 10;
    G.ghost.material.color.set(canAfford ? 0x37d67a : 0xff5252);
  } else if (G.ghost) G.ghost.visible = false;

  // loot animation + prompt
  let nearestLoot = null, nd = 1e9;
  for (const grp of G.loot.values()) {
    grp.rotation.y += dt * 1.6;
    grp.userData.base.position.y = 0.55 + Math.sin(t * 2.4 + grp.position.x) * 0.16;
    if (grp.userData.beam.material.uniforms) grp.userData.beam.material.uniforms.uTime.value = t;
    const d = grp.position.distanceTo(G.pos);
    if (d < nd) { nd = d; nearestLoot = grp; }
  }
  if (nearestLoot && nd < 5 && G.mode === 'ground') {
    const it = nearestLoot.userData.item;
    const label = it.kind === 'weapon' ? `${RARITY_NAMES[it.rarity || 0]} ${META.weapons[it.weaponId].name}` : META.items[it.itemId].name;
    const pr = $('prompt'); pr.innerHTML = `[E] Pick up <b style="color:${it.kind === 'weapon' ? RARITY_COLORS[it.rarity || 0] : '#ffe082'}">${label}</b>`;
    pr.classList.remove('hidden');
  } else $('prompt').classList.add('hidden');

  // remotes interpolation
  for (const r of G.remotes.values()) {
    r.mesh.position.lerp(r.target, 0.38);
    if (r.yawTarget !== undefined) {
      let dy = r.yawTarget - (r.mesh.rotation.y || 0);
      while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      r.mesh.rotation.y += dy * 0.4;
    }
  }

  // tracers fade
  for (let i = G.tracers.length - 1; i >= 0; i--) {
    const tr = G.tracers[i]; tr.ttl -= dt;
    tr.line.material.opacity = Math.max(0, tr.ttl / 0.07) * 0.9;
    if (tr.ttl <= 0) { G.scene.remove(tr.line); tr.line.geometry.dispose(); G.tracers.splice(i, 1); }
  }

  // use bar
  if (useDur) {
    const p = (performance.now() - useStart) / useDur;
    $('useBar').style.width = Math.min(100, p * 100) + '%';
    if (p >= 1) { useDur = 0; $('usingBox').classList.add('hidden'); }
  }

  // compass
  const dir2 = new THREE.Vector3(); G.camera.getWorldDirection(dir2);
  const bearing = ((Math.atan2(dir2.x, -dir2.z) * 180 / Math.PI) + 360) % 360;
  const card = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(bearing / 45) % 8];
  $('compass').textContent = `${card} ${Math.round(bearing)}°`;

  // send movement @ 20Hz
  if (socket && now - G.lastMoveSend > 50 && G.mode !== 'bus') {
    G.lastMoveSend = now;
    socket.emit('move', { x: +G.pos.x.toFixed(2), y: +G.pos.y.toFixed(2), z: +G.pos.z.toFixed(2), yaw: +G.yaw.toFixed(3), pitch: +G.pitch.toFixed(3), skydiving: G.mode === 'skydiving', gliding: G.gliding, onGround: G.onGround });
  }

  // minimap @ 5Hz
  if (now - G.lastMinimap > 200) { G.lastMinimap = now; drawMinimap(); }

  if (G.renderer && G.scene) G.renderer.render(G.scene, G.camera);
}

function drawMinimap() {
  const cv = $('minimap'); if (!cv || !G.data) return;
  const ctx = cv.getContext('2d');
  const S = cv.width, W2C = S / 4000;
  ctx.fillStyle = '#69a83f'; ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#2f7fd0';
  ctx.fillRect(0, 0, S, 14); ctx.fillRect(0, S - 14, S, 14); ctx.fillRect(0, 0, 14, S); ctx.fillRect(S - 14, 0, 14, S);
  ctx.fillStyle = '#00000033';
  for (const p of G.data.pois) ctx.fillRect((p.x + 2000) * W2C - 2, (p.z + 2000) * W2C - 2, 4, 4);
  // storm
  ctx.strokeStyle = '#c86bff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc((G.storm.cx + 2000) * W2C, (G.storm.cz + 2000) * W2C, Math.max(2, G.storm.radius * W2C), 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = 'rgba(150,60,255,0.18)';
  ctx.beginPath(); ctx.arc((G.storm.cx + 2000) * W2C, (G.storm.cz + 2000) * W2C, Math.max(2, G.storm.radius * W2C), 0, Math.PI * 2); ctx.fill();
  // players
  for (const r of G.remotes.values()) {
    ctx.fillStyle = '#ff5252';
    ctx.fillRect((r.target.x + 2000) * W2C - 2, (r.target.z + 2000) * W2C - 2, 4, 4);
  }
  // me
  const mx = (G.pos.x + 2000) * W2C, mz = (G.pos.z + 2000) * W2C;
  ctx.fillStyle = '#ffd23f';
  ctx.beginPath(); ctx.arc(mx, mz, 4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.stroke();
  ctx.fillStyle = '#ffd23f';
  ctx.beginPath();
  ctx.moveTo(mx, mz); ctx.lineTo(mx + Math.sin(-G.yaw) * -10, mz + Math.cos(-G.yaw) * -10);
  ctx.strokeStyle = '#ffd23f'; ctx.stroke();
}

// ---------------- boot ----------------
(async function boot() {
  try {
    const meta = await fetch('/api/meta').then(r => r.json());
    META = { weapons: meta.weapons, items: meta.items };
  } catch {}
  if (token) {
    try {
      const { user } = await api('/api/me');
      currentUser = user;
      connectSocket();
      await refreshLobby();
      show('lobbyScreen');
      return;
    } catch { localStorage.removeItem('fortworld_token'); token = null; }
  }
  show('authScreen');
})();
