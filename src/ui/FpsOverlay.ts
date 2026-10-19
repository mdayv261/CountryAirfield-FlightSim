/**
 * Corner readout of display fps, mean frame time and physics steps per second.
 * Averages over a short window so the numbers are readable rather than flickering.
 */
export class FpsOverlay {
  private readonly el: HTMLDivElement;
  private frames = 0;
  private steps = 0;
  private windowStartMs = performance.now();
  private lastText = '';

  constructor(parent: HTMLElement, private readonly windowMs = 500) {
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      position: 'fixed',
      top: '8px',
      left: '8px',
      padding: '6px 10px',
      font: '12px/1.4 ui-monospace, Menlo, monospace',
      color: '#fff',
      background: 'rgba(0, 0, 0, 0.45)',
      borderRadius: '4px',
      whiteSpace: 'pre',
      pointerEvents: 'none',
      zIndex: '10',
    });
    parent.appendChild(this.el);
  }

  /** Call once per rendered frame with the number of physics steps that frame ran. */
  frame(stepsThisFrame: number, paused: boolean): void {
    this.frames++;
    this.steps += stepsThisFrame;
    const now = performance.now();
    const elapsed = now - this.windowStartMs;
    if (elapsed < this.windowMs) return;

    const fps = (this.frames * 1000) / elapsed;
    const frameMs = elapsed / this.frames;
    const physHz = (this.steps * 1000) / elapsed;
    const text =
      `${fps.toFixed(0).padStart(3)} fps  ${frameMs.toFixed(2)} ms\n` +
      `physics ${physHz.toFixed(0)} Hz` +
      (paused ? '\nPAUSED  (P to resume)' : '');
    if (text !== this.lastText) {
      this.el.textContent = text;
      this.lastText = text;
    }
    this.frames = 0;
    this.steps = 0;
    this.windowStartMs = now;
  }
}
