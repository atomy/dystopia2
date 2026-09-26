// Meatspace combat: lag-compensated hitscan, melee, grenades, explosions, turrets.

import {
  type Vec3,
  type UserCmd,
  type WeaponEvent,
  type NetEnt,
  v3,
  vadd,
  vsub,
  vscale,
  vma,
  vlen,
  vdist,
  vnorm,
  vdot,
  vcopy,
  angleVectors,
  vectorAngles,
  angleNormalize,
  rayAabb,
  spreadOffsets,
  DEFAULT_MOVE,
  CONTENTS_SOLID,
  EvKind,
  EntKind,
  ProjKind,
  Snd,
  Cause,
  WeaponId,
  WEAPONS,
  MEDIUM_KATANA_DAMAGE,
  ClassId,
  GRENADE_FUSE,
  FRAG_RADIUS,
  EMP_RADIUS,
  EMP_MIN_SECONDS,
  EMP_MAX_SECONDS,
  CLASSES,
  makeRng,
} from '@d2/shared';
import type { Game } from './game.js';
import type { ServerPlayer } from './player.js';
import { BreakableEnt, type TurretEnt } from './entities.js';
import { jackOut } from './cyber.js';

const ZERO = v3();

/** Hitboxes relative to feet origin: body + head, scaled per class. */
export function hitboxes(cls: ClassId, ducked: boolean): { body: { mins: Vec3; maxs: Vec3 }; head: { mins: Vec3; maxs: Vec3 } } {
  const s = CLASSES[cls]?.hitScale ?? 1;
  const h = ducked ? DEFAULT_MOVE.duckHeight : DEFAULT_MOVE.hullHeight;
  const w = 15 * s;
  const headH = 12 * s;
  const hw = 6 * s;
  return {
    body: { mins: v3(-w, -w, 0), maxs: v3(w, w, h - headH) },
    head: { mins: v3(-hw, -hw, h - headH), maxs: v3(hw, hw, h + 2) },
  };
}

interface RayHit {
  frac: number;
  player: ServerPlayer | null;
  headshot: boolean;
  turret: TurretEnt | null;
  breakable: BreakableEnt | null;
}

/** Trace a ray against world, lag-compensated players, turrets and breakables. */
function traceShot(g: Game, shooter: ServerPlayer, start: Vec3, end: Vec3, viewTick: number, skipDecked = false): RayHit {
  const delta = vsub(end, start);
  const tr = g.level.collision.trace(start, end, ZERO, ZERO, CONTENTS_SOLID, g.shotFilter(shooter.team));
  const hit: RayHit = { frac: tr.fraction, player: null, headshot: false, turret: null, breakable: null };
  if (tr.fraction < 1 && tr.model >= 0) {
    const e = g.modelOwner.get(tr.model);
    if (e instanceof BreakableEnt) hit.breakable = e;
  }
  for (const q of g.players.values()) {
    if (q === shooter || !q.alive) continue;
    if (skipDecked && q.decked) continue;
    const h = g.historicOrigin(q, viewTick);
    if (!h.alive) continue;
    const hb = hitboxes(q.cls, h.ducked);
    const o = h.origin;
    const fh = rayAabb(start, delta, vadd(o, hb.head.mins), vadd(o, hb.head.maxs));
    const fb = rayAabb(start, delta, vadd(o, hb.body.mins), vadd(o, hb.body.maxs));
    let f = -1;
    let head = false;
    if (fh >= 0 && (fb < 0 || fh <= fb)) {
      f = fh;
      head = true;
    } else if (fb >= 0) f = fb;
    if (f >= 0 && f < hit.frac) {
      hit.frac = f;
      hit.player = q;
      hit.headshot = head;
      hit.breakable = null;
      hit.turret = null;
    }
  }
  for (const t of g.turrets) {
    if (!t.alive || t.maxHealth === 0) continue;
    const f = rayAabb(start, delta, vsub(t.origin, v3(18, 18, 24)), vadd(t.origin, v3(18, 18, 18)));
    if (f >= 0 && f < hit.frac) {
      hit.frac = f;
      hit.turret = t;
      hit.player = null;
      hit.breakable = null;
    }
  }
  return hit;
}

export function damageTurret(g: Game, t: TurretEnt, amount: number, attacker: ServerPlayer | null): void {
  if (t.maxHealth === 0 || !t.alive) return;
  if (attacker && attacker.team === t.team) return;
  t.health -= amount;
  if (t.health <= 0) {
    t.health = 0;
    t.deadUntil = g.now + t.respawn;
    g.emit({ k: EvKind.Explosion, kind: 3, pos: t.origin, radius: 96 });
    if (attacker) attacker.score += 1;
  }
}

