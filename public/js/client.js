// FortWorld client: auth, lobby, shop, FPS gameplay, building, HUD.
import * as THREE from 'three';
import { terrainHeight, createSky, createWater, createStormWall, lootBeamMaterial, buildWorld, hideNode, WATER_Y, structureMaterial, getGlowTexture, MOUNTAINS } from './world.js';

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

// ---------------- settings & quality ----------------
const QUALITY_PRESETS = {
  cinematic: { pixelRatio: Math.min(devicePixelRatio || 1, 2), shadow: 2048, grass: 46000, seg: 320, aniso: 8 },
  balanced: { pixelRatio: Math.min(devicePixelRatio || 1, 1.5), shadow: 1024, grass: 22000, seg: 224, aniso: 4 },
  performance: { pixelRatio: 1, shadow: 512, grass: 7000, seg: 160, aniso: 2 },
};
const HAS_TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0;
let SETTINGS = { quality: 'auto', touch: 'auto', sens: 1, vol: 80, invert: false, fps: false, post: 'auto' };
try { Object.assign(SETTINGS, JSON.parse(localStorage.getItem('fw_settings') || '{}')); } catch {}
function saveSettings() { localStorage.setItem('fw_settings', JSON.stringify(SETTINGS)); }
function resolvedQualityName() {
  if (SETTINGS.quality !== 'auto') return SETTINGS.quality;
  return HAS_TOUCH ? 'balanced' : 'cinematic';
}
function qualityPreset() { return QUALITY_PRESETS[resolvedQualityName()]; }
function touchEnabled() { return SETTINGS.touch === 'on' || (SETTINGS.touch === 'auto' && HAS_TOUCH); }
function applyTouchClass() {
  document.body.classList.toggle('touch', touchEnabled());
}
applyTouchClass();
function syncSettingsUI() {
  for (const id of ['qualitySelect', 'setQuality']) { const el = $(id); if (el) el.value = SETTINGS.quality; }
  for (const id of ['touchSelect', 'setTouch']) { const el = $(id); if (el) el.value = SETTINGS.touch; }
  if ($('setPost')) $('setPost').value = SETTINGS.post;
  if ($('setSens')) { $('setSens').value = SETTINGS.sens; $('sensVal').textContent = Number(SETTINGS.sens).toFixed(1) + '×'; }
  if ($('setVol')) { $('setVol').value = SETTINGS.vol; $('volVal').textContent = SETTINGS.vol + '%'; }
  if ($('setInvert')) $('setInvert').checked = !!SETTINGS.invert;
  if ($('setFps')) $('setFps').checked = !!SETTINGS.fps;
  $('fpsBox').classList.toggle('hidden', !SETTINGS.fps);
  applyTouchClass();
}
function applyLiveSettings() {
  saveSettings(); syncSettingsUI();
  if (MASTER) MASTER.gain.value = SETTINGS.vol / 100 * 0.9;
  if (G.renderer) {
    const cap = qualityPreset().pixelRatio;
    G.renderer.setPixelRatio(Math.min(cap, G.dynRatio || cap));
  }
}

// ---------------- audio (procedural synth, no assets) ----------------
let AC = null, MASTER = null;
function audio() {
  if (!AC) {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    MASTER = AC.createGain(); MASTER.gain.value = SETTINGS.vol / 100 * 0.9;
    MASTER.connect(AC.destination);
  }
  if (AC.state === 'suspended') AC.resume();
  return AC;
}
function playNoise(dur = 0.08, freq = 1800, vol = 0.12) {
  try {
    const ac = audio(); const len = ac.sampleRate * dur;
    const buf = ac.createBuffer(1, len, ac.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ac.createBufferSource(); src.buffer = buf;
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = ac.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(MASTER || ac.destination); src.start();
  } catch {}
}
// layered gunshot: crack + body thump, tuned per weapon class
function playShot(kind = 'ar', distant = false) {
  try {
    const ac = audio();
    const t = ac.currentTime;
    const len = ac.sampleRate * (kind === 'sniper' ? 0.28 : 0.13);
    const buf = ac.createBuffer(1, len, ac.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.6);
    const src = ac.createBufferSource(); src.buffer = buf;
    const f = ac.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.value = distant ? 420 : (kind === 'shotgun' || kind === 'sniper' ? 2400 : 3400);
    const g = ac.createGain(); g.gain.value = distant ? 0.05 : (kind === 'shotgun' || kind === 'sniper' ? 0.34 : 0.2);
    src.connect(f); f.connect(g); g.connect(MASTER);
    const o = ac.createOscillator(), og = ac.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(kind === 'pistol' ? 150 : 110, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.11);
    og.gain.setValueAtTime(distant ? 0.02 : 0.22, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    o.connect(og); og.connect(MASTER);
    src.start(); o.start(); o.stop(t + 0.15);
  } catch {}
}
let stepFlip = false;
function playStep(run) {
  stepFlip = !stepFlip;
  playNoise(0.045, stepFlip ? 500 : 380, run ? 0.05 : 0.032);
}
function playTone(freq, dur = 0.07, vol = 0.08, type = 'square') {
  try {
    const ac = audio(); const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = freq; g.gain.setValueAtTime(vol, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    o.connect(g); g.connect(MASTER || ac.destination); o.start(); o.stop(ac.currentTime + dur);
  } catch {}
}

// ---------------- ambience: wind, birdsong & menu music (all procedural) ----------------
let AMB = null;
function startAmbience() {
  try {
    const ac = audio(); // also resumes the context (must be inside a user gesture first time)
    if (AMB || !AC) return;
    // looping brown-ish noise -> wind
    const len = ac.sampleRate * 2;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.03 * w) / 1.03; d[i] = last * 4.2; }
    const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
    const filt = ac.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 420; filt.Q.value = 0.4;
    const windGain = ac.createGain(); windGain.gain.value = 0;
    src.connect(filt); filt.connect(windGain); windGain.connect(MASTER);
    src.start();
    // slow weather LFOs on the wind
    const lfo1 = ac.createOscillator(), lfo1g = ac.createGain();
    lfo1.frequency.value = 0.07; lfo1g.gain.value = 130; lfo1.connect(lfo1g); lfo1g.connect(filt.frequency); lfo1.start();
    const lfo2 = ac.createOscillator(), lfo2g = ac.createGain();
    lfo2.frequency.value = 0.045; lfo2g.gain.value = 0.05; lfo2.connect(lfo2g); lfo2g.connect(windGain.gain); lfo2.start();
    const musicFilter = ac.createBiquadFilter(); musicFilter.type = 'lowpass'; musicFilter.frequency.value = 780;
    const musicOut = ac.createGain(); musicOut.gain.value = 0.9;
    musicFilter.connect(musicOut); musicOut.connect(MASTER);
    AMB = { windGain, musicFilter, nextChord: 0, chordIdx: 0, timer: null };
    AMB.timer = setInterval(ambienceTick, 650);
  } catch {}
}
const MENU_CHORDS = [
  [130.81, 196.00, 261.63, 329.63], // Cmaj7
  [110.00, 164.81, 220.00, 261.63], // Am7
  [87.31, 130.81, 174.61, 220.00],  // Fmaj7
  [98.00, 146.83, 196.00, 246.94],  // G
];
function playMenuChord(idx) {
  try {
    const ac = AC, t = ac.currentTime;
    const notes = MENU_CHORDS[idx % MENU_CHORDS.length];
    notes.forEach((f, i) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'triangle'; o.frequency.value = f; o.detune.value = (i - 1.5) * 3;
      g.gain.setValueAtTime(0, t + i * 0.06);
      g.gain.linearRampToValueAtTime(0.034, t + i * 0.06 + 1.1);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 3.5);
      o.connect(g); g.connect(AMB.musicFilter);
      o.start(t + i * 0.06); o.stop(t + 3.6);
    });
    // soft sparkle note on top
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine'; o.frequency.value = notes[1 + (idx % 3)] * 2;
    g.gain.setValueAtTime(0, t + 1.7);
    g.gain.linearRampToValueAtTime(0.011, t + 2.0);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 3.2);
    o.connect(g); g.connect(AMB.musicFilter);
    o.start(t + 1.7); o.stop(t + 3.3);
  } catch {}
}
function birdChirp() {
  try {
    const ac = AC, t0 = ac.currentTime + 0.03;
    const pan = ac.createStereoPanner ? ac.createStereoPanner() : null;
    const out = ac.createGain(); out.gain.value = 0.8;
    if (pan) { pan.pan.value = Math.random() * 1.2 - 0.6; out.connect(pan); pan.connect(MASTER); } else out.connect(MASTER);
    const n = 2 + Math.floor(Math.random() * 2);
    const base = 2350 + Math.random() * 700;
    for (let k = 0; k < n; k++) {
      const o = ac.createOscillator(), g = ac.createGain();
      const s = t0 + k * 0.15;
      o.type = 'sine';
      o.frequency.setValueAtTime(base, s);
      o.frequency.exponentialRampToValueAtTime(base * 1.28, s + 0.05);
      o.frequency.exponentialRampToValueAtTime(base * 0.94, s + 0.1);
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.038, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, s + 0.11);
      o.connect(g); g.connect(out);
      o.start(s); o.stop(s + 0.13);
    }
  } catch {}
}
function ambienceTick() {
  if (!AMB || !AC || AC.state !== 'running') return;
  let wind = 0.05;
  if (!G.active) wind = 0.10;
  else if (G.mode === 'skydiving') wind = G.gliding ? 0.34 : 0.5;
  else if (G.mode === 'bus') wind = 0.22;
  else wind = 0.12 + Math.min(0.2, Math.max(0, G.pos ? G.pos.y : 0) * 0.0011);
  AMB.windGain.gain.setTargetAtTime(wind, AC.currentTime, 0.8);
  // birds sing outdoors (menus + on the ground), never mid-fight chaos
  const outdoors = !G.active || G.mode === 'ground';
  if (outdoors && Math.random() < 0.34) birdChirp();
  // menu music only outside matches
  if (!G.active && AC.currentTime >= AMB.nextChord) { playMenuChord(AMB.chordIdx++); AMB.nextChord = AC.currentTime + 3.6; }
}
// Browsers only unlock audio inside a gesture — (re)start on every interaction.
['pointerdown', 'keydown', 'touchstart'].forEach(ev => addEventListener(ev, () => { try { startAmbience(); } catch {} }, { passive: true }));
// soft UI click on any menu button
document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('.btn, .ltab, .auth-tabs button')) playTone(690, 0.035, 0.022, 'sine'); });

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
  startMenuScene();
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
  SKINS_BY_ID = {}; for (const sk of skins) SKINS_BY_ID[sk.id] = sk;
  updateMenuChar();
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
  socket.on('lootUpdate', (u) => {
    if (!G.active) return;
    (u.removed || []).forEach(id => {
      const grp = G.loot.get(id);
      if (grp && G.particles && grp.position.distanceTo(G.pos) < 7) G.particles.burst(grp.position.clone().setY(grp.position.y + 1), 0xffd94d, 16, 5, 0.6, -3);
      removeLootMesh(id);
    });
    (u.added || []).forEach(addLootMesh);
  });
  socket.on('structurePlaced', (s) => { if (G.active) { addStructureMesh(s); if (G.particles) G.particles.burst(new THREE.Vector3(s.x, s.y + 1, s.z), 0x9adcff, 10, 4, 0.4, -2); } });
  socket.on('structureRemoved', (d) => { if (G.active) removeStructureMesh(d.id); });
  socket.on('nodeGone', (d) => { if (G.world) hideNode(G.world, G.data, d.type, d.index); });
  socket.on('nodeHit', () => { if (G.active && G.particles) { const f = new THREE.Vector3(); G.camera.getWorldDirection(f); G.particles.burst(G.pos.clone().addScaledVector(f, 3).setY(G.pos.y + 1.2), 0xa9743a, 7, 4, 0.4, -6); } });
  socket.on('playerDied', (d) => {
    if (!G.active) return;
    const r = G.remotes.get(d.id);
    if (r && G.particles) G.particles.burst(r.mesh.position.clone().setY(r.mesh.position.y + 1.4), 0xff5e5e, 42, 9, 0.9, -4);
    if (HAS_TOUCH && navigator.vibrate && d.id === G.myId) navigator.vibrate(120);
  });
  socket.on('tracer', (t) => { if (G.active) spawnTracer(t); });
  socket.on('hitmarker', (h) => {
    flashHitmarker(h); spawnDamageNum(h);
    playTone(h.headshot ? 1250 : 720, 0.05, 0.06);
    if (HAS_TOUCH && navigator.vibrate) navigator.vibrate(12);
  });
  socket.on('youTookDamage', (d) => {
    const v = $('damageVignette'); v.style.opacity = 1; setTimeout(() => v.style.opacity = 0, 170);
    G.camShake = Math.min(0.5, G.camShake + 0.16);
    playNoise(0.05, 500, 0.08);
    if (d) document.body.classList.toggle('lowhp', d.health <= 30 && d.health > 0);
  });
  socket.on('killfeed', (k) => addKillfeed(k));
  socket.on('youGotKill', (k) => {
    showKillBanner(k.victim); playTone(990, 0.12, 0.09, 'triangle');
    setTimeout(() => playTone(1320, 0.16, 0.09, 'triangle'), 90);
  });
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
  ads: false, vmKick: 0, camShake: 0, landDip: 0, stepAcc: 0, stepPhase: 0,
  particles: null, sunSprite: null, minimapBase: null, dynRatio: 0, fpsEMA: 60, fpsTimer: 0, frameCount: 0,
  reloadUntil: 0, hpCache: 100, wasOnGround: true, burstAcc: 0,
  // REBORN: third-person + menu scene + slide
  thirdPerson: true, selfMesh: null, selfPhase: 0, lastSelfPos: null, camSmooth: null,
  slideUntil: 0, slideReady: 0, slideDir: null, muzzleLight: null, menuScene: null, menuCamera: null, menuChar: null, menuRAF: 0,
};
let SKINS_BY_ID = {};

