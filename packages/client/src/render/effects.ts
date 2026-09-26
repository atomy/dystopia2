import * as THREE from 'three';
import type { Vec3 } from '@d2/shared';

const T = (v: Vec3) => new THREE.Vector3(v.x, v.z, -v.y);

interface Timed {
  obj: THREE.Object3D;
  life: number;
  age: number;
  update?: (f: number, age: number) => void;
  dispose?: () => void;
}

const MAX_PARTICLES = 2000;

export class Effects {
  private readonly items: Timed[] = [];
  private readonly beamGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, -0.5);
  private readonly sphereGeo = new THREE.SphereGeometry(1, 20, 14);
  private readonly ringGeo = new THREE.RingGeometry(0.92, 1, 48);
  private readonly lights: THREE.PointLight[] = [];
  private lightIdx = 0;
  // Particles
  private readonly pPos = new Float32Array(MAX_PARTICLES * 3);
  private readonly pCol = new Float32Array(MAX_PARTICLES * 3);
  private readonly pVel = new Float32Array(MAX_PARTICLES * 3);
  private readonly pLife = new Float32Array(MAX_PARTICLES);
  private readonly pMax = new Float32Array(MAX_PARTICLES);
  private readonly pBase = new Float32Array(MAX_PARTICLES * 3);
  private readonly pGrav = new Float32Array(MAX_PARTICLES);
  private pNext = 0;
  private readonly points: THREE.Points;

  constructor(private readonly scene: THREE.Scene) {
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 600, 1.6);
      scene.add(l);
      this.lights.push(l);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 3.2, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, sizeAttenuation: true }),
    );
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.pLife.fill(0);
  }

  private add(t: Timed): void {
    this.scene.add(t.obj);
    this.items.push(t);
  }

  private flash(pos: THREE.Vector3, color: THREE.ColorRepresentation, intensity: number, range: number, life: number): void {
    const l = this.lights[this.lightIdx++ % this.lights.length]!;
    l.position.copy(pos);
    l.color.set(color);
    l.distance = range;
    l.intensity = intensity;
    const start = performance.now();
    const tick = () => {
      const f = (performance.now() - start) / (life * 1000);
      l.intensity = f >= 1 ? 0 : intensity * (1 - f);
      if (f < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  beam(start: Vec3, end: Vec3, color: THREE.ColorRepresentation, width: number, life: number, intensity = 2.5): void {
    const a = T(start);
    const b = T(end);
    const len = a.distanceTo(b);
    if (len < 1) return;
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const mesh = new THREE.Mesh(this.beamGeo, m);
    mesh.position.copy(a);
    mesh.lookAt(b);
    mesh.scale.set(width, width, len);
    this.add({
      obj: mesh,
      life,
      age: 0,
      update: (f) => {
        m.opacity = 1 - f;
        mesh.scale.x = mesh.scale.y = width * (1 - f * 0.6);
      },
      dispose: () => m.dispose(),
    });
  }

  tracer(start: Vec3, end: Vec3, color: THREE.ColorRepresentation = 0xffd28a): void {
    this.beam(start, end, color, 0.7, 0.09, 1.6);
  }

  sparks(pos: Vec3, color: THREE.ColorRepresentation, count: number, speed: number, gravity = 800, life = 0.45): void {
    const c = new THREE.Color(color);
    const p = T(pos);
    for (let i = 0; i < count; i++) {
      const k = this.pNext++ % MAX_PARTICLES;
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const s = speed * (0.3 + Math.random() * 0.7);
      this.pPos[k * 3] = p.x;
      this.pPos[k * 3 + 1] = p.y;
      this.pPos[k * 3 + 2] = p.z;
      this.pVel[k * 3] = r * Math.cos(th) * s;
      this.pVel[k * 3 + 1] = u * s;
      this.pVel[k * 3 + 2] = r * Math.sin(th) * s;
      this.pBase[k * 3] = c.r * 2;
      this.pBase[k * 3 + 1] = c.g * 2;
      this.pBase[k * 3 + 2] = c.b * 2;
      this.pLife[k] = life * (0.5 + Math.random() * 0.5);
      this.pMax[k] = this.pLife[k]!;
      this.pGrav[k] = gravity;
    }
  }

  impact(pos: Vec3, blood = false): void {
    this.sparks(pos, blood ? 0xff2244 : 0xffc070, blood ? 6 : 4, blood ? 140 : 220);
  }

  explosion(pos: Vec3, radius: number, kind: number): void {
    const p = T(pos);
    const palette: Record<number, [number, number]> = {
      1: [0xff8a2a, 0xffd28a], // frag
      2: [0x27e6ff, 0xb0f4ff], // EMP
      3: [0xffaa44, 0xff5522], // turret destroyed
      4: [0x27e6ff, 0xffffff], // core
      5: [0xff2bd6, 0x27e6ff], // cyber orb
      6: [0x3dff7a, 0xb0ffd0], // green ICE
    };
    const [c1, c2] = palette[kind] ?? [0xffaa55, 0xffffff];
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(c1).multiplyScalar(2.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const s = new THREE.Mesh(this.sphereGeo, m);
    s.position.copy(p);
    const r = Math.max(24, radius * (kind === 2 ? 1 : 0.55));
    this.add({
      obj: s,
      life: kind === 4 ? 1.4 : 0.5,
      age: 0,
      update: (f) => {
        const e = 1 - Math.pow(1 - f, 3);
        s.scale.setScalar(r * (0.25 + e * 0.75));
        m.opacity = (1 - f) * 0.8;
      },
      dispose: () => m.dispose(),
    });
    if (kind === 2 || kind === 5 || kind === 6) this.ring(pos, c2, radius, 0.45, true);
    this.sparks(pos, c2, kind === 4 ? 160 : 50, kind === 4 ? 700 : 420, kind === 5 ? 0 : 600, kind === 4 ? 1.6 : 0.7);
    this.flash(p, c1, kind === 4 ? 12 : 6, radius * 3, 0.35);
  }

  ring(pos: Vec3, color: THREE.ColorRepresentation, radius: number, life: number, sphere = false): void {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2), transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const mesh = new THREE.Mesh(this.ringGeo, m);
    mesh.position.copy(T(pos));
    mesh.rotation.x = -Math.PI / 2;
    const extra = sphere ? new THREE.Mesh(this.ringGeo, m) : null;
    if (extra) mesh.add(extra.rotateX(Math.PI / 2));
    this.add({
      obj: mesh,
      life,
      age: 0,
      update: (f) => {
        mesh.scale.setScalar(Math.max(1, radius * f));
        m.opacity = 1 - f;
      },
      dispose: () => m.dispose(),
    });
  }

  muzzle(pos: Vec3, color: THREE.ColorRepresentation = 0xffc080): void {
    this.flash(T(pos), color, 2.2, 260, 0.06);
    this.sparks(pos, color, 3, 120, 0, 0.08);
  }

  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]!;
      it.age += dt;
      const f = Math.min(1, it.age / it.life);
      it.update?.(f, it.age);
      if (f >= 1) {
        this.scene.remove(it.obj);
        it.dispose?.();
        this.items.splice(i, 1);
      }
    }
    for (let k = 0; k < MAX_PARTICLES; k++) {
      const life = this.pLife[k]!;
      if (life <= 0) {
        this.pCol[k * 3] = this.pCol[k * 3 + 1] = this.pCol[k * 3 + 2] = 0;
        continue;
      }
      const nl = life - dt;
      this.pLife[k] = nl;
      this.pVel[k * 3 + 1]! -= this.pGrav[k]! * dt;
      this.pPos[k * 3]! += this.pVel[k * 3]! * dt;
      this.pPos[k * 3 + 1]! += this.pVel[k * 3 + 1]! * dt;
      this.pPos[k * 3 + 2]! += this.pVel[k * 3 + 2]! * dt;
      const a = Math.max(0, nl / this.pMax[k]!);
      this.pCol[k * 3] = this.pBase[k * 3]! * a;
      this.pCol[k * 3 + 1] = this.pBase[k * 3 + 1]! * a;
      this.pCol[k * 3 + 2] = this.pBase[k * 3 + 2]! * a;
    }
    this.points.geometry.attributes['position']!.needsUpdate = true;
    this.points.geometry.attributes['color']!.needsUpdate = true;
  }
}
