import {
  type Vec3,
  type UserCmd,
  type PlayerMoveState,
  type WeaponState,
  type CyberMoveState,
  type MoveCaps,
  moveCapsFor,
  newMoveState,
  newWeaponState,
  v3,
  vcopy,
  CLASSES,
  ClassId,
  ImplantId,
  DEFAULT_LOADOUTS,
  implantMask,
  hasImplant,
  weaponsFor,
  ENERGY_MAX,
  ENERGY_SCS_BONUS,
  DEFAULT_MOVE,
  Team,
} from '@d2/shared';
import type { JipEnt } from './entities.js';

export interface HistoryEntry {
  tick: number;
  origin: Vec3;
  ducked: boolean;
  alive: boolean;
  cyber: Vec3 | null;
}

export interface RunningProgram {
  program: number;
  /** Entity id of the node screen or ICE it targets. */
  target: number;
  /** Progress in steps (0..steps). */
  progress: number;
  steps: number;
  /** Minigame: shuffled button labels (step indices) and the expected index. */
  buttons: number[];
  energySpent: number;
}

export class ServerPlayer {
  name: string;
  team = Team.Spectator as number;
  bot = false;
  ping = 0;

  cls: ClassId = ClassId.Medium;
  implants: ImplantId[] = [];
  implantBits = 0;
  nextCls: ClassId = ClassId.Medium;
  nextImplants: ImplantId[] = DEFAULT_LOADOUTS[ClassId.Medium]!;

  alive = false;
  health = 0;
  armor = 0;
  energy = ENERGY_MAX;
  maxEnergy = ENERGY_MAX;

  move: PlayerMoveState = newMoveState(v3());
  weap: WeaponState = newWeaponState([], 0);
  /** Player simulation time in seconds (advances with command msec). */
  t = 0;
  pitch = 0;
  yaw = 0;
  lastCmd: UserCmd | null = null;
  cmdQueue: UserCmd[] = [];
  lastSeq = 0;
  prevButtons = 0;

  // Implants
  stealthOn = false;
  thermalOn = false;
  vis = 1;
  flickerUntil = 0;
  empUntil = 0;
  tacReadyAt = 0;
  mediNextPulse = 0;
  /** Revealed to the given team until time (index by team). */
  revealedUntil: number[] = [0, 0, 0, 0];

  // Cyberspace
  cyber: CyberMoveState | null = null;
  jip: JipEnt | null = null;
  cyberMode = 0;
  nextHitscan = 0;
  nextProj = 0;
  shafting = false;
  /** Energy lost to enemy fire during the current dive (crystal value). */
  cyberDamageTaken = 0;
  program: RunningProgram | null = null;
  hackTarget = 0;
  bodyDamagedAt = -1e9;
  lastBodyAlarm = -1e9;
  lastCyberAttacker = 0;
  greenEjectAt = 0;
  lastShaftFx = 0;

  // Meatspace objective interaction
  useProgress = 0;
  useTarget = 0;
  crackTarget = 0;
  crackPausedUntil = 0;

  // Rules / score
  deathTime = 0;
  waitingSpawn = false;
  spawnTime = 0;
  score = 0;
  kills = 0;
  deaths = 0;
  lastAttacker = 0;
  lastAttackTime = 0;
  lastFireTime = -10;
  lastDamageTime = -10;

  history: HistoryEntry[] = [];

  constructor(
    readonly id: number,
    name: string,
  ) {
    this.name = name;
  }

  get classDef() {
    return CLASSES[this.cls]!;
  }

  has(id: ImplantId): boolean {
    return hasImplant(this.implantBits, id);
  }

  get hasDeck(): boolean {
    return this.has(ImplantId.Cyberdeck) || this.has(ImplantId.EnhancedDeck);
  }

  get decked(): boolean {
    return this.cyber !== null;
  }

  get emped(): boolean {
    return this.t < 0 ? false : this.empUntil > 0;
  }

  eyePos(): Vec3 {
    const eh = this.move.ducked ? DEFAULT_MOVE.duckEyeHeight : DEFAULT_MOVE.eyeHeight;
    return v3(this.move.origin.x, this.move.origin.y, this.move.origin.z + eh);
  }

  /** Apply the pending loadout and reset for a fresh life at `origin`. */
  spawn(origin: Vec3, yaw: number): void {
    this.cls = this.nextCls;
    this.implants = [...this.nextImplants];
    this.implantBits = implantMask(this.implants);
    const c = this.classDef;
    this.alive = true;
    this.health = c.health;
    this.armor = c.armor;
    this.maxEnergy = ENERGY_MAX + (this.has(ImplantId.Scs) ? ENERGY_SCS_BONUS : 0);
    this.energy = this.maxEnergy;
    this.move = newMoveState(vcopy(origin));
    this.weap = newWeaponState(weaponsFor(this.cls), c.grenadeCount);
    this.yaw = yaw;
    this.pitch = 0;
    this.stealthOn = false;
    this.thermalOn = false;
    this.vis = 1;
    this.empUntil = 0;
    this.cyber = null;
    this.jip = null;
    this.program = null;
    this.cyberDamageTaken = 0;
    this.useProgress = 0;
    this.useTarget = 0;
    this.crackTarget = 0;
    this.waitingSpawn = false;
    this.history.length = 0;
  }

  moveCaps(now: number): MoveCaps {
    return moveCapsFor(this.cls, this.implantBits, this.energy, now < this.empUntil, this.weap);
  }

}
