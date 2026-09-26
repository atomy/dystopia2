// Snapshot model + binary codec (server -> client, 30 Hz).
// Each client gets: rules, its private predicted state, all players, dynamic
// entity states, and one-shot events since the previous snapshot.

import type { Vec3 } from '../math.js';
import { ByteReader, ByteWriter } from './bytes.js';
import { BinMsg } from './protocol.js';
import { newMoveState, type PlayerMoveState } from '../sim/pmove.js';
import { WEAPON_COUNT, type WeaponState } from '../sim/weapons.js';
import { newCyberState, type CyberMoveState } from '../sim/cybermove.js';

// ---- player flags

export const PF = {
  ALIVE: 1 << 0,
  DUCKED: 1 << 1,
  ONGROUND: 1 << 2,
  STEALTH: 1 << 3,
  THERMAL: 1 << 4,
  DECKED: 1 << 5,
  HANGING: 1 << 6,
  RELOADING: 1 << 7,
  BLOCKING: 1 << 8,
  ZOOMED: 1 << 9,
  EMP: 1 << 10,
  SPRINT: 1 << 11,
  BOOSTED: 1 << 12,
  SLIDING: 1 << 13,
  /** Revealed to the receiving client's team (TAC scan / camera). */
  REVEALED: 1 << 14,
  SPINNING: 1 << 15,
} as const;

export interface NetPlayer {
  id: number;
  team: number;
  cls: number;
  flags: number;
  origin: Vec3;
  velocity: Vec3;
  yaw: number;
  pitch: number;
  weapon: number;
  health: number;
  armor: number;
  energy: number;
  implants: number;
  /** Stealth visibility 0 (invisible) .. 1 (fully visible). */
  vis: number;
  /** Cyber avatar, when decked. */
  cyber: { origin: Vec3; up: Vec3; forward: Vec3 } | null;
}

export interface NetRules {
  phase: number;
  stage: number;
  stageCount: number;
  attackers: number;
  timeLeft: number;
  wavePunk: number;
  waveCorp: number;
  winner: number;
  ff: boolean;
}

export interface NetProgram {
  program: number;
  target: number;
  progress: number;
  /** Minigame: index of the next expected step, and the shuffled button labels (step indices). */
  step: number;
  buttons: number[];
}

export interface NetLocal {
  id: number;
  t: number;
  move: PlayerMoveState;
  weap: WeaponState;
  cyber: CyberMoveState | null;
  energy: number;
  maxEnergy: number;
  emp: number;
  respawnIn: number;
  cls: number;
  implants: number;
  /** Next-spawn loadout. */
  nextCls: number;
  nextImplants: number;
  cyberMode: number;
  hitscanReady: number;
  program: NetProgram | null;
  /** Seconds since the decker's meat body was last damaged (for the alarm), large if never. */
  bodyAlarm: number;
  /** Meat-space crack progress 0..1, or -1. */
  crack: number;
  /** Mediplant / TAC cooldown remaining. */
  tacCooldown: number;
}

export enum EntKind {
  Door = 1,
  Turret = 2,
  Breakable = 3,
  ForceField = 4,
  Jip = 5,
  Screen = 6,
  Node = 7,
  Ice = 8,
  Crack = 9,
  Camera = 10,
  Objective = 11,
  Projectile = 20,
  Crystal = 21,
}

export enum ProjKind {
  Frag = 1,
  Emp = 2,
  CyberOrb = 3,
  IceMine = 4,
}

export interface NetEnt {
  id: number;
  kind: EntKind;
  /** Owning team / pass team. */
  team: number;
  /** Generic state bits (meaning per kind). */
  state: number;
  /** Door open fraction, health fraction, progress, lock time... (0..1 unless noted). */
  value: number;
  /** Turret/camera aim; occupant for JIPs; protection for nodes; ice flags. */
  a: number;
  b: number;
  origin?: Vec3;
  velocity?: Vec3;
}

