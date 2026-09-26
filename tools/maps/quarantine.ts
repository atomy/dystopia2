// d2_quarantine: the vertical-slice map (see docs/DESIGN.md §11).
//
// Punks attack west -> east through a DataTrust quarantine arcology:
//   Stage 1  Docks     - get through the dock wall (hack / crack the bay door,
//                        ledge-grab the upper window, or crawl the duct), then
//                        capture the docks spawn uplink.
//   Stage 2  Security  - hack the mid-spawn node in the YELLOW server.
//   Stage 3  Core      - drop core security in the RED server, destroy the core.
//
// Cyberspace is a straight chain far below the map:
//   [Punk hub] -> tube -> [Yellow server] -> tube (ICE) -> [Red server] -> tube -> [Corp hub]
//
// Coordinates: X east, Y north, Z up. Meatspace floor at z=0.

import { v3, boxBrush, type Vec3, type Tex } from '@d2/shared';
import { MapKit, type Rect } from './kit.js';

const CZ = -6000; // cyberspace floor level

export function buildQuarantine(): MapKit {
  const k = new MapKit({ message: 'd2_quarantine', _author: 'Dystopia 2 slice generator' });

  k.point('d2_gamerules', v3(-3400, 0, 400), { attackers: 1, roundtime: 900, stagebonus: 180 });

  street(k);
  docks(k);
  security(k);
  core(k);
  cyberspace(k);
  objectives(k);
  return k;
}

// ---------------------------------------------------------------------------
// Stage 1 approach: the street (Punk start)

function street(k: MapKit): void {
  // Outdoor street canyon between building facades, open to a dark sky.
  const mins = v3(-3584, -1024, 0);
  const maxs = v3(-2048, 1024, 1024);
  k.box(v3(mins.x - 16, mins.y - 16, -16), v3(maxs.x, maxs.y + 16, 0), { top: 'd2/concrete', sides: 'd2/trim' });
  k.box(v3(mins.x - 16, mins.y - 16, maxs.z), v3(maxs.x, maxs.y + 16, maxs.z + 16), 'd2/sky');
  k.box(v3(mins.x - 16, mins.y, 0), v3(mins.x, maxs.y, maxs.z), 'd2/wall');
  k.box(v3(mins.x - 16, mins.y - 16, 0), v3(maxs.x, mins.y, maxs.z), 'd2/concrete');
  k.box(v3(mins.x - 16, maxs.y, 0), v3(maxs.x, maxs.y + 16, maxs.z), 'd2/concrete');
  // Facade details: pillars and neon signs along both sides.
  for (let x = -3456; x < -2100; x += 320) {
    k.box(v3(x, -1024, 0), v3(x + 48, -976, 512), 'd2/trim');
    k.box(v3(x, 976, 0), v3(x + 48, 1024, 512), 'd2/trim');
    k.box(v3(x + 80, -1022, 256), v3(x + 240, -1018, 272), x % 640 === 0 ? 'd2/neon_magenta' : 'd2/neon_cyan');
    k.box(v3(x + 80, 1018, 300), v3(x + 240, 1022, 316), x % 640 === 0 ? 'd2/neon_cyan' : 'd2/neon_yellow');
  }

  // Punk spawn: a covered bunker at the west end with two exits.
  const sp0 = v3(-3584, -320, 0);
  const sp1 = v3(-3200, 320, 192);
  k.box(v3(sp0.x, sp0.y - 16, 0), v3(sp1.x + 16, sp0.y, sp1.z), 'd2/punk');
  k.box(v3(sp0.x, sp1.y, 0), v3(sp1.x + 16, sp1.y + 16, sp1.z), 'd2/punk');
  k.box(v3(sp0.x, sp0.y - 16, sp1.z), v3(sp1.x + 16, sp1.y + 16, sp1.z + 16), 'd2/ceil');
  k.wall('x', sp1.x, sp1.x + 16, sp0.y, sp1.y, 0, sp1.z, [
    { a0: -256, a1: -128, z0: 0, z1: 128 },
    { a0: 128, a1: 256, z0: 0, z1: 128 },
  ], 'd2/punk');
  k.trimRoom(sp0, sp1, 'd2/neon_magenta', 160);
  for (let i = 0; i < 8; i++) {
    const x = -3520 + (i % 4) * 80;
    const y = -160 + Math.floor(i / 4) * 320;
    k.point('info_player_punk', v3(x, y, 1), { group: 'punk_base', angle: 0 });
  }
  k.light(v3(-3392, 0, 170), '255 150 220', 0.7, 520);

  // Cover on the street.
  k.crate(-2944, -448, 0, 128, 128, 96);
  k.crate(-2944, -448, 96, 64, 64, 64);
  k.crate(-2720, 192, 0, 192, 96, 72);
  k.crate(-2560, -704, 0, 96, 192, 128);
  k.box(v3(-3008, 560, 0), v3(-2848, 720, 40), { top: 'd2/hazard', sides: 'd2/trim' });

  // Crate stack under the upper window (ledge-grab route): 96 then 160 high.
  k.crate(-2304, 480, 0, 128, 192, 96, { top: 'd2/hazard', sides: 'd2/vent' });
  k.crate(-2176, 480, 0, 128, 192, 160, { top: 'd2/hazard', sides: 'd2/vent' });

  // Punk JIPs for stage 1 (both connect to the Punk hub).
  jip(k, 'jip_street_1', v3(-2464, 300, 0), 90, { team: 1, cyberspawn: 'cs_punk_hub', enabled: 1, label: 'Street terminal A' });
  jip(k, 'jip_street_2', v3(-2880, -960, 0), 90, { team: 1, cyberspawn: 'cs_punk_hub', enabled: 1, label: 'Street terminal B' });

  // Street lights.
  for (let x = -3200; x < -2048; x += 384) {
    k.light(v3(x, -600, 480), '120 200 255', 0.9, 700);
    k.light(v3(x + 192, 600, 480), '255 120 220', 0.9, 700);
  }
  k.point('d2_ammo', v3(-3150, 380, 0), { angle: 270 });
}

// ---------------------------------------------------------------------------
// Stage 1 target: the docks hall