// ---------------- particles (single pooled THREE.Points) ----------------
class ParticlePool {
  constructor(scene, cap = 1600) {
    this.cap = cap; this.cursor = 0;
    this.pos = new Float32Array(cap * 3); this.col = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3); this.life = new Float32Array(cap); this.maxLife = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    for (let i = 0; i < cap; i++) this.pos[i * 3 + 1] = -9999;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.42, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, map: getGlowTexture(), blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.c = new THREE.Color();
  }
  burst(p, hex, count = 12, speed = 6, life = 0.55, grav = -5, spreadY = 0.9) {
    this.c.set(hex);
    for (let n = 0; n < count; n++) {
      const i = this.cursor; this.cursor = (this.cursor + 1) % this.cap;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.3) * spreadY;
      const s = speed * (0.3 + Math.random() * 0.9);
      this.vel[i * 3] = Math.cos(a) * s; this.vel[i * 3 + 1] = e * s + speed * 0.25; this.vel[i * 3 + 2] = Math.sin(a) * s;
      const v = 0.65 + Math.random() * 0.5;
      this.col[i * 3] = this.c.r * v; this.col[i * 3 + 1] = this.c.g * v; this.col[i * 3 + 2] = this.c.b * v;
      this.life[i] = this.maxLife[i] = life * (0.5 + Math.random() * 0.8);
      this.grav[i] = grav;
    }
  }
  update(dt) {
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -9999; continue; }
      this.vel[i * 3 + 1] += this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

function initRenderer() {
  if (G.renderer || G.noWebGL) return;
  try {
    G.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    G.noWebGL = true;
    console.warn('WebGL unavailable', e);
    return;
  }
  G.renderer.setSize(innerWidth, innerHeight);
  const q = qualityPreset();
  G.dynRatio = q.pixelRatio;
  G.renderer.setPixelRatio(q.pixelRatio);
  G.renderer.shadowMap.enabled = true;
  G.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  G.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  G.renderer.toneMappingExposure = 1.18;
  G.renderer.outputColorSpace = THREE.SRGBColorSpace;
  G.renderer.domElement.className = 'game';
  G.renderer.domElement.style.cssText = 'position:fixed;inset:0;z-index:0';
  document.body.appendChild(G.renderer.domElement);
  G.camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.1, 9000);
  addEventListener('resize', () => {
    G.camera.aspect = innerWidth / innerHeight; G.camera.updateProjectionMatrix();
    if (G.menuCamera) { G.menuCamera.aspect = innerWidth / innerHeight; G.menuCamera.updateProjectionMatrix(); }
    G.renderer.setSize(innerWidth, innerHeight);
  });
}

const FALLBACK_SKIN_COLORS = { default: '#4d8fd1', neon: '#39ff88', shadow: '#2b2b3a', gold: '#e8a33d', crimson: '#e63946', frost: '#a8dadc', toxic: '#8ac926', galaxy: '#9b5de5' };

