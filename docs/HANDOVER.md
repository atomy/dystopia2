# Dystopia 2 handover: milestones 2 and 3

This document is for whoever continues the project, human or agent. It covers:

- where the vertical slice (M1) stands;
- how to work in the repo;
- what bit us during M1;
- a concrete plan for **M2** and **M3**.

Read it alongside [DESIGN.md](DESIGN.md), which records the decisions, and [research/dystopia-original.md](research/dystopia-original.md), which has the original game's numbers.

Status as of 2026-09-26: M1 is complete. `main` is at `aa8d080` plus this document, and it has been pushed to `github.com/atomy/dystopia2`, which is a **public** repo.

---

## 1. Ground rules

- **Public repository:** never commit secrets, tokens, credentials or private hosts, and scan before every push.
- **Git:**
  - Commit on the current branch (`main`); don't create feature branches unless asked.
  - Commit messages must **not** carry a `Co-Authored-By: Claude …` trailer.
  - Push only when the user asks.
- **Faithful first:** follow the original's numbers (see the research doc) unless DESIGN.md §9 lists a deliberate change.
- **Ask before big feature work:** the owner likes to be questioned about requirements up front. Ask about open design questions (listed per milestone below) before building.
- **Long sessions:** the owner asked to be reminded to run `/compact` at milestones, and wants a progress file kept so compaction loses nothing.

## 2. Running, testing, debugging

```bash
npm install
npm run dev                  # server :9090 (tsx watch) + Vite client :5173
npm test                     # vitest: 22 tests (shared movement/cyber/codec, server rules, bot match)
npm run typecheck            # or per package: npx tsc -p packages/<shared|server|client> --noEmit; npx tsc -p tools --noEmit
npm run build && npm start   # production: one port serves client + maps + ws
docker compose up -d --build # VPS
```

- **LAN or VM access:** when the dev box is a VM, open `http://<vm-ip>:5173` from the desktop, not `localhost`. Vite listens on all interfaces and proxies `/ws`, `/maps` and `/api` to `:9090`.
- **Port conflicts:** if `npm run dev` reports a port in use, another dev server (for example one started by an agent through `.claude/launch.json`) is already running.
- **Headless bot match:** `npx tsx packages/server/scripts/botsim.ts <minutes> <botsPerTeam>` runs the real room loop far faster than real time and prints stage changes. `VERBOSE=1` prints every bot's goal, and `TRACE=<name>` traces one decker's cyber state.
- **Visual and end-to-end checks:** `node tools/drive.mjs <outDir> '<json steps>'`. It runs the installed Chrome headless with SwiftShader and supports these steps:
  - `wait`, `until` (JS condition), `drive` (buttons, yaw, pitch, forward, side), `eval`, `key`, `click`, `shot`.
  - `BOTS=0` hosts without bots, which makes runs deterministic; bots grab jack-in points otherwise.
- **Dev hooks:** dev builds expose `window.__d2`:
  - `debugDrive({yaw,pitch,buttons,forward,side,lock})`
  - `debugRoute=[{x,y,z}]`: an autopilot that also steers in cyberspace
  - `debugCam={pos,yaw,pitch}`: a free camera for screenshots
  - `debugLoadout(cls)`
  - `debugState()`
- **Scripts:**
  - `packages/server/scripts/dev-navtest.ts`: nav paths between key spots.
  - `dev-padtest.ts`: jump-pad trajectories.
  - `dev-snapsize.ts`: snapshot bandwidth.
- **The built-in browser pane in the Claude desktop app has no WebGL on this VM.** Use `tools/drive.mjs`. Software rendering runs at about 5–25 fps, so fps numbers there mean nothing.
- **Maps:**
  - Regenerate with `npx tsx tools/genmaps.ts` (`tools/maps/quarantine.ts`, built with `tools/maps/kit.ts`).
  - They open in TrenchBroom; see `tools/trenchbroom/README.md`.
  - Every new entity class or key must be added to `tools/trenchbroom/Dystopia2/d2.fgd`.

