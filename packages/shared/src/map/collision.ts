// Swept-AABB collision against convex brushes (Quake 3 CM_TraceThroughBrush style).

import { type Vec3, v3, vcopy, vdot, vlerp, vsub, vcomp } from '../math.js';
import { type Brush, CONTENTS_SOLID } from './brush.js';

export const SURFACE_CLIP_EPSILON = 0.03125;

export interface TraceResult {
  fraction: number;
  endpos: Vec3;
  normal: Vec3;
  startSolid: boolean;
  allSolid: boolean;
  /** -1 for static world, otherwise the id of the brush model that was hit. */
  model: number;
  contents: number;
  /** Texture of the face that was hit (lowercase), if known. */
  texture?: string;
}

interface BvhNode {
  mins: Vec3;
  maxs: Vec3;
  left?: BvhNode;
  right?: BvhNode;
  brushes?: Brush[];
}

function buildBvh(brushes: Brush[]): BvhNode {
  const mins = v3(Infinity, Infinity, Infinity);
  const maxs = v3(-Infinity, -Infinity, -Infinity);
  for (const b of brushes) {
    mins.x = Math.min(mins.x, b.mins.x);
    mins.y = Math.min(mins.y, b.mins.y);
    mins.z = Math.min(mins.z, b.mins.z);
    maxs.x = Math.max(maxs.x, b.maxs.x);
    maxs.y = Math.max(maxs.y, b.maxs.y);
    maxs.z = Math.max(maxs.z, b.maxs.z);
  }
  if (brushes.length <= 4) return { mins, maxs, brushes };
  const ext = vsub(maxs, mins);
  const axis = ext.x >= ext.y && ext.x >= ext.z ? 0 : ext.y >= ext.z ? 1 : 2;
  const sorted = [...brushes].sort(
    (a, b) => vcomp(a.mins, axis) + vcomp(a.maxs, axis) - (vcomp(b.mins, axis) + vcomp(b.maxs, axis)),
  );
  const mid = sorted.length >> 1;
  return { mins, maxs, left: buildBvh(sorted.slice(0, mid)), right: buildBvh(sorted.slice(mid)) };
}

export interface BrushModel {
  id: number;
  /** Game-defined owner/pass data, e.g. which team may pass. */
  tag: number;
  brushes: Brush[];
  /** Current translation of the model relative to where it was authored. */
  offset: Vec3;
  solid: boolean;
  mins: Vec3;
  maxs: Vec3;
}

/** Return false to make a brush model non-solid for this trace (team-pass ICE, force fields). */
export type ModelFilter = (model: BrushModel) => boolean;

export class CollisionWorld {
  private readonly root: BvhNode | null;
  readonly models = new Map<number, BrushModel>();

  constructor(readonly staticBrushes: Brush[]) {
    this.root = staticBrushes.length ? buildBvh(staticBrushes) : null;
  }

  addModel(id: number, brushes: Brush[]): BrushModel {
    const mins = v3(Infinity, Infinity, Infinity);
    const maxs = v3(-Infinity, -Infinity, -Infinity);
    for (const b of brushes) {
      mins.x = Math.min(mins.x, b.mins.x);
      mins.y = Math.min(mins.y, b.mins.y);
      mins.z = Math.min(mins.z, b.mins.z);
      maxs.x = Math.max(maxs.x, b.maxs.x);
      maxs.y = Math.max(maxs.y, b.maxs.y);
      maxs.z = Math.max(maxs.z, b.maxs.z);
    }
    const m: BrushModel = { id, tag: 0, brushes, offset: v3(), solid: true, mins, maxs };
    this.models.set(id, m);
    return m;
  }

  trace(start: Vec3, end: Vec3, mins: Vec3, maxs: Vec3, mask = CONTENTS_SOLID, filter?: ModelFilter): TraceResult {
    const tr: TraceResult = {
      fraction: 1,
      endpos: vcopy(end),
      normal: v3(0, 0, 1),
      startSolid: false,
      allSolid: false,
      model: -1,
      contents: 0,
    };
    // Sweep bounds for broadphase.
    const smin = v3(
      Math.min(start.x, end.x) + mins.x - 1,
      Math.min(start.y, end.y) + mins.y - 1,
      Math.min(start.z, end.z) + mins.z - 1,
    );
    const smax = v3(
      Math.max(start.x, end.x) + maxs.x + 1,
      Math.max(start.y, end.y) + maxs.y + 1,
      Math.max(start.z, end.z) + maxs.z + 1,
    );

    if (this.root) {
      const stack: BvhNode[] = [this.root];
      while (stack.length) {
        const n = stack.pop()!;
        if (!boxOverlap(n.mins, n.maxs, smin, smax)) continue;
        if (n.brushes) {
          for (const b of n.brushes) {
            if (!(b.contents & mask)) continue;
            if (!boxOverlap(b.mins, b.maxs, smin, smax)) continue;
            traceBrush(tr, b, start, end, mins, maxs, -1);
            if (tr.allSolid) return finish(tr, start, end);
          }
        } else {
          if (n.left) stack.push(n.left);
          if (n.right) stack.push(n.right);
        }
      }
    }

    for (const m of this.models.values()) {
      if (!m.solid || (filter && !filter(m))) continue;
      const lmin = vsub(smin, m.offset);
      const lmax = vsub(smax, m.offset);
      if (!boxOverlap(m.mins, m.maxs, lmin, lmax)) continue;
      const ls = vsub(start, m.offset);
      const le = vsub(end, m.offset);
      for (const b of m.brushes) {
        if (!(b.contents & mask)) continue;
        if (!boxOverlap(b.mins, b.maxs, lmin, lmax)) continue;
        traceBrush(tr, b, ls, le, mins, maxs, m.id);
        if (tr.allSolid) return finish(tr, start, end);
      }
    }
    return finish(tr, start, end);
  }

