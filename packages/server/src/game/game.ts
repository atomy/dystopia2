// Authoritative game simulation for one room.

import {
  type Level,
  type LevelEntity,
  type Vec3,
  type UserCmd,
  type NetEvent,
  type NetEnt,
  type NetPlayer,
  type Snapshot,
  type BrushModel,
  type ModelFilter,
  loadLevel,
  PlayerMover,
  Buttons,
  stepWeapons,
  hullFor,
  DEFAULT_MOVE,
  MASK_PLAYERSOLID,
  v3,
  vadd,
  vsub,
  vlen,
  vdist,
  vscale,
  vnorm,
  vdot,
  angleVectors,
  cyberBasis,
  parseVec,
  propNum,
  EvKind,
  PF,
  Snd,
  Cause,
  Team,
  otherTeam,
  CLASSES,
  ClassId,
  ImplantId,
  validateLoadout,
  DEFAULT_LOADOUTS,
  implantMask,
  TICK_RATE,
  MAX_LAG_COMP_MS,
  ENERGY_REGEN,
  STEALTH_DRAIN,
  THERMAL_DRAIN,
  SPRINT_DRAIN,
  DECK_DRAIN,
  TAC_COST,
  TAC_RANGE,
  TAC_DURATION,
  TAC_COOLDOWN,
  MEDI_RANGE,
  MEDI_COST,
  MEDI_HEAL,
  MEDI_HEAL_HEAVY,
  MEDI_SELF,
  MEDI_INTERVAL,
  ARMOR_ABSORB,
  GOOMBA_DAMAGE,
  WAVE_BASE,
  WAVE_CAP,
  WAVE_IDLE,
  DEFENDER_FASTSPAWN_SECONDS,
  STAGE_TIME_BONUS,
  fallDamage,
  WeaponId,
  WEAPONS,
  CONTENTS_SOLID,
} from '@d2/shared';
import { ServerPlayer } from './player.js';
import {
  type Ent,
  DoorEnt,
  ForceFieldEnt,
  BreakableEnt,
  TurretEnt,
  CameraEnt,
  JipEnt,
  ScreenEnt,
  NodeEnt,
  IceEnt,
  CrackEnt,
  ObjectiveEnt,
  SpawnGroupEnt,
  RelayEnt,
  type Zone,
  zoneFrom,
  parseTargets,
  str,
} from './entities.js';
import { fireHitscan, doMelee, throwGrenade, thinkProjectiles, thinkTurrets, type Projectile } from './combat.js';
import { cyberCmd, tryJackIn, jackOut, thinkCrystals, type Crystal } from './cyber.js';

export type EventTarget = { all: true } | { team: number } | { player: number } | { except: number };

export interface RulesState {
  phase: number; // 0 warmup, 1 live, 2 over
  stage: number;
  stageCount: number;
  attackers: number;
  timeLeft: number;
  wave: number[];
  fastSpawnUntil: number[];
  winner: number;
  ff: boolean;
  overAt: number;
  noCaptureSince: number;
}

export interface GameOptions {
  friendlyFire: boolean;
}

export class Game {
  readonly level: Level;
  readonly mover: PlayerMover;
  tick = 0;
  now = 0;
  readonly dt = 1 / TICK_RATE;

  readonly players = new Map<number, ServerPlayer>();
  readonly ents: Ent[] = [];
  readonly byName = new Map<string, Ent[]>();
  readonly modelOwner = new Map<number, Ent>();
  readonly doors: DoorEnt[] = [];
  readonly forcefields: ForceFieldEnt[] = [];
  readonly breakables: BreakableEnt[] = [];
  readonly turrets: TurretEnt[] = [];
  readonly cameras: CameraEnt[] = [];
  readonly jips: JipEnt[] = [];
  readonly screens: ScreenEnt[] = [];
  readonly nodes: NodeEnt[] = [];
  readonly ices: IceEnt[] = [];
  readonly cracks: CrackEnt[] = [];
  readonly objectives: ObjectiveEnt[] = [];
  readonly spawnGroups: SpawnGroupEnt[] = [];
  readonly zones: Zone[] = [];
  readonly ammo: Vec3[] = [];
  readonly cyberSpawns = new Map<string, LevelEntity[]>();
  readonly spawnPoints: { team: number; group: string; origin: Vec3; angle: number }[] = [];

  projectiles: Projectile[] = [];
  crystals: Crystal[] = [];
  nextDynId = 20000;

  rules: RulesState;
  readonly roundTime: number;
  readonly stageBonus: number;
  events: { ev: NetEvent; to: EventTarget }[] = [];
  /** Text notices for the room to broadcast (JSON channel). */
  notices: { kind: string; text: string; team?: number }[] = [];
  private spawnCursor = 0;

  constructor(
    readonly mapName: string,
    mapSource: string,
    readonly opts: GameOptions,
  ) {
    this.level = loadLevel(mapName, mapSource);
    this.mover = new PlayerMover(this.level.collision, DEFAULT_MOVE);
    const gr = this.level.entities.find((e) => e.classname === 'd2_gamerules');
    this.roundTime = gr ? propNum(gr, 'roundtime', 900) : 900;
    this.stageBonus = gr ? propNum(gr, 'stagebonus', STAGE_TIME_BONUS) : STAGE_TIME_BONUS;
    this.rules = {
      phase: 1,
      stage: 1,
      stageCount: 1,
      attackers: gr ? propNum(gr, 'attackers', Team.Punk) : Team.Punk,
      timeLeft: this.roundTime,
      wave: [0, WAVE_IDLE, WAVE_IDLE, 0],
      fastSpawnUntil: [0, 0, 0, 0],
      winner: 0,
      ff: opts.friendlyFire,
      overAt: 0,
      noCaptureSince: 0,
    };
    this.buildEntities();
    this.rules.stageCount = Math.max(1, ...this.objectives.map((o) => o.stage));
  }

