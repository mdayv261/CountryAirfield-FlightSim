import { describe, expect, it } from 'vitest';
import {
  applyDeadzone,
  AxisCalibrator,
  bipolarAxis,
  defaultCalibration,
  detectMovedInput,
  rampAxis,
  unipolarAxis,
} from '../src/input/axis';
import { GamepadInput } from '../src/input/GamepadInput';
import { InputManager } from '../src/input/InputManager';
import { Keyboard } from '../src/input/keyboard';
import { KEYBOARD } from '../src/input/inputConfig';
import { MouseStick } from '../src/input/MouseStick';

/** Minimal stand-in for a browser Gamepad. */
function fakePad(id: string, axes: number[], buttons: number[] = [], mapping = ''): Gamepad {
  return {
    id,
    index: 0,
    connected: true,
    mapping,
    axes,
    buttons: buttons.map((value) => ({ value, pressed: value > 0.5, touched: false })),
    timestamp: 0,
    hapticActuators: [],
    vibrationActuator: null,
  } as unknown as Gamepad;
}

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

function fakeKeys() {
  const target = new EventTarget();
  const keyboard = new Keyboard(target as unknown as Window);
  const send = (type: 'keydown' | 'keyup', code: string) =>
    target.dispatchEvent(Object.assign(new Event(type), { code, repeat: false }));
  return { keyboard, send, target };
}

describe('axis processing', () => {
  it('dead zone reads zero near centre and still reaches full travel', () => {
    expect(applyDeadzone(0.04, 0.05)).toBe(0);
    expect(applyDeadzone(1, 0.05)).toBe(1);
    expect(applyDeadzone(-1, 0.05)).toBe(-1);
    expect(applyDeadzone(0.525, 0.05)).toBeCloseTo(0.5, 9);
  });

  it('bipolar axis scales each side of an off-centre rest position', () => {
    const cal = { min: -0.8, max: 0.9, centre: 0.1, deadzone: 0, invert: false };
    expect(bipolarAxis(0.1, cal)).toBe(0);
    expect(bipolarAxis(0.9, cal)).toBe(1);
    expect(bipolarAxis(-0.8, cal)).toBe(-1);
    expect(bipolarAxis(0.5, cal)).toBeCloseTo(0.5, 9);
    expect(bipolarAxis(2, cal)).toBe(1); // clamped
    expect(bipolarAxis(0.9, { ...cal, invert: true })).toBe(-1);
  });

  it('unipolar axis maps a throttle lever to 0..1, optionally reversed', () => {
    const cal = defaultCalibration(0);
    expect(unipolarAxis(-1, cal)).toBe(0);
    expect(unipolarAxis(1, cal)).toBe(1);
    expect(unipolarAxis(0, cal)).toBeCloseTo(0.5, 9);
    // Many throttles read -1 when pushed fully forward: invert fixes that.
    expect(unipolarAxis(-1, { ...cal, invert: true })).toBe(1);
  });

  it('calibration records the swept range and the rest position', () => {
    const c = new AxisCalibrator();
    for (const v of [0.02, 0.5, 0.93, 0.1, -0.4, -0.85, 0]) c.sample(v);
    const cal = c.finish(0.03, defaultCalibration());
    expect(cal).toMatchObject({ min: -0.85, max: 0.93, centre: 0.03 });
    expect(bipolarAxis(0.93, cal)).toBe(1);
    expect(bipolarAxis(-0.85, cal)).toBe(-1);
    // A sweep that barely moved keeps the old calibration.
    const lazy = new AxisCalibrator();
    lazy.sample(0.01);
    expect(lazy.finish(0, defaultCalibration())).toEqual(defaultCalibration());
  });

  it('binding picks the input that moved most, past a threshold', () => {
    expect(detectMovedInput([0, 0, 0, 0], [0.1, 0.05, -0.9, 0], 0.5)).toBe(2);
    expect(detectMovedInput([0, 0], [0.2, 0.3], 0.5)).toBeNull();
  });

  it('keyboard ramp deflects progressively and re-centres when released', () => {
    let v = 0;
    for (let i = 0; i < 30; i++) v = rampAxis(v, 1, 1 / 120, KEYBOARD.deflectRate, KEYBOARD.centreRate);
    expect(v).toBeCloseTo(0.5, 9); // 0.25 s at 2 /s
    for (let i = 0; i < 120; i++) v = rampAxis(v, 0, 1 / 120, KEYBOARD.deflectRate, KEYBOARD.centreRate);
    expect(v).toBe(0);
    for (let i = 0; i < 600; i++) v = rampAxis(v, -1, 1 / 120, KEYBOARD.deflectRate, KEYBOARD.centreRate);
    expect(v).toBe(-1); // never beyond full travel
  });
});