// ---------------- post-processing: bloom + god rays + filmic grade ----------------
// Hand-rolled composer (no addons): HDR scene target -> bright pass -> 2-scale
// gaussian bloom -> screen-space god rays from the real sky sun -> ACES + grade.
const SUN_DIR = new THREE.Vector3(0.5, 0.62, 0.35).normalize(); // matches world.js sky/water
let POST = null, POST_DEAD = false;
function postModeName() {
  if (SETTINGS.post === 'off') return null;
  if (SETTINGS.post === 'on') return 'cinematic';
  const q = resolvedQualityName();
  return q === 'performance' ? null : q; // cinematic | balanced
}
const POST_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
function initPost() {
  try {
    if (!G.renderer.capabilities.isWebGL2) { POST_DEAD = true; return; }
    const pm = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: POST_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    const rt = (withDepth) => new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: !!withDepth });
    const sceneRT = rt(true); sceneRT.samples = 4;
    POST = {
      scene: new THREE.Scene(),
      cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
      rtScene: sceneRT, rtA: rt(), rtB: rt(), rtC: rt(), rtD: rt(), rtGod: rt(),
      copy: pm('varying vec2 vUv; uniform sampler2D tD; void main(){ gl_FragColor = vec4(texture2D(tD, vUv).rgb, 1.0); }', { tD: { value: null } }),
      bright: pm(`varying vec2 vUv; uniform sampler2D tD;
        void main(){ vec3 c = texture2D(tD, vUv).rgb;
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          gl_FragColor = vec4(c * smoothstep(0.72, 1.2, l), 1.0); }`, { tD: { value: null } }),
      blur: pm(`varying vec2 vUv; uniform sampler2D tD; uniform vec2 uDir;
        void main(){
          vec3 c = texture2D(tD, vUv).rgb * 0.227027027;
          vec2 o1 = uDir * 1.3846153846, o2 = uDir * 3.2307692307;
          c += (texture2D(tD, vUv + o1).rgb + texture2D(tD, vUv - o1).rgb) * 0.3162162162;
          c += (texture2D(tD, vUv + o2).rgb + texture2D(tD, vUv - o2).rgb) * 0.0702702703;
          gl_FragColor = vec4(c, 1.0); }`, { tD: { value: null }, uDir: { value: new THREE.Vector2(0.001, 0) } }),
      god: pm(`varying vec2 vUv; uniform sampler2D tD; uniform vec2 uSunUv; uniform float uI; uniform float uSteps;
        void main(){
          vec2 delta = (uSunUv - vUv) / max(uSteps, 1.0);
          vec2 uv = vUv; vec3 acc = vec3(0.0); float w = 1.0;
          for (int i = 0; i < 48; i++) {
            if (float(i) >= uSteps) break;
            uv += delta;
            acc += texture2D(tD, uv).rgb * w;
            w *= 0.94;
          }
          acc /= max(uSteps * 0.55, 1.0);
          gl_FragColor = vec4(acc * uI, 1.0); }`, { tD: { value: null }, uSunUv: { value: new THREE.Vector2(0.5, 0.75) }, uI: { value: 0 }, uSteps: { value: 40 } }),
      comp: pm(`varying vec2 vUv;
        uniform sampler2D tScene, tBloomT, tBloomW, tGod;
        uniform float uTime, uBloom, uGodK;
        vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
        void main(){
          vec2 d = vUv - 0.5;
          float r2 = dot(d, d);
          vec2 ca = d * r2 * 0.012; // whisper of chromatic aberration
          vec3 col;
          col.r = texture2D(tScene, vUv + ca).r;
          col.g = texture2D(tScene, vUv).g;
          col.b = texture2D(tScene, vUv - ca).b;
          col += texture2D(tBloomT, vUv).rgb * (uBloom * 0.62);
          col += texture2D(tBloomW, vUv).rgb * (uBloom * 0.55);
          col += texture2D(tGod, vUv).rgb * uGodK * vec3(1.0, 0.82, 0.58);
          col = aces(col * 1.06);
          float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = mix(vec3(l), col, 1.13); // saturation pop
          col = (col - 0.5) * 1.03 + 0.5;
          float vig = smoothstep(0.95, 0.35, length(d * vec2(1.12, 1.0)) * 1.35);
          col *= mix(0.74, 1.0, vig);
          col = pow(clamp(col, 0.0, 1.0), vec3(0.4545));
          float gr = fract(sin(dot(vUv * (fract(uTime) + 13.7), vec2(12.9898, 78.233))) * 43758.5453);
          col += (gr - 0.5) * 0.016; // film grain
          gl_FragColor = vec4(col, 1.0);
        }`, { tScene: { value: null }, tBloomT: { value: null }, tBloomW: { value: null }, tGod: { value: null }, uTime: { value: 0 }, uBloom: { value: 0.9 }, uGodK: { value: 0.9 } }),
    };
    POST.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), POST.copy);
    POST.mesh.frustumCulled = false;
    POST.scene.add(POST.mesh);
  } catch (e) {
    console.warn('post fx unavailable', e);
    POST_DEAD = true; POST = null;
  }
}
const _postSize = new THREE.Vector2(), _sunProj = new THREE.Vector3(), _camFwd = new THREE.Vector3();
function postResize(w, h) {
  const set = (target, x, y) => { x = Math.max(2, x); y = Math.max(2, y); if (target.width !== x || target.height !== y) target.setSize(x, y); };
  set(POST.rtScene, w, h);
  set(POST.rtA, w >> 1, h >> 1); set(POST.rtB, w >> 1, h >> 1);
  set(POST.rtC, w >> 2, h >> 2); set(POST.rtD, w >> 2, h >> 2); set(POST.rtGod, w >> 2, h >> 2);
}
function renderFrame(scene, camera) {
  if (!G.renderer) return;
  const mode = postModeName();
  if (POST_DEAD || !mode) { G.renderer.render(scene, camera); return; }
  if (!POST) { initPost(); if (!POST) { G.renderer.render(scene, camera); return; } }
  const R = G.renderer;
  R.getDrawingBufferSize(_postSize);
  const W = _postSize.x, H = _postSize.y;
  postResize(W, H);
  const run = (mat, target, src) => {
    POST.mesh.material = mat;
    if (src && mat.uniforms.tD) mat.uniforms.tD.value = src;
    R.setRenderTarget(target);
    R.render(POST.scene, POST.cam);
  };
  R.setRenderTarget(POST.rtScene); R.render(scene, camera);
  run(POST.bright, POST.rtA, POST.rtScene.texture);
  POST.blur.uniforms.uDir.value.set(1 / (W >> 1), 0); run(POST.blur, POST.rtB, POST.rtA.texture);
  POST.blur.uniforms.uDir.value.set(0, 1 / (H >> 1)); run(POST.blur, POST.rtA, POST.rtB.texture);
  run(POST.copy, POST.rtC, POST.rtA.texture);
  POST.blur.uniforms.uDir.value.set(1 / (W >> 2), 0); run(POST.blur, POST.rtD, POST.rtC.texture);
  POST.blur.uniforms.uDir.value.set(0, 1 / (H >> 2)); run(POST.blur, POST.rtC, POST.rtD.texture);
  // god rays: project the sun, fade when off-screen / behind / facing away.
  // (rays sample the bright buffer, so terrain occlusion is automatic)
  camera.getWorldDirection(_camFwd);
  const facing = _camFwd.dot(SUN_DIR);
  _sunProj.copy(camera.position).addScaledVector(SUN_DIR, 3000).project(camera);
  const sx = _sunProj.x * 0.5 + 0.5, sy = _sunProj.y * 0.5 + 0.5;
  const edge = Math.max(Math.abs(sx - 0.5), Math.abs(sy - 0.5)) * 2;
  const vis = THREE.MathUtils.clamp((facing - 0.02) / 0.4, 0, 1)
    * THREE.MathUtils.clamp(1.18 - edge * 0.55, 0, 1) * (_sunProj.z < 1 ? 1 : 0);
  POST.god.uniforms.uSunUv.value.set(sx, sy);
  POST.god.uniforms.uI.value = (mode === 'cinematic' ? 0.9 : 0.65) * vis;
  POST.god.uniforms.uSteps.value = mode === 'cinematic' ? 44 : 30;
  run(POST.god, POST.rtGod, POST.rtA.texture);
  const comp = POST.comp;
  comp.uniforms.tScene.value = POST.rtScene.texture;
  comp.uniforms.tBloomT.value = POST.rtA.texture;
  comp.uniforms.tBloomW.value = POST.rtC.texture;
  comp.uniforms.tGod.value = POST.rtGod.texture;
  comp.uniforms.uTime.value = (performance.now() / 1000) % 61;
  comp.uniforms.uBloom.value = mode === 'cinematic' ? 0.95 : 0.75;
  POST.mesh.material = comp;
  R.setRenderTarget(null);
  R.render(POST.scene, POST.cam);
}
function mySkinColor() {
  if (!currentUser) return '#4d8fd1';
  return (SKINS_BY_ID[currentUser.skin] && SKINS_BY_ID[currentUser.skin].color) || FALLBACK_SKIN_COLORS[currentUser.skin] || '#4d8fd1';
}

// ---------- REBORN: live 3D island behind auth/lobby ----------
async function startMenuScene() {
  if (G.menuScene || G.active) return;
  try {
    const data = await fetch('/api/world').then(r => r.json());
    if (!data || !data.pois || G.active) return;
    initRenderer();
    if (!G.renderer) return;
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x9fc6ee, 320, 4200);
    G.menuScene = scene;
    createSky(scene); createWater(scene);
    scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x4a7c43, 1.05));
    const sun = new THREE.DirectionalLight(0xfff1cf, 2.2);
    sun.position.set(400, 700, 250); scene.add(sun);
    G.menuWorldRef = buildWorld(scene, data, { grass: 16000, seg: 128, aniso: 2 });
    G.menuCamera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 9000);
    document.body.classList.add('menu3d');
    updateMenuChar();
    const menuLoop = (now) => {
      if (G.active || !G.menuScene) return;
      G.menuRAF = requestAnimationFrame(menuLoop);
      const t = now / 1000;
      scene.traverse(o => { if (o.material && o.material.uniforms && o.material.uniforms.uTime) o.material.uniforms.uTime.value = t; });
      const cx = 0, cz = -200, cy = terrainHeight(cx, cz);
      const a = t * 0.07;
      const target = G.menuChar ? G.menuChar.position : new THREE.Vector3(cx, cy, cz);
      G.menuCamera.position.set(target.x + Math.cos(a) * 17, target.y + 5.2 + Math.sin(t * 0.3) * 0.8, target.z + Math.sin(a) * 17);
      G.menuCamera.lookAt(target.x, target.y + 2.1, target.z);
      if (G.menuChar) {
        G.menuChar.rotation.y = -a + Math.PI / 2;
        const u = G.menuChar.userData;
        if (u.anim) { u.anim.position.y = Math.abs(Math.sin(t * 2.1)) * 0.05; u.armR.rotation.x = -0.4 + Math.sin(t * 1.3) * 0.12; }
      }
      if (G.menuWorldRef) G.menuWorldRef.updateWorld(t, 0.016, G.menuCamera.position);
      renderFrame(scene, G.menuCamera);
    };
    G.menuRAF = requestAnimationFrame(menuLoop);
  } catch (e) { console.warn('menu scene skipped', e); }
}
function stopMenuScene() {
  if (G.menuRAF) cancelAnimationFrame(G.menuRAF);
  G.menuRAF = 0; G.menuScene = null; G.menuChar = null;
  document.body.classList.remove('menu3d');
}
function updateMenuChar() {
  if (!G.menuScene || !currentUser) return;
  const color = mySkinColor();
  if (!G.menuChar) {
    const ch = makeCharacter(color, currentUser.username);
    const gy = terrainHeight(14, -186);
    ch.position.set(14, gy, -186);
    const holder = ch.userData.gunHolder;
    holder.add(makeGunModel('ar'));
    G.menuScene.add(ch);
    G.menuChar = ch;
  } else if (G.menuChar.userData.body) {
    G.menuChar.userData.body.material.color.set(color);
  }
}

// Ambient pollen / light motes drifting around the player
function ensurePollen(scene) {
  if (G.pollen) { scene.add(G.pollen); return; }
  const N = HAS_TOUCH ? 90 : 170;
  const arr = new Float32Array(N * 3);
  const base = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    base[i * 3] = (Math.random() - 0.5) * 64;
    base[i * 3 + 1] = Math.random() * 16;
    base[i * 3 + 2] = (Math.random() - 0.5) * 64;
  }
  arr.set(base);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    map: getGlowTexture(), color: 0xffeeb8, size: 0.22, sizeAttenuation: true,
    transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  pts.frustumCulled = false;
  G.pollen = pts; G.pollenBase = base;
  scene.add(pts);
}
function updatePollen(t) {
  if (!G.pollen) return;
  const show = G.mode === 'ground';
  G.pollen.visible = show;
  if (!show) return;
  const posA = G.pollen.geometry.attributes.position;
  const base = G.pollenBase, cam = G.camera.position;
  for (let i = 0; i < base.length; i += 3) {
    let x = base[i] + Math.sin(t * 0.35 + i) * 2.2;
    let y = base[i + 1] + Math.sin(t * 0.5 + i * 1.7) * 1.1;
    let z = base[i + 2] + Math.cos(t * 0.28 + i * 0.6) * 2.2;
    // wrap around camera in a 64m box
    x = cam.x + ((((x - cam.x) % 64) + 96) % 64) - 32;
    z = cam.z + ((((z - cam.z) % 64) + 96) % 64) - 32;
    posA.array[i] = x;
    posA.array[i + 1] = cam.y - 2 + ((y % 18) + 18) % 18;
    posA.array[i + 2] = z;
  }
  posA.needsUpdate = true;
}

