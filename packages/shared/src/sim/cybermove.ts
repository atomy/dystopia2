// Cyberspace avatar movement, faithful to Dystopia: relative gravity.
//  - Inside servers you have gravity along your personal "down".
//  - Touching a gravity tile (texture d2/cyber_floor) re-orients your gravity
//    so that tile becomes the floor: walk up walls, onto ceilings.
//  - Links/tubes (cyber_zerog volumes) are gravity-free and may flow.
//  - Near-zero friction; holding jump keeps bouncing and building speed.
// Shared by server and client prediction: must stay deterministic.

import { type Vec3, v3, vcopy, vdot, vscale, vma, vadd, vsub, vlen, vnorm, vcross, clamp, DEG2RAD, RAD2DEG } from '../math.js';
import type { CollisionWorld, ModelFilter } from '../map/collision.js';
import { Buttons, MASK_PLAYERSOLID, clipVelocity, type UserCmd } from './pmove.js';

export const CYBER_HULL = 12;
export const CYBER_EYE = 8;
export const GRAVITY_TEXTURE = 'd2/cyber_floor';

export const CYBER_MOVE = {
  gravity: 900,
  groundAccel: 9,
  airAccel: 14,
  airSpeedCap: 70,
  friction: 0.6,
  runSpeed: 480,
  jumpSpeed: 380,
  zeroGAccel: 5,
  zeroGSpeed: 620,
  zeroGFriction: 0.35,
  /** Speed pads accelerate up to this along their direction. */
  padAccel: 2400,
  maxSpeed: 1800,
};

export interface CyberMoveState {
  origin: Vec3;
  velocity: Vec3;
  /** Personal up vector (opposite of gravity). */
  up: Vec3;
  /** Reference "north" perpendicular to up; local yaw 0 faces north. */
  north: Vec3;
  onGround: boolean;
  zeroG: boolean;
  jumpHeld: boolean;
  /** Increments whenever up/north are re-oriented (clients re-derive view angles). */
  frame: number;
  /** Stun (Green ICE) time remaining; no control while > 0. */
  stun: number;
}

export interface CyberZone {
  zeroG: boolean;
  /** Link flow: accelerate along this vector (length = target speed). */
  flow: Vec3 | null;
  /** Jump pad launch velocity. */
  pad: Vec3 | null;
  /** Speed pad: accelerate along this direction up to its length. */
  speed: Vec3 | null;
}

export interface CyberEnv {
  zoneAt(pos: Vec3): CyberZone;
}

export const EMPTY_ZONE: CyberZone = { zeroG: false, flow: null, pad: null, speed: null };

export const newCyberState = (origin: Vec3, up: Vec3 = v3(0, 0, 1), north: Vec3 = v3(1, 0, 0)): CyberMoveState => ({
  origin: vcopy(origin),
  velocity: v3(),
  up: vcopy(up),
  north: vcopy(north),
  onGround: false,
  zeroG: false,
  jumpHeld: false,
  frame: 0,
  stun: 0,
});

export const cloneCyberState = (s: CyberMoveState): CyberMoveState => ({
  ...s,
  origin: vcopy(s.origin),
  velocity: vcopy(s.velocity),
  up: vcopy(s.up),
  north: vcopy(s.north),
});

export interface CyberBasis {
  forward: Vec3;
  /** Forward flattened onto the gravity plane. */
  flat: Vec3;
  right: Vec3;
  up: Vec3;
}

/** View basis for local pitch/yaw in the avatar's frame. */
export function cyberBasis(up: Vec3, north: Vec3, pitch: number, yaw: number): CyberBasis {
  const west = vcross(up, north);
  const cy = Math.cos(yaw * DEG2RAD);
  const sy = Math.sin(yaw * DEG2RAD);
  const cp = Math.cos(pitch * DEG2RAD);
  const sp = Math.sin(pitch * DEG2RAD);
  const flat = vadd(vscale(north, cy), vscale(west, sy));
  const forward = vsub(vscale(flat, cp), vscale(up, sp));
  const right = vcross(flat, up);
  return { forward, flat, right, up };
}

/** Local pitch/yaw that produce world direction `dir` in the given frame. */
export function cyberAnglesFor(up: Vec3, north: Vec3, dir: Vec3): { pitch: number; yaw: number } {
  const west = vcross(up, north);
  const d = vnorm(dir);
  const pitch = -Math.asin(clamp(vdot(d, up), -1, 1)) * RAD2DEG;
  const yaw = Math.atan2(vdot(d, west), vdot(d, north)) * RAD2DEG;
  return { pitch, yaw };
}

/** Rotate vector v by the minimal rotation that takes unit a onto unit b. */
function rotateBetween(v: Vec3, a: Vec3, b: Vec3, fallbackAxis: Vec3): Vec3 {
  const c = vdot(a, b);
  let axis = vcross(a, b);
  let s = vlen(axis);
  if (s < 1e-6) {
    if (c > 0) return vcopy(v);
    // 180°: rotate around a fallback axis perpendicular to a.
    axis = fallbackAxis;
    s = 0;
    const k = vnorm(axis);
    // Rodrigues with angle pi: v' = -v + 2 (k·v) k
    return vsub(vscale(k, 2 * vdot(k, v)), v);
  }
  const k = vscale(axis, 1 / s);
  // Rodrigues: v cos + (k × v) sin + k (k·v)(1 - cos)
  return vadd(vadd(vscale(v, c), vscale(vcross(k, v), s)), vscale(k, vdot(k, v) * (1 - c)));
}

