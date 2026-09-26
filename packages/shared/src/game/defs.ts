// Static game data: teams, classes, weapons, implants, programs.
// Numbers follow docs/DESIGN.md (faithful to Dystopia v1.2 with 1.4 QoL).

export enum Team {
  None = 0,
  Punk = 1,
  Corp = 2,
  Spectator = 3,
}

export const TEAM_NAMES: Record<number, string> = { 0: 'None', 1: 'Punks', 2: 'Corps', 3: 'Spectators' };
export const TEAM_COLORS: Record<number, string> = { 0: '#bbbbbb', 1: '#ff3b6b', 2: '#2fb6ff', 3: '#888888' };
export const otherTeam = (t: number): number => (t === Team.Punk ? Team.Corp : t === Team.Corp ? Team.Punk : Team.None);

export enum ClassId {
  Light = 0,
  Medium = 1,
  Heavy = 2,
}

export enum WeaponId {
  None = 0,
  MachinePistol = 1,
  Shotgun = 2,
  AssaultRifle = 3,
  Minigun = 4,
  Katana = 5,
  Fist = 6,
  EmpGrenade = 7,
  FragGrenade = 8,
}

export enum ImplantId {
  Cyberdeck = 0,
  EnhancedDeck = 1,
  TacScan = 2,
  Thermal = 3,
  Stealth = 4,
  LegBoosters = 5,
  Mediplant = 6,
  Scs = 7,
}

export enum ProgramId {
  PasswordProtect = 0,
  Encryption = 1,
  IceBarrier = 2,
  IceAlarm = 3,
  IceMine = 4,
  GreenIce = 5,
  PasswordCracker = 6,
  Decryptor = 7,
  Wedge = 8,
  IceBreaker = 9,
  IceScan = 10,
}

export interface ClassDef {
  id: ClassId;
  name: string;
  health: number;
  armor: number;
  headSlots: number;
  bodySlots: number;
  speed: number;
  sprintSpeed: number;
  respawnPenalty: number;
  canDeck: boolean;
  canStealth: boolean;
  canLedgeGrab: boolean;
  /** Jump height in units. */
  jumpHeight: number;
  /** Hitbox scale relative to the movement hull. */
  hitScale: number;
  primaries: WeaponId[];
  melee: WeaponId;
  grenade: WeaponId;
  grenadeCount: number;
  /** Energy cost of a full leg-boost jump. */
  boostCost: number;
}

export const CLASSES: ClassDef[] = [
  {
    id: ClassId.Light,
    name: 'Light',
    health: 75,
    armor: 25,
    headSlots: 5,
    bodySlots: 7,
    speed: 250,
    sprintSpeed: 312,
    respawnPenalty: 3,
    canDeck: true,
    canStealth: true,
    canLedgeGrab: true,
    jumpHeight: 45,
    hitScale: 0.9,
    primaries: [WeaponId.Shotgun],
    melee: WeaponId.Katana,
    grenade: WeaponId.EmpGrenade,
    grenadeCount: 3,
    boostCost: 15,
  },
  {
    id: ClassId.Medium,
    name: 'Medium',
    health: 100,
    armor: 50,
    headSlots: 4,
    bodySlots: 4,
    speed: 200,
    sprintSpeed: 250,
    respawnPenalty: 4,
    canDeck: true,
    canStealth: false,
    canLedgeGrab: true,
    jumpHeight: 48,
    hitScale: 1,
    primaries: [WeaponId.AssaultRifle],
    melee: WeaponId.Katana,
    grenade: WeaponId.FragGrenade,
    grenadeCount: 2,
    boostCost: 20,
  },
  {
    id: ClassId.Heavy,
    name: 'Heavy',
    health: 140,
    armor: 100,
    headSlots: 2,
    bodySlots: 2,
    speed: 160,
    sprintSpeed: 200,
    respawnPenalty: 6,
    canDeck: false,
    canStealth: false,
    canLedgeGrab: false,
    jumpHeight: 56,
    hitScale: 1.12,
    primaries: [WeaponId.Minigun],
    melee: WeaponId.Fist,
    grenade: WeaponId.None,
    grenadeCount: 0,
    boostCost: 30,
  },
];

export interface ImplantDef {
  id: ImplantId;
  name: string;
  short: string;
  slot: 'head' | 'body';
  cost: number;
  classes: ClassId[];
  /** Fixed key binding label; never changes with loadout. */
  key: string;
  desc: string;
}