function startMatch(data) {
  stopMenuScene();
  document.body.classList.remove('scoping');
  show('loadingScreen');
  $('loadingFill').style.width = '35%'; $('loadingText').textContent = 'Building island (4000 × 4000)…';
  setTimeout(() => {
    initRenderer();
    if (!G.renderer) { showNotice('WebGL is not available on this device/browser', '#7d1d1d'); show('lobbyScreen'); return; }
    G.data = data; G.myId = data.you; G.active = true; G.ended = false; G.won = false;
    G.mode = 'bus'; G.slot = 0; G.buildMode = false;
    G.pos.set(data.bus.x, data.bus.y, data.bus.z);
    G.remotes.clear(); G.loot.clear(); G.structures.clear(); G.self = null;
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x9fc6ee, 320, 4200);
    G.scene = scene;
    G.skyMat = createSky(scene);
    G.waterMat = createWater(scene);
    const sw = createStormWall(scene); G.stormWall = sw;
    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x4a7c43, 1.05); scene.add(hemi);
    const amb = new THREE.AmbientLight(0x8899bb, 0.25); scene.add(amb);
    const sun = new THREE.DirectionalLight(0xfff1cf, 2.4);
    sun.position.set(400, 700, 250); sun.castShadow = true;
    const q = qualityPreset();
    sun.shadow.mapSize.set(q.shadow, q.shadow);
    sun.shadow.camera.left = -140; sun.shadow.camera.right = 140; sun.shadow.camera.top = 140; sun.shadow.camera.bottom = -140;
    sun.shadow.camera.far = 1900; sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.6; sun.name = 'sun';
    scene.add(sun); scene.add(sun.target);
    // sun lens-flare sprite (cheap cinematic glow, positioned per-frame)
    const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTexture(), color: 0xffe9b0, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, fog: false }));
    flare.scale.set(420, 420, 1); flare.renderOrder = 5;
    G.sunSprite = flare; scene.add(flare);
    G.world = buildWorld(scene, data, q);
    G.particles = new ParticlePool(scene, HAS_TOUCH ? 800 : 1600);
    ensurePollen(scene);
    buildMinimapBase();
    document.body.classList.add('playing', 'busmode');
    G.ads = false; G.vmKick = 0; G.camShake = 0;
    $('loadingFill').style.width = '75%'; $('loadingText').textContent = 'Dropping loot & building Battle Bus…';
    // Battle bus
    G.busGroup = makeBus(); scene.add(G.busGroup);
    data.loot.forEach(addLootMesh);
    // viewmodel (first-person mode)
    G.viewmodel = new THREE.Group();
    G.camera.add(G.viewmodel); scene.add(G.camera);
    buildViewmodel('pickaxe');
    // REBORN: your own character (third-person) + pooled muzzle light
    G.selfMesh = makeCharacter(mySkinColor(), currentUser ? currentUser.username : 'You');
    G.selfMesh.userData.gunHolder.add(makeGunModel('pickaxe'));
    G.selfMesh.visible = false;
    scene.add(G.selfMesh);
    G.camSmooth = null; G.lastSelfPos = G.pos.clone();
    G.muzzleLight = new THREE.PointLight(0xffc46b, 0, 20, 1.6);
    scene.add(G.muzzleLight);
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

function makeGunModel(weaponId) {
  const grp = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x23242e, roughness: 0.38, metalness: 0.65 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x596273, roughness: 0.3, metalness: 0.7 });
  const add = (geo, mat, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); if (rx) m.rotation.x = rx; m.castShadow = true; grp.add(m); return m; };
  if (weaponId === 'pickaxe') {
    add(new THREE.CylinderGeometry(0.045, 0.055, 0.95), new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.9 }), 0, -0.15, 0.1, 0.5);
    add(new THREE.BoxGeometry(0.85, 0.11, 0.11), accent, 0, 0.22, -0.05);
    return grp;
  }
  const L = { pistol: 0.42, smg: 0.58, ar: 0.82, shotgun: 0.88, sniper: 1.12, lmg: 1.0 }[weaponId] || 0.7;
  add(new THREE.BoxGeometry(0.13, 0.2, L), dark, 0, 0, 0);
  add(new THREE.CylinderGeometry(0.032, 0.032, 0.34), accent, 0, 0.045, -L / 2 - 0.14, Math.PI / 2);
  add(new THREE.BoxGeometry(0.09, 0.3, 0.12), dark, 0, -0.22, 0.04);
  add(new THREE.BoxGeometry(0.05, 0.09, 0.2), accent, 0, 0.15, -0.05);
  if (weaponId === 'sniper') add(new THREE.CylinderGeometry(0.055, 0.055, 0.3), dark, 0, 0.2, -0.08, Math.PI / 2);
  if (weaponId === 'shotgun') add(new THREE.CylinderGeometry(0.045, 0.045, 0.5), accent, 0, -0.06, -L / 2 + 0.1, Math.PI / 2);
  if (weaponId === 'lmg') add(new THREE.BoxGeometry(0.16, 0.22, 0.3), dark, 0, -0.18, -0.16);
  return grp;
}
function makeCharacter(colorHex, username) {
  const g = new THREE.Group();       // feet origin
  const anim = new THREE.Group();    // bobs/leans
  g.add(anim);
  const suit = new THREE.MeshStandardMaterial({ color: new THREE.Color(colorHex || '#4d8fd1'), roughness: 0.75 });
  const darkM = new THREE.MeshStandardMaterial({ color: 0x2a2d38, roughness: 0.6, metalness: 0.2 });
  const skinM = new THREE.MeshStandardMaterial({ color: 0xf2c79b, roughness: 0.65 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 0.62, 6, 12), suit);
  torso.position.y = 1.32; torso.castShadow = true;
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.5, 0.24), darkM);
  chest.position.set(0, 1.42, 0.3);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.78, 0.3), darkM);
  pack.position.set(0, 1.38, -0.48); pack.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 16, 13), skinM);
  head.position.y = 2.08; head.castShadow = true;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.385, 16, 9, 0, Math.PI * 2, 0, 1.3), suit);
  cap.position.y = 2.12;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.13, 0.1), new THREE.MeshStandardMaterial({ color: 0x101623, roughness: 0.15, metalness: 0.6 }));
  visor.position.set(0, 2.1, 0.31);
  const mkLimb = (side, isArm) => {
    const pivot = new THREE.Group();
    pivot.position.set(0.34 * side, isArm ? 1.62 : 0.98, 0);
    const limb = new THREE.Mesh(new THREE.BoxGeometry(isArm ? 0.21 : 0.27, isArm ? 0.82 : 0.92, isArm ? 0.24 : 0.3), isArm ? suit : darkM);
    limb.position.y = isArm ? -0.38 : -0.44; limb.castShadow = true;
    const end = new THREE.Mesh(new THREE.BoxGeometry(isArm ? 0.2 : 0.29, 0.14, isArm ? 0.22 : 0.42), isArm ? skinM : darkM);
    end.position.y = isArm ? -0.82 : -0.92; if (!isArm) end.position.z = 0.05;
    pivot.add(limb, end);
    return pivot;
  };
  const legL = mkLimb(-0.62, false), legR = mkLimb(0.62, false);
  legL.position.x = -0.24; legR.position.x = 0.24;
  const armL = mkLimb(-1, true), armR = mkLimb(1, true);
  const gunHolder = new THREE.Group();
  gunHolder.position.set(0.1, -0.78, 0.28);
  gunHolder.rotation.x = Math.PI / 2 - 0.15;
  armR.add(gunHolder);
  const glider = new THREE.Mesh(new THREE.SphereGeometry(2.7, 16, 7, 0, Math.PI * 2, 0, 1.15), new THREE.MeshStandardMaterial({ color: 0xff7847, roughness: 0.55, side: THREE.DoubleSide }));
  glider.position.y = 3.5; glider.scale.y = 0.45; glider.visible = false; glider.castShadow = true;
  const gc = document.createElement('canvas'); gc.width = 256; gc.height = 52;
  const gtx = gc.getContext('2d'); gtx.font = '800 25px Segoe UI'; gtx.textAlign = 'center';
  gtx.shadowColor = '#000'; gtx.shadowBlur = 6; gtx.fillStyle = '#fff'; gtx.fillText(username, 128, 33);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(gc), transparent: true, depthWrite: false }));
  spr.scale.set(5.2, 1.05, 1); spr.position.y = 3.0;
  // health bar sprite (canvas updated on hp change)
  const hc = document.createElement('canvas'); hc.width = 96; hc.height = 14;
  const hTex = new THREE.CanvasTexture(hc);
  const hSpr = new THREE.Sprite(new THREE.SpriteMaterial({ map: hTex, transparent: true, depthWrite: false }));
  hSpr.scale.set(2.3, 0.34, 1); hSpr.position.y = 2.68;
  anim.add(torso, chest, pack, head, cap, visor, legL, legR, armL, armR, glider, spr, hSpr);
  g.userData = { gun: gunHolder, gunHolder, glider, body: torso, anim, legL, legR, armL, armR, hCanvas: hc, hTex, hpShown: -1, phase: Math.random() * 6, lastPos: null, speed: 0 };
  return g;
}
function updateHealthBar(r, hp, sh) {
  const u = r.mesh.userData;
  const key = Math.round(hp) * 1000 + Math.round(sh);
  if (u.hpShown === key) return;
  u.hpShown = key;
  const g = u.hCanvas.getContext('2d');
  g.clearRect(0, 0, 96, 14);
  g.fillStyle = 'rgba(0,0,0,0.65)'; g.fillRect(0, 0, 96, 14);
  g.fillStyle = '#37d67a'; g.fillRect(2, 2, 92 * Math.max(0, hp) / 100, 5);
  g.fillStyle = '#38b6ff'; g.fillRect(2, 8, 92 * Math.max(0, sh) / 100, 4);
  u.hTex.needsUpdate = true;
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

function addStructureMesh(s) {
  if (G.structures.has(s.id)) return;
  let mesh;
  if (s.type === 'floor') mesh = new THREE.Mesh(new THREE.BoxGeometry(5, 0.35, 5), structureMaterial(s.material));
  else if (s.type === 'ramp') { mesh = new THREE.Mesh(new THREE.BoxGeometry(5, 0.35, 7.3), structureMaterial(s.material)); mesh.rotation.x = -0.6; }
  else mesh = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 0.35), structureMaterial(s.material));
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
  const slot = currentSlot();
  const rarity = slot && slot.kind === 'weapon' ? (slot.rarity || 0) : 0;
  const grp = makeGunModel(weaponId);
  grp.scale.setScalar(0.62); // built facing -Z = camera forward, no flip needed
  // rarity accent stripe
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.035, 0.5), new THREE.MeshStandardMaterial({ color: new THREE.Color(RARITY_COLORS[rarity]), emissive: new THREE.Color(RARITY_COLORS[rarity]), emissiveIntensity: 0.7, roughness: 0.4 }));
  stripe.position.set(0, 0.12, 0.1);
  grp.add(stripe);
  // gloved hands
  const glove = new THREE.MeshStandardMaterial({ color: 0x333a4a, roughness: 0.85 });
  const h1 = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.16), glove); h1.position.set(0.02, -0.16, 0.16);
  const h2 = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.15), glove); h2.position.set(-0.03, -0.11, -0.28); h2.rotation.x = 0.4;
  if (weaponId !== 'pickaxe') grp.add(h1, h2);
  const wrap = new THREE.Group();
  wrap.add(grp);
  wrap.position.set(0.32, -0.32, -0.55);
  G.viewmodel.add(wrap);
  G.vmWrap = wrap;
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
  $('inventory').innerHTML = inv.map((s, i) => `<div class="slot r${s && s.kind === 'weapon' ? (s.rarity || 0) : 0} ${i === G.slot ? 'sel' : ''}" data-idx="${i}"><span class="key">${i + 1}</span>${slotItemHTML(s)}</div>`).join('');
  if (G.self) $('mats').innerHTML = `🪵 ${G.self.materials.wood} &nbsp; 🧱 ${G.self.materials.stone} &nbsp; 🔩 ${G.self.materials.metal}`;
  updateAmmoBox();
  const s = inv[G.slot];
  const wid = s && s.kind === 'weapon' ? s.weaponId : 'pickaxe';
  if (wid !== G.vmWeapon) { buildViewmodel(wid); updateSelfWeapon(wid); }
}
function updateSelfWeapon(wid) {
  if (!G.selfMesh) return;
  const holder = G.selfMesh.userData.gunHolder;
  while (holder.children.length) holder.remove(holder.children[0]);
  holder.add(makeGunModel(wid));
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
  document.body.classList.remove('playing', 'busmode', 'lowhp', 'scoping');
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
    // bots send movement-yaw; humans send camera-yaw (model front is +Z, camera looks -Z, hence +PI)
    r.target.set(p.x, p.y, p.z); r.yawTarget = p.bot ? p.yaw : p.yaw + Math.PI; r.pitch = p.pitch;
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
  const camD = from.distanceTo(G.camera.position);
  if (camD > 420) return;
  // glowing bolt (stretched cylinder) instead of a 1px line
  const dirV = to.clone().sub(from);
  const len = Math.max(0.1, dirV.length());
  let tr = G.tracers.find(x => x.ttl <= 0);
  if (!tr) {
    if (G.tracers.length > 42) { tr = G.tracers[0]; }
    else {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, 1, 5, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      G.scene.add(mesh);
      tr = { mesh, ttl: 0 };
      G.tracers.push(tr);
    }
  }
  tr.mesh.visible = true;
  tr.mesh.material.color.set(t.weaponId === 'sniper' ? 0xffe082 : 0xffc46b);
  tr.mesh.material.opacity = 0.95;
  tr.mesh.position.copy(from).addScaledVector(dirV, 0.5);
  tr.mesh.scale.set(t.weaponId === 'shotgun' ? 1.6 : 1, len, t.weaponId === 'shotgun' ? 1.6 : 1);
  tr.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirV.normalize());
  tr.ttl = 0.085;
  if (G.muzzleLight && t.shooter !== G.myId && camD < 70) {
    G.muzzleLight.position.copy(from);
    G.muzzleLight.intensity = 14;
  }
  if (G.particles && to.distanceTo(G.camera.position) < 260) G.particles.burst(to, 0xffc46b, t.shooter === G.myId ? 5 : 8, 3.4, 0.32, -4);
  if (G.particles && t.shooter !== G.myId && camD < 120) G.particles.burst(from, 0xffe082, 4, 2, 0.16, 0);
  if (t.shooter !== G.myId) {
    if (camD < 130) playShot(t.weaponId, camD > 55);
  }
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

