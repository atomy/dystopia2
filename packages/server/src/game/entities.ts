// Runtime state for map entities: doors, force fields, breakables, turrets,
// cameras, jack-in points, screens, cyber nodes, ICE, crack triggers,
// objectives, spawn groups, relays, zones.

import {
  type Level,
  type LevelEntity,
  type Vec3,
  type BrushModel,
  type Brush,
  v3,
  vadd,
  vscale,
  vsub,
  vlen,
  vnorm,
  parseVec,
  propNum,
  EntKind,
  type NetEnt,
  Team,
  boxInBrushes,
  doorMotion,
} from '@d2/shared';

export const bool = (e: LevelEntity, k: string, def = false): boolean => {
  const v = e.props[k];
  return v === undefined || v === '' ? def : v !== '0';
};
export const str = (e: LevelEntity, k: string, def = ''): string => e.props[k] ?? def;

export interface TargetAction {
  name: string;
  action: string | null;
}

/** Parse "a,b:open,c:disable" style target lists. */
export function parseTargets(s: string | undefined): TargetAction[] {
  if (!s) return [];
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const i = x.indexOf(':');
      return i < 0 ? { name: x, action: null } : { name: x.slice(0, i), action: x.slice(i + 1) };
    });
}

export abstract class Ent {
  constructor(readonly src: LevelEntity) {}
  get id(): number {
    return this.src.id;
  }
  get name(): string {
    return this.src.props['targetname'] ?? '';
  }
  get label(): string {
    return this.src.props['label'] ?? this.name;
  }
  /** Handle a fired action. `team` is the activator's team. */
  fire(_action: string, _team: number): void {}
  think(_dt: number, _now: number): void {}
  net(): NetEnt | null {
    return null;
  }
  reset(): void {}
}

// ---------------------------------------------------------------------------

export class DoorEnt extends Ent {
  readonly dir: Vec3;
  readonly distance: number;
  readonly speed: number;
  readonly wait: number;
  readonly team: number;
  lockedInit: boolean;
  locked = false;
  pos = 0;
  target = 0;
  holdUntil = 0;
  permanent = false;
  model!: BrushModel;
  moving = false;

  constructor(src: LevelEntity) {
    super(src);
    const m = doorMotion(src);
    this.dir = m.dir;
    this.distance = m.distance;
    this.speed = propNum(src, 'speed', 150);
    this.wait = propNum(src, 'wait', 3);
    this.team = propNum(src, 'team', 0);
    this.lockedInit = bool(src, 'locked');
    this.reset();
  }

  override reset(): void {
    this.locked = this.lockedInit;
    this.pos = 0;
    this.target = 0;
    this.permanent = false;
    this.holdUntil = 0;
    if (this.model) this.model.offset = v3();
  }

  override fire(action: string, _team: number): void {
    switch (action) {
      case 'open':
        this.target = 1;
        if (this.wait < 0 || this.locked) this.permanent = true;
        this.locked = false;
        break;
      case 'close':
        this.target = 0;
        this.permanent = false;
        break;
      case 'toggle':
        this.fire(this.target > 0.5 ? 'close' : 'open', _team);
        break;
      case 'lock':
        this.locked = true;
        break;
      case 'unlock':
        this.locked = false;
        break;
    }
  }

  /** A player of `team` is near: auto-open team doors. */
  request(team: number, now: number): void {
    if (this.permanent) return;
    if (this.team !== 0 && this.team === team) {
      this.target = 1;
      this.holdUntil = now + Math.max(this.wait, 1);
    } else if (this.team === 0 && !this.locked && !this.lockedInit) {
      this.target = 1;
      this.holdUntil = now + Math.max(this.wait, 1);
    }
  }

  offsetAt(pos: number): Vec3 {
    return vscale(this.dir, this.distance * pos);
  }

  override net(): NetEnt {
    return { id: this.id, kind: EntKind.Door, team: this.team, state: (this.locked ? 1 : 0) | (this.moving ? 2 : 0), value: this.pos, a: 0, b: 0 };
  }
}

