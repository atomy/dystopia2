// Cyberspace: jacking in/out, avatar movement, cyber weapons, node hacking,
// hacking programs + minigame, ICE traps, energy crystals.

import {
  type Vec3,
  type UserCmd,
  type NetEnt,
  type CyberEnv,
  type ModelFilter,
  type BrushModel,
  v3,
  vadd,
  vsub,
  vscale,
  vma,
  vlen,
  vdist,
  vnorm,
  vdot,
  vcross,
  vcopy,
  rayAabb,
  Buttons,
  cyberMove,
  cyberBasis,
  cyberEye,
  newCyberState,
  angleVectors,
  CYBER_HULL,
  MASK_PLAYERSOLID,
  CONTENTS_SOLID,
  boxInBrushes,
  EvKind,
  EntKind,
  ProjKind,
  Snd,
  Cause,
  ImplantId,
  ProgramId,
  PROGRAMS,
  PROGRAM_STEP_TIME,
  PROGRAM_STEP_COST,
  STEP_LABELS,
  NODE_HACK_TIME,
  PROGRAM_RANGE,
  CYBER,
  CyberWeapon,
  JACKIN_MIN_ENERGY,
  DUMPSHOCK_DAMAGE,
  JIP_LOCK_SECONDS,
  WEDGE_SECONDS,
  ICE_MINE_DAMAGE,
  GREEN_ICE_STUN,
  makeRng,
  makeCyberEnv,
} from '@d2/shared';
import type { Game } from './game.js';
import type { ServerPlayer } from './player.js';
import { IceEnt, NodeEnt, ICE_ALARM, ICE_MINE, ICE_GREEN, zoneContains } from './entities.js';
import { Projectile } from './combat.js';

const ZERO = v3();
const AVATAR_HIT = 16;

// ---------------------------------------------------------------------------
// Crystals

export class Crystal {
  constructor(
    readonly id: number,
    readonly origin: Vec3,
    public value: number,
    readonly owner: number,
    readonly born: number,
  ) {}
  net(): NetEnt {
    return { id: this.id, kind: EntKind.Crystal, team: 0, state: 0, value: this.value, a: this.owner, b: 0, origin: this.origin };
  }
}

// ---------------------------------------------------------------------------
// Environment

const envCache = new WeakMap<Game, CyberEnv>();

export function cyberEnv(g: Game): CyberEnv {
  let env = envCache.get(g);
  if (!env) {
    env = makeCyberEnv(g.zones);
    envCache.set(g, env);
  }
  return env;
}

/** Filter that ignores ICE entirely (projectile splash leaks through ICE). */
function noIceFilter(g: Game): ModelFilter {
  return (m: BrushModel) => !(g.modelOwner.get(m.id) instanceof IceEnt);
}

// ---------------------------------------------------------------------------
// Jack in / out

export function tryJackIn(g: Game, p: ServerPlayer): void {
  if (!p.alive || p.decked || !p.hasDeck || g.rules.phase === 2) return;
  const deny = () => g.sound(Snd.Denied, p.move.origin, p.id, { player: p.id });
  let best = null;
  let bestD = Infinity;
  for (const j of g.jips) {
    const dx = j.origin.x - p.move.origin.x;
    const dy = j.origin.y - p.move.origin.y;
    const d = Math.hypot(dx, dy);
    if (d < 80 && Math.abs(j.origin.z - p.move.origin.z) < 64 && d < bestD) {
      best = j;
      bestD = d;
    }
  }
  if (!best) return deny();
  if (!best.usableBy(p.team) || best.occupant || g.now < best.lockUntil) return deny();
  if (g.now < p.empUntil || p.energy < JACKIN_MIN_ENERGY) return deny();
  const sp = g.cyberSpawn(best.cyberSpawnFor(p.team));
  if (!sp) return deny();
  const up = sp.up;
  let north = angleVectors(0, sp.angle).forward;
  north = vnorm(vsub(north, vscale(up, vdot(north, up))));
  if (vlen(north) < 0.5) north = vnorm(vcross(up, v3(0, 1, 0)));
  p.cyber = newCyberState(vadd(sp.origin, vscale(up, 4)), up, north);
  p.jip = best;
  best.occupant = p.id;
  p.move.velocity = v3();
  p.cyberDamageTaken = 0;
  p.nextHitscan = p.t;
  p.nextProj = p.t;
  p.program = null;
  p.useProgress = 0;
  p.greenEjectAt = 0;
  p.crackTarget = 0;
  g.emit({ k: EvKind.Jack, player: p.id, jip: best.id, inout: 1 });
  g.sound(Snd.JackIn, p.move.origin, p.id);
}

