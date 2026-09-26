// Turns a parsed .map into a playable level: world brushes, entities, collision.

import { type Vec3, v3 } from '../math.js';
import { parseMap, type MapFile } from './mapfile.js';
import { buildBrush, type Brush, CONTENTS_TRIGGER } from './brush.js';
import { CollisionWorld } from './collision.js';

export interface LevelEntity {
  /** Stable index in the map file; also used as the brush model id. */
  id: number;
  classname: string;
  props: Record<string, string>;
  origin: Vec3;
  /** Yaw in degrees (from "angle" or "angles"). */
  angle: number;
  brushes: Brush[];
  mins: Vec3;
  maxs: Vec3;
}

export interface Level {
  name: string;
  world: Brush[];
  entities: LevelEntity[];
  collision: CollisionWorld;
  byTargetname: Map<string, LevelEntity[]>;
}

/** Brush entity classes whose brushes are baked into static world geometry. */
const WORLD_BRUSH_CLASSES = new Set(['worldspawn', 'func_group', 'func_detail', 'func_illusionary_solid']);
/** Brush entity classes that are solid but can move/toggle at runtime. */
export const MOVER_CLASSES = new Set(['func_door', 'func_wall_toggle', 'func_forcefield', 'func_train']);

export const parseVec = (s: string | undefined, def: Vec3 = v3()): Vec3 => {
  if (!s) return { ...def };
  const [x, y, z] = s.trim().split(/\s+/).map(Number);
  return v3(x ?? 0, y ?? 0, z ?? 0);
};

export function propNum(e: { props: Record<string, string> }, key: string, def: number): number {
  const v = e.props[key];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export function loadLevel(name: string, src: string | MapFile): Level {
  const map = typeof src === 'string' ? parseMap(src) : src;
  const world: Brush[] = [];
  const entities: LevelEntity[] = [];
  const byTargetname = new Map<string, LevelEntity[]>();

  map.entities.forEach((me, id) => {
    const classname = me.props['classname'] ?? '';
    const brushes = me.brushes.map(buildBrush).filter((b): b is Brush => b !== null);
    if (WORLD_BRUSH_CLASSES.has(classname)) {
      world.push(...brushes);
      if (classname === 'worldspawn') {
        entities.push(makeEnt(id, classname, me.props, []));
      }
      return;
    }
    const ent = makeEnt(id, classname, me.props, brushes);
    if (classname.startsWith('trigger_')) for (const b of brushes) b.contents = CONTENTS_TRIGGER;
    entities.push(ent);
    const tn = me.props['targetname'];
    if (tn) {
      const list = byTargetname.get(tn) ?? [];
      list.push(ent);
      byTargetname.set(tn, list);
    }
  });

  const collision = new CollisionWorld(world);
  for (const e of entities) if (MOVER_CLASSES.has(e.classname) && e.brushes.length) collision.addModel(e.id, e.brushes);
  return { name, world, entities, collision, byTargetname };
}

function makeEnt(id: number, classname: string, props: Record<string, string>, brushes: Brush[]): LevelEntity {
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
  let origin = parseVec(props['origin']);
  if (brushes.length && !props['origin']) origin = v3((mins.x + maxs.x) / 2, (mins.y + maxs.y) / 2, (mins.z + maxs.z) / 2);
  let angle = Number(props['angle'] ?? NaN);
  if (!Number.isFinite(angle)) angle = parseVec(props['angles']).y;
  return { id, classname, props, origin, angle, brushes, mins, maxs };
}

export function entitiesOf(level: Level, classname: string): LevelEntity[] {
  return level.entities.filter((e) => e.classname === classname);
}