function docks(k: MapKit): void {
  const mins = v3(-2016, -1024, 0);
  const maxs = v3(-512, 768, 512);

  // Dock wall (street side) with the bay door, upper window and crawl duct.
  const bay: Rect = { a0: -128, a1: 128, z0: 0, z1: 192 };
  const win: Rect = { a0: 512, a1: 672, z0: 224, z1: 320 };
  const duct: Rect = { a0: -896, a1: -832, z0: 0, z1: 48 };
  k.wall('x', -2048, -2016, -1024, 1024, 0, 1024, [bay, win, duct], { sides: 'd2/concrete', top: 'd2/trim', bottom: 'd2/trim' });
  // Door frame + warning trims.
  k.box(v3(-2064, -144, 192), v3(-2000, 144, 208), 'd2/hazard');
  k.box(v3(-2064, -144, 0), v3(-2048, -128, 192), 'd2/neon_yellow');
  k.box(v3(-2064, 128, 0), v3(-2048, 144, 192), 'd2/neon_yellow');
  k.box(v3(-2058, 500, 216), v3(-2050, 684, 222), 'd2/neon_cyan');

  // Crawl duct continues 128u into the docks under a low ceiling.
  k.box(v3(-2016, -912, 48), v3(-1888, -816, 64), 'd2/vent');
  k.box(v3(-2016, -912, 0), v3(-1888, -896, 48), 'd2/vent');
  k.box(v3(-2016, -832, 0), v3(-1888, -816, 48), 'd2/vent');

  // The bay door: locked; opened by the yellow-server node or by cracking.
  k.brushEnt('func_door', [boxAt(v3(-2044, -128, 0), v3(-2020, 128, 192), { sides: 'd2/door', top: 'd2/trim' })], {
    targetname: 'door_bay',
    angle: -1,
    speed: 120,
    lip: 8,
    wait: -1,
    locked: 1,
    label: 'Loading bay door',
  });
  k.brushEnt('trigger_crack', [boxAt(v3(-2240, -160, 0), v3(-2048, 160, 128), 'd2/trigger')], {
    target: 'door_bay',
    action: 'open',
    time: 25,
    team: 1,
    stage: 1,
    label: 'Crack the loading bay door',
  });

  // Hall shell (west wall is the dock wall above).
  k.box(v3(mins.x, mins.y - 16, -16), v3(maxs.x, maxs.y + 16, 0), { top: 'd2/floor', sides: 'd2/trim' });
  k.box(v3(mins.x, mins.y - 16, maxs.z), v3(maxs.x + 32, maxs.y + 16, maxs.z + 16), 'd2/ceil');
  k.box(v3(mins.x, mins.y - 16, 0), v3(maxs.x, mins.y, maxs.z), 'd2/wall');
  k.box(v3(mins.x, maxs.y, 0), v3(maxs.x, maxs.y + 16, maxs.z), 'd2/wall');
  // East wall with two stage gates into Security.
  const gateMain: Rect = { a0: -128, a1: 128, z0: 0, z1: 192 };
  const gateSide: Rect = { a0: 544, a1: 672, z0: 0, z1: 160 };
  k.wall('x', maxs.x, maxs.x + 32, mins.y - 16, maxs.y + 16, 0, maxs.z, [gateMain, gateSide], 'd2/wall');
  gateDoor(k, 'gate_docks_main', v3(maxs.x + 4, -128, 0), v3(maxs.x + 28, 128, 192));
  gateDoor(k, 'gate_docks_side', v3(maxs.x + 4, 544, 0), v3(maxs.x + 28, 672, 160));
  k.trimRoom(mins, maxs, 'd2/neon_cyan', 470);

  // Upper catwalk along the north wall, reached from the window; stairs down at the east end.
  k.box(v3(-2016, 448, 208), v3(-1024, 768, 224), { top: 'd2/metal', sides: 'd2/trim', bottom: 'd2/trim' });
  k.box(v3(-2016, 440, 224), v3(-1024, 448, 256), 'd2/trim'); // railing
  k.box(v3(-1024, 440, 224), v3(-1016, 624, 256), 'd2/trim'); // east rail, gap for the stairs
  k.stairs(v3(-1016, 624, 0), v3(-760, 768, 224), '-x', 14);
  // Corp security booth on the catwalk with a defence JIP.
  k.box(v3(-1408, 704, 224), v3(-1216, 768, 384), 'd2/corp');
  k.box(v3(-1416, 448, 224), v3(-1408, 560, 384), 'd2/glass');
  jip(k, 'jip_docks_corp', v3(-1312, 720, 224), 270, { team: 2, cyberspawn: 'cs_red_west', enabled: 1, label: 'Dock security terminal' });

  // Containers and cover on the dock floor.
  k.crate(-1760, -512, 0, 256, 128, 160, { top: 'd2/metal', sides: 'd2/corp' });
  k.crate(-1760, -384, 0, 128, 96, 96);
  k.crate(-1472, 96, 0, 128, 256, 128, { top: 'd2/metal', sides: 'd2/punk' });
  k.crate(-1248, -320, 0, 192, 96, 72);
  k.crate(-1152, 256, 0, 96, 96, 96);
  k.crate(-1600, -896, 0, 160, 160, 112);
  k.box(v3(-1800, -40, 0), v3(-1700, 40, 48), { top: 'd2/hazard', sides: 'd2/trim' });

  // Docks spawn room (south-east corner): Corp forward spawn, captured by Punks.
  const r0 = v3(-896, -1024, 0);
  const r1 = v3(-512, -640, 192);
  k.wall('y', r1.y, r1.y + 16, r0.x - 16, r1.x, 0, r1.z, [{ a0: -800, a1: -672, z0: 0, z1: 128 }], 'd2/corp');
  k.wall('x', r0.x - 16, r0.x, r0.y, r1.y, 0, r1.z, [], 'd2/corp');
  k.box(v3(r0.x - 16, r0.y, r1.z), v3(r1.x, r1.y + 16, r1.z + 16), 'd2/ceil');
  k.trimRoom(r0, r1, 'd2/neon_cyan', 170);
  for (let i = 0; i < 6; i++) {
    const p = v3(-840 + (i % 3) * 96, -960 + Math.floor(i / 3) * 96, 1);
    k.point('info_player_corp', p, { group: 'docks_corp', angle: 90 });
    k.point('info_player_punk', v3(p.x, p.y + 48, 1), { group: 'docks_punk', angle: 90 });
  }
  k.point('d2_screen', v3(-540, -832, 64), {
    targetname: 'screen_docks_spawn',
    angle: 180,
    team: 1,
    holdtime: 5,
    stage: 1,
    objective: 'obj_docks',
    label: 'Docks spawn uplink',
  });
  k.point('d2_ammo', v3(-880, -700, 0), { angle: 0 });

  // Stage 2 Punk JIPs in the east part of the docks (enabled once the docks fall).
  jip(k, 'jip_docks_1', v3(-640, 64 + 200, 0), 180, { team: 1, cyberspawn: 'cs_yellow_west', enabled: 0, label: 'Dock relay A' });
  jip(k, 'jip_docks_2', v3(-640, -300, 0), 180, { team: 1, cyberspawn: 'cs_yellow_west', enabled: 0, label: 'Dock relay B' });

  for (let x = -1900; x < -600; x += 400) {
    k.light(v3(x, -600, 440), '160 220 255', 1.0, 750);
    k.light(v3(x + 200, 300, 440), '200 230 255', 1.0, 750);
  }
  k.light(v3(-700, -830, 170), '100 200 255', 0.9, 400);
  k.light(v3(-1500, 600, 360), '255 255 255', 0.7, 500);
}

