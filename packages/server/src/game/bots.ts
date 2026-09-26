// Bot AI. Roles:
//   decker  - Light with an Enhanced Cyberdeck: jacks in, runs programs, hacks
//             (attackers) or guards and locks down nodes (defenders).
//   assault - pushes the current objective, fights, throws grenades, guards
//             friendly decker bodies, EMPs enemy decker bodies.
// Bots generate ordinary UserCmds, so they obey exactly the same rules as players.

import {
  type UserCmd,
  type Vec3,
  v3,
  vadd,
  vsub,
  vlen,
  vlen2d,
  vdist,
  vnorm,
  vdot,
  vectorAngles,
  angleNormalize,
  cyberAnglesFor,
  cyberBasis,
  cyberEye,
  vscale,
  Buttons,
  ClassId,
  Team,
  otherTeam,
  CONTENTS_SOLID,
  WeaponId,
  WEAPONS,
  ProgramId,
  PROGRAMS,
  STEP_LABELS,
  ImplantId,
  makeRng,
  DEFAULT_MOVE,
} from '@d2/shared';
import type { Game } from './game.js';
import type { ServerPlayer } from './player.js';
import { NavGraph, CyberGraph } from './nav.js';
import { DoorEnt, ForceFieldEnt, type NodeEnt, type JipEnt, ScreenEnt, type BreakableEnt } from './entities.js';
import { programApplicable } from './cyber.js';

export const BOT_NAMES = [
  'Wraith', 'Chrome', 'Neon', 'Glitch', 'Vector', 'Static', 'Cipher', 'Rook', 'Hex', 'Onyx', 'Razor', 'Echo',
  'Flux', 'Nova', 'Shade', 'Pulse', 'Drift', 'Volt', 'Jinx', 'Kilo', 'Mako', 'Zero', 'Sable', 'Tank',
];

interface NavCache {
  nav: NavGraph;
  cyber: CyberGraph;
}
const navCache = new WeakMap<Game, NavCache>();

function navFor(g: Game): NavCache {
  let c = navCache.get(g);
  if (!c) {
    const gates = new Set<number>([...g.doors.map((d) => d.id), ...g.forcefields.map((f) => f.id)]);
    c = { nav: new NavGraph(g.level, gates), cyber: new CyberGraph(g.level) };
    navCache.set(g, c);
  }
  return c;
}

type Role = 'decker' | 'assault';

export class BotBrain {
  role: Role = 'assault';
  private seq = 0;
  private yaw = 0;
  private pitch = 0;
  private path: Vec3[] = [];
  private pathGoal: Vec3 | null = null;
  private repathAt = 0;
  private target = 0;
  private targetSeenAt = 0;
  private reactAt = 0;
  private strafe = 1;
  private strafeAt = 0;
  private lastPos = v3();
  private stuckSince = 0;
  private jumpUntil = 0;
  private cyberPath: Vec3[] = [];
  private cyberGoal: Vec3 | null = null;
  private cyberRepathAt = 0;
  private programPressAt = 0;
  private nextTac = 0;
  private nextGrenade = 0;
  private jackAttemptAt = 0;
  private aimErr = { yaw: 0, pitch: 0 };
  private readonly rng: () => number;
  private readonly skill: number;
  private wasDecked = false;
  private crackGoal: Vec3 | null = null;
  /** Debug: last chosen goal. */
  debug = '';

  constructor(readonly id: number) {
    this.rng = makeRng(id * 7919 + 17);
    this.skill = 0.55 + this.rng() * 0.35;
  }

  pickClass(g: Game, team: number): ClassId {
    const mates = [...g.players.values()].filter((p) => p.bot && p.team === team);
    const brains = mates.length;
    // First bot of a team is its decker.
    if (brains === 0) {
      this.role = 'decker';
      return ClassId.Light;
    }
    this.role = 'assault';
    const cycle = [ClassId.Heavy, ClassId.Medium, ClassId.Medium, ClassId.Heavy, ClassId.Light, ClassId.Medium];
    return cycle[(brains - 1) % cycle.length]!;
  }

  applyLoadout(_p: ServerPlayer): void {
    /* loadout already set from DEFAULT_LOADOUTS by the room */
  }