/**
 * Leave cyberspace.
 * `ejected`: energy ran out (dumpshock + JIP lock + crystal).
 * `died`: meat body died. `emp`: ripped out by an EMP.
 */
export function jackOut(g: Game, p: ServerPlayer, ejected: boolean, died = false, emp = false): void {
  const c = p.cyber;
  if (!c) return;
  const jip = p.jip;
  if (p.cyberDamageTaken > 1) {
    g.crystals.push(new Crystal(g.allocId(), vcopy(c.origin), Math.round(p.cyberDamageTaken / 2), p.id, g.now));
  }
  p.cyber = null;
  p.jip = null;
  p.program = null;
  p.greenEjectAt = 0;
  for (const n of g.nodes) if (n.hacker === p.id) {
    n.hacker = 0;
    n.hackProgress = 0;
  }
  if (jip) {
    jip.occupant = 0;
    if (ejected) jip.lockUntil = g.now + JIP_LOCK_SECONDS;
    else if (emp) jip.lockUntil = g.now + 3;
  }
  g.emit({ k: EvKind.Jack, player: p.id, jip: jip?.id ?? 0, inout: ejected ? 2 : 0 });
  g.sound(ejected || emp ? Snd.Eject : Snd.JackOut, p.move.origin, p.id);
  if (ejected && !died) {
    const attacker = p.lastCyberAttacker ? (g.players.get(p.lastCyberAttacker) ?? null) : null;
    g.damage(p, DUMPSHOCK_DAMAGE, attacker, Cause.Dumpshock);
  }
}

function eject(g: Game, p: ServerPlayer, attacker: ServerPlayer | null): void {
  if (attacker && attacker !== p) {
    attacker.score += 1;
    attacker.kills++;
    g.emit({ k: EvKind.Kill, killer: attacker.id, victim: p.id, weapon: Cause.Cyber, headshot: false });
  }
  jackOut(g, p, true);
}

export function cyberDamage(g: Game, victim: ServerPlayer, amount: number, attacker: ServerPlayer | null): void {
  if (!victim.cyber || amount <= 0) return;
  if (attacker && attacker !== victim && attacker.team === victim.team && !g.rules.ff) return;
  victim.energy -= amount;
  victim.cyberDamageTaken += amount;
  if (attacker && attacker !== victim) {
    victim.lastCyberAttacker = attacker.id;
    g.emit({ k: EvKind.Hit, victim: victim.id, amount: Math.round(amount), headshot: false, kill: victim.energy <= 0 }, { player: attacker.id });
  }
  g.emit({ k: EvKind.Damage, amount: Math.round(amount), dir: v3(), armor: false }, { player: victim.id });
  if (victim.energy <= 0) {
    victim.energy = 0;
    eject(g, victim, attacker);
  }
}

// ---------------------------------------------------------------------------
// Per-command cyber simulation