  // ---- setup ---------------------------------------------------------------

  private register(e: Ent): void {
    this.ents.push(e);
    const n = e.name;
    if (n) {
      const l = this.byName.get(n) ?? [];
      l.push(e);
      this.byName.set(n, l);
    }
  }

  private buildEntities(): void {
    const col = this.level.collision;
    const attachModel = (e: Ent & { model: BrushModel }) => {
      const m = col.models.get(e.id) ?? col.addModel(e.id, e.src.brushes);
      e.model = m;
      this.modelOwner.set(e.id, e);
    };
    for (const le of this.level.entities) {
      switch (le.classname) {
        case 'func_door': {
          const d = new DoorEnt(le);
          attachModel(d);
          this.doors.push(d);
          this.register(d);
          break;
        }
        case 'func_forcefield': {
          const f = new ForceFieldEnt(le);
          attachModel(f);
          this.forcefields.push(f);
          this.register(f);
          break;
        }
        case 'func_breakable': {
          const b = new BreakableEnt(le);
          attachModel(b);
          this.breakables.push(b);
          this.register(b);
          break;
        }
        case 'cyber_ice': {
          const i = new IceEnt(le);
          attachModel(i);
          this.ices.push(i);
          this.register(i);
          break;
        }
        case 'd2_turret': {
          const t = new TurretEnt(le);
          this.turrets.push(t);
          this.register(t);
          break;
        }
        case 'd2_camera': {
          const c = new CameraEnt(le);
          this.cameras.push(c);
          this.register(c);
          break;
        }
        case 'd2_jackin': {
          const j = new JipEnt(le);
          this.jips.push(j);
          this.register(j);
          break;
        }
        case 'd2_screen': {
          const s = new ScreenEnt(le);
          this.screens.push(s);
          this.register(s);
          break;
        }
        case 'd2_node': {
          const n = new NodeEnt(le);
          this.nodes.push(n);
          this.register(n);
          break;
        }
        case 'trigger_crack': {
          const c = new CrackEnt(le);
          this.cracks.push(c);
          this.register(c);
          break;
        }
        case 'd2_objective': {
          const o = new ObjectiveEnt(le);
          this.objectives.push(o);
          this.register(o);
          break;
        }
        case 'd2_spawngroup': {
          const g = new SpawnGroupEnt(le);
          this.spawnGroups.push(g);
          this.register(g);
          break;
        }
        case 'd2_relay':
          this.register(new RelayEnt(le));
          break;
        case 'd2_cyber_spawn': {
          const n = le.props['targetname'] ?? '';
          const l = this.cyberSpawns.get(n) ?? [];
          l.push(le);
          this.cyberSpawns.set(n, l);
          break;
        }
        case 'info_player_punk':
        case 'info_player_corp':
          this.spawnPoints.push({
            team: le.classname === 'info_player_punk' ? Team.Punk : Team.Corp,
            group: le.props['group'] ?? '',
            origin: le.origin,
            angle: le.angle,
          });
          break;
        case 'd2_ammo':
          this.ammo.push(le.origin);
          break;
        default: {
          const z = zoneFrom(le);
          if (z) this.zones.push(z);
        }
      }
    }
    for (const n of this.nodes) {
      const d = n.src.props['doorway'];
      if (d) n.doorway = (this.byName.get(d)?.find((e) => e instanceof IceEnt) as IceEnt | undefined) ?? null;
    }
  }

  /** Collision filter for a player of `team` in meatspace / cyberspace. */
  teamFilter(team: number): ModelFilter {
    return (m: BrushModel) => {
      const e = this.modelOwner.get(m.id);
      if (!e) return true;
      if (e instanceof ForceFieldEnt) return e.on && e.team !== team;
      if (e instanceof BreakableEnt) return !e.destroyed;
      if (e instanceof IceEnt) return e.blocks(team, this.now);
      return true;
    };
  }

  /** Filter for bullets fired by `team` (force fields block the enemy). */
  shotFilter(team: number): ModelFilter {
    return (m: BrushModel) => {
      const e = this.modelOwner.get(m.id);
      if (!e) return true;
      if (e instanceof ForceFieldEnt) return e.on && e.team !== team;
      if (e instanceof BreakableEnt) return !e.destroyed;
      if (e instanceof IceEnt) return false;
      return true;
    };
  }

  /** Filter for cyber weapon fire: every active ICE blocks. */
  readonly cyberShotFilter: ModelFilter = (m: BrushModel) => {
    const e = this.modelOwner.get(m.id);
    if (e instanceof IceEnt) return e.active && this.now >= e.wedgedUntil;
    return !(e instanceof ForceFieldEnt || e instanceof DoorEnt || e instanceof BreakableEnt);
  };

  // ---- events --------------------------------------------------------------

  emit(ev: NetEvent, to: EventTarget = { all: true }): void {
    this.events.push({ ev, to });
  }

  sound(sound: Snd, pos: Vec3, player = 0, to: EventTarget = { all: true }): void {
    this.emit({ k: EvKind.Sound, sound, pos, player }, to);
  }

  notice(kind: string, text: string, team?: number): void {
    this.notices.push({ kind, text, team });
  }

  // ---- players -------------------------------------------------------------

  addPlayer(name: string, bot = false): ServerPlayer | null {
    let id = 1;
    while (this.players.has(id)) id++;
    if (id > 250) return null;
    const p = new ServerPlayer(id, name);
    p.bot = bot;
    this.players.set(id, p);
    return p;
  }

  removePlayer(id: number): void {
    const p = this.players.get(id);
    if (!p) return;
    if (p.decked) jackOut(this, p, false);
    this.players.delete(id);
  }

  teamCount(team: number, humansOnly = false): number {
    let n = 0;
    for (const p of this.players.values()) if (p.team === team && (!humansOnly || !p.bot)) n++;
    return n;
  }

  autoTeam(): number {
    return this.teamCount(Team.Punk) <= this.teamCount(Team.Corp) ? Team.Punk : Team.Corp;
  }