/** Re-orient the avatar so `newUp` is up; returns true if the frame changed. */
export function reorient(s: CyberMoveState, newUp: Vec3): boolean {
  const nu = vnorm(newUp);
  if (vdot(nu, s.up) > 0.999) return false;
  const west = vcross(s.up, s.north);
  let north = rotateBetween(s.north, s.up, nu, west);
  // Re-orthonormalize.
  north = vnorm(vsub(north, vscale(nu, vdot(north, nu))));
  if (vlen(north) < 0.5) north = vnorm(vcross(nu, Math.abs(nu.z) < 0.9 ? v3(0, 0, 1) : v3(1, 0, 0)));
  s.up = nu;
  s.north = north;
  s.frame = (s.frame + 1) & 0xffff;
  return true;
}

export interface CyberMoveEvents {
  bounced: boolean;
  reoriented: boolean;
  padLaunched: boolean;
}

const HULL_MINS = v3(-CYBER_HULL, -CYBER_HULL, -CYBER_HULL);
const HULL_MAXS = v3(CYBER_HULL, CYBER_HULL, CYBER_HULL);

export function cyberMove(
  world: CollisionWorld,
  s: CyberMoveState,
  cmd: UserCmd,
  env: CyberEnv,
  filter?: ModelFilter,
): CyberMoveEvents {
  const ev: CyberMoveEvents = { bounced: false, reoriented: false, padLaunched: false };
  const dt = Math.min(Math.max(cmd.msec, 0), 50) / 1000;
  if (dt <= 0) return ev;
  const M = CYBER_MOVE;
  const zone = env.zoneAt(s.origin);
  s.zeroG = zone.zeroG;

  let fmove = clamp(cmd.forward, -1, 1);
  let smove = clamp(cmd.side, -1, 1);
  const jump = (cmd.buttons & Buttons.JUMP) !== 0;
  const down = (cmd.buttons & Buttons.DUCK) !== 0;
  if (s.stun > 0) {
    s.stun = Math.max(0, s.stun - dt);
    fmove = smove = 0;
  }
  const basis = cyberBasis(s.up, s.north, cmd.pitch, cmd.yaw);

  if (zone.pad) {
    // Jump pads set velocity once while you are inside them.
    if (vdot(s.velocity, vnorm(zone.pad)) < vlen(zone.pad) * 0.8) {
      s.velocity = vcopy(zone.pad);
      s.onGround = false;
      ev.padLaunched = true;
    }
  }
  if (zone.speed) {
    const dir = vnorm(zone.speed);
    const cur = vdot(s.velocity, dir);
    const target = vlen(zone.speed);
    if (cur < target) s.velocity = vma(s.velocity, Math.min(M.padAccel * dt, target - cur), dir);
  }

  if (s.zeroG) {
    // Free-floating: full 3D steering, light drag, links may flow.
    const wish = vadd(
      vadd(vscale(basis.forward, fmove), vscale(basis.right, smove)),
      vscale(s.up, (jump ? 1 : 0) - (down ? 1 : 0)),
    );
    const wishdir = vnorm(wish);
    const wishspeed = Math.min(vlen(wish), 1) * M.zeroGSpeed;
    applyFriction(s, M.zeroGFriction, dt);
    accelerate(s, wishdir, wishspeed, M.zeroGAccel, dt);
    if (zone.flow) {
      const dir = vnorm(zone.flow);
      const cur = vdot(s.velocity, dir);
      const target = vlen(zone.flow);
      if (cur < target) s.velocity = vma(s.velocity, Math.min(1600 * dt, target - cur), dir);
    }
    s.onGround = false;
  } else {
    // Relative gravity.
    s.onGround = groundCheck(world, s, filter);
    if (s.onGround && jump) {
      // Hold jump to keep bouncing; tangential speed is preserved.
      const vUp = vdot(s.velocity, s.up);
      s.velocity = vma(s.velocity, M.jumpSpeed - vUp, s.up);
      s.onGround = false;
      ev.bounced = true;
    }
    const wish = vadd(vscale(basis.flat, fmove), vscale(basis.right, smove));
    const wishdir = vnorm(wish);
    const wishspeed = Math.min(vlen(wish), 1) * M.runSpeed;
    if (s.onGround) {
      // Remove velocity into the floor, then (low) friction.
      const vUp = vdot(s.velocity, s.up);
      if (vUp < 0) s.velocity = vma(s.velocity, -vUp, s.up);
      applyFriction(s, M.friction, dt);
      accelerate(s, wishdir, wishspeed, M.groundAccel, dt);
    } else {
      // Air control with a generous cap: strafe-bouncing builds speed.
      const capped = Math.min(wishspeed, M.airSpeedCap);
      const cur = vdot(s.velocity, wishdir);
      const add = capped - cur;
      if (add > 0) s.velocity = vma(s.velocity, Math.min(M.airAccel * wishspeed * dt, add), wishdir);
      s.velocity = vma(s.velocity, -M.gravity * dt, s.up);
    }
  }

  // Speed cap.
  const sp = vlen(s.velocity);
  if (sp > M.maxSpeed) s.velocity = vscale(s.velocity, M.maxSpeed / sp);

  // Slide move (with a small step-up while grounded); touching a gravity tile re-orients us.
  const startOrigin = vcopy(s.origin);
  const startVel = vcopy(s.velocity);
  const plain = slide(world, s, dt, filter, ev);
  if (!s.zeroG && s.onGround && plain.blocked && !ev.reoriented) {
    const downOrigin = vcopy(s.origin);
    const downVel = vcopy(s.velocity);
    s.origin = startOrigin;
    s.velocity = startVel;
    const up = world.trace(s.origin, vma(s.origin, CYBER_STEP, s.up), HULL_MINS, HULL_MAXS, MASK_PLAYERSOLID, filter);
    if (!up.startSolid) {
      s.origin = up.endpos;
      const upEv: CyberMoveEvents = { bounced: false, reoriented: false, padLaunched: false };
      slide(world, s, dt, filter, upEv);
      const drop = world.trace(s.origin, vma(s.origin, -(CYBER_STEP + 1), s.up), HULL_MINS, HULL_MAXS, MASK_PLAYERSOLID, filter);
      if (!drop.startSolid) s.origin = drop.endpos;
      const tang = (a: Vec3) => {
        const d = vsub(a, startOrigin);
        return vlen(vsub(d, vscale(s.up, vdot(d, s.up))));
      };
      if (drop.fraction === 1 || vdot(drop.normal, s.up) < 0.7 || tang(downOrigin) >= tang(s.origin) || upEv.reoriented) {
        s.origin = downOrigin;
        s.velocity = downVel;
      } else {
        // Keep the vertical (relative) velocity of the plain move.
        const vUp = vdot(downVel, s.up);
        s.velocity = vma(s.velocity, vUp - vdot(s.velocity, s.up), s.up);
      }
    } else {
      s.origin = downOrigin;
      s.velocity = downVel;
    }
  }

  if (!s.zeroG) s.onGround = groundCheck(world, s, filter);
  return ev;
}

