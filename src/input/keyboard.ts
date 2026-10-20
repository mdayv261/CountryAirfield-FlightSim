/** Tracks which keys are held, and lets callers bind one-shot actions to key presses. */
export class Keyboard {
  private readonly held = new Set<string>();
  private readonly actions = new Map<string, () => void>();

  /**
   * While this returns true (a menu is open), keys go to the menu, not the sim: no held keys
   * and no actions, except the ones listed in `alwaysActive` (Escape to close the menu).
   */
  blocked: () => boolean = () => false;
  readonly alwaysActive = new Set<string>(['Escape']);

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (this.blocked() && !this.alwaysActive.has(e.code)) return;
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
    if (this.blocked()) return false;
    return this.held.has(code);
  }
}
