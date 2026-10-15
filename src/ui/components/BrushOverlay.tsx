// 推臉筆 ring (push-brush spec §2.3): an SVG in .frame, outside .zoom-layer, so it is drawn in screen space and needs no
// zoom value. The editor moves it through `handle` on every pointer frame: no re-render per move.
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { LiveStroke } from '../../edit/liquify';
import type { BrushKind } from '../../types';

export type RingLook = 'push' | 'restore' | 'dim';

/** 推: --accent · 恢復: white, dashed 4/4 · --dim while the brush resists (the guard skipped the last stamp) or a cap is hit */
export function ringLook(kind: BrushKind, state: LiveStroke['state']): RingLook {
  return state === 'ok' ? kind : 'dim';
}

export interface RingHandle {
  /** centre in .frame px, radius in CSS px */
  show(x: number, y: number, r: number, look: RingLook): void;
  hide(): void;
}

export function BrushOverlay({ handle }: { handle: { current: RingHandle | null } }) {
  const ref = useRef<SVGCircleElement>(null);
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    handle.current = {
      show(x, y, r, look) {
        c.setAttribute('cx', x.toFixed(1));
        c.setAttribute('cy', y.toFixed(1));
        c.setAttribute('r', Math.max(1, r).toFixed(1));
        c.setAttribute('class', `brush-ring ${look}`);
      },
      hide() {
        c.setAttribute('class', 'brush-ring hidden');
      },
    };
    return () => {
      handle.current = null;
    };
  }, [handle]);
  return (
    <svg class="brush-overlay" aria-hidden="true">
      <circle ref={ref} class="brush-ring hidden" cx="0" cy="0" r="1" />
    </svg>
  );
}