const CYBER_STEP = 14;

/** Slide along geometry for `dt`; reports whether a steep surface blocked us. */
function slide(world: CollisionWorld, s: CyberMoveState, dt: number, filter: ModelFilter | undefined, ev: CyberMoveEvents): { blocked: boolean } {
  let timeLeft = dt;
  let blocked = false;
  const planes: Vec3[] = [];
  for (let bump = 0; bump < 4; bump++) {
    if (vlen(s.velocity) < 1e-3) break;
    const end = vma(s.origin, timeLeft, s.velocity);
    const tr = world.trace(s.origin, end, HULL_MINS, HULL_MAXS, MASK_PLAYERSOLID, filter);
    if (tr.allSolid) {
      s.velocity = v3();
      break;
    }
    s.origin = tr.endpos;
    if (tr.fraction === 1) break;
    timeLeft -= timeLeft * tr.fraction;
    if (tr.texture === GRAVITY_TEXTURE && vdot(tr.normal, s.up) < 0.7) {
      if (reorient(s, tr.normal)) ev.reoriented = true;
    }
    if (vdot(tr.normal, s.up) < 0.7) blocked = true;
    planes.push(tr.normal);
    let v = clipVelocity(s.velocity, tr.normal, 1.0);
    for (const pl of planes) if (pl !== tr.normal && vdot(v, pl) < 0) v = clipVelocity(v, pl, 1.0);
    s.velocity = v;
  }
  return { blocked };
}

function groundCheck(world: CollisionWorld, s: CyberMoveState, filter?: ModelFilter): boolean {
  if (vdot(s.velocity, s.up) > 150) return false;
  const tr = world.trace(s.origin, vma(s.origin, -2, s.up), HULL_MINS, HULL_MAXS, MASK_PLAYERSOLID, filter);
  return tr.fraction < 1 && !tr.allSolid && vdot(tr.normal, s.up) > 0.7;
}

function applyFriction(s: CyberMoveState, friction: number, dt: number): void {
  const speed = vlen(s.velocity);
  if (speed < 0.1) {
    s.velocity = v3();
    return;
  }
  const drop = Math.max(speed, 60) * friction * dt;
  s.velocity = vscale(s.velocity, Math.max(speed - drop, 0) / speed);
}

function accelerate(s: CyberMoveState, wishdir: Vec3, wishspeed: number, accel: number, dt: number): void {
  const cur = vdot(s.velocity, wishdir);
  const add = wishspeed - cur;
  if (add <= 0) return;
  s.velocity = vma(s.velocity, Math.min(accel * wishspeed * dt, add), wishdir);
}

export function cyberEye(s: CyberMoveState): Vec3 {
  return vma(s.origin, CYBER_EYE, s.up);
}