## 3. Architecture map

```
packages/shared/src
  math.ts                 Vec3 helpers, angleVectors/vectorAngles (Source conventions), rayAabb, makeRng
  map/mapfile.ts          .map parse/write (Valve 220 + Standard)
  map/brush.ts            convex brushes, face polygons, bevel planes, contents from texture names
  map/collision.ts        swept-AABB trace (Q3 style), BVH, brush models (movers) + ModelFilter (team-pass)
  map/level.ts            Level = world brushes + entities + collision; doorMotion(); parseVec/propNum
  map/builder.ts          box/ramp brush builders for generators
  sim/pmove.ts            Source movement + ledge grab, slide, leg boost; Buttons; UserCmd
  sim/cybermove.ts        relative-gravity cyber movement (up/north frame, zero-g, pads, step-up)
  sim/weapons.ts          weapon FSM (fire timing, ammo, reload, spin, AR heat/burst, grenades, block)
  sim/caps.ts             MoveCaps from class/implants/energy (identical on client + server)
  sim/zones.ts            trigger zones + CyberEnv
  game/defs.ts            ALL tunables: classes, weapons, implants, programs, energy, rules
  net/bytes.ts            ByteWriter/Reader
  net/protocol.ts         JSON messages, PROTOCOL_VERSION, tick rates
  net/snapshot.ts         Snapshot model + binary codec, PF flags, EntKind/EvKind/Snd enums, quantizeCmd
packages/server/src
  main.ts                 http (static client, /maps, /api/rooms, /healthz) + ws, room lifecycle
  room.ts                 Room: tick loop (60 Hz), snapshot fan-out (30 Hz), JSON handlers, bot fill
  game/game.ts            Game: entities, per-command sim (processCmd), implants, damage/kill, waves,
                          objectives & stages, doors/cameras, lag-comp history, snapshotFor()
  game/entities.ts        map entity runtime classes (Door, ForceField, Breakable, Turret, Camera, Jip,
                          Screen, Node, Ice, Crack, Objective, SpawnGroup, Relay) + target:action parsing
  game/combat.ts          hitscan (lag-compensated), melee/block, grenades/EMP, radius damage, turrets
  game/cyber.ts           jack in/out, cyber weapons, node hacking, programs + minigame, ICE traps, crystals
  game/nav.ts             meat nav grid (A*, door gates) + cyber waypoint graph (d2_cyberpath)
  game/bots.ts            bot brains (roles decker/assault; meat + cyber behaviour; cyberJob())
packages/client/src
  main.ts, net.ts, input.ts
  game/client.ts          ClientGame: prediction + replay, interpolation, events -> fx/audio, HUD data,
                          program availability (mirrors server programApplicable), dev hooks
  game/world.ts           ClientWorld: entity states, team filters, predicted step
  render/*                renderer (composer, bloom, grade shader), levelMesh (baked vertex light),
                          materials (procedural canvases), players (rigs, cyber avatars), viewmodel,
                          effects, entities
  ui/hud.ts, ui/menus.ts  DOM HUD and menus
  audio/sfx.ts            procedural WebAudio: 66 one-shots + 8 loops (never ear-checked!)
```

**One server tick:** bots queue commands; each player's queued commands run through `processCmd`, which handles movement, weapons, use and cracking in meatspace, or `cyberCmd` in cyberspace. Then the world thinks: doors, turrets, cameras, jack-in points, projectiles, crystals, rules and waves. Finally the tick records lag-comp history and routes events. Snapshots go out every second tick.

**Client prediction:** each frame is split into commands of at most 40 ms. Each command is run with `ClientWorld.step` (the same shared code the server uses) and sent. On a snapshot the client resets to `local` and replays the unacknowledged commands. Small corrections go into a decaying visual offset.

### Change checklists