export function cyberCmd(g: Game, p: ServerPlayer, cmd: UserCmd, pressed: number, dt: number): void {
  const c = p.cyber!;
  p.pitch = cmd.pitch;
  p.yaw = cmd.yaw;

  if (pressed & Buttons.DECK) {
    jackOut(g, p, false);
    return;
  }
  if (p.greenEjectAt > 0 && g.now >= p.greenEjectAt) {
    p.empUntil = Math.max(p.empUntil, g.now + 5);
    jackOut(g, p, false, false, true);
    return;
  }

  const filter = g.teamFilter(p.team);
  const ev = cyberMove(g.level.collision, c, cmd, cyberEnv(g), filter);
  if (ev.bounced && (g.tick & 3) === 0) g.sound(Snd.Bounce, c.origin, p.id);
  if (ev.padLaunched) g.sound(Snd.Pad, c.origin, p.id);

  // Hazard zones.
  for (const z of g.zones) {
    if (!zoneContains(z, c.origin)) continue;
    if (z.kind === 'drain') p.energy = Math.min(p.maxEnergy, p.energy - z.rate * dt);
    else if (z.kind === 'eject') {
      eject(g, p, null);
      return;
    }
  }
  if (p.energy <= 0) {
    eject(g, p, p.lastCyberAttacker ? (g.players.get(p.lastCyberAttacker) ?? null) : null);
    return;
  }

  // Crystals.
  for (const cr of g.crystals) {
    if (cr.value <= 0 || cr.owner === p.id) continue;
    if (vdist(cr.origin, c.origin) < 40) {
      p.energy = Math.min(p.maxEnergy, p.energy + cr.value);
      cr.value = 0;
      g.sound(Snd.Crystal, cr.origin, p.id);
    }
  }

  // Green ICE: touching a trapped barrier stuns, then ejects.
  if (!p.greenEjectAt) {
    const half = CYBER_HULL + 3;
    for (const ice of g.ices) {
      if (!(ice.traps & ICE_GREEN) || ice.trapTeam === p.team || !ice.active || g.now < ice.wedgedUntil) continue;
      if (vdist(ice.center, c.origin) > 300) continue;
      if (boxInBrushes(c.origin, v3(-half, -half, -half), v3(half, half, half), ice.src.brushes)) {
        triggerGreen(g, ice, p);
        break;
      }
    }
  }

  // Weapon mode toggle (reload key).
  if (pressed & Buttons.RELOAD) p.cyberMode = p.cyberMode === CyberWeapon.Hitscan ? CyberWeapon.Shaft : CyberWeapon.Hitscan;

  const basis = cyberBasis(c.up, c.north, cmd.pitch, cmd.yaw);
  const eye = cyberEye(c);
  const attack = (cmd.buttons & Buttons.ATTACK) !== 0 && g.rules.phase !== 2;
  const attack2 = (cmd.buttons & Buttons.ATTACK2) !== 0 && g.rules.phase !== 2;

  if (attack && p.cyberMode === CyberWeapon.Hitscan && p.t >= p.nextHitscan && p.energy > CYBER.hitscanCost) {
    p.nextHitscan = p.t + CYBER.hitscanRecharge;
    p.energy -= CYBER.hitscanCost;
    const end = vma(eye, 8192, basis.forward);
    const hit = cyberRay(g, p, eye, end, CYBER.hitscanHull / 2, cmd.viewTick);
    const hitPos = vma(eye, 8192 * hit.frac, basis.forward);
    if (hit.player) cyberDamage(g, hit.player, CYBER.hitscanDamage, p);
    if (hit.mine) destroyProjectile(g, hit.mine);
    g.emit({ k: EvKind.CyberFire, shooter: p.id, kind: 0, start: eye, end: hitPos });
  }
  p.shafting = false;
  if (attack && p.cyberMode === CyberWeapon.Shaft && p.energy > 0.5) {
    p.shafting = true;
    p.energy -= CYBER.shaftCostPerSec * dt;
    const end = vma(eye, CYBER.shaftRange, basis.forward);
    const hit = cyberRay(g, p, eye, end, 10, cmd.viewTick);
    if (hit.player) cyberDamage(g, hit.player, CYBER.shaftDps * dt, p);
    if (hit.mine) destroyProjectile(g, hit.mine);
    if (g.now - p.lastShaftFx > 0.08) {
      p.lastShaftFx = g.now;
      g.emit({ k: EvKind.CyberFire, shooter: p.id, kind: 1, start: eye, end: vma(eye, CYBER.shaftRange * hit.frac, basis.forward) });
    }
  }
  if (attack2 && p.t >= p.nextProj && p.energy > CYBER.projCost) {
    p.nextProj = p.t + CYBER.projRefire;
    p.energy -= CYBER.projCost;
    const pr = new Projectile(g, ProjKind.CyberOrb, p, vma(eye, 14, basis.forward), vscale(basis.forward, CYBER.projSpeed), 4);
    g.projectiles.push(pr);
    g.emit({ k: EvKind.CyberFire, shooter: p.id, kind: 2, start: eye, end: vma(eye, 64, basis.forward) });
  }

  programsCmd(g, p, cmd, pressed, dt, eye, basis.forward);
}