export const IMPLANTS: ImplantDef[] = [
  { id: ImplantId.Cyberdeck, name: 'Cyberdeck', short: 'DECK', slot: 'head', cost: 2, classes: [0, 1], key: 'F', desc: 'Jack into cyberspace at a Jack-In Point. Basic program set.' },
  { id: ImplantId.EnhancedDeck, name: 'Enhanced Cyberdeck', short: 'EDECK', slot: 'head', cost: 3, classes: [0, 1], key: 'F', desc: 'All 11 programs and the speed-up minigame.' },
  { id: ImplantId.TacScan, name: 'TAC Scanner', short: 'TAC', slot: 'head', cost: 3, classes: [0, 1], key: 'Q', desc: 'Pings all players within 2048u for your whole team. 15 energy.' },
  { id: ImplantId.Thermal, name: 'Thermal Vision', short: 'THRM', slot: 'head', cost: 2, classes: [0, 1, 2], key: 'T', desc: 'Heat vision: reveals stealthed players. 1 energy/s.' },
  { id: ImplantId.Stealth, name: 'Stealth Suit', short: 'STLH', slot: 'body', cost: 5, classes: [0], key: 'C', desc: 'Near-invisibility; total when still. 1 energy/s. Light only.' },
  { id: ImplantId.LegBoosters, name: 'Leg Boosters', short: 'LEGS', slot: 'body', cost: 2, classes: [0, 1, 2], key: 'SHIFT', desc: 'Sprint, charged boost jump, no fall damage, goomba stomp.' },
  { id: ImplantId.Mediplant, name: 'Mediplant', short: 'MED', slot: 'body', cost: 3, classes: [0, 1], key: 'G', desc: 'Area heal: teammates 16 HP for 8 energy; self 4 HP.' },
  { id: ImplantId.Scs, name: 'SCS', short: 'SCS', slot: 'body', cost: 1, classes: [0, 1, 2], key: '-', desc: '+25 max energy. Your life pool in cyberspace.' },
];

export function validateLoadout(cls: ClassId, implants: ImplantId[]): string | null {
  const c = CLASSES[cls];
  if (!c) return 'bad class';
  let head = 0;
  let body = 0;
  const seen = new Set<number>();
  for (const id of implants) {
    const d = IMPLANTS[id];
    if (!d) return 'bad implant';
    if (seen.has(id)) return 'duplicate implant';
    seen.add(id);
    if (!d.classes.includes(cls)) return `${d.name} not available for ${c.name}`;
    if (d.slot === 'head') head += d.cost;
    else body += d.cost;
  }
  if (seen.has(ImplantId.Cyberdeck) && seen.has(ImplantId.EnhancedDeck)) return 'only one cyberdeck';
  if (seen.has(ImplantId.Stealth) && seen.has(ImplantId.Mediplant)) return 'Stealth cannot be combined with Mediplant';
  if (head > c.headSlots) return 'not enough head slots';
  if (body > c.bodySlots) return 'not enough body slots';
  return null;
}

export const DEFAULT_LOADOUTS: Record<number, ImplantId[]> = {
  [ClassId.Light]: [ImplantId.EnhancedDeck, ImplantId.Thermal, ImplantId.Stealth, ImplantId.Scs],
  [ClassId.Medium]: [ImplantId.TacScan, ImplantId.Mediplant, ImplantId.Scs],
  [ClassId.Heavy]: [ImplantId.Thermal, ImplantId.LegBoosters],
};

export const hasImplant = (mask: number, id: ImplantId): boolean => (mask & (1 << id)) !== 0;
export const implantMask = (ids: ImplantId[]): number => ids.reduce((m, id) => m | (1 << id), 0);

// ---------------------------------------------------------------------------
// Weapons

export type WeaponKind = 'hitscan' | 'melee' | 'grenade';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  slot: number; // 1 primary, 2 sidearm, 3 melee, 4 grenade
  kind: WeaponKind;
  damage: number;
  pellets: number;
  /** Cone half-angle in degrees. */
  spread: number;
  /** Seconds between shots. */
  refire: number;
  magazine: number;
  reserve: number;
  reloadTime: number;
  /** Shotgun-style reload: one shell per `reloadTime`. */
  reloadSingle?: boolean;
  range: number;
  headshotMult: number;
  explosive?: boolean;
}