  setTeam(p: ServerPlayer, team: number): void {
    if (p.team === team) return;
    if (p.alive) this.kill(p, null, Cause.Suicide, false, true);
    p.team = team;
    p.alive = false;
    p.waitingSpawn = team === Team.Punk || team === Team.Corp;
    if (p.waitingSpawn) this.spawnPlayer(p);
  }

  setLoadout(p: ServerPlayer, cls: number, implants: number[]): string | null {
    const err = validateLoadout(cls, implants);
    if (err) return err;
    p.nextCls = cls;
    p.nextImplants = implants;
    // Loadout changes apply immediately while still on the spawn pad.
    if (p.alive && !p.decked && this.now - p.spawnTime < 8 && vlen(p.move.velocity) < 1 && p.lastFireTime < p.spawnTime) {
      const o = p.move.origin;
      p.spawn(o, p.yaw);
      p.spawnTime = this.now;
    }
    return null;
  }

  queueCmds(p: ServerPlayer, cmds: UserCmd[]): void {
    for (const c of cmds) {
      if (c.seq <= p.lastSeq) continue;
      if (p.cmdQueue.length && c.seq <= p.cmdQueue[p.cmdQueue.length - 1]!.seq) continue;
      p.cmdQueue.push(c);
    }
    if (p.cmdQueue.length > 40) p.cmdQueue.splice(0, p.cmdQueue.length - 40);
  }

  spawnPoint(team: number): { origin: Vec3; angle: number } | null {
    const groups = new Set(this.spawnGroups.filter((g) => g.enabled && g.team === team).map((g) => g.name));
    const cands = this.spawnPoints.filter((s) => s.team === team && (groups.has(s.group) || (!s.group && groups.size === 0)));
    const list = cands.length ? cands : this.spawnPoints.filter((s) => s.team === team);
    if (!list.length) return null;
    const hull = hullFor(DEFAULT_MOVE, false);
    for (let i = 0; i < list.length; i++) {
      const s = list[(this.spawnCursor + i) % list.length]!;
      const o = vadd(s.origin, v3(0, 0, 1));
      let blocked = this.level.collision.testBox(o, hull.mins, hull.maxs, MASK_PLAYERSOLID);
      for (const q of this.players.values()) if (q.alive && vdist(q.move.origin, o) < 40) blocked = true;
      if (!blocked) {
        this.spawnCursor = (this.spawnCursor + i + 1) % 1024;
        return { origin: o, angle: s.angle };
      }
    }
    const s = list[this.spawnCursor++ % list.length]!;
    return { origin: vadd(s.origin, v3(0, 0, 1)), angle: s.angle };
  }

  spawnPlayer(p: ServerPlayer): void {
    if (p.team !== Team.Punk && p.team !== Team.Corp) return;
    const sp = this.spawnPoint(p.team);
    if (!sp) return;
    p.spawn(sp.origin, sp.angle);
    p.spawnTime = this.now;
    this.sound(Snd.Spawn, sp.origin, p.id);
  }

  // ---- damage --------------------------------------------------------------

  damage(
    victim: ServerPlayer,
    amount: number,
    attacker: ServerPlayer | null,
    cause: number,
    opts: { explosive?: boolean; headshot?: boolean; dir?: Vec3 } = {},
  ): number {
    if (!victim.alive || amount <= 0 || this.rules.phase === 2) return 0;
    if (attacker && attacker !== victim && attacker.team === victim.team && !this.rules.ff) return 0;
    let hp = amount;
    let armorHit = false;
    if (victim.armor > 0) {
      const mult = opts.explosive ? 2 : 1;
      let toArmor = amount * ARMOR_ABSORB * mult;
      hp = amount * (1 - ARMOR_ABSORB);
      if (toArmor > victim.armor) {
        hp += (toArmor - victim.armor) / mult;
        toArmor = victim.armor;
      }
      victim.armor -= toArmor;
      armorHit = true;
    }
    victim.health -= hp;
    victim.lastDamageTime = this.now;
    victim.flickerUntil = this.now + 0.35;
    if (attacker && attacker !== victim) {
      victim.lastAttacker = attacker.id;
      victim.lastAttackTime = this.now;
    }
    if (victim.decked) {
      victim.bodyDamagedAt = this.now;
      if (this.now - victim.lastBodyAlarm > 3) {
        victim.lastBodyAlarm = this.now;
        this.emit({ k: EvKind.Alarm, kind: 1, ref: victim.id, pos: victim.move.origin }, { team: victim.team });
      }
    }
    // Cracking pauses when hurt.
    victim.crackPausedUntil = this.now + 1;
    const dir = opts.dir ?? v3();
    this.emit({ k: EvKind.Damage, amount: Math.round(amount), dir, armor: armorHit }, { player: victim.id });
    const killed = victim.health <= 0;
    if (attacker && attacker !== victim) {
      this.emit({ k: EvKind.Hit, victim: victim.id, amount: Math.round(amount), headshot: !!opts.headshot, kill: killed }, { player: attacker.id });
    }
    if (killed) this.kill(victim, attacker, cause, !!opts.headshot);
    else if (Math.random() < 0.5) this.sound(Snd.Pain, victim.move.origin, victim.id);
    return amount;
  }

  kill(victim: ServerPlayer, attacker: ServerPlayer | null, cause: number, headshot: boolean, silent = false): void {
    if (!victim.alive) return;
    if (victim.decked) jackOut(this, victim, false, true);
    victim.alive = false;
    victim.health = 0;
    victim.deathTime = this.now;
    victim.deaths++;
    victim.stealthOn = false;
    victim.thermalOn = false;
    victim.program = null;
    // Credit a recent attacker for suicides/falls ("finished off").
    let killer = attacker;
    if ((!killer || killer === victim) && victim.lastAttacker && this.now - victim.lastAttackTime < 5) {
      killer = this.players.get(victim.lastAttacker) ?? null;
    }
    if (killer && killer !== victim) {
      if (killer.team === victim.team) killer.score -= 1;
      else {
        killer.score += 1;
        killer.kills++;
      }
    }
    if (!silent) {
      this.emit({ k: EvKind.Kill, killer: killer?.id ?? 0, victim: victim.id, weapon: cause, headshot });
      this.sound(Snd.Death, victim.move.origin, victim.id);
    }
    this.queueRespawn(victim);
  }