- **New weapon:**
  1. `WeaponId` plus a `WEAPONS` entry (`defs.ts`), and a class `primaries` entry.
  2. Bump `WEAPON_COUNT` in `sim/weapons.ts`; the snapshot layout depends on it, so also bump `PROTOCOL_VERSION`.
  3. Fire behaviour in `stepWeapons`, if it's special.
  4. Server hit logic in `combat.ts` (or a new projectile kind).
  5. Client: viewmodel mesh (`viewmodel.ts`), world model (`players.ts` `gunMesh`), `FIRE_SFX`, effects, and the HUD ammo display.
  6. Bot use in `bots.ts`.
- **New implant:**
  1. `ImplantId` plus an `IMPLANTS` entry with a fixed key; implant masks are u16, so there are 6 free bits.
  2. The server effect in `game.ts` (`processCmd` or `thinkPlayers`); drains go in `thinkPlayers`.
  3. A button bit in `Buttons` and in `input.ts` `BINDS`, if it toggles.
  4. HUD implant bar state, and loadout UI (automatic).
  5. The design doc table.
- **New map entity:**
  1. Runtime class in `entities.ts` and registration in `Game.buildEntities`.
  2. `net()` plus an `EntKind`, if clients need its state.
  3. Rendering in `render/entities.ts`.
  4. The FGD.
  5. Bot awareness, if it matters.
- **Wire format change:** bump `PROTOCOL_VERSION`, update the `net.test.ts` round-trip test, and keep `quantizeCmd` in sync with `encodeUserCmds`.

## 4. Invariants and lessons from M1

- **Coordinates:**
  - The simulation is Quake/Source: Z up, 1 unit ≈ 1 inch, yaw 0 = +X, pitch positive = looking down.
  - Rendering converts with `three = (x, z, -y)`.
  - A model faces −Z at `rotation.y = (yaw - 90)°`.
- **Determinism:** shared simulation code must not use `Math.random` or wall-clock time. The client must run **quantized** commands (`quantizeCmd`), or prediction drifts from the server.
- **Trace semantics:** a box sitting *exactly* on a surface counts as start-solid. Spawn at z+1; `PlayerMover.unstick` exists as a safety net.
- **Cyberspace frame:**
  - The avatar carries `up`/`north`, and command angles are local to that frame.
  - When gravity flips, the client re-derives its view angles so it keeps looking the same way in world space (`client.ts` `runLocal`).
  - Cyber gravity uses half-step integration, so arcs are frame-rate independent.
- **Jump pads:**
  - Pad volumes must be taller than the avatar's center height (≥ 40 u).
  - Decals must be `func_illusionary`, because cyber step-up is only 14 u.
  - A pad 330 u from a tube wall with push `(±350, 0, 850)` lands the avatar in the middle of a 192 u tube at the server's mid-height.
- **Bot navigation:**
  - Meatspace nodes come from brush tops with a ±15 u footprint probe, plus sampled stair edges.
  - Doors and force fields are "gates" that `blocked()` checks per team.
  - Small islands get pruned.
  - Bots don't use ledge grabs or the crawl duct (both need a 72 u standing hull for nodes).
- **Cyber bots:**
  - Waypoints are `d2_cyberpath` entities with **directed** `target` links, because pads only go one way. Don't route a walking leg across a pad.
  - Steering must be velocity-aware, since friction is near zero.
  - Waypoints on walls need an "above" check so the bot charges into the wall and flips gravity.
- **Entity ids** are indexes in the `.map` entity list. `level.entities` skips merged world classes, so use `byId` maps and never index the array by id.
- **`NetEnt` meanings** are per kind (`value`, `a`, `b`, `state`); see the `net()` methods in `entities.ts`. ICE trap bits are hidden from teams that haven't scanned them.
- **Lighting:**
  - Baked vertex light is soft-clamped at 0.92 and the bloom threshold is 0.96, so only emissive neon glows.
  - Brighter lights blow out the scene; the old pink spawn is the cautionary example.
