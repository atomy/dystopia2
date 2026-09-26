// Bot navigation.
// Meatspace: an automatically generated grid of walkable spots (48u spacing,
// multiple floors per column) linked by walk/step/drop edges; A* on top.
// Edges that cross a door volume remember the door so paths can avoid it
// while it is closed for the bot's team.
// Cyberspace: the hand-authored d2_cyberpath waypoint graph from the map.

import {
  type Vec3,
  type Level,
  type BrushModel,
  v3,
  vdist,
  hullFor,
  DEFAULT_MOVE,
  MASK_PLAYERSOLID,
} from '@d2/shared';

const STEP = 48;
const MAX_STEP_UP = 18;
const MAX_DROP = 220;

export interface NavNode {
  id: number;
  pos: Vec3;
  edges: NavEdge[];
}

export interface NavEdge {
  to: number;
  cost: number;
  /** Entity id of a door/force field the edge passes through, or 0. */
  gate: number;
}

export class NavGraph {
  readonly nodes: NavNode[] = [];
  private readonly cells = new Map<string, number[]>();

  constructor(level: Level, gateIds: Set<number>) {
    const t0 = Date.now();
    this.build(level, gateIds);
    const edges = this.nodes.reduce((n, x) => n + x.edges.length, 0);
    console.log(`[nav] ${level.name}: ${this.nodes.length} nodes, ${edges} edges in ${Date.now() - t0} ms`);
  }

  private key(ix: number, iy: number): string {
    return `${ix},${iy}`;
  }

  private build(level: Level, gateIds: Set<number>): void {
    const col = level.collision;
    const hull = hullFor(DEFAULT_MOVE, false);
    // Clearance tests use the probe footprint (1u slimmer than the real hull) so a
    // player resting on a stair edge isn't rejected for touching the next riser.
    const navHull = { mins: v3(-15, -15, 0), maxs: v3(15, 15, hull.maxs.z) };
    // Movers are ignored while building (doors are "open"), so gates can be recorded.
    const noModels = (_m: BrushModel) => false;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const b of level.world) {
      if (b.maxs.z < -1000) continue; // skip cyberspace
      minX = Math.min(minX, b.mins.x);
      minY = Math.min(minY, b.mins.y);
      maxX = Math.max(maxX, b.maxs.x);
      maxY = Math.max(maxY, b.maxs.y);
    }
    if (!Number.isFinite(minX)) return;
    const ix0 = Math.ceil(minX / STEP);
    const ix1 = Math.floor(maxX / STEP);
    const iy0 = Math.ceil(minY / STEP);
    const iy1 = Math.floor(maxY / STEP);
    // Footprint-wide probe: a player rests on the highest surface under its hull.
    const probe = v3(-15, -15, 0);
    const probeMax = v3(15, 15, 4);

    // Candidate floors come from the tops of the brushes under each column.
    const solids = level.world.filter((b) => b.contents & MASK_PLAYERSOLID && b.maxs.z > -1000);
    for (let ix = ix0; ix <= ix1; ix++) {
      const x = ix * STEP;
      const colBrushes = solids.filter((b) => b.mins.x <= x + 15 && b.maxs.x >= x - 15);
      for (let iy = iy0; iy <= iy1; iy++) {
        const y = iy * STEP;
        const under = colBrushes.filter((b) => b.mins.y <= y + 15 && b.maxs.y >= y - 15);
        const list: number[] = [];
        const zs: number[] = [];
        for (const b of under.sort((a, c) => c.maxs.z - a.maxs.z)) {
          const tr = col.trace(v3(x, y, b.maxs.z + 20), v3(x, y, b.mins.z - 1), probe, probeMax, MASK_PLAYERSOLID, noModels);
          if (tr.startSolid || tr.fraction === 1 || tr.normal.z < 0.7) continue;
          const floorZ = tr.endpos.z;
          if (zs.some((z) => Math.abs(z - floorZ) < 8)) continue;
          zs.push(floorZ);
          const at = v3(x, y, floorZ + 1);
          if (col.testBox(at, navHull.mins, navHull.maxs, MASK_PLAYERSOLID, noModels)) continue;
          const id = this.nodes.length;
          this.nodes.push({ id, pos: at, edges: [] });
          list.push(id);
        }
        if (list.length) this.cells.set(this.key(ix, iy), list);
      }
    }

