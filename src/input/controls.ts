// The pilot's control channels. Every input device (keyboard, mouse, joystick, pedals)
// ends up writing these normalised values; the flight models only ever read them.
//
// Sign conventions (pilot's view):
//   pitch  +1 = stick fully back (nose up),      -1 = fully forward
//   roll   +1 = stick fully right (right wing down)
//   yaw    +1 = full right pedal (nose right)
//   throttle 0..1, brakeLeft/brakeRight 0..1, propLever 0 (coarse/low rpm)..1 (fine/high rpm)

export const CHANNELS = ['pitch', 'roll', 'yaw', 'throttle', 'brakeLeft', 'brakeRight', 'propLever'] as const;
export type Channel = (typeof CHANNELS)[number];
export type ControlState = Record<Channel, number>;

/** Bipolar channels centre at 0 and run -1..+1; the rest run 0..1. */
export const BIPOLAR: Record<Channel, boolean> = {
  pitch: true,
  roll: true,
  yaw: true,
  throttle: false,
  brakeLeft: false,
  brakeRight: false,
  propLever: false,
};

export const CHANNEL_LABELS: Record<Channel, string> = {
  pitch: 'Pitch (elevator)',
  roll: 'Roll (ailerons)',
  yaw: 'Yaw (rudder pedals)',
  throttle: 'Throttle',
  brakeLeft: 'Left toe brake',
  brakeRight: 'Right toe brake',
  propLever: 'Propeller rpm lever',
};

export function neutralControls(): ControlState {
  return { pitch: 0, roll: 0, yaw: 0, throttle: 0, brakeLeft: 0, brakeRight: 0, propLever: 1 };
}