  private queueRespawn(p: ServerPlayer): void {
    if (p.team !== Team.Punk && p.team !== Team.Corp) return;
    p.waitingSpawn = true;
    const t = p.team;
    this.rules.wave[t] = Math.min((this.rules.wave[t] ?? WAVE_BASE) + CLASSES[p.cls]!.respawnPenalty, WAVE_CAP);
  }

  // ---- logic I/O ------------------------------------------------------------

  /** Fire a target list (e.g. "door_bay,turret_x:capture"). */
  fireTargets(targets: string | undefined, defaultAction: string, team: number, depth = 0): void {
    if (depth > 8) return;
    for (const t of parseTargets(targets)) {
      const action = t.action ?? defaultAction;
      for (const e of this.byName.get(t.name) ?? []) {
        if (e instanceof RelayEnt) this.fireTargets(e.src.props['target'], action, team, depth + 1);
        else e.fire(action, team);
        if (e instanceof DoorEnt) {
          if (!e.permanent) e.holdUntil = this.now + Math.max(e.wait, 1);
          if (action === 'open' || action === 'toggle') this.sound(Snd.DoorMove, e.src.origin);
        }
      }
    }
  }

  completeObjective(name: string, team: number): void {
    const o = this.objectives.find((x) => x.name === name);
    if (!o || o.done || this.rules.phase !== 1) return;
    if (team !== this.rules.attackers) return;
    if (o.stage > this.rules.stage) return;
    o.done = true;
    this.rules.noCaptureSince = this.now;
    this.fireTargets(o.src.props['target'], 'trigger', team);
    this.notice('objective', `${o.label} — complete`, 0);
    this.sound(Snd.Capture, o.src.origin);
    if (o.final) {
      this.endRound(this.rules.attackers);
      return;
    }
    // Stage advances when every required objective of the current stage is done.
    const stageObjs = this.objectives.filter((x) => x.stage === this.rules.stage && !x.optional);
    if (stageObjs.every((x) => x.done)) {
      this.rules.stage++;
      this.rules.timeLeft += this.stageBonus;
      const def = otherTeam(this.rules.attackers);
      this.rules.fastSpawnUntil[def] = this.now + DEFENDER_FASTSPAWN_SECONDS;
      const next = this.objectives.filter((x) => x.stage === this.rules.stage);
      this.notice('stage', `Stage ${this.rules.stage}: ${next.map((x) => x.label).join(' / ')}`, 0);
    }
  }

  endRound(winner: number): void {
    if (this.rules.phase === 2) return;
    this.rules.phase = 2;
    this.rules.winner = winner;
    this.rules.overAt = this.now + 10;
    this.notice('round', winner === this.rules.attackers ? 'Attackers win!' : 'Defenders win!', 0);
  }

  resetRound(): void {
    for (const e of this.ents) e.reset();
    for (const d of this.doors) d.model.offset = v3();
    for (const b of this.breakables) b.model.solid = true;
    this.projectiles = [];
    this.crystals = [];
    this.rules.phase = 1;
    this.rules.stage = 1;
    this.rules.timeLeft = this.roundTime;
    this.rules.wave = [0, WAVE_IDLE, WAVE_IDLE, 0];
    this.rules.winner = 0;
    this.rules.fastSpawnUntil = [0, 0, 0, 0];
    this.rules.noCaptureSince = this.now;
    for (const p of this.players.values()) {
      if (p.decked) jackOut(this, p, false);
      p.alive = false;
      if (p.team === Team.Punk || p.team === Team.Corp) this.spawnPlayer(p);
    }
    this.notice('round', 'New round! Punks attack.', 0);
  }

  // ---- per-command simulation -------------------------------------------------

