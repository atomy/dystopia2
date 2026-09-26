// Source-engine style player movement (gamemovement.cpp, simplified) plus the
// Dystopia extras: leg-boost sprint and charged boost jumps, ledge grab,
// crouch slide. Shared verbatim between server (authoritative) and client
// (prediction), so it must be deterministic: no Math.random, no wall clock.

import { type Vec3, v3, vcopy, vdot, vscale, vma, vadd, vsub, vlen, vlen2d, vnorm, angleVectors } from '../math.js';
import { type CollisionWorld, type ModelFilter } from '../map/collision.js';
import { CONTENTS_SOLID, CONTENTS_PLAYERCLIP } from '../map/brush.js';

export const MASK_PLAYERSOLID = CONTENTS_SOLID | CONTENTS_PLAYERCLIP;

export const Buttons = {
  ATTACK: 1 << 0,
  ATTACK2: 1 << 1,
  JUMP: 1 << 2,
  DUCK: 1 << 3,
  USE: 1 << 4,
  RELOAD: 1 << 5,
  WALK: 1 << 6,
  SPRINT: 1 << 7,
  BOOST: 1 << 8,
  /** F: jack in / out. */
  DECK: 1 << 9,
  /** Q: TAC scan. */
  TAC: 1 << 10,
  /** T: thermal toggle. */
  THERMAL: 1 << 11,
  /** C: stealth toggle. */
  STEALTH: 1 << 12,
  /** G: mediplant pulse. */
  MEDI: 1 << 13,
  /** K: tactical respawn. */
  SUICIDE: 1 << 14,
  /** Cyberspace program keys 1..3 / minigame choice are sent as `weapon`. */
  PROGRAM: 1 << 15,
} as const;

export interface UserCmd {
  seq: number;
  /** Duration of this command in milliseconds (clamped by the server). */
  msec: number;
  forward: number; // -1..1
  side: number; // -1..1 (right positive)
  buttons: number;
  pitch: number;
  yaw: number;
  /** Requested weapon slot (1..4), 0 = keep current. In cyberspace: program/minigame choice. */
  weapon: number;
  /** Server tick (fractional) the client was rendering other entities at. For lag compensation. */
  viewTick: number;
}

export interface MoveParams {
  accelerate: number;
  airAccelerate: number;
  airSpeedCap: number;
  friction: number;
  stopSpeed: number;
  gravity: number;
  stepSize: number;
  duckSpeedScale: number;
  walkSpeedScale: number;
  hullHalfWidth: number;
  hullHeight: number;
  duckHeight: number;
  eyeHeight: number;
  duckEyeHeight: number;
}

export const DEFAULT_MOVE: MoveParams = {
  accelerate: 10,
  airAccelerate: 10,
  airSpeedCap: 30,
  friction: 4,
  stopSpeed: 100,
  gravity: 800,
  stepSize: 18,
  duckSpeedScale: 0.34,
  walkSpeedScale: 0.52,
  hullHalfWidth: 16,
  hullHeight: 72,
  duckHeight: 36,
  eyeHeight: 64,
  duckEyeHeight: 28,
};

/** Per-command capabilities, derived from class + implants + energy by the caller. */
export interface MoveCaps {
  runSpeed: number;
  sprintSpeed: number;
  /** Leg boosters present and energy available. */
  canSprint: boolean;
  canBoost: boolean;
  canLedgeGrab: boolean;
  jumpSpeed: number;
  /** External multiplier (minigun spin, stun); 1 = normal. */
  speedScale: number;
}

export const DEFAULT_CAPS: MoveCaps = {
  runSpeed: 250,
  sprintSpeed: 312,
  canSprint: false,
  canBoost: false,
  canLedgeGrab: false,
  jumpSpeed: Math.sqrt(2 * 800 * 45),
  speedScale: 1,
};

export const BOOST_CHARGE_TIME = 1.0;
export const BOOST_VERTICAL = 420;
export const BOOST_HORIZONTAL = 480;
export const SLIDE_TIME = 0.8;
export const SLIDE_FRICTION = 0.12;

