// Pinch-zoom / pan / double-tap-to-fit for the editor canvas. Transforms are written straight to the
// layer's style (no re-render per pointer move).
import { useEffect, useRef } from 'preact/hooks';

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

export interface ZoomPanOptions {
  /**
   * One pointer, ≤ 8 px, not started on a button / .slider-row / .status (S §2.3). Fires on the pointer-up, before a
   * double tap's fit, with the UV of the transformed layer (right at any zoom) and that rect.
   */
  onTap?(uv: [number, number], layer: DOMRect): void;
  /** 裁切 open: zoom and pan back to identity */
  resetWhen?: boolean;
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
    let lastTap = 0;
    let moved = false;
    let downAt = { x: 0, y: 0 };

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

    const down = (e: PointerEvent) => {
      if ((e.target as Element).closest('button, .slider-row, .status')) return;
      stage.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) {
        moved = false;
        downAt = { x: e.clientX, y: e.clientY };
      } else moved = true;
      begin();
    };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 8) moved = true;
      if (pts.size >= 2) {
        const t = twoPoint();
        apply(pinchView(start, m0, t.mid, t.dist / d0));
      } else if (start.s > 1) {
        const p = rel([...pts.values()][0]);
        apply({ s: start.s, x: start.x + p.x - m0.x, y: start.y + p.y - m0.y });
      }
    };
    const up = (e: PointerEvent) => {
      if (!pts.delete(e.pointerId)) return;
      if (pts.size === 0 && !moved) {
        const onTap = optsRef.current.onTap;
        // a pointercancel (the browser took the gesture over) is no tap
        if (onTap && e.type === 'pointerup') {
          const r = layer.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) onTap([(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height], r);
        }
        const now = performance.now();
        if (now - lastTap < DOUBLE_TAP_MS) {
          lastTap = 0;
          apply({ s: 1, x: 0, y: 0 }, true);
        } else lastTap = now;
      }
      begin();
    };

    stage.addEventListener('pointerdown', down);
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    return () => {
      stage.removeEventListener('pointerdown', down);
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerup', up);
      stage.removeEventListener('pointercancel', up);
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