  private processCmd(p: ServerPlayer, cmd: UserCmd): void {
    const dt = Math.min(Math.max(cmd.msec, 0), 50) / 1000;
    const pressed = cmd.buttons & ~p.prevButtons;
    p.prevButtons = cmd.buttons;
    p.lastSeq = cmd.seq;
    p.lastCmd = cmd;
    if (!p.alive) {
      p.t += dt;
      return;
    }
    if (pressed & Buttons.SUICIDE) {
      this.kill(p, null, Cause.Suicide, false);
      p.t += dt;
      return;
    }
    if (p.decked) {
      cyberCmd(this, p, cmd, pressed, dt);
      p.t += dt;
      return;
    }
    p.pitch = cmd.pitch;
    p.yaw = cmd.yaw;
    const emped = this.now < p.empUntil;

    // Implant keys (fixed bindings).
    if (pressed & Buttons.DECK && p.hasDeck) tryJackIn(this, p);
    if (p.decked) {
      p.t += dt;
      return;
    }
    if (pressed & Buttons.THERMAL && p.has(ImplantId.Thermal) && !emped) {
      p.thermalOn = !p.thermalOn && p.energy > 1;
      this.sound(Snd.Thermal, p.move.origin, p.id, { player: p.id });
    }
    if (pressed & Buttons.STEALTH && p.has(ImplantId.Stealth) && !emped) {
      p.stealthOn = !p.stealthOn && p.energy > 1;
      this.sound(p.stealthOn ? Snd.StealthOn : Snd.StealthOff, p.move.origin, p.id);
    }
    if (pressed & Buttons.TAC && p.has(ImplantId.TacScan)) this.tacScan(p);
    if (cmd.buttons & Buttons.MEDI && p.has(ImplantId.Mediplant) && !emped && this.now >= p.mediNextPulse) this.mediPulse(p);

    // Movement.
    this.mover.filter = this.teamFilter(p.team);
    const caps = p.moveCaps(this.now);
    const wasBoosted = p.move.boosted;
    const ev = this.mover.move(p.move, cmd, caps);
    if (ev.jumped) this.sound(ev.boostJump > 0 ? Snd.Boost : Snd.Jump, p.move.origin, p.id);
    if (ev.boostJump > 0) p.energy = Math.max(0, p.energy - p.classDef.boostCost * ev.boostJump);
    if (ev.ledgeGrab) this.sound(Snd.Ledge, p.move.origin, p.id);
    if (p.move.sprinting) p.energy = Math.max(0, p.energy - SPRINT_DRAIN * dt);
    if (ev.landed) {
      const legs = p.has(ImplantId.LegBoosters);
      const dmg = legs ? 0 : fallDamage(ev.landSpeed);
      if (ev.landSpeed > 300) this.sound(Snd.Land, p.move.origin, p.id);
      if (dmg > 0) this.damage(p, dmg, null, Cause.Fall);
    }
    if (p.alive && (wasBoosted || p.move.boosted) && p.move.velocity.z < -50) this.checkGoomba(p);
    if (!p.alive) return;

    // Weapons.
    const wev = stepWeapons(p.weap, cmd, p.t, { canAttack: !p.move.hanging && this.rules.phase !== 2 });
    for (const e of wev) {
      switch (e.kind) {
        case 'fire':
          p.lastFireTime = this.now;
          fireHitscan(this, p, cmd, e);
          break;
        case 'melee':
          p.lastFireTime = this.now;
          doMelee(this, p, cmd, e);
          break;
        case 'throw':
          p.lastFireTime = this.now;
          throwGrenade(this, p, cmd, e);
          break;
        case 'reload':
          this.sound(Snd.Reload, p.move.origin, p.id, { except: p.id });
          break;
        case 'dry':
          this.sound(Snd.Dry, p.move.origin, p.id, { player: p.id });
          break;
        case 'switch':
          break;
      }
    }

    this.useInteract(p, cmd, dt, pressed);
    p.t += dt;
  }

  private checkGoomba(p: ServerPlayer): void {
    const feet = p.move.origin;
    for (const q of this.players.values()) {
      if (q === p || !q.alive || q.team === p.team || q.decked) continue;
      const h = q.move.ducked ? DEFAULT_MOVE.duckHeight : DEFAULT_MOVE.hullHeight;
      const top = q.move.origin.z + h;
      const dx = feet.x - q.move.origin.x;
      const dy = feet.y - q.move.origin.y;
      if (Math.hypot(dx, dy) < 30 && feet.z <= top + 10 && feet.z >= top - 24) {
        this.damage(q, GOOMBA_DAMAGE, p, Cause.Goomba, { dir: v3(0, 0, -1) });
        p.move.velocity.z = 320;
        p.move.boosted = false;
        this.sound(Snd.Punch, q.move.origin, q.id);
        return;
      }
    }
  }

  /** Hold USE: meatspace screens and crack triggers. */
  private useInteract(p: ServerPlayer, cmd: UserCmd, dt: number, pressed: number): void {
    const using = (cmd.buttons & Buttons.USE) !== 0;
    const eye = p.eyePos();
    const fwd = angleVectors(p.pitch, p.yaw).forward;
    let screen: ScreenEnt | null = null;
    if (using) {
      for (const s of this.screens) {
        if (!s.enabled || s.used) continue;
        if (s.stage && s.stage !== this.rules.stage) continue;
        const d = vsub(s.origin, eye);
        const dist = vlen(d);
        if (dist < 110 && vdot(vnorm(d), fwd) > 0.5) {
          screen = s;
          break;
        }
      }
    }
    if (screen && (screen.team === 0 || screen.team === p.team)) {
      if (p.useTarget !== screen.id) p.useProgress = 0;
      p.useTarget = screen.id;
      p.useProgress += dt;
      screen.progress = Math.min(1, p.useProgress / screen.holdTime);
      screen.lastUser = p.id;
      if (p.useProgress >= screen.holdTime) {
        screen.used = true;
        screen.progress = 1;
        p.useProgress = 0;
        this.fireTargets(screen.src.props['target'], str(screen.src, 'action', 'trigger'), p.team);
        const obj = screen.src.props['objective'];
        if (obj) this.completeObjective(obj, p.team);
        p.score += 2;
      }
    } else if (screen) {
      if (pressed & Buttons.USE) this.sound(Snd.Denied, screen.origin, p.id, { player: p.id });
    } else {
      p.useTarget = 0;
      p.useProgress = 0;
    }

    // Meatspace cracking: deck-equipped, standing in the trigger, holding USE.
    p.crackTarget = 0;
    if (using && !screen && p.hasDeck) {
      const hull = hullFor(DEFAULT_MOVE, p.move.ducked);
      for (const c of this.cracks) {
        if (c.done || (c.team && c.team !== p.team) || (c.stage && c.stage !== this.rules.stage)) continue;
        if (!c.contains(p.move.origin, hull.mins, hull.maxs)) continue;
        p.crackTarget = c.id;
        c.cracker = p.id;
        if (this.now >= p.crackPausedUntil) c.progress = Math.min(1, c.progress + dt / c.time);
        if (c.progress >= 1) {
          c.done = true;
          this.fireTargets(c.src.props['target'], str(c.src, 'action', 'open'), p.team);
          this.notice('crack', `${p.name} cracked: ${c.label}`, 0);
          p.score += 2;
        }
        break;
      }
    }
  }