// ---------------------------------------------------------------------------
// Stage 2: security hall (two levels, stair turrets, mid spawn)

function security(k: MapKit): void {
  const mins = v3(-480, -768, 0);
  const maxs = v3(1024, 768, 448);
  k.box(v3(mins.x, mins.y - 16, -16), v3(maxs.x, maxs.y + 16, 0), { top: 'd2/floor', sides: 'd2/trim' });
  k.box(v3(mins.x, mins.y - 16, maxs.z), v3(maxs.x + 32, maxs.y + 16, maxs.z + 16), 'd2/ceil');
  // South wall has a side room opening; north wall solid; the dock wall bounds the west.
  k.wall('y', mins.y - 16, mins.y, mins.x, maxs.x, 0, maxs.z, [], 'd2/wall');
  k.wall('y', maxs.y, maxs.y + 16, mins.x, maxs.x, 0, maxs.z, [], 'd2/wall');
  // Docks->security connection: fill the gap north/south of the docks (docks spans y -1024..768).
  // East wall into the core with two stage-3 gates.
  const gateCore: Rect = { a0: -128, a1: 128, z0: 0, z1: 192 };
  const gateMaint: Rect = { a0: -640, a1: -512, z0: 0, z1: 128 };
  k.wall('x', maxs.x, maxs.x + 32, mins.y - 16, maxs.y + 16, 0, maxs.z, [gateCore, gateMaint], 'd2/wall');
  gateDoor(k, 'gate_core_main', v3(maxs.x + 4, -128, 0), v3(maxs.x + 28, 128, 192));
  gateDoor(k, 'gate_core_maint', v3(maxs.x + 4, -640, 0), v3(maxs.x + 28, -512, 128));
  k.trimRoom(mins, maxs, 'd2/neon_magenta', 410);

  // East balcony at z=192 with two stair runs up along the north and south walls.
  k.box(v3(640, -768, 176), v3(1024, 768, 192), { top: 'd2/metal', sides: 'd2/trim', bottom: 'd2/trim' });
  k.box(v3(632, -560, 192), v3(640, 560, 232), 'd2/trim'); // balcony rail (gaps at the stair tops)
  k.stairs(v3(256, 576, 0), v3(640, 768, 176), '+x', 11);
  k.stairs(v3(256, -768, 0), v3(640, -576, 176), '+x', 11);
  // Central cover and a security desk.
  k.crate(0, -96, 0, 192, 192, 64, { top: 'd2/screen', sides: 'd2/corp' });
  k.crate(-288, 320, 0, 96, 160, 96);
  k.crate(-288, -480, 0, 96, 160, 96);
  k.box(v3(320, -200, 0), v3(352, 200, 112), { sides: 'd2/glass', top: 'd2/trim' });

  // Stair turrets at the balcony, Corp-owned, flippable in cyberspace.
  k.point('d2_turret', v3(900, 520, 192), { targetname: 'turret_stairs_n', team: 2, health: 300, respawn: 30, damage: 8, range: 1600, angle: 180, label: 'Stair turret N' });
  k.point('d2_turret', v3(900, -520, 192), { targetname: 'turret_stairs_s', team: 2, health: 300, respawn: 30, damage: 8, range: 1600, angle: 180, label: 'Stair turret S' });

  // Mid spawn behind the balcony (east, upstairs): Corp until hacked.
  for (let i = 0; i < 6; i++) {
    const p = v3(720 + (i % 3) * 96, -120 + Math.floor(i / 3) * 240, 193);
    k.point('info_player_corp', p, { group: 'mid_corp', angle: 180 });
    k.point('info_player_punk', v3(p.x + 32, p.y, 193), { group: 'mid_punk', angle: 180 });
  }
  k.point('d2_ammo', v3(980, 0, 192), { angle: 180 });
  // Corp mid JIP upstairs, and a neutral side-room JIP enabled in stage 2.
  jip(k, 'jip_mid_corp', v3(1000, 300, 192), 180, { team: 2, cyberspawn: 'cs_red_west', enabled: 1, label: 'Security terminal' });
  jip(k, 'jip_security_side', v3(-440, -720, 0), 0, {
    team: 0,
    cyberspawn: 'cs_yellow_west',
    cyberspawn_corp: 'cs_red_west',
    enabled: 0,
    label: 'Side-office terminal',
  });
  // Stage 3 Punk JIPs (appear once the mid spawn is theirs).
  jip(k, 'jip_security_1', v3(-420, 640, 0), 0, { team: 1, cyberspawn: 'cs_yellow_east', enabled: 0, label: 'Security relay A' });
  jip(k, 'jip_security_2', v3(-420, -600, 0), 0, { team: 1, cyberspawn: 'cs_yellow_east', enabled: 0, label: 'Security relay B' });

  // Security camera watching the stairs (hackable in cyber: owner sees enemies in its cone).
  k.point('d2_camera', v3(-440, 0, 400), { targetname: 'cam_security', team: 2, angle: 0, fov: 70, range: 1800, label: 'Security camera' });

  for (let x = -300; x < 1000; x += 420) {
    k.light(v3(x, -400, 400), '255 150 230', 1.0, 700);
    k.light(v3(x + 200, 400, 400), '180 220 255', 1.0, 700);
  }
}

// ---------------------------------------------------------------------------
// Stage 3: the data core

