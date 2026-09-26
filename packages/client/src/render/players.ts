import * as THREE from 'three';
import { ClassId, Team, TEAM_COLORS, WeaponId, type Vec3 } from '@d2/shared';

// Procedural low-poly soldiers (one rig per class) and cyberspace avatars.

const heatMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.3, 0.9), toneMapped: false });

interface Rig {
  root: THREE.Group;
  pelvis: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  foreL: THREE.Group;
  foreR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  shinL: THREE.Group;
  shinR: THREE.Group;
  gun: THREE.Group;
  meshes: THREE.Mesh[];
  materials: THREE.Material[];
}

function box(w: number, h: number, d: number, mat: THREE.Material, y = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.y = y;
  return m;
}

function buildRig(cls: ClassId, team: number): Rig {
  const s = cls === ClassId.Light ? 0.92 : cls === ClassId.Heavy ? 1.12 : 1;
  const bulk = cls === ClassId.Heavy ? 1.3 : cls === ClassId.Light ? 0.85 : 1;
  const teamCol = new THREE.Color(TEAM_COLORS[team] ?? '#bbbbbb');
  const armor = new THREE.MeshStandardMaterial({
    color: team === Team.Punk ? 0x3a2630 : 0x1f2a3a,
    roughness: 0.55,
    metalness: 0.55,
  });
  const under = new THREE.MeshStandardMaterial({ color: 0x15161b, roughness: 0.9, metalness: 0.2 });
  const glow = new THREE.MeshStandardMaterial({ color: teamCol, emissive: teamCol, emissiveIntensity: 2.2, toneMapped: false });
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x22252c, roughness: 0.4, metalness: 0.8 });
  const materials = [armor, under, glow, gunMat];

  const root = new THREE.Group();
  const pelvis = new THREE.Group();
  pelvis.position.y = 38 * s;
  root.add(pelvis);
  pelvis.add(box(22 * bulk, 8, 13 * bulk, under));

  const torso = new THREE.Group();
  torso.position.y = 4;
  pelvis.add(torso);
  torso.add(box(24 * bulk, 22 * s, 14 * bulk, armor, 12 * s));
  torso.add(box(25 * bulk, 3, 15 * bulk, glow, 17 * s)); // chest stripe
  if (cls === ClassId.Heavy) {
    torso.add(box(12, 8, 18, armor, 22).translateX(-17));
    torso.add(box(12, 8, 18, armor, 22).translateX(17));
    torso.add(box(18, 18, 8, under, 14).translateZ(10)); // backpack
  }
  if (cls === ClassId.Light) torso.add(box(8, 14, 4, glow, 12).translateZ(8)); // deck spine

  const head = new THREE.Group();
  head.position.y = 25 * s;
  torso.add(head);
  head.add(box(11, 12, 12, armor, 6));
  const visor = box(10.5, 3.4, 2, glow, 7);
  visor.position.z = -6;
  head.add(visor);

  const mkArm = (side: number) => {
    const arm = new THREE.Group();
    arm.position.set(side * (14 * bulk), 20 * s, 0);
    torso.add(arm);
    arm.add(box(7 * bulk, 16, 7 * bulk, armor, -8));
    const fore = new THREE.Group();
    fore.position.y = -16;
    arm.add(fore);
    fore.add(box(6 * bulk, 15, 6 * bulk, under, -7));
    return { arm, fore };
  };
  const L = mkArm(-1);
  const R = mkArm(1);

  const mkLeg = (side: number) => {
    const leg = new THREE.Group();
    leg.position.set(side * 6 * bulk, -3, 0);
    pelvis.add(leg);
    leg.add(box(9 * bulk, 18 * s, 9 * bulk, armor, -9 * s));
    const shin = new THREE.Group();
    shin.position.y = -18 * s;
    leg.add(shin);
    shin.add(box(8 * bulk, 17 * s, 8 * bulk, under, -8.5 * s));
    shin.add(box(9 * bulk, 3, 12 * bulk, armor, -17 * s).translateZ(-1.5));
    return { leg, shin };
  };
  const LL = mkLeg(-1);
  const RL = mkLeg(1);

  const gun = new THREE.Group();
  gun.position.set(0, -14, -6);
  R.fore.add(gun);

  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) meshes.push(o);
  });
  return {
    root,
    pelvis,
    torso,
    head,
    armL: L.arm,
    armR: R.arm,
    foreL: L.fore,
    foreR: R.fore,
    legL: LL.leg,
    legR: RL.leg,
    shinL: LL.shin,
    shinR: RL.shin,
    gun,
    meshes,
    materials,
  };
}

function gunMesh(weapon: number, mat: THREE.Material): THREE.Object3D {
  const g = new THREE.Group();
  const add = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m);
  };
  switch (weapon) {
    case WeaponId.Minigun:
      add(8, 8, 30, 0, 0, -12);
      add(4, 4, 14, 0, 0, -32);
      break;
    case WeaponId.Shotgun:
      add(4, 5, 28, 0, 0, -10);
      break;
    case WeaponId.AssaultRifle:
      add(4, 6, 30, 0, 0, -10);
      add(3, 7, 3, 0, -5, -6);
      break;
    case WeaponId.Katana:
      add(1.5, 3, 40, 0, 0, -22);
      break;
    case WeaponId.Fist:
      add(10, 10, 12, 0, 0, -4);
      break;
    default:
      add(3.5, 5, 14, 0, 0, -4);
  }
  return g;
}