export enum EvKind {
  Fire = 1,
  Melee = 2,
  Explosion = 3,
  Kill = 4,
  Damage = 5,
  Hit = 6,
  Sound = 7,
  Tac = 8,
  Jack = 9,
  CyberFire = 10,
  Program = 11,
  Alarm = 12,
  Heal = 13,
  TurretFire = 14,
}

export type NetEvent =
  | { k: EvKind.Fire; shooter: number; weapon: number; alt: boolean; start: Vec3; ends: Vec3[] }
  | { k: EvKind.Melee; attacker: number; weapon: number; dir: number; result: number }
  | { k: EvKind.Explosion; kind: number; pos: Vec3; radius: number }
  | { k: EvKind.Kill; killer: number; victim: number; weapon: number; headshot: boolean }
  | { k: EvKind.Damage; amount: number; dir: Vec3; armor: boolean }
  | { k: EvKind.Hit; victim: number; amount: number; headshot: boolean; kill: boolean }
  | { k: EvKind.Sound; sound: number; pos: Vec3; player: number }
  | { k: EvKind.Tac; team: number; pings: { id: number; pos: Vec3 }[] }
  | { k: EvKind.Jack; player: number; jip: number; inout: number }
  | { k: EvKind.CyberFire; shooter: number; kind: number; start: Vec3; end: Vec3 }
  | { k: EvKind.Program; player: number; program: number; target: number; result: number }
  | { k: EvKind.Alarm; kind: number; ref: number; pos: Vec3 }
  | { k: EvKind.Heal; healer: number; target: number; amount: number }
  | { k: EvKind.TurretFire; turret: number; start: Vec3; end: Vec3 };

/** Special weapon ids for kill feed causes. */
export const Cause = {
  Fall: 100,
  Goomba: 101,
  Dumpshock: 102,
  Suicide: 103,
  Turret: 104,
  Cyber: 105,
  World: 106,
  Explosion: 107,
} as const;

export enum Snd {
  Jump = 1,
  Land = 2,
  Boost = 3,
  Ledge = 4,
  Pain = 5,
  Death = 6,
  Reload = 7,
  Dry = 8,
  Switch = 9,
  StealthOn = 10,
  StealthOff = 11,
  Thermal = 12,
  TacPing = 13,
  Heal = 14,
  JackIn = 15,
  JackOut = 16,
  Eject = 17,
  DoorMove = 18,
  Capture = 19,
  Denied = 20,
  Bounce = 21,
  Crystal = 22,
  Katana = 23,
  Block = 24,
  Punch = 25,
  GrenadeBounce = 26,
  Spawn = 27,
  Wave = 28,
  ProgramDone = 29,
  ProgramFail = 30,
  Alarm = 31,
  Footstep = 32,
  Crack = 33,
  Pad = 34,
}

export interface Snapshot {
  tick: number;
  ack: number;
  rules: NetRules;
  local: NetLocal | null;
  players: NetPlayer[];
  ents: NetEnt[];
  events: NetEvent[];
}

// ---------------------------------------------------------------------------

const wv = (w: ByteWriter, v: Vec3) => w.f32(v.x).f32(v.y).f32(v.z);
const rv = (r: ByteReader): Vec3 => ({ x: r.f32(), y: r.f32(), z: r.f32() });

function writeMove(w: ByteWriter, m: PlayerMoveState): void {
  wv(w, m.origin);
  wv(w, m.velocity);
  let f = 0;
  if (m.onGround) f |= 1;
  if (m.ducked) f |= 2;
  if (m.jumpHeld) f |= 4;
  if (m.hanging) f |= 8;
  if (m.boosted) f |= 16;
  if (m.sprinting) f |= 32;
  w.u8(f);
  w.dir8(m.hangNormal.x, m.hangNormal.y, m.hangNormal.z);
  w.f32(m.slideTime).f32(m.boostCharge);
}

