import { describe, expect, it } from 'vitest';
import { GameLoop } from '../src/core/GameLoop';
import { MAX_FRAME_TIME_S, PHYSICS_HZ } from '../src/core/constants';

function makeLoop() {
  const log = { steps: 0, renders: 0, alphas: [] as number[], dts: new Set<number>() };
  const loop = new GameLoop({
    step: (dt) => {
      log.steps++;
      log.dts.add(dt);
    },
    render: (alpha) => {
      log.renders++;
      log.alphas.push(alpha);
    },
  });
  return { loop, log };
}

/** Feed a total amount of time as frames of a given rate. */
function run(loop: GameLoop, seconds: number, displayHz: number): void {
  const frames = Math.round(seconds * displayHz);
  for (let i = 0; i < frames; i++) loop.advance(1 / displayHz);
}

describe('GameLoop', () => {
  it.each([30, 60, 120, 144, 165])('runs %i Hz display at exactly 120 physics steps per second', (hz) => {
    const { loop, log } = makeLoop();
    run(loop, 1, hz);
    expect(log.steps).toBe(PHYSICS_HZ);
    expect(log.renders).toBe(hz);
  });

  it('always passes the same fixed dt to physics', () => {
    const { loop, log } = makeLoop();
    run(loop, 2, 144);
    expect([...log.dts]).toEqual([1 / PHYSICS_HZ]);
  });

  it('keeps step count right with irregular frame times', () => {
    const { loop, log } = makeLoop();
    // Pseudo-random frames between 5 and 30 ms, total 10 s.
    let t = 0;
    let seed = 12345;
    while (t < 10 - 1e-9) {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      const frame = Math.min(0.005 + (seed / 2 ** 31) * 0.025, 10 - t);
      loop.advance(frame);
      t += frame;
    }
    expect(Math.abs(log.steps - 10 * PHYSICS_HZ)).toBeLessThanOrEqual(1);
  });

  it('keeps alpha in [0, 1)', () => {
    const { loop, log } = makeLoop();
    run(loop, 1, 144);
    run(loop, 1, 47);
    for (const a of log.alphas) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
  });

  it('caps a long stall at MAX_FRAME_TIME_S of catch-up', () => {
    const { loop, log } = makeLoop();
    const steps = loop.advance(5);
    expect(steps).toBe(Math.round(MAX_FRAME_TIME_S * PHYSICS_HZ));
    expect(log.steps).toBe(steps);
  });

  it('ignores negative frame times', () => {
    const { loop, log } = makeLoop();
    expect(loop.advance(-1)).toBe(0);
    expect(log.renders).toBe(1);
  });

  it('pause stops physics but keeps rendering', () => {
    const { loop, log } = makeLoop();
    loop.paused = true;
    run(loop, 1, 60);
    expect(log.steps).toBe(0);
    expect(log.renders).toBe(60);
  });

  it('resumes cleanly with no burst of catch-up steps', () => {
    const { loop, log } = makeLoop();
    loop.advance(1 / 240); // half a step left in the accumulator
    loop.togglePause();
    run(loop, 3, 60);
    loop.togglePause();
    expect(loop.paused).toBe(false);
    expect(loop.advance(1 / 60)).toBe(2);
    expect(log.steps).toBe(2);
  });

  it('tracks simulated time', () => {
    const { loop } = makeLoop();
    run(loop, 2, 60);
    expect(loop.simTime).toBeCloseTo(2, 9);
    expect(loop.stepCount).toBe(2 * PHYSICS_HZ);
  });
});
