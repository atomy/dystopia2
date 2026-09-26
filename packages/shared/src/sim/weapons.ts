// Weapon state machine shared by server and client prediction: selection,
// refire timing, ammo, reloads, minigun spin, AR heat/burst, grenade cooking,
// katana block. Hit detection happens on the server from the emitted events.

import { WEAPONS, WeaponId, GRENADE_FUSE, MINIGUN_SPINUP, type WeaponDef } from '../game/defs.js';
import { Buttons, type UserCmd } from './pmove.js';

export const WEAPON_COUNT = 9;
export const SWITCH_TIME = 0.35;

export interface WeaponState {
  owned: WeaponId[];
  current: WeaponId;
  previous: WeaponId;
  /** Time the current switch completes (seconds, player time). */
  switchDone: number;
  nextAttack: number;
  clip: number[];
  reserve: number[];
  /** Reload completion time, 0 = not reloading. */
  reloadEnd: number;
  /** Minigun spin 0..1. */
  spin: number;
  /** Assault rifle heat 0..1 (rate of fire ramps up, spread grows). */
  heat: number;
  /** Remaining shots in an AR burst. */
  burstLeft: number;
  /** Grenade cook start time, 0 = not cooking. */
  cookStart: number;
  blocking: boolean;
  zoomed: boolean;
  attackHeld: boolean;
}

export type WeaponEvent =
  | { kind: 'fire'; weapon: WeaponId; alt: boolean; pellets: number; spread: number; damage: number; seed: number }
  | { kind: 'melee'; weapon: WeaponId; dir: -1 | 0 | 1 }
  | { kind: 'throw'; weapon: WeaponId; cook: number }
  | { kind: 'reload'; weapon: WeaponId }
  | { kind: 'switch'; weapon: WeaponId }
  | { kind: 'dry'; weapon: WeaponId };

export function newWeaponState(owned: WeaponId[], grenades: number): WeaponState {
  const clip = new Array<number>(WEAPON_COUNT).fill(0);
  const reserve = new Array<number>(WEAPON_COUNT).fill(0);
  for (const id of owned) {
    const d = WEAPONS[id]!;
    if (d.kind === 'grenade') clip[id] = grenades;
    else {
      clip[id] = d.magazine;
      reserve[id] = d.reserve;
    }
  }
  return {
    owned: [...owned],
    current: owned[0] ?? WeaponId.None,
    previous: owned[1] ?? WeaponId.None,
    switchDone: 0,
    nextAttack: 0,
    clip,
    reserve,
    reloadEnd: 0,
    spin: 0,
    heat: 0,
    burstLeft: 0,
    cookStart: 0,
    blocking: false,
    zoomed: false,
    attackHeld: false,
  };
}

export const cloneWeaponState = (w: WeaponState): WeaponState => ({
  ...w,
  owned: [...w.owned],
  clip: [...w.clip],
  reserve: [...w.reserve],
});

function select(w: WeaponState, id: WeaponId, t: number, ev: WeaponEvent[]): void {
  if (id === w.current || !w.owned.includes(id)) return;
  const d = WEAPONS[id]!;
  if (d.kind === 'grenade' && (w.clip[id] ?? 0) <= 0) return;
  w.previous = w.current;
  w.current = id;
  w.switchDone = t + SWITCH_TIME;
  w.nextAttack = Math.max(w.nextAttack, w.switchDone);
  w.reloadEnd = 0;
  w.burstLeft = 0;
  w.cookStart = 0;
  w.blocking = false;
  w.zoomed = false;
  ev.push({ kind: 'switch', weapon: id });
}

function startReload(w: WeaponState, d: WeaponDef, t: number, ev: WeaponEvent[]): void {
  if (w.reloadEnd > 0 || d.magazine <= 0) return;
  if ((w.clip[d.id] ?? 0) >= d.magazine || (w.reserve[d.id] ?? 0) <= 0) return;
  w.reloadEnd = t + d.reloadTime;
  w.burstLeft = 0;
  ev.push({ kind: 'reload', weapon: d.id });
}

export interface WeaponCtx {
  /** False while jacked in, dead, or hanging from a ledge. */
  canAttack: boolean;
  /** Reload-speed multiplier (1 = normal). */
  reloadScale?: number;
}

/**
 * Advance weapons for one command. `t` is the player time at the start of the
 * command in seconds. Returns events for effects and server-side hit tests.
 */