export const WEAPONS: Record<number, WeaponDef> = {
  [WeaponId.MachinePistol]: { id: WeaponId.MachinePistol, name: 'Machine Pistol', slot: 2, kind: 'hitscan', damage: 10, pellets: 1, spread: 3, refire: 0.1, magazine: 24, reserve: 96, reloadTime: 1.6, range: 4096, headshotMult: 1 },
  [WeaponId.Shotgun]: { id: WeaponId.Shotgun, name: 'Shotgun', slot: 1, kind: 'hitscan', damage: 8, pellets: 7, spread: 5, refire: 0.4, magazine: 6, reserve: 30, reloadTime: 0.45, reloadSingle: true, range: 2048, headshotMult: 1 },
  [WeaponId.AssaultRifle]: { id: WeaponId.AssaultRifle, name: 'Assault Rifle', slot: 1, kind: 'hitscan', damage: 15, pellets: 1, spread: 1.2, refire: 1 / 7, magazine: 40, reserve: 160, reloadTime: 3.0, range: 8192, headshotMult: 1.5 },
  [WeaponId.Minigun]: { id: WeaponId.Minigun, name: 'Minigun', slot: 1, kind: 'hitscan', damage: 12, pellets: 3, spread: 3.5, refire: 0.1, magazine: 100, reserve: 300, reloadTime: 4.0, range: 4096, headshotMult: 1 },
  [WeaponId.Katana]: { id: WeaponId.Katana, name: 'Katana', slot: 3, kind: 'melee', damage: 60, pellets: 1, spread: 0, refire: 0.7, magazine: 0, reserve: 0, reloadTime: 0, range: 72, headshotMult: 1 },
  [WeaponId.Fist]: { id: WeaponId.Fist, name: 'Fatman Fist', slot: 3, kind: 'melee', damage: 120, pellets: 1, spread: 0, refire: 1.1, magazine: 0, reserve: 0, reloadTime: 0, range: 80, headshotMult: 1 },
  [WeaponId.EmpGrenade]: { id: WeaponId.EmpGrenade, name: 'EMP Grenade', slot: 4, kind: 'grenade', damage: 35, pellets: 1, spread: 0, refire: 1.0, magazine: 0, reserve: 0, reloadTime: 0, range: 0, headshotMult: 1, explosive: true },
  [WeaponId.FragGrenade]: { id: WeaponId.FragGrenade, name: 'Frag Grenade', slot: 4, kind: 'grenade', damage: 105, pellets: 1, spread: 0, refire: 1.0, magazine: 0, reserve: 0, reloadTime: 0, range: 0, headshotMult: 1, explosive: true },
};

export const MEDIUM_KATANA_DAMAGE = 75;
export const GRENADE_FUSE = 2.5;
export const FRAG_RADIUS = 300;
export const EMP_RADIUS = 320;
export const MINIGUN_SPINUP = 1.2;

export function weaponsFor(cls: ClassId): WeaponId[] {
  const c = CLASSES[cls]!;
  const list = [...c.primaries, WeaponId.MachinePistol, c.melee];
  if (c.grenade !== WeaponId.None) list.push(c.grenade);
  return list;
}

// ---------------------------------------------------------------------------
// Energy / implants tuning

export const ENERGY_MAX = 50;
export const ENERGY_SCS_BONUS = 25;
export const ENERGY_REGEN = 2;
export const DECK_DRAIN = 0.25;
export const JACKIN_MIN_ENERGY = 15;
export const STEALTH_DRAIN = 1;
export const THERMAL_DRAIN = 1;
export const SPRINT_DRAIN = 1.25;
export const TAC_COST = 15;
export const TAC_RANGE = 2048;
export const TAC_DURATION = 4;
export const TAC_COOLDOWN = 2;
export const MEDI_RANGE = 384;
export const MEDI_COST = 8;
export const MEDI_HEAL = 16;
export const MEDI_HEAL_HEAVY = 24;
export const MEDI_SELF = 4;
export const MEDI_INTERVAL = 1;
export const DUMPSHOCK_DAMAGE = 20;
export const JIP_LOCK_SECONDS = 10;
export const EMP_MIN_SECONDS = 5;
export const EMP_MAX_SECONDS = 20;
export const ARMOR_ABSORB = 0.8;
export const FALL_DAMAGE_SPEED = 580;
export const GOOMBA_DAMAGE = 150;

// ---------------------------------------------------------------------------
// Cyberspace

export enum CyberWeapon {
  Hitscan = 0,
  Shaft = 1,
}

