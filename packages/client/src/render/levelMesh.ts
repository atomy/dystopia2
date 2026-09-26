import * as THREE from 'three';
import {
  type Brush,
  type Level,
  type Vec3,
  isInvisibleTexture,
  propNum,
  parseVec,
  v3,
  vdot,
  vsub,
  vlen,
  vscale,
  vadd,
  CONTENTS_SOLID,
} from '@d2/shared';
import { materialFor, isUnlitTexture } from './materials.js';

// Level geometry with baked per-vertex lighting: faces are subdivided into
// small triangles and every vertex gathers light from the map's `light`
// entities with a shadow ray through the collision world. Cheap "lightmaps".

interface Batch {
  pos: number[];
  nrm: number[];
  uv: number[];
  col: number[];
}

interface BakeLight {
  pos: Vec3;
  color: THREE.Color;
  intensity: number;
  range: number;
}

const MAX_EDGE = 96;

function faceUV(p: Vec3, n: Vec3, tile: number): [number, number] {
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  if (az >= ax && az >= ay) return [p.x / tile, -p.y / tile];
  if (ax >= ay) return [p.y / tile, -p.z / tile];
  return [p.x / tile, -p.z / tile];
}

function subdivide(a: Vec3, b: Vec3, c: Vec3, out: Vec3[][]): void {
  const ab = vlen(vsub(a, b));
  const bc = vlen(vsub(b, c));
  const ca = vlen(vsub(c, a));
  const m = Math.max(ab, bc, ca);
  if (m <= MAX_EDGE || out.length > 400000) {
    out.push([a, b, c]);
    return;
  }
  const mid = (p: Vec3, q: Vec3) => vscale(vadd(p, q), 0.5);
  if (m === ab) {
    const d = mid(a, b);
    subdivide(a, d, c, out);
    subdivide(d, b, c, out);
  } else if (m === bc) {
    const d = mid(b, c);
    subdivide(a, b, d, out);
    subdivide(a, d, c, out);
  } else {
    const d = mid(c, a);
    subdivide(a, b, d, out);
    subdivide(d, b, c, out);
  }
}

export class LightBaker {
  private readonly lights: BakeLight[] = [];
  private readonly cache = new Map<string, THREE.Color>();

  constructor(private readonly level: Level) {
    for (const e of level.entities) {
      if (e.classname !== 'light') continue;
      const c = parseVec(e.props['_color'], v3(255, 255, 255));
      this.lights.push({
        pos: e.origin,
        color: new THREE.Color(c.x / 255, c.y / 255, c.z / 255),
        intensity: propNum(e, 'light', 1),
        range: propNum(e, 'range', 600),
      });
    }
  }

  /** Light arriving at point p on a surface with normal n (linear RGB). */
  sample(p: Vec3, n: Vec3): THREE.Color {
    const key = `${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)},${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const cyber = p.z < -1000;
    // Ambient: a little sky from above, darker from below.
    const up = n.z;
    const amb = cyber ? 0.35 : 0.24 + 0.08 * up;
    const out = new THREE.Color(amb * 0.85, amb * 0.9, amb * 1.1);
    const start = vadd(p, vscale(n, 2));
    for (const L of this.lights) {
      const d = vsub(L.pos, p);
      const dist = vlen(d);
      if (dist > L.range) continue;
      const ndl = vdot(n, vscale(d, 1 / Math.max(dist, 1e-3)));
      if (ndl <= 0) continue;
      const tr = this.level.collision.trace(start, L.pos, v3(), v3(), CONTENTS_SOLID, () => false);
      if (tr.fraction < 0.999) continue;
      const att = Math.pow(1 - dist / L.range, 1.6);
      const k = L.intensity * ndl * att * 0.95;
      out.r += L.color.r * k;
      out.g += L.color.g * k;
      out.b += L.color.b * k;
    }
    // Soft clamp: keep lit surfaces below the bloom threshold (only emissives glow).
    const peak = Math.max(out.r, out.g, out.b);
    if (peak > 0.92) out.multiplyScalar(0.92 / peak + (1 - 0.92 / peak) * 0.15);
    this.cache.set(key, out);
    return out;
  }
}

function addBrushes(brushes: Brush[], batches: Map<string, Batch>, baker: LightBaker | null): void {
  for (const b of brushes) {
    for (const f of b.faces) {
      if (isInvisibleTexture(f.texture)) continue;
      const key = f.texture.toLowerCase();
      let batch = batches.get(key);
      if (!batch) {
        batch = { pos: [], nrm: [], uv: [], col: [] };
        batches.set(key, batch);
      }
      const tile = materialFor(key).tile;
      const n = f.plane.normal;
      const v = f.verts;
      const unlit = isUnlitTexture(key) || !baker;
      const tris: Vec3[][] = [];
      for (let i = 1; i + 1 < v.length; i++) {
        if (unlit) tris.push([v[0]!, v[i]!, v[i + 1]!]);
        else subdivide(v[0]!, v[i]!, v[i + 1]!, tris);
      }
      for (const tri of tris) {
        for (const p of tri) {
          // sim(x,y,z) -> three(x, z, -y)
          batch.pos.push(p.x, p.z, -p.y);
          batch.nrm.push(n.x, n.z, -n.y);
          const [u, w] = faceUV(p, n, tile);
          batch.uv.push(u, w);
          if (unlit) batch.col.push(1, 1, 1);
          else {
            const c = baker!.sample(p, n);
            batch.col.push(c.r, c.g, c.b);
          }
        }
      }
    }
  }
}

function buildGroup(batches: Map<string, Batch>, ownMaterials = false): THREE.Group {
  const g = new THREE.Group();
  for (const [tex, b] of batches) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
    geo.computeBoundingSphere();
    const base = materialFor(tex).material;
    const mesh = new THREE.Mesh(geo, ownMaterials ? base.clone() : base);
    mesh.name = tex;
    if ((mesh.material as THREE.Material).transparent) mesh.renderOrder = 10;
    g.add(mesh);
  }
  return g;
}

export interface LevelVisuals {
  world: THREE.Group;
  /** Brush entities (doors, ICE, force fields, breakables...), keyed by entity id. */
  models: Map<number, { group: THREE.Group; classname: string }>;
}

/** Brush entity classes merged into the world at load (mirrors level.ts). */
const WORLD_CLASSES = new Set(['worldspawn', 'func_group', 'func_detail']);

export function buildLevelVisuals(level: Level, onProgress?: (f: number) => void): LevelVisuals {
  const baker = new LightBaker(level);
  const batches = new Map<string, Batch>();
  // Bake in chunks so a progress bar can update between them.
  addBrushes(level.world, batches, baker);
  onProgress?.(0.8);
  const world = buildGroup(batches);
  const models = new Map<number, { group: THREE.Group; classname: string }>();
  for (const e of level.entities) {
    if (!e.brushes.length || WORLD_CLASSES.has(e.classname)) continue;
    if (e.classname.startsWith('trigger_') || e.classname.startsWith('cyber_') && e.classname !== 'cyber_ice') continue;
    const mb = new Map<string, Batch>();
    const own = e.classname === 'cyber_ice' || e.classname === 'func_forcefield' || e.classname === 'func_breakable';
    addBrushes(e.brushes, mb, own ? null : baker);
    if (!mb.size) continue;
    const grp = buildGroup(mb, own);
    grp.name = `${e.classname}#${e.id}`;
    models.set(e.id, { group: grp, classname: e.classname });
  }
  onProgress?.(1);
  return { world, models };
}
