// Client-side view of the level: entity states from snapshots, collision
// filters matching the server, and the prediction step for the local player.

import {
  type Level,
  type LevelEntity,
  type NetEnt,
  type NetLocal,
  type UserCmd,
  type Vec3,
  type ModelFilter,
  type BrushModel,
  type CyberEnv,
  type WeaponEvent,
  type MoveEvents,
  type CyberMoveEvents,
  type PlayerMoveState,
  type WeaponState,
  type CyberMoveState,
  PlayerMover,
  DEFAULT_MOVE,
  EntKind,
  loadLevel,
  doorMotion,
  vscale,
  v3,
  zonesOf,
  makeCyberEnv,
  moveCapsFor,
  stepWeapons,
  cyberMove,
  cloneMoveState,
  cloneWeaponState,
  cloneCyberState,
} from '@d2/shared';

export interface Predicted {
  t: number;
  move: PlayerMoveState;
  weap: WeaponState;
  cyber: CyberMoveState | null;
}

export const clonePredicted = (p: Predicted): Predicted => ({
  t: p.t,
  move: cloneMoveState(p.move),
  weap: cloneWeaponState(p.weap),
  cyber: p.cyber ? cloneCyberState(p.cyber) : null,
});

export interface StepResult {
  move: MoveEvents | null;
  cyber: CyberMoveEvents | null;
  weapons: WeaponEvent[];
}

export class ClientWorld {
  readonly level: Level;
  readonly mover: PlayerMover;
  readonly env: CyberEnv;
  /** Latest state of every networked map entity. */
  readonly ents = new Map<number, NetEnt>();
  readonly byId = new Map<number, LevelEntity>();
  readonly doors = new Map<number, { dir: Vec3; distance: number }>();
  phase = 1;
  /** Local time (s) the latest snapshot arrived, for ICE wedge timers. */
  private snapTime = 0;

  constructor(name: string, src: string) {
    this.level = loadLevel(name, src);
    this.mover = new PlayerMover(this.level.collision, DEFAULT_MOVE);
    this.env = makeCyberEnv(zonesOf(this.level.entities));
    for (const e of this.level.entities) {
      this.byId.set(e.id, e);
      if (e.classname === 'func_door') this.doors.set(e.id, doorMotion(e));
    }
    // Brush models the server knows about but the level loader doesn't register.
    for (const e of this.level.entities) {
      if ((e.classname === 'func_breakable' || e.classname === 'cyber_ice') && !this.level.collision.models.has(e.id)) {
        this.level.collision.addModel(e.id, e.brushes);
      }
    }
  }

  applyEnts(ents: NetEnt[], now: number): void {
    this.snapTime = now;
    for (const e of ents) this.ents.set(e.id, e);
    // Drop dynamic entities (projectiles, crystals) that vanished.
    const live = new Set(ents.map((e) => e.id));
    for (const id of [...this.ents.keys()]) if (id >= 20000 && !live.has(id)) this.ents.delete(id);
    for (const [id, d] of this.doors) {
      const st = this.ents.get(id);
      const m = this.level.collision.models.get(id);
      if (st && m) m.offset = vscale(d.dir, d.distance * st.value);
    }
    for (const e of ents) {
      if (e.kind === EntKind.Breakable) {
        const m = this.level.collision.models.get(e.id);
        if (m) m.solid = (e.state & 1) === 0;
      }
    }
  }

  /** Mirrors Game.teamFilter on the server. */
  teamFilter(team: number, now: number): ModelFilter {
    return (m: BrushModel) => {
      const e = this.ents.get(m.id);
      if (!e) return true;
      switch (e.kind) {
        case EntKind.ForceField:
          return (e.state & 1) === 1 && e.team !== team;
        case EntKind.Breakable:
          return (e.state & 1) === 0;
        case EntKind.Ice: {
          // value = wedge time remaining when the snapshot was taken.
          if (e.value > 0 && now - this.snapTime < e.value) return false;
          if (e.team === 3) return false;
          if (e.team === 0) return true;
          return e.team !== team;
        }
      }
      return true;
    };
  }

  doorOffset(id: number): Vec3 {
    const d = this.doors.get(id);
    const st = this.ents.get(id);
    return d && st ? vscale(d.dir, d.distance * st.value) : v3();
  }

  /** Run one command on the predicted local state (same code path as the server). */
  step(p: Predicted, cmd: UserCmd, ctx: { team: number; cls: number; implants: number; energy: number; emped: boolean; alive: boolean; now: number }): StepResult {
    const dt = Math.min(Math.max(cmd.msec, 0), 50) / 1000;
    const res: StepResult = { move: null, cyber: null, weapons: [] };
    if (!ctx.alive) {
      p.t += dt;
      return res;
    }
    const filter = this.teamFilter(ctx.team, ctx.now);
    if (p.cyber) {
      res.cyber = cyberMove(this.level.collision, p.cyber, cmd, this.env, filter);
      p.t += dt;
      return res;
    }
    this.mover.filter = filter;
    const caps = moveCapsFor(ctx.cls, ctx.implants, ctx.energy, ctx.emped, p.weap);
    res.move = this.mover.move(p.move, cmd, caps);
    res.weapons = stepWeapons(p.weap, cmd, p.t, { canAttack: !p.move.hanging && this.phase !== 2 });
    p.t += dt;
    return res;
  }
}

export function predictedFrom(l: NetLocal): Predicted {
  return {
    t: l.t,
    move: cloneMoveState(l.move),
    weap: cloneWeaponState(l.weap),
    cyber: l.cyber ? cloneCyberState(l.cyber) : null,
  };
}
