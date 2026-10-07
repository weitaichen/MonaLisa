// OWNER: store agent. Generic bounded undo/redo stack.
//
// `limit` is the number of undo steps kept (so at most limit + 1 states). States are stored and
// handed out as structuredClones, so callers can't mutate history by holding on to a reference.
export class UndoStack<T> {
  private readonly limit: number;
  private states: T[] = [];
  /** stableKey of each state, parallel to `states` (equality test without re-serialising history) */
  private keys: string[] = [];
  private index = -1;

  constructor(limit = 50) {
    this.limit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 50;
  }

  /** clear history and set the current state */
  reset(initial: T): void {
    this.states = [structuredClone(initial)];
    this.keys = [stableKey(initial)];
    this.index = 0;
  }

  /** record a new current state (drops the redo branch); ignores pushes equal (JSON) to current */
  push(state: T): void {
    const key = stableKey(state);
    if (this.index >= 0 && key === this.keys[this.index]) return;
    this.states.length = this.index + 1;
    this.keys.length = this.index + 1;
    this.states.push(structuredClone(state));
    this.keys.push(key);
    const excess = this.states.length - 1 - this.limit;
    if (excess > 0) {
      this.states.splice(0, excess);
      this.keys.splice(0, excess);
    }
    this.index = this.states.length - 1;
  }

  undo(): T | null {
    if (this.index <= 0) return null;
    this.index--;
    return structuredClone(this.states[this.index]);
  }

  redo(): T | null {
    if (this.index < 0 || this.index >= this.states.length - 1) return null;
    this.index++;
    return structuredClone(this.states[this.index]);
  }

  get current(): T | null {
    return this.index >= 0 ? structuredClone(this.states[this.index]) : null;
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