  private cmd(buttons: number, forward: number, side: number, weapon = 0): UserCmd {
    return {
      seq: ++this.seq,
      msec: 1000 / 60,
      forward,
      side,
      buttons,
      pitch: this.pitch,
      yaw: this.yaw,
      weapon,
      viewTick: 0,
    };
  }

  think(g: Game, p: ServerPlayer): UserCmd {
    if (!p.alive) {
      this.path = [];
      this.target = 0;
      this.wasDecked = false;
      return this.cmd(0, 0, 0);
    }
    if (p.decked) {
      if (!this.wasDecked) {
        this.yaw = 0;
        this.pitch = 0;
        this.cyberPath = [];
        this.cyberGoal = null;
      }
      this.wasDecked = true;
      const c = this.cyberThink(g, p);
      c.viewTick = g.tick;
      return c;
    }
    if (this.wasDecked) {
      this.wasDecked = false;
      this.yaw = p.yaw;
      this.pitch = 0;
      this.path = [];
    }
    const c = this.meatThink(g, p);
    c.viewTick = g.tick;
    return c;
  }

  // ---------------------------------------------------------------------------
  // Meatspace

  private blocked(g: Game, team: number): (gate: number) => boolean {
    return (gate: number) => {
      const e = g.modelOwner.get(gate);
      if (e instanceof DoorEnt) {
        if (e.pos > 0.8 || e.permanent) return false;
        if (e.team !== 0) return e.team !== team;
        return e.locked || e.lockedInit;
      }
      if (e instanceof ForceFieldEnt) return e.on && e.team !== team;
      return false;
    };
  }

  /** Where should this bot be going right now (meatspace)? */
  private meatGoal(g: Game, p: ServerPlayer): { pos: Vec3; use?: ScreenEnt; shoot?: BreakableEnt; jip?: JipEnt } | null {
    const r = g.rules;
    const attacking = p.team === r.attackers;
    // Deckers head for a JIP when there is cyber work to do. Deck-carrying
    // assault bots fill in when no team-mate is currently decked.
    const teamDecking = [...g.players.values()].some((q) => q !== p && q.team === p.team && q.decked);
    const deckerRole = this.role === 'decker' || (p.hasDeck && !teamDecking && this.id % 2 === 1);
    if (deckerRole && p.hasDeck && g.now >= this.jackAttemptAt) {
      const job = cyberJob(g, p);
      if (job) {
        const jip = this.bestJip(g, p);
        if (jip) return { pos: jip.origin, jip };
      }
    }
    // Guard a friendly decker's body at times.
    if (!attacking || this.id % 3 === 0) {
      const decker = [...g.players.values()].find((q) => q.team === p.team && q.decked && q !== p);
      if (decker && this.id % 2 === 0 && vdist(decker.move.origin, p.move.origin) < 1600) {
        return { pos: vadd(decker.move.origin, v3(((this.id % 3) - 1) * 90, ((this.id % 2) * 2 - 1) * 90, 0)) };
      }
    }
    const stage = r.stage;
    if (attacking) {
      // Screens of the current stage.
      const scr = g.screens.find((s) => !s.used && s.enabled && (!s.stage || s.stage === stage) && (s.team === 0 || s.team === p.team));
      if (scr) return { pos: scr.origin, use: scr };
      // Breakable objectives (the core) once reachable.
      const brk = g.breakables.find((b) => !b.destroyed && b.src.props['objective'] && g.objectives.find((o) => o.name === b.src.props['objective'])?.stage === stage);
      if (brk) {
        const c = v3((brk.src.mins.x + brk.src.maxs.x) / 2, (brk.src.mins.y + brk.src.maxs.y) / 2, brk.src.mins.z);
        const shielded = g.forcefields.some(
          (f) => f.on && f.team !== p.team && c.x >= f.src.mins.x && c.x <= f.src.maxs.x && c.y >= f.src.mins.y && c.y <= f.src.maxs.y,
        );
        if (!shielded) return { pos: c, shoot: brk };
        // Security still up: protect our deckers at their jack-in points instead of feeding turrets.
        const jip = g.jips.filter((j) => j.usableBy(p.team)).sort((a, b) => vdist(a.origin, p.move.origin) - vdist(b.origin, p.move.origin))[0];
        if (jip) return { pos: vadd(jip.origin, v3(((this.id % 3) - 1) * 100, ((this.id % 2) * 2 - 1) * 100, 0)) };
      }
      // Cyber-only objective: push towards the current objective marker.
      const obj = g.objectives.find((o) => o.stage === stage && !o.done && !o.optional) ?? g.objectives.find((o) => o.stage === stage && !o.done);
      if (obj) return { pos: v3(obj.src.origin.x, obj.src.origin.y, 0) };
    } else {
      const obj = g.objectives.find((o) => o.stage === stage && !o.done && !o.optional);
      if (obj) {
        // Defenders spread around the objective.
        const a = (this.id * 2.4) % (Math.PI * 2);
        return { pos: v3(obj.src.origin.x + Math.cos(a) * 260, obj.src.origin.y + Math.sin(a) * 260, 0) };
      }
    }
    return null;
  }