interface CyberHit {
  frac: number;
  player: ServerPlayer | null;
  mine: Projectile | null;
}

function historicCyber(g: Game, q: ServerPlayer, viewTick: number): Vec3 | null {
  if (!q.cyber) return null;
  const t = Math.max(g.tick - 24, Math.min(g.tick, viewTick));
  for (let i = q.history.length - 1; i > 0; i--) {
    const a = q.history[i - 1]!;
    const b = q.history[i]!;
    if (a.tick <= t && b.tick >= t && a.cyber && b.cyber) {
      const f = b.tick === a.tick ? 0 : (t - a.tick) / (b.tick - a.tick);
      return v3(a.cyber.x + (b.cyber.x - a.cyber.x) * f, a.cyber.y + (b.cyber.y - a.cyber.y) * f, a.cyber.z + (b.cyber.z - a.cyber.z) * f);
    }
  }
  return q.cyber.origin;
}

function cyberRay(g: Game, shooter: ServerPlayer, start: Vec3, end: Vec3, half: number, viewTick: number): CyberHit {
  const hs = v3(half, half, half);
  const tr = g.level.collision.trace(start, end, vscale(hs, -1), hs, CONTENTS_SOLID, g.cyberShotFilter);
  const res: CyberHit = { frac: tr.fraction, player: null, mine: null };
  const delta = vsub(end, start);
  const r = AVATAR_HIT + half;
  for (const q of g.players.values()) {
    if (q === shooter || !q.cyber || !q.alive) continue;
    const o = historicCyber(g, q, viewTick);
    if (!o) continue;
    const f = rayAabb(start, delta, vsub(o, v3(r, r, r)), vadd(o, v3(r, r, r)));
    if (f >= 0 && f < res.frac) {
      res.frac = f;
      res.player = q;
      res.mine = null;
    }
  }
  for (const pr of g.projectiles) {
    if (pr.kind !== ProjKind.IceMine) continue;
    const f = rayAabb(start, delta, vsub(pr.origin, v3(20, 20, 20)), vadd(pr.origin, v3(20, 20, 20)));
    if (f >= 0 && f < res.frac) {
      res.frac = f;
      res.mine = pr;
      res.player = null;
    }
  }
  return res;
}

function destroyProjectile(g: Game, pr: Projectile): void {
  g.projectiles = g.projectiles.filter((x) => x !== pr);
  g.emit({ k: EvKind.Explosion, kind: 5, pos: pr.origin, radius: 64 });
}

// ---------------------------------------------------------------------------
// Programs & node hacking

interface ProgramCtx {
  node: NodeEnt | null;
  ice: IceEnt | null;
}

/** What is the decker looking at / standing next to? */
function programContext(g: Game, p: ServerPlayer, eye: Vec3, fwd: Vec3): ProgramCtx {
  let node: NodeEnt | null = null;
  let bestN = Infinity;
  for (const n of g.nodes) {
    const to = vsub(n.origin, eye);
    const d = vlen(to);
    if (d < PROGRAM_RANGE && d < bestN && vdot(vnorm(to), fwd) > 0.2) {
      node = n;
      bestN = d;
    }
  }
  let ice: IceEnt | null = null;
  let bestI = Infinity;
  for (const i of g.ices) {
    if (!i.doorway) continue;
    const cx = Math.max(i.src.mins.x, Math.min(eye.x, i.src.maxs.x));
    const cy = Math.max(i.src.mins.y, Math.min(eye.y, i.src.maxs.y));
    const cz = Math.max(i.src.mins.z, Math.min(eye.z, i.src.maxs.z));
    const d = vdist(v3(cx, cy, cz), eye);
    if (d < PROGRAM_RANGE && d < bestI) {
      ice = i;
      bestI = d;
    }
  }
  void p;
  return { node, ice };
}

