import * as THREE from 'three';

// Procedural "neon greybox" materials keyed by .map texture name (d2/<name>).
// Everything is drawn into canvases at startup: no image assets needed.

type Pattern = 'grid' | 'panel' | 'plates' | 'stripes' | 'solid' | 'screen' | 'cybergrid' | 'hex' | 'vent';

interface MatDef {
  base: string;
  line: string;
  pattern: Pattern;
  /** World units per texture repeat. */
  tile?: number;
  emissive?: string;
  emissiveIntensity?: number;
  /** Use the pattern itself as the emissive map (glowing lines). */
  emissiveFromPattern?: boolean;
  roughness?: number;
  metalness?: number;
  opacity?: number;
  unlit?: boolean;
}

const DEFS: Record<string, MatDef> = {
  floor: { base: '#23252b', line: '#34373f', pattern: 'grid', tile: 128, roughness: 0.85 },
  concrete: { base: '#2c2d31', line: '#26272b', pattern: 'panel', tile: 256, roughness: 0.95 },
  wall: { base: '#30323a', line: '#262830', pattern: 'panel', tile: 128, roughness: 0.8 },
  ceil: { base: '#1b1c21', line: '#15161a', pattern: 'grid', tile: 128, roughness: 0.9 },
  metal: { base: '#3a3f47', line: '#2a2e35', pattern: 'plates', tile: 64, roughness: 0.45, metalness: 0.6 },
  trim: { base: '#15161b', line: '#0c0d10', pattern: 'solid', roughness: 0.5, metalness: 0.4 },
  vent: { base: '#2a2d33', line: '#15171b', pattern: 'vent', tile: 64, roughness: 0.6, metalness: 0.5 },
  hazard: { base: '#d6a400', line: '#141414', pattern: 'stripes', tile: 64, roughness: 0.7 },
  door: { base: '#3d4450', line: '#e8b100', pattern: 'stripes', tile: 128, roughness: 0.5, metalness: 0.5 },
  glass: { base: '#7fd8ff', line: '#b8ecff', pattern: 'solid', roughness: 0.05, metalness: 0.1, opacity: 0.18 },
  punk: { base: '#3a1230', line: '#ff2bd6', pattern: 'panel', tile: 128, emissive: '#ff2bd6', emissiveIntensity: 0.15 },
  corp: { base: '#0f2436', line: '#27c6ff', pattern: 'panel', tile: 128, emissive: '#27c6ff', emissiveIntensity: 0.15 },
  neon_cyan: { base: '#27e6ff', line: '#27e6ff', pattern: 'solid', emissive: '#27e6ff', emissiveIntensity: 3, unlit: true },
  neon_magenta: { base: '#ff2bd6', line: '#ff2bd6', pattern: 'solid', emissive: '#ff2bd6', emissiveIntensity: 3, unlit: true },
  neon_yellow: { base: '#ffd21f', line: '#ffd21f', pattern: 'solid', emissive: '#ffd21f', emissiveIntensity: 3, unlit: true },
  neon_red: { base: '#ff2a3d', line: '#ff2a3d', pattern: 'solid', emissive: '#ff2a3d', emissiveIntensity: 3, unlit: true },
  neon_green: { base: '#3dff7a', line: '#3dff7a', pattern: 'solid', emissive: '#3dff7a', emissiveIntensity: 3, unlit: true },
  light: { base: '#fff4e0', line: '#fff4e0', pattern: 'solid', emissive: '#fff4e0', emissiveIntensity: 2.2, unlit: true },
  screen: { base: '#04121c', line: '#27e6ff', pattern: 'screen', tile: 64, emissiveFromPattern: true, emissiveIntensity: 1.6 },
  sky: { base: '#07030f', line: '#07030f', pattern: 'solid', unlit: true },
  // Cyberspace
  cyber_floor: { base: '#010308', line: '#18e8ff', pattern: 'cybergrid', tile: 128, emissiveFromPattern: true, emissiveIntensity: 1.4 },
  cyber_wall: { base: '#05010a', line: '#b22bff', pattern: 'cybergrid', tile: 256, emissiveFromPattern: true, emissiveIntensity: 1.1 },
  cyber_data: { base: '#020a06', line: '#2bff9a', pattern: 'hex', tile: 96, emissiveFromPattern: true, emissiveIntensity: 1.2 },
  cyber_ice: { base: '#1a0003', line: '#ff2a3d', pattern: 'hex', tile: 64, emissiveFromPattern: true, emissiveIntensity: 1.8, opacity: 0.85 },
};

const FALLBACK: MatDef = { base: '#2b2d33', line: '#3a3d45', pattern: 'grid', tile: 128 };

