import { useEffect, useRef, useState } from 'preact/hooks';
import { adjustWanted } from '../../engine/adjustMath';
import { photoLuts } from '../../engine/looks';
import type { Engine, LutKind, PhotoParams } from '../../types';
import { reportError } from '../debug';
import { lookFailedNotice } from '../panelModel';
import { toast } from '../state';

/** looks whose load failure was already announced in this page session (step-2 spec §2.4: once per look) */
const lookFailNoted = new Set<string>();
let adjustFailNoted = false;

/**
 * Ask the engine for a LUT now (it lazy-loads; asking early makes the swap instant). An explicit call also retries a
 * failed one (the re-tap of a selected look). A 質感 that cannot load is announced once per look per session.
 * Resolves true once it is resident, false when it failed (never rejects): a still preview draws only when asked, so
 * the editor redraws after a retry that worked.
 */
export function requestLut(engine: Engine, kind: LutKind, id: string): Promise<boolean> {
  let p: Promise<void>;
  try {
    p = engine.loadLut(kind, id);
  } catch (e) {
    p = Promise.reject(e);
  }
  return p.then(
    () => true,
    (e: unknown) => {
      reportError(e, `loadLut(${kind}, ${id})`);
      // only the LUT's own failure is announced (and spends the once-per-look notice): a load the WebGL context lost
      // under it leaves no 'failed' mark, and the restored context loads it again (the still session's onRestored,
      // the live loop's next frame), so it says nothing (step-2 review)
      let failed = false;
      try {
        failed = !engine.lost && engine.lutState(kind, id) === 'failed';
      } catch {
        // no state to read: say nothing rather than blame the LUT
      }
      if (kind === 'look' && failed && !lookFailNoted.has(id)) {
        lookFailNoted.add(id);
        toast(lookFailedNotice(id), 3200);
      }
      return false;
    },
  );
}

/** The photo's 濾鏡 and 質感 LUTs, requested whenever they change. */
export function useLutLoader(engine: Engine | null, photo: Pick<PhotoParams, 'filterId' | 'look'>): void {
  const filterId = photo.filterId;
  const lookId = photo.look?.id ?? null;
  useEffect(() => {
    if (!engine) return;
    for (const r of photoLuts({ filterId, look: lookId === null ? null : { id: lookId } })) void requestLut(engine, r.kind, r.id);
  }, [engine, filterId, lookId]);
}

/** 「調節效果暫時無法使用」 once per page session, when the engine could not build the 調節 program (step-2 spec §7). */
export function noteAdjustFailure(engine: Pick<Engine, 'adjustUnavailable'>): boolean {
  if (adjustFailNoted || !engine.adjustUnavailable) return false;
  adjustFailNoted = true;
  toast('調節效果暫時無法使用', 3200);
  return true;
}

/** Checks after the frame that asked for 調節 or 質感 has been drawn (sessions draw on the next animation frame). */
export function useAdjustFailureNotice(engine: Engine | null, photo: Pick<PhotoParams, 'values' | 'look'>): void {
  const wanted = adjustWanted(photo.values, photo.look);
  useEffect(() => {
    if (!engine || !wanted || adjustFailNoted) return;
    const t = window.setTimeout(() => noteAdjustFailure(engine), 250);
    return () => clearTimeout(t);
  });
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

/** the element's CSS size, kept current by a ResizeObserver (the 裁切 layout fits the stage) */
export function useElementSize(ref: { current: HTMLElement | null }): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      setSize((s) => (s.width === r.width && s.height === r.height ? s : { width: r.width, height: r.height }));
    };
    read();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return size;
}