export interface PlayerPose {
  origin: Vec3;
  yaw: number;
  pitch: number;
  speed: number;
  ducked: boolean;
  onGround: boolean;
  hanging: boolean;
  decked: boolean;
  alive: boolean;
  weapon: number;
  /** 0 invisible .. 1 visible (stealth). */
  vis: number;
  thermalView: boolean;
  firing: boolean;
  sliding: boolean;
}

export class PlayerModel {
  readonly rig: Rig;
  private walk = 0;
  private deadTime = 0;
  private curWeapon = -1;
  private cloaked = false;
  private thermal = false;
  private cloakMats: THREE.Material[];

  constructor(
    readonly cls: ClassId,
    readonly team: number,
  ) {
    this.rig = buildRig(cls, team);
    this.cloakMats = this.rig.materials.map((m) => {
      const c = (m as THREE.MeshStandardMaterial).clone();
      c.transparent = true;
      c.depthWrite = false;
      return c;
    });
  }

  get object(): THREE.Group {
    return this.rig.root;
  }

  private setWeapon(w: number): void {
    if (w === this.curWeapon) return;
    this.curWeapon = w;
    this.rig.gun.clear();
    const mat = this.cloaked ? this.cloakMats[3]! : this.rig.materials[3]!;
    this.rig.gun.add(gunMesh(w, mat));
    this.rig.meshes.length = 0;
    this.rig.root.traverse((o) => {
      if (o instanceof THREE.Mesh) this.rig.meshes.push(o);
    });
    this.applyMaterials();
  }

  private applyMaterials(): void {
    const mats = this.rig.materials;
    for (const m of this.rig.meshes) {
      if (!m.userData['base']) m.userData['base'] = m.material;
      const base = m.userData['base'] as THREE.Material;
      if (this.thermal) m.material = heatMaterial;
      else if (this.cloaked) m.material = this.cloakMats[mats.indexOf(base)] ?? base;
      else m.material = base;
    }
  }

  update(p: PlayerPose, dt: number): void {
    const r = this.rig;
    this.setWeapon(p.weapon);
    // sim -> three: (x, z, -y); model faces -Z at yaw 90 (sim +Y)
    r.root.position.set(p.origin.x, p.origin.z, -p.origin.y);
    r.root.rotation.set(0, ((p.yaw - 90) * Math.PI) / 180, 0);

    const wantThermal = p.thermalView;
    const wantCloak = !wantThermal && p.vis < 0.98;
    if (wantThermal !== this.thermal || wantCloak !== this.cloaked) {
      this.thermal = wantThermal;
      this.cloaked = wantCloak;
      this.applyMaterials();
    }
    if (this.cloaked) {
      const shimmer = 0.035 + p.vis * 0.9 + Math.sin(performance.now() / 70) * 0.015;
      for (const m of this.cloakMats) (m as THREE.MeshStandardMaterial).opacity = Math.max(0.02, Math.min(1, shimmer));
    }

    if (!p.alive) {
      this.deadTime += dt;
      const f = Math.min(1, this.deadTime / 0.45);
      r.root.rotation.x = -f * (Math.PI / 2) * 0.95;
      r.root.position.y -= f * 4;
      r.root.visible = this.deadTime < 6;
      return;
    }
    this.deadTime = 0;
    r.root.visible = true;
    r.root.rotation.x = 0;

    // Walk cycle driven by ground speed.
    this.walk += dt * Math.min(p.speed, 400) * 0.045;
    const swing = p.onGround && !p.decked ? Math.sin(this.walk) * Math.min(1, p.speed / 180) * 0.8 : 0;
    r.legL.rotation.x = swing;
    r.legR.rotation.x = -swing;
    r.shinL.rotation.x = -Math.max(0, -swing) * 0.9;
    r.shinR.rotation.x = -Math.max(0, swing) * 0.9;
    r.armL.rotation.x = -swing * 0.5;

    const pitch = (p.pitch * Math.PI) / 180;
    r.head.rotation.x = -pitch * 0.5;
    r.torso.rotation.x = -pitch * 0.25;
    // Aim the weapon arm.
    // +90 deg points the arm forward (-Z); looking down lowers it.
    r.armR.rotation.x = Math.PI / 2 - pitch * 0.7 + (p.firing ? 0.05 : 0);
    r.foreR.rotation.x = -0.15;
    r.armL.rotation.z = 0;

    let pelvisY = 38 * (this.cls === ClassId.Light ? 0.92 : this.cls === ClassId.Heavy ? 1.12 : 1);
    if (p.ducked || p.decked || p.sliding) {
      pelvisY *= 0.55;
      r.legL.rotation.x = 1.2;
      r.legR.rotation.x = 0.5;
      r.shinL.rotation.x = -1.9;
      r.shinR.rotation.x = -1.4;
    }
    if (!p.onGround && !p.hanging && !p.decked) {
      r.legL.rotation.x = 0.6;
      r.shinL.rotation.x = -0.9;
      r.legR.rotation.x = -0.3;
      r.shinR.rotation.x = -0.4;
    }
    if (p.hanging) {
      r.armL.rotation.x = Math.PI;
      r.armR.rotation.x = Math.PI;
      r.legL.rotation.x = 0.1;
      r.legR.rotation.x = -0.1;
    }
    if (p.decked) {
      // Kneeling, head bowed, hands at the terminal.
      r.head.rotation.x = 0.5;
      r.armL.rotation.x = 1.1;
      r.armR.rotation.x = 1.1;
      r.foreR.rotation.x = 0.6;
    }
    r.pelvis.position.y = pelvisY;
  }

