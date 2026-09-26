#!/usr/bin/env node
// Writes TrenchBroom preview textures for Dystopia 2's procedural materials.
//
// The game draws its "neon greybox" materials procedurally at runtime
// (packages/client/src/render/materials.ts), so there are no image assets.
// TrenchBroom needs real images, so this script renders roughly matching PNGs
// into tools/trenchbroom/Dystopia2/textures/d2/ (texture "d2/floor" ->
// textures/d2/floor.png) plus the game config icon (Dystopia2/Icon.png).
//
// Dependency-free: PNGs are encoded by hand (node:zlib for deflate).
// Output is deterministic (seeded noise), so re-running only changes files
// when this script changes.
//
// Usage: node tools/trenchbroom/gen-textures.mjs

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME_DIR = join(HERE, 'Dystopia2');
const TEX_DIR = join(GAME_DIR, 'textures', 'd2');

// ---------------------------------------------------------------------------
// PNG encoding

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** Encode a Canvas as an 8-bit RGB (opaque) or RGBA PNG. */
function encodePng(cv) {
  const ch = cv.alpha ? 4 : 3;
  const stride = cv.w * ch + 1;
  const raw = Buffer.alloc(stride * cv.h);
  const to8 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let y = 0; y < cv.h; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < cv.w; x++) {
      const s = (y * cv.w + x) * 4;
      const d = y * stride + 1 + x * ch;
      raw[d] = to8(cv.px[s]);
      raw[d + 1] = to8(cv.px[s + 1]);
      raw[d + 2] = to8(cv.px[s + 2]);
      if (ch === 4) raw[d + 3] = to8(cv.px[s + 3]);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(cv.w, 0);
  ihdr.writeUInt32BE(cv.h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = cv.alpha ? 6 : 2; // colour type: RGBA / RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Tiny raster canvas (float RGBA, straight alpha, wrap-around addressing so
// every pattern tiles seamlessly).

const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);

/** mulberry32, seeded from a string. */
function rng(seed) {
  let a = 2166136261;
  for (const c of seed) a = Math.imul(a ^ c.charCodeAt(0), 16777619);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Canvas {
  constructor(w, h, base, baseAlpha = 1) {
    this.w = w;
    this.h = h;
    this.alpha = baseAlpha < 1;
    this.px = new Float32Array(w * h * 4);
    const [r, g, b] = hex(base);
    for (let i = 0; i < w * h; i++) this.px.set([r, g, b, baseAlpha], i * 4);
  }

  /** Source-over blend of colour `c` (rgb 0..1) with coverage/alpha `a` at (x, y), wrapping. */
  blend(x, y, c, a) {
    if (a <= 0) return;
    a = Math.min(1, a);
    x = ((Math.floor(x) % this.w) + this.w) % this.w;
    y = ((Math.floor(y) % this.h) + this.h) % this.h;
    const i = (y * this.w + x) * 4;
    const p = this.px;
    const da = p[i + 3];
    const oa = a + da * (1 - a);
    for (let k = 0; k < 3; k++) p[i + k] = (c[k] * a + p[i + k] * da * (1 - a)) / oa;
    p[i + 3] = oa;
  }

  /** Additive light (for glows), clamped. */
  add(x, y, c, k) {
    if (k <= 0) return;
    const i = (y * this.w + x) * 4;
    for (let j = 0; j < 3; j++) this.px[i + j] = Math.min(1, this.px[i + j] + c[j] * k);
  }

  rect(x0, y0, w, h, c, a = 1) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.blend(x, y, c, a);
  }

  /** Outline of width `t` just inside the rectangle. */
  strokeRect(x0, y0, w, h, t, c, a = 1) {
    this.rect(x0, y0, w, t, c, a);
    this.rect(x0, y0 + h - t, w, t, c, a);
    this.rect(x0, y0 + t, t, h - 2 * t, c, a);
    this.rect(x0 + w - t, y0 + t, t, h - 2 * t, c, a);
  }

  disc(cx, cy, r, c, a = 1) {
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++)
      for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        this.blend(x, y, c, a * Math.max(0, Math.min(1, r + 0.5 - d)));
      }
  }

  /** Per-pixel coverage function f(u, v) -> 0..1, supersampled 4x4. */
  shade(f, c, a = 1) {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        let cov = 0;
        for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) cov += f(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4);
        this.blend(x, y, c, (a * cov) / 16);
      }
  }

  noise(amount, seed) {
    const r = rng(seed);
    for (let i = 0; i < this.w * this.h; i++) {
      const n = (r() - 0.5) * amount;
      for (let k = 0; k < 3; k++) this.px[i * 4 + k] = Math.max(0, Math.min(1, this.px[i * 4 + k] + n));
    }
  }

  text(str, x, y, font, c, a = 1, scale = 1) {
    for (const ch of str) {
      const g = font.glyphs[ch];
      if (g)
        g.forEach((row, gy) =>
          [...row].forEach((bit, gx) => {
            if (bit === '1') this.rect(x + gx * scale, y + gy * scale, scale, scale, c, a);
          }),
        );
      x += (font.w + 1) * scale;
    }
  }
}

