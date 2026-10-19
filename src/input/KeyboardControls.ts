import type { Keyboard } from './keyboard';
import { rampAxis } from './axis';
import { KEYBOARD } from './inputConfig';
import { neutralControls, type ControlState } from './controls';

/**
 * Flight controls from the keyboard. Keys are on/off, so held keys move the stick and
 * pedals progressively (and they spring back to centre when released) rather than
 * slamming them to full deflection. Throttle and prop lever stay where they are left.
 */
export class KeyboardControls {
  readonly state: ControlState = neutralControls();

  constructor(private readonly keys: Keyboard) {}

  private held(codes: readonly string[]): boolean {
    return codes.some((c) => this.keys.isDown(c));
  }

  private dir(neg: readonly string[], pos: readonly string[]): number {
    return (this.held(pos) ? 1 : 0) - (this.held(neg) ? 1 : 0);
  }

  update(dt: number): void {
    const k = KEYBOARD.keys;
    const s = this.state;
    s.pitch = rampAxis(s.pitch, this.dir(k.pitchDown, k.pitchUp), dt, KEYBOARD.deflectRate, KEYBOARD.centreRate);
    s.roll = rampAxis(s.roll, this.dir(k.rollLeft, k.rollRight), dt, KEYBOARD.deflectRate, KEYBOARD.centreRate);
    s.yaw = rampAxis(s.yaw, this.dir(k.yawLeft, k.yawRight), dt, KEYBOARD.deflectRate, KEYBOARD.centreRate);
    const lever = (v: number, d: number) => Math.min(1, Math.max(0, v + d * KEYBOARD.leverRate * dt));
    s.throttle = lever(s.throttle, this.dir(k.throttleDown, k.throttleUp));
    s.propLever = lever(s.propLever, this.dir(k.propDown, k.propUp));
    s.brakeLeft = s.brakeRight = this.held(k.brakes) ? 1 : 0;
  }
}
