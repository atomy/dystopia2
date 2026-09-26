import * as THREE from 'three';
import { WeaponId, TEAM_COLORS } from '@d2/shared';

// First-person weapon models (procedural) with bob, recoil, reload and swing.

function mat(color: number, metal = 0.25, rough = 0.45): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough, emissive: color, emissiveIntensity: 0.12 });
}

function glowMat(color: THREE.ColorRepresentation, k = 2.5): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false });
}

function part(g: THREE.Group, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  g.add(mesh);
  return mesh;
}

function buildWeapon(id: number, team: number): THREE.Group {
  const g = new THREE.Group();
  const body = mat(0x4a505c);
  const dark = mat(0x262930, 0.3, 0.6);
  const glow = glowMat(TEAM_COLORS[team] ?? '#27e6ff', 1.3);
  const hand = mat(0x2c2f38, 0.1, 0.8);
  const B = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  const C = (r: number, l: number, s = 10) => new THREE.CylinderGeometry(r, r, l, s);
  switch (id) {
    case WeaponId.MachinePistol:
      part(g, B(1.6, 2.2, 7), body, 0, 0, -3);
      part(g, B(1.4, 3.6, 1.6), dark, 0, -2.4, -0.6, 0.25);
      part(g, B(1.2, 2.6, 1.2), dark, 0, -1.8, -4.5);
      part(g, C(0.35, 2.5), dark, 0, 0.4, -7.5, Math.PI / 2);
      part(g, B(1.7, 0.3, 4), glow, 0, 1.2, -3);
      break;
    case WeaponId.Shotgun:
      part(g, B(2, 2.4, 14), body, 0, 0, -6);
      part(g, C(0.55, 12), dark, 0.5, 0.5, -12, Math.PI / 2);
      part(g, C(0.55, 12), dark, -0.5, 0.5, -12, Math.PI / 2);
      part(g, B(1.8, 3.4, 5), dark, 0, -1.8, 1.5, -0.3);
      part(g, B(2.2, 1.2, 5), glow, 0, -1, -8);
      break;
    case WeaponId.AssaultRifle:
      part(g, B(2, 3, 16), body, 0, 0, -6);
      part(g, C(0.45, 8), dark, 0, 0.5, -17, Math.PI / 2);
      part(g, B(1.4, 4.5, 2.2), dark, 0, -3.2, -6, 0.2);
      part(g, B(1.6, 3, 5), dark, 0, -0.6, 3);
      part(g, B(1.4, 1.2, 5), dark, 0, 2.1, -5);
      part(g, B(2.08, 0.25, 10), glow, 0, -0.4, -8);
      break;
    case WeaponId.Minigun: {
      part(g, B(5, 5, 12), body, 0, -0.5, -2);
      const barrels = new THREE.Group();
      barrels.name = 'barrels';
      barrels.position.set(0, 0, -10);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        part(barrels, C(0.45, 16), dark, Math.cos(a) * 1.4, Math.sin(a) * 1.4, -6, Math.PI / 2);
      }
      part(barrels, C(2.2, 1, 12), body, 0, 0, -12, Math.PI / 2);
      g.add(barrels);
      part(g, B(5.2, 1, 8), glow, 0, 2.2, -2);
      break;
    }
    case WeaponId.Katana: {
      part(g, C(0.55, 6), dark, 0, -1, 0);
      part(g, B(2.2, 0.5, 2.2), body, 0, 2.2, 0);
      const blade = part(g, B(0.25, 30, 1.4), glowMat('#bfefff', 1.6), 0, 17.5, 0);
      blade.name = 'blade';
      break;
    }
    case WeaponId.Fist:
      part(g, B(6, 6, 9), body, 0, 0, -2);
      part(g, B(6.4, 1, 6), glow, 0, 3.4, -2);
      part(g, C(1.2, 6), dark, 0, 0, 4, Math.PI / 2);
      break;
    case WeaponId.EmpGrenade:
      part(g, new THREE.SphereGeometry(1.8, 12, 8), body, 0, 0, -2);
      part(g, new THREE.TorusGeometry(1.9, 0.3, 6, 16), glowMat('#27e6ff'), 0, 0, -2, Math.PI / 2);
      break;
    case WeaponId.FragGrenade:
      part(g, new THREE.SphereGeometry(1.8, 10, 8), mat(0x3a4a2a), 0, 0, -2);
      part(g, B(0.6, 1.4, 0.6), dark, 0, 2, -2);
      break;
  }
  // A gloved hand under the grip.
  if (id !== WeaponId.Fist) part(g, B(2.6, 2.6, 3.2), hand, 0, -2.4, 0.5);
  return g;
}

function buildDeckHands(team: number): THREE.Group {
  const g = new THREE.Group();
  const glow = glowMat(TEAM_COLORS[team] ?? '#27e6ff', 2.2);
  const wire = new THREE.MeshBasicMaterial({ color: new THREE.Color('#27e6ff').multiplyScalar(1.8), wireframe: true, toneMapped: false });
  for (const side of [-1, 1]) {
    part(g, new THREE.OctahedronGeometry(1.8, 0), wire, side * 8, -2.5, -9);
    part(g, new THREE.BoxGeometry(0.5, 0.5, 5), glow, side * 8, -3.2, -4);
  }
  return g;
}