  /** Is an AABB at `pos` intersecting anything solid? */
  testBox(pos: Vec3, mins: Vec3, maxs: Vec3, mask = CONTENTS_SOLID, filter?: ModelFilter): boolean {
    return this.trace(pos, pos, mins, maxs, mask, filter).startSolid;
  }
}

function finish(tr: TraceResult, start: Vec3, end: Vec3): TraceResult {
  if (tr.allSolid) {
    tr.fraction = 0;
    tr.endpos = vcopy(start);
  } else if (tr.fraction < 1) {
    tr.endpos = vlerp(start, end, tr.fraction);
  } else {
    tr.endpos = vcopy(end);
  }
  return tr;
}

function boxOverlap(amin: Vec3, amax: Vec3, bmin: Vec3, bmax: Vec3): boolean {
  return (
    amin.x <= bmax.x &&
    amax.x >= bmin.x &&
    amin.y <= bmax.y &&
    amax.y >= bmin.y &&
    amin.z <= bmax.z &&
    amax.z >= bmin.z
  );
}

function traceBrush(tr: TraceResult, b: Brush, start: Vec3, end: Vec3, mins: Vec3, maxs: Vec3, model: number): void {
  let enterFrac = -1;
  let leaveFrac = 1;
  let clipNormal: Vec3 | null = null;
  let clipTex: string | undefined;
  let getOut = false;
  let startOut = false;

  for (const p of b.planes) {
    const n = p.normal;
    // Offset the plane by the box corner that is furthest "behind" it.
    const ox = n.x < 0 ? maxs.x : mins.x;
    const oy = n.y < 0 ? maxs.y : mins.y;
    const oz = n.z < 0 ? maxs.z : mins.z;
    const dist = p.dist - (ox * n.x + oy * n.y + oz * n.z);

    const d1 = vdot(start, n) - dist;
    const d2 = vdot(end, n) - dist;
    if (d2 > 0) getOut = true;
    if (d1 > 0) startOut = true;

    // Completely in front of this face: no intersection with the brush.
    if (d1 > 0 && (d2 >= SURFACE_CLIP_EPSILON || d2 >= d1)) return;
    // Completely behind: this plane doesn't clip.
    if (d1 <= 0 && d2 <= 0) continue;

    if (d1 > d2) {
      let f = (d1 - SURFACE_CLIP_EPSILON) / (d1 - d2);
      if (f < 0) f = 0;
      if (f > enterFrac) {
        enterFrac = f;
        clipNormal = n;
        clipTex = p.texture;
      }
    } else {
      let f = (d1 + SURFACE_CLIP_EPSILON) / (d1 - d2);
      if (f > 1) f = 1;
      if (f < leaveFrac) leaveFrac = f;
    }
  }

  if (!startOut) {
    tr.startSolid = true;
    tr.contents = b.contents;
    tr.model = model;
    if (!getOut) {
      tr.allSolid = true;
      tr.fraction = 0;
    }
    return;
  }
  if (enterFrac < leaveFrac && enterFrac > -1 && enterFrac < tr.fraction && clipNormal) {
    tr.fraction = enterFrac < 0 ? 0 : enterFrac;
    tr.normal = vcopy(clipNormal);
    tr.model = model;
    tr.contents = b.contents;
    tr.texture = clipTex;
  }
}

/** Is a point inside any brush of the given contents (used for triggers). */
export function pointInBrushes(p: Vec3, brushes: Brush[], offset: Vec3 = v3()): boolean {
  const lp = vsub(p, offset);
  outer: for (const b of brushes) {
    for (const pl of b.planes) if (vdot(lp, pl.normal) - pl.dist > 0) continue outer;
    return true;
  }
  return false;
}

/** Does an AABB centered at p overlap any of the brushes (conservative, via expanded planes)? */
export function boxInBrushes(p: Vec3, mins: Vec3, maxs: Vec3, brushes: Brush[], offset: Vec3 = v3()): boolean {
  const lp = vsub(p, offset);
  outer: for (const b of brushes) {
    for (const pl of b.planes) {
      const n = pl.normal;
      const ox = n.x < 0 ? maxs.x : mins.x;
      const oy = n.y < 0 ? maxs.y : mins.y;
      const oz = n.z < 0 ? maxs.z : mins.z;
      const dist = pl.dist - (ox * n.x + oy * n.y + oz * n.z);
      if (vdot(lp, n) - dist > 0) continue outer;
    }
    return true;
  }
  return false;
}

