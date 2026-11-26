# Dropzone X

A Fortnite-style **browser battle royale**: drop from the Battle Bus onto a huge island, loot weapons, harvest materials, build cover, survive the storm — last one standing gets the Victory Royale.

![stack](https://img.shields.io/badge/stack-Node%20%2B%20Socket.IO%20%2B%20Three.js-blue)

## ▶️ Play

```bash
npm install
npm start
# open http://localhost:3000
```

Create an account, sign in as a guest, or log back in anytime — stats, level, XP, V-Bucks and skins persist between sessions. **Guest accounts are noob accounts**: instant play with the default loadout and basic match stats, but no leveling — no XP, level-ups or V-Bucks progression until you create a real account.

## 🎨 Key-Art Look (matches the Dropzone X hero art)

The playable island is graded to match the generated key art (`public/img/hero.jpg`): turquoise sea, emerald-green lowlands with lime highlights, golden beaches, a lower snowline so the peaks read as one towering white massif, pink-gold sunset clouds, warm golden-hour sun, red/orange town rooftops, lavender distance haze, a saturation + warmth pass in the post pipeline, and the Battle Bus balloon repainted teal-and-white like the art.

## ☁️ Supabase Setup (full backend — accounts, stats, cosmetics)

Dropzone X can store **everything** in Supabase Postgres: accounts, stats, level/XP, V-Bucks, skins, characters and armor (`players` table) plus match history (`matches` table). Without Supabase env vars it uses the local JSON database in `data/`, so it still runs anywhere.

1. Go to [supabase.com](https://supabase.com) → sign in → **New project**. Pick a name (e.g. `dropzone-x`), set a database password, choose a region, and wait ~1 minute for provisioning.
2. In your project, open **SQL Editor → New query**, paste the entire contents of [`supabase/schema.sql`](supabase/schema.sql), and click **Run**. This creates the `players` and `matches` tables with Row Level Security locked down (only the server can touch them).
3. Open **Project Settings → API** and copy two values: the **Project URL** and the **`service_role` key** (under "Project API keys"). ⚠️ The service-role key is a master key — server environment only, never put it in browser code, chat, or git.
4. Give them to the game server as environment variables (see [`.env.example`](.env.example)):
   ```bash
   SUPABASE_URL=https://your-project-ref.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```
   Locally you can put them in a `.env`-style export before starting; on a host (Render/Railway/Fly/etc.) add them in the dashboard's Environment settings.
5. Start the game: `npm install && npm start`. The console should print `☁️ Supabase connected`. Any existing local accounts in `data/users.json` are **migrated automatically** on first connect.
6. Verify: open `http://localhost:3000/api/health` — it should return `{"ok":true,"backend":"supabase"}`. Create a guest account, play, then check **Table Editor → players** in Supabase to see the row appear. If Supabase is ever unreachable, the server logs the error and safely falls back to the local JSON database.

## ▲ Deploy on Vercel

> Guest play and registration work on Vercel with **zero configuration**
> (the data layer detects the read-only filesystem and falls back to the
> temp dir). Accounts are then ephemeral per serverless instance, so set
> the Supabase env vars below for real persistence.

The repo is Vercel-ready (`vercel.json` + `api/index.js` serverless entry; the same Express app also runs long-lived via `npm start`).

1. Go to [vercel.com](https://vercel.com) → **Add New → Project** → import this GitHub repo. Framework preset: **Other**. No build command needed.
2. In **Settings → Environment Variables**, add `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` (the public/publishable key) and a strong `JWT_SECRET` (recommended — without Supabase, accounts live in the temp dir and are ephemeral per instance).
3. **Deploy**. Your homepage, accounts, shop, leaderboard and stats all run from Vercel + Supabase — and so do matches (see Vercel Play below).

### ⚡ Vercel Play — matches with no game server at all

Vercel functions are short-lived and stateless, so Socket.IO match rooms (which live in server memory) can't run there. Dropzone X therefore ships a second transport that the client picks automatically when no game server answers:

- **Live lobby** — Supabase Realtime presence + chat: you see which real players are online and can talk to them before dropping.
- **Bot-filled matches, simulated in your browser** — `public/js/solo.js` is a port of the authoritative room (Battle Bus, 23 tiered bots, wild mobs, loot, storm, building, harvesting) speaking the exact same event protocol, so the full game renders identically.
- **Real progression** — at match end the client posts the result to `POST /api/match/result` (JWT-guarded, hard-capped, rate-limited), which grants the same XP, +30 V-Bucks per kill and +50 win bonus a hosted match would. Guests keep basic stats only — no XP/V-Bucks progression, as everywhere.

Trade-offs, honestly: opponents in a Vercel Play match are bots, not other humans, and results are client-reported (caps + rate limits keep farming pointless). For real human-vs-human matches, run the same code on a persistent host — Render / Railway / Fly / a VPS — with `npm start`; the client prefers a real Socket.IO server whenever one is reachable, and `?server=<url>` still forces a specific game server.

### "I'm not running npm start" — playing without a terminal

- **This repo's hosted preview**: nothing to run — the server is already up.
- **Vercel-only deploy**: just open the site and press PLAY — Vercel Play (above) handles matches, lobby chat and progression. Nothing else to set up beyond the env vars in step 2.
- **Optional — real multiplayer matches**: deploy the game server on Render (Blueprint → this repo → set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET` → Deploy; free tier sleeps when idle, first match of the day takes ~30 s to wake), then open your Vercel site once as `https://your-site.vercel.app/?server=https://dropzone-x-server.onrender.com` — the browser remembers the game server from then on. Make sure `JWT_SECRET` and the Supabase values are **identical** in Vercel and Render, or the game server will reject website logins.

## ⚔️ Combat & Progression Update

- **Solid world** — tree trunks and boulders now block bullets and bodies
  (server raycasts + bot/mob push-out; client colliders mirror them, and you
  can stand on boulders). Felled trees stop blocking.
- **Map shaders** — terrain vertex shading now blends per-zone biome tints
  (ash, marsh, desert, lush…) with the terrain stamps, plus craggy rock
  jitter on the mountains.
- **Mountain detail** — the massifs are dressed like the authored maps:
  ~550 extra boulders/crags/scree and alpine pines (all solid, all loot-free
  wilderness). Island totals: 1,257 trees · 1,353 rocks.
- **HUD 2.0 (Derc)** — the old gold HUD is fully merged into the Derc
  monochrome dashboard: glass chips for storm/alive/kills, numeric HP/shield
  bars, big ammo counter, white kill banner, and a `+30 🪙` V-Bucks toast.
- **Levels & daily reward** — XP bar under your lobby name (multi-level
  engine, +100 V-Bucks per level). Daily reward (UTC day): **40 V-Bucks +
  60 XP**, streaks add +5/+5 per day capped at +25/+40 — useful, never OP.
  Guests (noob accounts) can't claim, as always.
- **Pistol start** — everyone drops with a Pistol in slot 2 (12 rounds +
  light ammo). No more defenceless landings.
- **10 guns** — new: Burst Assault Rifle, Hand Cannon (revolver), Pump
  Shotgun, Marksman Rifle — all in the loot pool with rarities.
- **Kill = 30 V-Bucks** — every elimination credits your account instantly
  (registered accounts; watch the toast).
- **Realistic bots** — each bot rolls a tier: ~35% **noob** (slow reactions,
  wild aim), ~40% **mid**, ~25% **pro** (fast reactions, strafing, combat
  hops, heals and disengages when hurt). Smooth turn rates, reaction delays
  and burst discipline replace the old snap-aim.
- **Mobs (PvE)** — 34 wild mobs per match (Wild Boars + tougher Night
  Stalkers) roam POIs and wilderness, aggro and bite fighters, and drop loot
  when killed. They're shootable targets with HP bars.

## 🗺️ Expansion Zones

Six expansion landmasses ring Dropzone Island as full playable POIs, stamped
into the shared server/client terrain (identical height math both sides):

| Zone | What you get |
|---|---|
| **Ashen Highlands** | Seeded Perlin + hydraulic-erosion highlands (baked offline), rust-industrial town, loot-rich (14 spawns) |
| **Arena** | Flat PvP arena bowl with an authored block layout as buildings |
| **Silence Vale** | Valley terrain + 95 authored trees |
| **Gulled** | Gulch terrain, orange desert town |
| **Loner** | Midnight marsh with ponds, blue-grey outpost (flagged "night zone" in-game) |
| **Drift** | Coastal terrain + authored trees |

Each zone is a 480 m landmass with a smooth blend ring, its own building
colour, loot spawns, and a minimap label. The `.umm` map files (terrain
heightfield + props + blocks) are parsed directly, and the erosion
heightfield is generated offline — both are baked into relative height
stamps anchored to the native terrain at runtime.

Re-bake:

```bash
node tools/bake_maps.mjs <dir-with-.umm-files>   # writes server/maps_data.js + public/js/maps_data.js
```

## ⛰️ The Highlands (GTA-scale terrain pass)

- **Six playable mountain massifs** baked into the shared terrain function (server physics, bots, loot and client all agree): Mount Apex (288 m), Kings Crown (243 m), Titan Peak (218 m), Razorback Ridge (207 m), Verde Highlands (205 m) and Solstice Peaks (175 m) — now shaped like real peaks: 3 radiating arête ridges each (Everest-style), fluted valleys, steep summit pyramids, and soft-terraced **cliff bands with benches and sheer drops**, plus geological strata coloring, talus fields of fallen rock at cliff bases, jagged summit crags, scree aprons, and snowfields above ~110 m that settle on the ledges
- **Layered distant ridge backdrops** ringing the island for that open-world horizon depth, plus drifting clouds and birds circling thermals over the summits
- **~5,000 decorative pines** thickening on mountain slopes (above the harvestable treeline rules), 1,000+ cliff boulders on steep faces
- **Two animated waterfalls** that carve their own downhill path from the highlands with scrolling foam shaders and plunge-pool glow
- **Summit landmarks**: an observatory on Mount Apex and a radio tower with blinking aviation beacon on Titan Peak (both solid), mountain name labels in-world, peak markers on the minimap, and GTA-style **location banners** ("MOUNT APEX — THE HIGHLANDS · ELEV 214M") as you explore
- The Battle Bus now cruises at 345 m to clear the peaks — sniper nests on the summits are very real

## 🎬 AAA Presentation Pass

- **Procedural PBR textures** generated in-code (no downloads): building facades with lit windows, asphalt roads connecting every POI, concrete plazas, wood/stone/metal build materials, terrain micro-detail bump mapping
- **Living island**: ~16,000 wind-swaying grass instances, bushes, flowers, two-layer foliage trees, instanced cars/crates/street-lamps with additive glow, distant mountain ring, drifting low-poly clouds
- **Custom GLSL**: fbm-cloud sky with sun disc & cirrus, normal-perturbed water with sun specular + glitter, storm wall with swirling noise and lightning flashes, rarity loot beams
- **Cinematic camera & combat feel**: ADS (right-click) with per-weapon FOV, sprint FOV kick, recoil, camera shake, landing dips, head-bob, footsteps, muzzle/impact/elimination particles, floating damage numbers, kill banner, sun lens flare, CSS colour-grade vignette
- **Animated characters**: articulated arms/legs with procedural walk cycles, aim poses, per-weapon gun models, backpacks, visors, floating health bars
- **Layered procedural audio**: per-weapon gunshot synthesis with distance falloff, footsteps, hits, kills and UI — zero audio assets
- **Performance scaling**: Cinematic / Balanced / Performance presets + dynamic resolution that adapts to your FPS (⚙️ Settings, or the lobby)

## 📱 Mobile Controls

Full touch support, auto-detected (also switchable in Settings):

- **Left virtual joystick** (dynamic origin) — move; push to the edge to sprint
- **Drag the right half of the screen** to look/aim
- **🔥 FIRE** (shoot/use/build), **◎ AIM** toggle, **⬆ JUMP** (also glider + leave-bus), **✋ LOOT**, **⟳ RELOAD**, **✚ USE**, crouch & sprint toggles
- **🔨 BUILD** mode with on-screen shape/material buttons; tap inventory slots to swap weapons
- Big **🪂 JUMP FROM BUS** button, rotate-to-landscape prompt, safe-area-aware HUD, fullscreen button, haptic feedback on hits/pickups
- Mobile defaults to the Balanced graphics preset with dynamic resolution for smooth play

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

## 🏙️ DROPZONE X — Towns, Rivers & Landing Page
- **The game is now Dropzone X**: professional landing page (hero key art, live 3D island behind it, stats strip) and **Discord community: https://discord.gg/rHvJcQAeAN** (nav, lobby, end screen, footer)
- **Three flowing rivers** carved into the shared terrain (Apex River, Titan River, Verde Creek) with animated water ribbons, wet banks, and full swimming; river-name location banners
- **Towns feel alive**: denser building layouts, wooden welcome signs with every town's name, benches, bins, hydrants and plaza hedges
- **Atmosphere**: matched sky/fog horizon color (0xb9cfe9, 260–3500 m) for true aerial perspective; **texel-snapped shadow follow** (no more shadow swimming) with quality-scaled shadow frustums
- **More clutter**: 2,400+ pebbles, fallen twigs & branches, plus everything from the detail pass
- **Real GLB models**: the pickaxe is now a true binary glTF model (`public/models/pickaxe.glb` — curved steel blade, tapered wooden handle, leather grip wraps, PBR materials) loaded by a built-in dependency-free GLB loader (`public/js/gltf.js`), with the old procedural mesh kept only as an offline fallback

## 🧍 Characters, Armor Cosmetics & Enemy Characters
- **4 playable characters** in the Locker: Rookie Ranger (balanced, cap), Viper Scout (slim, hooded), Bulwark Heavy (bulky, full helmet) and Specter Operative (sleek, glowing mask) — each with its own body build, headgear and skin tone, previewed live in the 3D lobby showcase
- **5 armor cosmetics** layered over your character: pauldrons, plated chests, belts, forearm/shin guards, back plates, glowing power cores — up to the golden **Solar Champion** with a radiant halo and the blackened **Obsidian Warplate** with spiked pauldrons. Pure style, stats stay fair
- **Full cosmetic economy**: characters and armor are bought/equipped with V-Bucks in the Locker (persisted per account alongside skins; older accounts are auto-migrated)
- **Enemy characters**: bots no longer wear random player skins — they spawn as 4 hostile archetypes (**Wasteland Raider, Iron Marauder, Warhound, Void Reaper**) with scrap/war/void armor, glowing visors, horns/spikes/fins and red nameplates, broadcast in snapshots so every client renders them identically

## 🔄 REBORN — Third-Person Revamp
- **Third-person over-shoulder camera** (toggle `V` for first-person): you actually see your skin, third-person shooting originates from your character
- **Living 3D lobby**: the real island (terrain, waterfalls, buildings, trees) orbits behind a 3-second character showcase wearing your equipped skin, tabbed menus (Play / Locker / Leaderboard / Stats)
- **Movement tech**: sliding (Ctrl/C while sprinting), smoother camera smoothing + look-ahead shoulder ADS
- **Combat feedback upgrades**: glowing tracer bolts + pooled muzzle point-lights, proper sniper scope overlay, reload progress bar, fixed remote-player facing, brighter Fortnite-style grass/palette
- Bullet origin is now your character's body, crosshair-true in third person

## ✨ FULLY GREAT — Visuals Pass
- **Hand-rolled post-processing pipeline** (pure three.js core, no addons): HDR scene target with 4×MSAA → soft-threshold bright pass → two-scale gaussian **bloom** → **screen-space god rays** ray-marched from the real sky sun (terrain occlusion comes free from the bright buffer) → ACES filmic tonemap, saturation/contrast grade, vignette, chromatic aberration whisper, film grain
- **Real grass**: instanced blade tufts (3 tapered blades, up-facing Fortnite-style normals, dark-base→bright-tip gradient), **travelling wind gusts** + per-tuft flutter in the vertex shader, camera-distance fade, up to ~46k tufts on Cinematic; pine canopies sway too
- **Atmosphere**: sun glitter on water feeds the bloom, floating pollen/light motes drift around the player, sun lens sprite
- Quality-aware: Cinematic = full rays + strong bloom, Balanced = cheaper rays, Performance = direct render; toggle in **Settings → Post FX (bloom + god rays)**

## 🌾 Detail & Sound Pass
- **Singular grass blades**: every instance is ONE blade in a camera-wrapped infinite meadow (up to ~46k blades) fed by a baked terrain heightmap — always dense at your feet, swaying in gusts, glowing when backlit by the sun, hidden under water / in plazas / on cliffs automatically
- **Map micro-detail**: procedural multi-scale ground speckle + dry patches on the terrain shader, instanced pebbles & ground clutter, denser bushes and flowers
- **Full soundscape (100% procedural, zero audio files)**: looping wind that rises when you skydive/glide, stereo birdsong, chill menu chord-pad music, per-weapon gunfire, reload clicks, footsteps, UI clicks — all unlocked properly on first interaction and routed through the volume setting

## 🏃 MOVEMENT 2.0
- **Velocity-based movement** replaces instant velocity: smooth acceleration/deceleration curves, true momentum, and Quake-style air control (steer in the air without losing speed)
- **Forgiving jumps**: coyote time (120 ms), jump buffering (150 ms), variable jump height (tap = hop, hold = full jump), falls faster than it rises for snappy arcs
- **Momentum sliding**: tap crouch at sprint speed to dive — slides steer, accelerate downhill, and a slide-jump keeps your speed; landing from a glide carries momentum into the run
- **Swimming**: deep water slows you, floats you at the surface, and lowers the camera
- **Feel**: speed-scaled footsteps & head-bob, smoothed crouch/slide camera height, strafe-lean camera roll, speed-based FOV stretch, walls bleed off velocity instead of sticking

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
| Right-click (hold) | Aim down sights |
| P | Settings (graphics, sensitivity, volume, touch) |

On touch devices an on-screen joystick + buttons replace the keyboard/mouse — see **Mobile Controls** above.

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
