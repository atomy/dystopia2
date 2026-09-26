// Convex brush geometry: planes from .map faces, face polygons (for rendering),
// and bevel planes (for correct swept-AABB collision).

import { type Vec3, v3, vadd, vcross, vdot, vnorm, vscale, vsub, vlen, vcomp } from '../math.js';
import type { MapBrush } from './mapfile.js';

export interface Plane {
  normal: Vec3;
  dist: number;
  /** Texture of the face this plane came from (undefined for bevels). */
  texture?: string;
}

export interface BrushFace {
  plane: Plane;
  texture: string;
  /** Convex polygon, counter-clockwise when viewed from outside (along -normal). */
  verts: Vec3[];
}

export interface Brush {
  /** Planes used for collision: the face planes plus bevels. Inside: dot(n,p) <= dist. */
  planes: Plane[];
  faces: BrushFace[];
  mins: Vec3;
  maxs: Vec3;
  /** Contents derived from textures, e.g. clip, trigger, nodraw. */
  contents: number;
}

export const CONTENTS_SOLID = 1;
/** Player-only clip: collides but is not rendered. */
export const CONTENTS_PLAYERCLIP = 2;
/** Trigger volume: not solid, not rendered. */
export const CONTENTS_TRIGGER = 4;
/** Blocks bullets/rays but not players (e.g. glass-like force fields would be the opposite). */
export const CONTENTS_SHOTCLIP = 8;

const EPS = 1e-4;

export function planeFromPoints(p0: Vec3, p1: Vec3, p2: Vec3): Plane {
  const normal = vnorm(vcross(vsub(p0, p1), vsub(p2, p1)));
  return { normal, dist: vdot(p0, normal) };
}

/** Clip a convex polygon, keeping the part behind the plane (dot(n,p) <= dist). */
export function clipPolygon(poly: Vec3[], plane: Plane): Vec3[] {
  const out: Vec3[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    const da = vdot(a, plane.normal) - plane.dist;
    const db = vdot(b, plane.normal) - plane.dist;
    if (da <= EPS) out.push(a);
    if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
      const t = da / (da - db);
      out.push(vadd(a, vscale(vsub(b, a), t)));
    }
  }
  return out;
}

/** Huge quad lying on the plane; its winding is counter-clockwise viewed from the front. */
function baseWinding(plane: Plane, size = 1 << 16): Vec3[] {
  const n = plane.normal;
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  const up = az >= ax && az >= ay ? v3(1, 0, 0) : v3(0, 0, 1);
  const u = vnorm(vsub(up, vscale(n, vdot(up, n))));
  const v = vcross(n, u);
  const org = vscale(n, plane.dist);
  const U = vscale(u, size);
  const V = vscale(v, size);
  return [
    vadd(vadd(org, U), V),
    vadd(vsub(org, U), V),
    vsub(vsub(org, U), V),
    vsub(vadd(org, U), V),
  ];
}

const round = (p: Vec3, q = 1 / 64): Vec3 => {
  const r = (x: number) => {
    const s = Math.round(x / q) * q;
    return Math.abs(s - x) < 1e-3 ? s : x;
  };
  return v3(r(p.x), r(p.y), r(p.z));
};

export function contentsForTexture(tex: string): number {
  const t = tex.toLowerCase();
  if (t.endsWith('trigger')) return CONTENTS_TRIGGER;
  if (t.endsWith('playerclip') || t.endsWith('clip')) return CONTENTS_PLAYERCLIP;
  return CONTENTS_SOLID;
}

export function isInvisibleTexture(tex: string): boolean {
  const t = tex.toLowerCase();
  return (
    t.endsWith('trigger') ||
    t.endsWith('clip') ||
    t.endsWith('nodraw') ||
    t.endsWith('skip') ||
    t.endsWith('origin') ||
    t === '__tb_empty'
  );
}