export function programApplicable(g: Game, p: ServerPlayer, prog: ProgramId, ctx: ProgramCtx): number {
  const def = PROGRAMS[prog]!;
  if (def.enhanced && !p.has(ImplantId.EnhancedDeck)) return 0;
  const team = p.team;
  const n = ctx.node;
  const i = ctx.ice;
  const stageOk = (x: NodeEnt) => x.enabled && (x.stage === 0 || g.rules.stage >= x.stage);
  switch (prog) {
    case ProgramId.PasswordProtect:
      return n && stageOk(n) && n.owner === team && n.protection === 0 ? n.id : 0;
    case ProgramId.Encryption:
      return n && stageOk(n) && n.owner === team && n.protection < 2 ? n.id : 0;
    case ProgramId.IceBarrier:
      return n && stageOk(n) && n.owner === team && n.doorway && n.doorway.pass === 3 ? n.id : 0;
    case ProgramId.PasswordCracker:
      return n && n.protection === 1 && n.protTeam !== team ? n.id : 0;
    case ProgramId.Decryptor:
      return n && n.protection === 2 && n.protTeam !== team ? n.id : 0;
    case ProgramId.IceAlarm:
      return i && i.active && i.pass === team && !(i.traps & (ICE_ALARM | ICE_GREEN)) ? i.id : 0;
    case ProgramId.IceMine:
      return i && i.active && i.pass === team && !(i.traps & (ICE_MINE | ICE_GREEN)) ? i.id : 0;
    case ProgramId.GreenIce:
      return i && i.active && i.pass === team && i.traps === 0 ? i.id : 0;
    case ProgramId.Wedge:
      return i && i.active && i.blocks(team, g.now) ? i.id : 0;
    case ProgramId.IceBreaker:
      return i && i.active && i.pass !== team ? i.id : 0;
    case ProgramId.IceScan:
      return i && i.active && i.pass !== team ? i.id : 0;
  }
  return 0;
}

function makeButtons(g: Game, p: ServerPlayer, prog: ProgramId, step: number): number[] {
  const def = PROGRAMS[prog]!;
  const label = def.steps[Math.min(step, def.steps.length - 1)]!;
  const correct = STEP_LABELS.indexOf(label);
  const rng = makeRng(g.tick * 31 + p.id * 7 + step);
  const out = new Set<number>([correct]);
  // Decoys: prefer this program's other steps, then anything.
  const pool = def.steps.map((s) => STEP_LABELS.indexOf(s)).filter((x) => x !== correct);
  while (out.size < 4) {
    const src = pool.length && rng() < 0.7 ? pool : STEP_LABELS.map((_, k) => k);
    out.add(src[Math.floor(rng() * src.length)]!);
  }
  const arr = [...out];
  for (let k = arr.length - 1; k > 0; k--) {
    const j = Math.floor(rng() * (k + 1));
    [arr[k], arr[j]] = [arr[j]!, arr[k]!];
  }
  return arr;
}

