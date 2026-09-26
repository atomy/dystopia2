// Simulation-space math. The simulation uses Quake/Source conventions:
// Z is up, 1 unit ≈ 1 inch, angles in degrees (pitch, yaw, roll).
// The client converts to three.js (Y-up) only at render time.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const vcopy = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });
export const vset = (out: Vec3, a: Vec3): Vec3 => {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  return out;
};
export const vadd = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const vsub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const vscale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const vma = (a: Vec3, s: number, b: Vec3): Vec3 => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
export const vdot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const vcross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const vlen = (a: Vec3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const vlen2d = (a: Vec3): number => Math.sqrt(a.x * a.x + a.y * a.y);
export const vdist = (a: Vec3, b: Vec3): number => vlen(vsub(a, b));
export const vnorm = (a: Vec3): Vec3 => {
  const l = vlen(a);
  return l > 1e-9 ? vscale(a, 1 / l) : v3();
};
export const vlerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});
export const vneg = (a: Vec3): Vec3 => ({ x: -a.x, y: -a.y, z: -a.z });
export const vequals = (a: Vec3, b: Vec3, eps = 1e-6): boolean =>
  Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.z - b.z) < eps;
export const vcomp = (a: Vec3, i: number): number => (i === 0 ? a.x : i === 1 ? a.y : a.z);

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Wrap an angle in degrees to (-180, 180]. */
export const angleNormalize = (a: number): number => {
  a = a % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a;
};

export const lerpAngle = (a: number, b: number, t: number): number => a + angleNormalize(b - a) * t;

/** Source-style AngleVectors: pitch positive looks down, yaw 0 faces +X, yaw 90 faces +Y. */
export function angleVectors(pitch: number, yaw: number): { forward: Vec3; right: Vec3; up: Vec3 } {
  const sp = Math.sin(pitch * DEG2RAD);
  const cp = Math.cos(pitch * DEG2RAD);
  const sy = Math.sin(yaw * DEG2RAD);
  const cy = Math.cos(yaw * DEG2RAD);
  const forward = v3(cp * cy, cp * sy, -sp);
  const right = v3(sy, -cy, 0);
  const up = vcross(right, forward);
  return { forward, right, up };
}

export function vectorAngles(dir: Vec3): { pitch: number; yaw: number } {
  const yaw = Math.atan2(dir.y, dir.x) * RAD2DEG;
  const pitch = -Math.atan2(dir.z, vlen2d(dir)) * RAD2DEG;
  return { pitch, yaw };
}

export interface AABB {
  mins: Vec3;
  maxs: Vec3;
}

export const aabbOverlap = (a: AABB, b: AABB): boolean =>
  a.mins.x <= b.maxs.x &&
  a.maxs.x >= b.mins.x &&
  a.mins.y <= b.maxs.y &&
  a.maxs.y >= b.mins.y &&
  a.mins.z <= b.maxs.z &&
  a.maxs.z >= b.mins.z;

/** Ray (origin + t*dir, t in [0,1]) vs AABB slab test. Returns entry fraction or -1. */
export function rayAabb(origin: Vec3, delta: Vec3, mins: Vec3, maxs: Vec3): number {
  let tmin = 0;
  let tmax = 1;
  for (let i = 0; i < 3; i++) {
    const o = vcomp(origin, i);
    const d = vcomp(delta, i);
    const lo = vcomp(mins, i);
    const hi = vcomp(maxs, i);
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return -1;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin;
}

/** Small deterministic PRNG (mulberry32) so server/bots can be seeded. */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