function readMove(r: ByteReader): PlayerMoveState {
  const m = newMoveState(rv(r));
  m.velocity = rv(r);
  const f = r.u8();
  m.onGround = (f & 1) !== 0;
  m.ducked = (f & 2) !== 0;
  m.jumpHeld = (f & 4) !== 0;
  m.hanging = (f & 8) !== 0;
  m.boosted = (f & 16) !== 0;
  m.sprinting = (f & 32) !== 0;
  m.hangNormal = r.dir8();
  m.slideTime = r.f32();
  m.boostCharge = r.f32();
  return m;
}

function writeWeap(w: ByteWriter, s: WeaponState): void {
  w.u8(s.owned.length);
  for (const id of s.owned) w.u8(id);
  w.u8(s.current).u8(s.previous);
  w.f64(s.switchDone).f64(s.nextAttack).f64(s.reloadEnd).f64(s.cookStart);
  for (let i = 0; i < WEAPON_COUNT; i++) w.u16(s.clip[i] ?? 0).u16(s.reserve[i] ?? 0);
  w.f32(s.spin).f32(s.heat).u8(s.burstLeft);
  w.u8((s.blocking ? 1 : 0) | (s.zoomed ? 2 : 0) | (s.attackHeld ? 4 : 0));
}

function readWeap(r: ByteReader): WeaponState {
  const n = r.u8();
  const owned: number[] = [];
  for (let i = 0; i < n; i++) owned.push(r.u8());
  const current = r.u8();
  const previous = r.u8();
  const switchDone = r.f64();
  const nextAttack = r.f64();
  const reloadEnd = r.f64();
  const cookStart = r.f64();
  const clip: number[] = [];
  const reserve: number[] = [];
  for (let i = 0; i < WEAPON_COUNT; i++) {
    clip.push(r.u16());
    reserve.push(r.u16());
  }
  const spin = r.f32();
  const heat = r.f32();
  const burstLeft = r.u8();
  const fl = r.u8();
  return {
    owned,
    current,
    previous,
    switchDone,
    nextAttack,
    clip,
    reserve,
    reloadEnd,
    spin,
    heat,
    burstLeft,
    cookStart,
    blocking: (fl & 1) !== 0,
    zoomed: (fl & 2) !== 0,
    attackHeld: (fl & 4) !== 0,
  };
}

function writeCyber(w: ByteWriter, c: CyberMoveState): void {
  wv(w, c.origin);
  wv(w, c.velocity);
  wv(w, c.up);
  wv(w, c.north);
  w.u8((c.onGround ? 1 : 0) | (c.zeroG ? 2 : 0) | (c.jumpHeld ? 4 : 0));
  w.u16(c.frame).f32(c.stun);
}

function readCyber(r: ByteReader): CyberMoveState {
  const c = newCyberState(rv(r));
  c.velocity = rv(r);
  c.up = rv(r);
  c.north = rv(r);
  const f = r.u8();
  c.onGround = (f & 1) !== 0;
  c.zeroG = (f & 2) !== 0;
  c.jumpHeld = (f & 4) !== 0;
  c.frame = r.u16();
  c.stun = r.f32();
  return c;
}

