export enum GameState {
  Title = 'title',
  City = 'city',
  Zone = 'zone',
}

/** Minimal state machine — expanded in Phase 1/2 (menus, combat, dead). */
export class StateMachine {
  private current: GameState = GameState.Zone;
  private listeners = new Set<(s: GameState) => void>();

  get state(): GameState {
    return this.current;
  }

  set(state: GameState): void {
    if (this.current === state) return;
    this.current = state;
    for (const fn of this.listeners) fn(state);
  }

  onChange(fn: (s: GameState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