export class ForceFieldEnt extends Ent {
  readonly teamInit: number;
  team: number;
  on = true;
  model!: BrushModel;
  constructor(src: LevelEntity) {
    super(src);
    this.teamInit = propNum(src, 'team', 0);
    this.team = this.teamInit;
    this.reset();
  }
  override reset(): void {
    this.team = this.teamInit;
    this.on = bool(this.src, 'start', true);
  }
  override fire(action: string, team: number): void {
    if (action === 'disable' || action === 'off') this.on = false;
    else if (action === 'enable' || action === 'on') this.on = true;
    else if (action === 'toggle') this.on = !this.on;
    else if (action === 'capture') this.team = team;
  }
  override net(): NetEnt {
    return { id: this.id, kind: EntKind.ForceField, team: this.team, state: this.on ? 1 : 0, value: 0, a: 0, b: 0 };
  }
}

export class BreakableEnt extends Ent {
  readonly maxHealth: number;
  health: number;
  readonly team: number;
  model!: BrushModel;
  lastHit = 0;
  constructor(src: LevelEntity) {
    super(src);
    this.maxHealth = propNum(src, 'health', 500);
    this.health = this.maxHealth;
    this.team = propNum(src, 'team', 0);
  }
  get destroyed(): boolean {
    return this.health <= 0;
  }
  override reset(): void {
    this.health = this.maxHealth;
    if (this.model) this.model.solid = true;
  }
  override net(): NetEnt {
    return { id: this.id, kind: EntKind.Breakable, team: this.team, state: this.destroyed ? 1 : 0, value: this.health / this.maxHealth, a: 0, b: 0 };
  }
}

export class TurretEnt extends Ent {
  readonly teamInit: number;
  team: number;
  readonly maxHealth: number;
  health: number;
  readonly respawn: number;
  readonly damage: number;
  readonly range: number;
  readonly origin: Vec3;
  yaw: number;
  pitch = 0;
  enabled = true;
  targetId = 0;
  nextFire = 0;
  deadUntil = 0;
  firing = false;
  constructor(src: LevelEntity) {
    super(src);
    this.teamInit = propNum(src, 'team', 0);
    this.team = this.teamInit;
    this.maxHealth = propNum(src, 'health', 0);
    this.health = this.maxHealth;
    this.respawn = propNum(src, 'respawn', 30);
    this.damage = propNum(src, 'damage', 8);
    this.range = propNum(src, 'range', 1500);
    this.origin = vadd(src.origin, v3(0, 0, 24));
    this.yaw = src.angle;
  }
  get alive(): boolean {
    return this.maxHealth === 0 || this.health > 0;
  }
  override reset(): void {
    this.team = this.teamInit;
    this.health = this.maxHealth;
    this.enabled = true;
    this.yaw = this.src.angle;
    this.pitch = 0;
    this.deadUntil = 0;
  }
  override fire(action: string, team: number): void {
    if (action === 'capture') this.team = team;
    else if (action === 'disable' || action === 'off') this.enabled = false;
    else if (action === 'enable' || action === 'on') this.enabled = true;
    else if (action === 'toggle') this.enabled = !this.enabled;
  }
  override think(_dt: number, now: number): void {
    if (this.maxHealth > 0 && this.health <= 0 && this.deadUntil > 0 && now >= this.deadUntil) {
      this.health = this.maxHealth;
      this.deadUntil = 0;
    }
  }
  override net(): NetEnt {
    const st = (this.enabled ? 1 : 0) | (this.alive ? 2 : 0) | (this.firing ? 4 : 0);
    return {
      id: this.id,
      kind: EntKind.Turret,
      team: this.team,
      state: st,
      value: this.maxHealth ? Math.max(0, this.health / this.maxHealth) : 1,
      a: Math.round(this.yaw * 10) % 3600,
      b: Math.round(this.pitch * 10),
      origin: this.origin,
    };
  }
}

export class CameraEnt extends Ent {
  readonly teamInit: number;
  team: number;
  readonly origin: Vec3;
  readonly yaw: number;
  readonly fov: number;
  readonly range: number;
  constructor(src: LevelEntity) {
    super(src);
    this.teamInit = propNum(src, 'team', 0);
    this.team = this.teamInit;
    this.origin = src.origin;
    this.yaw = src.angle;
    this.fov = propNum(src, 'fov', 70);
    this.range = propNum(src, 'range', 1800);
  }
  override reset(): void {
    this.team = this.teamInit;
  }
  override fire(action: string, team: number): void {
    if (action === 'capture') this.team = team;
  }
  override net(): NetEnt {
    return { id: this.id, kind: EntKind.Camera, team: this.team, state: 0, value: 0, a: Math.round(this.yaw * 10), b: this.fov, origin: this.origin };
  }
}