export interface PlayerMoveState {
  /** Feet position (bottom-center of hull). */
  origin: Vec3;
  velocity: Vec3;
  onGround: boolean;
  ducked: boolean;
  /** True while jump is held; a new jump needs a fresh press (no auto-hop). */
  jumpHeld: boolean;
  /** Hanging from a ledge. */
  hanging: boolean;
  hangNormal: Vec3;
  /** Crouch slide time remaining (s). */
  slideTime: number;
  /** Leg boost charge time held (s). */
  boostCharge: number;
  /** Airborne from a boost jump (for goomba stomps and fall damage immunity). */
  boosted: boolean;
  /** Output: sprinting this command (caller drains energy). */
  sprinting: boolean;
}

export const newMoveState = (origin: Vec3): PlayerMoveState => ({
  origin: vcopy(origin),
  velocity: v3(),
  onGround: false,
  ducked: false,
  jumpHeld: false,
  hanging: false,
  hangNormal: v3(),
  slideTime: 0,
  boostCharge: 0,
  boosted: false,
  sprinting: false,
});

export const cloneMoveState = (s: PlayerMoveState): PlayerMoveState => ({
  ...s,
  origin: vcopy(s.origin),
  velocity: vcopy(s.velocity),
  hangNormal: vcopy(s.hangNormal),
});

export function hullFor(p: MoveParams, ducked: boolean): { mins: Vec3; maxs: Vec3 } {
  const w = p.hullHalfWidth;
  return { mins: v3(-w, -w, 0), maxs: v3(w, w, ducked ? p.duckHeight : p.hullHeight) };
}

export const eyeHeightFor = (p: MoveParams, ducked: boolean): number => (ducked ? p.duckEyeHeight : p.eyeHeight);

export function clipVelocity(v: Vec3, normal: Vec3, overbounce: number): Vec3 {
  const backoff = vdot(v, normal) * overbounce;
  const out = vsub(v, vscale(normal, backoff));
  // Avoid residual velocity into the plane.
  const adjust = vdot(out, normal);
  if (adjust < 0) return vsub(out, vscale(normal, adjust));
  return out;
}

export interface MoveEvents {
  jumped: boolean;
  /** Boost jump fired with this charge fraction (0..1), else 0. */
  boostJump: number;
  landed: boolean;
  /** Downward speed at landing, for fall damage / sounds. */
  landSpeed: number;
  /** The landing ended a boost jump. */
  landedFromBoost: boolean;
  ledgeGrab: boolean;
  ledgeClimb: boolean;
  slideStart: boolean;
}

const noEvents = (): MoveEvents => ({
  jumped: false,
  boostJump: 0,
  landed: false,
  landSpeed: 0,
  landedFromBoost: false,
  ledgeGrab: false,
  ledgeClimb: false,
  slideStart: false,
});

export class PlayerMover {
  /** Per-player collision filter for team-pass brush models (set before `move`). */
  filter?: ModelFilter;

  constructor(
    private readonly world: CollisionWorld,
    public params: MoveParams = DEFAULT_MOVE,
  ) {}

  private hull(s: PlayerMoveState) {
    return hullFor(this.params, s.ducked);
  }

  private trace(s: PlayerMoveState, start: Vec3, end: Vec3) {
    const h = this.hull(s);
    return this.world.trace(start, end, h.mins, h.maxs, MASK_PLAYERSOLID, this.filter);
  }