    // Edges to the 8 neighbours.
    const dirs = [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -1],
      [-1, 0],
      [0, -1],
      [-1, -1],
      [-1, 1],
    ] as const;
    const gateModels = [...gateIds].map((id) => col.models.get(id)).filter((m): m is BrushModel => !!m);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iy = iy0; iy <= iy1; iy++) {
        const here = this.cells.get(this.key(ix, iy));
        if (!here) continue;
        for (const a of here) {
          const A = this.nodes[a]!;
          for (const [dx, dy] of dirs) {
            const there = this.cells.get(this.key(ix + dx, iy + dy));
            if (!there) continue;
            for (const b of there) {
              const B = this.nodes[b]!;
              const dz = B.pos.z - A.pos.z;
              if (dz > 64 || dz < -MAX_DROP) continue;
              const up = Math.max(A.pos.z, B.pos.z) + MAX_STEP_UP;
              const s = v3(A.pos.x, A.pos.y, up);
              const e = v3(B.pos.x, B.pos.y, up);
              if (dz <= MAX_STEP_UP) {
                // Walk test: slide the hull across at step height.
                const tr = col.trace(s, e, hull.mins, hull.maxs, MASK_PLAYERSOLID, noModels);
                if (tr.fraction < 1 || tr.startSolid) continue;
              } else if (!this.stairsWalkable(col, A.pos, B.pos, navHull, noModels)) continue;
              let gate = 0;
              for (const m of gateModels) {
                if (segmentHitsBox(s, e, m.mins, m.maxs, 20)) {
                  gate = m.id;
                  break;
                }
              }
              const cost = vdist(A.pos, B.pos) + (dz < -60 ? 40 : 0);
              A.edges.push({ to: b, cost, gate });
            }
          }
        }
      }
    }
    this.pruneIslands();
  }

  /** Stairs/ramps: sample the ground along the edge; every rise must be a legal step. */
  private stairsWalkable(
    col: Level['collision'],
    a: Vec3,
    b: Vec3,
    hull: { mins: Vec3; maxs: Vec3 },
    filter: (m: BrushModel) => boolean,
  ): boolean {
    const N = 6;
    let prevZ = a.z;
    const probe = v3(-15, -15, 0);
    const probeMax = v3(15, 15, 4);
    for (let i = 1; i <= N; i++) {
      const t = i / N;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const top = Math.max(a.z, b.z) + 40;
      const tr = col.trace(v3(x, y, top), v3(x, y, Math.min(a.z, b.z) - 40), probe, probeMax, MASK_PLAYERSOLID, filter);
      if (tr.fraction === 1 || tr.startSolid || tr.normal.z < 0.7) return false;
      const z = tr.endpos.z;
      if (z - prevZ > MAX_STEP_UP) return false;
      if (col.testBox(v3(x, y, z + 1), hull.mins, hull.maxs, MASK_PLAYERSOLID, filter)) return false;
      prevZ = z;
    }
    return Math.abs(prevZ - b.z) < 4;
  }

  /** Remove tiny disconnected islands (tops of crates, ledges bots can't reach). */
  private pruneIslands(): void {
    const seen = new Int32Array(this.nodes.length).fill(-1);
    const sizes: number[] = [];
    for (const n of this.nodes) {
      if (seen[n.id] !== -1) continue;
      const comp = sizes.length;
      let size = 0;
      const stack = [n.id];
      seen[n.id] = comp;
      while (stack.length) {
        const c = stack.pop()!;
        size++;
        for (const e of this.nodes[c]!.edges) {
          if (seen[e.to] === -1) {
            seen[e.to] = comp;
            stack.push(e.to);
          }
        }
      }
      sizes.push(size);
    }
    for (const n of this.nodes) if ((sizes[seen[n.id]!] ?? 0) < 12) n.edges.length = 0;
  }

  nearest(p: Vec3, maxDist = 256): number {
    const ix = Math.round(p.x / STEP);
    const iy = Math.round(p.y / STEP);
    let best = -1;
    let bestD = maxDist;
    for (let r = 0; r <= 3; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          for (const id of this.cells.get(this.key(ix + dx, iy + dy)) ?? []) {
            const n = this.nodes[id]!;
            if (!n.edges.length) continue;
            const d = vdist(n.pos, p) + Math.abs(n.pos.z - p.z) * 2;
            if (d < bestD) {
              bestD = d;
              best = id;
            }
          }
        }
      }
      if (best >= 0) return best;
    }
    return best;
  }

  /** A* from `from` to `to`; `blocked(gate)` says whether a gate is closed. */
  path(from: number, to: number, blocked: (gate: number) => boolean, maxExpand = 20000): Vec3[] | null {
    if (from < 0 || to < 0) return null;
    if (from === to) return [this.nodes[to]!.pos];
    const goal = this.nodes[to]!.pos;
    const g = new Map<number, number>([[from, 0]]);
    const came = new Map<number, number>();
    const open = new MinHeap();
    open.push(from, vdist(this.nodes[from]!.pos, goal));
    const closed = new Set<number>();
    let expanded = 0;
    while (open.size) {
      const cur = open.pop();
      if (cur === to) break;
      if (closed.has(cur)) continue;
      closed.add(cur);
      if (++expanded > maxExpand) return null;
      const gc = g.get(cur)!;
      for (const e of this.nodes[cur]!.edges) {
        if (e.gate && blocked(e.gate)) continue;
        const ng = gc + e.cost;
        if (ng < (g.get(e.to) ?? Infinity)) {
          g.set(e.to, ng);
          came.set(e.to, cur);
          open.push(e.to, ng + vdist(this.nodes[e.to]!.pos, goal));
        }
      }
    }
    if (!came.has(to)) return null;
    const out: Vec3[] = [];
    let c: number | undefined = to;
    while (c !== undefined && c !== from) {
      out.push(this.nodes[c]!.pos);
      c = came.get(c);
    }
    out.reverse();
    return out;
  }
}