function core(k: MapKit): void {
  const mins = v3(1056, -768, 0);
  const maxs = v3(2304, 768, 640);
  k.box(v3(mins.x, mins.y - 16, -16), v3(maxs.x, maxs.y + 16, 0), { top: 'd2/metal', sides: 'd2/trim' });
  k.box(v3(mins.x, mins.y - 16, maxs.z), v3(maxs.x + 16, maxs.y + 16, maxs.z + 16), 'd2/ceil');
  k.wall('y', mins.y - 16, mins.y, mins.x, maxs.x, 0, maxs.z, [], 'd2/wall');
  k.wall('y', maxs.y, maxs.y + 16, mins.x, maxs.x, 0, maxs.z, [], 'd2/wall');
  // East wall: Corp base spawn behind team doors.
  k.wall('x', maxs.x, maxs.x + 16, mins.y - 16, maxs.y + 16, 0, maxs.z, [{ a0: -256, a1: -128, z0: 0, z1: 128 }, { a0: 128, a1: 256, z0: 0, z1: 128 }], 'd2/corp');
  k.brushEnt('func_door', [boxAt(v3(maxs.x + 2, -256, 0), v3(maxs.x + 14, -128, 128), 'd2/corp')], { targetname: 'door_corp_base_s', angle: 90, speed: 300, lip: 4, wait: 2, team: 2 });
  k.brushEnt('func_door', [boxAt(v3(maxs.x + 2, 128, 0), v3(maxs.x + 14, 256, 128), 'd2/corp')], { targetname: 'door_corp_base_n', angle: 270, speed: 300, lip: 4, wait: 2, team: 2 });
  k.trimRoom(mins, maxs, 'd2/neon_cyan', 600);

  // Maintenance corridor from the security gate (south) into the core room.
  k.box(v3(1056, -768, 128), v3(1280, -512, 144), 'd2/vent');

  // The data core: breakable, inside a Corp force-field shell.
  k.box(v3(1552, -128, 0), v3(1808, 128, 24), { top: 'd2/neon_cyan', sides: 'd2/trim' });
  k.brushEnt('func_breakable', [boxAt(v3(1616, -64, 24), v3(1744, 64, 288), { sides: 'd2/screen', top: 'd2/neon_cyan', bottom: 'd2/trim' })], {
    targetname: 'data_core',
    health: 1500,
    team: 2,
    objective: 'obj_core',
    label: 'Data core',
  });
  const ff = (a: Vec3, b: Vec3) => boxAt(a, b, 'd2/forcefield');
  k.brushEnt('func_forcefield', [
    ff(v3(1520, -160, 0), v3(1528, 160, 352)),
    ff(v3(1832, -160, 0), v3(1840, 160, 352)),
    ff(v3(1528, -160, 0), v3(1832, -152, 352)),
    ff(v3(1528, 152, 0), v3(1832, 160, 352)),
    ff(v3(1520, -160, 352), v3(1840, 160, 360)),
  ], { targetname: 'core_ff', team: 2, start: 1, label: 'Core force field' });
  // Core turrets high on the north/south walls.
  k.point('d2_turret', v3(1680, 700, 320), { targetname: 'turret_core_n', team: 2, health: 0, damage: 10, range: 2000, angle: 270, label: 'Core turret N' });
  k.point('d2_turret', v3(1680, -700, 320), { targetname: 'turret_core_s', team: 2, health: 0, damage: 10, range: 2000, angle: 90, label: 'Core turret S' });
  // Pillars and upper walkways for cover.
  for (const y of [-448, 448]) {
    k.box(v3(1280, y - 48, 0), v3(1376, y + 48, 640), 'd2/trim');
    k.box(v3(1984, y - 48, 0), v3(2080, y + 48, 640), 'd2/trim');
  }
  k.box(v3(1984, -768, 224), v3(2304, 768, 240), { top: 'd2/metal', sides: 'd2/trim', bottom: 'd2/trim' });
  k.stairs(v3(1808, 640, 0), v3(1984, 768, 224), '+x', 12);
  k.stairs(v3(1808, -768, 0), v3(1984, -640, 224), '+x', 12);
  k.crate(1408, -320, 0, 128, 128, 96);
  k.crate(1408, 192, 0, 128, 128, 96);

  // Corp base spawn room.
  const b0 = v3(2320, -512, 0);
  const b1 = v3(2688, 512, 224);
  k.hollow(b0, b1, { wall: 'd2/corp', skip: ['w'], trim: 'd2/neon_cyan' });
  for (let i = 0; i < 8; i++) k.point('info_player_corp', v3(2480 + (i % 2) * 120, -400 + Math.floor(i / 2) * 240, 1), { group: 'corp_base', angle: 180 });
  k.point('d2_ammo', v3(2650, 0, 0), { angle: 180 });
  jip(k, 'jip_core_corp_1', v3(2240, 600, 0), 270, { team: 2, cyberspawn: 'cs_corp_hub', enabled: 1, label: 'Core terminal A' });
  jip(k, 'jip_core_corp_2', v3(2240, -600, 0), 90, { team: 2, cyberspawn: 'cs_corp_hub', enabled: 1, label: 'Core terminal B' });

  for (let x = 1200; x < 2300; x += 360) {
    k.light(v3(x, -500, 580), '120 230 255', 1.1, 800);
    k.light(v3(x + 180, 500, 580), '120 230 255', 1.1, 800);
  }
  k.light(v3(1680, 0, 400), '80 255 255', 1.6, 700);
  k.light(v3(2500, 0, 200), '100 180 255', 1.0, 600);
}

// ---------------------------------------------------------------------------
// Cyberspace

