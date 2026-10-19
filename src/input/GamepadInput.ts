import { bipolarAxis, defaultCalibration, unipolarAxis, type AxisCalibration } from './axis';
import { BIPOLAR, type Channel } from './controls';
import { GAMEPAD } from './inputConfig';

/** One snapshot of a connected device. Buttons are read as analogue values 0..1. */
export interface DeviceSnapshot {
  id: string;
  index: number;
  mapping: string;
  axes: number[];
  buttons: number[];
}

/**
 * Where a channel reads from. Devices are matched by their id string (stable across
 * reloads and USB ports), so a joystick and a separate set of pedals each keep their
 * own bindings. Inputs are numbered axes first, then buttons.
 */
export interface Binding {
  deviceId: string;
  kind: 'axis' | 'button';
  index: number;
  cal: AxisCalibration;
}

export type Bindings = Partial<Record<Channel, Binding>>;

type PadSource = () => ReadonlyArray<Gamepad | null>;

const browserPads: PadSource = () =>
  typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];

/** Short readable device name (Gamepad ids include vendor/product codes). */
export function shortName(id: string): string {
  return id.replace(/\s*\(.*?\)\s*/g, ' ').replace(/Vendor:.*$/i, '').trim().slice(0, 40) || id.slice(0, 40);
}

/**
 * Joysticks, yokes, pedals and gamepads through the browser Gamepad API. Browsers only
 * reveal a device after a button is pressed while the page has focus.
 */
export class GamepadInput {
  devices: DeviceSnapshot[] = [];
  bindings: Bindings;

  constructor(
    private readonly source: PadSource = browserPads,
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage(),
  ) {
    this.bindings = this.load();
  }

  /** Read every connected device (call once per frame). */
  poll(): void {
    this.devices = [];
    for (const p of this.source()) {
      if (!p || !p.connected) continue;
      this.devices.push({
        id: p.id,
        index: p.index,
        mapping: p.mapping,
        axes: Array.from(p.axes),
        buttons: p.buttons.map((b) => b.value),
      });
    }
    if (Object.keys(this.bindings).length === 0) {
      const d = pickDefaultDevice(this.devices);
      if (d) this.applyDefaults(d);
    }
  }

  device(id: string): DeviceSnapshot | undefined {
    return this.devices.find((d) => d.id === id);
  }

  /** All inputs of a device as one list: axes, then buttons. */
  static inputs(d: DeviceSnapshot): number[] {
    return [...d.axes, ...d.buttons];
  }

  /** Raw reading for a binding, or undefined if its device is not connected. */
  raw(b: Binding): number | undefined {
    const d = this.device(b.deviceId);
    if (!d) return undefined;
    return b.kind === 'axis' ? d.axes[b.index] : d.buttons[b.index];
  }

  /** Calibrated value for a channel, or undefined if it is unbound or the device is absent. */
  read(channel: Channel): number | undefined {
    const b = this.bindings[channel];
    if (!b) return undefined;
    const raw = this.raw(b);
    if (raw === undefined) return undefined;
    return BIPOLAR[channel] ? bipolarAxis(raw, b.cal) : unipolarAxis(raw, b.cal);
  }

  /** Bind a channel to input number `input` (axes first, then buttons) of a device. */
  bind(channel: Channel, d: DeviceSnapshot, input: number): void {
    const kind = input < d.axes.length ? 'axis' : 'button';
    const index = kind === 'axis' ? input : input - d.axes.length;
    // Buttons (and triggers) rest at 0 and run to 1.
    const cal = kind === 'axis' ? defaultCalibration(GAMEPAD.deadzone) : { min: 0, max: 1, centre: 0, deadzone: 0, invert: false };
    this.bindings[channel] = { deviceId: d.id, kind, index, cal };
    this.save();
  }

  clear(channel: Channel): void {
    delete this.bindings[channel];
    this.save();
  }

  resetToDefaults(): void {
    this.bindings = {};
    const d = pickDefaultDevice(this.devices);
    if (d) this.applyDefaults(d);
    this.save();
  }

  /**
   * Sensible first-time bindings. A "standard" gamepad: left stick = ailerons/elevator,
   * right stick X = rudder, right trigger = throttle, left trigger = both brakes.
   * Any other device (flight sticks): X = ailerons, Y = elevator; bind the rest by hand.
   */
  applyDefaults(d: DeviceSnapshot): void {
    const axis = (index: number): Binding => ({ deviceId: d.id, kind: 'axis', index, cal: defaultCalibration(GAMEPAD.deadzone) });
    const trigger = (index: number): Binding => ({
      deviceId: d.id,
      kind: 'button',
      index,
      cal: { min: 0, max: 1, centre: 0, deadzone: 0, invert: false },
    });
    if (d.axes.length >= 2) {
      this.bindings.roll = axis(0);
      this.bindings.pitch = axis(1);
    }
    if (d.mapping === 'standard') {
      if (d.axes.length >= 3) this.bindings.yaw = axis(2);
      if (d.buttons.length > 7) {
        this.bindings.throttle = trigger(7);
        this.bindings.brakeLeft = trigger(6);
        this.bindings.brakeRight = trigger(6);
      }
    }
    this.save();
  }

  save(): void {
    try {
      this.storage?.setItem(GAMEPAD.storageKey, JSON.stringify(this.bindings));
    } catch {
      // Storage may be blocked (private window); bindings then last for this session only.
    }
  }

  private load(): Bindings {
    try {
      const text = this.storage?.getItem(GAMEPAD.storageKey);
      return text ? (JSON.parse(text) as Bindings) : {};
    } catch {
      return {};
    }
  }
}

/** Names that suggest a flight controller rather than, say, a keyboard receiver. */
const FLIGHT_DEVICE = /stick|joy|yoke|flight|hotas|throttle|extreme 3d|x52|x56|t\.?16000|gamepad|controller|xbox|playstation|dualsense|dualshock/i;
const NOT_FLIGHT_DEVICE = /keyboard|keychron|receiver|mouse|unifying/i;

/**
 * Device to give default bindings: a standard-mapped gamepad, else one whose name looks
 * like a flight controller, else the first one that is not obviously a keyboard or mouse
 * receiver (some wireless keyboard dongles report themselves as game controllers).
 */
export function pickDefaultDevice(devices: DeviceSnapshot[]): DeviceSnapshot | undefined {
  const usable = devices.filter((d) => d.axes.length >= 2);
  return (
    usable.find((d) => d.mapping === 'standard') ??
    usable.find((d) => FLIGHT_DEVICE.test(d.id)) ??
    usable.find((d) => !NOT_FLIGHT_DEVICE.test(d.id))
  );
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