function writeEvent(w: ByteWriter, e: NetEvent): void {
  w.u8(e.k);
  switch (e.k) {
    case EvKind.Fire:
      w.u8(e.shooter).u8(e.weapon).bool(e.alt);
      wv(w, e.start);
      w.u8(e.ends.length);
      for (const p of e.ends) wv(w, p);
      break;
    case EvKind.Melee:
      w.u8(e.attacker).u8(e.weapon).i8(e.dir).u8(e.result);
      break;
    case EvKind.Explosion:
      w.u8(e.kind);
      wv(w, e.pos);
      w.u16(e.radius);
      break;
    case EvKind.Kill:
      w.u8(e.killer).u8(e.victim).u8(e.weapon).bool(e.headshot);
      break;
    case EvKind.Damage:
      w.u16(e.amount).dir8(e.dir.x, e.dir.y, e.dir.z).bool(e.armor);
      break;
    case EvKind.Hit:
      w.u8(e.victim).u16(e.amount).bool(e.headshot).bool(e.kill);
      break;
    case EvKind.Sound:
      w.u8(e.sound);
      wv(w, e.pos);
      w.u8(e.player);
      break;
    case EvKind.Tac:
      w.u8(e.team).u8(e.pings.length);
      for (const p of e.pings) {
        w.u8(p.id);
        wv(w, p.pos);
      }
      break;
    case EvKind.Jack:
      w.u8(e.player).u16(e.jip).u8(e.inout);
      break;
    case EvKind.CyberFire:
      w.u8(e.shooter).u8(e.kind);
      wv(w, e.start);
      wv(w, e.end);
      break;
    case EvKind.Program:
      w.u8(e.player).u8(e.program).u16(e.target).u8(e.result);
      break;
    case EvKind.Alarm:
      w.u8(e.kind).u16(e.ref);
      wv(w, e.pos);
      break;
    case EvKind.Heal:
      w.u8(e.healer).u8(e.target).u8(e.amount);
      break;
    case EvKind.TurretFire:
      w.u16(e.turret);
      wv(w, e.start);
      wv(w, e.end);
      break;
  }
}

function readEvent(r: ByteReader): NetEvent {
  const k = r.u8() as EvKind;
  switch (k) {
    case EvKind.Fire: {
      const shooter = r.u8();
      const weapon = r.u8();
      const alt = r.bool();
      const start = rv(r);
      const n = r.u8();
      const ends: Vec3[] = [];
      for (let i = 0; i < n; i++) ends.push(rv(r));
      return { k, shooter, weapon, alt, start, ends };
    }
    case EvKind.Melee:
      return { k, attacker: r.u8(), weapon: r.u8(), dir: r.i8(), result: r.u8() };
    case EvKind.Explosion:
      return { k, kind: r.u8(), pos: rv(r), radius: r.u16() };
    case EvKind.Kill:
      return { k, killer: r.u8(), victim: r.u8(), weapon: r.u8(), headshot: r.bool() };
    case EvKind.Damage:
      return { k, amount: r.u16(), dir: r.dir8(), armor: r.bool() };
    case EvKind.Hit:
      return { k, victim: r.u8(), amount: r.u16(), headshot: r.bool(), kill: r.bool() };
    case EvKind.Sound:
      return { k, sound: r.u8(), pos: rv(r), player: r.u8() };
    case EvKind.Tac: {
      const team = r.u8();
      const n = r.u8();
      const pings: { id: number; pos: Vec3 }[] = [];
      for (let i = 0; i < n; i++) pings.push({ id: r.u8(), pos: rv(r) });
      return { k, team, pings };
    }
    case EvKind.Jack:
      return { k, player: r.u8(), jip: r.u16(), inout: r.u8() };
    case EvKind.CyberFire:
      return { k, shooter: r.u8(), kind: r.u8(), start: rv(r), end: rv(r) };
    case EvKind.Program:
      return { k, player: r.u8(), program: r.u8(), target: r.u16(), result: r.u8() };
    case EvKind.Alarm:
      return { k, kind: r.u8(), ref: r.u16(), pos: rv(r) };
    case EvKind.Heal:
      return { k, healer: r.u8(), target: r.u8(), amount: r.u8() };
    case EvKind.TurretFire:
      return { k, turret: r.u16(), start: rv(r), end: rv(r) };
    default:
      throw new Error(`bad event kind ${k}`);
  }
}

