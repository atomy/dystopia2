# Dystopia 2: Design (vertical slice)

This is a browser-based spiritual sequel to the Source mod *Dystopia*. It is a private hobby project, and "Dystopia 2" is a working title.
The facts it builds on are in [research/dystopia-original.md](research/dystopia-original.md). This document records **decisions**.

## 1. Pillars

1. **Two worlds, one fight.** Meatspace pushes need cyberspace hacks, and cyberspace dives need meat bodyguards.
2. **Faithful first.** Numbers and rules follow the original (v1.2, with 1.4 quality-of-life fixes) unless a change is listed in §9.
3. **Readable.** Fix the original's onboarding debt: fixed implant keys, clear usable-vs-decorative screens, bots for low player counts.

## 2. Tech decisions

| Area | Decision |
|---|---|
| Client | TypeScript, three.js, Vite. Neon-greybox art (procedural canvas textures, emissive trims, bloom). |
| Server | Node (TypeScript) authoritative **room server**. "Host game" creates a room code, and friends join with it. |
| Transport | WebSocket. JSON control messages, binary user commands and snapshots. |
| Simulation | 60 Hz tick, snapshots at 30 Hz, client prediction of the local player, 100 ms interpolation of others, lag-compensated hitscan (400 ms max). |
| Space | Quake/Source units and axes (Z up, 1 u ≈ 1 inch). The renderer converts to Y-up. |
| Maps | Quake **.map (Valve 220)** authored in **TrenchBroom** (game config and FGD in `tools/trenchbroom`). Loaded directly as convex brushes; no BSP compile. Collision is swept-AABB against brushes with bevel planes (Q3 style). |
| Players | Up to **8v8** per room. Bots fill teams and can deck. |
| Audio | Procedural WebAudio synthesis with no asset files. |
| Hosting | Docker image plus compose for a VPS (HTTP, WS, and static client from one port). |

## 3. Setting

It is the same war, years later. It's the 2080s: DataTrust has rebuilt after the Vaccine breach and hardened its cyber-libraries with "Quarantine" protocols. The **Punk Mercenaries** attack and the **Corporate Security Forces** defend. Players are still combat clones: that is the diegetic reason for wave respawns.

## 4. Classes (faithful v1.2)

| | Light | Medium | Heavy |
|---|---|---|---|
| Health / Armor | 75 / 25 | 100 / 50 | 140 / 100 |
| Implant slots (head / body) | 5 / 7 | 4 / 4 | 2 / 2 |
| Run speed (u/s) | 250 | 200 | 160 |
| Sprint (Leg Boosters) | 312 | 250 | 200 |
| Respawn penalty | +3 s | +4 s | +6 s |
| Can deck / stealth / ledge grab | yes / yes / yes | yes / no / yes | no / no / no (jumps higher) |
| Slice weapons | Machine Pistol, Shotgun, Katana, 3× EMP | Machine Pistol, Assault Rifle, Katana, 2× Frag | Machine Pistol, Minigun, Fatman Fist |

- **Armor** absorbs 80% of non-explosive damage. Explosives deal ×2 damage to armor. Armor never repairs; "tactical respawn" (the K key) exists.
- **Energy** is 50, or 75 with SCS, and regenerates at 2/s. EMP stops regen and all implants except SCS for 5–20 s, scaled by distance.
- **Friendly fire is on by default**, as a room option.

## 5. Implants (slice set)

Every implant gets a **fixed key that never changes with the loadout**. This fixes a top complaint.

| Implant | Slot / cost | Classes | Energy | Key |
|---|---|---|---|---|
| Cyberdeck | Head 2 | L, M | 0.25/s while decked | F (at a JIP) |
| Enhanced Cyberdeck | Head 3 | L, M | 0.25/s while decked; unlocks all programs and the minigame | F |
| TAC Scanner | Head 3 | L, M | 15 per scan (team-shared ping, range 2048) | Q |
| Thermal Vision | Head 2 | L, M, H | 1/s while on | T |
| Stealth Suit | Body 5 | L | 1/s while cloaked; full invisibility when still or crouch-moving | C |
| Leg Boosters | Body 2 | L, M, H | 1.25/s sprinting; boost jump costs up to 15/20/30 (L/M/H) | Shift (sprint), hold V (charge boost jump) |
| Mediplant | Body 3 | L, M | Teammates: 8 energy for 16 HP (24 on Heavy), range 384. Self: 4 HP free. Paused while decked. | hold G (pulses every 1 s) |
| SCS | Body 1 | L, M, H | Passive, +25 max energy | — |