function segmentHitsBox(a: Vec3, b: Vec3, mins: Vec3, maxs: Vec3, pad: number): boolean {
  let t0 = 0;
  let t1 = 1;
  const d = v3(b.x - a.x, b.y - a.y, b.z - a.z);
  for (const k of ['x', 'y', 'z'] as const) {
    const lo = mins[k] - pad;
    const hi = maxs[k] + pad;
    if (Math.abs(d[k]) < 1e-9) {
      if (a[k] < lo || a[k] > hi) return false;
      continue;
    }
    let ta = (lo - a[k]) / d[k];
    let tb = (hi - a[k]) / d[k];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size(): number {
    return this.ids.length;
  }
  push(id: number, key: number): void {
    this.ids.push(id);
    this.keys.push(key);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p]! <= this.keys[i]!) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.ids[0]!;
    const lastId = this.ids.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.ids.length) {
      this.ids[0] = lastId;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.ids.length && this.keys[l]! < this.keys[m]!) m = l;
        if (r < this.ids.length && this.keys[r]! < this.keys[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    [this.ids[a], this.ids[b]] = [this.ids[b]!, this.ids[a]!];
    [this.keys[a], this.keys[b]] = [this.keys[b]!, this.keys[a]!];
  }
}

// ---------------------------------------------------------------------------

export interface CyberWaypoint {
  name: string;
  pos: Vec3;
  links: string[];
}

export class CyberGraph {
  readonly points = new Map<string, CyberWaypoint>();
  constructor(level: Level) {
    for (const e of level.entities) {
      if (e.classname !== 'd2_cyberpath') continue;
      const name = e.props['targetname'] ?? '';
      this.points.set(name, { name, pos: e.origin, links: (e.props['target'] ?? '').split(',').filter(Boolean) });
    }
  }
  nearest(p: Vec3): CyberWaypoint | null {
    let best: CyberWaypoint | null = null;
    let bd = Infinity;
    for (const w of this.points.values()) {
      const d = vdist(w.pos, p);
      if (d < bd) {
        bd = d;
        best = w;
      }
    }
    return best;
  }
  /** BFS by distance (Dijkstra) from a waypoint to the one nearest `goal`. */
  path(from: CyberWaypoint, goal: Vec3): Vec3[] {
    const target = this.nearest(goal);
    if (!target) return [];
    const dist = new Map<string, number>([[from.name, 0]]);
    const prev = new Map<string, string>();
    const todo = new Set<string>([from.name]);
    while (todo.size) {
      let cur = '';
      let cd = Infinity;
      for (const n of todo) {
        const d = dist.get(n)!;
        if (d < cd) {
          cd = d;
          cur = n;
        }
      }
      todo.delete(cur);
      if (cur === target.name) break;
      const w = this.points.get(cur)!;
      for (const l of w.links) {
        const o = this.points.get(l);
        if (!o) continue;
        const nd = cd + vdist(w.pos, o.pos);
        if (nd < (dist.get(l) ?? Infinity)) {
          dist.set(l, nd);
          prev.set(l, cur);
          todo.add(l);
        }
      }
    }
    const out: Vec3[] = [];
    let c: string | undefined = target.name;
    while (c && c !== from.name) {
      out.push(this.points.get(c)!.pos);
      c = prev.get(c);
    }
    if (c !== from.name) return [];
    out.reverse();
    return out;
  }
}