- **Client rendering:** `PlayerModel.update()` sets `visible = true`, so apply the first-person hide *after* it.

## 5. Known issues and tech debt (prioritised)

1. **No real-network or real-GPU playtest yet.** Everything was verified headless.
   - Priority for M2 week 1: a LAN session with 2–4 humans. Check feel, prediction corrections, audio mix and fps.
2. **Bandwidth.** A snapshot with 16 players is about **2.5 KB**, which at 30 Hz is **75 KiB/s per client** (`dev-snapsize.ts`). That's fine on a LAN, but too much for a cheap VPS at 8v8.
   - Plan: delta-encode against the last acknowledged snapshot, quantize positions to i16 with 1/8 u precision, and send static entity state only on change.
3. **No interest management.** Stealthed and unseen enemies are sent to every client, which is cheatable. Filter by PVS or line of sight plus TAC/camera reveals.
4. **Bot balance in stage 3.** A defending bot decker with Encryption plus Green ICE often stalls attacking bots for good. Options:
   - Smarter attacker programs: ICE Scan before Breaker (partly done), and Decryptor timing.
   - A second attacker decker.
   - Defenders' ICE decaying over time.
5. **Deferred from the slice:**
   - The jack-in-point live view (render target).
   - A spectator free camera (spectators only get the death camera).
   - Doors never push or carry players; they wait instead.
   - No lag compensation for projectiles.
   - Energy isn't predicted client-side.
6. **Audio was never listened to.** It was only rendered offline to check for errors, so do a mix pass in the first human playtest.
7. **The loadout protocol has unused fields.** `ClientMsg.loadout.primary` and `.programs` exist but are ignored. `weaponsFor(cls)` gives each class *all* its primaries, which in M1 is exactly one. Wire up primary selection in M2.
8. **Minor issues:**
   - The server's `tsx watch` drops all rooms on every file change during development.
   - The client bundle is 733 KB (three.js); code-split if load time matters.

## 6. Milestone 2: content (remaining weapons, implants, a second map)

**Goal:** the full original arsenal and implant set, a primary weapon choice in the loadout, and a second map that uses new objective types.

**Open questions for the owner before starting:**
- Which versions of the numbers: v1.2 or the 1.4/1.5 retunes?
- Should the Rocket Launcher's fly-by-wire mode be in?
- Which map concept for the second map?
- Should implant slot costs change now that there are 14 implants?

### 6.1 Loadout plumbing (do first)

- Add `nextPrimary`/`primary` to `ServerPlayer`, and change `weaponsFor(cls, primary)` so each class gets one primary plus the sidearm, melee weapon and grenades.
- Validate `primary` in `setLoadout`. Add a primary picker to `ui/menus.ts` (`showLoadout`), and let bots pick primaries.
- Bump `WEAPON_COUNT` to about 20 and `PROTOCOL_VERSION` to 2.

### 6.2 Weapons

Numbers are from the research doc §4.1. Headshots (×1.5) apply to the Boltgun, Laser Rifle, Assault Rifle and MK-808.

