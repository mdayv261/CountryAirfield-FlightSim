/** Tracks which keys are held, and lets callers bind one-shot actions to key presses. */
export class Keyboard {
  private readonly held = new Set<string>();
  private readonly actions = new Map<string, () => void>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (!e.repeat) this.actions.get(e.code)?.();
      this.held.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.held.delete(e.code));
    // Releasing keys while the window is unfocused would otherwise leave them "stuck".
    target.addEventListener('blur', () => this.held.clear());
  }

  /** Bind an action to a key press, using KeyboardEvent.code names (e.g. 'KeyP'). */
  onPress(code: string, action: () => void): void {
    this.actions.set(code, action);
  }

  isDown(code: string): boolean {
    return this.held.has(code);
  }
}