function programsCmd(g: Game, p: ServerPlayer, cmd: UserCmd, pressed: number, dt: number, eye: Vec3, fwd: Vec3): void {
  const ctx = programContext(g, p, eye, fwd);
  const keyPressed = (pressed & Buttons.PROGRAM) !== 0 && cmd.weapon > 0;
  const run = p.program;

  if (run) {
    const def = PROGRAMS[run.program]!;
    // Target still valid and in reach?
    const tgt = g.ents.find((e) => e.id === run.target);
    const tpos = tgt instanceof NodeEnt ? tgt.origin : tgt instanceof IceEnt ? tgt.center : null;
    if (!tpos || vdist(tpos, eye) > PROGRAM_RANGE * 1.6) {
      failProgram(g, p, 'out of range');
      return;
    }
    // Minigame input (enhanced deck): pick the button matching the current step.
    if (keyPressed && p.has(ImplantId.EnhancedDeck)) {
      const choice = run.buttons[cmd.weapon - 1];
      const step = Math.floor(run.progress);
      const want = STEP_LABELS.indexOf(def.steps[Math.min(step, def.steps.length - 1)]!);
      if (choice === want) run.progress = Math.min(run.steps, run.progress + 0.5);
      else run.progress = Math.max(Math.floor(run.progress), run.progress - 0.25);
    }
    const before = Math.floor(run.progress);
    const cost = (PROGRAM_STEP_COST / PROGRAM_STEP_TIME) * dt;
    if (p.energy < cost) {
      failProgram(g, p, 'out of energy');
      return;
    }
    p.energy -= cost;
    run.energySpent += cost;
    run.progress += dt / PROGRAM_STEP_TIME;
    if (Math.floor(run.progress) !== before || keyPressed) run.buttons = makeButtons(g, p, run.program, Math.floor(run.progress));
    if (run.progress >= run.steps) {
      p.program = null;
      completeProgram(g, p, run.program, run.target);
    }
    return;
  }

  // Start a program: number keys pick from the context list.
  if (keyPressed && cmd.weapon <= PROGRAMS.length) {
    const prog = (cmd.weapon - 1) as ProgramId;
    const target = programApplicable(g, p, prog, ctx);
    if (!target) {
      g.sound(Snd.Denied, eye, p.id, { player: p.id });
      return;
    }
    const steps = PROGRAMS[prog]!.steps.length;
    p.program = { program: prog, target, progress: 0, steps, buttons: makeButtons(g, p, prog, 0), energySpent: 0 };
    g.emit({ k: EvKind.Program, player: p.id, program: prog, target, result: 0 }, { player: p.id });
    return;
  }

  // Node hacking: hold USE at an unprotected enemy node.
  const n = ctx.node;
  if (cmd.buttons & Buttons.USE && n) {
    const stageOk = n.enabled && (n.stage === 0 || g.rules.stage >= n.stage);
    const hackable = stageOk && n.owner !== p.team && n.protection === 0 && !(n.oneway && n.done) && g.rules.phase === 1;
    if (!hackable) {
      if (pressed & Buttons.USE) g.sound(Snd.Denied, eye, p.id, { player: p.id });
      return;
    }
    if (n.hacker !== p.id) {
      n.hacker = p.id;
      n.hackProgress = 0;
    }
    n.hackProgress = Math.min(1, n.hackProgress + dt / NODE_HACK_TIME);
    if (n.hackProgress >= 1) captureNode(g, n, p);
  } else {
    for (const node of g.nodes) {
      if (node.hacker === p.id) {
        node.hacker = 0;
        node.hackProgress = 0;
      }
    }
  }
}

const INVERSE: Record<string, string> = { open: 'close', close: 'open', enable: 'disable', disable: 'enable', on: 'off', off: 'on' };

function captureNode(g: Game, n: NodeEnt, p: ServerPlayer): void {
  const prevOwner = n.owner;
  n.owner = p.team;
  n.hacker = 0;
  n.hackProgress = 0;
  n.protection = 0;
  n.protTeam = 0;
  if (n.oneway) n.done = true;
  let action = n.src.props['action'] ?? 'toggle';
  // The original owner hacking it back reverses the effect.
  if (p.team === n.teamInit && prevOwner !== n.teamInit) action = INVERSE[action] ?? action;
  g.fireTargets(n.src.props['target'], action, p.team);
  const obj = n.src.props['objective'];
  if (obj) g.completeObjective(obj, p.team);
  p.score += 3;
  g.notice('node', `${p.name} hacked ${n.label}`, 0);
  g.sound(Snd.Capture, n.origin, p.id);
}