function cyberspace(k: MapKit): void {
  const S = 1024; // server cube size
  const T = 192; // tube cross-section
  const tz0 = CZ + 304; // tube floor, mid-height of the servers
  const tz1 = tz0 + T;
  const TZ = tz0 + T / 2;
  const F = CZ + 20; // waypoint height on server floors
  const tubeOpen: Rect[] = [{ a0: -T / 2, a1: T / 2, z0: tz0, z1: tz1 }];
  const path = new CyberPath(k);

  // ---- Punk hub: x -2048..-1536
  cyberRoom(k, v3(-2048, -256, CZ), v3(-1536, 256, CZ + 512), { e: tubeOpen }, 'd2/cyber_wall');
  k.point('d2_cyber_spawn', v3(-1990, -120, CZ + 16), { targetname: 'cs_punk_hub', angle: 0 });
  k.point('d2_cyber_spawn', v3(-1990, 120, CZ + 16), { targetname: 'cs_punk_hub', angle: 0 });
  pad(k, -1868, 0, 1);
  path.add('ph', -1980, 0, F).add('ph_pad', -1868, 0, F).add('t1_w', -1450, 0, TZ).add('t1_e', -1090, 0, TZ);
  path.oneway('ph', 'ph_pad', 't1_w', 't1_e');

  // Tube 1: punk hub -> yellow, red ICE (Punks pass) at the yellow end.
  tube(k, v3(-1536, -T / 2, tz0), v3(-1024, T / 2, tz1), 350);
  k.brushEnt('cyber_ice', [boxAt(v3(-1040, -T / 2, tz0), v3(-1024, T / 2, tz1), 'd2/cyber_ice')], { targetname: 'ice_punk_gate', pass: 1 });

  // ---- Yellow server: x -1024..0. Every inner face is a gravity tile.
  const y0 = v3(-1024, -S / 2, CZ);
  const y1 = v3(0, S / 2, CZ + S);
  cyberRoom(k, y0, y1, { w: tubeOpen, e: tubeOpen }, 'd2/cyber_floor');
  k.trimRoom(y0, y1, 'd2/neon_yellow', CZ + S / 2, 6, 3);
  k.point('d2_cyber_spawn', v3(-930, -160, CZ + 16), { targetname: 'cs_yellow_west', angle: 0 });
  k.point('d2_cyber_spawn', v3(-930, 160, CZ + 16), { targetname: 'cs_yellow_west', angle: 0 });
  k.point('d2_cyber_spawn', v3(-110, -220, CZ + 16), { targetname: 'cs_yellow_east', angle: 180 });
  k.point('d2_cyber_spawn', v3(-110, 220, CZ + 16), { targetname: 'cs_yellow_east', angle: 180 });
  pad(k, -330, 0, 1);
  node(k, 'node_bay', v3(-560, -300, CZ), 'floor-w', {
    target: 'door_bay', action: 'open', team: 2, protection: 0, stage: 1, label: 'Loading bay door',
  });
  node(k, 'node_camera', v3(-560, 300, CZ), 'floor-w', {
    target: 'cam_security', action: 'capture', team: 2, protection: 0, stage: 0, label: 'Security camera',
  });
  node(k, 'node_midspawn', v3(-200, S / 2, CZ + 384), 'north', {
    target: 'spawn_mid', action: 'capture', team: 2, protection: 1, stage: 2, objective: 'obj_midspawn', oneway: 1, label: 'Mid-spawn control',
  });
  node(k, 'node_turret_s', v3(-200, -S / 2, CZ + 384), 'south', {
    target: 'turret_stairs_s', action: 'capture', team: 2, protection: 0, stage: 2, label: 'Stair turret S',
  });
  node(k, 'node_turret_n', v3(-560, 0, CZ + S), 'ceiling', {
    target: 'turret_stairs_n', action: 'capture', team: 2, protection: 0, stage: 2, label: 'Stair turret N',
  });
  // Floating data platforms to bounce between.
  k.box(v3(-330, 150, CZ + 300), v3(-150, 300, CZ + 316), 'd2/cyber_floor');
  k.box(v3(-900, -450, CZ + 520), v3(-760, -320, CZ + 536), 'd2/cyber_floor');
  // Energy drain pool in the north-west corner.
  k.brushEnt('cyber_drain', [boxAt(v3(-1000, 380, CZ), v3(-800, 500, CZ + 48), 'd2/trigger')], { rate: 4 });
  k.brushEnt('func_illusionary', [boxAt(v3(-1000, 380, CZ), v3(-800, 500, CZ + 1), 'd2/cyber_ice')]);

  path.add('y_w', -900, 0, F).add('y_nw', -820, 130, F).add('y_sw', -820, -130, F).add('y_n', -420, 130, F).add('y_s', -420, -130, F);
  path.add('y_e', -110, 0, F).add('y_ne', -110, 180, F).add('y_se', -110, -180, F).add('y_padE', -330, 0, F).add('t2_w', 60, 0, TZ);
  path.oneway('t1_e', 'y_w');
  path.link('y_w', 'y_nw', 'y_sw');
  path.link('y_nw', 'y_n');
  path.link('y_sw', 'y_s');
  path.link('y_n', 'y_ne');
  path.link('y_s', 'y_se');
  path.link('y_e', 'y_ne', 'y_se');
  // East pad lobs you into tube 2 (one way).
  path.oneway('y_n', 'y_padE', 't2_w');
  path.oneway('y_s', 'y_padE');
  // Node approaches (outside the doorway -> inside by the screen).
  path.add('bay_out', -730, -300, F).add('bay_in', -500, -300, F).chain('y_sw', 'bay_out', 'bay_in');
  path.add('cam_out', -730, 300, F).add('cam_in', -500, 300, F).chain('y_nw', 'cam_out', 'cam_in');
  // North wall house: walk into the wall (gravity flips), up to the door, inside.
  path.add('mid_floor', -200, 400, F).add('mid_wall', -200, 499, CZ + 140).add('mid_door', -200, 499, CZ + 236).add('mid_in', -200, 488, CZ + 440);
  path.chain('y_ne', 'mid_floor', 'mid_wall', 'mid_door', 'mid_in');
  path.add('ts_floor', -200, -400, F).add('ts_wall', -200, -499, CZ + 140).add('ts_door', -200, -499, CZ + 236).add('ts_in', -200, -488, CZ + 440);
  path.chain('y_se', 'ts_floor', 'ts_wall', 'ts_door', 'ts_in');
  // Ceiling house: up the north wall onto the ceiling, then in through its west door.
  path.add('cn_wall', -760, 499, CZ + 140).add('cn_top', -760, 499, CZ + 1004).add('cn_ceil', -760, 200, CZ + 1004);
  path.add('cn_out', -760, 0, CZ + 1004).add('cn_in', -520, 0, CZ + 1004);
  path.chain('y_nw', 'cn_wall', 'cn_top', 'cn_ceil', 'cn_out', 'cn_in');

  // Tube 2: yellow -> red, sealed by Corp-only ICE until stage 3. No flow.
  tube(k, v3(0, -T / 2, tz0), v3(512, T / 2, tz1), 0);
  k.brushEnt('cyber_ice', [boxAt(v3(16, -T / 2, tz0), v3(32, T / 2, tz1), 'd2/cyber_ice')], { targetname: 'ice_red_gate', pass: 2 });
  path.add('t2_e', 460, 0, TZ);
  path.oneway('t2_w', 't2_e');
  path.oneway('t2_e', 't2_w');

  // ---- Red server: x 512..1536.
  const r0 = v3(512, -S / 2, CZ);
  const r1 = v3(1536, S / 2, CZ + S);
  cyberRoom(k, r0, r1, { w: tubeOpen, e: tubeOpen }, 'd2/cyber_floor');
  k.trimRoom(r0, r1, 'd2/neon_red', CZ + S / 2, 6, 3);
  k.point('d2_cyber_spawn', v3(620, -200, CZ + 16), { targetname: 'cs_red_west', angle: 0 });
  k.point('d2_cyber_spawn', v3(620, 200, CZ + 16), { targetname: 'cs_red_west', angle: 0 });
  pad(k, 842, 0, -1);
  node(k, 'node_core_security', v3(1024, -250, CZ), 'floor-w', {
    target: 'core_ff,turret_core_n,turret_core_s', action: 'disable', team: 2, protection: 2, stage: 3, objective: 'obj_security', oneway: 1, label: 'Core security',
  });
  node(k, 'node_core_turret_n', v3(1024, S / 2, CZ + 384), 'north', {
    target: 'turret_core_n', action: 'capture', team: 2, protection: 0, stage: 3, label: 'Core turret N',
  });
  node(k, 'node_core_turret_s', v3(1300, -S / 2, CZ + 384), 'south', {
    target: 'turret_core_s', action: 'capture', team: 2, protection: 0, stage: 3, label: 'Core turret S',
  });
  k.box(v3(640, 260, CZ + 300), v3(840, 420, CZ + 316), 'd2/cyber_floor');
  // Red waypoints route around the west pad (842, 0) and the core-security house.
  path.add('r_w', 620, 0, F).add('r_nw', 700, 250, F).add('r_n', 1024, 250, F).add('r_sw', 700, -110, F).add('r_s2', 840, -440, F);
  path.add('r_e', 1440, 0, F).add('r_se', 1300, -100, F).add('r_padW', 842, 0, F);
  path.oneway('t2_e', 'r_w');
  path.link('r_w', 'r_nw', 'r_sw');
  path.link('r_nw', 'r_n');
  path.link('r_sw', 'r_s2');
  path.link('r_e', 'r_n', 'r_se');
  // West pad lobs Corps back into tube 2 towards the yellow server.
  path.oneway('r_nw', 'r_padW', 't2_e');
  path.oneway('r_sw', 'r_padW');
  path.oneway('t2_w', 'y_e');
  path.add('sec_out', 850, -250, F).add('sec_in', 1080, -250, F).chain('r_sw', 'sec_out', 'sec_in');
  path.add('ctn_floor', 1024, 400, F).add('ctn_wall', 1024, 499, CZ + 140).add('ctn_door', 1024, 499, CZ + 236).add('ctn_in', 1024, 488, CZ + 440);
  path.chain('r_n', 'ctn_floor', 'ctn_wall', 'ctn_door', 'ctn_in');
  path.add('cts_floor', 1300, -400, F).add('cts_wall', 1300, -499, CZ + 140).add('cts_door', 1300, -499, CZ + 236).add('cts_in', 1300, -488, CZ + 440);
  path.chain('r_se', 'cts_floor', 'cts_wall', 'cts_door', 'cts_in');
  path.link('r_s2', 'cts_floor');

  // Tube 3: red <- corp hub, Corp-only ICE at the red entrance.
  tube(k, v3(1536, -T / 2, tz0), v3(2048, T / 2, tz1), -350);
  k.brushEnt('cyber_ice', [boxAt(v3(1536, -T / 2, tz0), v3(1552, T / 2, tz1), 'd2/cyber_ice')], { targetname: 'ice_corp_gate', pass: 2 });
  cyberRoom(k, v3(2048, -256, CZ), v3(2560, 256, CZ + 512), { w: tubeOpen }, 'd2/cyber_wall');
  k.point('d2_cyber_spawn', v3(2500, -120, CZ + 16), { targetname: 'cs_corp_hub', angle: 180 });
  k.point('d2_cyber_spawn', v3(2500, 120, CZ + 16), { targetname: 'cs_corp_hub', angle: 180 });
  pad(k, 2378, 0, -1);
  path.add('ch', 2500, 0, F).add('ch_pad', 2378, 0, F).add('t3_e', 1990, 0, TZ).add('t3_w', 1600, 0, TZ);
  path.oneway('ch', 'ch_pad', 't3_e', 't3_w', 'r_e');

  for (const x of [-1792, -512, 1024, 2304]) k.light(v3(x, 0, CZ + 480), '120 255 255', 0.8, 900);
  path.emit();
}