export function encodeSnapshot(s: Snapshot): Uint8Array {
  const w = new ByteWriter(4096);
  w.u8(BinMsg.Snapshot);
  w.u32(s.tick).u32(s.ack);
  const ru = s.rules;
  w.u8(ru.phase).u8(ru.stage).u8(ru.stageCount).u8(ru.attackers);
  w.f32(ru.timeLeft).f32(ru.wavePunk).f32(ru.waveCorp).u8(ru.winner).bool(ru.ff);

  const L = s.local;
  w.bool(L !== null);
  if (L) {
    w.u8(L.id).f64(L.t);
    writeMove(w, L.move);
    writeWeap(w, L.weap);
    w.bool(L.cyber !== null);
    if (L.cyber) writeCyber(w, L.cyber);
    w.f32(L.energy).f32(L.maxEnergy).f32(L.emp).f32(L.respawnIn);
    w.u8(L.cls).u16(L.implants).u8(L.nextCls).u16(L.nextImplants);
    w.u8(L.cyberMode).f32(L.hitscanReady);
    w.bool(L.program !== null);
    if (L.program) {
      const p = L.program;
      w.u8(p.program).u16(p.target).f32(p.progress).u8(p.step).u8(p.buttons.length);
      for (const b of p.buttons) w.u8(b);
    }
    w.f32(L.bodyAlarm).f32(L.crack).f32(L.tacCooldown);
  }

  w.u8(s.players.length);
  for (const p of s.players) {
    w.u8(p.id).u8(p.team).u8(p.cls).u16(p.flags);
    wv(w, p.origin);
    w.i16(p.velocity.x).i16(p.velocity.y).i16(p.velocity.z);
    w.angle16(p.yaw).angle16(p.pitch);
    w.u8(p.weapon).u8(Math.max(0, Math.min(255, Math.ceil(p.health)))).u8(Math.max(0, Math.min(255, Math.ceil(p.armor))));
    w.u8(Math.max(0, Math.min(255, Math.round(p.energy)))).u16(p.implants).u8(Math.round(p.vis * 255));
    w.bool(p.cyber !== null);
    if (p.cyber) {
      wv(w, p.cyber.origin);
      w.dir8(p.cyber.up.x, p.cyber.up.y, p.cyber.up.z);
      w.dir8(p.cyber.forward.x, p.cyber.forward.y, p.cyber.forward.z);
    }
  }

  w.u16(s.ents.length);
  for (const e of s.ents) {
    w.u16(e.id).u8(e.kind).u8(e.team).u8(e.state).f32(e.value).i16(e.a).i16(e.b);
    const hasPos = e.origin !== undefined;
    w.bool(hasPos);
    if (hasPos) {
      wv(w, e.origin!);
      const v = e.velocity ?? { x: 0, y: 0, z: 0 };
      wv(w, v);
    }
  }

  w.u16(s.events.length);
  for (const e of s.events) writeEvent(w, e);
  return w.bytes();
}