function failProgram(g: Game, p: ServerPlayer, _why: string): void {
  const run = p.program;
  if (!run) return;
  p.program = null;
  g.emit({ k: EvKind.Program, player: p.id, program: run.program, target: run.target, result: 2 }, { player: p.id });
  g.sound(Snd.ProgramFail, p.cyber?.origin ?? p.move.origin, p.id, { player: p.id });
}

function completeProgram(g: Game, p: ServerPlayer, prog: ProgramId, targetId: number): void {
  const tgt = g.ents.find((e) => e.id === targetId);
  const team = p.team;
  const done = () => {
    g.emit({ k: EvKind.Program, player: p.id, program: prog, target: targetId, result: 1 }, { player: p.id });
    g.sound(Snd.ProgramDone, p.cyber?.origin ?? p.move.origin, p.id);
    p.score += 1;
  };
  if (tgt instanceof NodeEnt) {
    const n = tgt;
    switch (prog) {
      case ProgramId.PasswordProtect:
        if (n.owner === team && n.protection === 0) {
          n.protection = 1;
          n.protTeam = team;
        }
        break;
      case ProgramId.Encryption:
        if (n.owner === team) {
          n.protection = 2;
          n.protTeam = team;
        }
        break;
      case ProgramId.IceBarrier:
        if (n.doorway && n.doorway.pass === 3) {
          n.doorway.pass = team;
          n.doorway.traps = 0;
        }
        break;
      case ProgramId.PasswordCracker:
        if (n.protection === 1 && n.protTeam !== team) n.protection = 0;
        break;
      case ProgramId.Decryptor:
        if (n.protection === 2 && n.protTeam !== team) n.protection = 0;
        break;
    }
    return done();
  }
  if (!(tgt instanceof IceEnt)) return;
  const ice = tgt;
  const alarm = () => {
    if (ice.traps & ICE_ALARM && ice.trapTeam !== team) g.emit({ k: EvKind.Alarm, kind: 2, ref: ice.id, pos: ice.center }, { team: ice.trapTeam });
  };
  switch (prog) {
    case ProgramId.IceAlarm:
      ice.traps |= ICE_ALARM;
      ice.trapTeam = team;
      break;
    case ProgramId.IceMine:
      ice.traps |= ICE_MINE;
      ice.trapTeam = team;
      break;
    case ProgramId.GreenIce:
      ice.traps = ICE_GREEN;
      ice.trapTeam = team;
      break;
    case ProgramId.Wedge:
      ice.wedgedUntil = g.now + WEDGE_SECONDS;
      alarm();
      if (ice.traps & ICE_MINE && ice.trapTeam !== team) {
        const owner = [...g.players.values()].find((q) => q.team === ice.trapTeam) ?? p;
        const mine = new Projectile(g, ProjKind.IceMine, owner, ice.center, v3(), 10);
        mine.targetId = p.id;
        g.projectiles.push(mine);
        ice.traps &= ~ICE_MINE;
      }
      g.sound(Snd.Bounce, ice.center, p.id);
      break;
    case ProgramId.IceBreaker: {
      alarm();
      const green = ice.traps & ICE_GREEN && ice.trapTeam !== team;
      ice.pass = 3;
      ice.traps = 0;
      if (green) triggerGreen(g, ice, p);
      break;
    }
    case ProgramId.IceScan:
      ice.scannedBy |= 1 << team;
      if (ice.traps & ICE_GREEN && ice.trapTeam !== team) ice.traps &= ~ICE_GREEN;
      break;
  }
  done();
}

function triggerGreen(g: Game, ice: IceEnt, p: ServerPlayer): void {
  if (!p.cyber) return;
  p.cyber.stun = GREEN_ICE_STUN;
  p.cyber.velocity = v3();
  p.greenEjectAt = g.now + GREEN_ICE_STUN;
  ice.traps &= ~ICE_GREEN;
  g.emit({ k: EvKind.Explosion, kind: 6, pos: p.cyber.origin, radius: 96 });
  if (ice.trapTeam) g.emit({ k: EvKind.Alarm, kind: 2, ref: ice.id, pos: ice.center }, { team: ice.trapTeam });
}

