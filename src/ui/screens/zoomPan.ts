// Pinch-zoom / pan / double-tap-to-fit for the editor canvas. Transforms are written straight to the
// layer's style (no re-render per pointer move).
import { useEffect, useRef } from 'preact/hooks';
import { BRUSH_IDLE, brushGesture, brushMoveAction, brushPointers, type BrushEffect, type BrushGestureState } from '../brushGesture';

export interface View {
  s: number;
  x: number;
  y: number;
}

const MAX_SCALE = 5;
const DOUBLE_TAP_MS = 300;

/** Keep the scaled layer covering its box: |t| ≤ (s − 1)·size / 2. */
export function clampView(v: View, w: number, h: number): View {
  const s = Math.min(MAX_SCALE, Math.max(1, v.s));
  const mx = ((s - 1) * w) / 2;
  const my = ((s - 1) * h) / 2;
  return { s, x: Math.min(mx, Math.max(-mx, v.x)), y: Math.min(my, Math.max(-my, v.y)) };
}

/**
 * Pinch about the midpoint: the layer point under the starting midpoint m0 stays under the current
 * midpoint m1. Coordinates are relative to the layer centre.
 */
export function pinchView(start: View, m0: { x: number; y: number }, m1: { x: number; y: number }, ratio: number): View {
  const s = start.s * ratio;
  const px = (m0.x - start.x) / start.s;
  const py = (m0.y - start.y) / start.s;
  return { s, x: m1.x - s * px, y: m1.y - s * py };
}

export const TAP_SLOP_PX = 8;

/** one pointer event of a gesture, for the pure tap rule */
export interface GestureEvent {
  type: 'down' | 'move' | 'up' | 'cancel';
  id: number;
  x: number;
  y: number;
  t: number;
}
export interface TapResult {
  tap: { x: number; y: number; t: number } | null;
  fit: boolean;
}

/**
 * The tap rule of one gesture, from its first pointer down to its last pointer up or cancel. One pointer that never moved
 * more than 8 px is a tap, reported at its up. 'view': a cancel ends the gesture like an up for the double tap (as before;
 * the hook still calls onTap on a pointerup only), and a tap within DOUBLE_TAP_MS of `lastTapT` also fits the view (step 1
 * fires onTap on both taps). 'spot' (祛痘, skin-cleanup spec §2.3): a gesture that ends in a cancel never taps, and nothing fits.
 */
export function tapOutcome(events: readonly GestureEvent[], lastTapT: number, mode: 'view' | 'spot'): TapResult {
  const none: TapResult = { tap: null, fit: false };
  const first = events[0];
  const last = events[events.length - 1];
  if (!first || first.type !== 'down' || !last || (last.type !== 'up' && last.type !== 'cancel')) return none;
  if (events.some((e) => e.id !== first.id)) return none;
  if (events.some((e) => Math.hypot(e.x - first.x, e.y - first.y) > TAP_SLOP_PX)) return none;
  const tap = { x: last.x, y: last.y, t: last.t };
  if (mode === 'spot') return last.type === 'cancel' ? none : { tap, fit: false };
  return { tap, fit: last.t - lastTapT < DOUBLE_TAP_MS };
}

export interface ZoomPanOptions {
  /**
   * One pointer, ≤ 8 px, not started on a button / .slider-row / .status (S §2.3). Fires on the pointer-up, before a
   * double tap's fit, with the UV of the transformed layer (right at any zoom) and that rect.
   */
  onTap?(uv: [number, number], layer: DOMRect): void;
  /** step 4 (祛痘): a tap adds a spot — on pointer-up, never on pointercancel, double-tap-to-fit off; onTap is skipped */
  spotTap?(uv: [number, number], layer: DOMRect): void;
  /** 裁切 open: zoom and pan back to identity */
  resetWhen?: boolean;
  /** step 6 (推臉筆): brush mode — one finger draws, two fingers pinch and pan; onTap and spotTap are not called */
  brush?: BrushHooks | null;
}