  private bestJip(g: Game, p: ServerPlayer): JipEnt | null {
    let best: JipEnt | null = null;
    let bd = Infinity;
    for (const j of g.jips) {
      if (!j.usableBy(p.team) || j.occupant || g.now < j.lockUntil) continue;
      if (!g.cyberSpawn(j.cyberSpawnFor(p.team))) continue;
      const d = vdist(j.origin, p.move.origin);
      if (d < bd) {
        bd = d;
        best = j;
      }
    }
    return best;
  }

  private meatThink(g: Game, p: ServerPlayer): UserCmd {
    const { nav } = navFor(g);
    const now = g.now;
    let buttons = 0;
    let weapon = 0;
    const eye = p.eyePos();

    // ---- perception
    const enemy = this.pickEnemy(g, p, eye);
    if (enemy) {
      if (this.target !== enemy.id) {
        this.target = enemy.id;
        this.reactAt = now + (0.45 - this.skill * 0.25) + this.rng() * 0.15;
        this.aimErr = { yaw: (this.rng() - 0.5) * 14, pitch: (this.rng() - 0.5) * 8 };
      }
      this.targetSeenAt = now;
    } else if (now - this.targetSeenAt > 1.5) this.target = 0;

    // ---- goal & path
    const goal = this.meatGoal(g, p);
    this.debug = goal ? `${goal.jip ? 'jip' : goal.use ? 'use' : goal.shoot ? 'shoot' : 'go'}(${goal.pos.x.toFixed(0)},${goal.pos.y.toFixed(0)},${goal.pos.z.toFixed(0)}) path=${this.path.length}` : 'none';
    if (goal && (now >= this.repathAt || !this.pathGoal || vdist(this.pathGoal, goal.pos) > 96)) {
      this.repathAt = now + 1.2 + this.rng() * 0.6;
      this.pathGoal = goal.pos;
      const from = nav.nearest(p.move.origin);
      const to = nav.nearest(goal.pos, 400);
      this.path = nav.path(from, to, this.blocked(g, p.team)) ?? [];
      this.crackGoal = null;
      if (!this.path.length && vdist(goal.pos, p.move.origin) > 200 && p.team === g.rules.attackers) {
        // No route (a locked door): crack it from meatspace, or guard whoever does.
        const crack = g.cracks.find((c) => !c.done && (!c.stage || c.stage === g.rules.stage) && (!c.team || c.team === p.team));
        if (crack) {
          const c = crack.src;
          const spot = v3((c.mins.x + c.maxs.x) / 2 + ((this.id % 3) - 1) * 40, (c.mins.y + c.maxs.y) / 2 + ((this.id % 5) - 2) * 40, c.mins.z);
          this.crackGoal = spot;
          this.path = nav.path(from, nav.nearest(spot, 300), this.blocked(g, p.team)) ?? [];
        }
      }
    }
    while (this.path.length && vlen2d(vsub(this.path[0]!, p.move.origin)) < 28 && Math.abs(this.path[0]!.z - p.move.origin.z) < 60) this.path.shift();

    let moveDir: Vec3 | null = null;
    const next = this.path[0] ?? (goal && vdist(goal.pos, p.move.origin) > 60 && vdist(goal.pos, p.move.origin) < 300 ? goal.pos : null);
    // Standing in a crack trigger: hold USE (deck owners crack, the rest guard).
    if (this.crackGoal && !this.path.length && p.hasDeck && g.cracks.some((c) => !c.done && c.contains(p.move.origin, v3(-16, -16, 0), v3(16, 16, 72)))) {
      buttons |= Buttons.USE;
    }
    if (next) moveDir = vnorm(v3(next.x - p.move.origin.x, next.y - p.move.origin.y, 0));

    // ---- aim
    let wantYaw = this.yaw;
    let wantPitch = 0;
    let aimed = false;
    const tgt = this.target ? g.players.get(this.target) : undefined;
    if (tgt && tgt.alive) {
      const h = tgt.move.ducked ? 26 : 46;
      const aimAt = vadd(tgt.move.origin, v3(tgt.move.velocity.x * 0.05, tgt.move.velocity.y * 0.05, h));
      const a = vectorAngles(vsub(aimAt, eye));
      // Error shrinks while tracking.
      this.aimErr.yaw *= 0.93;
      this.aimErr.pitch *= 0.93;
      wantYaw = a.yaw + this.aimErr.yaw;
      wantPitch = a.pitch + this.aimErr.pitch;
      const err = Math.abs(angleNormalize(wantYaw - this.yaw)) + Math.abs(wantPitch - this.pitch);
      aimed = err < 6 + (1 - this.skill) * 6;
    } else if (goal?.shoot && vdist(goal.pos, p.move.origin) < 900) {
      const b = goal.shoot;
      const c = v3((b.src.mins.x + b.src.maxs.x) / 2, (b.src.mins.y + b.src.maxs.y) / 2, (b.src.mins.z + b.src.maxs.z) / 2);
      const tr = g.level.collision.trace(eye, c, v3(), v3(), CONTENTS_SOLID, g.shotFilter(p.team));
      if (tr.fraction > 0.97 || (tr.model >= 0 && tr.model === b.id)) {
        const a = vectorAngles(vsub(c, eye));
        wantYaw = a.yaw;
        wantPitch = a.pitch;
        aimed = Math.abs(angleNormalize(wantYaw - this.yaw)) < 5;
        moveDir = vdist(goal.pos, p.move.origin) > 450 ? moveDir : null;
      }
    } else if (goal?.use && vdist(goal.use.origin, eye) < 130) {
      const a = vectorAngles(vsub(goal.use.origin, eye));
      wantYaw = a.yaw;
      wantPitch = a.pitch;
      moveDir = null;
      if (Math.abs(angleNormalize(wantYaw - this.yaw)) < 20) buttons |= Buttons.USE;
    } else if (goal?.jip && vdist2(goal.jip.origin, p.move.origin) < 60) {
      moveDir = null;
      buttons |= Buttons.DECK;
      this.jackAttemptAt = now + 3; // if denied, try again later
    } else if (moveDir) {
      wantYaw = vectorAngles(moveDir).yaw;
      wantPitch = 0;
    }
    const turn = (360 + this.skill * 360) / 60;
    this.yaw = angleNormalize(this.yaw + clampAbs(angleNormalize(wantYaw - this.yaw), turn));
    this.pitch = Math.max(-89, Math.min(89, this.pitch + clampAbs(wantPitch - this.pitch, turn)));

    // ---- fire
    const cur = p.weap.current;
    if (tgt && tgt.alive && now >= this.reactAt) {
      const dist = vdist(tgt.move.origin, p.move.origin);
      // Minigun keeps spinning while a target is around.
      if (cur === WeaponId.Minigun) buttons |= Buttons.ATTACK2;
      if (aimed && !this.friendInLine(g, p, eye, vadd(tgt.move.origin, v3(0, 0, 40)))) buttons |= Buttons.ATTACK;
      // Grenades: EMP enemy decker bodies, frag groups.
      if (now >= this.nextGrenade && p.weap.owned.some((w) => WEAPONS[w]!.kind === 'grenade' && (p.weap.clip[w] ?? 0) > 0)) {
        const gren = p.weap.owned.find((w) => WEAPONS[w]!.kind === 'grenade')!;
        const good = gren === WeaponId.EmpGrenade ? tgt.decked || (tgt.stealthOn && dist < 700) : dist > 250 && dist < 800 && this.rng() < 0.3;
        if (good && dist < 850) {
          this.nextGrenade = now + 6 + this.rng() * 6;
          weapon = 4;
        } else this.nextGrenade = now + 2;
      }
    } else if (goal?.shoot && aimed) buttons |= Buttons.ATTACK;
    if (cur === WeaponId.EmpGrenade || cur === WeaponId.FragGrenade) {
      // Cook briefly, then release.
      if (p.weap.cookStart === 0) buttons |= Buttons.ATTACK;
      else if (g.now - p.weap.cookStart < 0.4 && p.t - p.weap.cookStart < 0.4) buttons |= Buttons.ATTACK;
      else buttons &= ~Buttons.ATTACK;
    } else if (weapon === 0 && cur !== p.weap.owned[0] && WEAPONS[cur]?.kind !== 'grenade') {
      // Back to the primary when it has ammo.
      const prim = p.weap.owned[0]!;
      if ((p.weap.clip[prim] ?? 0) + (p.weap.reserve[prim] ?? 0) > 0) weapon = 1;
    }
    // Out of primary ammo: sidearm.
    const prim = p.weap.owned[0]!;
    if (cur === prim && (p.weap.clip[prim] ?? 0) === 0 && (p.weap.reserve[prim] ?? 0) === 0) weapon = 2;

    // ---- implants
    if (p.has(ImplantId.TacScan) && now >= this.nextTac && p.energy > 30) {
      buttons |= Buttons.TAC;
      this.nextTac = now + 12 + this.rng() * 10;
    }
    if (p.has(ImplantId.Mediplant) && p.energy > 15) buttons |= Buttons.MEDI;
    if (p.has(ImplantId.LegBoosters) && moveDir && !tgt && p.energy > 25) buttons |= Buttons.SPRINT;

    // ---- movement
    let fwd = 0;
    let side = 0;
    if (moveDir) {
      const d = ((vectorAngles(moveDir).yaw - this.yaw) * Math.PI) / 180;
      fwd = Math.cos(d);
      side = -Math.sin(d);
    }
    if (tgt && tgt.alive) {
      if (now >= this.strafeAt) {
        this.strafe = this.rng() < 0.5 ? -1 : 1;
        this.strafeAt = now + 0.4 + this.rng() * 0.8;
      }
      side = Math.max(-1, Math.min(1, side + this.strafe * 0.8));
      if (!moveDir && vdist(tgt.move.origin, p.move.origin) > 900) fwd = 0.6;
    }
    // Stuck detection: jump, then repath.
    const moved = vdist(p.move.origin, this.lastPos);
    this.lastPos = { ...p.move.origin };
    if ((fwd !== 0 || side !== 0) && moved < 0.5) {
      if (!this.stuckSince) this.stuckSince = now;
      if (now - this.stuckSince > 0.6) this.jumpUntil = now + 0.1;
      if (now - this.stuckSince > 2.5) {
        this.repathAt = 0;
        this.stuckSince = 0;
        this.strafe = -this.strafe;
        side = this.strafe;
      }
    } else this.stuckSince = 0;
    if (now < this.jumpUntil) buttons |= Buttons.JUMP;
    return this.cmd(buttons, fwd, side, weapon);
  }

