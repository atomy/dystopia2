import * as THREE from 'three';
import {
  type Level,
  type LevelEntity,
  type NetEnt,
  type Vec3,
  EntKind,
  ProjKind,
  TEAM_COLORS,
  parseVec,
  v3,
  vnorm,
} from '@d2/shared';
import type { LevelVisuals } from './levelMesh.js';
import type { ClientWorld } from '../game/world.js';

const T = (v: Vec3) => new THREE.Vector3(v.x, v.z, -v.y);
const ICE_COLORS: Record<number, number> = { 0: 0xffd21f, 1: 0xff3b6b, 2: 0x2fb6ff, 3: 0xb04bff };
const teamColor = (t: number) => new THREE.Color(TEAM_COLORS[t] ?? '#dddddd');

function emissive(color: THREE.ColorRepresentation, k = 2): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false });
}

function label(text: string, color = '#d9e6ff'): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.font = 'bold 44px ui-monospace, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 10;
  g.fillStyle = color;
  g.fillText(text.toUpperCase(), 256, 48);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false }));
  s.scale.set(96, 18, 1);
  return s;
}

/** Orientation for a screen: faces `normal`, with `up` as up (sim coords). */
function orient(obj: THREE.Object3D, pos: Vec3, normal: Vec3, up: Vec3): void {
  obj.position.copy(T(pos));
  const n = T(normal);
  obj.up.copy(T(up));
  obj.lookAt(obj.position.clone().add(n));
}

function screenNormal(e: LevelEntity): { normal: Vec3; up: Vec3 } {
  const up = vnorm(parseVec(e.props['up'], v3(0, 0, 1)));
  if (Math.abs(up.z) > 0.5) {
    const a = (e.angle * Math.PI) / 180;
    return { normal: v3(Math.cos(a), Math.sin(a), 0), up };
  }
  return { normal: v3(0, 0, -1), up };
}

interface TurretVis {
  root: THREE.Group;
  head: THREE.Group;
  light: THREE.MeshBasicMaterial;
}

interface JipVis {
  root: THREE.Group;
  ring: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
}

interface ScreenVis {
  root: THREE.Group;
  frame: THREE.MeshBasicMaterial;
  bar: THREE.Mesh;
  lock: THREE.Mesh;
}