/** What brush mode (推臉筆) needs from the editor (push-brush spec §2.5). */
export interface BrushHooks {
  /** the first finger went down at a client point: start a live stroke there */
  start(p: { x: number; y: number }): void;
  /** client points of the drawing finger, coalesced events included, oldest first */
  move(ps: readonly { x: number; y: number }[]): void;
  /** finger up, a late second finger, pointercancel: commit the live stroke */
  commit(): void;
  /** a second finger within PINCH_GRACE_MS: cancel the live stroke (no undo step) */
  cancel(): void;
  /** the live stroke applied a stamp (queued points are applied first); false = it was a tap */
  stamped(): boolean;
  /** pinching started (true) or ended (false): the ring hides while pinching */
  pinch(on: boolean): void;
}

export function useZoomPan(
  stageRef: { current: HTMLElement | null },
  layerRef: { current: HTMLElement | null },
  enabled: boolean,
  opts: ZoomPanOptions = {},
): void {
  const view = useRef<View>({ s: 1, x: 0, y: 0 });
  // read through a ref: the effect depends on [enabled] only and must not call a stale callback
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const stage = stageRef.current;
    const layer = layerRef.current;
    if (!stage || !layer || !enabled) return;
    const pts = new Map<number, { x: number; y: number }>();
    let start: View = view.current;
    let m0 = { x: 0, y: 0 };
    let d0 = 1;
    let lastTap = -Infinity;
    let gesture: GestureEvent[] = [];
    const record = (type: GestureEvent['type'], e: PointerEvent) =>
      gesture.push({ type, id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() });

    const apply = (v: View, animate = false) => {
      view.current = clampView(v, layer.offsetWidth, layer.offsetHeight);
      layer.style.transition = animate ? 'transform 240ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none';
      const { s, x, y } = view.current;
      layer.style.transform = s === 1 && x === 0 && y === 0 ? '' : `translate(${x}px, ${y}px) scale(${s})`;
      // the face boxes keep 2 px strokes and an unscaled badge at any zoom (FaceBoxes, theme.css)
      layer.style.setProperty('--zs', String(s));
    };
    const centre = () => {
      const r = stage.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    const rel = (p: { x: number; y: number }) => {
      const c = centre();
      return { x: p.x - c.x, y: p.y - c.y };
    };
    const twoPoint = () => {
      const [a, b] = [...pts.values()];
      return { mid: rel({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }), dist: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
    };
    const begin = () => {
      start = view.current;
      if (pts.size >= 2) {
        const t = twoPoint();
        m0 = t.mid;
        d0 = t.dist;
      } else if (pts.size === 1) {
        m0 = rel([...pts.values()][0]);
      }
    };

    // ── 推臉筆 brush mode (push-brush spec §2.5): the reducer decides; one finger never pans ──
    let bstate: BrushGestureState = BRUSH_IDLE;
    let bhooks: BrushHooks | null = null;
    const brushFx = (fx: BrushEffect[], b: BrushHooks, e: PointerEvent) => {
      for (const f of fx) {
        if (f === 'strokeStart') b.start({ x: e.clientX, y: e.clientY });
        else if (f === 'strokeCommit') b.commit();
        else if (f === 'strokeCancel') b.cancel();
        else if (f === 'pinchStart') {
          begin();
          b.pinch(true);
        } else if (f === 'pinchEnd') b.pinch(false);
        else if (f === 'fit') apply({ s: 1, x: 0, y: 0 }, true);
      }
    };
    /** the hooks of this event; a new hooks object (mode re-entered) restarts the reducer */
    const brushOf = (): BrushHooks | null => {
      const b = optsRef.current?.brush ?? null;
      if (b !== bhooks) {
        bhooks = b;
        bstate = BRUSH_IDLE;
      }
      return b;
    };
    const brushDown = (e: PointerEvent, b: BrushHooks) => {
      stage.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const r = brushGesture(bstate, { type: 'down', id: e.pointerId, t: performance.now() });
      bstate = r.state;
      const keep = brushPointers(bstate); // a third finger is forgotten at once
      for (const id of [...pts.keys()]) if (!keep.includes(id)) pts.delete(id);
      brushFx(r.effects, b, e);
    };
    const brushMove = (e: PointerEvent, b: BrushHooks) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const act = brushMoveAction(bstate, e.pointerId);
      if (act === 'feed') {
        const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
        b.move(list.length ? list.map((c) => ({ x: c.clientX, y: c.clientY })) : [{ x: e.clientX, y: e.clientY }]);
      } else if (act === 'pinch' && pts.size >= 2) {
        const t = twoPoint();
        apply(pinchView(start, m0, t.mid, t.dist / d0));
      }
    };
    const brushEnd = (e: PointerEvent, b: BrushHooks, cancelled: boolean) => {
      if (!pts.has(e.pointerId)) return;
      const drawing = bstate.kind === 'stroke' && bstate.id === e.pointerId;
      const r = brushGesture(
        bstate,
        cancelled
          ? { type: 'cancel', id: e.pointerId }
          : { type: 'up', id: e.pointerId, t: performance.now(), stamped: drawing ? b.stamped() : false },
      );
      bstate = r.state;
      pts.delete(e.pointerId);
      brushFx(r.effects, b, e);
    };

    const down = (e: PointerEvent) => {
      if ((e.target as Element).closest('button, .slider-row, .status')) return;
      const b = brushOf();
      if (b) {
        if (e.pointerType === 'mouse' && e.button !== 0) return; // the mouse's primary button draws (PB §2.5)
        brushDown(e, b);
        return;
      }
      stage.setPointerCapture(e.pointerId);
      if (pts.size === 0) gesture = [];
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      record('down', e);
      begin();
    };
    const move = (e: PointerEvent) => {
      const b = brushOf();
      if (b) {
        brushMove(e, b);
        return;
      }
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      record('move', e);
      if (pts.size >= 2) {
        const t = twoPoint();
        apply(pinchView(start, m0, t.mid, t.dist / d0));
      } else if (start.s > 1) {
        const p = rel([...pts.values()][0]);
        apply({ s: start.s, x: start.x + p.x - m0.x, y: start.y + p.y - m0.y });
      }
    };
    const end = (e: PointerEvent) => {
      const b = brushOf();
      if (b) {
        brushEnd(e, b, e.type === 'pointercancel');
        return;
      }
      if (!pts.delete(e.pointerId)) return;
      record(e.type === 'pointercancel' ? 'cancel' : 'up', e);
      if (pts.size === 0) {
        const o = optsRef.current;
        const r = tapOutcome(gesture, lastTap, o.spotTap ? 'spot' : 'view');
        gesture = [];
        if (r.tap) {
          const rect = layer.getBoundingClientRect();
          const sized = rect.width > 0 && rect.height > 0;
          const uv: [number, number] = [(r.tap.x - rect.left) / rect.width, (r.tap.y - rect.top) / rect.height];
          if (o.spotTap) {
            if (sized) o.spotTap(uv, rect);
          } else {
            // a pointercancel (the browser took the gesture over) is no tap, but it still ends a double tap (step 1)
            if (sized && e.type === 'pointerup') o.onTap?.(uv, rect);
            if (r.fit) {
              lastTap = -Infinity;
              apply({ s: 1, x: 0, y: 0 }, true);
            } else lastTap = r.tap.t;
          }
        }
      }
      begin();
    };

    stage.addEventListener('pointerdown', down);
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    return () => {
      stage.removeEventListener('pointerdown', down);
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerup', end);
      stage.removeEventListener('pointercancel', end);
    };
  }, [enabled]);

  // 裁切 mode shows the whole photo: zoom and pan return to identity when it opens (S §2.1)
  useEffect(() => {
    if (!opts.resetWhen) return;
    view.current = { s: 1, x: 0, y: 0 };
    const layer = layerRef.current;
    if (layer) {
      layer.style.transition = 'none';
      layer.style.transform = '';
      // step 1's face boxes keep 2 px strokes through --zs (zoomPan apply): back to zoom 1 as well
      layer.style.setProperty('--zs', '1');
    }
  }, [opts.resetWhen]);
}
