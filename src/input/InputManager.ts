import { CHANNELS, neutralControls, type Channel, type ControlState } from './controls';
import { GamepadInput } from './GamepadInput';
import { KeyboardControls } from './KeyboardControls';
import type { Keyboard } from './keyboard';
import { MouseStick } from './MouseStick';

export type InputSource = 'keyboard' | 'mouse' | 'joystick';

/**
 * Merges every input device into one ControlState. For each channel, a bound and
 * connected joystick/pedal axis wins; otherwise the mouse stick (pitch and roll, when
 * enabled); otherwise the keyboard. So a stick with no throttle axis still gets
 * keyboard throttle, and unplugging a device falls back gracefully.
 */
export class InputManager {
  readonly controls: ControlState = neutralControls();
  readonly source = {} as Record<Channel, InputSource>;
  readonly keyboardControls: KeyboardControls;
  readonly gamepads: GamepadInput;
  readonly mouse: MouseStick;
  /** Keyboard flight keys active (arrows etc. go to the controls, not the camera). */
  keyboardEnabled = false;

  constructor(keys: Keyboard, gamepads = new GamepadInput(), mouse = new MouseStick()) {
    this.keyboardControls = new KeyboardControls(keys);
    this.gamepads = gamepads;
    this.mouse = mouse;
  }

  update(dt: number): void {
    this.gamepads.poll();
    if (this.keyboardEnabled) this.keyboardControls.update(dt);
    const kb = this.keyboardControls.state;
    for (const ch of CHANNELS) {
      const joy = this.gamepads.read(ch);
      if (joy !== undefined) {
        this.controls[ch] = joy;
        this.source[ch] = 'joystick';
      } else if (this.mouse.enabled && (ch === 'pitch' || ch === 'roll')) {
        this.controls[ch] = this.mouse[ch];
        this.source[ch] = 'mouse';
      } else {
        this.controls[ch] = kb[ch];
        this.source[ch] = 'keyboard';
      }
    }
  }
}
