// Tiny level-building kit for procedural greybox maps. Produces plain .map
// brushes/entities, so the output can be opened and refined in TrenchBroom.

import {
  type MapBrush,
  type MapEntity,
  type MapFile,
  type Vec3,
  type Tex,
  v3,
  boxBrush,
  rampBrush,
  pointEntity,
  brushEntity,
} from '@d2/shared';

export interface Rect {
  a0: number;
  a1: number;
  z0: number;
  z1: number;
}

export type Side = 'n' | 's' | 'e' | 'w';

export interface HollowOpts {
  t?: number;
  wall?: Tex;
  floor?: Tex;
  ceil?: Tex;
  /** Openings per side; `a` runs along the wall (x for n/s walls, y for e/w walls). */
  open?: Partial<Record<Side, Rect[]>>;
  noFloor?: boolean;
  noCeil?: boolean;
  /** Skip a wall entirely (shared with a neighbour). */
  skip?: Side[];
  /** Neon trim along the top edge of walls. */
  trim?: string;
}

export class MapKit {
  readonly world: MapBrush[] = [];
  readonly ents: MapEntity[] = [];

  constructor(readonly worldProps: Record<string, string> = {}) {}

  box(mins: Vec3, maxs: Vec3, tex: Tex = 'd2/wall'): MapBrush {
    const b = boxBrush(mins, maxs, tex);
    this.world.push(b);
    return b;
  }

  ramp(mins: Vec3, maxs: Vec3, rise: '+x' | '-x' | '+y' | '-y', tex: Tex = 'd2/concrete'): MapBrush {
    const b = rampBrush(mins, maxs, rise, tex);
    this.world.push(b);
    return b;
  }

  /** Stairs rising along `rise` from mins.z to maxs.z in `steps` steps. */
  stairs(mins: Vec3, maxs: Vec3, rise: '+x' | '-x' | '+y' | '-y', steps: number, tex: Tex = { top: 'd2/metal', sides: 'd2/trim' }): void {
    const h = (maxs.z - mins.z) / steps;
    for (let i = 0; i < steps; i++) {
      const top = mins.z + h * (i + 1);
      const f = i / steps;
      const g = (i + 1) / steps;
      let a: Vec3;
      let b: Vec3;
      switch (rise) {
        case '+x':
          a = v3(mins.x + (maxs.x - mins.x) * f, mins.y, mins.z);
          b = v3(maxs.x, maxs.y, top);
          break;
        case '-x':
          a = v3(mins.x, mins.y, mins.z);
          b = v3(maxs.x - (maxs.x - mins.x) * f, maxs.y, top);
          break;
        case '+y':
          a = v3(mins.x, mins.y + (maxs.y - mins.y) * f, mins.z);
          b = v3(maxs.x, maxs.y, top);
          break;
        case '-y':
          a = v3(mins.x, mins.y, mins.z);
          b = v3(maxs.x, maxs.y - (maxs.y - mins.y) * f, top);
          break;
      }
      void g;
      this.box(a, b, tex);
    }
  }

  /**
   * A wall slab in the plane perpendicular to `axis` ('x' wall spans y, 'y' wall spans x),
   * from a0..a1 along the wall, z0..z1 vertically, with rectangular holes.
   */
  wall(axis: 'x' | 'y', c0: number, c1: number, a0: number, a1: number, z0: number, z1: number, holes: Rect[] = [], tex: Tex = 'd2/wall'): void {
    const hs = holes
      .map((h) => ({ a0: Math.max(h.a0, a0), a1: Math.min(h.a1, a1), z0: Math.max(h.z0, z0), z1: Math.min(h.z1, z1) }))
      .filter((h) => h.a1 > h.a0 && h.z1 > h.z0);
    const cuts = [...new Set([a0, a1, ...hs.flatMap((h) => [h.a0, h.a1])])].sort((p, q) => p - q);
    for (let i = 0; i + 1 < cuts.length; i++) {
      const u0 = cuts[i]!;
      const u1 = cuts[i + 1]!;
      const covering = hs.filter((h) => h.a0 <= u0 && h.a1 >= u1).sort((p, q) => p.z0 - q.z0);
      let z = z0;
      const spans: [number, number][] = [];
      for (const h of covering) {
        if (h.z0 > z) spans.push([z, h.z0]);
        z = Math.max(z, h.z1);
      }
      if (z < z1) spans.push([z, z1]);
      for (const [s0, s1] of spans) {
        if (axis === 'x') this.box(v3(c0, u0, s0), v3(c1, u1, s1), tex);
        else this.box(v3(u0, c0, s0), v3(u1, c1, s1), tex);
      }
    }
  }