// ---------------- input (shared desktop + touch actions) ----------------
const T = { joyX: 0, joyY: 0, sprint: false, crouch: false };
function selectSlot(n) {
  if (n < 0 || n > 4 || !socket) return;
  G.slot = n; socket.emit('setSlot', n); renderInventory(); playTone(660, 0.03, 0.03);
}
function toggleBuild() {
  if (!G.active || G.mode !== 'ground') return;
  G.buildMode = !G.buildMode;
  $('buildBox').classList.toggle('hidden', !G.buildMode);
  document.querySelectorAll('.build-extra').forEach(b => b.classList.toggle('hidden', !G.buildMode));
  $('btnBuildT').classList.toggle('on', G.buildMode);
  if (G.ghost) G.ghost.visible = false;
}
function cycleBuildType() {
  G.buildType = G.buildType === 'wall' ? 'floor' : G.buildType === 'floor' ? 'ramp' : 'wall';
  $('buildType').textContent = G.buildType[0].toUpperCase() + G.buildType.slice(1);
  $('btnCycleT').firstChild.textContent = G.buildType === 'wall' ? '▦' : G.buildType === 'floor' ? '▬' : '◢';
}
function cycleBuildMat() {
  G.buildMat = G.buildMat === 'wood' ? 'stone' : G.buildMat === 'stone' ? 'metal' : 'wood';
  $('buildMat').textContent = G.buildMat;
  $('btnMatT').firstChild.textContent = G.buildMat === 'wood' ? '🪵' : G.buildMat === 'stone' ? '🧱' : '🔩';
}
function doJumpAction() {
  if (!G.active || !socket) return;
  audio();
  if (G.mode === 'bus') { socket.emit('jump'); return; }
  if (G.mode === 'skydiving' && !G.gliding) { G.gliding = true; showNotice('🪂 Glider deployed', '#1d5c34'); return; }
  G.keys.Space = true;
  setTimeout(() => { if (!T.jumpHeld) G.keys.Space = false; }, 90);
}
function doReload() {
  if (!socket || !G.active) return;
  const s = currentSlot();
  if (s && s.kind === 'weapon' && META) {
    G.reloadUntil = performance.now() + META.weapons[s.weaponId].reload; G.reloadTotal = META.weapons[s.weaponId].reload;
    // mag-out / mag-in clicks
    playNoise(0.04, 2600, 0.07);
    setTimeout(() => playNoise(0.05, 1500, 0.09), Math.min(280, META.weapons[s.weaponId].reload * 0.4));
    setTimeout(() => playNoise(0.04, 3200, 0.07), Math.max(320, META.weapons[s.weaponId].reload - 160));
  }
  socket.emit('reload');
}
function openSettings() { syncSettingsUI(); $('settingsScreen').classList.remove('hidden'); if (document.exitPointerLock) document.exitPointerLock(); }
function closeSettings() { $('settingsScreen').classList.add('hidden'); applyLiveSettings(); }

addEventListener('keydown', (e) => {
  G.keys[e.code] = true;
  if (e.code === 'KeyP' && (G.active || currentUser)) { $('settingsScreen').classList.contains('hidden') ? openSettings() : closeSettings(); return; }
  if (!G.active) return;
  if (e.code === 'Space') e.preventDefault();
  if (G.buildMode && e.code === 'KeyF') { cycleBuildType(); return; }
  if (G.mode === 'bus' && (e.code === 'KeyF' || e.code === 'Space')) { doJumpAction(); return; }
  if (G.mode === 'skydiving' && e.code === 'Space' && !G.gliding) { G.gliding = true; return; }
  if (e.code.startsWith('Digit')) { const n = parseInt(e.code.slice(5)) - 1; if (n >= 0 && n < 5) selectSlot(n); }
  if (e.code === 'KeyR') doReload();
  if (e.code === 'KeyE') tryPickup();
  if (e.code === 'KeyQ') toggleBuild();
  if (e.code === 'KeyV') { G.thirdPerson = !G.thirdPerson; showCenter(G.thirdPerson ? '🧑 Third-person camera' : '🔫 First-person camera', 900); }
  if (G.buildMode && e.code === 'KeyX') cycleBuildMat();
});
addEventListener('keyup', (e) => { G.keys[e.code] = false; });
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement && G.active && G.mode !== 'bus') {
    const k = 0.0021 * SETTINGS.sens * (G.ads ? 0.5 : 1);
    G.yaw -= e.movementX * k;
    G.pitch += e.movementY * k * (SETTINGS.invert ? 1 : -1);
    G.pitch = Math.max(-1.45, Math.min(1.45, G.pitch));
  }
});
document.addEventListener('contextmenu', (e) => { if (G.active) e.preventDefault(); });
document.addEventListener('mousedown', (e) => {
  if (!G.active || e.target !== (G.renderer && G.renderer.domElement)) return;
  if (e.button === 2) { G.ads = true; return; }
  if (e.button !== 0) return;
  if (G.mode !== 'bus' && !document.pointerLockElement && !touchEnabled()) { tryLock(); return; }
  G.mouseDown = true; G.clicked = true;
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) G.mouseDown = false;
  if (e.button === 2) G.ads = false;
});
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
  if (best) { socket.emit('pickup', best.id); playTone(900, 0.05, 0.05); if (HAS_TOUCH && navigator.vibrate) navigator.vibrate(18); }
}

