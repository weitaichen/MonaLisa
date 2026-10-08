// Manual 增高 band (body research report §UI): two draggable horizontal lines laid over the photo; the
// screen's slider sets the amount. The lines mark the band where it is SEEN — the stretched rows of the
// output, so the lower line sits at top + (bottom − top)·stretch — and dragging maps back to the source band
// the field builder stretches. Place it inside the box the photo fills (the zoom layer in the Editor): all
// maths uses this element's own client rect, so it follows pinch-zoom.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { HeightBand } from '../../types';

/**
 * stretch factor inside the band per unit amount, for the uncapped defaultStretch only: the field builder caps
 * the crop (bands.ts heightBandStretch / types.ts HeightBand), so the Editor passes heightBandStretch
 */
export const STRETCH_PER_AMOUNT = 0.15;
/** thinnest band the lines allow, in display units (setHeightBand drops < 2 %) */
export const MIN_GAP = 0.06;
const KEY_STEP = 0.01;
const DRAG_SLOP = 3; // px

export type BandStretch = (band: HeightBand) => number;

export const defaultStretch: BandStretch = (b) => 1 + STRETCH_PER_AMOUNT * Math.min(1, Math.max(0, b.amount));

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Source band → where its edges appear in the output (top stays; the band grows downwards). */
export function bandToDisplay(band: HeightBand, stretch: BandStretch = defaultStretch): { top: number; bottom: number } {
  return { top: band.top, bottom: band.top + (band.bottom - band.top) * stretch(band) };
}

/** Display edges → source band at the same amount (inverse of bandToDisplay). */
export function displayToBand(top: number, bottom: number, amount: number, stretch: BandStretch = defaultStretch): HeightBand {
  // the stretch may depend on the source band's length (bands.ts heightBandStretch caps the crop): fixed-point
  // iteration on the source bottom; it is exact in one step for an amount-only stretch
  let src = bottom;
  for (let i = 0; i < 6; i++) {
    const s = Math.max(1e-6, stretch({ top, bottom: src, amount }));
    src = top + (bottom - top) / s;
  }
  return { top: clamp01(top), bottom: clamp01(src), amount };
}

/**
 * Move one edge to `y` (display units), keeping it at least MIN_GAP from the other. The top stays inside the
 * frame; the bottom stays at or above `maxBottom`, the lowest edge a band can show (a stretched band may end
 * below the frame: dragEdge passes where a source band ending at the image bottom is seen).
 */
export function moveEdge(
  edge: 'top' | 'bottom',
  y: number,
  cur: { top: number; bottom: number },
  maxBottom = 1,
): { top: number; bottom: number } {
  if (edge === 'top') return { top: Math.min(Math.max(0, y), cur.bottom - MIN_GAP), bottom: cur.bottom };
  return { top: cur.top, bottom: Math.max(Math.min(maxBottom, y), cur.top + MIN_GAP) };
}

type Edges = { top: number; bottom: number };

/**
 * The display edges of `band` (or the live ones of a drag in progress): `model` is where they really are, used
 * for every edit (pointer drags, arrow keys); `view` is clamped to the frame for drawing only (a lower edge pushed
 * past the bottom still gets a reachable line). An edit that started from `view` would feed the clamp back into
 * the band: moving the top line would shrink it, and moving the lower line by any amount, even downwards, would
 * first snap its source edge up to where the frame ends.
 */
export function bandEdges(band: HeightBand, stretch: BandStretch, live: Edges | null): { model: Edges; view: Edges } {
  const model = live ?? bandToDisplay(band, stretch);
  return { model, view: { top: clamp01(model.top), bottom: Math.min(1, model.bottom) } };
}

/**
 * Move one line to `y` (display units) from the `model` edges → the new display edges and the source band.
 * `display` always shows `band` (bandToDisplay(band) up to rounding), so a caller may feed it back as the next
 * `model`. The emitted band keeps these invariants:
 *  - source rows 0 ≤ top < bottom ≤ 1, and its display length is at least MIN_GAP (setHeightBand keeps it);
 *  - its lower display edge passes the frame bottom by no more than a source band ending at row 1 shows (with
 *    heightBandStretch: HEIGHT_MAX_CROP);
 *  - the amount is the one passed in.
 */