export function buildBrush(src: MapBrush): Brush | null {
  const facePlanes = src.faces.map((f) => planeFromPoints(f.points[0], f.points[1], f.points[2]));
  // Drop duplicate planes (TrenchBroom can emit them on degenerate edits).
  const uniq: { plane: Plane; texture: string }[] = [];
  facePlanes.forEach((p, i) => {
    if (uniq.some((u) => vdot(u.plane.normal, p.normal) > 1 - 1e-6 && Math.abs(u.plane.dist - p.dist) < 1e-3)) return;
    uniq.push({ plane: { ...p, texture: src.faces[i]!.texture.toLowerCase() }, texture: src.faces[i]!.texture });
  });

  const faces: BrushFace[] = [];
  for (let i = 0; i < uniq.length; i++) {
    let poly = baseWinding(uniq[i]!.plane);
    for (let j = 0; j < uniq.length && poly.length >= 3; j++) {
      if (i === j) continue;
      poly = clipPolygon(poly, uniq[j]!.plane);
    }
    if (poly.length < 3) continue;
    poly = poly.map((p) => round(p));
    faces.push({ plane: uniq[i]!.plane, texture: uniq[i]!.texture, verts: poly });
  }
  if (faces.length < 4) return null;

  const mins = v3(Infinity, Infinity, Infinity);
  const maxs = v3(-Infinity, -Infinity, -Infinity);
  for (const f of faces)
    for (const p of f.verts) {
      mins.x = Math.min(mins.x, p.x);
      mins.y = Math.min(mins.y, p.y);
      mins.z = Math.min(mins.z, p.z);
      maxs.x = Math.max(maxs.x, p.x);
      maxs.y = Math.max(maxs.y, p.y);
      maxs.z = Math.max(maxs.z, p.z);
    }

  // Contents: the "strongest" texture wins; a brush of all-trigger faces is a trigger.
  let contents = 0;
  for (const f of faces) contents |= contentsForTexture(f.texture);
  if (contents & CONTENTS_SOLID) contents = CONTENTS_SOLID;
  else if (contents & CONTENTS_PLAYERCLIP) contents = CONTENTS_PLAYERCLIP;

  const planes = faces.map((f) => f.plane);
  addBevels(planes, faces, mins, maxs);
  return { planes, faces, mins, maxs, contents };
}

function hasPlane(planes: Plane[], n: Vec3, d: number): boolean {
  return planes.some((p) => vdot(p.normal, n) > 1 - 1e-5 && Math.abs(p.dist - d) < 0.01);
}

/**
 * Add axial and edge bevel planes (as in Quake 3's AddBrushBevels) so that
 * offsetting planes by the box extents gives a tight Minkowski sum.
 */
function addBevels(planes: Plane[], faces: BrushFace[], mins: Vec3, maxs: Vec3): void {
  for (let axis = 0; axis < 3; axis++) {
    for (const sign of [-1, 1]) {
      const n = v3(axis === 0 ? sign : 0, axis === 1 ? sign : 0, axis === 2 ? sign : 0);
      const d = sign > 0 ? vcomp(maxs, axis) : -vcomp(mins, axis);
      if (!planes.some((p) => vdot(p.normal, n) > 1 - 1e-5)) planes.push({ normal: n, dist: d });
    }
  }
  const verts = faces.flatMap((f) => f.verts);
  const axes = [v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1)];
  for (const f of faces) {
    for (let i = 0; i < f.verts.length; i++) {
      const a = f.verts[i]!;
      const b = f.verts[(i + 1) % f.verts.length]!;
      const edge = vsub(b, a);
      if (vlen(edge) < 0.5) continue;
      const e = vnorm(edge);
      // Axial edges are already covered by axial bevels.
      if (Math.abs(e.x) > 1 - 1e-5 || Math.abs(e.y) > 1 - 1e-5 || Math.abs(e.z) > 1 - 1e-5) continue;
      for (const ax of axes) {
        for (const sign of [-1, 1]) {
          let n = vcross(e, vscale(ax, sign));
          if (vlen(n) < 0.5) continue;
          n = vnorm(n);
          const d = vdot(a, n);
          if (hasPlane(planes, n, d)) continue;
          // Bevel is valid only if every vertex is behind it.
          if (verts.every((p) => vdot(p, n) - d <= 0.1)) planes.push({ normal: n, dist: d });
        }
      }
    }
  }
}

export function pointInBrush(p: Vec3, b: Brush, eps = 0): boolean {
  for (const pl of b.planes) if (vdot(p, pl.normal) - pl.dist > eps) return false;
  return true;
}

export function brushCenter(b: Brush): Vec3 {
  return vscale(vadd(b.mins, b.maxs), 0.5);
}