export const CYBER = {
  hitscanDamage: 15,
  hitscanCost: 2,
  hitscanRecharge: 2,
  hitscanHull: 16,
  shaftDps: 20,
  shaftCostPerSec: 6,
  shaftRange: 384,
  projDamage: 20,
  projSplash: 20,
  projRadius: 256,
  projCost: 3,
  projRefire: 1,
  projSpeed: 1400,
  projKnockback: 520,
  crystalDecay: 30,
  trailSeconds: 3,
} as const;

export interface ProgramDef {
  id: ProgramId;
  name: string;
  kind: 'defence' | 'offence';
  target: 'screen' | 'doorway' | 'ice';
  enhanced: boolean;
  /** Minigame sub-step labels; length = step count. */
  steps: string[];
  desc: string;
}

export const PROGRAM_STEP_TIME = 0.9;
export const PROGRAM_STEP_COST = 2;

export const PROGRAMS: ProgramDef[] = [
  { id: ProgramId.PasswordProtect, name: 'Password Protect', kind: 'defence', target: 'screen', enhanced: false, steps: ['Hash Seed', 'Salt', 'Commit'], desc: 'Weak lock on a screen. Beaten by Password Cracker.' },
  { id: ProgramId.Encryption, name: 'Encryption', kind: 'defence', target: 'screen', enhanced: true, steps: ['Packet Encapsulator', 'Key Escrow', 'Integer Library', 'Skipjack', 'Blowfish'], desc: 'Strong lock on a screen. Beaten by Decryptor.' },
  { id: ProgramId.IceBarrier, name: 'ICE Barrier', kind: 'defence', target: 'doorway', enhanced: true, steps: ['Allocate', 'Lattice', 'Harden', 'Polarize', 'Anchor', 'Seal'], desc: 'Seal a node doorway for your team only.' },
  { id: ProgramId.IceAlarm, name: 'ICE Alarm', kind: 'defence', target: 'ice', enhanced: false, steps: ['Tap', 'Tripwire', 'Relay', 'Beacon', 'Mask', 'Arm'], desc: 'Alerts your deckers when this ICE is bypassed.' },
  { id: ProgramId.IceMine, name: 'ICE Mine', kind: 'defence', target: 'ice', enhanced: true, steps: ['Payload', 'Seeker', 'Fuse', 'Cloak', 'Trigger', 'Link', 'Arm'], desc: 'Homing mine launches when the ICE is wedged. 50 energy damage.' },
  { id: ProgramId.GreenIce, name: 'Green ICE', kind: 'defence', target: 'ice', enhanced: true, steps: ['Stasis', 'Coil', 'Snare', 'Pulse', 'Eject', 'Arm'], desc: 'Stuns and ejects intruders who touch or break the ICE.' },
  { id: ProgramId.PasswordCracker, name: 'Password Cracker', kind: 'offence', target: 'screen', enhanced: false, steps: ['Dictionary', 'Brute'], desc: 'Removes Password Protect.' },
  { id: ProgramId.Decryptor, name: 'Decryptor', kind: 'offence', target: 'screen', enhanced: false, steps: ['Sniff', 'Factor', 'Rekey', 'Unwrap'], desc: 'Removes Encryption.' },
  { id: ProgramId.Wedge, name: 'Wedge', kind: 'offence', target: 'ice', enhanced: false, steps: ['Pry', 'Hold'], desc: 'Opens ICE for 5 seconds. Triggers ICE Mines.' },
  { id: ProgramId.IceBreaker, name: 'ICE Breaker', kind: 'offence', target: 'ice', enhanced: true, steps: ['Probe', 'Fracture', 'Shatter', 'Purge', 'Flush'], desc: 'Permanently removes ICE. Trips Alarms and Green ICE.' },
  { id: ProgramId.IceScan, name: 'ICE Scan', kind: 'offence', target: 'ice', enhanced: false, steps: ['Sweep', 'Report'], desc: 'Reveals Mines/Alarms; safely deletes Green ICE.' },
];

export const WEDGE_SECONDS = 5;
export const ICE_MINE_DAMAGE = 50;
export const GREEN_ICE_STUN = 1.5;

// ---------------------------------------------------------------------------
// Rules

export const WAVE_BASE = 15;
export const WAVE_CAP = 18;
export const WAVE_IDLE = 5;
export const DEFENDER_FASTSPAWN_SECONDS = 5;
export const STAGE_TIME_BONUS = 180;

/** Every distinct program step label; minigame buttons index into this list. */
export const STEP_LABELS: string[] = [...new Set(PROGRAMS.flatMap((p) => p.steps))];
export const NODE_HACK_TIME = 2;
export const PROGRAM_RANGE = 150;
