// Movement capabilities from class + implants + energy. Used by the server and
// by client prediction, so both derive identical MoveCaps.

import { CLASSES, type ClassId, ImplantId, hasImplant } from '../game/defs.js';
import { DEFAULT_MOVE, type MoveCaps } from './pmove.js';
import type { WeaponState } from './weapons.js';

export function moveCapsFor(cls: ClassId, implantBits: number, energy: number, emped: boolean, weap: WeaponState): MoveCaps {
  const c = CLASSES[cls]!;
  const legs = hasImplant(implantBits, ImplantId.LegBoosters) && !emped;
  let speedScale = 1;
  if (weap.spin > 0) speedScale = 0.62;
  if (weap.zoomed) speedScale = 0.75;
  return {
    runSpeed: c.speed,
    sprintSpeed: c.sprintSpeed,
    canSprint: legs && energy > 1,
    canBoost: legs && energy > 2,
    canLedgeGrab: c.canLedgeGrab,
    jumpSpeed: Math.sqrt(2 * DEFAULT_MOVE.gravity * c.jumpHeight),
    speedScale,
  };
}