  /** Is a team-mate standing in the line of fire (friendly fire is usually on)? */
  private friendInLine(g: Game, p: ServerPlayer, from: Vec3, to: Vec3): boolean {
    const d = vsub(to, from);
    const len = vlen(d);
    if (len < 1) return false;
    const dir = vscale(d, 1 / len);
    for (const q of g.players.values()) {
      if (q === p || !q.alive || q.team !== p.team) continue;
      const c = vadd(q.move.origin, v3(0, 0, 36));
      const t = vdot(vsub(c, from), dir);
      if (t < 0 || t > len) continue;
      const closest = vadd(from, vscale(dir, t));
      if (vdist(closest, c) < 40) return true;
    }
    return false;
  }

  private pickEnemy(g: Game, p: ServerPlayer, eye: Vec3): ServerPlayer | null {
    let best: ServerPlayer | null = null;
    let bestScore = Infinity;
    if ((g.tick + this.id) % 6 !== 0 && this.target) {
      const cur = g.players.get(this.target);
      if (cur && cur.alive) return this.visible(g, p, eye, cur) ? cur : null;
    }
    for (const q of g.players.values()) {
      if (!q.alive || q.team === p.team || q.team === Team.Spectator) continue;
      const d = vdist(q.move.origin, p.move.origin);
      if (d > 3000) continue;
      if (!this.visible(g, p, eye, q)) continue;
      // Sitting-duck deckers are juicy.
      const score = d * (q.decked ? 0.4 : 1);
      if (score < bestScore) {
        bestScore = score;
        best = q;
      }
    }
    return best;
  }

