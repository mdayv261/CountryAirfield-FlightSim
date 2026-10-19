// Sim-wide constants. Aircraft-specific numbers live in /src/aircraft/*.json.

/** Physics update rate. 120 Hz keeps stiff gear springs and fast rotor dynamics stable. */
export const PHYSICS_HZ = 120;

/** Fixed physics time step, seconds. */
export const PHYSICS_DT = 1 / PHYSICS_HZ;

/**
 * Longest real frame the loop will honour, seconds. After a stall (tab hidden,
 * debugger pause) we drop the backlog rather than run hundreds of catch-up steps,
 * which would make the next frame even slower ("spiral of death").
 */
export const MAX_FRAME_TIME_S = 0.25;

/** Standard gravity, m/s^2. */
export const GRAVITY = 9.80665;

/** Field elevation above mean sea level, m (50 ft). Used by the ISA atmosphere. */
export const FIELD_ELEVATION_M = 15.24;