  /** Run one user command. Mutates `s`. */
  move(s: PlayerMoveState, cmd: UserCmd, caps: MoveCaps = DEFAULT_CAPS): MoveEvents {
    const ev = noEvents();
    const dt = Math.min(Math.max(cmd.msec, 0), 50) / 1000;
    if (dt <= 0) return ev;
    const p = this.params;
    s.sprinting = false;

    this.unstick(s);

    if (s.hanging) {
      this.hangMove(s, cmd, caps, ev);
      return ev;
    }

    this.checkDuck(s, cmd);
    const wasOnGround = s.onGround;
    const fallSpeed = -s.velocity.z;

    // Gravity, first half (Source's StartGravity).
    if (!s.onGround) s.velocity.z -= p.gravity * dt * 0.5;

    // Leg boost: hold BOOST on the ground to charge, release to launch.
    const boostDown = (cmd.buttons & Buttons.BOOST) !== 0;
    if (caps.canBoost && boostDown && s.onGround) {
      s.boostCharge = Math.min(BOOST_CHARGE_TIME, s.boostCharge + dt);
    } else if (s.boostCharge > 0 && (!boostDown || !caps.canBoost)) {
      if (s.onGround && caps.canBoost) {
        const f = s.boostCharge / BOOST_CHARGE_TIME;
        const { forward } = angleVectors(0, cmd.yaw);
        s.velocity.z = caps.jumpSpeed + BOOST_VERTICAL * f;
        if (cmd.forward > 0.5 && cmd.buttons & Buttons.SPRINT) {
          // Horizontal boost (1.4): trade some height for a forward lunge.
          s.velocity.z = caps.jumpSpeed + BOOST_VERTICAL * f * 0.35;
          s.velocity = vma(s.velocity, BOOST_HORIZONTAL * f, forward);
        }
        s.onGround = false;
        s.boosted = true;
        ev.boostJump = Math.max(f, 0.01);
        ev.jumped = true;
      }
      s.boostCharge = 0;
    }

    const jumpDown = (cmd.buttons & Buttons.JUMP) !== 0;
    if (jumpDown) {
      if (s.onGround && !s.jumpHeld && !ev.jumped) {
        s.velocity.z = caps.jumpSpeed;
        s.onGround = false;
        ev.jumped = true;
        s.velocity.z -= p.gravity * dt * 0.5;
      }
      s.jumpHeld = true;
    } else {
      s.jumpHeld = false;
    }

    if (s.onGround) {
      s.velocity.z = 0;
      const fr = s.slideTime > 0 ? SLIDE_FRICTION : 1;
      this.friction(s, dt, fr);
    }
    if (s.slideTime > 0) s.slideTime = Math.max(0, s.slideTime - dt);

    const { forward, right } = angleVectors(0, cmd.yaw);
    let fmove = Math.max(-1, Math.min(1, cmd.forward));
    let smove = Math.max(-1, Math.min(1, cmd.side));
    const len = Math.hypot(fmove, smove);
    if (len > 1) {
      fmove /= len;
      smove /= len;
    }
    const sprint = caps.canSprint && (cmd.buttons & Buttons.SPRINT) !== 0 && fmove > 0 && !s.ducked;
    let maxSpeed = (sprint ? caps.sprintSpeed : caps.runSpeed) * caps.speedScale;
    if (s.ducked && s.onGround && s.slideTime <= 0) maxSpeed *= p.duckSpeedScale;
    else if (cmd.buttons & Buttons.WALK) maxSpeed *= p.walkSpeedScale;
    if (s.boostCharge > 0) maxSpeed *= 0.5;
    s.sprinting = sprint && s.onGround && len > 0;

    const wishvel = v3(forward.x * fmove + right.x * smove, forward.y * fmove + right.y * smove, 0);
    const wishdir = vnorm(wishvel);
    const wishspeed = vlen(wishvel) * maxSpeed;

    if (s.onGround) {
      if (s.slideTime <= 0) {
        this.accelerate(s, wishdir, wishspeed, p.accelerate, dt);
        const sp = vlen(s.velocity);
        if (sp > maxSpeed) s.velocity = vscale(s.velocity, maxSpeed / sp);
      }
      this.walkMove(s, dt);
    } else {
      this.airAccelerate(s, wishdir, wishspeed, dt);
      this.flyMove(s, dt);
      if (caps.canLedgeGrab && jumpDown && fmove > 0 && s.velocity.z < 120 && this.tryLedgeGrab(s, cmd)) {
        ev.ledgeGrab = true;
        return ev;
      }
    }

    this.categorizePosition(s);

    // Gravity, second half.
    if (!s.onGround) s.velocity.z -= p.gravity * dt * 0.5;
    else s.velocity.z = 0;

    if (s.onGround && !wasOnGround) {
      ev.landed = true;
      ev.landSpeed = fallSpeed;
      ev.landedFromBoost = s.boosted;
      s.boosted = false;
      // Crouch slide: land crouched faster than you could run.
      if (s.ducked && vlen2d(s.velocity) > caps.runSpeed * 1.05) {
        s.slideTime = SLIDE_TIME;
        ev.slideStart = true;
      }
    }
    return ev;
  }

  // ---- ledge grab ---------------------------------------------------------