export function dragEdge(
  edge: 'top' | 'bottom',
  y: number,
  model: Edges,
  amount: number,
  stretch: BandStretch,
): { display: Edges; band: HeightBand } {
  // the lowest the lower line can go: where a source band ending at the image bottom is seen (≥ 1 for S ≥ 1)
  const maxBottom = Math.max(1, bandToDisplay({ top: model.top, bottom: 1, amount }, stretch).bottom);
  const moved = moveEdge(edge, y, model, maxBottom);
  let band = displayToBand(moved.top, moved.bottom, amount, stretch);
  let shown = bandToDisplay(band, stretch);
  if (edge === 'top' && shown.bottom - shown.top < MIN_GAP) {
    // the top line came down onto a lower edge past the frame: the source band already ends at the image bottom,
    // so its lower edge is seen higher than `model.bottom` and MIN_GAP from that one no longer holds. Stop the
    // top line where the band (source bottom 1) is still MIN_GAP long on screen: the display length shrinks as
    // the top comes down, so bisect for the lowest such top.
    const at = (t: number) => displayToBand(t, model.bottom, amount, stretch);
    const gap = (t: number) => {
      const d = bandToDisplay(at(t), stretch);
      return d.bottom - d.top;
    };
    let lo = 0;
    let hi = moved.top;
    if (gap(lo) >= MIN_GAP) {
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (gap(mid) >= MIN_GAP) lo = mid;
        else hi = mid;
      }
      band = at(lo);
      shown = bandToDisplay(band, stretch);
    }
  }
  // unclamped: keep the requested edges exactly (bandToDisplay(band) only differs by the fixed-point rounding)
  const same = Math.abs(shown.top - moved.top) < 1e-6 && Math.abs(shown.bottom - moved.bottom) < 1e-6;
  return { display: same ? moved : shown, band };
}

/**
 * One arrow-key step (display units) of one line, from its real edge (`model`; the drawn line of a band pushed
 * past the frame stays at the frame bottom until the real edge comes back up into it).
 */
export function keyStep(edge: 'top' | 'bottom', step: number, band: HeightBand, stretch: BandStretch = defaultStretch): HeightBand {
  const { model } = bandEdges(band, stretch, null);
  return dragEdge(edge, model[edge] + step, model, band.amount, stretch).band;
}

type Edge = 'top' | 'bottom';

/** what a BandDrag reads at each step: the overlay's latest props */
export interface BandDragHost {
  band: HeightBand;
  stretch: BandStretch;
  onChange(band: HeightBand, commit: boolean): void;
}

/**
 * One line drag at a time (pointer id `id`; `y` in display units, `clientY` in px for the slop). Each move runs
 * dragEdge from the edges the gesture started at with the amount it started at, so the drag does not depend on
 * the path taken nor on the band the parent echoes back (which may lag a frame, or fall back to a suggested band
 * at amount 0 were the band ever dropped). Every gesture that moved commits once, its last preview: on release,
 * cancel or lost capture (`end`), or when the overlay goes away mid-drag (`abort`: 按住對比 with another finger,
 * the session dropping, another tool picked), so its edit always gets an undo step.
 */
export class BandDrag {
  private g: {
    id: number;
    edge: Edge;
    grab: number;
    y0: number;
    start: Edges;
    amount: number;
    last: HeightBand | null;
  } | null = null;

  constructor(
    private readonly host: () => BandDragHost,
    /** the live display edges (null: show the band) and the line being dragged */
    private readonly onView: (live: Edges | null, active: Edge | null) => void,
  ) {}

  get dragging(): boolean {
    return this.g !== null;
  }

  /** false: another pointer is already dragging */
  down(edge: Edge, id: number, y: number, clientY: number): boolean {
    if (this.g) return false;
    const { band, stretch } = this.host();
    const start = bandToDisplay(band, stretch);
    // the offset to the real edge, not the drawn one: a lower edge past the frame then moves from where it is
    this.g = { id, edge, grab: y - start[edge], y0: clientY, start, amount: band.amount, last: null };
    this.onView(null, edge);
    return true;
  }

  /** false: not this gesture's pointer */
  move(id: number, y: number, clientY: number): boolean {
    const g = this.g;
    if (!g || g.id !== id) return false;
    if (!g.last && Math.abs(clientY - g.y0) < DRAG_SLOP) return true;
    const { stretch, onChange } = this.host();
    const next = dragEdge(g.edge, y - g.grab, g.start, g.amount, stretch);
    g.last = next.band;
    this.onView(next.display, g.edge);
    onChange(next.band, false);
    return true;
  }