export class ViewModel {
  readonly root = new THREE.Group();
  private weapons = new Map<number, THREE.Group>();
  private deck: THREE.Group | null = null;
  private current = -1;
  private team = 0;
  private bobT = 0;
  private kick = 0;
  private swing = 0;
  private swingDir = 0;
  private switchT = 1;
  private spin = 0;
  private muzzle: THREE.Sprite;

  constructor(private readonly camera: THREE.Camera, scene: THREE.Scene) {
    scene.add(camera);
    camera.add(this.root);
    const tex = makeFlashTexture();
    this.muzzle = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xffe0a0, blending: THREE.AdditiveBlending, depthTest: false, toneMapped: false }));
    this.muzzle.scale.set(9, 9, 1);
    this.muzzle.visible = false;
    this.root.add(this.muzzle);
  }

  setTeam(team: number): void {
    if (team === this.team) return;
    this.team = team;
    for (const w of this.weapons.values()) this.root.remove(w);
    this.weapons.clear();
    if (this.deck) this.root.remove(this.deck);
    this.deck = null;
    this.current = -1;
  }

  fire(weapon: number): void {
    const def = weapon === WeaponId.Shotgun ? 1.6 : weapon === WeaponId.Minigun ? 0.35 : weapon === WeaponId.AssaultRifle ? 0.55 : 0.8;
    this.kick = Math.min(1.6, this.kick + def);
    this.muzzle.visible = true;
    this.muzzle.material.rotation = Math.random() * Math.PI;
    setTimeout(() => (this.muzzle.visible = false), 45);
  }

  melee(dir: number): void {
    this.swing = 1;
    this.swingDir = dir;
  }

  update(dt: number, s: { weapon: number; speed: number; onGround: boolean; reloading: boolean; decked: boolean; alive: boolean; spin: number; zoomed: boolean; blocking: boolean; pitch: number }): void {
    this.root.visible = s.alive;
    if (!s.alive) return;
    const want = s.decked ? -100 : s.weapon;
    if (want !== this.current) {
      for (const w of this.weapons.values()) w.visible = false;
      if (this.deck) this.deck.visible = false;
      this.current = want;
      this.switchT = 0;
      if (s.decked) {
        this.deck ??= buildDeckHands(this.team);
        if (!this.deck.parent) this.root.add(this.deck);
        this.deck.visible = true;
      } else {
        let w = this.weapons.get(want);
        if (!w) {
          w = buildWeapon(want, this.team);
          this.weapons.set(want, w);
          this.root.add(w);
        }
        w.visible = true;
      }
    }
    this.switchT = Math.min(1, this.switchT + dt * 3.2);
    this.kick = Math.max(0, this.kick - dt * 7);
    this.swing = Math.max(0, this.swing - dt * 3.5);
    const moving = s.onGround ? Math.min(1, s.speed / 250) : 0;
    this.bobT += dt * (4 + moving * 7);
    const bobX = Math.sin(this.bobT) * 0.6 * moving;
    const bobY = Math.abs(Math.cos(this.bobT)) * 0.5 * moving;

    const w = s.decked ? this.deck : this.weapons.get(this.current);
    if (!w) return;
    const lower = (1 - this.switchT) * 10 + (s.reloading ? 3.5 : 0);
    const zoom = s.zoomed ? 1 : 0;
    const x = (7.5 - zoom * 7.5) + bobX;
    const y = -6.5 + zoom * 3 - bobY - lower;
    const z = -14 + this.kick * 2.2;
    w.position.set(x, y, z);
    w.rotation.set(this.kick * 0.12 + (s.reloading ? -0.5 : 0), 0, s.reloading ? 0.35 : 0);
    if (this.current === WeaponId.Katana) {
      // Resting pose upright-ish; swings sweep across; block raises the blade.
      const sw = Math.sin(this.swing * Math.PI);
      w.rotation.set(-0.9 + sw * 1.6, this.swingDir * sw * 0.8, -0.4 - this.swingDir * sw * 1.2);
      if (s.blocking) w.rotation.set(-0.2, 0, -1.45);
    }
    if (this.current === WeaponId.Fist) {
      const sw = Math.sin(this.swing * Math.PI);
      w.position.z -= sw * 10;
    }
    if (this.current === WeaponId.Minigun) {
      this.spin += dt * s.spin * 40;
      const b = w.getObjectByName('barrels');
      if (b) b.rotation.z = this.spin;
    }
    this.muzzle.position.set(x, y + 1, z - (this.current === WeaponId.Minigun ? 26 : this.current === WeaponId.AssaultRifle ? 22 : 14));
  }
}

function makeFlashTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,200,120,0.8)');
  grad.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grad;
  for (let i = 0; i < 5; i++) {
    g.save();
    g.translate(32, 32);
    g.rotate((i / 5) * Math.PI * 2);
    g.fillRect(-3, -30, 6, 30);
    g.restore();
  }
  g.beginPath();
  g.arc(32, 32, 14, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