  private tryLedgeGrab(s: PlayerMoveState, cmd: UserCmd): boolean {
    const p = this.params;
    if (s.ducked) return false;
    const { forward } = angleVectors(0, cmd.yaw);
    const w = p.hullHalfWidth;
    // A thin probe at chest height must hit a near-vertical wall.
    const chest = vadd(s.origin, v3(0, 0, p.hullHeight * 0.6));
    const probeMins = v3(-4, -4, -4);
    const probeMaxs = v3(4, 4, 4);
    const wall = this.world.trace(chest, vma(chest, w + 20, forward), probeMins, probeMaxs, MASK_PLAYERSOLID, this.filter);
    if (wall.fraction === 1 || Math.abs(wall.normal.z) > 0.3) return false;
    // Find the ledge top just beyond the wall surface.
    const into = vma(wall.endpos, 12, vscale(wall.normal, -1));
    const top = this.world.trace(
      v3(into.x, into.y, s.origin.z + p.hullHeight + 28),
      v3(into.x, into.y, s.origin.z + p.hullHeight * 0.45),
      probeMins,
      probeMaxs,
      MASK_PLAYERSOLID,
    );
    if (top.startSolid || top.fraction === 1 || top.normal.z < 0.7) return false;
    const ledgeZ = top.endpos.z - 4;
    // Standing room on top of the ledge?
    const stand = v3(into.x - wall.normal.x * (w - 8), into.y - wall.normal.y * (w - 8), ledgeZ + 1);
    const h = hullFor(p, false);
    if (this.world.testBox(stand, h.mins, h.maxs, MASK_PLAYERSOLID, this.filter)) return false;
    // Hang with the ledge at about eye level.
    const hangZ = ledgeZ - p.eyeHeight + 6;
    const hangPos = v3(s.origin.x, s.origin.y, hangZ);
    if (this.world.testBox(hangPos, h.mins, h.maxs, MASK_PLAYERSOLID, this.filter)) return false;
    s.origin = hangPos;
    s.velocity = v3();
    s.hanging = true;
    s.hangNormal = v3(wall.normal.x, wall.normal.y, 0);
    s.boosted = false;
    return true;
  }

  private hangMove(s: PlayerMoveState, cmd: UserCmd, caps: MoveCaps, ev: MoveEvents): void {
    const p = this.params;
    const jumpDown = (cmd.buttons & Buttons.JUMP) !== 0;
    if (cmd.buttons & Buttons.DUCK) {
      s.hanging = false;
      s.velocity = vscale(s.hangNormal, 60);
      return;
    }
    if (jumpDown && !s.jumpHeld) {
      // Mantle: pop up and over the lip.
      s.hanging = false;
      s.velocity = v3(-s.hangNormal.x * 140, -s.hangNormal.y * 140, Math.sqrt(2 * p.gravity * (p.eyeHeight + 4)));
      s.jumpHeld = true;
      ev.ledgeClimb = true;
      return;
    }
    s.jumpHeld = jumpDown;
    // Shimmy sideways along the wall.
    const along = v3(-s.hangNormal.y, s.hangNormal.x, 0);
    const { right } = angleVectors(0, cmd.yaw);
    const side = cmd.side * (vdot(right, along) >= 0 ? 1 : -1);
    if (Math.abs(side) > 0.1) {
      const dt = Math.min(Math.max(cmd.msec, 0), 50) / 1000;
      const dest = vma(s.origin, side * 90 * dt, along);
      const tr = this.trace(s, s.origin, dest);
      // Only shimmy while there's still wall to hold on to.
      const probe = this.world.trace(
        vadd(tr.endpos, v3(0, 0, p.hullHeight * 0.6)),
        vma(vadd(tr.endpos, v3(0, 0, p.hullHeight * 0.6)), p.hullHalfWidth + 12, vscale(s.hangNormal, -1)),
        v3(-4, -4, -4),
        v3(4, 4, 4),
        MASK_PLAYERSOLID,
      );
      if (probe.fraction < 1) s.origin = tr.endpos;
    }
    void caps;
  }

  /** Source's CheckStuck, simplified: nudge out of solids (spawns exactly on a floor, movers). */
  unstick(s: PlayerMoveState): boolean {
    const h = this.hull(s);
    if (!this.world.testBox(s.origin, h.mins, h.maxs, MASK_PLAYERSOLID, this.filter)) return false;
    for (const r of [0.125, 1, 2, 4, 8, 16, 24, 32, 48]) {
      for (const d of UNSTICK_DIRS) {
        const p = vma(s.origin, r, d);
        if (!this.world.testBox(p, h.mins, h.maxs, MASK_PLAYERSOLID, this.filter)) {
          s.origin = p;
          return true;
        }
      }
    }
    return false;
  }

