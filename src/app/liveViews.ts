// The camera's group path, its pure part (camera per-person spec §6.6, K17): the fixed views of the visible crop (the
// whole view and a grid of zoomed tiles), which view refreshes which track, the call schedule, the view → stream UV
// mapping of a call's landmarks, and the scope a call matches and misses in. No DOM, no GL, no tracker.
import { DETECTOR_FLOOR, LIVE_FACE_FLOOR, LIVE_SCAN_EVERY, LIVE_VIEW_MAX_EDGE, MAX_LIVE_FACES } from '../config/limits';
import type { FaceDetectorKind, Facing, Landmarks478, PxRect, Rect } from '../types';

/** one view of the visible crop: its rect in the stream frame's px and the size it is copied at for the detector */
export interface LiveView {
  /** 'whole' or `t${col},${row}` */
  id: string;
  kind: 'whole' | 'tile';
  rect: PxRect;
  copy: { w: number; h: number };
}

/** the views of one stream frame size, crop, facing and detector */
export interface ViewLayout {
  frame: { w: number; h: number };
  crop: PxRect;
  detector: FaceDetectorKind;
  whole: LiveView;
  /** row-major (raster order) */
  tiles: readonly LiveView[];
}

/** what one group-path call may match (faces to tracks) and miss (tracks it finds no face for), on predicted boxes in stream UV */
export interface DetectScope {
  name: string;
  /** the view in stream UV */
  view: Rect;
  matchable(pred: Rect): boolean;
  missable(pred: Rect): boolean;
}

/**
 * Tile positions along one axis of length `len`: `side` squares spread evenly so that neighbours overlap by at least
 * `overlap` (§6.6). A side that cannot overlap that much (a crop far thinner than the app's ratios give) still covers
 * the axis, evenly, without the overlap; an empty side gets one tile.
 */
function axisStarts(len: number, side: number, overlap: number): number[] {
  if (side <= 0 || side >= len) return [0];
  const step = side - overlap;
  const n = step > 0 ? Math.max(2, Math.ceil((len - overlap) / step)) : Math.max(2, Math.ceil(len / side));
  return Array.from({ length: n }, (_, i) => Math.round((i * (len - side)) / (n - 1)));
}

/**
 * §6.6 Views: the whole view (the crop, copied at most LIVE_VIEW_MAX_EDGE on its long edge) and square tiles of side
 * LIVE_FACE_FLOOR[facing] / DETECTOR_FLOOR[detector] × the frame's long edge (at most the crop's short side), copied at
 * native size, neighbours overlapping by DETECTOR_FLOOR[detector] × the crop's long edge.
 */
export function layoutViews(frameW: number, frameH: number, crop: PxRect, facing: Facing, detector: FaceDetectorKind): ViewLayout {
  const long = Math.max(crop.w, crop.h);
  const scale = Math.min(1, LIVE_VIEW_MAX_EDGE / long);
  const whole: LiveView = { id: 'whole', kind: 'whole', rect: { ...crop }, copy: { w: Math.round(crop.w * scale), h: Math.round(crop.h * scale) } };
  const side = Math.min(Math.round((LIVE_FACE_FLOOR[facing] / DETECTOR_FLOOR[detector]) * Math.max(frameW, frameH)), Math.min(crop.w, crop.h));
  const overlap = DETECTOR_FLOOR[detector] * long;
  const xs = axisStarts(crop.w, side, overlap);
  const ys = axisStarts(crop.h, side, overlap);
  const tiles: LiveView[] = [];
  ys.forEach((y, row) =>
    xs.forEach((x, col) =>
      tiles.push({ id: `t${col},${row}`, kind: 'tile', rect: { x: crop.x + x, y: crop.y + y, w: side, h: side }, copy: { w: side, h: side } }),
    ),
  );
  return { frame: { w: frameW, h: frameH }, crop: { ...crop }, detector, whole, tiles };
}

/** the view's rect holds the box (stream UV) whole, compared in the frame's px */
export function holdsWhole(view: LiveView, box: Rect, layout: ViewLayout): boolean {
  const { w, h } = layout.frame;
  const r = view.rect;
  return box.x * w >= r.x && box.y * h >= r.y && (box.x + box.w) * w <= r.x + r.w && (box.y + box.h) * h <= r.y + r.h;
}

/** §6.6 Assignment: a track at least 1.25 × DETECTOR_FLOOR × the crop's long edge wide is large (the whole view refreshes it) */
export function isLarge(box: Rect, layout: ViewLayout): boolean {
  return box.w * layout.frame.w >= 1.25 * DETECTOR_FLOOR[layout.detector] * Math.max(layout.crop.w, layout.crop.h);
}