  tacScan(p: ServerPlayer): void {
    if (this.now < p.empUntil || this.now < p.tacReadyAt || p.energy < TAC_COST) {
      this.sound(Snd.Denied, p.move.origin, p.id, { player: p.id });
      return;
    }
    p.energy -= TAC_COST;
    p.tacReadyAt = this.now + TAC_COOLDOWN;
    const pings: { id: number; pos: Vec3 }[] = [];
    for (const q of this.players.values()) {
      if (!q.alive || q.team === p.team) continue;
      if (vdist(q.move.origin, p.move.origin) > TAC_RANGE) continue;
      q.revealedUntil[p.team] = this.now + TAC_DURATION;
      pings.push({ id: q.id, pos: q.move.origin });
    }
    this.emit({ k: EvKind.Tac, team: p.team, pings }, { team: p.team });
    this.sound(Snd.TacPing, p.move.origin, p.id);
  }

  mediPulse(p: ServerPlayer): void {
    p.mediNextPulse = this.now + MEDI_INTERVAL;
    let healed = false;
    for (const q of this.players.values()) {
      if (q === p || !q.alive || q.team !== p.team) continue;
      const max = q.classDef.health;
      if (q.health >= max) continue;
      if (vdist(q.move.origin, p.move.origin) > MEDI_RANGE) continue;
      if (p.energy < MEDI_COST) break;
      const eye = p.eyePos();
      const tr = this.level.collision.trace(eye, q.eyePos(), v3(), v3(), CONTENTS_SOLID);
      if (tr.fraction < 1) continue;
      const amt = Math.min(max - q.health, q.cls === ClassId.Heavy ? MEDI_HEAL_HEAVY : MEDI_HEAL);
      q.health += amt;
      p.energy -= MEDI_COST;
      p.score += amt / 50;
      healed = true;
      this.emit({ k: EvKind.Heal, healer: p.id, target: q.id, amount: Math.round(amt) });
    }
    if (p.health < p.classDef.health) {
      p.health = Math.min(p.classDef.health, p.health + MEDI_SELF);
      healed = true;
    }
    if (healed) this.sound(Snd.Heal, p.move.origin, p.id);
  }

  // ---- tick ----------------------------------------------------------------

  step(): void {
    this.tick++;
    this.now += this.dt;
    const now = this.now;

    // Commands (bots have already queued theirs).
    for (const p of this.players.values()) {
      let n = 0;
      while (p.cmdQueue.length && n < 12) {
        this.processCmd(p, p.cmdQueue.shift()!);
        n++;
      }
    }

    this.thinkPlayers();
    this.thinkDoors();
    thinkTurrets(this);
    this.thinkCameras();
    this.thinkJips();
    thinkProjectiles(this);
    thinkCrystals(this);
    for (const e of this.ents) e.think(this.dt, now);
    for (const s of this.screens) {
      // Screens slowly lose progress when nobody holds them.
      let held = false;
      for (const p of this.players.values()) if (p.useTarget === s.id) held = true;
      if (!held && !s.used) s.progress = Math.max(0, s.progress - this.dt * 0.25);
    }
    this.thinkRules();
    this.recordHistory();
  }