function drawPattern(def: MatDef, size = 256): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = def.base;
  g.fillRect(0, 0, size, size);
  g.strokeStyle = def.line;
  g.fillStyle = def.line;
  const s = size;
  switch (def.pattern) {
    case 'grid': {
      g.lineWidth = 2;
      for (let i = 0; i <= 4; i++) {
        const p = (i * s) / 4;
        g.globalAlpha = i % 2 === 0 ? 0.9 : 0.35;
        g.beginPath();
        g.moveTo(p, 0);
        g.lineTo(p, s);
        g.moveTo(0, p);
        g.lineTo(s, p);
        g.stroke();
      }
      g.globalAlpha = 1;
      noise(g, s, 0.05);
      break;
    }
    case 'panel': {
      g.lineWidth = 3;
      g.strokeRect(1.5, 1.5, s - 3, s - 3);
      g.lineWidth = 1;
      g.globalAlpha = 0.5;
      g.strokeRect(12, 12, s - 24, s - 24);
      g.globalAlpha = 1;
      noise(g, s, 0.06);
      break;
    }
    case 'plates': {
      g.lineWidth = 2;
      g.strokeRect(1, 1, s - 2, s - 2);
      for (const [x, y] of [
        [10, 10],
        [s - 10, 10],
        [10, s - 10],
        [s - 10, s - 10],
      ]) {
        g.beginPath();
        g.arc(x!, y!, 4, 0, Math.PI * 2);
        g.fill();
      }
      noise(g, s, 0.05);
      break;
    }
    case 'stripes': {
      g.save();
      g.beginPath();
      const w = s / 4;
      for (let i = -4; i < 8; i++) {
        g.moveTo(i * w * 2, 0);
        g.lineTo(i * w * 2 + w, 0);
        g.lineTo(i * w * 2 + w + s, s);
        g.lineTo(i * w * 2 + s, s);
        g.closePath();
      }
      g.fill();
      g.restore();
      break;
    }
    case 'vent': {
      for (let y = 8; y < s; y += 24) g.fillRect(8, y, s - 16, 10);
      break;
    }
    case 'screen': {
      g.globalAlpha = 0.8;
      g.font = `${s / 10}px monospace`;
      for (let y = s / 10; y < s; y += s / 8) {
        let line = '';
        for (let k = 0; k < 14; k++) line += Math.random() < 0.5 ? '0' : '1';
        g.fillText(line, 6, y);
      }
      g.globalAlpha = 1;
      g.lineWidth = 4;
      g.strokeRect(2, 2, s - 4, s - 4);
      break;
    }
    case 'cybergrid': {
      g.lineWidth = 2;
      g.shadowColor = def.line;
      g.shadowBlur = 8;
      for (let i = 0; i <= 8; i++) {
        const p = (i * s) / 8;
        g.globalAlpha = i % 4 === 0 ? 1 : 0.35;
        g.beginPath();
        g.moveTo(p, 0);
        g.lineTo(p, s);
        g.moveTo(0, p);
        g.lineTo(s, p);
        g.stroke();
      }
      g.globalAlpha = 1;
      break;
    }
    case 'hex': {
      g.lineWidth = 2;
      const r = s / 8;
      const h = Math.sqrt(3) * r;
      for (let row = -1; row < s / h + 1; row++)
        for (let col = -1; col < s / (1.5 * r) + 1; col++) {
          const cx = col * 1.5 * r;
          const cy = row * h + (col % 2 ? h / 2 : 0);
          g.beginPath();
          for (let k = 0; k < 6; k++) {
            const a = (Math.PI / 3) * k;
            g.lineTo(cx + r * 0.9 * Math.cos(a), cy + r * 0.9 * Math.sin(a));
          }
          g.closePath();
          g.stroke();
        }
      break;
    }
    case 'solid':
      break;
  }
  return c;
}

function noise(g: CanvasRenderingContext2D, s: number, amount: number): void {
  const img = g.getImageData(0, 0, s, s);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 255 * amount;
    d[i] = d[i]! + n;
    d[i + 1] = d[i + 1]! + n;
    d[i + 2] = d[i + 2]! + n;
  }
  g.putImageData(img, 0, 0);
}

export interface MaterialInfo {
  material: THREE.Material;
  tile: number;
}

const cache = new Map<string, MaterialInfo>();

export function materialFor(texture: string): MaterialInfo {
  const key = texture.toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;
  const name = key.replace(/^.*\//, '');
  const def = DEFS[name] ?? FALLBACK;
  const canvas = drawPattern(def);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  let material: THREE.Material;
  if (def.unlit) {
    const c = new THREE.Color(def.base);
    if (def.emissiveIntensity) c.multiplyScalar(def.emissiveIntensity);
    material = new THREE.MeshBasicMaterial({ color: c, fog: def.pattern !== 'solid' || name !== 'sky' });
  } else {
    const m = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: def.roughness ?? 0.8,
      metalness: def.metalness ?? 0,
    });
    if (def.emissiveFromPattern) {
      m.emissiveMap = tex;
      m.emissive = new THREE.Color('#ffffff');
      m.emissiveIntensity = def.emissiveIntensity ?? 1;
    } else if (def.emissive) {
      m.emissive = new THREE.Color(def.emissive);
      m.emissiveIntensity = def.emissiveIntensity ?? 1;
    }
    if (def.opacity !== undefined) {
      m.transparent = true;
      m.opacity = def.opacity;
      m.depthWrite = false;
    }
    material = m;
  }
  const info = { material, tile: def.tile ?? 128 };
  cache.set(key, info);
  return info;
}
