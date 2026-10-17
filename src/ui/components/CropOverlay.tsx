// 裁切 mode box (S §2.1): the scrim (a large box-shadow), a 1 pt border, corner L handles, edge bars (自由 only) and the
// rule-of-thirds grid while a gesture or a 拉直 drag runs. Handles are <button>s with labels (zoomPan ignores buttons,
// zoomPan.ts:96, and is off in this mode anyway); one finger inside the box moves it over the fixed photo (S D2). The
// gesture maths is pure (cropModel.ts); CropDrag commits exactly once per gesture, like BandDrag (HeightBandOverlay.tsx).
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { dragCorner, dragEdge, dragMove, type Corner, type Edge } from '../../geometry/cropModel';
import type { CropLayout, CropLock } from '../../geometry/view';
import type { Geometry, Size } from '../../types';

export type Handle = { kind: 'corner'; corner: Corner } | { kind: 'edge'; edge: Edge } | { kind: 'move' };

export interface CropDragHost {
  geometry: Geometry;
  lock: CropLock;
  oSize: Size;
  /** the E box on screen: finger px → plane units */
  eBox: { w: number; h: number };
  onChange(g: Geometry, commit: boolean): void;
}

export class CropDrag {
  private g: { id: number; handle: Handle; x0: number; y0: number; start: Geometry; last: Geometry | null } | null = null;

  constructor(
    private readonly host: () => CropDragHost,
    private readonly onActive: (on: boolean) => void,
  ) {}

  get dragging(): boolean {
    return this.g !== null;
  }

  down(handle: Handle, id: number, x: number, y: number): void {
    if (this.g) return;
    this.g = { id, handle, x0: x, y0: y, start: this.host().geometry, last: null };
    this.onActive(true);
  }

  /** false: not this gesture's pointer */
  move(id: number, x: number, y: number): boolean {
    const g = this.g;
    if (!g || g.id !== id) return false;
    const h = this.host();
    const d = [(x - g.x0) / h.eBox.w, (y - g.y0) / h.eBox.h] as const;
    const next =
      g.handle.kind === 'corner'
        ? dragCorner(g.start, g.handle.corner, d, h.lock, h.oSize)
        : g.handle.kind === 'edge'
          ? dragEdge(g.start, g.handle.edge, d, h.oSize)
          : dragMove(g.start, d, h.oSize);
    if (next === (g.last ?? g.start)) return true;
    g.last = next;
    h.onChange(next, false);
    return true;
  }

  /** release / cancel / lost capture; false: not this gesture's pointer */
  end(id: number): boolean {
    if (!this.g || this.g.id !== id) return false;
    this.finish();
    return true;
  }

  /** the overlay unmounts mid-gesture: commit what is on screen */
  abort(): void {
    if (this.g) this.finish();
  }

  private finish(): void {
    const last = this.g?.last ?? null;
    this.g = null;
    this.onActive(false);
    if (last) this.host().onChange(last, true);
  }
}

const CORNERS: readonly { corner: Corner; label: string }[] = [
  { corner: 'tl', label: '左上角' },
  { corner: 'tr', label: '右上角' },
  { corner: 'bl', label: '左下角' },
  { corner: 'br', label: '右下角' },
];
const EDGES: readonly { edge: Edge; label: string }[] = [
  { edge: 'top', label: '上邊' },
  { edge: 'bottom', label: '下邊' },
  { edge: 'left', label: '左邊' },
  { edge: 'right', label: '右邊' },
];

interface Props {
  layout: CropLayout;
  geometry: Geometry;
  lock: CropLock;
  oSize: Size;
  /** a 拉直 drag is running: show the grid */
  grid: boolean;
  onChange(g: Geometry, commit: boolean): void;
}

export function CropOverlay({ layout, geometry, lock, oSize, grid, onChange }: Props) {
  const [active, setActive] = useState(false);
  const host = useRef<CropDragHost>({ geometry, lock, oSize, eBox: layout.eBox, onChange });
  host.current = { geometry, lock, oSize, eBox: layout.eBox, onChange };
  const drag = useMemo(() => new CropDrag(() => host.current, setActive), []);
  // unmounted mid-gesture (tab switched; no pointerup reaches the box any more): still one undo step (Review Focus 3)
  useEffect(() => () => drag.abort(), [drag]);

  const down = (handle: Handle) => (e: PointerEvent) => {
    // the editor's pinch / pan listens on the stage: a box gesture is not a pan
    e.stopPropagation();
    if (drag.dragging) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.down(handle, e.pointerId, e.clientX, e.clientY);
  };
  const move = (e: PointerEvent) => {
    if (drag.move(e.pointerId, e.clientX, e.clientY)) e.stopPropagation();
  };
  const end = (e: PointerEvent) => {
    if (drag.end(e.pointerId)) e.stopPropagation();
  };
  const follow = { onPointerMove: move, onPointerUp: end, onPointerCancel: end, onLostPointerCapture: end };
  const b = layout.cropBox;
  const shown = active || grid;
  return (
    <div class="crop-overlay" role="group" aria-label="裁切框">
      <div
        class={`crop-box${shown ? ' gesture' : ''}`}
        style={{ left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` }}
        onPointerDown={down({ kind: 'move' })}
        {...follow}
      >
        {shown && <div class="crop-grid" aria-hidden="true" />}
        {CORNERS.map((c) => (
          <button
            key={c.corner}
            type="button"
            class={`crop-handle corner ${c.corner}`}
            aria-label={c.label}
            onPointerDown={down({ kind: 'corner', corner: c.corner })}
            {...follow}
          />
        ))}
        {lock === 'free' &&
          EDGES.map((x) => (
            <button
              key={x.edge}
              type="button"
              class={`crop-handle edge ${x.edge}`}
              aria-label={x.label}
              onPointerDown={down({ kind: 'edge', edge: x.edge })}
              {...follow}
            />
          ))}
      </div>
    </div>
  );
}