  private thinkPlayers(): void {
    const now = this.now;
    const dt = this.dt;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const emped = now < p.empUntil;
      if (emped) {
        p.stealthOn = false;
        p.thermalOn = false;
      }
      // Energy upkeep.
      let drain = 0;
      if (p.stealthOn) drain += STEALTH_DRAIN;
      if (p.thermalOn) drain += THERMAL_DRAIN;
      if (p.decked) drain += DECK_DRAIN;
      const regen = emped || p.decked || p.move.boostCharge > 0 ? 0 : ENERGY_REGEN;
      p.energy = Math.max(0, Math.min(p.maxEnergy, p.energy + (regen - drain) * dt));
      if (p.energy <= 0) {
        if (p.stealthOn) this.sound(Snd.StealthOff, p.move.origin, p.id);
        p.stealthOn = false;
        p.thermalOn = false;
      }
      // Stealth visibility.
      let target = 1;
      if (p.stealthOn) {
        const speed = Math.hypot(p.move.velocity.x, p.move.velocity.y);
        target = speed < 12 || (p.move.ducked && speed < 90) ? 0 : Math.min(0.55, 0.12 + speed / 900);
        if (now < p.flickerUntil || now - p.lastFireTime < 0.3) target = 0.75;
      }
      p.vis += (target - p.vis) * Math.min(1, dt * (target > p.vis ? 12 : 3));
      // Ammo dispensers.
      for (const a of this.ammo) {
        if (vdist(a, p.move.origin) > 96) continue;
        for (const id of p.weap.owned) {
          const d = WEAPONS[id]!;
          if (d.kind !== 'hitscan') continue;
          const max = d.reserve;
          if ((p.weap.reserve[id] ?? 0) < max) p.weap.reserve[id] = Math.min(max, (p.weap.reserve[id] ?? 0) + max * 0.1 * dt * 2);
        }
      }
      // Hazard zones in meatspace.
      if (!p.decked) {
        for (const z of this.zones) {
          if (z.kind !== 'hurt') continue;
          if (p.move.origin.x >= z.mins.x && p.move.origin.x <= z.maxs.x && p.move.origin.y >= z.mins.y && p.move.origin.y <= z.maxs.y && p.move.origin.z >= z.mins.z - 8 && p.move.origin.z <= z.maxs.z) {
            this.damage(p, z.rate * dt, null, Cause.World);
          }
        }
        // Falling out of the world.
        if (p.move.origin.z < -2000) this.kill(p, null, Cause.Fall, false);
      }
    }
    // Round down reserve ammo floats for the wire.
    for (const p of this.players.values()) for (let i = 0; i < p.weap.reserve.length; i++) p.weap.reserve[i] = Math.floor(p.weap.reserve[i]!);
  }

  private thinkDoors(): void {
    const now = this.now;
    const hullStand = hullFor(DEFAULT_MOVE, false);
    for (const d of this.doors) {
      // Team doors open for nearby team members.
      for (const p of this.players.values()) {
        if (!p.alive || p.decked) continue;
        const c = p.move.origin;
        const m = d.src;
        if (c.x > m.mins.x - 110 && c.x < m.maxs.x + 110 && c.y > m.mins.y - 110 && c.y < m.maxs.y + 110 && c.z > m.mins.z - 90 && c.z < m.maxs.z + 20) {
          d.request(p.team, now);
        }
      }
      if (!d.permanent && d.target > 0 && now > d.holdUntil) d.target = 0;
      const prev = d.pos;
      const step = (d.speed / Math.max(d.distance, 1)) * this.dt;
      let next = d.pos;
      if (d.target > d.pos) next = Math.min(d.target, d.pos + step);
      else if (d.target < d.pos) next = Math.max(d.target, d.pos - step);
      if (next !== prev) {
        // Don't crush players: if the new position overlaps someone, wait.
        const off = d.offsetAt(next);
        let blocked = false;
        for (const p of this.players.values()) {
          if (!p.alive || p.decked) continue;
          const h = p.move.ducked ? hullFor(DEFAULT_MOVE, true) : hullStand;
          if (boxHitsModel(p.move.origin, h.mins, h.maxs, d.model.brushes, off)) {
            blocked = true;
            break;
          }
        }
        if (!blocked) {
          d.pos = next;
          d.model.offset = off;
        }
      }
      d.moving = d.pos !== prev;
    }
  }

  private thinkCameras(): void {
    if (this.tick % 15 !== 0) return;
    for (const c of this.cameras) {
      if (!c.team) continue;
      const fwd = angleVectors(0, c.yaw).forward;
      const cosHalf = Math.cos(((c.fov / 2) * Math.PI) / 180);
      for (const p of this.players.values()) {
        if (!p.alive || p.team === c.team) continue;
        const to = vsub(p.eyePos(), c.origin);
        const dist = vlen(to);
        if (dist > c.range || vdot(vnorm(to), fwd) < cosHalf) continue;
        if (p.stealthOn && p.vis < 0.3) continue;
        const tr = this.level.collision.trace(c.origin, p.eyePos(), v3(), v3(), CONTENTS_SOLID);
        if (tr.fraction < 1) continue;
        p.revealedUntil[c.team] = this.now + 0.6;
      }
    }
  }

  private thinkJips(): void {
    for (const j of this.jips) j.netLock = Math.max(0, j.lockUntil - this.now);
  }

  private thinkRules(): void {
    const r = this.rules;
    const now = this.now;
    if (r.phase === 2) {
      if (now >= r.overAt) this.resetRound();
      return;
    }
    const anyone = [...this.players.values()].some((p) => p.team === Team.Punk || p.team === Team.Corp);
    if (anyone) r.timeLeft = Math.max(0, r.timeLeft - this.dt);
    if (r.timeLeft <= 0) {
      this.endRound(otherTeam(r.attackers));
      return;
    }
    for (const team of [Team.Punk, Team.Corp]) {
      const waiting = [...this.players.values()].filter((p) => p.team === team && !p.alive && p.waitingSpawn);
      if (now < (r.fastSpawnUntil[team] ?? 0)) {
        for (const p of waiting) this.spawnPlayer(p);
        continue;
      }
      if (!waiting.length) {
        r.wave[team] = Math.max((r.wave[team] ?? WAVE_BASE) - this.dt, 0);
        if (r.wave[team]! < WAVE_IDLE) r.wave[team] = WAVE_IDLE;
        continue;
      }
      // Attackers stuck without a capture for a long time spawn faster (down to 1/3).
      const accel = team === r.attackers && now - r.noCaptureSince > 240 ? 3 : 1;
      r.wave[team] = (r.wave[team] ?? WAVE_BASE) - this.dt * accel;
      if (r.wave[team]! <= 0) {
        for (const p of waiting) if (now - p.deathTime > 1.5) this.spawnPlayer(p);
        r.wave[team] = WAVE_BASE;
        this.sound(Snd.Wave, v3(), 0, { team });
      }
    }
  }

  private recordHistory(): void {
    const keep = Math.ceil((MAX_LAG_COMP_MS / 1000) * TICK_RATE) + 4;
    for (const p of this.players.values()) {
      p.history.push({ tick: this.tick, origin: { ...p.move.origin }, ducked: p.move.ducked, alive: p.alive, cyber: p.cyber ? { ...p.cyber.origin } : null });
      if (p.history.length > keep) p.history.shift();
    }
  }

  // ---- snapshots -----------------------------------------------------------

  netPlayer(p: ServerPlayer, forTeam: number): NetPlayer {
    let f = 0;
    const m = p.move;
    if (p.alive) f |= PF.ALIVE;
    if (m.ducked) f |= PF.DUCKED;
    if (m.onGround) f |= PF.ONGROUND;
    if (p.stealthOn) f |= PF.STEALTH;
    if (p.thermalOn) f |= PF.THERMAL;
    if (p.decked) f |= PF.DECKED;
    if (m.hanging) f |= PF.HANGING;
    if (p.weap.reloadEnd > 0) f |= PF.RELOADING;
    if (p.weap.blocking) f |= PF.BLOCKING;
    if (p.weap.zoomed) f |= PF.ZOOMED;
    if (this.now < p.empUntil) f |= PF.EMP;
    if (m.sprinting) f |= PF.SPRINT;
    if (m.boosted) f |= PF.BOOSTED;
    if (m.slideTime > 0) f |= PF.SLIDING;
    if (this.now < (p.revealedUntil[forTeam] ?? 0)) f |= PF.REVEALED;
    if (p.weap.spin > 0.05) f |= PF.SPINNING;
    let cyber: NetPlayer['cyber'] = null;
    if (p.cyber) {
      const lc = p.lastCmd;
      const b = cyberBasis(p.cyber.up, p.cyber.north, lc?.pitch ?? 0, lc?.yaw ?? 0);
      cyber = { origin: p.cyber.origin, up: p.cyber.up, forward: b.forward };
    }
    return {
      id: p.id,
      team: p.team,
      cls: p.cls,
      flags: f,
      origin: m.origin,
      velocity: m.velocity,
      yaw: p.yaw,
      pitch: p.pitch,
      weapon: p.weap.current,
      health: Math.max(0, p.health),
      armor: p.armor,
      energy: p.energy,
      implants: p.implantBits,
      vis: p.vis,
      cyber,
    };
  }

  snapshotFor(viewer: ServerPlayer | null): Snapshot {
    const team = viewer?.team ?? 0;
    const players: NetPlayer[] = [];
    for (const p of this.players.values()) {
      if (p.team !== Team.Punk && p.team !== Team.Corp) continue;
      players.push(this.netPlayer(p, team));
    }
    const ents: NetEnt[] = [];
    for (const e of this.ents) {
      const n = e.net();
      if (!n) continue;
      if (e instanceof IceEnt) {
        // Installed traps are only visible to their owners, or after an ICE Scan.
        const visible = e.trapTeam === team || (e.scannedBy & (1 << team)) !== 0;
        if (!visible) n.a = 0;
        n.value = Math.max(0, e.wedgedUntil - this.now);
      }
      ents.push(n);
    }
    for (const pr of this.projectiles) ents.push(pr.net());
    for (const c of this.crystals) ents.push(c.net());

    let local: Snapshot['local'] = null;
    if (viewer) {
      const r = viewer.program;
      local = {
        id: viewer.id,
        t: viewer.t,
        move: viewer.move,
        weap: viewer.weap,
        cyber: viewer.cyber,
        energy: viewer.energy,
        maxEnergy: viewer.maxEnergy,
        emp: Math.max(0, viewer.empUntil - this.now),
        respawnIn: viewer.alive ? 0 : Math.max(0, this.rules.wave[viewer.team] ?? 0),
        cls: viewer.cls,
        implants: viewer.implantBits,
        nextCls: viewer.nextCls,
        nextImplants: implantMask(viewer.nextImplants),
        cyberMode: viewer.cyberMode,
        hitscanReady: Math.max(0, viewer.nextHitscan - viewer.t),
        program: r ? { program: r.program, target: r.target, progress: r.progress / r.steps, step: Math.floor(r.progress), buttons: r.buttons } : null,
        bodyAlarm: this.now - viewer.bodyDamagedAt,
        crack: viewer.crackTarget ? (this.cracks.find((c) => c.id === viewer.crackTarget)?.progress ?? -1) : -1,
        tacCooldown: Math.max(0, viewer.tacReadyAt - this.now),
      };
    }
    const r = this.rules;
    return {
      tick: this.tick,
      ack: viewer?.lastSeq ?? 0,
      rules: {
        phase: r.phase,
        stage: r.stage,
        stageCount: r.stageCount,
        attackers: r.attackers,
        timeLeft: r.timeLeft,
        wavePunk: r.wave[Team.Punk] ?? 0,
        waveCorp: r.wave[Team.Corp] ?? 0,
        winner: r.winner,
        ff: r.ff,
      },
      local,
      players,
      ents,
      events: [],
    };
  }

  /** Where a player's lag-compensated hitbox was at `viewTick`. */
  historicOrigin(p: ServerPlayer, viewTick: number): { origin: Vec3; ducked: boolean; alive: boolean } {
    const minTick = this.tick - (MAX_LAG_COMP_MS / 1000) * TICK_RATE;
    const t = Math.max(minTick, Math.min(this.tick, viewTick));
    const h = p.history;
    if (!h.length || t >= this.tick) return { origin: p.move.origin, ducked: p.move.ducked, alive: p.alive };
    for (let i = h.length - 1; i > 0; i--) {
      const a = h[i - 1]!;
      const b = h[i]!;
      if (a.tick <= t && b.tick >= t) {
        const f = b.tick === a.tick ? 0 : (t - a.tick) / (b.tick - a.tick);
        return {
          origin: v3(a.origin.x + (b.origin.x - a.origin.x) * f, a.origin.y + (b.origin.y - a.origin.y) * f, a.origin.z + (b.origin.z - a.origin.z) * f),
          ducked: f < 0.5 ? a.ducked : b.ducked,
          alive: a.alive && b.alive,
        };
      }
    }
    const first = h[0]!;
    return { origin: first.origin, ducked: first.ducked, alive: first.alive };
  }

  /** Find a cyber spawn point by name. */
  cyberSpawn(name: string): { origin: Vec3; angle: number; up: Vec3 } | null {
    const list = this.cyberSpawns.get(name);
    if (!list || !list.length) return null;
    const le = list[Math.floor(Math.random() * list.length)]!;
    return { origin: le.origin, angle: le.angle, up: vnorm(parseVec(le.props['up'], v3(0, 0, 1))) };
  }

  allocId(): number {
    const id = this.nextDynId++;
    if (this.nextDynId > 60000) this.nextDynId = 20000;
    return id;
  }

  playerLoadoutDefault(p: ServerPlayer, cls: ClassId): void {
    p.nextCls = cls;
    p.nextImplants = [...DEFAULT_LOADOUTS[cls]!];
  }
}

function boxHitsModel(p: Vec3, mins: Vec3, maxs: Vec3, brushes: import('@d2/shared').Brush[], offset: Vec3): boolean {
  for (const b of brushes) {
    const lp = vsub(p, offset);
    let inside = true;
    for (const pl of b.planes) {
      const n = pl.normal;
      const ox = n.x < 0 ? maxs.x : mins.x;
      const oy = n.y < 0 ? maxs.y : mins.y;
      const oz = n.z < 0 ? maxs.z : mins.z;
      const dist = pl.dist - (ox * n.x + oy * n.y + oz * n.z);
      if (vdot(lp, n) - dist > -0.5) {
        inside = false;
        break;
      }
    }
    if (inside) return true;
  }
  return false;
}