  /** Hollow room whose interior is exactly mins..maxs. */
  hollow(mins: Vec3, maxs: Vec3, o: HollowOpts = {}): void {
    const t = o.t ?? 16;
    const wall = o.wall ?? 'd2/wall';
    const skip = new Set(o.skip ?? []);
    if (!o.noFloor) this.box(v3(mins.x - t, mins.y - t, mins.z - t), v3(maxs.x + t, maxs.y + t, mins.z), o.floor ?? 'd2/floor');
    if (!o.noCeil) this.box(v3(mins.x - t, mins.y - t, maxs.z), v3(maxs.x + t, maxs.y + t, maxs.z + t), o.ceil ?? 'd2/ceil');
    if (!skip.has('w')) this.wall('x', mins.x - t, mins.x, mins.y - t, maxs.y + t, mins.z, maxs.z, o.open?.w, wall);
    if (!skip.has('e')) this.wall('x', maxs.x, maxs.x + t, mins.y - t, maxs.y + t, mins.z, maxs.z, o.open?.e, wall);
    if (!skip.has('s')) this.wall('y', mins.y - t, mins.y, mins.x, maxs.x, mins.z, maxs.z, o.open?.s, wall);
    if (!skip.has('n')) this.wall('y', maxs.y, maxs.y + t, mins.x, maxs.x, mins.z, maxs.z, o.open?.n, wall);
    if (o.trim) this.trimRoom(mins, maxs, o.trim, maxs.z - 24);
  }

  /** Thin emissive strip around the inside of a room at height z. */
  trimRoom(mins: Vec3, maxs: Vec3, tex: string, z: number, h = 4, depth = 2): void {
    this.box(v3(mins.x, mins.y, z), v3(mins.x + depth, maxs.y, z + h), tex);
    this.box(v3(maxs.x - depth, mins.y, z), v3(maxs.x, maxs.y, z + h), tex);
    this.box(v3(mins.x, mins.y, z), v3(maxs.x, mins.y + depth, z + h), tex);
    this.box(v3(mins.x, maxs.y - depth, z), v3(maxs.x, maxs.y, z + h), tex);
  }

  /** Crate stack helper. */
  crate(x: number, y: number, z: number, sx: number, sy: number, sz: number, tex: Tex = { top: 'd2/metal', sides: 'd2/vent' }): void {
    this.box(v3(x, y, z), v3(x + sx, y + sy, z + sz), tex);
  }

  point(classname: string, origin: Vec3, props: Record<string, string | number> = {}): void {
    this.ents.push(pointEntity(classname, origin, props));
  }

  brushEnt(classname: string, brushes: MapBrush[], props: Record<string, string | number> = {}): void {
    this.ents.push(brushEntity(classname, brushes, props));
  }

  light(origin: Vec3, color = '255 240 220', intensity = 1, range = 600): void {
    this.point('light', origin, { _color: color, light: intensity, range });
  }

  build(): MapFile {
    return {
      entities: [{ props: { classname: 'worldspawn', mapversion: '220', ...this.worldProps }, brushes: this.world }, ...this.ents],
    };
  }
}

export const B = boxBrush;
export { v3 };
