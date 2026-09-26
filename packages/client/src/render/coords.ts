import * as THREE from 'three';
import type { Vec3 } from '@d2/shared';

// Simulation space is Quake/Source: Z-up, right-handed, 1 unit ≈ 1 inch.
// three.js is Y-up. Mapping: three(x, y, z) = sim(x, z, -y).

export const toThree = (v: Vec3, out = new THREE.Vector3()): THREE.Vector3 => out.set(v.x, v.z, -v.y);
export const fromThree = (v: THREE.Vector3): Vec3 => ({ x: v.x, y: -v.z, z: v.y });

/** Apply sim-space view angles (pitch down positive, yaw CCW from +X) to a three.js camera/object. */
export function applyViewAngles(obj: THREE.Object3D, pitch: number, yaw: number, roll = 0): void {
  // In three, camera looks down -Z. Sim yaw 0 looks along sim +X = three +X,
  // so rotate by (yaw - 90°) around three's Y axis; pitch positive looks down.
  obj.rotation.order = 'YXZ';
  obj.rotation.y = ((yaw - 90) * Math.PI) / 180;
  obj.rotation.x = (-pitch * Math.PI) / 180;
  obj.rotation.z = (roll * Math.PI) / 180;
}
