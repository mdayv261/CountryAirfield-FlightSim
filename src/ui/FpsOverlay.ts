/**
 * Corner readout of display fps, mean frame time and physics steps per second.
 * Averages over a short window so the numbers are readable rather than flickering.
 */
export class FpsOverlay {
  private readonly el: HTMLDivElement;
  private frames = 0;
  private steps = 0;
  private physicsMs = 0;
  private frameMs = 0;
  private renderMs = 0;
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

  /**
   * Call once per rendered frame with the number of physics steps that frame ran, and the
   * CPU time spent on them, on the rest of the frame (camera, instruments, sound, HUD) and in
   * the WebGL render call, ms. (GPU time is not included: the browser runs it in parallel.)
   */
  frame(stepsThisFrame: number, paused: boolean, cpu = { physicsMs: 0, frameMs: 0, renderMs: 0 }, quality = ''): void {
    this.frames++;
    this.steps += stepsThisFrame;
    this.physicsMs += cpu.physicsMs;
    this.frameMs += cpu.frameMs;
    this.renderMs += cpu.renderMs;
    const now = performance.now();
    const elapsed = now - this.windowStartMs;
    if (elapsed < this.windowMs) return;

    const fps = (this.frames * 1000) / elapsed;
    const frameMs = elapsed / this.frames;
    const physHz = (this.steps * 1000) / elapsed;
    const n = this.frames;
    const text =
      `${fps.toFixed(0).padStart(3)} fps  ${frameMs.toFixed(2)} ms\n` +
      `physics ${physHz.toFixed(0)} Hz\n` +
      `cpu ${((this.physicsMs + this.frameMs + this.renderMs) / n).toFixed(1)} ms ` +
      `(phys ${(this.physicsMs / n).toFixed(1)} frame ${(this.frameMs / n).toFixed(1)} draw ${(this.renderMs / n).toFixed(1)})` +
      (quality ? `\ngraphics ${quality}` : '') +
      (paused ? '\nPAUSED  (P to resume)' : '');
    if (text !== this.lastText) {
      this.el.textContent = text;
      this.lastText = text;
    }
    this.frames = 0;
    this.steps = 0;
    this.physicsMs = this.frameMs = this.renderMs = 0;
    this.windowStartMs = now;
  }
}