  private checkDuck(s: PlayerMoveState, cmd: UserCmd): void {
    const p = this.params;
    const want = (cmd.buttons & Buttons.DUCK) !== 0;
    if (want && !s.ducked) {
      s.ducked = true;
      // In the air, pull the feet up so the head stays put (crouch-jump).
      if (!s.onGround) {
        const lift = p.hullHeight - p.duckHeight;
        const h = hullFor(p, true);
        const up = vadd(s.origin, v3(0, 0, lift));
        const tr = this.world.trace(s.origin, up, h.mins, h.maxs, MASK_PLAYERSOLID, this.filter);
        s.origin = tr.endpos;
      }
    } else if (!want && s.ducked) {
      const h = hullFor(p, false);
      if (s.onGround) {
        if (!this.world.testBox(s.origin, h.mins, h.maxs, MASK_PLAYERSOLID, this.filter)) {
          s.ducked = false;
          s.slideTime = 0;
        }
      } else {
        // Uncrouch in air: drop the feet back down if there's room.
        const lift = p.hullHeight - p.duckHeight;
        const down = vsub(s.origin, v3(0, 0, lift));
        if (!this.world.testBox(down, h.mins, h.maxs, MASK_PLAYERSOLID, this.filter)) {
          s.origin = down;
          s.ducked = false;
        } else if (!this.world.testBox(s.origin, h.mins, h.maxs, MASK_PLAYERSOLID, this.filter)) {
          s.ducked = false;
        }
      }
    }
  }

  private friction(s: PlayerMoveState, dt: number, scale: number): void {
    const p = this.params;
    const speed = vlen(s.velocity);
    if (speed < 0.1) {
      s.velocity = v3();
      return;
    }
    const control = speed < p.stopSpeed ? p.stopSpeed : speed;
    const drop = control * p.friction * scale * dt;
    const newspeed = Math.max(speed - drop, 0) / speed;
    s.velocity = vscale(s.velocity, newspeed);
  }

  private accelerate(s: PlayerMoveState, wishdir: Vec3, wishspeed: number, accel: number, dt: number): void {
    const current = vdot(s.velocity, wishdir);
    const add = wishspeed - current;
    if (add <= 0) return;
    const accelspeed = Math.min(accel * dt * wishspeed, add);
    s.velocity = vma(s.velocity, accelspeed, wishdir);
  }

  private airAccelerate(s: PlayerMoveState, wishdir: Vec3, wishspeed: number, dt: number): void {
    const p = this.params;
    const capped = Math.min(wishspeed, p.airSpeedCap);
    const current = vdot(s.velocity, wishdir);
    const add = capped - current;
    if (add <= 0) return;
    const accelspeed = Math.min(p.airAccelerate * wishspeed * dt, add);
    s.velocity = vma(s.velocity, accelspeed, wishdir);
  }

  /** Quake's SV_FlyMove: slide along up to 4 planes. */
  private flyMove(s: PlayerMoveState, dt: number): void {
    const planes: Vec3[] = [];
    const original = vcopy(s.velocity);
    let timeLeft = dt;
    for (let bump = 0; bump < 4; bump++) {
      if (vlen(s.velocity) === 0) break;
      const end = vma(s.origin, timeLeft, s.velocity);
      const tr = this.trace(s, s.origin, end);
      if (tr.allSolid) {
        s.velocity = v3();
        return;
      }
      if (tr.fraction > 0) {
        s.origin = tr.endpos;
        planes.length = 0;
      }
      if (tr.fraction === 1) break;
      timeLeft -= timeLeft * tr.fraction;
      if (planes.length >= 5) {
        s.velocity = v3();
        break;
      }
      planes.push(tr.normal);

      // Find a velocity that satisfies all clip planes.
      let i = 0;
      let newVel = s.velocity;
      for (i = 0; i < planes.length; i++) {
        newVel = clipVelocity(s.velocity, planes[i]!, 1.0);
        let j = 0;
        for (j = 0; j < planes.length; j++) {
          if (j !== i && vdot(newVel, planes[j]!) < 0) break;
        }
        if (j === planes.length) break;
      }
      if (i !== planes.length) {
        s.velocity = newVel;
      } else {
        if (planes.length !== 2) {
          s.velocity = v3();
          break;
        }
        // Slide along the crease.
        const dir = vnorm(crossp(planes[0]!, planes[1]!));
        s.velocity = vscale(dir, vdot(dir, s.velocity));
      }
      // Don't bounce back into the original direction (avoids jitter in corners).
      if (vdot(s.velocity, original) <= 0) {
        s.velocity = v3();
        break;
      }
    }
  }

