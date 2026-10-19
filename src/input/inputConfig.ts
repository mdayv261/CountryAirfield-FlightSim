// Input tuning: key bindings and rates. Times are in seconds.

export const KEYBOARD = {
  /** Keyboard stick/pedal: how fast a held key moves the control towards full, per second. */
  deflectRate: 2.0,
  /** How fast it springs back to centre when released, per second. */
  centreRate: 3.0,
  /** Throttle and prop lever: travel per second while a key is held. */
  leverRate: 0.5,
  keys: {
    pitchDown: ['ArrowUp'], // stick forward
    pitchUp: ['ArrowDown'], // stick back
    rollLeft: ['ArrowLeft'],
    rollRight: ['ArrowRight'],
    yawLeft: ['KeyZ'],
    yawRight: ['KeyC'],
    throttleUp: ['Equal', 'PageUp'],
    throttleDown: ['Minus', 'PageDown'],
    propUp: ['Home'],
    propDown: ['End'],
    brakes: ['KeyB'],
  },
};

export const MOUSE = {
  /** Fraction of the half-screen the mouse must travel for full deflection. */
  fullDeflection: 0.6,
  deadzone: 0.04,
};

export const GAMEPAD = {
  /** Default dead zone around a centred axis, as a fraction of half travel. */
  deadzone: 0.05,
  /** An axis must move this far from its starting value to be picked when binding. */
  bindThreshold: 0.5,
  /** Analogue buttons (e.g. triggers) count as axes: 0 released .. 1 pressed. */
  storageKey: 'cfs.input.bindings.v1',
  /**
   * Version of the built-in default bindings. When it goes up, devices with a known profile
   * get any newly defaulted channels added to existing saved bindings (never overwriting).
   */
  defaultsVersionKey: 'cfs.input.defaultsVersion',
  defaultsVersion: 3,
};
