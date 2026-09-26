// Keyboard + mouse. Implant keys are fixed and never depend on the loadout.

import { Buttons } from '@d2/shared';

export const BINDS: Record<string, number> = {
  Space: Buttons.JUMP,
  ControlLeft: Buttons.DUCK,
  ControlRight: Buttons.DUCK,
  KeyE: Buttons.USE,
  KeyR: Buttons.RELOAD,
  AltLeft: Buttons.WALK,
  ShiftLeft: Buttons.SPRINT,
  KeyV: Buttons.BOOST,
  KeyF: Buttons.DECK,
  KeyQ: Buttons.TAC,
  KeyT: Buttons.THERMAL,
  KeyC: Buttons.STEALTH,
  KeyG: Buttons.MEDI,
  KeyK: Buttons.SUICIDE,
};

export const KEY_HELP: [string, string][] = [
  ['WASD', 'move'],
  ['SPACE', 'jump / hold to bounce (cyber)'],
  ['CTRL', 'crouch (slide when landing fast)'],
  ['SHIFT', 'sprint (leg boosters)'],
  ['V', 'hold: charge boost jump'],
  ['MOUSE1/2', 'fire / alt-fire'],
  ['R', 'reload / cyber weapon mode'],
  ['E', 'use / hack node / crack'],
  ['1-4, wheel', 'weapons'],
  ['1-9 (cyber)', 'programs / minigame'],
  ['F', 'jack in / out (at a JIP)'],
  ['Q', 'TAC scan'],
  ['T', 'thermal vision'],
  ['C', 'stealth'],
  ['G', 'mediplant (hold)'],
  ['K', 'tactical respawn'],
  ['TAB', 'scoreboard'],
  ['M', 'team & loadout'],
  ['Y / U', 'chat / team chat'],
];

export class Input {
  private held = new Set<string>();
  private mouse = 0;
  dx = 0;
  dy = 0;
  wheel = 0;
  /** Keys pressed since the last `consumePressed()` (for 1-9 etc.). */
  private pressed: string[] = [];
  sensitivity = 0.12;
  locked = false;
  enabled = true;
  /** Test driver override (dev only). */
  debug: { buttons: number; forward: number; side: number } | null = null;

  constructor(private readonly el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Alt') || (e.ctrlKey && e.code !== 'ControlLeft')) e.preventDefault();
      if (!e.repeat) this.pressed.push(e.code);
      this.held.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => {
      this.held.clear();
      this.mouse = 0;
    });
    el.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.mouse |= 1 << e.button;
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      this.mouse &= ~(1 << e.button);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    window.addEventListener(
      'wheel',
      (e) => {
        if (this.locked) this.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) {
        this.mouse = 0;
        this.held.clear();
      }
    });
  }

  lock(): void {
    if (!this.locked) void this.el.requestPointerLock?.();
  }

  unlock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(code: string): boolean {
    return this.held.has(code);
  }

  consumePressed(): string[] {
    const p = this.pressed;
    this.pressed = [];
    return p;
  }

  buttons(): number {
    if (this.debug) return this.debug.buttons;
    if (!this.locked || !this.enabled) return 0;
    let b = 0;
    for (const [code, bit] of Object.entries(BINDS)) if (this.held.has(code)) b |= bit;
    if (this.mouse & 1) b |= Buttons.ATTACK;
    if (this.mouse & 4) b |= Buttons.ATTACK2;
    return b;
  }

  move(): { forward: number; side: number } {
    if (this.debug) return { forward: this.debug.forward, side: this.debug.side };
    if (!this.locked || !this.enabled) return { forward: 0, side: 0 };
    const f = (this.held.has('KeyW') ? 1 : 0) - (this.held.has('KeyS') ? 1 : 0);
    const s = (this.held.has('KeyD') ? 1 : 0) - (this.held.has('KeyA') ? 1 : 0);
    return { forward: f, side: s };
  }

  takeMouse(): { dx: number; dy: number } {
    const r = { dx: this.dx, dy: this.dy };
    this.dx = 0;
    this.dy = 0;
    return r;
  }
}
