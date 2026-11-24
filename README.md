# FortWorld

A Fortnite-style **browser battle royale**: drop from the Battle Bus onto a huge island, loot weapons, harvest materials, build cover, survive the storm — last one standing gets the Victory Royale.

![stack](https://img.shields.io/badge/stack-Node%20%2B%20Socket.IO%20%2B%20Three.js-blue)

## ▶️ Play

```bash
npm install
npm start
# open http://localhost:3000
```

Create an account, sign in as a guest, or log back in anytime — stats, level, XP, V-Bucks and skins persist between sessions.

## Features

**Accounts & progression**
- Register / login / guest play (bcrypt password hashing + JWT sessions)
- Persistent stats: matches, wins, kills, top-10s, damage, K/D
- Levels & XP, V-Bucks currency, global leaderboard
- Item shop with 8 unlockable character skins

**Real multiplayer**
- Socket.IO authoritative server (combat, damage, storm, loot, building & harvesting validated server-side)
- Matchmaking rooms: matches start in ~8s and fill to 24 fighters with AI bots so you never wait
- 20 Hz position snapshots with client interpolation, tracers, killfeed, in-match & lobby chat

**The island**
- 4 km × 4 km procedurally-built island (4000×4000 units) with 10 named POIs, 85 buildings, 700+ harvestable trees & rocks
- Battle Bus drop, skydiving + glider, swimming, shrinking storm with escalating damage
- Custom **GLSL shaders**: animated sky with sun & drifting noise clouds, animated water with fresnel + sparkle, scrolling purple storm wall, rarity loot beams
- Dynamic sun shadows, distance fog, POI nameplates

**Gameplay systems**
- 6 guns (Pistol, SMG, Assault Rifle, Shotgun, Sniper, LMG) × 5 rarities + pickaxe
- Shields, medkits & bandages, 4 ammo types, 5-slot inventory
- Harvest wood/stone/metal and **build** walls, floors & ramps (Q / F / X)
- Minimap with storm circle & players, compass, damage vignette, hitmarkers

## Controls

| Key | Action |
|---|---|
| WASD / Mouse | Move / look (click game to lock mouse) |
| Left click | Shoot, swing pickaxe, use consumable, place build |
| Shift / Space / C | Sprint / jump (deploy glider while falling) / crouch |
| F | Jump from Battle Bus |
| E | Pick up loot |
| R | Reload |
| 1–5 | Switch inventory slot |
| Q, then F / X | Build mode: cycle structure / material |

## Architecture

```
server/
  index.js   Express + Socket.IO, JWT auth, matchmaking
  game.js    Authoritative match engine: storm phases, combat raycasts,
             loot, building, harvesting, bot AI, win/stats persistence
  map.js     Deterministic island generation shared by server & client
  weapons.js Weapon / item / rarity definitions & loot rolls
  db.js      JSON-file user store (swap for SQLite/Postgres in production)
public/
  index.html Auth, lobby, shop, HUD & end screens
  js/client.js  FPS controls, physics, HUD, minimap, netcode interpolation
  js/world.js   Terrain, instanced trees/rocks, custom GLSL shaders
  vendor/       Three.js (served locally, no CDN dependency)
```

Client and server agree on terrain through the same deterministic height function in `map.js` / `world.js`, so movement, loot placement, bot AI, bullets and building all line up.

## Production notes

- Set `JWT_SECRET` env var, put the Node process behind HTTPS (Socket.IO works over wss)
- Replace `server/db.js` JSON storage with SQLite/Postgres for concurrent writes at scale
- For multi-process scaling, add the Socket.IO Redis adapter and sticky sessions