  dispose(): void {
    for (const m of [...this.rig.materials, ...this.cloakMats]) m.dispose();
    this.rig.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}

// ---------------------------------------------------------------------------
// Cyberspace avatar: a glowing octahedron with an orbit ring and a trail that
// is visible through walls (as in the original).

const TRAIL_POINTS = 90;

export class CyberAvatar {
  readonly object = new THREE.Group();
  private readonly core: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly trail: THREE.Line;
  private readonly trailPos: Float32Array;
  private readonly trailCol: Float32Array;
  private readonly history: { p: THREE.Vector3; t: number }[] = [];
  private readonly color: THREE.Color;
  private lastSample = 0;

  constructor(readonly team: number, scene: THREE.Scene) {
    this.color = new THREE.Color(TEAM_COLORS[team] ?? '#ffffff');
    const bright = this.color.clone().multiplyScalar(2.2);
    this.core = new THREE.Mesh(
      new THREE.OctahedronGeometry(10, 0),
      new THREE.MeshBasicMaterial({ color: bright, wireframe: false, toneMapped: false, transparent: true, opacity: 0.85 }),
    );
    const wire = new THREE.Mesh(new THREE.OctahedronGeometry(14, 0), new THREE.MeshBasicMaterial({ color: bright, wireframe: true, toneMapped: false }));
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(18, 1.2, 6, 32), new THREE.MeshBasicMaterial({ color: bright, toneMapped: false }));
    this.object.add(this.core, wire, this.ring);
    this.trailPos = new Float32Array(TRAIL_POINTS * 3);
    this.trailCol = new Float32Array(TRAIL_POINTS * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 3));
    this.trail = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthTest: false, toneMapped: false, blending: THREE.AdditiveBlending }),
    );
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 50;
    scene.add(this.object, this.trail);
  }

  update(pos: Vec3, up: Vec3, forward: Vec3, time: number, visible: boolean): void {
    const p = new THREE.Vector3(pos.x, pos.z, -pos.y);
    this.object.visible = visible;
    this.object.position.copy(p);
    const upT = new THREE.Vector3(up.x, up.z, -up.y);
    const fwdT = new THREE.Vector3(forward.x, forward.z, -forward.y);
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), fwdT, upT);
    this.object.quaternion.setFromRotationMatrix(m);
    this.core.rotation.y = time * 2;
    this.ring.rotation.x = time * 1.3;
    this.ring.rotation.y = time * 0.7;
    // Trail: sample every 40 ms, keep ~3.5 s; fades with age.
    if (time - this.lastSample > 0.04) {
      this.lastSample = time;
      const last = this.history[this.history.length - 1];
      if (!last || last.p.distanceTo(p) > 2) this.history.push({ p, t: time });
      while (this.history.length > TRAIL_POINTS) this.history.shift();
    }
    while (this.history.length && time - this.history[0]!.t > 3.5) this.history.shift();
    const n = this.history.length;
    for (let i = 0; i < TRAIL_POINTS; i++) {
      const h = this.history[Math.min(i, n - 1)];
      const k = i * 3;
      if (!h) {
        this.trailPos[k] = p.x;
        this.trailPos[k + 1] = p.y;
        this.trailPos[k + 2] = p.z;
        this.trailCol[k] = this.trailCol[k + 1] = this.trailCol[k + 2] = 0;
        continue;
      }
      this.trailPos[k] = h.p.x;
      this.trailPos[k + 1] = h.p.y;
      this.trailPos[k + 2] = h.p.z;
      const a = i < n ? Math.max(0, 1 - (time - h.t) / 3.5) : 0;
      this.trailCol[k] = this.color.r * a * 1.6;
      this.trailCol[k + 1] = this.color.g * a * 1.6;
      this.trailCol[k + 2] = this.color.b * a * 1.6;
    }
    this.trail.geometry.attributes['position']!.needsUpdate = true;
    this.trail.geometry.attributes['color']!.needsUpdate = true;
    this.trail.visible = n > 1;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.object, this.trail);
    this.trail.geometry.dispose();
  }
}