  /** release / cancel / lost capture; false: not this gesture's pointer */
  end(id: number): boolean {
    if (!this.g || this.g.id !== id) return false;
    this.finish(true);
    return true;
  }

  /** the overlay unmounts mid-gesture: commit what is on screen (no view update, the overlay is gone) */
  abort(): void {
    if (this.g) this.finish(false);
  }

  private finish(view: boolean) {
    const last = this.g?.last ?? null;
    this.g = null;
    if (view) this.onView(null, null);
    if (last) this.host().onChange(last, true);
  }
}

interface Props {
  /** the stored band, or where a new one starts (panelModel.bandOrSuggested) */
  band: HeightBand;
  /** commit=false while dragging (live preview), true once per gesture / key press (an undo step) */
  onChange(band: HeightBand, commit: boolean): void;
  /** must match the field builder's stretch: pass bands.ts heightBandStretch (as the Editor does); the default is uncapped */
  stretch?: BandStretch;
}

export function HeightBandOverlay({ band, onChange, stretch = defaultStretch }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  /** display edges while dragging (the band the parent echoes back may lag a frame) and the dragged line */
  const [{ live, active }, setView] = useState<{ live: Edges | null; active: Edge | null }>({ live: null, active: null });
  const host = useRef<BandDragHost>({ band, stretch, onChange });
  host.current = { band, stretch, onChange };
  const drag = useMemo(() => new BandDrag(() => host.current, (l, a) => setView({ live: l, active: a })), []);
  // unmounted mid-drag (no pointerup / cancel reaches the line any more): still one undo step for the edit
  useEffect(() => () => drag.abort(), [drag]);

  // `view` only draws (clamped to the frame); every edit starts from the real edges (bandEdges `model`)
  const { view } = bandEdges(band, stretch, live);

  const yOf = (clientY: number) => {
    const r = rootRef.current?.getBoundingClientRect();
    return r && r.height > 0 ? (clientY - r.top) / r.height : 0;
  };

  const onDown = (edge: Edge) => (e: PointerEvent) => {
    // the editor's pinch / pan listens on the stage: a line drag is not a pan
    e.stopPropagation();
    if (drag.dragging) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.down(edge, e.pointerId, yOf(e.clientY), e.clientY);
  };
  const onMove = (e: PointerEvent) => {
    if (drag.move(e.pointerId, yOf(e.clientY), e.clientY)) e.stopPropagation();
  };
  const end = (e: PointerEvent) => {
    if (drag.end(e.pointerId)) e.stopPropagation();
  };
  const onKey = (edge: Edge) => (e: KeyboardEvent) => {
    const step = e.key === 'ArrowDown' ? KEY_STEP : e.key === 'ArrowUp' ? -KEY_STEP : 0;
    if (!step) return;
    e.preventDefault();
    const next = keyStep(edge, step, band, stretch);
    // already at the limit (e.g. ArrowDown with the source band ending at the image bottom): no empty undo step
    if (Math.abs(next.top - band.top) < 1e-9 && Math.abs(next.bottom - band.bottom) < 1e-9) return;
    onChange(next, true);
  };

  const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
  const line = (edge: 'top' | 'bottom', label: string) => (
    <div
      class={`hband-line ${edge}${active === edge ? ' active' : ''}`}
      style={{ top: pct(view[edge]) }}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(view[edge] * 100)}
      aria-valuetext={`${Math.round(view[edge] * 100)}%`}
      onPointerDown={onDown(edge)}
      onPointerMove={onMove}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onKeyDown={onKey(edge)}
    >
      <span class="hband-rule" />
      <span class="hband-grip" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 5.2 7 2.4l3 2.8M4 8.8l3 2.8 3-2.8" />
        </svg>
      </span>
    </div>
  );

  const idle = band.amount <= 0.01 && !active;
  return (
    <div class={`hband${active ? ' dragging' : ''}`} ref={rootRef}>
      <div class="hband-shade" style={{ top: 0, height: pct(view.top) }} />
      <div class="hband-zone" style={{ top: pct(view.top), height: pct(view.bottom - view.top) }}>
        {idle && <span class="hband-hint">拖曳兩條線框選要拉長的部位</span>}
      </div>
      <div class="hband-shade" style={{ top: pct(view.bottom), bottom: 0 }} />
      {line('top', '增高範圍上緣')}
      {line('bottom', '增高範圍下緣')}
    </div>
  );
}
