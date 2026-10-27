// The camera's group path, its pure part (camera per-person spec §6.6, K17): the fixed views of the visible crop (the
// whole view and a grid of zoomed tiles), which view refreshes which track, the call schedule, the view → stream UV
// mapping of a call's landmarks, and the scope a call matches and misses in (one view's, or the shutter's union of its
// views, §6.6 Capture). No DOM, no GL, no tracker.
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

/**
 * what one group-path call may match (faces to tracks) and miss (tracks it finds no face for), on predicted boxes in
 * stream UV, and which of its faces may start a track
 */
export interface DetectScope {
  name: string;
  /** the view in stream UV */
  view: Rect;
  /** the view holds this box (a track's predicted box, or a face's own box) whole once clipped to the visible crop */
  matchable(box: Rect): boolean;
  missable(pred: Rect): boolean;
  /** a face with this box starts a track (viewScope: the view holds it, as `matchable`); absent: the view holds the box whole, unclipped */
  startable?(box: Rect): boolean;
  /**
   * §7.1 I3: a face whose owner this call cannot tell, because some of its candidate tracks (`preds`, their predicted
   * boxes) are where the view cannot see, is left to another view: true when the own view (`ownViewOf`) of one of them
   * sees every one of them and may start the face (a tile; the whole view only for a large face, the size it finds).
   * Absent: never (the call then cannot tell who the face is: a new person at 原圖, A2)
   */
  defers?(preds: readonly Rect[], box: Rect): boolean;
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

/**
 * the tile that refreshes a small box: among the tiles holding it whole once it is clipped to the visible crop (the
 * relation every view's scope uses, viewScope), the one with the nearest centre (null: none holds it)
 */
export function tileFor(box: Rect, layout: ViewLayout): LiveView | null {
  const cx = (box.x + box.w / 2) * layout.frame.w;
  const cy = (box.y + box.h / 2) * layout.frame.h;
  let best: LiveView | null = null;
  let bestD = Infinity;
  for (const t of layout.tiles) {
    if (!holdsInCrop(t, box, layout)) continue;
    const d = Math.hypot(t.rect.x + t.rect.w / 2 - cx, t.rect.y + t.rect.h / 2 - cy);
    if (d < bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

/** §6.6 Assignment: the view that refreshes a track predicted at `pred`, its own view: the whole view for a large track or one no tile holds, else its tile */
export function ownViewOf(pred: Rect, layout: ViewLayout): LiveView {
  return isLarge(pred, layout) ? layout.whole : (tileFor(pred, layout) ?? layout.whole);
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

/** the view holds the box (stream UV) whole once it is clipped to the visible crop (frame px); false when no part is in the crop */
function holdsInCrop(view: LiveView, box: Rect, layout: ViewLayout): boolean {
  const { w, h } = layout.frame;
  const c = layout.crop;
  const r = view.rect;
  const x0 = Math.max(box.x * w, c.x);
  const y0 = Math.max(box.y * h, c.y);
  const x1 = Math.min((box.x + box.w) * w, c.x + c.w);
  const y1 = Math.min((box.y + box.h) * h, c.y + c.h);
  return x0 < x1 && y0 < y1 && x0 >= r.x && y0 >= r.y && x1 <= r.x + r.w && y1 <= r.y + r.h;
}

/**
 * §6.6 Mapping and matching: one relation says what a view holds, a box (a track's predicted box, or a face's) that it
 * holds whole once the box is clipped to the visible crop (holdsInCrop: no view sees past the crop), and it decides
 * alike which views match a track, which may start a face, which view refreshes a track (tileFor, ownViewOf) and which
 * can miss it, so the view that finds a face is the one that keeps it. The whole view holds every box partly in view. A
 * face cut by a tile's edge inside the crop is the overlapping tile's in every respect; one cut by the crop's own edge
 * (a close-up selfie's forehead or chin on 3:4 or 1:1, a head the back camera's crop cuts, a face that stops near the
 * edge while its velocity carries the prediction past) is held by the views at that edge, which no other view overlaps
 * there: the whole view and the edge tile start it, match it, and the one that refreshes it misses it (C6; round-2
 * review D9: a tile kept the unclipped rule for starting, refreshing and missing, so a small far face the crop's edge
 * cut, which only that tile can find, was never tracked with 合照模式 on; E5, detector.spec.ts D2). A face the view
 * holds may feed a track the view cannot match (one predicted across a tile's edge: round-1 review C5, FaceTracks). A
 * tile misses what it holds; the whole view misses large tracks and tracks no tile holds (a track out of the crop
 * leaves within LOST_HOLD_MS). Every other track is no event for the call. A face whose owner turns on tracks the view
 * cannot see goes to the own view of one of them that sees them all and may start it (`defers`, round-2 review D2,
 * D5): it is in every cycle (`refreshViews`).
 */
export function viewScope(view: LiveView, layout: ViewLayout): DetectScope {
  const { w, h } = layout.frame;
  const uv = { x: view.rect.x / w, y: view.rect.y / h, w: view.rect.w / w, h: view.rect.h / h };
  const matchable = (box: Rect) => holdsInCrop(view, box, layout);
  const defers = (preds: readonly Rect[], box: Rect): boolean => defersTo(preds, box, layout, (own) => own.id === view.id);
  if (view.kind === 'tile') return { name: view.id, view: uv, matchable, missable: matchable, startable: matchable, defers };
  return {
    name: view.id,
    view: uv,
    matchable,
    missable: (pred) => isLarge(pred, layout) || !layout.tiles.some((t) => holdsInCrop(t, pred, layout)),
    startable: matchable,
    defers,
  };
}

/**
 * §7.1 I3 (`DetectScope.defers`): the own view (`ownViewOf`) of one of `preds`, other than the views `here` names (the
 * call's own), that sees every one of them and may start the face at `box` (a tile; the whole view only for a large face)
 */
function defersTo(preds: readonly Rect[], box: Rect, layout: ViewLayout, here: (own: LiveView) => boolean): boolean {
  for (const own of new Set(preds.map((p) => ownViewOf(p, layout)))) {
    if (here(own) || (own.kind === 'whole' && !isLarge(box, layout))) continue;
    const s = viewScope(own, layout);
    const starts = s.startable ?? ((b: Rect) => holdsWhole(own, b, layout));
    if (preds.every((p) => s.matchable(p) || s.missable(p)) && starts(box)) return true;
  }
  return false;
}

/** the name of the shutter's one call over its views' answers (FaceTracks.detectViews, §6.6 Capture) */
export const SHUTTER_SCOPE = 'shutter';

/**
 * §6.6 Capture: the scope of the shutter's one call, the union of `views` (the views of its cycle that answered on the
 * captured frame): it matches and misses what any of them can, so a track is missed only when a view that answered
 * could miss it (and no answer found its face, FaceTracks.detectViews), and a track none of them can match or miss (its
 * own view had no answer) is unknown to the call, a face whose owner turns on it left to that view (I3). Each face keeps
 * its own view's scope for what the call does with it (feeding, starting: detectViews), so the union has no
 * `startable` (round-6 review H8: it was never read).
 */
export function shutterScope(views: readonly LiveView[], layout: ViewLayout): DetectScope {
  const scopes = views.map((v) => viewScope(v, layout));
  const ran = new Set(views.map((v) => v.id));
  const { w, h } = layout.frame;
  const c = layout.crop;
  return {
    name: SHUTTER_SCOPE,
    view: { x: c.x / w, y: c.y / h, w: c.w / w, h: c.h / h },
    matchable: (box) => scopes.some((s) => s.matchable(box)),
    missable: (pred) => scopes.some((s) => s.missable(pred)),
    defers: (preds, box) => defersTo(preds, box, layout, (own) => ran.has(own.id)),
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