  private visible(g: Game, p: ServerPlayer, eye: Vec3, q: ServerPlayer): boolean {
    const d = vdist(q.move.origin, p.move.origin);
    const revealed = g.now < (q.revealedUntil[p.team] ?? 0);
    if (q.stealthOn && q.vis < 0.3 && !revealed && !(p.thermalOn && d < 1500) && d > 220) return false;
    const to = vsub(vadd(q.move.origin, v3(0, 0, 40)), eye);
    const fwd = v3(Math.cos((this.yaw * Math.PI) / 180), Math.sin((this.yaw * Math.PI) / 180), 0);
    if (d > 300 && vdot(vnorm(v3(to.x, to.y, 0)), fwd) < -0.2 && !revealed) return false;
    const tr = g.level.collision.trace(eye, vadd(q.move.origin, v3(0, 0, 40)), v3(), v3(), CONTENTS_SOLID, g.shotFilter(p.team));
    return tr.fraction === 1;
  }

  // ---------------------------------------------------------------------------
  // Cyberspace

  private cyberThink(g: Game, p: ServerPlayer): UserCmd {
    const c = p.cyber!;
    const { cyber } = navFor(g);
    const now = g.now;
    let buttons = 0;
    let weapon = 0;
    let fwd = 0;
    let side = 0;
    const eye = cyberEye(c);
    const job = cyberJob(g, p);
    this.debug = job ? `cyber ${job.node.name} prog=${job.program} hack=${job.hack} path=${this.cyberPath.length}` : 'cyber none';

    // Bail out when low on energy (cyber HP) or nothing to do.
    if (p.energy < 8 || (!job && now - p.spawnTime > 2 && this.rng() < 0.005)) {
      return this.cmd(Buttons.DECK, 0, 0);
    }

    // Enemy deckers nearby?
    let enemy: ServerPlayer | null = null;
    let ed = Infinity;
    for (const q of g.players.values()) {
      if (!q.cyber || q.team === p.team) continue;
      const d = vdist(q.cyber.origin, c.origin);
      if (d > 1500 || d >= ed) continue;
      const tr = g.level.collision.trace(eye, q.cyber.origin, v3(), v3(), CONTENTS_SOLID, g.cyberShotFilter);
      if (tr.fraction < 1) continue;
      enemy = q;
      ed = d;
    }

    // Path to the job's node screen.
    const goal = job ? job.pos : null;
    if (goal && (now >= this.cyberRepathAt || !this.cyberGoal || vdist(this.cyberGoal, goal) > 32)) {
      this.cyberRepathAt = now + 2;
      this.cyberGoal = goal;
      const from = cyber.nearest(c.origin);
      this.cyberPath = from ? [from.pos, ...cyber.path(from, goal)] : [];
      // Skip waypoints we are already past.
      while (this.cyberPath.length > 1 && vdist(this.cyberPath[1]!, c.origin) < vdist(this.cyberPath[0]!, this.cyberPath[1]!)) this.cyberPath.shift();
    }
    // Advance along the path; also pop waypoints we have flown past.
    while (this.cyberPath.length) {
      const wp = this.cyberPath[0]!;
      const to = vsub(wp, c.origin);
      const d = vlen(to);
      if (d < 44 || (d < 140 && vdot(to, c.velocity) < 0 && vlen(c.velocity) > 150)) this.cyberPath.shift();
      else break;
    }

    let lookDir: Vec3 | null = null;
    let steerTo: Vec3 | null = null;
    const atNode = job && vdist(job.pos, eye) < 110;
    if (atNode && job) {
      lookDir = vsub(job.pos, eye);
      steerTo = job.pos;
      // Hack / program.
      const run = p.program;
      if (run) {
        // Enhanced deck minigame: press the right button now and then.
        if (p.has(ImplantId.EnhancedDeck) && now >= this.programPressAt) {
          this.programPressAt = now + 0.45 + this.rng() * 0.4;
          const def = PROGRAMS[run.program]!;
          const want = STEP_LABELS.indexOf(def.steps[Math.min(Math.floor(run.progress), def.steps.length - 1)]!);
          const idx = this.rng() < this.skill ? run.buttons.indexOf(want) : Math.floor(this.rng() * 4);
          if (idx >= 0) {
            buttons |= Buttons.PROGRAM;
            weapon = idx + 1;
          }
        }
      } else if (job.program !== null) {
        if (now >= this.programPressAt) {
          this.programPressAt = now + 0.5;
          buttons |= Buttons.PROGRAM;
          weapon = job.program + 1;
        }
      } else if (job.hack) buttons |= Buttons.USE;
    } else if (this.cyberPath.length) {
      steerTo = this.cyberPath[0]!;
      lookDir = vsub(steerTo, eye);
    } else if (goal) {
      steerTo = goal;
      lookDir = vsub(goal, eye);
    }

    // Velocity-aware steering (cyberspace has almost no friction).
    if (steerTo) {
      let to = vsub(steerTo, c.origin);
      // A waypoint far "above" us sits on a wall: charge into the wall to flip gravity.
      const above = c.zeroG ? 0 : vdot(to, c.up);
      if (!c.zeroG) to = vsub(to, vscale(c.up, vdot(to, c.up)));
      const dist = vlen(to);
      const vel = c.zeroG ? c.velocity : vsub(c.velocity, vscale(c.up, vdot(c.velocity, c.up)));
      const speed = above > 48 ? 480 : Math.min(480, dist * (atNode ? 2 : 4));
      const desired = dist > 0.5 ? vscale(vnorm(to), speed) : v3();
      const steer = vsub(desired, vel);
      if (vlen(steer) > 25) {
        const b = cyberBasis(c.up, c.north, this.pitch, this.yaw);
        const sd = vnorm(steer);
        fwd = c.zeroG ? vdot(sd, b.forward) : vdot(sd, b.flat);
        side = vdot(sd, b.right);
        if (c.zeroG) {
          const u = vdot(sd, c.up);
          if (u > 0.3) buttons |= Buttons.JUMP;
          else if (u < -0.3) buttons |= Buttons.DUCK;
        }
      }
      // Bounce along now and then when far away.
      if (!c.zeroG && dist > 300 && this.rng() < 0.04) buttons |= Buttons.JUMP;
    }

    if (enemy && enemy.cyber && !p.program) {
      const to = vsub(enemy.cyber.origin, eye);
      lookDir = to;
      const want = cyberAnglesFor(c.up, c.north, to);
      const err = Math.abs(angleNormalize(want.yaw - this.yaw)) + Math.abs(want.pitch - this.pitch);
      if (err < 8) buttons |= Buttons.ATTACK;
      if (ed < 500 && err < 15 && this.rng() < 0.3) buttons |= Buttons.ATTACK2;
      if (now >= this.strafeAt) {
        this.strafe = this.rng() < 0.5 ? -1 : 1;
        this.strafeAt = now + 0.5 + this.rng();
      }
      side = this.strafe;
      if (!c.zeroG && this.rng() < 0.1) buttons |= Buttons.JUMP;
    }
    if (p.cyberMode !== 0 && !(buttons & Buttons.RELOAD) && this.rng() < 0.05) buttons |= Buttons.RELOAD;

    if (lookDir && vlen(lookDir) > 1) {
      const want = cyberAnglesFor(c.up, c.north, lookDir);
      const turn = 540 / 60;
      this.yaw = angleNormalize(this.yaw + clampAbs(angleNormalize(want.yaw - this.yaw), turn * 2));
      this.pitch = Math.max(-89, Math.min(89, this.pitch + clampAbs(want.pitch - this.pitch, turn * 2)));
      // In gravity, walking uses the flattened direction; keep moving forward.
    }
    // Stuck in cyberspace: bounce and wiggle.
    const moved = vdist(c.origin, this.lastPos);
    this.lastPos = { ...c.origin };
    if (fwd && moved < 0.8) {
      if (!this.stuckSince) this.stuckSince = now;
      if (now - this.stuckSince > 0.5) buttons |= Buttons.JUMP;
      if (now - this.stuckSince > 1.5) side = this.strafe;
      if (now - this.stuckSince > 4) {
        this.cyberRepathAt = 0;
        this.stuckSince = 0;
        this.strafe = -this.strafe;
      }
    } else this.stuckSince = 0;
    return this.cmd(buttons, fwd, side, weapon);
  }
}