export class JipEnt extends Ent {
  readonly team: number;
  readonly origin: Vec3;
  enabled = true;
  occupant = 0;
  lockUntil = 0;
  constructor(src: LevelEntity) {
    super(src);
    this.team = propNum(src, 'team', 0);
    this.origin = src.origin;
    this.reset();
  }
  override reset(): void {
    this.enabled = bool(this.src, 'enabled', true);
    this.occupant = 0;
    this.lockUntil = 0;
  }
  cyberSpawnFor(team: number): string {
    const key = team === Team.Punk ? 'cyberspawn_punk' : 'cyberspawn_corp';
    return this.src.props[key] || this.src.props['cyberspawn'] || '';
  }
  usableBy(team: number): boolean {
    return this.enabled && (this.team === 0 || this.team === team);
  }
  override fire(action: string): void {
    if (action === 'enable') this.enabled = true;
    else if (action === 'disable') this.enabled = false;
    else if (action === 'toggle') this.enabled = !this.enabled;
  }
  netLock = 0;
  override net(): NetEnt {
    return {
      id: this.id,
      kind: EntKind.Jip,
      team: this.team,
      state: (this.enabled ? 1 : 0) | (this.occupant ? 2 : 0),
      value: this.netLock,
      a: this.occupant,
      b: 0,
      origin: this.origin,
    };
  }
}

/** Meatspace button screen (hold Use). */
export class ScreenEnt extends Ent {
  readonly team: number;
  readonly holdTime: number;
  readonly stage: number;
  readonly origin: Vec3;
  progress = 0;
  used = false;
  enabled = true;
  lastUser = 0;
  constructor(src: LevelEntity) {
    super(src);
    this.team = propNum(src, 'team', 0);
    this.holdTime = propNum(src, 'holdtime', 1);
    this.stage = propNum(src, 'stage', 0);
    this.origin = src.origin;
  }
  override reset(): void {
    this.progress = 0;
    this.used = false;
    this.enabled = true;
  }
  override fire(action: string): void {
    if (action === 'enable') this.enabled = true;
    else if (action === 'disable') this.enabled = false;
  }
  override net(): NetEnt {
    return { id: this.id, kind: EntKind.Screen, team: this.team, state: (this.enabled ? 1 : 0) | (this.used ? 2 : 0), value: this.progress, a: this.lastUser, b: 0, origin: this.origin };
  }
}

/** Cyberspace node screen. */
export class NodeEnt extends Ent {
  readonly teamInit: number;
  owner: number;
  readonly protInit: number;
  protection = 0;
  /** Team that installed the current protection. */
  protTeam = 0;
  readonly stage: number;
  readonly origin: Vec3;
  readonly up: Vec3;
  readonly oneway: boolean;
  enabled = true;
  hackProgress = 0;
  hacker = 0;
  done = false;
  doorway: IceEnt | null = null;
  constructor(src: LevelEntity) {
    super(src);
    this.teamInit = propNum(src, 'team', Team.Corp);
    this.owner = this.teamInit;
    this.protInit = propNum(src, 'protection', 0);
    this.stage = propNum(src, 'stage', 0);
    this.origin = src.origin;
    this.up = vnorm(parseVec(src.props['up'], v3(0, 0, 1)));
    this.oneway = bool(src, 'oneway');
    this.reset();
  }
  override reset(): void {
    this.owner = this.teamInit;
    this.protection = this.protInit;
    this.protTeam = this.protInit ? this.teamInit : 0;
    this.enabled = true;
    this.hackProgress = 0;
    this.hacker = 0;
    this.done = false;
  }
  override fire(action: string): void {
    if (action === 'enable') this.enabled = true;
    else if (action === 'disable') this.enabled = false;
  }
  override net(): NetEnt {
    return {
      id: this.id,
      kind: EntKind.Node,
      team: this.owner,
      state: (this.enabled ? 1 : 0) | (this.done ? 2 : 0),
      value: this.hackProgress,
      a: this.protection | (this.protTeam << 4),
      b: this.stage,
      origin: this.origin,
    };
  }
}

export const ICE_ALARM = 1;
export const ICE_MINE = 2;
export const ICE_GREEN = 4;