| Weapon | Class | Implementation notes |
|---|---|---|
| **Boltgun** | L | New projectile `ProjKind.Bolt`: fast, low gravity, **bounces at shallow angles**, sticks in walls (and moving doors). Damage 85, headshot 127, magazine 3 loaded one at a time, 1 rps. **Alt-fire:** detonate the oldest bolt in flight or stuck in a wall (radius 256, 48 damage). Needs projectile hit tests against lag-compensated hitboxes (reuse `traceShot` per tick segment). |
| **Laser Rifle** | L | Hold to charge for 3 s and release at the peak; the beam is visible and audible to others while charging (`PF` flag). 175 max / 263 headshot. Damage scales from 10% at 64 u or less to 100% at 512 u or more (1.4 raised the floor to 20%). Energy ammo with no reload: decide whether it uses the implant energy pool (open question). **Alt-fire:** variable zoom. |
| **Smartlock Pistols** | L | Akimbo automatic pistols: 16 damage, 6.66 rps, magazine 30. **Alt-fire:** fire a tracer (one per pistol); a tagged target is auto-tracked while visible, giving shots a hitbox bias toward it. Server-side lock state per shooter, and a HUD lock indicator. |
| **MK-808** | M | Semi-automatic hitscan with zero spread: 50 / 75 headshot, magazine 8, 0.59 s between shots. **Alt-fire:** zoom (reuse the AR zoom path). |
| **Grenade Launcher** | M | Reuse the grenade projectile: 65 explosive damage (×2 vs armor), radius 225, magazine 4. **Alt-fire:** hold to arm, so the grenade explodes on its next contact. |
| **Tesla Rifle** | M | Short-range lightning, 2 arcs of 7 damage per tick at 10 ticks/s, range 1024 (768 from 1.4), energy ammo. Chain to a second target within about 150 u. **Alt-fire:** a charged ball-lightning projectile the shooter can "whip" around corners (it steers toward the crosshair), radius 320, costs 25 energy. |
| **Ion Cannon** | H | Hitscan with an 8×8×8 hull; damage 120 close falling to 60 far (over 256–2048 u), 2.5 s cycle. **Alt-fire:** zoom. Tracer uses the thick beam effect. |
| **Basilisk** | H | Automatic shotgun, 3 flechettes × 15, 3.33 rps, magazine 12 (15 from 1.4). **Alt-fire:** a flak shell (projectile, about 70 damage, radius 256) that costs 3 bursts. |
| **Rocket Launcher** | H | Laser-guided: the rocket turns toward where the shooter aims, with brief lock-on, and can't lock stealthers. 115 damage plus an explosion of radius 340, 1 rocket, 7–9 s reload. Rockets can be shot down (give the projectile HP). **Alt-fire:** fly-by-wire, steering with the movement keys through a rocket camera, with mid-air detonation. This needs a client camera mode and a "controlled projectile" state in `NetLocal` (it's the hardest weapon). |
| **Spider grenade** | H ×2 | Deploys a crawling mine: `ProjKind.Spider` with ground movement via the nav graph or simple steering. It hunts the nearest *visible* enemy and ignores stealthers. About 92 damage, radius 175, 20 HP (shootable). |

The client work for every weapon is the viewmodel, world model, fire sound, tracer or projectile visual, ammo HUD, and bot usage (range bands per weapon in `bots.ts`).

### 6.3 Implants

Research doc §3.2 has the details.

| Implant | Slot | Classes | Behaviour | Key |
|---|---|---|---|---|
| **Coldsuit** | Body 2 | L, M, H | Passive. Invisible to Thermal Vision (not to thermal turrets, if those are added). +25% energy regeneration (1.4). Can't combine with Stealth. | — |
| **SWT** (Sound Wave Triangulator) | Head 2 | L, M, H | Toggle, 0.75/s. A HUD compass of enemy sounds through walls: red for footsteps, yellow for gunfire, white for impacts, purple for implants. Needs server "sound events" with positions sent to SWT users only. | X (proposed) |
| **Sound Suppressor** | Body 1 | L, M, H | Toggle, 0.5/s. Silences your footsteps, weapons and implant sounds for everyone, and hides you from SWT (impacts are still audible). | Z (proposed) |
| **Wired Reflexes** | Body 1 | L, M, H | Passive. Use the 1.2 version: reloads at 0.75× (the hook `WeaponCtx.reloadScale` already exists), faster ledge grabs, and faster katana block recovery. | — |
| **IFF Info** | Head 1 | L, M, H | Passive. Shows the enemy tag (health, armor, energy, key implants), turret health and enemy grenades. Reuse the HUD marker system. | — |
| **Cortex Bomb** | Head 1 | L, M, H | Passive. Below 25 HP it charges for about 3 s with an audible whine, then explodes for 256 explosive damage at radius 512, killing the user. Cancelled if healed above 25 or killed first; only a weak detonation if no enemy is within 512. | — |