export function damageBreakable(g: Game, b: BreakableEnt, amount: number, attacker: ServerPlayer | null, explosive: boolean): void {
  if (b.destroyed || g.rules.phase !== 1) return;
  if (attacker && attacker.team === b.team) return;
  b.health -= explosive ? amount * 1.5 : amount;
  b.lastHit = g.now;
  if (b.health <= 0) {
    b.health = 0;
    b.model.solid = false;
    const c = vscale(vadd(b.src.mins, b.src.maxs), 0.5);
    g.emit({ k: EvKind.Explosion, kind: 4, pos: c, radius: 400 });
    g.fireTargets(b.src.props['target'], 'trigger', attacker?.team ?? 0);
    const obj = b.src.props['objective'];
    if (obj && attacker) g.completeObjective(obj, attacker.team);
    if (attacker) attacker.score += 5;
  }
}

export function fireHitscan(g: Game, p: ServerPlayer, cmd: UserCmd, e: Extract<WeaponEvent, { kind: 'fire' }>): void {
  const def = WEAPONS[e.weapon]!;
  const eye = p.eyePos();
  const offs = spreadOffsets(e.seed, e.pellets, e.spread);
  const ends: Vec3[] = [];
  const dmg = new Map<ServerPlayer, { amount: number; head: boolean }>();
  for (const o of offs) {
    const dir = angleVectors(cmd.pitch + o.pitch, cmd.yaw + o.yaw).forward;
    const end = vma(eye, def.range, dir);
    const hit = traceShot(g, p, eye, end, cmd.viewTick);
    const pt = vma(eye, def.range * hit.frac, dir);
    ends.push(pt);
    if (hit.player) {
      const cur = dmg.get(hit.player) ?? { amount: 0, head: false };
      cur.amount += e.damage * (hit.headshot ? def.headshotMult : 1);
      cur.head ||= hit.headshot && def.headshotMult > 1;
      dmg.set(hit.player, cur);
    } else if (hit.turret) damageTurret(g, hit.turret, e.damage, p);
    else if (hit.breakable) damageBreakable(g, hit.breakable, e.damage, p, false);
  }
  const fwd = angleVectors(cmd.pitch, cmd.yaw).forward;
  for (const [victim, d] of dmg) g.damage(victim, d.amount, p, e.weapon, { headshot: d.head, dir: fwd });
  g.emit({ k: EvKind.Fire, shooter: p.id, weapon: e.weapon, alt: e.alt, start: eye, ends }, { except: p.id });
}