// ---------------------------------------------------------------------------
// Cyber projectiles and crystals (called every tick)

export function thinkCrystals(g: Game): void {
  const dt = g.dt;
  // Crystals decay.
  for (const c of g.crystals) {
    if (g.now - c.born > CYBER.crystalDecay) c.value = 0;
  }
  g.crystals = g.crystals.filter((c) => c.value > 0);

  const keep: Projectile[] = [];
  for (const pr of g.projectiles) {
    if (pr.kind === ProjKind.CyberOrb) {
      const end = vma(pr.origin, dt, pr.velocity);
      const tr = g.level.collision.trace(pr.origin, end, v3(-4, -4, -4), v3(4, 4, 4), MASK_PLAYERSOLID, g.cyberShotFilter);
      let hitFrac = tr.fraction;
      let direct: ServerPlayer | null = null;
      const delta = vsub(end, pr.origin);
      for (const q of g.players.values()) {
        if (q === pr.owner || !q.cyber) continue;
        const r = AVATAR_HIT + 4;
        const f = rayAabb(pr.origin, delta, vsub(q.cyber.origin, v3(r, r, r)), vadd(q.cyber.origin, v3(r, r, r)));
        if (f >= 0 && f < hitFrac) {
          hitFrac = f;
          direct = q;
        }
      }
      if (hitFrac < 1 || g.now >= pr.fuseAt) {
        const pos = vma(pr.origin, hitFrac, delta);
        orbExplode(g, pr, pos, direct);
        continue;
      }
      pr.origin = end;
      keep.push(pr);
    } else if (pr.kind === ProjKind.IceMine) {
      const target = g.players.get(pr.targetId);
      if (!target || !target.cyber || g.now >= pr.fuseAt) {
        g.emit({ k: EvKind.Explosion, kind: 5, pos: pr.origin, radius: 64 });
        continue;
      }
      const to = vsub(target.cyber.origin, pr.origin);
      const d = vlen(to);
      if (d < 28) {
        cyberDamage(g, target, ICE_MINE_DAMAGE, pr.owner.team !== target.team ? pr.owner : null);
        g.emit({ k: EvKind.Explosion, kind: 5, pos: pr.origin, radius: 96 });
        continue;
      }
      pr.velocity = vscale(vnorm(to), 520);
      pr.origin = vma(pr.origin, dt, pr.velocity);
      keep.push(pr);
    } else keep.push(pr);
  }
  g.projectiles = keep;
}

function orbExplode(g: Game, pr: Projectile, pos: Vec3, direct: ServerPlayer | null): void {
  g.emit({ k: EvKind.Explosion, kind: 5, pos, radius: CYBER.projRadius });
  if (direct) cyberDamage(g, direct, CYBER.projDamage, pr.owner);
  const filter = noIceFilter(g);
  for (const q of g.players.values()) {
    if (!q.cyber) continue;
    const d = vdist(q.cyber.origin, pos);
    if (d > CYBER.projRadius) continue;
    // Splash passes through ICE but not solid geometry.
    const tr = g.level.collision.trace(pos, q.cyber.origin, ZERO, ZERO, CONTENTS_SOLID, filter);
    if (tr.fraction < 1 && vdist(tr.endpos, q.cyber.origin) > 20) continue;
    const f = 1 - d / CYBER.projRadius;
    // Knockback for everyone (projectile-jumping), damage only to others.
    const dir = d > 1 ? vnorm(vsub(q.cyber.origin, pos)) : q.cyber.up;
    q.cyber.velocity = vadd(q.cyber.velocity, vscale(dir, CYBER.projKnockback * (0.4 + 0.6 * f)));
    q.cyber.onGround = false;
    if (q !== pr.owner && q !== direct) cyberDamage(g, q, CYBER.projSplash * f, pr.owner);
  }
  // Orbs can also pop ICE mines (they burst on their next think).
  for (const m of g.projectiles) if (m.kind === ProjKind.IceMine && vdist(m.origin, pos) < CYBER.projRadius * 0.5) m.fuseAt = 0;
}

