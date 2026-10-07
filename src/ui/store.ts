// Tiny observable store + Preact hook (signals are not installed; spec: hooks/context only).
import { useEffect, useRef, useState } from 'preact/hooks';

export interface Store<T> {
  get(): T;
  set(next: Partial<T> | ((s: T) => Partial<T>)): void;
  subscribe(cb: (s: T) => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const subs = new Set<(s: T) => void>();
  return {
    get: () => state,
    set(next) {
      const patch = typeof next === 'function' ? next(state) : next;
      let changed = false;
      for (const k in patch) {
        if (!Object.is(patch[k], state[k])) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      state = { ...state, ...patch };
      for (const cb of [...subs]) cb(state);
    },
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}

/** Re-renders only when the selected slice changes (Object.is). */
export function useStore<T, S>(store: Store<T>, select: (s: T) => S): S {
  const [value, setValue] = useState(() => select(store.get()));
  const selRef = useRef(select);
  selRef.current = select;
  useEffect(() => {
    const check = (s: T) => {
      const v = selRef.current(s);
      setValue((prev) => (Object.is(prev, v) ? prev : v));
    };
    check(store.get());
    return store.subscribe(check);
  }, [store]);
  return value;
}