Stealth cannot be combined with Mediplant. The counters are: Stealth ↔ Thermal/TAC/EMP, and decker ↔ EMP (which ejects them).

## 6. Weapons (slice set)

| Weapon | Class | Primary | Alt-fire | Numbers |
|---|---|---|---|---|
| Machine Pistol | all | Auto hitscan, 6° spread | — | 10 dmg, 10 rps, mag 24 |
| Shotgun | L | 7 pellets × 8 | Double barrel: 14 × 8, double spread | 2.5 / 1.25 shots/s, 6 shells, loaded one at a time |
| Assault Rifle | M | Auto hitscan; RoF ramps 7→13, spread grows | Zoom + 3-round zero-spread burst | 15 dmg (22.5 HS), mag 40 |
| Minigun | H | 3 × 12 flechettes, 10 bursts/s | Pre-spin (slows you) | Mag 100, 1.2 s spin-up |
| Katana | L, M | Directional swing | Block (blocks katana) | 60 (L) / 75 (M), 1.4 swings/s |
| Fatman Fist | H | Hydraulic punch | — | 120, unblockable |
| EMP grenade | L ×3 | Cookable | — | 35 dmg; disables implants and regen; **ejects deckers** |
| Frag grenade | M ×2 | Cookable | — | 105, radius 300 |

Headshots (×1.5) apply to the AR only in this slice. Spread is not affected by movement.

## 7. Movement

- **Source-faithful:** ground and air acceleration, air strafing, and bunny-hop momentum (re-press jump; no auto-hop), crouch-jump, 18 u step-up, gravity 800.
- **Ledge grab** (Light and Medium): grab a ledge in front of you while airborne near the top; press jump to pull up.
- **Crouch slide:** landing crouched above run speed slides with low friction for about 0.8 s.
- **Fall damage** above 580 u/s impact speed. Leg Boosters negate it.
- **Goomba stomp:** landing a charged leg-boost jump on an enemy's head deals 150 damage.

## 8. Cyberspace