  /** Source StepMove: try a plain slide and a step-up slide, keep whichever went further. */
  private walkMove(s: PlayerMoveState, dt: number): void {
    const p = this.params;
    const dest = vma(s.origin, dt, s.velocity);
    dest.z = s.origin.z;
    // Fast path: nothing in the way.
    const direct = this.trace(s, s.origin, dest);
    if (direct.fraction === 1 && !direct.startSolid) {
      s.origin = direct.endpos;
      this.stayOnGround(s);
      return;
    }

    const startOrigin = vcopy(s.origin);
    const startVel = vcopy(s.velocity);

    // Down move.
    this.flyMove(s, dt);
    const downOrigin = vcopy(s.origin);
    const downVel = vcopy(s.velocity);

    // Up move: lift by step size, slide, drop back down.
    s.origin = vcopy(startOrigin);
    s.velocity = vcopy(startVel);
    const upTr = this.trace(s, s.origin, vadd(s.origin, v3(0, 0, p.stepSize)));
    if (!upTr.startSolid && !upTr.allSolid) s.origin = upTr.endpos;
    this.flyMove(s, dt);
    const dropTr = this.trace(s, s.origin, vsub(s.origin, v3(0, 0, p.stepSize + 1)));
    if (!dropTr.startSolid && !dropTr.allSolid) s.origin = dropTr.endpos;

    // Stepping onto something too steep, or no ground: use the down move.
    if (dropTr.fraction === 1 || dropTr.normal.z < 0.7) {
      s.origin = downOrigin;
      s.velocity = downVel;
      this.stayOnGround(s);
      return;
    }
    const downDist = (downOrigin.x - startOrigin.x) ** 2 + (downOrigin.y - startOrigin.y) ** 2;
    const upDist = (s.origin.x - startOrigin.x) ** 2 + (s.origin.y - startOrigin.y) ** 2;
    if (downDist > upDist) {
      s.origin = downOrigin;
      s.velocity = downVel;
    } else {
      s.velocity.z = downVel.z;
    }
    this.stayOnGround(s);
  }

  /** Keep the player glued to slopes and stairs going down. */
  private stayOnGround(s: PlayerMoveState): void {
    const p = this.params;
    const start = vadd(s.origin, v3(0, 0, 2));
    const end = vsub(s.origin, v3(0, 0, p.stepSize));
    const up = this.trace(s, s.origin, start);
    const tr = this.trace(s, up.endpos, end);
    if (tr.fraction > 0 && tr.fraction < 1 && !tr.startSolid && tr.normal.z >= 0.7) {
      if (Math.abs(s.origin.z - tr.endpos.z) > 0.5 * 0.03125) s.origin = tr.endpos;
    }
  }

  categorizePosition(s: PlayerMoveState): void {
    if (s.velocity.z > 180) {
      s.onGround = false;
      return;
    }
    const tr = this.trace(s, s.origin, vsub(s.origin, v3(0, 0, 2)));
    if (tr.fraction === 1 || tr.normal.z < 0.7 || tr.allSolid) {
      s.onGround = false;
    } else {
      if (!s.onGround && tr.fraction > 0) s.origin = tr.endpos;
      s.onGround = true;
    }
  }
}

const UNSTICK_DIRS: Vec3[] = [
  v3(0, 0, 1),
  v3(1, 0, 0),
  v3(-1, 0, 0),
  v3(0, 1, 0),
  v3(0, -1, 0),
  v3(0, 0, -1),
  vnorm(v3(1, 1, 1)),
  vnorm(v3(-1, 1, 1)),
  vnorm(v3(1, -1, 1)),
  vnorm(v3(-1, -1, 1)),
];

const crossp = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

/** Source fall damage: nothing below 580 u/s, lethal (100) at 1024 u/s. */
export function fallDamage(landSpeed: number): number {
  if (landSpeed <= 580) return 0;
  return Math.round((landSpeed - 580) * (100 / (1024 - 580)));
}