export function stepWeapons(w: WeaponState, cmd: UserCmd, t: number, ctx: WeaponCtx): WeaponEvent[] {
  const ev: WeaponEvent[] = [];
  const dt = Math.min(Math.max(cmd.msec, 0), 50) / 1000;
  const end = t + dt;
  const attack = (cmd.buttons & Buttons.ATTACK) !== 0 && ctx.canAttack;
  const attack2 = (cmd.buttons & Buttons.ATTACK2) !== 0 && ctx.canAttack;

  // Slot selection: 1 primary, 2 sidearm, 3 melee, 4 grenade.
  if (cmd.weapon >= 1 && cmd.weapon <= 4 && w.cookStart === 0) {
    const want = w.owned.find((id) => WEAPONS[id]!.slot === cmd.weapon);
    if (want !== undefined) select(w, want, t, ev);
  }

  const d = WEAPONS[w.current];
  if (!d) return ev;
  const cur = d.id;

  // Heat decays, minigun spin follows the triggers.
  w.heat = Math.max(0, w.heat - dt * (attack ? 0.15 : 1.4));
  if (cur === WeaponId.Minigun) {
    const spinning = (attack || attack2) && end >= w.switchDone && w.reloadEnd === 0;
    w.spin = spinning ? Math.min(1, w.spin + dt / MINIGUN_SPINUP) : Math.max(0, w.spin - dt / (MINIGUN_SPINUP * 0.8));
  } else w.spin = 0;

  // Reload completion.
  if (w.reloadEnd > 0 && end >= w.reloadEnd) {
    const need = d.magazine - (w.clip[cur] ?? 0);
    const take = Math.min(d.reloadSingle ? 1 : need, w.reserve[cur] ?? 0);
    w.clip[cur] = (w.clip[cur] ?? 0) + take;
    w.reserve[cur] = (w.reserve[cur] ?? 0) - take;
    w.reloadEnd = 0;
    // Shotguns keep loading shell by shell unless the trigger is pulled.
    if (d.reloadSingle && !attack && (w.clip[cur] ?? 0) < d.magazine && (w.reserve[cur] ?? 0) > 0) {
      w.reloadEnd = end + d.reloadTime * (ctx.reloadScale ?? 1);
    }
  }
  if (d.reloadSingle && w.reloadEnd > 0 && attack && (w.clip[cur] ?? 0) > 0) w.reloadEnd = 0;

  if ((cmd.buttons & Buttons.RELOAD) !== 0 && d.kind === 'hitscan') startReload(w, d, t, ev);

  w.zoomed = cur === WeaponId.AssaultRifle && attack2 && w.reloadEnd === 0;
  w.blocking = cur === WeaponId.Katana && attack2;

  const ready = end >= w.nextAttack && end >= w.switchDone && w.reloadEnd === 0;

  switch (d.kind) {
    case 'hitscan': {
      // AR zoomed burst continues on its own once started.
      const wantFire = attack || w.burstLeft > 0;
      if (!ready || !wantFire) break;
      if (cur === WeaponId.Minigun && w.spin < 1) break;
      if ((w.clip[cur] ?? 0) <= 0) {
        if ((w.reserve[cur] ?? 0) > 0) startReload(w, d, t, ev);
        else if (!w.attackHeld) ev.push({ kind: 'dry', weapon: cur });
        break;
      }
      let pellets = d.pellets;
      let spread = d.spread;
      let refire = d.refire;
      let alt = false;
      if (cur === WeaponId.Shotgun && attack2 && (w.clip[cur] ?? 0) >= 2) {
        pellets = d.pellets * 2;
        spread = d.spread * 2;
        refire = d.refire * 2;
        w.clip[cur]! -= 2;
        alt = true;
      } else if (cur === WeaponId.AssaultRifle) {
        if (w.zoomed || w.burstLeft > 0) {
          if (w.burstLeft === 0) w.burstLeft = 3;
          w.burstLeft--;
          spread = 0;
          refire = w.burstLeft > 0 ? 0.07 : 0.45;
          alt = true;
        } else {
          refire = 1 / (7 + 6 * w.heat);
          spread = d.spread * (1 + 2.5 * w.heat);
          w.heat = Math.min(1, w.heat + 0.08);
        }
        w.clip[cur]! -= 1;
      } else {
        w.clip[cur]! -= 1;
      }
      w.nextAttack = Math.max(w.nextAttack, t) + refire;
      if (w.nextAttack < end) w.nextAttack = end + refire * 0.5;
      ev.push({ kind: 'fire', weapon: cur, alt, pellets, spread, damage: d.damage, seed: (cmd.seq * 2654435761) >>> 0 });
      if ((w.clip[cur] ?? 0) <= 0 && (w.reserve[cur] ?? 0) > 0) startReload(w, d, end, ev);
      break;
    }
    case 'melee': {
      if (!ready || !attack || w.blocking) break;
      w.nextAttack = end + d.refire;
      const dir = cmd.side < -0.3 ? -1 : cmd.side > 0.3 ? 1 : 0;
      ev.push({ kind: 'melee', weapon: cur, dir });
      break;
    }
    case 'grenade': {
      if ((w.clip[cur] ?? 0) <= 0) break;
      if (attack && w.cookStart === 0 && ready) w.cookStart = t > 0 ? t : 1e-3;
      const cooking = w.cookStart > 0;
      const cook = cooking ? end - w.cookStart : 0;
      if (cooking && (!attack || cook >= GRENADE_FUSE)) {
        w.clip[cur]! -= 1;
        ev.push({ kind: 'throw', weapon: cur, cook: Math.min(cook, GRENADE_FUSE) });
        w.cookStart = 0;
        w.nextAttack = end + d.refire;
        if ((w.clip[cur] ?? 0) <= 0) {
          const back = w.owned.includes(w.previous) ? w.previous : w.owned[0]!;
          select(w, back, end, ev);
        }
      }
      break;
    }
  }
  w.attackHeld = attack;
  return ev;
}

/** Deterministic pellet direction offsets (degrees) for a shot, identical on client and server. */
export function spreadOffsets(seed: number, pellets: number, spread: number): { yaw: number; pitch: number }[] {
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const out: { yaw: number; pitch: number }[] = [];
  for (let i = 0; i < pellets; i++) {
    // Uniform in a disc of radius `spread` degrees.
    const r = spread * Math.sqrt(rnd());
    const a = rnd() * Math.PI * 2;
    out.push({ yaw: r * Math.cos(a), pitch: r * Math.sin(a) });
  }
  return out;
}
