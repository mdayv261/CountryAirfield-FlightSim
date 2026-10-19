import { applyDeadzone } from './axis';
import { MOUSE } from './inputConfig';

/**
 * Mouse as a control stick: the pointer's offset from the screen centre sets roll
 * (left/right) and pitch (towards you = stick back = nose up), like a stick seen from above.
 */
export class MouseStick {
  enabled = false;
  pitch = 0;
  roll = 0;

  constructor(target: HTMLElement | Window = window) {
    target.addEventListener('pointermove', (e) => this.move(e as PointerEvent));
  }

  private move(e: PointerEvent): void {
    const w = window.innerWidth / 2;
    const h = window.innerHeight / 2;
    this.set((e.clientX - w) / w, (e.clientY - h) / h);
  }

  /** Set from a pointer offset in half-screens (-1..1 each way). */
  set(nx: number, ny: number): void {
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    this.roll = applyDeadzone(clamp(nx / MOUSE.fullDeflection), MOUSE.deadzone);
    this.pitch = applyDeadzone(clamp(ny / MOUSE.fullDeflection), MOUSE.deadzone);
  }
}