// ---------------- mobile / touch controls ----------------
function bindHold(el, down, up) {
  if (!el) return;
  const start = (e) => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch {} down && down(e); };
  const end = (e) => { up && up(e); };
  el.addEventListener('pointerdown', start);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('contextmenu', e => e.preventDefault());
}
function initTouchControls() {
  // dynamic-origin joystick
  const zone = $('joyZone'), base = $('joyBase'), nub = $('joyNub');
  let joyId = null, ox = 0, oy = 0;
  zone.addEventListener('pointerdown', (e) => {
    if (joyId !== null || !G.active) return;
    joyId = e.pointerId; ox = e.clientX; oy = e.clientY;
    try { zone.setPointerCapture(joyId); } catch {}
    base.style.left = ox + 'px'; base.style.top = oy + 'px';
    base.classList.add('on');
    nub.style.transform = 'translate(-50%,-50%)';
    audio();
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== joyId) return;
    let dx = e.clientX - ox, dy = e.clientY - oy;
    const len = Math.hypot(dx, dy), max = 52;
    if (len > max) { dx = dx / len * max; dy = dy / len * max; }
    T.joyX = dx / max; T.joyY = -dy / max;
    nub.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  });
  const joyEnd = (e) => {
    if (e.pointerId !== joyId) return;
    joyId = null; T.joyX = 0; T.joyY = 0;
    base.classList.remove('on');
    nub.style.transform = 'translate(-50%,-50%)';
  };
  zone.addEventListener('pointerup', joyEnd);
  zone.addEventListener('pointercancel', joyEnd);

  // right-side look drag
  const look = $('lookZone');
  let lookId = null, lx = 0, ly = 0;
  look.addEventListener('pointerdown', (e) => {
    if (lookId !== null || !G.active) return;
    lookId = e.pointerId; lx = e.clientX; ly = e.clientY;
    try { look.setPointerCapture(lookId); } catch {}
  });
  look.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lookId || G.mode === 'bus') return;
    const dx = e.clientX - lx, dy = e.clientY - ly;
    lx = e.clientX; ly = e.clientY;
    const k = 0.0044 * SETTINGS.sens * (G.ads ? 0.5 : 1);
    G.yaw -= dx * k;
    G.pitch += dy * k * (SETTINGS.invert ? 1 : -1);
    G.pitch = Math.max(-1.45, Math.min(1.45, G.pitch));
  });
  const lookEnd = (e) => { if (e.pointerId === lookId) lookId = null; };
  look.addEventListener('pointerup', lookEnd);
  look.addEventListener('pointercancel', lookEnd);

  bindHold($('btnFire'), () => { audio(); G.mouseDown = true; G.clicked = true; }, () => { G.mouseDown = false; });
  bindHold($('btnAim'), () => { G.ads = !G.ads; $('btnAim').classList.toggle('on', G.ads); });
  bindHold($('btnJumpT'), () => { T.jumpHeld = true; doJumpAction(); G.keys.Space = true; }, () => { T.jumpHeld = false; G.keys.Space = false; });
  bindHold($('btnInteract'), () => tryPickup());
  bindHold($('btnUseT'), () => { G.clicked = true; G.mouseDown = true; setTimeout(() => { if (!G.mouseDown || true) G.mouseDown = false; }, 120); });
  bindHold($('btnReloadT'), () => doReload());
  bindHold($('btnBuildT'), () => toggleBuild());
  bindHold($('btnCycleT'), () => cycleBuildType());
  bindHold($('btnMatT'), () => cycleBuildMat());
  bindHold($('btnCrouchT'), () => { T.crouch = !T.crouch; $('btnCrouchT').classList.toggle('on', T.crouch); });
  bindHold($('btnSprintT'), () => { T.sprint = !T.sprint; $('btnSprintT').classList.toggle('on', T.sprint); });
  $('btnJumpBus').addEventListener('click', () => doJumpAction());

  // tappable inventory slots (also handy with a mouse)
  $('inventory').addEventListener('pointerdown', (e) => {
    const slot = e.target.closest('.slot');
    if (slot) { e.preventDefault(); selectSlot(parseInt(slot.dataset.idx, 10)); }
  });
  $('btnPauseHud').addEventListener('click', () => openSettings());
  $('btnFullscreenHud').addEventListener('click', () => {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
    } catch {}
  });
  document.addEventListener('gesturestart', e => e.preventDefault());
}
function initSettingsUI() {
  syncSettingsUI();
  const bindSel = (id, key) => { const el = $(id); if (el) el.addEventListener('change', () => { SETTINGS[key] = el.value; applyLiveSettings(); }); };
  bindSel('qualitySelect', 'quality'); bindSel('setQuality', 'quality');
  bindSel('touchSelect', 'touch'); bindSel('setTouch', 'touch');
  bindSel('setPost', 'post');
  if ($('setSens')) $('setSens').addEventListener('input', () => { SETTINGS.sens = parseFloat($('setSens').value); $('sensVal').textContent = SETTINGS.sens.toFixed(1) + '×'; saveSettings(); });
  if ($('setVol')) $('setVol').addEventListener('input', () => { SETTINGS.vol = parseInt($('setVol').value, 10); $('volVal').textContent = SETTINGS.vol + '%'; applyLiveSettings(); playTone(800, 0.04, 0.05); });
  if ($('setInvert')) $('setInvert').addEventListener('change', () => { SETTINGS.invert = $('setInvert').checked; saveSettings(); });
  if ($('setFps')) $('setFps').addEventListener('change', () => { SETTINGS.fps = $('setFps').checked; applyLiveSettings(); });
  $('btnCloseSettings').addEventListener('click', closeSettings);
  $('btnSettingsLobby').addEventListener('click', openSettings);
  // REBORN lobby tabs
  document.querySelectorAll('.ltab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.ltab').forEach(x => x.classList.remove('active'));
      tab.classList.add('active');
      ['play', 'locker', 'board', 'stats'].forEach(n => $('tab-' + n).classList.toggle('hidden', n !== tab.dataset.tab));
    });
  });
  $('btnQuitMatch').addEventListener('click', () => location.reload());
  const tips = [
    'Tip: Legendary (orange) weapons hit up to 38% harder.',
    'Tip: Harvest trees and rocks, then build (Q / 🔨) for instant cover.',
    'Tip: The storm hurts more every phase — keep an eye on the minimap.',
    'Tip: Aim down sights (right-click / ◎) for tighter, longer shots.',
    'Tip: Push the mobile stick to the edge to sprint.',
  ];
  let ti = 0;
  setInterval(() => { const el = $('loadingTip'); if (el && !$('loadingScreen').classList.contains('hidden')) el.textContent = tips[++ti % tips.length]; }, 2600);
}

const SUN_DIR_V = new THREE.Vector3(0.5, 0.62, 0.35).normalize();
function slotWeaponId() { const s = currentSlot(); return s && s.kind === 'weapon' ? s.weaponId : null; }

// ---------- REBORN: third-person camera rig + own-character animation ----------
function placeCamera(dt, eyeH, backOverride) {
  if (!G.thirdPerson) {
    G.camera.position.set(G.pos.x, G.pos.y + eyeH + (G.bobOffset || 0), G.pos.z);
    G.camera.rotation.order = 'YXZ';
    G.camera.rotation.set(G.pitch, G.yaw, 0);
    if (G.viewmodel) G.viewmodel.visible = G.mode !== 'bus';
    if (G.selfMesh) G.selfMesh.visible = false;
    return;
  }
  if (G.viewmodel) G.viewmodel.visible = false;
  const back = backOverride || (G.ads ? 2.1 : 4.4);
  const rightOff = G.ads ? 0.55 : 0.95;
  const cy = Math.cos(G.pitch), sy = Math.sin(G.pitch);
  const f = new THREE.Vector3(-Math.sin(G.yaw) * cy, sy, -Math.cos(G.yaw) * cy);
  const right = new THREE.Vector3(Math.cos(G.yaw), 0, -Math.sin(G.yaw));
  const target = new THREE.Vector3(G.pos.x, G.pos.y + eyeH, G.pos.z);
  const desired = target.clone().addScaledVector(f, -back).addScaledVector(right, rightOff);
  desired.y += 0.32;
  const gy = groundAt(desired.x, desired.z, desired.y) + 0.4;
  if (desired.y < gy) desired.y = gy;
  if (!G.camSmooth || G.camSmooth.distanceTo(desired) > 40) G.camSmooth = desired.clone();
  else G.camSmooth.lerp(desired, 1 - Math.exp(-22 * dt));
  G.camera.position.copy(G.camSmooth);
  G.camera.rotation.order = 'YXZ';
  G.camera.rotation.set(G.pitch, G.yaw, 0);
}
function spawnSlideDust() {
  if (G.particles) G.particles.burst(G.pos.clone().setY(G.pos.y + 0.3), 0xd8c9a3, 16, 4, 0.55, -2.5);
}
function updateSelfMesh(dt, t) {
  const m = G.selfMesh;
  if (!m) return;
  const show = G.thirdPerson && G.mode !== 'bus';
  m.visible = show;
  if (!show) return;
  m.position.copy(G.pos);
  const u = m.userData;
  const dx = G.pos.x - (G.lastSelfPos ? G.lastSelfPos.x : G.pos.x);
  const dz = G.pos.z - (G.lastSelfPos ? G.lastSelfPos.z : G.pos.z);
  G.lastSelfPos = G.pos.clone();
  const hSpeed = dt > 0 ? Math.min(16, Math.hypot(dx, dz) / dt) : 0;
  const aiming = G.ads || G.mouseDown || G.buildMode;
  let targetRot = m.rotation.y;
  if (aiming) targetRot = G.yaw + Math.PI;
  else if (hSpeed > 0.7) targetRot = Math.atan2(dx, dz);
  let dy = targetRot - m.rotation.y;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  m.rotation.y += dy * Math.min(1, dt * 14);
  G.selfPhase += dt * (2.2 + hSpeed * 1.5);
  const sw = Math.min(1, hSpeed / 6);
  const sliding = performance.now() < G.slideUntil;
  u.glider.visible = G.mode === 'skydiving' && G.gliding;
  if (G.mode === 'skydiving') {
    u.legL.rotation.x = 0.3; u.legR.rotation.x = -0.2;
    u.armL.rotation.set(-2.5, 0, 0.6); u.armR.rotation.set(-2.5, 0, -0.6);
  } else if (sliding) {
    u.legL.rotation.x = -1.5; u.legR.rotation.x = -0.5;
    u.armR.rotation.x = -1.2 - G.pitch * 0.6;
    u.anim.rotation.x = 0.5;
  } else {
    u.anim.rotation.x = 0;
    u.legL.rotation.x = Math.sin(G.selfPhase) * 0.8 * sw;
    u.legR.rotation.x = -Math.sin(G.selfPhase) * 0.8 * sw;
    const wid = slotWeaponId() || 'pickaxe';
    u.armL.rotation.x = -Math.sin(G.selfPhase) * 0.5 * sw - (aiming && wid !== 'pickaxe' ? 0.85 + G.pitch * 0.35 : 0);
    u.armR.rotation.x = aiming ? -1.4 - G.pitch * 0.75 : -Math.sin(G.selfPhase) * 0.5 * sw + Math.sin(G.selfPhase) * 0.1;
    u.armL.rotation.z = 0.12; u.armR.rotation.z = -0.08;
  }
  const swing = performance.now() - G.swingAt;
  if (swing < 330 && slotWeaponId() === 'pickaxe') u.armR.rotation.x = -1.2 - Math.sin((swing / 330) * Math.PI) * 1.3;
  u.anim.position.y = G.mode === 'ground' ? Math.abs(Math.sin(G.selfPhase)) * 0.07 * sw - (G.isCrouching ? 0.22 : 0) : 0;
}

