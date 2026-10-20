import { describe, expect, it } from 'vitest';
import { AUTO_QUALITY, AutoQuality, levelFor, QUALITY_LEVELS } from '../src/ui/quality';

/** Feed `seconds` of frames at a steady interval; return how many step-downs happened. */
function run(q: AutoQuality, intervalMs: number, seconds: number): number {
  let steps = 0;
  for (let t = 0; t < seconds * 1000; t += intervalMs) if (q.frame(intervalMs)) steps++;
  return steps;
}

describe('graphics quality', () => {
  it('fixed settings map to levels; levels get cheaper down the list', () => {
    expect(levelFor('high')).toBe(0);
    expect(levelFor('auto')).toBe(0);
    expect(QUALITY_LEVELS[levelFor('medium')].renderScale).toBeLessThan(1);
    expect(QUALITY_LEVELS[levelFor('low')].shadowMapSize).toBe(0);
    for (let i = 1; i < QUALITY_LEVELS.length; i++) {
      const [a, b] = [QUALITY_LEVELS[i - 1], QUALITY_LEVELS[i]];
      expect(b.renderScale <= a.renderScale && b.shadowMapSize <= a.shadowMapSize).toBe(true);
    }
  });

  it('auto keeps full quality at 60 fps (and on a 75 Hz display)', () => {
    const q = new AutoQuality();
    expect(run(q, 1000 / 60, 60)).toBe(0);
    expect(run(q, 1000 / 75, 60)).toBe(0);
    expect(q.level).toBe(0);
  });

  it('auto steps down one level at a time when the frame rate stays below 60, then stops at the bottom', () => {
    const q = new AutoQuality();
    // 40 fps: one step after the settle time plus one judging window.
    expect(run(q, 25, AUTO_QUALITY.settle_s + AUTO_QUALITY.window_s + 0.5)).toBe(1);
    expect(q.level).toBe(1);
    run(q, 25, 120);
    expect(q.level).toBe(QUALITY_LEVELS.length - 1);
  });

  it('ignores stalls (hidden tab) and the settling time after a hold', () => {
    const q = new AutoQuality();
    expect(run(q, 1000, 60)).toBe(0); // one frame a second: a stalled tab, not a slow machine
    q.hold();
    expect(run(q, 25, AUTO_QUALITY.settle_s - 0.5)).toBe(0);
  });
});