// ---------------------------------------------------------------------------
// Bitmap fonts

const FONT3x5 = {
  w: 3,
  glyphs: {
    0: ['111', '101', '101', '101', '111'],
    1: ['010', '110', '010', '010', '111'],
  },
};

const FONT5x7 = {
  w: 5,
  glyphs: {
    A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
    D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
    E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
    I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
    K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
    L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
    O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
    2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  },
};

const textWidth = (str, font, scale = 1) => (str.length * (font.w + 1) - 1) * scale;

// ---------------------------------------------------------------------------
// Patterns (mirroring drawPattern() in packages/client/src/render/materials.ts)

/** Distance from coordinate u to the nearest multiple of `step` (wrapping). */
const distToLine = (u, step) => {
  const m = ((u % step) + step) % step;
  return Math.min(m, step - m);
};

/** Square grid; every other line is stronger (like the in-game 'grid'). */
function grid(name, size, base, line, divisions = 4, noise = 0.05) {
  const cv = new Canvas(size, size, base);
  const step = size / divisions;
  const c = hex(line);
  const major = (u) => distToLine(u, step * 2) < 1;
  const minor = (u) => distToLine(u, step) < 1;
  cv.shade((u, v) => (major(u) || major(v) ? 1 : 0), c, 0.9);
  cv.shade((u, v) => (!major(u) && !major(v) && (minor(u) || minor(v)) ? 1 : 0), c, 0.35);
  cv.noise(noise, name);
  return cv;
}

/** Framed panel with a faint inner frame (in-game 'panel'). */
function panel(name, size, base, line, noise = 0.06) {
  const cv = new Canvas(size, size, base);
  const c = hex(line);
  const inset = Math.round(size / 21);
  cv.strokeRect(0, 0, size, size, 2, c);
  cv.strokeRect(inset, inset, size - 2 * inset, size - 2 * inset, 1, c, 0.5);
  cv.noise(noise, name);
  return cv;
}

/** Riveted metal plate (in-game 'plates'). */
function plates(name, size, base, line) {
  const cv = new Canvas(size, size, base);
  const c = hex(line);
  cv.strokeRect(0, 0, size, size, 1, c);
  const r = size / 16;
  for (const [x, y] of [
    [r * 2.5, r * 2.5],
    [size - r * 2.5, r * 2.5],
    [r * 2.5, size - r * 2.5],
    [size - r * 2.5, size - r * 2.5],
  ])
    cv.disc(x, y, 1.5, c);
  cv.noise(0.05, name);
  return cv;
}

const solid = (size, base, alpha = 1) => new Canvas(size, size, base, alpha);

/** 45 degree stripes, 4 per tile width (in-game 'stripes'). */
function stripes(size, base, line) {
  const cv = new Canvas(size, size, base);
  const w = size / 4;
  cv.shade((u, v) => ((((u - v) % (2 * w)) + 2 * w) % (2 * w) < w ? 1 : 0), hex(line));
  return cv;
}

/** Horizontal vent slats (in-game 'vent'). */
function vent(size, base, line) {
  const cv = new Canvas(size, size, base);
  const pitch = size / 8;
  for (let y = pitch / 4; y < size; y += pitch) cv.rect(2, y, size - 4, pitch / 2, hex(line));
  return cv;
}

/** Dark display with rows of random 0/1 digits (in-game 'screen'). */
function screen(name, size, base, line) {
  const cv = new Canvas(size, size, base);
  const c = hex(line);
  const r = rng(name);
  const cols = Math.floor((size - 6) / 4);
  for (let row = 0; row * 8 + 7 <= size; row++) {
    let s = '';
    for (let k = 0; k < cols; k++) s += r() < 0.5 ? '0' : '1';
    cv.text(s, 4, row * 8 + 2, FONT3x5, c, 0.8);
  }
  cv.strokeRect(0, 0, size, size, 1, c);
  return cv;
}

