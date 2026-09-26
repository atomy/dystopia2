// Trigger-volume zones (cyberspace links/pads/drains, hurt/eject), shared by
// the server and client prediction.

import { type Vec3, v3, vlen } from '../math.js';
import { type Brush } from '../map/brush.js';
import { pointInBrushes } from '../map/collision.js';
import { type LevelEntity, parseVec, propNum } from '../map/level.js';
import type { CyberEnv, CyberZone } from './cybermove.js';

export interface Zone {
  kind: 'zerog' | 'jumppad' | 'speedpad' | 'drain' | 'hurt' | 'eject';
  brushes: Brush[];
  vec: Vec3;
  rate: number;
  mins: Vec3;
  maxs: Vec3;
}

export function zoneContains(z: Zone, p: Vec3): boolean {
  if (p.x < z.mins.x - 1 || p.y < z.mins.y - 1 || p.z < z.mins.z - 1 || p.x > z.maxs.x + 1 || p.y > z.maxs.y + 1 || p.z > z.maxs.z + 1) return false;
  return pointInBrushes(p, z.brushes);
}

export function zoneFrom(e: LevelEntity): Zone | null {
  const base = { brushes: e.brushes, mins: e.mins, maxs: e.maxs };
  switch (e.classname) {
    case 'cyber_zerog':
      return { kind: 'zerog', vec: parseVec(e.props['flow']), rate: 0, ...base };
    case 'cyber_jumppad':
      return { kind: 'jumppad', vec: parseVec(e.props['push'], v3(0, 0, 600)), rate: 0, ...base };
    case 'cyber_speedpad':
      return { kind: 'speedpad', vec: parseVec(e.props['push'], v3(800, 0, 0)), rate: 0, ...base };
    case 'cyber_drain':
      return { kind: 'drain', vec: v3(), rate: propNum(e, 'rate', 4), ...base };
    case 'trigger_hurt':
      return { kind: 'hurt', vec: v3(), rate: propNum(e, 'damage', 50), ...base };
    case 'trigger_eject':
      return { kind: 'eject', vec: v3(), rate: 0, ...base };
  }
  return null;
}

export function zonesOf(entities: LevelEntity[]): Zone[] {
  return entities.map(zoneFrom).filter((z): z is Zone => z !== null);
}

export function makeCyberEnv(allZones: Zone[]): CyberEnv {
  const zones = allZones.filter((z) => z.kind === 'zerog' || z.kind === 'jumppad' || z.kind === 'speedpad');
  return {
    zoneAt(pos: Vec3): CyberZone {
      let zone: CyberZone | null = null;
      for (const z of zones) {
        if (!zoneContains(z, pos)) continue;
        zone ??= { zeroG: false, flow: null, pad: null, speed: null };
        if (z.kind === 'zerog') {
          zone.zeroG = true;
          if (vlen(z.vec) > 0) zone.flow = z.vec;
        } else if (z.kind === 'jumppad') zone.pad = z.vec;
        else zone.speed = z.vec;
      }
      return zone ?? { zeroG: false, flow: null, pad: null, speed: null };
    },
  };
}
