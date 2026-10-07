import { useEffect, useRef, useState } from 'preact/hooks';
import type { Engine } from '../../types';
import { reportError } from '../debug';

/** Make sure the selected LUT is uploaded (the engine lazy-loads; we ask early so the swap is instant). */
export function useFilterLoader(engine: Engine | null, filterId: string): void {
  useEffect(() => {
    if (!engine || filterId === 'none') return;
    let p: Promise<void>;
    try {
      p = engine.loadFilter(filterId);
    } catch (e) {
      p = Promise.reject(e);
    }
    p.catch((e: unknown) => reportError(e, `loadFilter(${filterId})`));
  }, [engine, filterId]);
}

/**
 * Press-and-hold (hold-to-compare): true from pointerdown until release / cancel / leave.
 * Keyboard Space/Enter and VoiceOver double-tap arrive as a click with detail 0 (no pointer events, or
 * down+up in one frame): those toggle instead, and blur turns a toggled compare off again.
 */
export function useHold(onChange: (on: boolean) => void) {
  const [held, setHeld] = useState(false);
  const cb = useRef(onChange);
  cb.current = onChange;
  const heldRef = useRef(false);
  const set = (on: boolean) => {
    if (heldRef.current === on) return;
    heldRef.current = on;
    setHeld(on);
    cb.current(on);
  };
  useEffect(() => () => {
    if (heldRef.current) cb.current(false);
  }, []);
  return {
    held,
    /** force off (e.g. the preview went away or a photo is being taken) */
    release: () => set(false),
    props: {
      'aria-pressed': held,
      onPointerDown: (e: PointerEvent) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        set(true);
      },
      onPointerUp: () => set(false),
      onPointerCancel: () => set(false),
      onLostPointerCapture: () => set(false),
      onContextMenu: (e: Event) => e.preventDefault(),
      onClick: (e: MouseEvent) => {
        // a real tap gives detail >= 1 after its pointerup; the pointer path already handled it
        if (e.detail === 0) set(!heldRef.current);
      },
      onBlur: () => set(false),
    },
  };
}