/** Jump pad 330u from a tube wall that lobs you into the tube opening. `dir` = +1 east, -1 west. */
function pad(k: MapKit, x: number, y: number, dir: 1 | -1): void {
  k.brushEnt('cyber_jumppad', [boxAt(v3(x - 40, y - 72, CZ), v3(x + 40, y + 72, CZ + 40), 'd2/trigger')], { push: `${350 * dir} 0 850` });
  k.brushEnt('func_illusionary', [boxAt(v3(x - 40, y - 72, CZ), v3(x + 40, y + 72, CZ + 2), 'd2/cyber_data')]);
}

/** Waypoint graph for bot deckers, emitted as d2_cyberpath entities. */
class CyberPath {
  private readonly pts = new Map<string, Vec3>();
  private readonly links = new Map<string, Set<string>>();
  constructor(private readonly k: MapKit) {}
  add(name: string, x: number, y: number, z: number): this {
    this.pts.set(name, v3(x, y, z));
    return this;
  }
  private edge(a: string, b: string): void {
    if (!this.pts.has(a) || !this.pts.has(b)) throw new Error(`cyberpath: unknown point ${this.pts.has(a) ? b : a}`);
    (this.links.get(a) ?? this.links.set(a, new Set()).get(a)!).add(b);
    (this.links.get(b) ?? this.links.set(b, new Set()).get(b)!).add(a);
  }
  chain(...names: string[]): this {
    for (let i = 0; i + 1 < names.length; i++) this.edge(names[i]!, names[i + 1]!);
    return this;
  }
  /** Directed chain (pads and flowing links only go one way). */
  oneway(...names: string[]): this {
    for (let i = 0; i + 1 < names.length; i++) {
      const a = names[i]!;
      const b = names[i + 1]!;
      if (!this.pts.has(a) || !this.pts.has(b)) throw new Error(`cyberpath: unknown point ${this.pts.has(a) ? b : a}`);
      (this.links.get(a) ?? this.links.set(a, new Set()).get(a)!).add(b);
    }
    return this;
  }
  /** Link `a` to each of the others. */
  link(a: string, ...others: string[]): this {
    for (const b of others) this.edge(a, b);
    return this;
  }
  emit(): void {
    for (const [name, p] of this.pts) {
      this.k.point('d2_cyberpath', p, { targetname: `cp_${name}`, target: [...(this.links.get(name) ?? [])].map((n) => `cp_${n}`).join(',') });
    }
  }
}