### 8.1 Access
- A player with a deck stands at a **Jack-In Point (JIP)**, holds ≥15 energy, and presses F. The avatar appears at the JIP's cyber entry. Press F again to jack out at any time with no penalty.
- **One decker per JIP.** Maps provide **2–3 JIPs per server** (fix).
- The **meat body stays at the JIP, frozen and vulnerable.** If the body dies, the decker dies. An EMP on the body force-ejects them.
- **Decker alarm and cyber mic** (fix): the decker hears meat sounds within 384 u of their body, and gets an alarm plus a HUD indicator when the body takes damage. Teammates get a "decker under attack" ping.
- The JIP hologram turns yellow while occupied and red while locked. *(Deferred: a live render-target view of the decker's screen.)*

### 8.2 Movement (faithful relative gravity)
- **Servers** (big cubes) have gravity. Touching a **gravity tile** (`d2/cyber_floor`) re-orients your personal gravity so that the tile becomes the floor, which lets you walk on walls and ceilings.
- **Links** (tubes, `cyber_zerog` volumes) have no gravity, and some have a flow that pushes you along.
- Friction is near zero. **Hold jump to keep bouncing and accelerating.** There are jump pads and speed pads.
- **Projectile-jump:** your own projectiles knock you back but never hurt you.
- Every decker leaves a **team-coloured trail visible through walls**, which fades when you stand still.

### 8.3 Energy is your life
- Decking drains 0.25/s. Weapons and programs cost energy, and hits drain energy.
- **At 0 you are ejected.** Dumpshock deals **20 damage to meat health**, and the **JIP is locked for 10 s** (per the user's answer). You drop a **crystal** worth half the energy you lost to enemies; it decays, and anyone but you can pick it up.

### 8.4 Cyber weapons

| Weapon | Input | Damage | Rate / cost |
|---|---|---|---|
| Hitscan | Primary (mode A) | 15 | 2 s recharge, 2 energy |
| Shaft | Primary (mode B; R toggles) | 20/s | Continuous, 6 energy/s, range 384 |
| Projectile | Alt-fire | 20 direct + splash (r 256), knockback, splash passes ICE | 1/s, 3 energy |

### 8.5 ICE
- **Map ICE walls:** blue passes Corps, red passes Punks, purple passes both, yellow passes neither. They block cyber fire (projectile splash leaks through). Objectives recolour them.
- **Node ICE:** a node doorway that programs can seal, wedge open or break.

### 8.6 Programs (all 11, plus the minigame)
Programs run at a node screen or its doorway, cost energy over their run time, and can be interrupted by damage. An **Enhanced Cyberdeck** unlocks the full set and a *Simon-says* minigame that cuts run time and cost by up to 50%.

| Program | Kind | Target | Deck | Steps |
|---|---|---|---|---|
| Password Protect | defence | screen | both | 3 |
| Encryption | defence | screen | enhanced | 5 |
| ICE Barrier | defence | doorway | enhanced | 6 |
| ICE Alarm | defence | ICE | both | 6 |
| ICE Mine | defence | ICE | enhanced | 7 |
| Green ICE | defence | ICE | enhanced | 6 |
| Password Cracker | offence | screen | both | 2 |
| Decryptor | offence | screen | both | 4 |
| Wedge | offence | ICE | both | 2 |
| ICE Breaker | offence | ICE | enhanced | 5 |
| ICE Scan | offence | ICE | both | 2 |

Base run time is 0.9 s per step, and cost is 2 energy per step.

### 8.7 What cyber controls
Doors and shortcuts, turret ownership, security cameras (an owned camera reveals enemies in its cone on the owner team's radar), force fields, spawns, and objectives.

### 8.8 Meatspace cracking (fix)
A deck-equipped player can stand in a `trigger_crack` volume and hold Use to crack the linked device slowly (a map-defined time, e.g. 20 s). Taking damage pauses the crack. This means a door or spawn can be taken without anyone jacking in.

## 9. Changes from the original (the fixes)

1. Fixed implant hotkeys.
2. Multiple JIPs per cyber server.
3. Meatspace cracking.
4. Decker alarm plus cyber mic.
5. Bots that play objectives and deck.
6. Spawn waves use the 1.4 rules: a 15 s base, a class penalty, an **18 s cap**, and 5 s when the queue is empty.
7. Usable screens always carry the same bright frame and icon; decorative screens never do.

## 10. Game mode

- **Attack/defend** in stages. On the slice map Punks attack.
- Wave respawns with per-team timers (§9.6). After losing an objective, defenders get a 5 s instant-spawn window.
- The round timer comes from the map (the slice uses 15 min), plus 3 min per completed stage. If time runs out, the defenders win.

## 11. Slice map: `d2_quarantine`

A DataTrust quarantine arcology in the spirit of Vaccine.

1. **Docks:** the main loading-bay door is locked. Hack it open in cyber, crack it in meat (25 s), or take the upper walkway (ledge grab or leg boost) or the maintenance crawlspace. Capturing the docks spawn screen moves the Punk spawn forward.
2. **Security:** the mid-spawn node sits in the **yellow server**, reached from 3 JIPs. Stair turrets can be flipped in cyber. Hacking the mid-spawn node advances the stage.
3. **Core:** in the **red server**, drop the core security (2 turrets and a force field), then destroy the data core in meatspace (breakable, 1500 HP).

## 12. Architecture

```
packages/shared   math, .map parser, brushes, collision, player/cyber movement, defs (classes, weapons, implants, programs), net codec
packages/server   http+ws, rooms, authoritative game (entities, combat, lag comp, cyberspace, programs, bots)
packages/client   three.js renderer, prediction/interp, HUD, menus, WebAudio synth
tools/            map generator (d2_quarantine), TrenchBroom game config + FGD
maps/             .map files (served to clients, loaded by the server)
```

## 13. Controls (as built)

WASD move · Space jump (hold to bounce in cyber) · Ctrl crouch · Shift sprint · V charge boost · Mouse1/2 fire/alt · R reload / cyber weapon mode · E use/hack/crack · 1–4 & wheel weapons · 1–9 in cyber: programs / minigame buttons · F jack in/out · Q TAC · T thermal · C stealth · G mediplant · K tactical respawn · Tab scores · M team & loadout · Y/U chat.

## 14. Milestones

- **M1, the slice (this doc):** everything above.
- **Art pass (now first, see §15.1):** gritty look, AI-generated assets, `d2_quarantine` rebuilt as a city block.
- **M2:** the remaining weapons (Boltgun, Laser, Smartlocks, AR alt-fires, MK-808, GL, Tesla, Ion, Basilisk, Rocket), the remaining implants (Coldsuit, SWT, Sound Suppressor, Wired Reflexes, IFF Info, Cortex Bomb), Spider grenades, and a second map.
- **M3:** server browser, stats and awards, voice, match features, options, hosting (§15.3–15.5). Stopwatch mode is dropped.

## 15. Decisions for the next milestones (2026-09-27)

### 15.1 Art

| Area | Decision |
|---|---|
| Priority | Art comes **before** M2 content. |
| Look | **Gritty cyberpunk like the original**: grimy metal, signage, near-realistic PBR textures. Team colours must stay readable. |
| Target | 60 fps on a **mid-range gaming PC** (a dedicated GPU from the last ~6 years), with a low setting for weaker machines. First download **up to ~100 MB** (KTX2 textures, compressed meshes); later maps stream in. |
| Scope | Everything: player characters with animation, first-person weapon models, level textures, props and skybox, cyberspace visuals and effects. |
| Atmosphere | Rain with wet reflections; neon signs and holo ads; steam, sparks and debris. (No volumetric fog or light shafts for now.) |
| Violence | Blood and gibs, like the original, with a settings toggle to turn it down. |
| Map | `d2_quarantine` is **rebuilt as a believable city block** with the same three-stage flow. Bot navigation, cyber waypoints and balance get redone and retested. |
| Review | A contact sheet per asset batch (renders in-game) for the owner to approve before moving on. |

### 15.2 Asset pipeline

- **Source:** AI-generated, with Claude running the whole pipeline. Free tiers only.
- **Where the art lives:** the **private** repo `atomy/dystopia2-assets`, never this public one. The build fetches it.
- **Images and textures:** Z-Image Turbo (Apache 2.0) on the owner's Windows PC (AMD RX 7700 XT, 12 GB) via **stable-diffusion.cpp `sd-server` with the Vulkan backend**. It listens on the LAN, and a firewall rule admits only the dev VM. The kit is in [`tools/gpu-host/`](../tools/gpu-host/).
- **3D meshes:** **TRELLIS.2** (MIT) on Hugging Face's free ZeroGPU quota, called from the dev VM with the owner's read token in a git-ignored `.env`. It's used for characters and weapons, a few per day. Environment pieces and props are built by script in **Blender** (installed on the dev VM).
- **Rigging and animation:** scripted in Blender. Every character is rigged to one shared humanoid skeleton, and the clips are built by script: run, crouch, jump, ledge hang, fire, reload, and sitting jacked in.
- **Not used:** Hunyuan3D, because its licence excludes the EU, UK and South Korea; and anything needing an NVIDIA GPU locally.
- **Sound:** royalty-free recorded SFX (e.g. Sonniss GDC bundles, CC0) layered and processed by script; the raw files live in the private assets repo.
- **Music:** menu music plus stingers (stage captured, win, loss), AI-generated with ACE-Step (Apache 2.0) on a free Hugging Face GPU demo. In-game stays sound-effects only.

### 15.3 Content (M2)

- Numbers: **v1.2 plus the known 1.4 fixes** (Laser Rifle 20% damage floor, Basilisk magazine 15, Tesla range 768).
- Rocket Launcher: **laser-guided** in M2; fly-by-wire comes later.
- Laser Rifle and Tesla Rifle have **their own ammo**, separate from implant energy. It does not refill over time: ammo dispensers and respawning restock it, like other primaries.
- Implant slot costs and class slots stay as the original; tune them only after playtests.
- Second map: **`d2_uplink`** (Silo-like: timer, hybrid objective, carryable), **generated in code** with the map kit.

### 15.4 Multiplayer and meta (M3)

- **Voice:** push-to-talk team voice over WebRTC, with the game server only connecting players. It sits alongside the decker cyber mic.
- **Identity:** a callsign plus a random local token. No accounts and no personal data. Stats and end-of-round awards are kept per callsign.
- **Match features:** map rotation with an end-of-round vote, team auto-balance, and a spectator free camera. No stopwatch mode.
- **Bots:** Easy/Normal/Hard, chosen by the host.
- **Options:** key rebinding (the fixed implant keys become defaults); FOV, separate zoom sensitivity and inverted mouse Y. No gamepad.
- **Language:** English only, with all UI text in one table so a translation can be added later.
- **Onboarding:** tips only (loading-screen tips, a controls overlay, first-time context hints). No tutorial map.

### 15.5 Hosting

- First real games are **LAN / friends**, so bandwidth and anti-cheat work waits until public play.
- The VPS already runs its own **reverse proxy**, so the docs cover its WebSocket settings; no bundled Caddy.
- Default port **9090**.