/** Glowing cyberspace grid: `divisions` lines per tile, every 4th one bright. */
function cybergrid(size, base, line, divisions) {
  const cv = new Canvas(size, size, base);
  const c = hex(line);
  const step = size / divisions;
  const sigma = 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dMajor = Math.min(distToLine(x + 0.5, step * 4), distToLine(y + 0.5, step * 4));
      const dMinor = Math.min(distToLine(x + 0.5, step), distToLine(y + 0.5, step));
      const cov = (d, w) => Math.max(0, Math.min(1, w / 2 + 0.5 - d));
      const glow = (d) => Math.exp((-d * d) / (2 * sigma * sigma));
      cv.blend(x, y, c, Math.max(cov(dMajor, 2), 0.35 * cov(dMinor, 1)));
      cv.add(x, y, c, 0.45 * glow(dMajor) + 0.12 * glow(dMinor));
    }
  return cv;
}

/**
 * Flat-top hexagon outlines (in-game 'hex'): `cols` x `rows` cells per tile,
 * outlines at 0.9 of the cell radius so neighbouring cells show a small gap.
 * The lattice is squashed slightly so it tiles in a square.
 */
function hexgrid(size, base, line, cols, rows) {
  const cv = new Canvas(size, size, base);
  const c = hex(line);
  const dx = size / cols; // column spacing = 1.5 r
  const r = dx / 1.5;
  const h = size / rows; // row spacing (ideally sqrt(3) r)
  const squash = (Math.sqrt(3) * r) / h;
  const k = Math.sqrt(3) / 2;
  const wrap = (d) => d - size * Math.round(d / size);
  const rho = (px, py) => {
    // hex "radius" of (px, py) relative to its nearest cell centre
    let best = Infinity;
    const col0 = Math.round(px / dx);
    for (let col = col0 - 1; col <= col0 + 1; col++) {
      const off = ((col % 2) + 2) % 2 ? h / 2 : 0;
      const row0 = Math.round((py - off) / h);
      for (let row = row0 - 1; row <= row0 + 1; row++) {
        const ex = Math.abs(wrap(px - col * dx));
        const ey = Math.abs(wrap(py - (row * h + off))) * squash;
        best = Math.min(best, Math.max(ey, k * ex + ey / 2) / k);
      }
    }
    return best;
  };
  const lw = 1.5;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = k * Math.abs(rho(x + 0.5, y + 0.5) - 0.9 * r); // perpendicular distance to the outline
      cv.blend(x, y, c, Math.max(0, Math.min(1, lw / 2 + 0.5 - d)));
      cv.add(x, y, c, 0.3 * Math.exp(-(d * d) / 4));
    }
  return cv;
}

/** Sparse dim stars on the night sky colour. */
function sky(name, size, base) {
  const cv = new Canvas(size, size, base);
  const r = rng(name);
  const tints = ['#ffffff', '#ff2bd6', '#27e6ff'];
  for (let i = 0; i < 14; i++) cv.blend(r() * size, r() * size, hex(tints[i % 3]), 0.25 + r() * 0.45);
  return cv;
}

/** Tool texture: colour, diagonal hatch, frame and a centred label (twice). */
function tool(size, base, ink, label, alpha = 1) {
  const cv = new Canvas(size, size, base, alpha);
  const c = hex(ink);
  const w = size / 8;
  cv.shade((u, v) => ((((u + v) % (2 * w)) + 2 * w) % (2 * w) < w * 0.35 ? 1 : 0), c, 0.18);
  cv.strokeRect(0, 0, size, size, 1, c, 0.8);
  const tw = textWidth(label, FONT5x7);
  cv.text(label, Math.round((size - tw) / 2), Math.round(size * 0.25) - 3, FONT5x7, c, 0.95);
  cv.text(label, Math.round((size - tw) / 2), Math.round(size * 0.75) - 4, FONT5x7, c, 0.95);
  return cv;
}

/** Translucent force field: cyan with brighter scanlines. */
function forcefield(size) {
  const cv = new Canvas(size, size, '#27e6ff', 0.55);
  const c = hex('#bdf6ff');
  for (let y = 0; y < size; y += 4) cv.rect(0, y, size, 1, c, 0.5);
  cv.shade((u, v) => ((((u + 2 * v) % size) + size) % size < 3 ? 1 : 0), c, 0.35);
  cv.strokeRect(0, 0, size, size, 1, c, 0.8);
  return cv;
}

