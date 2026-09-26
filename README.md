# Dystopia 2

A browser-based spiritual sequel to **Dystopia**, the cyberpunk Half-Life 2 mod where Punks and Corps fight over objectives in meatspace while **deckers** jack into a Tron-like cyberspace to hack doors, turrets, spawns and objectives, their bodies left defenceless at the terminal.

This is a hobby vertical slice (working title). It's not affiliated with Team Dystopia or Puny Human.

![stack](https://img.shields.io/badge/stack-TypeScript%20·%20three.js%20·%20Node-27e6ff)

## Features in the slice

- **Source-style movement:** air strafing, bunny hopping (re-press jump), crouch-jumps, step-up, crouch slides, ledge grabbing (Light and Medium), fall damage, and Leg Booster sprint plus charged boost jumps with goomba stomps.
- **Three classes** with faithful v1.2 stats:

  | Class | Health / armor | Slots | Speed |
  |---|---|---|---|
  | Light | 75 / 25 | 5 head / 7 body | 250 |
  | Medium | 100 / 50 | 4 head / 4 body | 200 |
  | Heavy | 140 / 100 | 2 head / 2 body | 160 |

  Armor absorbs 80% of damage, and explosives deal double damage to armor.
- **Weapons:**
  - Machine Pistol, Shotgun (double-barrel alt-fire), Assault Rifle (rate of fire ramps up; zoomed alt-fire gives a 3-round burst), Minigun (pre-spin).
  - Katana (with block) and Fatman Fist.
  - EMP grenades (they eject deckers) and frag grenades.
  - Hitscan is lag-compensated, and headshots count for the Assault Rifle.
- **Implants on fixed keys:**
  - Cyberdeck and Enhanced Cyberdeck (**F**)
  - TAC Scanner (**Q**)
  - Thermal Vision (**T**)
  - Stealth (**C**)
  - Mediplant (**G**)
  - Leg Boosters (**Shift** / **V**)
  - SCS
  - All of them run off a shared energy pool, and EMP shuts them down.
- **Cyberspace with relative gravity:**
  - Gravity tiles flip your "down" so you can walk up walls and onto ceilings.
  - Tubes are zero-g, and holding jump makes you bounce.
  - Jump pads, drain pools, and team-coloured trails that show through walls.
  - Three cyber weapons (Hitscan, Shaft, Projectile), and **energy is your life**.
  - Running out of energy ejects you: you take dumpshock damage, the jack-in point locks for 10 s, and you drop a crystal worth half the energy you lost.
- **All 11 hacking programs:** Password Protect/Cracker, Encryption/Decryptor, ICE Barrier, ICE Alarm, ICE Mine, Green ICE, Wedge, ICE Breaker and ICE Scan. The Enhanced deck adds a Simon-says minigame that speeds programs up.
- **Fixes to the original's pain points:**
  - Fixed implant keys.
  - Several jack-in points per server.
  - **Meatspace cracking**: hack from the physical world by holding E.
  - A **decker alarm** plus a cyber mic, so you hear meatspace near your body.
  - Wave spawns with the 1.4 rules (18 s cap).
  - Usable screens always have a bright frame.
  - IFF tags and objective markers.
- **Bots that play the objective and deck:** they navigate a generated nav grid, jack in, follow cyber waypoints across gravity walls, crack protections, answer the minigame, hack nodes, lock nodes down on defence, guard decker bodies and EMP the enemy's deckers.
- **Map `d2_quarantine`:** three stages in the spirit of Vaccine. Take the docks (with several routes), hack the mid-spawn in the yellow server, then drop core security in the red server and destroy the data core.

## Quick start (development)

Requires Node 22+.

```bash
npm install
npm run dev
```

This starts the game server on `:8080` (auto-reloads) and the Vite client on `:5173`. Open **http://localhost:5173**, pick a callsign and **Host game**, then share the room code or the invite link (`?room=CODE`). Click into the game to capture the mouse.

## Production / VPS

```bash
npm run build && npm start
```

That serves everything from one port (8080 by default). Or use Docker:

```bash
docker compose up -d --build
```

Put a TLS reverse proxy (Caddy, nginx or Traefik) in front so players connect over `https`/`wss`. Environment variables: `PORT`, `MAX_ROOMS`, `DEFAULT_MAP`, `MAPS_DIR`, `CLIENT_DIR`.

## Controls

| Key | Action | Key | Action |
|---|---|---|---|
| WASD | move | Space | jump (hold to bounce in cyber) |
| Ctrl | crouch (slide on a fast landing) | Shift | sprint (Leg Boosters) |
| V (hold) | charge boost jump | Mouse1 / Mouse2 | fire / alt-fire |
| R | reload / cyber weapon mode | E | use / hack / crack |
| 1–4, wheel | weapons | 1–9 in cyber | programs / minigame |
| F | jack in / out | Q | TAC scan |
| T | thermal | C | stealth |
| G (hold) | mediplant | K | tactical respawn |
| Tab | scoreboard | M | team & loadout |
| Y / U | chat / team chat | Esc | menu, settings, host controls |

## Repository layout

```
packages/shared   engine core shared by client & server: .map parser, brushes + swept-AABB collision,
                  player/cyber movement, weapon state machine, snapshot codec, game definitions
packages/server   Node room server: authoritative 60 Hz sim, combat + lag compensation, cyberspace,
                  programs, objectives & waves, bots (nav grid + cyber waypoints)
packages/client   three.js client: baked-light level renderer, prediction/interpolation, HUD, menus,
                  procedural WebAudio SFX
tools/            map generator (tools/maps), TrenchBroom game config (tools/trenchbroom), test driver
maps/             .map files loaded by server and client
docs/             DESIGN.md (decisions) and research/dystopia-original.md (reference)
```

## Making maps

Maps are Quake `.map` files (Valve 220 format) made in **TrenchBroom**. The game loads them directly, with no BSP compile step. See [tools/trenchbroom/README.md](tools/trenchbroom/README.md) for setup and the entity reference. The slice map is generated by `tools/maps/quarantine.ts`; regenerate it with `npx tsx tools/genmaps.ts`, or open `maps/d2_quarantine.map` in TrenchBroom and edit it by hand.

## Tests and dev tools

```bash
npm test                                          # vitest: movement, cyber movement, codec, game rules, bot match
npx tsx packages/server/scripts/botsim.ts 10 4    # headless bot match: 10 simulated minutes, 4 bots per team
node tools/drive.mjs out '[{"wait":3000},{"shot":"view"}]'   # headless Chrome (SwiftShader) screenshots
```

In dev builds the client exposes `window.__d2` (debugDrive, debugRoute, debugCam, debugState) for scripted testing.

## Credits

Game design is inspired by *Dystopia* by Team Dystopia and Puny Human. The code, art, audio and map here are all original and procedural.