export class IceEnt extends Ent {
  readonly passInit: number;
  pass: number;
  readonly doorway: boolean;
  model!: BrushModel;
  wedgedUntil = 0;
  /** Installed program traps (ICE_*), and the team that owns them. */
  traps = 0;
  trapTeam = 0;
  /** Teams that have scanned the traps (bitmask by team). */
  scannedBy = 0;
  readonly center: Vec3;
  constructor(src: LevelEntity) {
    super(src);
    this.passInit = propNum(src, 'pass', 3);
    this.pass = this.passInit;
    this.doorway = bool(src, 'doorway');
    this.center = v3((src.mins.x + src.maxs.x) / 2, (src.mins.y + src.maxs.y) / 2, (src.mins.z + src.maxs.z) / 2);
  }
  override reset(): void {
    this.pass = this.passInit;
    this.wedgedUntil = 0;
    this.traps = 0;
    this.trapTeam = 0;
    this.scannedBy = 0;
  }
  /** Is this ICE solid for `team` right now? */
  blocks(team: number, now: number): boolean {
    if (now < this.wedgedUntil) return false;
    if (this.pass === 3) return false;
    if (this.pass === 0) return true;
    return this.pass !== team;
  }
  /** ICE with an actual barrier on it (targets for offensive programs). */
  get active(): boolean {
    return this.pass !== 3;
  }
  override fire(action: string): void {
    const m = /^pass([0-3])$/.exec(action);
    if (m) this.pass = Number(m[1]);
    else if (action === 'open') this.pass = 3;
    else if (action === 'close') this.pass = 0;
  }
  override net(): NetEnt {
    return {
      id: this.id,
      kind: EntKind.Ice,
      team: this.pass,
      state: (this.doorway ? 1 : 0),
      value: this.wedgedUntil,
      a: this.traps,
      b: this.trapTeam,
      origin: this.center,
    };
  }
}

export class CrackEnt extends Ent {
  readonly team: number;
  readonly time: number;
  readonly stage: number;
  progress = 0;
  done = false;
  cracker = 0;
  pausedUntil = 0;
  constructor(src: LevelEntity) {
    super(src);
    this.team = propNum(src, 'team', 0);
    this.time = propNum(src, 'time', 20);
    this.stage = propNum(src, 'stage', 0);
  }
  contains(p: Vec3, mins: Vec3, maxs: Vec3): boolean {
    return boxInBrushes(p, mins, maxs, this.src.brushes);
  }
  override reset(): void {
    this.progress = 0;
    this.done = false;
    this.cracker = 0;
  }
  override net(): NetEnt {
    const c = vscale(vadd(this.src.mins, this.src.maxs), 0.5);
    return { id: this.id, kind: EntKind.Crack, team: this.team, state: this.done ? 1 : 0, value: this.progress, a: this.cracker, b: this.stage, origin: c };
  }
}

export class ObjectiveEnt extends Ent {
  readonly stage: number;
  readonly final: boolean;
  readonly optional: boolean;
  done = false;
  constructor(src: LevelEntity) {
    super(src);
    this.stage = propNum(src, 'stage', 1);
    this.final = bool(src, 'final');
    this.optional = bool(src, 'optional');
  }
  override reset(): void {
    this.done = false;
  }
  override net(): NetEnt {
    return { id: this.id, kind: EntKind.Objective, team: 0, state: (this.done ? 1 : 0) | (this.final ? 2 : 0) | (this.optional ? 4 : 0), value: 0, a: this.stage, b: 0, origin: this.src.origin };
  }
}

export class SpawnGroupEnt extends Ent {
  readonly teamInit: number;
  team: number;
  enabled = true;
  readonly points: { origin: Vec3; angle: number }[] = [];
  constructor(src: LevelEntity) {
    super(src);
    this.teamInit = propNum(src, 'team', 0);
    this.team = this.teamInit;
    this.reset();
  }
  override reset(): void {
    this.team = this.teamInit;
    this.enabled = bool(this.src, 'enabled', true);
  }
  override fire(action: string, team: number): void {
    if (action === 'enable') this.enabled = true;
    else if (action === 'disable') this.enabled = false;
    else if (action === 'capture') {
      this.team = team;
      this.enabled = true;
    }
  }
}

export class RelayEnt extends Ent {}

export { type Zone, zoneFrom, zoneContains } from '@d2/shared';

export const vlenSafe = (v: Vec3): number => vlen(v);