/** Translucent glass with two highlight streaks. */
function glass(size, base, line) {
  const cv = new Canvas(size, size, base, 0.55);
  const c = hex(line);
  cv.shade((u, v) => {
    const d = (((u + v) % size) + size) % size;
    return (d > size * 0.2 && d < size * 0.28) || (d > size * 0.36 && d < size * 0.4) ? 1 : 0;
  }, c, 0.6);
  cv.strokeRect(0, 0, size, size, 1, c, 0.7);
  return cv;
}

/** 32x32 game icon: 'D2' on a dark rounded square. */
function icon() {
  const size = 32;
  const cv = new Canvas(size, size, '#000000', 0);
  cv.alpha = true;
  const bg = hex('#0b0710');
  const rad = 6;
  cv.shade((u, v) => {
    const qx = Math.max(rad - u, u - (size - rad), 0);
    const qy = Math.max(rad - v, v - (size - rad), 0);
    return Math.hypot(qx, qy) <= rad ? 1 : 0;
  }, bg);
  const w = textWidth('D2', FONT5x7, 2);
  const x = Math.round((size - w) / 2);
  cv.text('D', x, 7, FONT5x7, hex('#ff2bd6'), 1, 2);
  cv.text('2', x + 12, 7, FONT5x7, hex('#27e6ff'), 1, 2);
  cv.rect(x, 24, w, 1, hex('#27e6ff'), 0.9);
  return cv;
}

// ---------------------------------------------------------------------------
// Texture list (colours from packages/client/src/render/materials.ts)

const TEXTURES = {
  floor: () => grid('floor', 128, '#23252b', '#34373f'),
  concrete: () => panel('concrete', 128, '#2c2d31', '#26272b', 0.07),
  wall: () => panel('wall', 128, '#30323a', '#262830'),
  ceil: () => grid('ceil', 128, '#1b1c21', '#15161a', 4, 0.06),
  metal: () => plates('metal', 64, '#3a3f47', '#2a2e35'),
  trim: () => solid(64, '#15161b'),
  vent: () => vent(64, '#2a2d33', '#15171b'),
  hazard: () => stripes(64, '#d6a400', '#141414'),
  door: () => stripes(128, '#3d4450', '#e8b100'),
  glass: () => glass(64, '#7fd8ff', '#b8ecff'),
  punk: () => panel('punk', 128, '#3a1230', '#ff2bd6', 0.04),
  corp: () => panel('corp', 128, '#0f2436', '#27c6ff', 0.04),
  neon_cyan: () => solid(64, '#27e6ff'),
  neon_magenta: () => solid(64, '#ff2bd6'),
  neon_yellow: () => solid(64, '#ffd21f'),
  neon_red: () => solid(64, '#ff2a3d'),
  neon_green: () => solid(64, '#3dff7a'),
  light: () => solid(64, '#fff4e0'),
  screen: () => screen('screen', 64, '#04121c', '#27e6ff'),
  sky: () => sky('sky', 64, '#07030f'),
  // Cyberspace (cyber_floor = gravity tiles)
  cyber_floor: () => cybergrid(128, '#010308', '#18e8ff', 8),
  cyber_wall: () => cybergrid(128, '#05010a', '#b22bff', 4),
  cyber_data: () => hexgrid(128, '#020a06', '#2bff9a', 8, 7),
  cyber_ice: () => hexgrid(64, '#1a0003', '#ff2a3d', 6, 5),
  forcefield: () => forcefield(64),
  // Tool textures (invisible in game)
  trigger: () => tool(64, '#ff8c00', '#3a1600', 'TRIGGER', 0.62),
  clip: () => tool(64, '#8a3cc8', '#f0e0ff', 'CLIP'),
  nodraw: () => tool(64, '#34343c', '#ffd21f', 'NODRAW'),
  skip: () => tool(64, '#28585f', '#d8fbff', 'SKIP'),
};

mkdirSync(TEX_DIR, { recursive: true });
for (const [name, make] of Object.entries(TEXTURES)) {
  const cv = make();
  const file = join(TEX_DIR, `${name}.png`);
  writeFileSync(file, encodePng(cv));
  console.log(`${relative(process.cwd(), file)}  ${cv.w}x${cv.h} ${cv.alpha ? 'RGBA' : 'RGB'}`);
}
const iconFile = join(GAME_DIR, 'Icon.png');
writeFileSync(iconFile, encodePng(icon()));
console.log(`${relative(process.cwd(), iconFile)}  32x32 RGBA`);
