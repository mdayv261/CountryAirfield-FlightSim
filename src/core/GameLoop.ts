import { MAX_FRAME_TIME_S, PHYSICS_HZ } from './constants';

export interface LoopCallbacks {
  /** Advance the simulation by exactly dt seconds. */
  step(dt: number): void;
  /**
   * Draw a frame. alpha (0..1) is how far real time has run past the last
   * physics step, as a fraction of a step; use it to blend previous and
   * current physics states so motion looks smooth at any display rate.
   */
  render(alpha: number): void;
}

export interface LoopOptions {
  hz?: number;
  maxFrameTime?: number;
}

/**
 * Fixed-step loop, decoupled from the display.
 *
 * Think of the accumulator as a small reservoir: each display frame pours in
 * the real time that has elapsed, and the physics draws it off in fixed
 * 1/120 s doses. Whatever is left (less than one dose) carries over to the
 * next frame. The physics therefore always sees the same dt, which keeps the
 * integration repeatable and stable, whatever the display refresh rate.
 *
 * advance() contains all the logic and is pure, so tests can drive it with
 * fake frame times. start() wires it to requestAnimationFrame in the browser.
 */
export class GameLoop {
  readonly dt: number;
  private readonly maxFrameTime: number;
  private accumulator = 0;
  private _paused = false;
  private rafId: number | null = null;
  private lastTimeMs: number | null = null;

  /** Total physics steps run since construction (handy for diagnostics). */
  stepCount = 0;
  /** Simulated time elapsed, seconds. */
  simTime = 0;

  constructor(
    private readonly callbacks: LoopCallbacks,
    options: LoopOptions = {},
  ) {
    this.dt = 1 / (options.hz ?? PHYSICS_HZ);
    this.maxFrameTime = options.maxFrameTime ?? MAX_FRAME_TIME_S;
  }

  get paused(): boolean {
    return this._paused;
  }

  set paused(value: boolean) {
    // Empty the reservoir on any change so resuming never fires a burst of steps.
    this._paused = value;
    this.accumulator = 0;
  }

  togglePause(): void {
    this.paused = !this._paused;
  }

  /**
   * Feed one display frame of real time. Runs zero or more physics steps,
   * then renders once. Returns the number of physics steps run.
   */
  advance(frameSeconds: number): number {
    let steps = 0;
    if (!this._paused) {
      const frame = Math.min(Math.max(frameSeconds, 0), this.maxFrameTime);
      this.accumulator += frame;
      // Small tolerance so floating-point round-off (e.g. 120 * (1/120) ≠ 1 exactly)
      // doesn't cost a step.
      const eps = 1e-9;
      while (this.accumulator + eps >= this.dt) {
        this.callbacks.step(this.dt);
        this.accumulator -= this.dt;
        this.stepCount++;
        this.simTime += this.dt;
        steps++;
      }
      if (this.accumulator < 0) this.accumulator = 0;
    }
    this.callbacks.render(this._paused ? 0 : this.accumulator / this.dt);
    return steps;
  }

  /** Start driving the loop from the browser's display refresh. */
  start(): void {
    if (this.rafId !== null) return;
    const tick = (timeMs: number): void => {
      const frameSeconds = this.lastTimeMs === null ? 0 : (timeMs - this.lastTimeMs) / 1000;
      this.lastTimeMs = timeMs;
      this.advance(frameSeconds);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.lastTimeMs = null;
  }
}