/** the tile that refreshes a small box: among the tiles holding it whole, the one with the nearest centre (null: none holds it) */
export function tileFor(box: Rect, layout: ViewLayout): LiveView | null {
  const cx = (box.x + box.w / 2) * layout.frame.w;
  const cy = (box.y + box.h / 2) * layout.frame.h;
  let best: LiveView | null = null;
  let bestD = Infinity;
  for (const t of layout.tiles) {
    if (!holdsWhole(t, box, layout)) continue;
    const d = Math.hypot(t.rect.x + t.rect.w / 2 - cx, t.rect.y + t.rect.h / 2 - cy);
    if (d < bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

/** §6.6 Schedule: the refresh views of the tracks' predicted boxes, the whole view first, then each tile a small box needs (raster order) */
export function refreshViews(layout: ViewLayout, boxes: readonly Rect[]): LiveView[] {
  const needed = new Set<LiveView>();
  for (const b of boxes) {
    if (isLarge(b, layout)) continue;
    const t = tileFor(b, layout);
    if (t) needed.add(t);
  }
  return [layout.whole, ...layout.tiles.filter((t) => needed.has(t))];
}

/**
 * §6.6 Mapping and matching: a tile matches and misses what it holds whole (a face cut by its edge is the overlapping
 * tile's); the whole view matches what it holds whole and misses large tracks and tracks no tile holds (a track out of
 * the crop leaves within LOST_HOLD_MS). Every other track is no event for the call.
 */
export function viewScope(view: LiveView, layout: ViewLayout): DetectScope {
  const { w, h } = layout.frame;
  const uv = { x: view.rect.x / w, y: view.rect.y / h, w: view.rect.w / w, h: view.rect.h / h };
  const holds = (pred: Rect) => holdsWhole(view, pred, layout);
  if (view.kind === 'tile') return { name: view.id, view: uv, matchable: holds, missable: holds };
  return {
    name: view.id,
    view: uv,
    matchable: holds,
    missable: (pred) => isLarge(pred, layout) || !layout.tiles.some((t) => holdsWhole(t, pred, layout)),
  };
}

/** a view call's landmarks (normalized to the view) → stream UV: x, y by the rect's offset and scale, z by its width over the frame's */
export function mapLandmarks(lm: Landmarks478, rect: PxRect, frameW: number, frameH: number): Landmarks478 {
  const src = lm.points;
  const out = new Float32Array(src.length);
  const sx = rect.w / frameW;
  const sy = rect.h / frameH;
  const ox = rect.x / frameW;
  const oy = rect.y / frameH;
  for (let i = 0; i + 2 < src.length; i += 3) {
    out[i] = ox + src[i] * sx;
    out[i + 1] = oy + src[i + 1] * sy;
    out[i + 2] = src[i + 2] * sx;
  }
  return { points: out };
}

/**
 * §6.6 Schedule: the group path cycles through its refresh views (in list order, which is raster order with the whole
 * view first); every LIVE_SCAN_EVERY-th call scans instead the next tile in raster order that is not a refresh view,
 * unless MAX_LIVE_FACES faces are tracked or every tile is a refresh view.
 */
export class ViewSchedule {
  private calls = 0;
  private lastRefresh: string | null = null;
  private lastScan: string | null = null;

  next(layout: ViewLayout, refresh: readonly LiveView[], tracked: number): LiveView {
    this.calls++;
    const list = refresh.length > 0 ? refresh : [layout.whole];
    if (this.calls % LIVE_SCAN_EVERY === 0 && tracked < MAX_LIVE_FACES) {
      const busy = new Set(list.map((v) => v.id));
      const tiles = layout.tiles;
      const from = tiles.findIndex((t) => t.id === this.lastScan);
      for (let i = 1; i <= tiles.length; i++) {
        const t = tiles[(from + i) % tiles.length];
        if (!busy.has(t.id)) {
          this.lastScan = t.id;
          return t;
        }
      }
    }
    // the refresh view after the last one returned, by raster position (the whole view first), wrapping; one no longer
    // in the list (its track moved to another tile) still marks the place, so a later tile is not starved
    const rank = (id: string | null): number => {
      if (id === 'whole') return -1;
      const i = id === null ? -1 : layout.tiles.findIndex((t) => t.id === id);
      return i < 0 ? Infinity : i;
    };
    const last = rank(this.lastRefresh);
    const v = list.find((r) => rank(r.id) > last) ?? list[0];
    this.lastRefresh = v.id;
    return v;
  }

  reset(): void {
    this.calls = 0;
    this.lastRefresh = null;
    this.lastScan = null;
  }
}