### 6.4 Second map (proposal: `d2_uplink`, inspired by Silo)

The goal is to exercise mechanics the slice lacks:

- a **timed objective** (a launch countdown that defenders can cancel);
- a **hybrid objective** (a meatspace screen and a cyberspace node must both be held);
- a **carryable** item.

New entities:
- `d2_timer`: starts on a trigger, fires targets when it expires, and is cancelled by a `cancel` action.
- `d2_objective` `requires`: a list of objective or node names that must all be satisfied at the same time.
- `d2_carryable` plus `trigger_deliver`: pick up by walking over it, drop on death, return after a timeout.

Draft stages:
1. Destroy a hardware firewall (a breakable) in a guardhouse.
2. Reroute power: a meatspace valve screen **and** a cyberspace node, held together.
3. Deliver the launch key (a carryable) to the silo control room, then hack the launch node to start a 60 s countdown; defenders can cancel it by re-hacking.

Build it with the map kit, or author it by hand in TrenchBroom. The owner may prefer hand-authoring, so ask. Add `d2_cyberpath` waypoints for bots and a bot job for carryables.

### 6.5 Acceptance for M2

- Every weapon and implant works against bots, and bots use them. Unit tests cover damage falloff (Laser Rifle, Ion Cannon), bolt detonation, the Cortex Bomb and Coldsuit versus Thermal.
- Both maps pass a 15-minute `botsim` run with no exceptions, and attackers can win each map at least sometimes.
- A LAN playtest with humans; fold the notes back into DESIGN.md.
- Protocol bumped, and FGD and README updated.

## 7. Milestone 3: art, meta and hosting

**Open questions for the owner before starting:**
- An art direction decision: stay procedural or neon, commission or buy CC0 models, or use AI-assisted assets.
- Whether stats need accounts. The default is no accounts, just callsign plus a local token.
- The VPS target: domain, TLS, region.

1. **Art pass.**
   - Replace `render/players.ts` rigs with glTF characters (per class and team): an `AnimationMixer` driven by the same pose inputs (speed, crouch, air, hang, decked, fire).
   - glTF viewmodels.
   - Upgrade material and texture sets; keep the `d2/<name>` texture keys so maps don't change.
   - Optionally lightmaps later; the vertex bake is the baseline.
   - Proper skybox and street props.
   - A JIP live-view render target (deferred from M1).
2. **Server browser.** `/api/rooms` exists. Add public or private rooms, player counts, map, ping estimates, and a join-by-link flow. Optionally a list across several servers (a tiny registry service).
3. **Persistent stats and awards.** Server-side SQLite on a Docker volume holding per-callsign totals: kills, deaths, captures, hacks, heals, time decked. End-of-round awards (for example "Nurse Betty" for most healing, as in the original). A stats page.
4. **Stopwatch mode (ABBA).** Teams swap sides and the second attacker must beat the first attacker's time. This needs round-pair state in `RulesState` and HUD support.
5. **Hosting.**
   - A Caddy compose profile (automatic TLS for `wss`).
   - Rate limits on the hello handshake and chat.
   - A room idle-timeout config.
   - A basic admin kick/ban by IP for hosts.
6. **Performance and networking.** The delta compression and interest management from §5 (items 2 and 3) are prerequisites for public 8v8 on a small VPS.
7. **Onboarding.** A tutorial ("Lobby"-style map with prompts), loading-screen tips, and colour-blind-safe team colours.

## 8. Suggested order of work

1. A LAN playtest of the M1 slice, then fix the feel and audio issues it finds.
2. M2.1 loadout plumbing, then weapons one at a time (Boltgun, MK-808, GL and Ion are the easy wins; the Rocket's fly-by-wire mode goes last), then implants.
3. Snapshot delta compression (needed before public hosting anyway).
4. The `d2_uplink` entities (timer, requires, carryable), then the map, then bot support.
5. The M3 items in the order the owner prioritises them.