describe('devices', () => {
  it('a standard gamepad gets sensible default bindings', () => {
    const pad = fakePad('Xbox Controller', [0.5, -1, 0.2, 0], [0, 0, 0, 0, 0, 0, 0.3, 0.8], 'standard');
    const g = new GamepadInput(() => [pad], memoryStorage());
    g.poll();
    expect(g.read('roll')).toBeCloseTo((0.5 - 0.05) / 0.95, 9);
    expect(g.read('pitch')).toBe(-1); // stick pushed forward
    expect(g.read('yaw')).toBeCloseTo((0.2 - 0.05) / 0.95, 9);
    expect(g.read('throttle')).toBeCloseTo(0.8, 9);
    expect(g.read('brakeLeft')).toBeCloseTo(0.3, 9);
  });

  it('joystick and pedals are separate devices, each with its own bindings, saved between sessions', () => {
    const storage = memoryStorage();
    const stick = fakePad('Flight Stick (Vendor: 1234)', [0, 0, -1, 0]);
    const pedals = fakePad('Rudder Pedals (Vendor: 5678)', [0, 0, 0.6]);
    const g = new GamepadInput(() => [stick, pedals], storage);
    g.poll();
    g.bind('yaw', g.device(pedals.id)!, 2);
    g.bind('throttle', g.device(stick.id)!, 2);
    g.bindings.throttle!.cal.invert = true;
    g.save();

    const again = new GamepadInput(() => [stick, pedals], storage);
    again.poll();
    expect(again.read('yaw')).toBeCloseTo((0.6 - 0.05) / 0.95, 9);
    expect(again.read('throttle')).toBe(1); // lever forward reads -1, inverted to full
    expect(again.read('roll')).toBe(0); // default stick binding
  });

  it('gives default bindings to the joystick, not a keyboard receiver that poses as a gamepad', () => {
    const dongle = fakePad('Keychron Link  (Vendor: 3434 Product: d030)', [0, 0, 0, 0, 0, 0]);
    const stick = fakePad('Logitech Extreme 3D Pro (Vendor: 046d Product: c215)', [0.7, 0, 0, 0, 0, 0, 1]);
    const g = new GamepadInput(() => [dongle, stick], memoryStorage());
    g.poll();
    expect(g.bindings.roll?.deviceId).toBe(stick.id);
    expect(g.read('roll')).toBeGreaterThan(0.6);
  });

  it('falls back to the keyboard when a bound device is unplugged', () => {
    const storage = memoryStorage();
    let pads: Gamepad[] = [fakePad('Stick', [0.9, 0])];
    const g = new GamepadInput(() => pads, storage);
    const { keyboard, send } = fakeKeys();
    const input = new InputManager(keyboard, g, new MouseStick(new EventTarget() as unknown as Window));
    input.keyboardEnabled = true;
    input.update(1 / 60);
    expect(input.source.roll).toBe('joystick');
    expect(input.controls.roll).toBeGreaterThan(0.8);

    pads = [];
    send('keydown', 'ArrowLeft');
    for (let i = 0; i < 60; i++) input.update(1 / 60);
    expect(input.source.roll).toBe('keyboard');
    expect(input.controls.roll).toBe(-1);
    send('keyup', 'ArrowLeft');
  });

  it('keyboard flight keys move stick, pedals, throttle and brakes', () => {
    const { keyboard, send } = fakeKeys();
    const input = new InputManager(keyboard, new GamepadInput(() => [], memoryStorage()), new MouseStick(new EventTarget() as unknown as Window));
    input.keyboardEnabled = true;
    send('keydown', 'ArrowDown'); // stick back
    send('keydown', 'KeyC'); // right pedal
    send('keydown', 'Equal'); // throttle up
    send('keydown', 'KeyB');
    for (let i = 0; i < 120; i++) input.update(1 / 120);
    expect(input.controls.pitch).toBe(1);
    expect(input.controls.yaw).toBe(1);
    expect(input.controls.throttle).toBeCloseTo(0.5, 6);
    expect(input.controls.brakeLeft).toBe(1);
    expect(input.controls.brakeRight).toBe(1);
  });

  it('mouse stick: right of centre rolls right, below centre pulls back', () => {
    const m = new MouseStick(new EventTarget() as unknown as Window);
    m.set(0.6, 0.3);
    expect(m.roll).toBe(1);
    expect(m.pitch).toBeGreaterThan(0.4);
    m.set(0.01, -0.01);
    expect(m.roll).toBe(0);
    expect(m.pitch).toBe(0);
  });
});
