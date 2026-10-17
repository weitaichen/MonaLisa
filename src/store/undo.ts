// OWNER: store agent. Generic bounded undo/redo stack.
//
// `limit` is the number of undo steps kept (so at most limit + 1 states). By default states are stored and handed out
// as structuredClones, so callers can't mutate history by holding on to a reference. `{clone: false}` keeps states by
// reference, which is safe for immutable values (EditState, RM §3.4) and shares their unchanged parts; `key` replaces
// stableKey as the equality test (the editor passes editKey).
export interface UndoOptions<T> {
  clone?: boolean;
  key?: (s: T) => string;
}

export class UndoStack<T> {
  private readonly limit: number;
  private readonly clone: boolean;
  private readonly keyOf: (s: T) => string;
  private states: T[] = [];
  /** key of each state, parallel to `states` (equality test without re-serialising history) */
  private keys: string[] = [];
  private index = -1;

  constructor(limit = 50, opts: UndoOptions<T> = {}) {
    this.limit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 50;
    this.clone = opts.clone ?? true;
    this.keyOf = opts.key ?? stableKey;
  }

  private copy(s: T): T {
    return this.clone ? structuredClone(s) : s;
  }

  /** clear history and set the current state */
  reset(initial: T): void {
    this.states = [this.copy(initial)];
    this.keys = [this.keyOf(initial)];
    this.index = 0;
  }

  /** record a new current state (drops the redo branch); ignores pushes equal (key) to current */
  push(state: T): void {
    const key = this.keyOf(state);
    if (this.index >= 0 && key === this.keys[this.index]) return;
    this.states.length = this.index + 1;
    this.keys.length = this.index + 1;
    this.states.push(this.copy(state));
    this.keys.push(key);
    const excess = this.states.length - 1 - this.limit;
    if (excess > 0) {
      this.states.splice(0, excess);
      this.keys.splice(0, excess);
    }
    this.index = this.states.length - 1;
  }

  /** map every stored state (a detection added persons, p0 handed over, a v1 entry migrated): RM §3.4 */
  rebase(fn: (s: T) => T): void {
    this.states = this.states.map((s) => this.copy(fn(s)));
    this.keys = this.states.map((s) => this.keyOf(s));
  }

  undo(): T | null {
    if (this.index <= 0) return null;
    this.index--;
    return this.copy(this.states[this.index]);
  }

  redo(): T | null {
    if (this.index < 0 || this.index >= this.states.length - 1) return null;
    this.index++;
    return this.copy(this.states[this.index]);
  }

  get current(): T | null {
    return this.index >= 0 ? this.copy(this.states[this.index]) : null;
  }

  get canUndo(): boolean {
    return this.index > 0;
  }

  get canRedo(): boolean {
    return this.index >= 0 && this.index < this.states.length - 1;
  }
}

/** JSON with plain-object keys sorted, so equal states compare equal regardless of key insertion order. */
export function stableKey(value: unknown): string {
  const json = JSON.stringify(value, (_k, v: unknown) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return v;
    const proto: unknown = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return v;
    const src = v as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) sorted[k] = src[k];
    return sorted;
  });
  // JSON.stringify(undefined) is undefined; give it a key distinct from every JSON text
  return json ?? '\u0000undefined';
}