/** A cyberspace room with optional openings on e/w walls. Floors are always gravity tiles. */
function cyberRoom(k: MapKit, mins: Vec3, maxs: Vec3, open: { e?: Rect[]; w?: Rect[] }, tex: string): void {
  k.hollow(mins, maxs, { t: 32, wall: tex, floor: 'd2/cyber_floor', ceil: tex, open: { e: open.e, w: open.w } });
}

/** Zero-gravity link with a flow along `axis`. */
function tube(k: MapKit, mins: Vec3, maxs: Vec3, flow: number): void {
  const t = 16;
  k.box(v3(mins.x, mins.y - t, mins.z - t), v3(maxs.x, maxs.y + t, mins.z), 'd2/cyber_wall');
  k.box(v3(mins.x, mins.y - t, maxs.z), v3(maxs.x, maxs.y + t, maxs.z + t), 'd2/cyber_wall');
  k.box(v3(mins.x, mins.y - t, mins.z), v3(maxs.x, mins.y, maxs.z), 'd2/cyber_wall');
  k.box(v3(mins.x, maxs.y, mins.z), v3(maxs.x, maxs.y + t, maxs.z), 'd2/cyber_wall');
  k.brushEnt('cyber_zerog', [boxAt(v3(mins.x + 8, mins.y, mins.z), v3(maxs.x - 8, maxs.y, maxs.z), 'd2/trigger')], { flow: `${flow} 0 0` });
  // Glowing rings along the link.
  for (let x = mins.x + 64; x < maxs.x - 32; x += 128) {
    k.box(v3(x, mins.y, mins.z), v3(x + 8, mins.y + 3, maxs.z), 'd2/neon_cyan');
    k.box(v3(x, maxs.y - 3, mins.z), v3(x + 8, maxs.y, maxs.z), 'd2/neon_cyan');
  }
}

type NodeMount = 'floor-w' | 'floor-e' | 'north' | 'south' | 'ceiling';

/**
 * A node "house" (256 x 256 x 192) mounted on a server surface, with an ICE
 * doorway (programmable) and the node screen at the back.
 * `at` is the centre of the house's base on the mounting surface.
 */
function node(k: MapKit, name: string, at: Vec3, mount: NodeMount, props: Record<string, string | number>): void {
  const W = 256;
  const H = 192;
  const t = 16;
  const door = { w: 96, h: 128 };
  const wallTex = 'd2/cyber_wall';
  const floorTex = 'd2/cyber_floor';
  const ice = (a: Vec3, b: Vec3) =>
    k.brushEnt('cyber_ice', [boxAt(a, b, 'd2/cyber_ice')], { targetname: `${name}_door`, pass: 3, doorway: 1 });
  let screen: Vec3;
  let angle = 0;
  let up = '0 0 1';
  switch (mount) {
    case 'floor-w':
    case 'floor-e': {
      // House on the floor; doorway faces west (or east).
      const x0 = at.x - W / 2;
      const y0 = at.y - W / 2;
      const z0 = at.z;
      const faceW = mount === 'floor-w';
      k.box(v3(x0, y0, z0 + H), v3(x0 + W, y0 + W, z0 + H + t), floorTex);
      k.box(v3(x0, y0, z0), v3(x0 + W, y0 + t, z0 + H), wallTex);
      k.box(v3(x0, y0 + W - t, z0), v3(x0 + W, y0 + W, z0 + H), wallTex);
      const dx0 = faceW ? x0 : x0 + W - t;
      const bx0 = faceW ? x0 + W - t : x0;
      k.box(v3(bx0, y0 + t, z0), v3(bx0 + t, y0 + W - t, z0 + H), wallTex);
      k.wall('x', dx0, dx0 + t, y0 + t, y0 + W - t, z0, z0 + H, [{ a0: at.y - door.w / 2, a1: at.y + door.w / 2, z0: z0, z1: z0 + door.h }], wallTex);
      ice(v3(dx0 + 4, at.y - door.w / 2, z0), v3(dx0 + 12, at.y + door.w / 2, z0 + door.h));
      screen = v3(faceW ? x0 + W - t - 8 : x0 + t + 8, at.y, z0 + 48);
      angle = faceW ? 180 : 0;
      break;
    }
    case 'north':
    case 'south': {
      // House sticking out of a north/south server wall; its "floor" is the wall,
      // so you must walk up the wall (gravity tiles) to enter. Doorway faces down (-z).
      const s = mount === 'north' ? -1 : 1; // direction pointing into the room
      const wy = at.y; // wall plane
      const yFar = wy + s * H;
      const x0 = at.x - W / 2;
      const z0 = at.z - W / 2;
      const ya = Math.min(wy, yFar);
      const yb = Math.max(wy, yFar);
      // "roof" of the house (the side facing the room centre)
      k.box(v3(x0, s > 0 ? yb : ya - t, z0), v3(x0 + W, s > 0 ? yb + t : ya, z0 + W), floorTex);
      k.box(v3(x0, ya, z0), v3(x0 + t, yb, z0 + W), wallTex);
      k.box(v3(x0 + W - t, ya, z0), v3(x0 + W, yb, z0 + W), wallTex);
      k.box(v3(x0 + t, ya, z0 + W - t), v3(x0 + W - t, yb, z0 + W), wallTex);
      // bottom wall with the doorway (entered from below, walking along the server wall)
      const holeY0 = s > 0 ? wy : wy - door.h;
      const holeY1 = s > 0 ? wy + door.h : wy;
      const bz0 = z0;
      const bz1 = z0 + t;
      k.box(v3(x0 + t, ya, bz0), v3(at.x - door.w / 2, yb, bz1), wallTex);
      k.box(v3(at.x + door.w / 2, ya, bz0), v3(x0 + W - t, yb, bz1), wallTex);
      k.box(v3(at.x - door.w / 2, s > 0 ? holeY1 : ya, bz0), v3(at.x + door.w / 2, s > 0 ? yb : holeY0, bz1), wallTex);
      ice(v3(at.x - door.w / 2, Math.min(holeY0, holeY1), bz0 + 4), v3(at.x + door.w / 2, Math.max(holeY0, holeY1), bz0 + 12));
      screen = v3(at.x, wy + s * 40, z0 + W - t - 8);
      angle = 0;
      up = `0 ${s} 0`;
      break;
    }
    case 'ceiling': {
      // Upside-down house hanging from the ceiling; doorway faces west.
      const x0 = at.x - W / 2;
      const y0 = at.y - W / 2;
      const zc = at.z;
      k.box(v3(x0, y0, zc - H - t), v3(x0 + W, y0 + W, zc - H), floorTex);
      k.box(v3(x0, y0, zc - H), v3(x0 + W, y0 + t, zc), wallTex);
      k.box(v3(x0, y0 + W - t, zc - H), v3(x0 + W, y0 + W, zc), wallTex);
      k.box(v3(x0 + W - t, y0 + t, zc - H), v3(x0 + W, y0 + W - t, zc), wallTex);
      k.wall('x', x0, x0 + t, y0 + t, y0 + W - t, zc - H, zc, [{ a0: at.y - door.w / 2, a1: at.y + door.w / 2, z0: zc - door.h, z1: zc }], wallTex);
      ice(v3(x0 + 4, at.y - door.w / 2, zc - door.h), v3(x0 + 12, at.y + door.w / 2, zc));
      screen = v3(x0 + W - t - 8, at.y, zc - 48);
      angle = 180;
      up = '0 0 -1';
      break;
    }
  }
  k.point('d2_node', screen, { targetname: name, doorway: `${name}_door`, angle, up, ...props });
}