// GTA-style location banner when entering a named place
function checkLocation(now) {
  if (!G.active || !G.data || G.mode === 'bus') return;
  if (now - (G.lastLocCheck || 0) < 700) return;
  G.lastLocCheck = now;
  let place = null, sub = 'FORTWORLD ISLAND';
  let bestScore = 1e9;
  for (const p of G.data.pois) {
    const d = Math.hypot(G.pos.x - p.x, G.pos.z - p.z);
    if (d < p.r && d / p.r < bestScore) { bestScore = d / p.r; place = p.name; sub = 'FORTWORLD ISLAND'; }
  }
  if (G.pos.y > 42) {
    for (const m of MOUNTAINS) {
      const d = Math.hypot(G.pos.x - m.x, G.pos.z - m.z);
      if (d < m.r * 0.95 && d / m.r < bestScore + 0.25) { place = m.name; sub = 'THE HIGHLANDS · ELEV ' + Math.round(G.pos.y) + 'M'; }
    }
  }
  if (place && place !== G.currentPlace) {
    G.currentPlace = place;
    const b = $('locationBanner');
    $('locationName').textContent = place.toUpperCase();
    $('locationSub').textContent = sub;
    b.classList.remove('hidden');
    b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
    clearTimeout(checkLocation._t);
    checkLocation._t = setTimeout(() => b.classList.add('hidden'), 2800);
  } else if (!place) G.currentPlace = null;
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
  // analog touch joystick (camera-relative)
  if (T.joyX || T.joyY) {
    move.addScaledVector(fwd, T.joyY);
    move.addScaledVector(right, T.joyX);
  }
  const moveMag = Math.min(1, move.length());

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
    if (G.pos.y <= ground) {
      G.pos.y = ground; G.mode = 'ground'; G.gliding = false;
      G.landDip = 0.22;
      if (G.particles) G.particles.burst(G.pos.clone().setY(G.pos.y + 0.3), 0xcbb98a, 18, 4.2, 0.6, -3);
      playNoise(0.12, 400, 0.1);
    }
    placeCamera(dt, 1.62, G.gliding ? 8.5 : 6.5);
  } else {
    // ground movement
    const joyMag = Math.hypot(T.joyX, T.joyY);
    const sprint = G.keys.ShiftLeft || G.keys.ShiftRight || T.sprint || joyMag > 0.92;
    const crouchInput = G.keys.ControlLeft || G.keys.KeyC || T.crouch;
    // SLIDE: crouch while sprinting at speed
    let sliding = now < G.slideUntil;
    if (!sliding && crouchInput && sprint && G.onGround && moveMag > 0.4 && now > G.slideReady) {
      sliding = true;
      G.slideUntil = now + 680;
      G.slideReady = now + 1050;
      G.slideDir = move.clone().setY(0).normalize();
      spawnSlideDust();
    }
    const crouch = crouchInput && !sliding;
    G.isCrouching = crouch;
    let speed = (crouch ? 3.4 : sprint ? 10.6 : 6.8) * (G.ads ? 0.55 : 1) * (moveMag || 1);
    if (sliding) {
      const remain = Math.max(0, (G.slideUntil - now) / 680);
      speed = 7.5 + 6.5 * remain;
      if (move.lengthSq() > 0) { G.slideDir.lerp(move.clone().setY(0).normalize(), 1.6 * dt).normalize(); }
      G.pos.addScaledVector(G.slideDir, speed * dt);
    }
    if (!sliding && move.lengthSq() > 0) { move.normalize(); G.pos.addScaledVector(move, speed * dt); }
    const ground = Math.max(groundAt(G.pos.x, G.pos.z), WATER_Y - 0.4);
    G.velY -= 24 * dt;
    G.pos.y += G.velY * dt;
    if (G.pos.y <= ground) {
      if (!G.onGround) {
        const impact = -G.velY;
        if (impact > 7) {
          G.landDip = Math.min(0.34, impact * 0.016);
          if (G.particles) G.particles.burst(G.pos.clone().setY(G.pos.y + 0.25), 0xcbb98a, impact > 15 ? 20 : 10, 3.6, 0.55, -3);
          playNoise(0.09, 320, Math.min(0.14, impact * 0.008));
        }
      }
      G.pos.y = ground; G.velY = 0; G.onGround = true;
    } else if (G.pos.y > ground + 0.05) G.onGround = false;
    if (G.onGround && G.keys.Space) { G.velY = 8.6; G.onGround = false; G.pos.y += 0.1; G.ads = false; const ab = $('btnAim'); if (ab) ab.classList.remove('on'); playNoise(0.05, 700, 0.028); }
    horizontalCollide(prev);
    // head-bob + footsteps (bob drives first-person cam + character anim)
    G.bobOffset = 0;
    if (move.lengthSq() > 0 && G.onGround) {
      G.stepPhase += dt * (sprint ? 11.5 : 8.5);
      G.bobOffset = Math.abs(Math.sin(G.stepPhase)) * 0.05;
      G.stepAcc += speed * dt;
      if (G.stepAcc > (sprint ? 3.4 : 2.6)) { G.stepAcc = 0; playStep(sprint); }
    }
    G.isSprinting = sprint && move.lengthSq() > 0;
    placeCamera(dt, (crouch || sliding) ? 1.02 : 1.62);
  }
  updateSelfMesh(dt, t);

  // ---- camera polish: ADS FOV, sprint FOV kick, shake, landing dip, sun flare ----
  if (G.mode !== 'bus') {
    const widNow = slotWeaponId();
    const targetFov = G.ads && G.mode === 'ground' ? (widNow === 'sniper' ? 27 : 50) : (G.isSprinting ? 83 : 78);
    if (Math.abs(G.camera.fov - targetFov) > 0.05) {
      G.camera.fov += (targetFov - G.camera.fov) * Math.min(1, dt * 11);
      G.camera.updateProjectionMatrix();
    }
    document.body.classList.toggle('scoping', !!(G.ads && widNow === 'sniper' && G.mode === 'ground'));
    // reload progress ring under crosshair
    const rw = $('reloadWrap');
    if (now < G.reloadUntil && G.reloadTotal) {
      rw.style.display = 'block';
      $('reloadFill').style.width = Math.min(100, (1 - (G.reloadUntil - now) / G.reloadTotal) * 100) + '%';
    } else rw.style.display = 'none';
    G.landDip *= Math.pow(0.0001, dt);
    if (G.landDip > 0.002) G.camera.position.y -= G.landDip;
    if (G.camShake > 0.002) {
      G.camera.position.x += (Math.random() - 0.5) * G.camShake * 0.14;
      G.camera.position.y += (Math.random() - 0.5) * G.camShake * 0.14;
      G.camera.rotation.z += (Math.random() - 0.5) * G.camShake * 0.02;
      G.camShake *= Math.pow(0.001, dt);
    }
  }
  if (G.sunSprite) {
    G.sunSprite.position.copy(G.camera.position).addScaledVector(SUN_DIR_V, 2600);
    const look = new THREE.Vector3(); G.camera.getWorldDirection(look);
    G.sunSprite.material.opacity = Math.pow(Math.max(0, look.dot(SUN_DIR_V)), 6) * 0.9;
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
        const origin = G.thirdPerson
          ? G.pos.clone().add(new THREE.Vector3(0, 1.55, 0)).addScaledVector(dir, 0.7)
          : G.camera.position.clone();
        if (isMelee) { socket.emit('melee', { dir: { x: dir.x, y: dir.y, z: dir.z }, origin: { x: origin.x, y: origin.y, z: origin.z } }); G.swingAt = now; playNoise(0.05, 2500, 0.04); }
        else {
          if (slotItem.mag <= 0) { doReload(); }
          else {
            socket.emit('shoot', { dir: { x: dir.x, y: dir.y, z: dir.z }, origin: { x: origin.x, y: origin.y, z: origin.z } });
            playShot(slotItem.weaponId, false);
            const kick = slotItem.weaponId === 'sniper' ? 0.02 : slotItem.weaponId === 'shotgun' ? 0.014 : 0.0045;
            G.pitch += kick * (G.ads ? 0.55 : 1);
            G.vmKick = slotItem.weaponId === 'sniper' ? 0.22 : 0.11;
            G.camShake = Math.min(0.3, G.camShake + (slotItem.weaponId === 'sniper' ? 0.2 : 0.06));
            G.bloom = Math.min(1, (G.bloom || 0) + 0.5);
            if (G.muzzleLight) { G.muzzleLight.position.copy(origin).addScaledVector(dir, 1.2); G.muzzleLight.intensity = 24; }
            if (G.particles) G.particles.burst(origin.clone().addScaledVector(dir, 1.1), 0xffd76a, 3, 1.6, 0.1, 0);
          }
        }
      }
    }
  }
  G.clicked = false;
  if (G.vmWrap) {
    const target = G.ads && G.mode === 'ground'
      ? { x: 0, y: -0.205, z: -0.5 }
      : { x: 0.32, y: -0.32 + (moveMag > 0 && G.onGround ? Math.abs(Math.sin(G.stepPhase)) * 0.012 : 0), z: -0.55 };
    G.vmKick *= Math.pow(0.000001, dt);
    G.vmWrap.position.x += (target.x - G.vmWrap.position.x) * Math.min(1, dt * 14);
    G.vmWrap.position.y += (target.y - G.vmWrap.position.y) * Math.min(1, dt * 14);
    G.vmWrap.position.z += ((target.z + G.vmKick) - G.vmWrap.position.z) * Math.min(1, dt * 18);
    const sinceSwing = now - G.swingAt;
    let rx = sinceSwing < 330 ? -Math.sin((sinceSwing / 330) * Math.PI) * 1.15 : 0;
    if (now < G.reloadUntil) {
      const widR = slotWeaponId();
      const total = widR && META ? META.weapons[widR].reload : 1;
      const p = Math.min(1, 1 - (G.reloadUntil - now) / total);
      rx += Math.sin(p * Math.PI) * 0.75;
      G.vmWrap.position.y -= Math.sin(p * Math.PI) * 0.09;
    }
    G.vmWrap.rotation.x += (rx - G.vmWrap.rotation.x) * Math.min(1, dt * 22);
    G.vmWrap.rotation.z = Math.sin(t * 1.7) * 0.006;
    $('crosshair').style.transform = `translate(-50%,-50%) scale(${1 + (G.bloom || 0) * 0.7 + moveMag * 0.12})`;
    $('crosshair').style.opacity = G.ads && slotWeaponId() === 'sniper' ? 0.25 : 1;
    G.bloom = Math.max(0, (G.bloom || 0) - dt * 5);
  }
  if (G.world && G.world.updateWorld) G.world.updateWorld(t, dt, G.camera.position);
  updatePollen(t);
  checkLocation(now);
  if (G.particles) G.particles.update(dt);

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
    const pr = $('prompt'); pr.innerHTML = `${touchEnabled() ? '✋ LOOT —' : '[E] Pick up'} <b style="color:${it.kind === 'weapon' ? RARITY_COLORS[it.rarity || 0] : '#ffe082'}">${label}</b>`;
    pr.classList.remove('hidden');
  } else $('prompt').classList.add('hidden');

  // remotes: interpolation + procedural walk/aim animation
  for (const r of G.remotes.values()) {
    const u = r.mesh.userData;
    const before = u.lastPos ? u.lastPos.clone() : r.mesh.position.clone();
    r.mesh.position.lerp(r.target, 0.4);
    const moved = r.mesh.position.distanceTo(before);
    u.lastPos = r.mesh.position.clone();
    const speed = dt > 0 ? Math.min(14, moved / dt) : 0;
    u.speed += (speed - u.speed) * 0.25;
    u.phase += dt * (2.4 + u.speed * 1.35);
    const sw = Math.min(1, u.speed / 6);
    if (r.mesh.userData.glider.visible) {
      u.legL.rotation.x = 0.25; u.legR.rotation.x = -0.15;
      u.armL.rotation.set(-2.6, 0, 0.7); u.armR.rotation.set(-2.6, 0, -0.7);
      u.anim.position.y = Math.sin(t * 2.2) * 0.08;
    } else {
      u.legL.rotation.x = Math.sin(u.phase) * 0.75 * sw;
      u.legR.rotation.x = -Math.sin(u.phase) * 0.75 * sw;
      u.armL.rotation.x = -Math.sin(u.phase) * 0.55 * sw - (r.weapon !== 'pickaxe' ? 0.9 + (r.pitch || 0) * 0.4 : 0);
      u.armR.rotation.x = -1.38 - (r.pitch || 0) * 0.75 + Math.sin(u.phase) * 0.12 * sw;
      u.armL.rotation.z = 0.12; u.armR.rotation.z = -0.08;
      u.anim.position.y = Math.abs(Math.sin(u.phase)) * 0.07 * sw;
      u.anim.rotation.x = sw * 0.06;
    }
    if (r.yawTarget !== undefined) {
      let dy = r.yawTarget - (r.mesh.rotation.y || 0);
      while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      r.mesh.rotation.y += dy * 0.4;
    }
  }

  // tracer bolts fade (pooled)
  for (const tr of G.tracers) {
    if (tr.ttl <= 0) { if (tr.mesh) tr.mesh.visible = false; continue; }
    tr.ttl -= dt;
    if (tr.mesh) tr.mesh.material.opacity = Math.max(0, tr.ttl / 0.085) * 0.95;
    if (tr.ttl <= 0 && tr.mesh) tr.mesh.visible = false;
  }
  if (G.muzzleLight && G.muzzleLight.intensity > 0) G.muzzleLight.intensity *= Math.pow(0.000001, dt);

  // use bar
  if (useDur) {
    const p = (performance.now() - useStart) / useDur;
    $('useBar').style.width = Math.min(100, p * 100) + '%';
    if (p >= 1) { useDur = 0; $('usingBox').classList.add('hidden'); }
  }

  // FPS meter + dynamic resolution (keeps mobile smooth)
  G.frameCount++;
  G.fpsTimer += dt;
  if (G.fpsTimer >= 0.5) {
    const fps = G.frameCount / G.fpsTimer;
    G.fpsEMA += (fps - G.fpsEMA) * 0.5;
    G.frameCount = 0; G.fpsTimer = 0;
    if (SETTINGS.fps) $('fpsBox').textContent = Math.round(G.fpsEMA) + ' FPS';
    G.adaptT = (G.adaptT || 0) + 0.5;
    if (G.adaptT >= 2 && G.renderer) {
      G.adaptT = 0;
      const cap = qualityPreset().pixelRatio;
      if (G.fpsEMA < 42 && G.dynRatio > 0.75) { G.dynRatio = Math.max(0.75, G.dynRatio * 0.85); G.renderer.setPixelRatio(G.dynRatio); }
      else if (G.fpsEMA > 57 && G.dynRatio < cap) { G.dynRatio = Math.min(cap, G.dynRatio * 1.12); G.renderer.setPixelRatio(G.dynRatio); }
    }
  }

  // compass (chip + scrolling tape)
  const dir2 = new THREE.Vector3(); G.camera.getWorldDirection(dir2);
  const bearing = ((Math.atan2(dir2.x, -dir2.z) * 180 / Math.PI) + 360) % 360;
  const card = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(bearing / 45) % 8];
  $('compass').textContent = `${card} ${Math.round(bearing)}°`;
  const tape = $('compassTape'), strip = $('compassStrip');
  if (tape && strip) tape.style.transform = `translateX(${strip.clientWidth / 2 - (bearing + 180) * 3}px)`;

  // send movement @ 20Hz
  if (socket && now - G.lastMoveSend > 50 && G.mode !== 'bus') {
    G.lastMoveSend = now;
    socket.emit('move', { x: +G.pos.x.toFixed(2), y: +G.pos.y.toFixed(2), z: +G.pos.z.toFixed(2), yaw: +G.yaw.toFixed(3), pitch: +G.pitch.toFixed(3), skydiving: G.mode === 'skydiving', gliding: G.gliding, onGround: G.onGround });
  }

  // minimap @ 5Hz
  if (now - G.lastMinimap > 200) { G.lastMinimap = now; drawMinimap(); }

  if (G.renderer && G.scene) renderFrame(G.scene, G.camera);
}

