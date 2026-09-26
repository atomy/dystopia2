// Helpers for generating .map brushes in code (procedural greybox maps, tests).
// Output is plain Valve-220 .map data, so generated maps open fine in TrenchBroom.

import { type Vec3, v3, vadd, vcross, vdot, vnorm, vscale, vsub } from '../math.js';
import type { MapBrush, MapEntity, MapFace } from './mapfile.js';

/** Build a face on the plane with outward normal `n` through point `p`. */
export function faceFromPlane(n: Vec3, p: Vec3, texture: string): MapFace {
  n = vnorm(n);
  const ref = Math.abs(n.z) > 0.9 ? v3(1, 0, 0) : v3(0, 0, 1);
  const u = vnorm(vsub(ref, vscale(n, vdot(ref, n))));
  const w = vcross(n, u);
  // points must satisfy normalize((p0 - p1) x (p2 - p1)) == n  ->  p0 = p1 + u*64, p2 = p1 + w*64
  const p1 = p;
  const p0 = vadd(p1, vscale(u, 64));
  const p2 = vadd(p1, vscale(w, 64));
  return { points: [p0, p1, p2], texture, ...texAxes(n), rotation: 0, scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
}

/** Valve 220 world-aligned texture axes, the same TrenchBroom picks by default. */
function texAxes(n: Vec3): Pick<MapFace, 'uAxis' | 'vAxis'> {
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  if (az >= ax && az >= ay) return { uAxis: { x: 1, y: 0, z: 0, offset: 0 }, vAxis: { x: 0, y: -1, z: 0, offset: 0 } };
  if (ax >= ay) return { uAxis: { x: 0, y: 1, z: 0, offset: 0 }, vAxis: { x: 0, y: 0, z: -1, offset: 0 } };
  return { uAxis: { x: 1, y: 0, z: 0, offset: 0 }, vAxis: { x: 0, y: 0, z: -1, offset: 0 } };
}

export type Tex = string | { top?: string; bottom?: string; sides?: string; all?: string };

const pick = (t: Tex, which: 'top' | 'bottom' | 'sides'): string =>
  typeof t === 'string' ? t : (t[which] ?? t.all ?? 'd2/wall');

/** Axis-aligned box brush. */
export function boxBrush(mins: Vec3, maxs: Vec3, tex: Tex): MapBrush {
  return {
    faces: [
      faceFromPlane(v3(-1, 0, 0), mins, pick(tex, 'sides')),
      faceFromPlane(v3(0, -1, 0), mins, pick(tex, 'sides')),
      faceFromPlane(v3(0, 0, -1), mins, pick(tex, 'bottom')),
      faceFromPlane(v3(1, 0, 0), maxs, pick(tex, 'sides')),
      faceFromPlane(v3(0, 1, 0), maxs, pick(tex, 'sides')),
      faceFromPlane(v3(0, 0, 1), maxs, pick(tex, 'top')),
    ],
  };
}

/**
 * Ramp (wedge) filling the box, rising from `mins` side to `maxs` side along `axis`
 * ('+x', '-x', '+y', '-y'): the high edge is on the named side.
 */
export function rampBrush(mins: Vec3, maxs: Vec3, rise: '+x' | '-x' | '+y' | '-y', tex: Tex): MapBrush {
  const b = boxBrush(mins, maxs, tex);
  const dx = maxs.x - mins.x;
  const dy = maxs.y - mins.y;
  const dz = maxs.z - mins.z;
  let n: Vec3;
  let p: Vec3;
  switch (rise) {
    case '+x':
      n = v3(-dz, 0, dx);
      p = v3(mins.x, mins.y, mins.z);
      break;
    case '-x':
      n = v3(dz, 0, dx);
      p = v3(maxs.x, mins.y, mins.z);
      break;
    case '+y':
      n = v3(0, -dz, dy);
      p = v3(mins.x, mins.y, mins.z);
      break;
    case '-y':
      n = v3(0, dz, dy);
      p = v3(mins.x, maxs.y, mins.z);
      break;
  }
  // Replace the top face with the slope; keep the rest (the redundant ones get clipped away).
  b.faces[5] = faceFromPlane(n, p, pick(tex, 'top'));
  return b;
}

/** Hollow room: floor, ceiling and four walls around an interior box. */
export function roomBrushes(mins: Vec3, maxs: Vec3, t = 16, tex: Tex = 'd2/wall'): MapBrush[] {
  return [
    boxBrush(v3(mins.x - t, mins.y - t, mins.z - t), v3(maxs.x + t, maxs.y + t, mins.z), tex),
    boxBrush(v3(mins.x - t, mins.y - t, maxs.z), v3(maxs.x + t, maxs.y + t, maxs.z + t), tex),
    boxBrush(v3(mins.x - t, mins.y, mins.z), v3(mins.x, maxs.y, maxs.z), tex),
    boxBrush(v3(maxs.x, mins.y, mins.z), v3(maxs.x + t, maxs.y, maxs.z), tex),
    boxBrush(v3(mins.x - t, mins.y - t, mins.z), v3(maxs.x + t, mins.y, maxs.z), tex),
    boxBrush(v3(mins.x - t, maxs.y, mins.z), v3(maxs.x + t, maxs.y + t, maxs.z), tex),
  ];
}

export function pointEntity(classname: string, origin: Vec3, props: Record<string, string | number> = {}): MapEntity {
  const p: Record<string, string> = { classname, origin: `${origin.x} ${origin.y} ${origin.z}` };
  for (const [k, v] of Object.entries(props)) p[k] = String(v);
  return { props: p, brushes: [] };
}

export function brushEntity(classname: string, brushes: MapBrush[], props: Record<string, string | number> = {}): MapEntity {
  const p: Record<string, string> = { classname };
  for (const [k, v] of Object.entries(props)) p[k] = String(v);
  return { props: p, brushes };
}