// ---------------------------------------------------------------------------
// Objectives, spawn groups, stage logic

function objectives(k: MapKit): void {
  k.point('d2_spawngroup', v3(-3400, 0, 64), { targetname: 'punk_base', team: 1, enabled: 1 });
  k.point('d2_spawngroup', v3(-700, -900, 64), { targetname: 'docks_corp', team: 2, enabled: 1 });
  k.point('d2_spawngroup', v3(-700, -860, 64), { targetname: 'docks_punk', team: 1, enabled: 0 });
  k.point('d2_spawngroup', v3(800, 0, 256), { targetname: 'mid_corp', team: 2, enabled: 1 });
  k.point('d2_spawngroup', v3(800, 40, 256), { targetname: 'mid_punk', team: 1, enabled: 0 });
  k.point('d2_spawngroup', v3(2500, 0, 64), { targetname: 'corp_base', team: 2, enabled: 1 });
  // "spawn_mid" is a relay: capturing it swaps the mid spawn to the capturer.
  k.point('d2_relay', v3(800, 80, 256), { targetname: 'spawn_mid', target: 'mid_corp:disable,mid_punk:enable' });

  k.point('d2_objective', v3(-700, -800, 96), {
    targetname: 'obj_docks',
    stage: 1,
    label: 'Capture the docks spawn',
    desc: 'Get through the dock wall (hack the bay door in cyberspace, crack it, climb to the upper window or crawl the duct) and hold the docks spawn uplink.',
    target: 'docks_corp:disable,docks_punk:enable,gate_docks_main:open,gate_docks_side:open,jip_docks_1:enable,jip_docks_2:enable,jip_security_side:enable,jip_docks_corp:disable,punk_base:disable',
  });
  k.point('d2_objective', v3(800, 0, 300), {
    targetname: 'obj_midspawn',
    stage: 2,
    label: 'Hack the mid-spawn',
    desc: 'Jack in and hack the Mid-spawn control node in the YELLOW server (it sits on the north wall, walk up the gravity tiles).',
    target: 'gate_core_main:open,gate_core_maint:open,jip_security_1:enable,jip_security_2:enable,ice_red_gate:pass3,jip_mid_corp:disable,docks_punk:disable',
  });
  k.point('d2_objective', v3(1680, 0, 400), {
    targetname: 'obj_security',
    stage: 3,
    optional: 1,
    label: 'Drop core security',
    desc: 'Break the Encryption on the Core security node in the RED server to drop the force field and core turrets.',
  });
  k.point('d2_objective', v3(1680, 0, 300), {
    targetname: 'obj_core',
    stage: 3,
    final: 1,
    label: 'Destroy the data core',
    desc: 'With security down, destroy the data core.',
  });
}

// ---------------------------------------------------------------------------

/** A brush that is not added to worldspawn (for brush entities). */
const boxAt = (a: Vec3, b: Vec3, tex: Tex) => boxBrush(a, b, tex);

function gateDoor(k: MapKit, name: string, a: Vec3, b: Vec3): void {
  // Stage gates: open for Corps (team doors) until the stage falls, then open for good.
  k.brushEnt('func_door', [boxAt(a, b, { sides: 'd2/door', top: 'd2/trim' })], {
    targetname: name,
    angle: -1,
    speed: 160,
    lip: 8,
    wait: 2,
    team: 2,
    locked: 1,
    label: 'Security gate',
  });
  k.box(v3(a.x - 8, a.y - 12, b.z), v3(b.x + 8, b.y + 12, b.z + 12), 'd2/hazard');
}

function jip(k: MapKit, name: string, at: Vec3, angle: number, props: Record<string, string | number>): void {
  // Terminal pedestal (solid) + the jack-in point entity in front of it.
  const r = (angle * Math.PI) / 180;
  const fx = Math.round(Math.cos(r));
  const fy = Math.round(Math.sin(r));
  const c = v3(at.x - fx * 24, at.y - fy * 24, at.z);
  k.box(v3(c.x - 20, c.y - 20, at.z), v3(c.x + 20, c.y + 20, at.z + 48), { top: 'd2/screen', sides: 'd2/trim' });
  k.box(v3(c.x - 16, c.y - 16, at.z + 48), v3(c.x + 16, c.y + 16, at.z + 96), { sides: 'd2/screen', top: 'd2/trim' });
  k.point('d2_jackin', v3(at.x + fx * 24, at.y + fy * 24, at.z + 1), { targetname: name, angle, ...props });
}