export function decodeSnapshot(data: Uint8Array): Snapshot {
  const r = new ByteReader(data);
  if (r.u8() !== BinMsg.Snapshot) throw new Error('not a snapshot');
  const tick = r.u32();
  const ack = r.u32();
  const rules: NetRules = {
    phase: r.u8(),
    stage: r.u8(),
    stageCount: r.u8(),
    attackers: r.u8(),
    timeLeft: r.f32(),
    wavePunk: r.f32(),
    waveCorp: r.f32(),
    winner: r.u8(),
    ff: r.bool(),
  };
  let local: NetLocal | null = null;
  if (r.bool()) {
    const id = r.u8();
    const t = r.f64();
    const move = readMove(r);
    const weap = readWeap(r);
    const cyber = r.bool() ? readCyber(r) : null;
    const energy = r.f32();
    const maxEnergy = r.f32();
    const emp = r.f32();
    const respawnIn = r.f32();
    const cls = r.u8();
    const implants = r.u16();
    const nextCls = r.u8();
    const nextImplants = r.u16();
    const cyberMode = r.u8();
    const hitscanReady = r.f32();
    let program: NetProgram | null = null;
    if (r.bool()) {
      const pr = r.u8();
      const target = r.u16();
      const progress = r.f32();
      const step = r.u8();
      const n = r.u8();
      const buttons: number[] = [];
      for (let i = 0; i < n; i++) buttons.push(r.u8());
      program = { program: pr, target, progress, step, buttons };
    }
    const bodyAlarm = r.f32();
    const crack = r.f32();
    const tacCooldown = r.f32();
    local = {
      id,
      t,
      move,
      weap,
      cyber,
      energy,
      maxEnergy,
      emp,
      respawnIn,
      cls,
      implants,
      nextCls,
      nextImplants,
      cyberMode,
      hitscanReady,
      program,
      bodyAlarm,
      crack,
      tacCooldown,
    };
  }

  const players: NetPlayer[] = [];
  const np = r.u8();
  for (let i = 0; i < np; i++) {
    const id = r.u8();
    const team = r.u8();
    const cls = r.u8();
    const flags = r.u16();
    const origin = rv(r);
    const velocity = { x: r.i16(), y: r.i16(), z: r.i16() };
    const yaw = r.angle16();
    const pitch = r.angle16();
    const weapon = r.u8();
    const health = r.u8();
    const armor = r.u8();
    const energy = r.u8();
    const implants = r.u16();
    const vis = r.u8() / 255;
    let cyber: NetPlayer['cyber'] = null;
    if (r.bool()) cyber = { origin: rv(r), up: r.dir8(), forward: r.dir8() };
    players.push({ id, team, cls, flags, origin, velocity, yaw, pitch, weapon, health, armor, energy, implants, vis, cyber });
  }

  const ents: NetEnt[] = [];
  const ne = r.u16();
  for (let i = 0; i < ne; i++) {
    const e: NetEnt = { id: r.u16(), kind: r.u8(), team: r.u8(), state: r.u8(), value: r.f32(), a: r.i16(), b: r.i16() };
    if (r.bool()) {
      e.origin = rv(r);
      e.velocity = rv(r);
    }
    ents.push(e);
  }

  const events: NetEvent[] = [];
  const nev = r.u16();
  for (let i = 0; i < nev; i++) events.push(readEvent(r));
  return { tick, ack, rules, local, players, ents, events };
}

// ---------------------------------------------------------------------------
// User commands (client -> server). Each packet carries the newest commands
// plus a couple of older ones for redundancy.

export function encodeUserCmds(cmds: import('../sim/pmove.js').UserCmd[]): Uint8Array {
  const w = new ByteWriter(64 + cmds.length * 32);
  w.u8(BinMsg.UserCmds).u8(cmds.length);
  for (const c of cmds) {
    w.u32(c.seq).u8(Math.max(0, Math.min(255, Math.round(c.msec))));
    w.i8(c.forward * 127).i8(c.side * 127);
    w.u32(c.buttons);
    w.f32(c.pitch).f32(c.yaw);
    w.u8(c.weapon).f64(c.viewTick);
  }
  return w.bytes();
}

export function decodeUserCmds(data: Uint8Array): import('../sim/pmove.js').UserCmd[] {
  const r = new ByteReader(data);
  if (r.u8() !== BinMsg.UserCmds) throw new Error('not usercmds');
  const n = Math.min(r.u8(), 32);
  const out: import('../sim/pmove.js').UserCmd[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      seq: r.u32(),
      msec: r.u8(),
      forward: r.i8() / 127,
      side: r.i8() / 127,
      buttons: r.u32(),
      pitch: r.f32(),
      yaw: r.f32(),
      weapon: r.u8(),
      viewTick: r.f64(),
    });
  }
  return out;
}

/** Apply the wire quantization to a command, so client prediction matches the server exactly. */
export function quantizeCmd(c: import('../sim/pmove.js').UserCmd): import('../sim/pmove.js').UserCmd {
  const q8 = (v: number) => Math.max(-128, Math.min(127, Math.round(v * 127))) / 127;
  return {
    ...c,
    msec: Math.max(0, Math.min(255, Math.round(c.msec))),
    forward: q8(c.forward),
    side: q8(c.side),
    pitch: Math.fround(c.pitch),
    yaw: Math.fround(c.yaw),
  };
}
