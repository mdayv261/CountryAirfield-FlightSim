// Graphics quality: fixed levels for the menu, and an automatic mode that steps down when the
// machine cannot hold 60 fps. Profiling (Stage 10) showed the renderer is fill-bound: pixels
// drawn and shadow sampling cost far more than triangle count, so the steps trade shadow
// detail and render resolution, never the scenery itself.

export type GraphicsSetting = 'auto' | 'high' | 'medium' | 'low';

export interface QualityLevel {
  name: string;
  /** Render resolution as a fraction of the display's (capped) pixel ratio. */
  renderScale: number;
  /** Sun shadow map size, texels (0 = no shadows). */
  shadowMapSize: number;
}

/** From best to cheapest. Auto mode walks down this list; the fixed settings pick one. */
export const QUALITY_LEVELS: QualityLevel[] = [
  { name: 'high', renderScale: 1, shadowMapSize: 2048 },
  { name: 'high, 1k shadows', renderScale: 1, shadowMapSize: 1024 },
  { name: 'medium', renderScale: 0.85, shadowMapSize: 1024 },
  { name: 'low-medium', renderScale: 0.7, shadowMapSize: 1024 },
  { name: 'low', renderScale: 0.7, shadowMapSize: 0 },
];

/** Level index for a fixed setting (auto starts at the top). */
export function levelFor(setting: GraphicsSetting): number {
  return setting === 'medium' ? 2 : setting === 'low' ? 4 : 0;
}

export const AUTO_QUALITY = {
  /** Frame intervals above this count as too slow, ms (60 fps is 16.7 ms; allow some jitter). */
  slowFrameMs: 18.5,
  /** Judge over this long, s, and step down when the average is slow. */
  window_s: 3,
  /** Ignore this long after a (re)start, scene change or step, s (shader compiles, loading). */
  settle_s: 4,
  /** Frame gaps longer than this are a stall (tab hidden, debugger), not a slow frame, ms. */
  ignoreGapMs: 250,
};

/**
 * Automatic quality: watches the display frame interval. If the average over a few seconds is
 * slower than 60 fps, it steps down one level, then waits for things to settle before judging
 * again. It only ever steps down within a session (stepping up could make it oscillate).
 */
export class AutoQuality {
  level = 0;
  private settle = AUTO_QUALITY.settle_s;
  private sumMs = 0;
  private frames = 0;

  /** Restart the judgement (after a reset, aircraft change, or the menu closing). */
  hold(): void {
    this.settle = AUTO_QUALITY.settle_s;
    this.sumMs = 0;
    this.frames = 0;
  }

  /** Feed one display frame's interval, ms. Returns true when the level has just stepped down. */
  frame(intervalMs: number): boolean {
    if (intervalMs > AUTO_QUALITY.ignoreGapMs) return false;
    const s = intervalMs / 1000;
    if (this.settle > 0) {
      this.settle -= s;
      return false;
    }
    this.sumMs += intervalMs;
    this.frames++;
    if (this.sumMs < AUTO_QUALITY.window_s * 1000) return false;
    const mean = this.sumMs / this.frames; // average frame interval, ms
    this.sumMs = 0;
    this.frames = 0;
    if (mean <= AUTO_QUALITY.slowFrameMs || this.level >= QUALITY_LEVELS.length - 1) return false;
    this.level++;
    this.settle = AUTO_QUALITY.settle_s;
    return true;
  }
}
