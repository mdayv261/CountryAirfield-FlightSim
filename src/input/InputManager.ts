import { CHANNELS, neutralControls, type Channel, type ControlState } from './controls';
import { GamepadInput } from './GamepadInput';
import { KeyboardControls } from './KeyboardControls';
import type { Keyboard } from './keyboard';
import { MouseStick } from './MouseStick';

const AIDS_KEY = 'cfs.input.aids.v1';

export type InputSource = 'keyboard' | 'mouse' | 'joystick';

/**
 * Merges every input device into one ControlState. For each channel, a bound and
 * connected joystick/pedal axis wins; otherwise the mouse stick (pitch and roll, when
 * enabled); otherwise the keyboard. Channels on joystick buttons (brakes, prerotator)
 * also still answer to their keys. So a stick with no throttle axis still gets
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
  /** Pilot aids, saved between sessions. */
  readonly aids = { autoRudder: false };

  constructor(keys: Keyboard, gamepads = new GamepadInput(), mouse = new MouseStick()) {
    this.keyboardControls = new KeyboardControls(keys);
    this.gamepads = gamepads;
    this.mouse = mouse;
    try {
      const saved = JSON.parse(localStorage.getItem(AIDS_KEY) ?? '{}');
      if (typeof saved.autoRudder === 'boolean') this.aids.autoRudder = saved.autoRudder;
    } catch {
      // No storage (tests, private window): defaults apply.
    }
  }

  setAutoRudder(on: boolean): void {
    this.aids.autoRudder = on;
    try {
      localStorage.setItem(AIDS_KEY, JSON.stringify(this.aids));
    } catch {
      // Setting then lasts for this session only.
    }
  }

  update(dt: number): void {
    this.gamepads.poll();
    if (this.keyboardEnabled) this.keyboardControls.update(dt);
    const kb = this.keyboardControls.state;
    for (const ch of CHANNELS) {
      const joy = this.gamepads.read(ch);
      if (joy !== undefined && this.gamepads.bindings[ch]?.kind === 'button') {
        // A joystick button (brakes, prerotator) and its keyboard key both work: take whichever is pressed.
        const key = this.keyboardEnabled ? kb[ch] : 0;
        this.controls[ch] = Math.max(joy, key);
        this.source[ch] = key > joy ? 'keyboard' : 'joystick';
      } else if (joy !== undefined) {
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
