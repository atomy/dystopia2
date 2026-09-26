import * as THREE from 'three';
import { type Brush, isInvisibleTexture, type Level, MOVER_CLASSES, type Vec3 } from '@d2/shared';
import { materialFor } from './materials.js';

interface Batch {
  pos: number[];
  nrm: number[];
  uv: number[];
}

/** Planar UV projection on the face's dominant axis, in world units / tile. */
function faceUV(p: Vec3, n: Vec3, tile: number): [number, number] {
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  if (az >= ax && az >= ay) return [p.x / tile, -p.y / tile];
  if (ax >= ay) return [p.y / tile, -p.z / tile];
  return [p.x / tile, -p.z / tile];
}

function addBrushes(brushes: Brush[], batches: Map<string, Batch>, offset: Vec3 = { x: 0, y: 0, z: 0 }): void {
  for (const b of brushes) {
    for (const f of b.faces) {
      if (isInvisibleTexture(f.texture)) continue;
      const key = f.texture.toLowerCase();
      let batch = batches.get(key);
      if (!batch) {
        batch = { pos: [], nrm: [], uv: [] };
        batches.set(key, batch);
      }
      const tile = materialFor(key).tile;
      const n = f.plane.normal;
      const v = f.verts;
      for (let i = 1; i + 1 < v.length; i++) {
        for (const p of [v[0]!, v[i]!, v[i + 1]!]) {
          // sim(x,y,z) -> three(x, z, -y)
          batch.pos.push(p.x - offset.x, p.z - offset.z, -(p.y - offset.y));
          batch.nrm.push(n.x, n.z, -n.y);
          const [u, w] = faceUV(p, n, tile);
          batch.uv.push(u, w);
        }
      }
    }
  }
}

function buildGroup(batches: Map<string, Batch>): THREE.Group {
  const g = new THREE.Group();
  for (const [tex, b] of batches) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, materialFor(tex).material);
    mesh.name = tex;
    if ((mesh.material as THREE.Material).transparent) mesh.renderOrder = 10;
    g.add(mesh);
  }
  return g;
}

export interface LevelVisuals {
  world: THREE.Group;
  /** Brush entities that move or toggle, keyed by entity id. Position = authored origin offset. */
  movers: Map<number, THREE.Group>;
}

export function buildLevelVisuals(level: Level): LevelVisuals {
  const batches = new Map<string, Batch>();
  addBrushes(level.world, batches);
  const world = buildGroup(batches);
  const movers = new Map<number, THREE.Group>();
  for (const e of level.entities) {
    if (!e.brushes.length || e.classname.startsWith('trigger_')) continue;
    if (MOVER_CLASSES.has(e.classname) || e.classname.startsWith('func_')) {
      const mb = new Map<string, Batch>();
      addBrushes(e.brushes, mb);
      const grp = buildGroup(mb);
      grp.name = `${e.classname}#${e.id}`;
      movers.set(e.id, grp);
    }
  }
  return { world, movers };
}