interface CyberJob {
  node: NodeEnt;
  /** Where to stand/look: the screen, or the doorway ICE for ICE programs. */
  pos: Vec3;
  /** Program to run first (index into PROGRAMS), or null. */
  program: ProgramId | null;
  hack: boolean;
}

/** What cyber work would help this bot's team right now? */
function cyberJob(g: Game, p: ServerPlayer): CyberJob | null {
  const r = g.rules;
  const stage = r.stage;
  const attacking = p.team === r.attackers;
  const enhanced = p.has(ImplantId.EnhancedDeck);
  const active = (n: NodeEnt) => n.enabled && (n.stage === 0 || stage >= n.stage) && !(n.oneway && n.done);
  const eye = p.cyber ? cyberEye(p.cyber) : p.move.origin;
  const ctx = (n: NodeEnt) => ({ node: n, ice: n.doorway });
  const score = (n: NodeEnt): number => {
    let s = 0;
    const obj = n.src.props['objective'];
    const o = obj ? g.objectives.find((x) => x.name === obj) : undefined;
    if (o && o.stage === stage && !o.done) s += 100;
    // Nodes that open a locked door on the way.
    const tg = n.src.props['target'] ?? '';
    for (const d of g.doors) if (tg.split(',').some((t) => t.split(':')[0] === d.name) && d.pos < 0.5 && d.lockedInit) s += 60;
    if (n.stage === stage) s += 20;
    return s;
  };
  const nodes = g.nodes.filter(active).sort((a, b) => score(b) - score(a) || vdist(a.origin, eye) - vdist(b.origin, eye));
  for (const n of nodes) {
    if (score(n) <= 0 && attacking) continue;
    if (attacking || n.owner !== p.team) {
      if (n.owner === p.team) continue;
      // Get through an enemy ICE barrier on the doorway first.
      if (n.doorway && n.doorway.blocks(p.team, g.now)) {
        if (n.doorway.traps && !(n.doorway.scannedBy & (1 << p.team)) && programApplicable(g, p, ProgramId.IceScan, ctx(n))) {
          return { node: n, pos: n.doorway.center, program: ProgramId.IceScan, hack: false };
        }
        const prog = enhanced ? ProgramId.IceBreaker : ProgramId.Wedge;
        if (programApplicable(g, p, prog, ctx(n))) return { node: n, pos: n.doorway.center, program: prog, hack: false };
      }
      // Then break the screen's protection.
      if (n.protection === 1 && n.protTeam !== p.team) return { node: n, pos: n.origin, program: ProgramId.PasswordCracker, hack: false };
      if (n.protection === 2 && n.protTeam !== p.team) return { node: n, pos: n.origin, program: ProgramId.Decryptor, hack: false };
      return { node: n, pos: n.origin, program: null, hack: true };
    }
    // Defenders: lock down their own relevant nodes.
    if (score(n) <= 0) continue;
    if (enhanced && n.protection < 2) return { node: n, pos: n.origin, program: ProgramId.Encryption, hack: false };
    if (n.protection === 0) return { node: n, pos: n.origin, program: ProgramId.PasswordProtect, hack: false };
    if (enhanced && n.doorway && n.doorway.pass === 3) return { node: n, pos: n.origin, program: ProgramId.IceBarrier, hack: false };
    if (enhanced && n.doorway && n.doorway.pass === p.team && n.doorway.traps === 0) {
      // Trap the barrier: needs to stand by the ICE, which is right at the doorway.
      return { node: n, pos: n.doorway.center, program: ProgramId.GreenIce, hack: false };
    }
    // Nothing left to do: guard it.
    return { node: n, pos: n.origin, program: null, hack: false };
  }
  void otherTeam;
  return null;
}

const vdist2 = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y) + Math.abs(a.z - b.z) * 0.5;
const clampAbs = (v: number, m: number) => Math.max(-m, Math.min(m, v));
void DEFAULT_MOVE;