export function doMelee(g: Game, p: ServerPlayer, cmd: UserCmd, e: Extract<WeaponEvent, { kind: 'melee' }>): void {
  const def = WEAPONS[e.weapon]!;
  const eye = p.eyePos();
  const fwd = angleVectors(cmd.pitch, cmd.yaw).forward;
  let best: ServerPlayer | null = null;
  let bestD = Infinity;
  for (const q of g.players.values()) {
    if (q === p || !q.alive) continue;
    const h = g.historicOrigin(q, cmd.viewTick);
    const center = vadd(h.origin, v3(0, 0, (h.ducked ? DEFAULT_MOVE.duckHeight : DEFAULT_MOVE.hullHeight) * 0.6));
    const to = vsub(center, eye);
    const d = vlen(to);
    if (d > def.range + 24) continue;
    if (vdot(vnorm(to), fwd) < 0.55) continue;
    const tr = g.level.collision.trace(eye, center, ZERO, ZERO, CONTENTS_SOLID, g.shotFilter(p.team));
    if (tr.fraction < 1) continue;
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  let result = 0;
  if (best) {
    let amount = def.damage;
    if (e.weapon === WeaponId.Katana && p.cls === ClassId.Medium) amount = MEDIUM_KATANA_DAMAGE;
    // Katana block: a blocking katana facing the attacker stops katana strikes.
    const blocked =
      e.weapon === WeaponId.Katana &&
      best.weap.blocking &&
      best.weap.current === WeaponId.Katana &&
      vdot(angleVectors(0, best.yaw).forward, vnorm(vsub(p.move.origin, best.move.origin))) > 0.3;
    if (blocked) {
      result = 2;
      g.sound(Snd.Block, best.eyePos(), best.id);
    } else {
      result = 1;
      g.damage(best, amount, p, e.weapon, { dir: fwd });
      if (e.weapon === WeaponId.Fist) best.move.velocity = vadd(best.move.velocity, vma(v3(0, 0, 180), 380, fwd));
    }
  } else {
    // Swing at breakables / turrets in front.
    const end = vma(eye, def.range, fwd);
    const hit = traceShot(g, p, eye, end, cmd.viewTick);
    if (hit.breakable) damageBreakable(g, hit.breakable, def.damage, p, false);
    else if (hit.turret) damageTurret(g, hit.turret, def.damage, p);
  }
  g.emit({ k: EvKind.Melee, attacker: p.id, weapon: e.weapon, dir: e.dir, result });
}

// ---------------------------------------------------------------------------
// Projectiles (grenades; cyber orbs & ICE mines live in cyber.ts but share this class)

export class Projectile {
  id: number;
  origin: Vec3;
  velocity: Vec3;
  fuseAt: number;
  bounces = 0;
  targetId = 0;
  constructor(
    g: Game,
    readonly kind: ProjKind,
    readonly owner: ServerPlayer,
    origin: Vec3,
    velocity: Vec3,
    fuse: number,
  ) {
    this.id = g.allocId();
    this.origin = vcopy(origin);
    this.velocity = vcopy(velocity);
    this.fuseAt = g.now + fuse;
  }
  net(): NetEnt {
    return {
      id: this.id,
      kind: EntKind.Projectile,
      team: this.owner.team,
      state: this.kind,
      value: 0,
      a: this.owner.id,
      b: this.targetId,
      origin: this.origin,
      velocity: this.velocity,
    };
  }
}

export function throwGrenade(g: Game, p: ServerPlayer, cmd: UserCmd, e: Extract<WeaponEvent, { kind: 'throw' }>): void {
  const eye = p.eyePos();
  const { forward } = angleVectors(cmd.pitch - 8, cmd.yaw);
  const vel = vadd(vadd(vscale(forward, 720), v3(0, 0, 120)), vscale(p.move.velocity, 0.6));
  const start = vma(eye, 16, forward);
  const kind = e.weapon === WeaponId.EmpGrenade ? ProjKind.Emp : ProjKind.Frag;
  g.projectiles.push(new Projectile(g, kind, p, start, vel, Math.max(0.05, GRENADE_FUSE - e.cook)));
  g.sound(Snd.Switch, eye, p.id, { except: p.id });
}

const GREN_MINS = v3(-3, -3, -3);
const GREN_MAXS = v3(3, 3, 3);

export function thinkProjectiles(g: Game): void {
  const dt = g.dt;
  const keep: Projectile[] = [];
  for (const pr of g.projectiles) {
    if (pr.kind === ProjKind.Frag || pr.kind === ProjKind.Emp) {
      pr.velocity.z -= 800 * dt;
      let left = dt;
      for (let i = 0; i < 3 && left > 0; i++) {
        const end = vma(pr.origin, left, pr.velocity);
        const tr = g.level.collision.trace(pr.origin, end, GREN_MINS, GREN_MAXS, CONTENTS_SOLID, g.shotFilter(pr.owner.team));
        pr.origin = tr.endpos;
        if (tr.fraction === 1) break;
        left -= left * tr.fraction;
        const vn = vdot(pr.velocity, tr.normal);
        pr.velocity = vscale(vsub(pr.velocity, vscale(tr.normal, 2 * vn)), 0.45);
        if (tr.normal.z > 0.7 && vlen(pr.velocity) < 40) pr.velocity = v3();
        if (Math.abs(vn) > 120 && pr.bounces++ < 6) g.sound(Snd.GrenadeBounce, pr.origin);
      }
      if (g.now >= pr.fuseAt) {
        explode(g, pr);
        continue;
      }
      keep.push(pr);
    } else {
      // Cyber projectiles are stepped in cyber.ts; keep them.
      keep.push(pr);
    }
  }
  g.projectiles = keep;
}

function explode(g: Game, pr: Projectile): void {
  const pos = pr.origin;
  if (pr.kind === ProjKind.Frag) {
    g.emit({ k: EvKind.Explosion, kind: 1, pos, radius: FRAG_RADIUS });
    radiusDamage(g, pos, WEAPONS[WeaponId.FragGrenade]!.damage, FRAG_RADIUS, pr.owner, WeaponId.FragGrenade, true);
  } else {
    g.emit({ k: EvKind.Explosion, kind: 2, pos, radius: EMP_RADIUS });
    for (const q of g.players.values()) {
      if (!q.alive) continue;
      const c = vadd(q.move.origin, v3(0, 0, 36));
      const d = vdist(c, pos);
      if (d > EMP_RADIUS) continue;
      const tr = g.level.collision.trace(pos, c, ZERO, ZERO, CONTENTS_SOLID, g.shotFilter(pr.owner.team));
      if (tr.fraction < 1) continue;
      const f = 1 - d / EMP_RADIUS;
      if (q.team !== pr.owner.team || g.rules.ff || q === pr.owner) {
        q.empUntil = Math.max(q.empUntil, g.now + EMP_MIN_SECONDS + (EMP_MAX_SECONDS - EMP_MIN_SECONDS) * f);
        q.stealthOn = false;
        q.thermalOn = false;
        q.flickerUntil = g.now + 1;
        // EMP rips deckers out of cyberspace.
        if (q.decked) jackOut(g, q, false, false, true);
      }
      g.damage(q, WEAPONS[WeaponId.EmpGrenade]!.damage * (0.4 + 0.6 * f), pr.owner, WeaponId.EmpGrenade, { dir: vnorm(vsub(c, pos)) });
    }
  }
}

export function radiusDamage(g: Game, pos: Vec3, damage: number, radius: number, attacker: ServerPlayer, cause: number, explosive: boolean): void {
  for (const q of g.players.values()) {
    if (!q.alive) continue;
    const c = vadd(q.move.origin, v3(0, 0, 36));
    const d = vdist(c, pos);
    if (d > radius) continue;
    const tr = g.level.collision.trace(pos, c, ZERO, ZERO, CONTENTS_SOLID, g.shotFilter(attacker.team));
    if (tr.fraction < 1) continue;
    const f = 1 - d / radius;
    const dir = vnorm(vsub(c, pos));
    q.move.velocity = vadd(q.move.velocity, vscale(dir, 450 * f));
    if (q.move.onGround && dir.z > -0.2) q.move.velocity.z += 140 * f;
    g.damage(q, damage * f, attacker, cause === WeaponId.FragGrenade ? WeaponId.FragGrenade : Cause.Explosion, { explosive, dir });
  }
  for (const b of g.breakables) {
    const c = vscale(vadd(b.src.mins, b.src.maxs), 0.5);
    const d = Math.max(0, vdist(c, pos) - 64);
    if (d < radius) damageBreakable(g, b, damage * (1 - d / radius), attacker, explosive);
  }
  for (const t of g.turrets) {
    const d = vdist(t.origin, pos);
    if (d < radius) damageTurret(g, t, damage * (1 - d / radius), attacker);
  }
}

// ---------------------------------------------------------------------------
// Turrets

export function thinkTurrets(g: Game): void {
  const rng = makeRng(g.tick);
  for (const t of g.turrets) {
    t.firing = false;
    if (!t.enabled || !t.alive || !t.team) continue;
    // Retarget four times a second.
    if (g.tick % 15 === t.id % 15 || !t.targetId) {
      let best = 0;
      let bestD = Infinity;
      for (const q of g.players.values()) {
        if (!q.alive || q.team === t.team) continue;
        if (q.stealthOn && q.vis < 0.35) continue; // optic turrets lose stealthers
        const aim = vadd(q.move.origin, v3(0, 0, q.move.ducked ? 24 : 44));
        const d = vdist(aim, t.origin);
        if (d > t.range || d >= bestD) continue;
        const tr = g.level.collision.trace(t.origin, aim, ZERO, ZERO, CONTENTS_SOLID, g.shotFilter(t.team));
        if (tr.fraction < 1) continue;
        best = q.id;
        bestD = d;
      }
      t.targetId = best;
    }
    const q = t.targetId ? g.players.get(t.targetId) : undefined;
    if (!q || !q.alive) {
      t.targetId = 0;
      continue;
    }
    const aim = vadd(q.move.origin, v3(0, 0, q.move.ducked ? 24 : 44));
    const want = vectorAngles(vsub(aim, t.origin));
    const maxTurn = 200 * g.dt;
    const dy = angleNormalize(want.yaw - t.yaw);
    const dp = want.pitch - t.pitch;
    t.yaw = angleNormalize(t.yaw + Math.max(-maxTurn, Math.min(maxTurn, dy)));
    t.pitch += Math.max(-maxTurn, Math.min(maxTurn, dp));
    if (Math.abs(dy) < 6 && Math.abs(dp) < 6 && g.now >= t.nextFire) {
      t.nextFire = g.now + 0.1;
      t.firing = true;
      const spread = 2.2;
      const dir = angleVectors(t.pitch + (rng() - 0.5) * spread * 2, t.yaw + (rng() - 0.5) * spread * 2).forward;
      const end = vma(t.origin, t.range, dir);
      const tr = g.level.collision.trace(t.origin, end, ZERO, ZERO, CONTENTS_SOLID, g.shotFilter(t.team));
      let frac = tr.fraction;
      let victim: ServerPlayer | null = null;
      const delta = vsub(end, t.origin);
      for (const c of g.players.values()) {
        if (!c.alive || c.team === t.team) continue;
        const hb = hitboxes(c.cls, c.move.ducked);
        const f = rayAabb(t.origin, delta, vadd(c.move.origin, hb.body.mins), vadd(c.move.origin, hb.head.maxs));
        if (f >= 0 && f < frac) {
          frac = f;
          victim = c;
        }
      }
      const hitPos = vma(t.origin, t.range * frac, dir);
      if (victim) g.damage(victim, t.damage, null, Cause.Turret, { dir });
      g.emit({ k: EvKind.TurretFire, turret: t.id, start: t.origin, end: hitPos });
    }
  }
}