function buildMinimapBase() {
  if (!G.data) return;
  const S = 190;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
    const wx = (px / S) * 4000 - 2000, wz = (py / S) * 4000 - 2000;
    const h = terrainHeight(wx, wz);
    let r, g, b;
    if (h < -1.5) { r = 38; g = 110; b = 190; }
    else if (h < 1.2) { r = 224; g = 203; b = 150; }
    else if (h > 118) { r = 240; g = 246; b = 253; }
    else if (h > 62) { const tt = (h - 62) / 56; r = 128 + tt * 60; g = 122 + tt * 62; b = 112 + tt * 66; }
    else {
      const tt = Math.min(1, h / 62);
      r = 84 + tt * 40; g = 148 + tt * 30; b = 58 + tt * 20;
      if (Math.sin(wx * 0.02 + wz * 0.017) > 0.55) { r += 18; g += 22; }
    }
    const i = (py * S + px) * 4;
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // mountain peak markers
  ctx.fillStyle = '#eaf4ff';
  ctx.strokeStyle = 'rgba(20,30,50,0.8)'; ctx.lineWidth = 0.8;
  for (const m of MOUNTAINS) {
    const x = (m.x + 2000) / 4000 * S, y = (m.z + 2000) / 4000 * S;
    ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x - 3.4, y + 2.6); ctx.lineTo(x + 3.4, y + 2.6); ctx.closePath();
    ctx.fill(); ctx.stroke();
  }
  ctx.font = '800 7.5px Segoe UI'; ctx.textAlign = 'center';
  for (const p of G.data.pois) {
    const x = (p.x + 2000) / 4000 * S, y = (p.z + 2000) / 4000 * S;
    ctx.fillStyle = 'rgba(20,24,40,0.8)';
    ctx.beginPath(); ctx.arc(x, y, 2.4, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(p.name.split(' ')[0].toUpperCase(), x, y - 4);
  }
  G.minimapBase = cv;
}
function drawMinimap() {
  const cv = $('minimap'); if (!cv || !G.data) return;
  const ctx = cv.getContext('2d');
  const S = cv.width, W2C = S / 4000;
  if (G.minimapBase) ctx.drawImage(G.minimapBase, 0, 0);
  else { ctx.fillStyle = '#69a83f'; ctx.fillRect(0, 0, S, S); }
  const scx = (G.storm.cx + 2000) * W2C, scz = (G.storm.cz + 2000) * W2C, sr = Math.max(2, G.storm.radius * W2C);
  ctx.beginPath();
  ctx.rect(0, 0, S, S);
  ctx.arc(scx, scz, sr, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(150,60,255,0.34)';
  ctx.fill('evenodd');
  ctx.strokeStyle = '#e2a6ff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(scx, scz, sr, 0, Math.PI * 2); ctx.stroke();
  for (const r of G.remotes.values()) {
    if (!r.mesh.visible) continue;
    ctx.fillStyle = '#ff5252';
    ctx.beginPath(); ctx.arc((r.target.x + 2000) * W2C, (r.target.z + 2000) * W2C, 2.4, 0, 7); ctx.fill();
  }
  const mx = (G.pos.x + 2000) * W2C, mz = (G.pos.z + 2000) * W2C;
  const fx = -Math.sin(G.yaw), fz = -Math.cos(G.yaw);
  ctx.fillStyle = 'rgba(255,210,63,0.30)';
  ctx.beginPath(); ctx.moveTo(mx, mz);
  ctx.lineTo(mx + (fx * 0.8 - fz * 0.45) * 13, mz + (fz * 0.8 + fx * 0.45) * 13);
  ctx.lineTo(mx + (fx * 0.8 + fz * 0.45) * 13, mz + (fz * 0.8 - fx * 0.45) * 13);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffd23f';
  ctx.beginPath(); ctx.arc(mx, mz, 3.6, 0, 7); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4; ctx.stroke();
}

function buildCompassTape() {
  const tape = $('compassTape');
  if (!tape) return;
  const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
  let html = '';
  for (let d = -180; d < 540; d += 5) {
    const norm = ((d % 360) + 360) % 360;
    const x = (d + 180) * 3;
    if (norm % 45 === 0) html += `<span class="card" style="left:${x}px">${names[norm]}</span>`;
    else if (norm % 15 === 0) html += `<i style="left:${x}px"></i>`;
  }
  tape.innerHTML = html;
}

// ---------------- boot ----------------
(async function boot() {
  buildCompassTape();
  initTouchControls();
  initSettingsUI();
  document.addEventListener('pointerdown', () => { if (currentUser) audio(); }, { once: true });
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
      startMenuScene();
      return;
    } catch { localStorage.removeItem('fortworld_token'); token = null; }
  }
  show('authScreen');
  startMenuScene();
})();