export class EntityRenderer {
  private readonly turrets = new Map<number, TurretVis>();
  private readonly jips = new Map<number, JipVis>();
  private readonly screens = new Map<number, ScreenVis>();
  private readonly cameras = new Map<number, THREE.MeshBasicMaterial>();
  private readonly dyn = new Map<number, THREE.Object3D>();
  private readonly iceMats = new Map<number, THREE.MeshBasicMaterial[]>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly level: Level,
    private readonly visuals: LevelVisuals,
  ) {
    for (const [id, m] of visuals.models) {
      scene.add(m.group);
      if (m.classname === 'cyber_ice') {
        const mats: THREE.MeshBasicMaterial[] = [];
        m.group.traverse((o) => {
          if (o instanceof THREE.Mesh) mats.push(o.material as THREE.MeshBasicMaterial);
        });
        this.iceMats.set(id, mats);
      }
    }
    for (const e of level.entities) {
      switch (e.classname) {
        case 'd2_turret':
          this.turrets.set(e.id, this.buildTurret(e));
          break;
        case 'd2_jackin':
          this.jips.set(e.id, this.buildJip(e));
          break;
        case 'd2_node':
        case 'd2_screen':
          this.screens.set(e.id, this.buildScreen(e));
          break;
        case 'd2_camera': {
          const m = emissive(0xffffff, 1.5);
          const g = new THREE.Group();
          g.add(new THREE.Mesh(new THREE.BoxGeometry(10, 8, 18), new THREE.MeshStandardMaterial({ color: 0x222630, metalness: 0.6, roughness: 0.4 })));
          const lens = new THREE.Mesh(new THREE.SphereGeometry(2.6, 10, 8), m);
          lens.position.z = -9;
          g.add(lens);
          g.position.copy(T(e.origin));
          g.rotation.y = ((e.angle - 90) * Math.PI) / 180;
          scene.add(g);
          this.cameras.set(e.id, m);
          break;
        }
        case 'd2_ammo': {
          const g = new THREE.Group();
          g.add(new THREE.Mesh(new THREE.BoxGeometry(28, 44, 16), new THREE.MeshStandardMaterial({ color: 0x2a3140, metalness: 0.5, roughness: 0.5 })));
          const s = new THREE.Mesh(new THREE.BoxGeometry(22, 6, 1), emissive(0x3dff7a, 2));
          s.position.set(0, 10, -8.5);
          g.add(s);
          g.position.copy(T(e.origin)).add(new THREE.Vector3(0, 22, 0));
          g.rotation.y = ((e.angle - 90) * Math.PI) / 180;
          scene.add(g);
          const l = label('AMMO', '#3dff7a');
          l.position.set(0, 34, 0);
          l.scale.set(60, 11, 1);
          g.add(l);
          break;
        }
      }
    }
  }

  private buildTurret(e: LevelEntity): TurretVis {
    const root = new THREE.Group();
    root.position.copy(T(e.origin));
    const body = new THREE.MeshStandardMaterial({ color: 0x2a2e38, metalness: 0.7, roughness: 0.35 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(10, 14, 20, 10), body);
    base.position.y = 10;
    root.add(base);
    const head = new THREE.Group();
    head.position.y = 26;
    root.add(head);
    head.add(new THREE.Mesh(new THREE.BoxGeometry(18, 14, 22), body));
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 26, 8), body);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -20;
    head.add(barrel);
    const light = emissive(0xffffff, 2.5);
    const eye = new THREE.Mesh(new THREE.BoxGeometry(12, 3, 1), light);
    eye.position.set(0, 3, -11.5);
    head.add(eye);
    this.scene.add(root);
    return { root, head, light };
  }

  private buildJip(e: LevelEntity): JipVis {
    const root = new THREE.Group();
    root.position.copy(T(e.origin)).add(new THREE.Vector3(0, 110, 0));
    const mat = emissive(0x3dff7a, 2);
    mat.transparent = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(9, 1.3, 6, 24), mat);
    root.add(ring);
    const tri = new THREE.Mesh(new THREE.ConeGeometry(4, 8, 3), mat);
    tri.rotation.x = Math.PI;
    tri.position.y = -14;
    root.add(tri);
    const l = label('JACK IN', '#3dff7a');
    l.position.y = 16;
    l.scale.set(56, 10.5, 1);
    root.add(l);
    this.scene.add(root);
    return { root, ring, mat };
  }

  private buildScreen(e: LevelEntity): ScreenVis {
    const root = new THREE.Group();
    const { normal, up } = screenNormal(e);
    orient(root, e.origin, normal, up);
    const w = 44;
    const h = 30;
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0x06121c }));
    root.add(panel);
    // A bright frame marks every usable screen (decorative screens never have one).
    const frame = emissive(0xffd21f, 2.2);
    const bw = 2;
    for (const [x, y, sx, sy] of [
      [0, h / 2, w + bw * 2, bw],
      [0, -h / 2, w + bw * 2, bw],
      [w / 2, 0, bw, h],
      [-w / 2, 0, bw, h],
    ] as const) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(sx, sy), frame);
      b.position.set(x, y, 0.3);
      root.add(b);
    }
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(w - 8, 4), emissive(0x3dff7a, 2));
    bar.position.set(0, -h / 2 + 5, 0.4);
    root.add(bar);
    const lock = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), emissive(0xff3b5c, 2.5));
    lock.position.set(0, 3, 0.4);
    root.add(lock);
    const text = label(e.props['label'] ?? 'NODE', '#d9e6ff');
    text.position.set(0, h / 2 + 10, 1);
    text.scale.set(90, 17, 1);
    root.add(text);
    this.scene.add(root);
    return { root, frame, bar, lock };
  }

  update(world: ClientWorld, time: number, localTeam: number, stage: number): void {
    // Brush models: doors, ICE, force fields, breakables.
    for (const [id, m] of this.visuals.models) {
      const st = world.ents.get(id);
      if (m.classname === 'func_door') {
        const off = world.doorOffset(id);
        m.group.position.set(off.x, off.z, -off.y);
      } else if (m.classname === 'func_forcefield') {
        m.group.visible = !st || (st.state & 1) === 1;
        if (st) {
          const c = teamColor(st.team).multiplyScalar(1.6 + Math.sin(time * 4) * 0.25);
          m.group.traverse((o) => {
            if (o instanceof THREE.Mesh) (o.material as THREE.MeshBasicMaterial).color.copy(c);
          });
        }
      } else if (m.classname === 'func_breakable') {
        m.group.visible = !st || (st.state & 1) === 0;
      } else if (m.classname === 'cyber_ice' && st) {
        const doorway = (st.state & 1) === 1;
        const wedged = st.value > 0;
        m.group.visible = !(doorway && st.team === 3);
        const mats = this.iceMats.get(id) ?? [];
        const c = new THREE.Color(ICE_COLORS[st.team] ?? 0xffffff).multiplyScalar(wedged ? 0.5 + Math.random() * 0.4 : 1.8);
        for (const mat of mats) {
          mat.color.copy(c);
          mat.opacity = wedged ? 0.25 : 0.8;
        }
      }
    }
    for (const [id, v] of this.turrets) {
      const st = world.ents.get(id);
      if (!st) continue;
      const alive = (st.state & 2) !== 0;
      const enabled = (st.state & 1) !== 0;
      v.root.visible = true;
      v.head.rotation.y = ((st.a / 10 - 90) * Math.PI) / 180;
      v.head.rotation.x = (-(st.b / 10) * Math.PI) / 180;
      v.head.visible = alive;
      v.light.color.copy(enabled ? teamColor(st.team).multiplyScalar(2.4) : new THREE.Color(0.15, 0.15, 0.15));
    }
    for (const [id, v] of this.jips) {
      const st = world.ents.get(id);
      if (!st) continue;
      const enabled = (st.state & 1) !== 0;
      const occupied = (st.state & 2) !== 0;
      const locked = st.value > 0.05;
      const usable = st.team === 0 || st.team === localTeam;
      v.root.visible = enabled && usable;
      v.mat.color.set(locked ? 0xff3b5c : occupied ? 0xffd21f : 0x3dff7a).multiplyScalar(2);
      v.ring.rotation.y = time * 1.5;
      v.root.position.y += Math.sin(time * 2 + id) * 0.05;
    }
    for (const [id, v] of this.screens) {
      const st = world.ents.get(id);
      if (!st) continue;
      const src = this.level.entities[id];
      const isNode = st.kind === EntKind.Node;
      const active = (st.state & 1) !== 0 && (!st.b || stage >= st.b || !isNode);
      const done = (st.state & 2) !== 0;
      const prot = isNode ? st.a & 15 : 0;
      v.frame.color.set(done ? 0x3dff7a : active ? (isNode ? TEAM_COLORS[st.team] ?? '#ffd21f' : '#ffd21f') : '#444444').multiplyScalar(active ? 2.2 : 1);
      v.bar.scale.x = Math.max(0.001, st.value);
      v.lock.visible = prot > 0;
      (v.lock.material as THREE.MeshBasicMaterial).color.set(prot === 2 ? 0xff2bd6 : 0xff3b5c).multiplyScalar(2.2);
      void src;
    }
    for (const [id, m] of this.cameras) {
      const st = world.ents.get(id);
      if (st) m.color.copy(teamColor(st.team).multiplyScalar(2.5));
    }
    // Dynamic entities.
    const live = new Set<number>();
    for (const st of world.ents.values()) {
      if (st.kind !== EntKind.Projectile && st.kind !== EntKind.Crystal) continue;
      live.add(st.id);
      let o = this.dyn.get(st.id);
      if (!o) {
        o = this.buildDynamic(st);
        this.dyn.set(st.id, o);
        this.scene.add(o);
      }
      if (st.origin) {
        // Extrapolate a little along the velocity for smoothness.
        const age = Math.min(0.1, time - ((o.userData['t'] as number | undefined) ?? time));
        const v = st.velocity ?? v3();
        o.position.set(st.origin.x + v.x * age, st.origin.z + v.z * age, -(st.origin.y + v.y * age));
        if (o.userData['src'] !== st.origin) {
          o.userData['src'] = st.origin;
          o.userData['t'] = time;
        }
      }
      o.rotation.y = time * 3;
      o.rotation.x = time * 1.7;
      if (st.kind === EntKind.Crystal) o.scale.setScalar(0.6 + Math.min(1.2, st.value / 20));
    }
    for (const [id, o] of this.dyn) {
      if (!live.has(id)) {
        this.scene.remove(o);
        this.dyn.delete(id);
      }
    }
  }

  private buildDynamic(st: NetEnt): THREE.Object3D {
    if (st.kind === EntKind.Crystal) return new THREE.Mesh(new THREE.OctahedronGeometry(9, 0), emissive(0x27e6ff, 2.4));
    switch (st.state) {
      case ProjKind.Frag:
        return new THREE.Mesh(new THREE.SphereGeometry(3, 8, 6), new THREE.MeshStandardMaterial({ color: 0x3a4a2a, metalness: 0.5, roughness: 0.5 }));
      case ProjKind.Emp: {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.SphereGeometry(3, 8, 6), new THREE.MeshStandardMaterial({ color: 0x2a2e38 })));
        g.add(new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.6, 6, 12), emissive(0x27e6ff, 2.5)));
        return g;
      }
      case ProjKind.CyberOrb:
        return new THREE.Mesh(new THREE.IcosahedronGeometry(7, 0), emissive(TEAM_COLORS[st.team] ?? '#ff2bd6', 3));
      case ProjKind.IceMine:
        return new THREE.Mesh(new THREE.TetrahedronGeometry(12, 0), emissive(0xff2a3d, 3));
    }
    return new THREE.Mesh(new THREE.SphereGeometry(3), emissive(0xffffff));
  }
}
