// Parser for Quake-style .map files as written by TrenchBroom.
// Supports both the "Standard" (Quake) and "Valve" (220) face formats.

import type { Vec3 } from '../math.js';

export interface MapFace {
  /** Three points on the plane, in file order. normal = (p0 - p1) x (p2 - p1) points out of the brush. */
  points: [Vec3, Vec3, Vec3];
  texture: string;
  /** Valve 220 texture axes (only present in Valve format). */
  uAxis?: { x: number; y: number; z: number; offset: number };
  vAxis?: { x: number; y: number; z: number; offset: number };
  offsetX: number;
  offsetY: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

export interface MapBrush {
  faces: MapFace[];
}

export interface MapEntity {
  props: Record<string, string>;
  brushes: MapBrush[];
}

export interface MapFile {
  entities: MapEntity[];
}

class Tokenizer {
  private i = 0;
  constructor(private readonly src: string) {}

  private skipWs(): void {
    const s = this.src;
    for (;;) {
      while (this.i < s.length && /\s/.test(s[this.i]!)) this.i++;
      if (s.startsWith('//', this.i)) {
        const nl = s.indexOf('\n', this.i);
        this.i = nl < 0 ? s.length : nl + 1;
        continue;
      }
      break;
    }
  }

  peek(): string | null {
    const save = this.i;
    const t = this.next();
    this.i = save;
    return t;
  }

  next(): string | null {
    this.skipWs();
    const s = this.src;
    if (this.i >= s.length) return null;
    const c = s[this.i]!;
    if ('{}()[]'.includes(c)) {
      this.i++;
      return c;
    }
    if (c === '"') {
      let j = this.i + 1;
      let out = '';
      while (j < s.length && s[j] !== '"') {
        if (s[j] === '\\' && s[j + 1] === '"') {
          out += '"';
          j += 2;
          continue;
        }
        out += s[j];
        j++;
      }
      this.i = j + 1;
      return '"' + out;
    }
    let j = this.i;
    while (j < s.length && !/\s/.test(s[j]!) && !'{}()[]"'.includes(s[j]!)) j++;
    const tok = s.slice(this.i, j);
    this.i = j;
    return tok;
  }

  expect(t: string): void {
    const got = this.next();
    if (got !== t) throw new Error(`map parse error: expected '${t}', got '${got}' at offset ${this.i}`);
  }

  num(): number {
    const t = this.next();
    const n = t === null ? NaN : Number(t);
    if (!Number.isFinite(n)) throw new Error(`map parse error: expected number, got '${t}' at offset ${this.i}`);
    return n;
  }
}

function parseFace(tk: Tokenizer): MapFace {
  const pts: Vec3[] = [];
  for (let k = 0; k < 3; k++) {
    tk.expect('(');
    pts.push({ x: tk.num(), y: tk.num(), z: tk.num() });
    tk.expect(')');
  }
  const tex = tk.next();
  if (tex === null) throw new Error('map parse error: missing texture');
  const texture = tex.startsWith('"') ? tex.slice(1) : tex;
  const face: MapFace = {
    points: [pts[0]!, pts[1]!, pts[2]!],
    texture,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
  };
  if (tk.peek() === '[') {
    tk.expect('[');
    face.uAxis = { x: tk.num(), y: tk.num(), z: tk.num(), offset: tk.num() };
    tk.expect(']');
    tk.expect('[');
    face.vAxis = { x: tk.num(), y: tk.num(), z: tk.num(), offset: tk.num() };
    tk.expect(']');
    face.offsetX = face.uAxis.offset;
    face.offsetY = face.vAxis.offset;
  } else {
    face.offsetX = tk.num();
    face.offsetY = tk.num();
  }
  face.rotation = tk.num();
  face.scaleX = tk.num();
  face.scaleY = tk.num();
  // Quake 2/3 style trailing surface flags: consume numbers until next '(' or '}'.
  for (;;) {
    const p = tk.peek();
    if (p === null || p === '(' || p === '}') break;
    tk.next();
  }
  return face;
}

export function parseMap(src: string): MapFile {
  const tk = new Tokenizer(src);
  const entities: MapEntity[] = [];
  for (;;) {
    const t = tk.next();
    if (t === null) break;
    if (t !== '{') throw new Error(`map parse error: expected '{' at top level, got '${t}'`);
    const ent: MapEntity = { props: {}, brushes: [] };
    for (;;) {
      const p = tk.next();
      if (p === null) throw new Error('map parse error: unexpected EOF in entity');
      if (p === '}') break;
      if (p.startsWith('"')) {
        const val = tk.next();
        if (val === null || !val.startsWith('"')) throw new Error('map parse error: expected value string');
        ent.props[p.slice(1)] = val.slice(1);
        continue;
      }
      if (p === '{') {
        const brush: MapBrush = { faces: [] };
        // Brush primitives (patches) are not supported; skip them wholesale.
        if (tk.peek() !== '(') {
          let depth = 1;
          while (depth > 0) {
            const q = tk.next();
            if (q === null) break;
            if (q === '{') depth++;
            else if (q === '}') depth--;
          }
          continue;
        }
        while (tk.peek() === '(') brush.faces.push(parseFace(tk));
        tk.expect('}');
        ent.brushes.push(brush);
        continue;
      }
      throw new Error(`map parse error: unexpected token '${p}' in entity`);
    }
    entities.push(ent);
  }
  return { entities };
}

// ---------------------------------------------------------------------------
// Writing (used by the procedural map generator so output opens in TrenchBroom)

const fmt = (n: number): string => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

export function writeMap(map: MapFile, header = '// Game: Dystopia 2\n// Format: Valve\n'): string {
  let out = header;
  map.entities.forEach((ent, ei) => {
    out += `// entity ${ei}\n{\n`;
    for (const [k, v] of Object.entries(ent.props)) out += `"${k}" "${v}"\n`;
    ent.brushes.forEach((b, bi) => {
      out += `// brush ${bi}\n{\n`;
      for (const f of b.faces) {
        const p = f.points.map((q) => `( ${fmt(q.x)} ${fmt(q.y)} ${fmt(q.z)} )`).join(' ');
        const u = f.uAxis ?? { x: 1, y: 0, z: 0, offset: 0 };
        const v = f.vAxis ?? { x: 0, y: -1, z: 0, offset: 0 };
        out += `${p} ${f.texture} [ ${fmt(u.x)} ${fmt(u.y)} ${fmt(u.z)} ${fmt(u.offset)} ] [ ${fmt(v.x)} ${fmt(v.y)} ${fmt(v.z)} ${fmt(v.offset)} ] ${fmt(f.rotation)} ${fmt(f.scaleX)} ${fmt(f.scaleY)}\n`;
      }
      out += '}\n';
    });
    out += '}\n';
  });
  return out;
}
