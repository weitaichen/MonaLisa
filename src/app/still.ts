// OWNER: app-glue agent. Editor session for one still image: detect once, render on demand (rAF-coalesced).
// v0.4 (S §3.4 S1): every selectable face of the photo (cache order f0…) plus the obstacles; the caller builds the
// frame (src/edit/frame.ts buildFrame), each face carrying its own 瘦臉 limit (A6).
import { EDIT_DETECT_FACES, HANDOVER_ZOOM_FACE } from '../config/limits';
import { adaptCached, prepareFaces, prepareWith, type PreparedFace, type PreparedFaces } from '../detect/faces';
import { seedPrimary } from '../detect/persons';
import { photoLuts } from '../engine/looks';
import { IDENTITY_GEOMETRY, snapCrop, viewSize } from '../geometry/view';
import type { TileInputBase } from '../media/exportFull';
import { faceBoundsFor, spotBounds, type TileBounds } from '../media/exportPlan';
import type { BodyField, CachedFace, CachedObstacle, Engine, Face, Geometry, Landmarks478, LiquifyField, PxRect, Rect, RenderInput, RenderStats, Size, StillFrame, Tracker } from '../types';
import { debugState, reportError } from './debug';
import { mapLandmarks } from './liveViews';

export interface SessionFace {
  id: string;
  face: Face;
  box: Rect;
  /** the raw 478×3 landmarks (the cache keeps them) */
  lm: Float32Array;
}

export interface StillSession {
  readonly width: number;
  readonly height: number;
  /** the selectable faces (cache order f0…), adapted at this bitmap's size */
  readonly faces: readonly SessionFace[];
  /** faces dropped by the size filter or the cap: no effects, they bound the caps */
  readonly obstacles: readonly CachedObstacle[];
  /** this session's detection drops (zeros when the faces were given) */
  readonly dropped: { tooSmall: number; overCap: number };
  /**
   * the photo detector this session's own detection ran (Tracker.photoDetector): 'short-range' while the full-range one
   * was unavailable, which the detection cache records (DetectionCache.photoDetector, step-1 spec §6.5). null: the faces
   * were given, there is no tracker, or the detection threw
   */
  readonly detector: 'full-range' | 'short-range' | null;
  /**
   * false when the detector threw, so no faces is not a real "no face" (the tracker rebuilds its graph
   * on the next call). An empty answer from a tracker that is recovering cannot be told apart here: callers
   * combine this with the tracker health (svc.tracker).
   */
  readonly faceKnown: boolean;
  /** schedule a render of `frame` (coalesced to one per animation frame) */
  render(frame: StillFrame): void;
  /** show the original while held */
  setCompare(on: boolean): void;
  /**
   * 美體 displacement field (null = none), applied to every later render and export so the file matches the
   * preview. Pass the same object again after the builder refilled its buffer (new `version`): it redraws.
   */
  setBody(field: BodyField | null): void;
  /** the field set last (a replacement session is seeded with it) */
  readonly body: BodyField | null;
  /**
   * 推臉筆 field (null = no strokes), applied to every later render and export like the body field. The editor's
   * LiquifyModel refills it in place (new `version`): pass the same object again and it redraws.
   */
  setLiquify(field: LiquifyField | null): void;
  /** the field set last (a replacement session is seeded with it) */
  readonly liquify: LiquifyField | null;
  /**
   * Resolves once what an export of `frame` needs is resident (the 濾鏡 and 質感 LUTs may still be downloading:
   * no SW, Lockdown Mode, slow network). Never rejects: a LUT that fails to load is skipped by the preview
   * too, so the export then matches it without that LUT.
   */
  prepareExport(frame: StillFrame): Promise<void>;
  /**
   * true when an export of `frame` would match the preview right now: the static textures and the engine's 濾鏡 and
   * 質感 LUT states have settled (ready or failed) on the current context. false → prepareExport first.
   */
  exportReady(frame: StillFrame): boolean;
  /**
   * full-resolution export of `frame`, never mirrored (synchronous; call prepareExport first so it matches the
   * preview). `frame` (with each face's 瘦臉 limit) and `body` are what the caller captured when the export was asked
   * for (a 美體 edit while it waits for a filter LUT must not leak into it); `body` omitted → the field set last. The
   * filter LUT is the session's at export time, as the settled preview draws it. `liquify` as `body`: the snapshot
   * taken when the export was asked for; omitted → the field set last.
   */
  exportImageData(frame: StillFrame, body?: BodyField | null, liquify?: LiquifyField | null): ImageData;
  /** V pixel size of `g` at the working density (the editor frame's aspect) */
  viewSizeFor(g: Geometry): Size;
  /**
   * 'crop' (the 裁切 tab): display frames draw the whole O image (identity geometry; CSS turns the canvas) and a
   * geometry-only change draws nothing. Exports always apply the frame's geometry.
   */
  setViewMode(mode: ViewMode): void;
  /** held during a tiled export: no display frame at all (the last one stays on screen); lifting it draws once */
  pauseDisplay(on: boolean): void;
  /**
   * the tile runner's input: the frame plus the session's body and 推臉筆 fields (`liquify` as `body`: undefined → the
   * field set last, null → none), the working aspect and (step 4) the working bitmap as toneSource, geometry unsnapped
   */
  tileInput(frame: StillFrame, body?: BodyField | null, liquify?: LiquifyField | null): TileInputBase;
  /** the planner's displacement bounds for this frame, with step 4's spot windows and GL budget hooks, and the 推臉筆 term when given */
  bounds(frame: StillFrame, body?: BodyField | null, liquifyMaxDisp?: (rectO: Rect) => number): TileBounds;
  /**
   * The screen is closing but an export is still pending: stop drawing to the shared display canvas (another
   * screen owns it now). prepareExport / exportImageData keep working until dispose.
   */
  stopDisplay(): void;
  dispose(): void;
}

export type ViewMode = 'crop' | 'normal';

function shallowSame(x: unknown, y: unknown): boolean {
  if (Object.is(x, y)) return true;
  if (Array.isArray(x) && Array.isArray(y)) return x.length === y.length && x.every((v, i) => shallowSame(v, y[i]));
  if (x && y && typeof x === 'object' && typeof y === 'object' && Object.getPrototypeOf(x) === Object.prototype && Object.getPrototypeOf(y) === Object.prototype) {
    const a = x as Record<string, unknown>;
    const b = y as Record<string, unknown>;
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => Object.is(a[k], b[k]));
  }
  return false;
}

/** two frames draw the same crop-mode display (the geometry is the only difference): edits share their unchanged parts */
export function sameDisplayFrame(a: StillFrame, b: StillFrame): boolean {
  const ra = a as unknown as Record<string, unknown>;
  const rb = b as unknown as Record<string, unknown>;
  for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
    if (k === 'geometry') continue;
    if (k === 'photo') {
      const pa = ra.photo as Record<string, unknown>;
      const pb = rb.photo as Record<string, unknown>;
      for (const q of new Set([...Object.keys(pa), ...Object.keys(pb)])) if (q !== 'geometry' && !Object.is(pa[q], pb[q])) return false;
      continue;
    }
    if (!shallowSame(ra[k], rb[k])) return false;
  }
  return true;
}

export interface StillSessionOptions {
  /** close `bitmap` on dispose (default true). false lets the caller rebind the same photo to a new engine. */
  ownsBitmap?: boolean;
  /**
   * Faces already known for this bitmap (the detection cache, or the session a lost engine took along): adapted at
   * the bitmap size and used without detecting again, with or without a tracker. undefined → detect.
   */
  faces?: readonly CachedFace[];
  /** the obstacles that go with `faces` */
  obstacles?: readonly CachedObstacle[];
  /** 美體 field to start with (a replacement session keeps the edit on its first frame) */
  body?: BodyField | null;
  /** 推臉筆 field to start with (a replacement session draws the strokes on its first frame) */
  liquify?: LiquifyField | null;
  /**
   * The camera hand-over's face seed (O-space, EditorSource.faceSeed), for the photo's first answer only: a full-range
   * answer with no face whose padded box holds it also asks the short-range detector, and adds the faces of that answer
   * that hold it (D2, step-1 spec §6.5). null / absent: none (an import, 全部, a later answer).
   */
  faceSeed?: { x: number; y: number } | null;
  /**
   * The camera hand-over's boxes (O-space, EditorSource.handOver: each edited camera person's face), for the photo's
   * first answer only: a box no full-range face holds is retried, zoomed or short-range (camera per-person spec §5.4,
   * K21). null / absent: none.
   */
  handOver?: readonly Rect[] | null;
}

/** prepareExport re-waits after a loss + restore during its wait at most this often (repeated cycles cannot loop) */
const PREPARE_RETRIES = 3;

/** `bitmap` is owned by the session afterwards (closed on dispose) unless `opts.ownsBitmap` is false. */
export function createStillSession(
  engine: Engine,
  tracker: Tracker | null,
  bitmap: ImageBitmap,
  opts: StillSessionOptions = {},
): StillSession {
  const ownsBitmap = opts.ownsBitmap ?? true;
  const width = bitmap.width;
  const height = bitmap.height;
  const detected =
    opts.faces !== undefined
      ? fromCache(opts.faces, opts.obstacles ?? [], width, height)
      : detectOnce(tracker, bitmap, width, height, opts.faceSeed ?? null, opts.handOver ?? []);
  // window.__meiyan.face describes whatever is on screen: the photo now (the live loop is stopped)
  const dbg = debugState();
  if (dbg) {
    dbg.face = detected.faces.length > 0;
    dbg.faces = detected.faces.length;
    dbg.boxes = detected.faces.map((f) => ({ id: f.id, ...f.box }));
    dbg.stillSessions = (dbg.stillSessions ?? 0) + 1;
  }
  /** LUT loads this session waits on to redraw (`${kind}:${id}`); cleared on restore */
  const waiting = new Set<string>();
  /** whether `ready` (the static textures) has settled on the current context */
  let staticsSettled = false;
  /** bumped on every restore: loads started against the old context no longer count as settled */
  let gen = 0;
  let displayOff = false;

  let frame: StillFrame | null = null;
  let body: BodyField | null = opts.body ?? null;
  let liquify: LiquifyField | null = opts.liquify ?? null;
  let compare = false;
  let raf = 0;
  let disposed = false;
  let mode: ViewMode = 'normal';
  let paused = false;
  /** the frame the display last drew (crop mode compares against it) */
  let drawn: StillFrame | null = null;
  const oSize: Size = { width, height };
  const viewGeometry = (f: StillFrame) => (mode === 'crop' ? IDENTITY_GEOMETRY : snapCrop(f.geometry ?? IDENTITY_GEOMETRY, oSize));

  // exports and thumbnails: V, the crop snapped to whole working pixels
  const input = (f: StillFrame, b: BodyField | null = body, l: LiquifyField | null = liquify): RenderInput => ({
    source: bitmap,
    width,
    height,
    ...f,
    geometry: snapCrop(f.geometry ?? IDENTITY_GEOMETRY, oSize),
    body: b,
    liquify: l,
  });

  function schedule(): void {
    if (disposed || displayOff || paused || raf || !frame) return;
    raf = requestAnimationFrame(flush);
  }

  function flush(): void {
    raf = 0;
    if (disposed || displayOff || paused || !frame) return;
    // context lost: keep the pending render and retry next frame (the engine rebuilds itself on restore)
    if (engine.lost) {
      schedule();
      return;
    }
    try {
      // the engine is shared with the live loop, whose front-camera preview is mirrored
      engine.setOptions({ mirror: false });
      let st: RenderStats | null = null;
      if (compare) engine.renderOriginal({ source: bitmap, width, height, geometry: viewGeometry(frame) }, { still: true });
      else st = engine.render({ ...input(frame), geometry: viewGeometry(frame) }, { still: true });
      drawn = frame;
      const d = debugState();
      if (d) {
        d.renderCount = (d.renderCount ?? 0) + 1;
        // skin-cleanup spec §3.2: the display frame's passes, and the tone-field rebuilds (e2e: a 瘦臉 drag rebuilds nothing)
        if (st) {
          d.passes = st.passes;
          if (st.toneBuilt) d.toneBuilds += 1;
        }
      }
    } catch (err) {
      reportError('still render', err);
    }
  }

  /**
   * Ask for every LUT the photo draws with (濾鏡 and 質感) and redraw when one arrives: the first frame may have gone
   * out without it. A LUT already resident needs nothing; a failed one is retried only by an explicit tap (the
   * screen's requestLut), so the preview and the export both skip it.
   */
  function ensureLuts(photo: StillFrame['photo']): void {
    for (const r of photoLuts(photo)) {
      const state = engine.lutState(r.kind, r.id);
      if (state === 'ready' || state === 'failed') continue;
      const key = `${r.kind}:${r.id}`;
      if (waiting.has(key)) continue;
      waiting.add(key);
      engine.loadLut(r.kind, r.id).then(
        () => {
          waiting.delete(key);
          schedule();
        },
        (err: unknown) => {
          waiting.delete(key);
          reportError(`${r.kind} ${r.id}`, err);
        },
      );
    }
  }

  function trackStatics(): void {
    const g = gen;
    const settled = () => {
      if (g === gen) staticsSettled = true;
    };
    engine.ready.then(
      () => {
        settled();
        schedule();
      },
      (err: unknown) => {
        settled();
        reportError('engine ready', err);
      },
    );
  }

  // static textures (skin LUTs, makeup) may still be uploading when the first render goes out
  trackStatics();

  // After a restore the drawing buffer is blank and every texture reloads asynchronously, but nothing
  // else asks for a frame: redraw now, re-request the LUTs (dropped with the old context) and redraw
  // again once the static textures are back. The engine's own listener was added first, so it has
  // already rebuilt by the time this runs.
  const onRestored = () => {
    if (disposed) return;
    gen++;
    waiting.clear();
    staticsSettled = false;
    if (frame) ensureLuts(frame.photo);
    trackStatics();
    schedule();
  };
  engine.canvas.addEventListener('webglcontextrestored', onRestored);

  function prepare(f: StillFrame, retries: number): Promise<void> {
    if (disposed) return Promise.resolve();
    // static textures (skin LUTs, makeup) too: after a context restore they reload asynchronously
    const ready = engine.ready;
    const g = gen;
    const statics = ready.catch(() => undefined);
    const luts = photoLuts(f.photo);
    // loadLut retries a failed LUT: one that loads now is in the export, so the preview must redraw with it too
    // (ensureLuts skips failed ones, so nothing else would ask for that frame; step-2 review)
    const retried = luts.filter((r) => engine.lutState(r.kind, r.id) === 'failed');
    const loads = luts.map((r) => {
      try {
        return engine.loadLut(r.kind, r.id).catch(() => undefined);
      } catch {
        return Promise.resolve(undefined);
      }
    });
    return Promise.all([statics, ...loads]).then(() => {
      // still lost (or closed): exportImageData throws and the callers handle that
      if (disposed || engine.lost) return;
      // lost and restored meanwhile: the loads above settled against the dead context without leaving their
      // textures behind, so wait for the reloaded ones (new `ready`, fresh LUT loads)
      if (engine.ready !== ready || g !== gen) {
        if (retries > 0) return prepare(f, retries - 1);
        return;
      }
      staticsSettled = true;
      if (retried.some((r) => engine.lutState(r.kind, r.id) === 'ready')) schedule();
    });
  }

  return {
    width,
    height,
    faces: detected.faces,
    obstacles: detected.obstacles,
    dropped: detected.dropped,
    faceKnown: detected.known,
    detector: detected.detector,
    render(f) {
      if (disposed) return;
      frame = f;
      ensureLuts(f.photo);
      // 裁切: a geometry-only change draws nothing (CSS shows it)
      if (mode === 'crop' && drawn && !raf && sameDisplayFrame(drawn, f)) return;
      schedule();
    },
    setCompare(on) {
      if (compare === on) return;
      compare = on;
      schedule();
    },
    get body() {
      return body;
    },
    setBody(field) {
      if (disposed) return;
      body = field;
      schedule();
    },
    get liquify() {
      return liquify;
    },
    setLiquify(field) {
      if (disposed) return;
      liquify = field;
      schedule();
    },
    prepareExport(f) {
      return prepare(f, PREPARE_RETRIES);
    },
    exportReady(f) {
      if (disposed || engine.lost || !staticsSettled) return false;
      // ask the engine, not a local set: the LRU may have evicted a LUT this session loaded earlier
      return photoLuts(f.photo).every((r) => {
        const s = engine.lutState(r.kind, r.id);
        return s === 'ready' || s === 'failed';
      });
    },
    exportImageData(f, b, l) {
      if (disposed) throw new Error('StillSession: disposed');
      ensureLuts(f.photo);
      const img = engine.renderToImageData(input(f, b === undefined ? body : b, l === undefined ? liquify : l), { mirror: false });
      // the display keeps showing the last frame; redraw in case the offscreen render disturbed it. Not in 裁切 mode: the
      // debounced autosave after a gesture must draw no engine frame (S §6.3)
      if (mode !== 'crop') schedule();
      return img;
    },
    viewSizeFor(g) {
      return viewSize(snapCrop(g, oSize), oSize);
    },
    setViewMode(m) {
      if (disposed || m === mode) return;
      mode = m;
      schedule();
    },
    pauseDisplay(on) {
      if (disposed || on === paused) return;
      paused = on;
      if (on) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
      } else schedule();
    },
    tileInput(f, b, l) {
      // the runner sets source, size, window and output per tile; the 推臉筆 field is the export's snapshot
      const all: Partial<RenderInput> = { ...input(f, b === undefined ? body : b, l === undefined ? liquify : l) };
      delete all.source;
      delete all.width;
      delete all.height;
      // skin-cleanup spec §4.6: every tile carries the working image, so a tile engine without the preview's tone field rebuilds it
      return { ...(all as TileInputBase), geometry: f.geometry ?? IDENTITY_GEOMETRY, oAspect: width / height, toneSource: { source: bitmap, width, height } };
    },
    bounds(f, b, liquifyMaxDisp) {
      // step 4 (skin-cleanup spec §4.6): B at window size while a 膚質 pass runs, and the spot windows; step 6: the strokes' reach
      return {
        body: b === undefined ? body : b,
        faces: faceBoundsFor(f.faces, width / height),
        ...spotBounds(f, { width, height }),
        ...(liquifyMaxDisp ? { liquifyMaxDisp } : {}),
      };
    },
    stopDisplay() {
      displayOff = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      engine.canvas.removeEventListener('webglcontextrestored', onRestored);
      // the pipeline's 美體 / 推臉筆 textures and its references to this photo's fields (the 推臉筆 buffer is 1.5 MB):
      // nothing draws with them after the session; a session that follows on this engine uploads its own again
      try {
        engine.releaseFields();
      } catch (e) {
        reportError('releaseFields', e);
      }
      liquify = null;
      body = null;
      if (!ownsBitmap) return;
      try {
        bitmap.close();
      } catch {
        // already closed / detached: nothing to free
      }
    },
  };
}

interface Detected {
  faces: SessionFace[];
  obstacles: CachedObstacle[];
  dropped: { tooSmall: number; overCap: number };
  known: boolean;
  detector: 'full-range' | 'short-range' | null;
}

/** one face answer of a photo without a session (detectStill) */
export interface StillDetection {
  readonly faces: readonly SessionFace[];
  readonly obstacles: readonly CachedObstacle[];
  readonly dropped: { tooSmall: number; overCap: number };
  /** as StillSession.faceKnown */
  readonly faceKnown: boolean;
  /** as StillSession.detector */
  readonly detector: 'full-range' | 'short-range' | null;
}

/**
 * The face detection a session runs (the short-range retry included, no camera seed), without a session: the
 * completion's probe (step-1 spec §6.5). It draws nothing and holds nothing, so the session bound to the engine keeps its
 * 美體 and 推臉筆 field textures (a session's dispose releases the engine's, round 4: the probe session released the
 * bound one's) and the debug state keeps describing what is on screen; `detectCalls` counts it like any answer.
 */
export function detectStill(tracker: Tracker, bitmap: ImageBitmap): StillDetection {
  const d = detectOnce(tracker, bitmap, bitmap.width, bitmap.height, null, []);
  return { faces: d.faces, obstacles: d.obstacles, dropped: d.dropped, faceKnown: d.known, detector: d.detector };
}

const NO_DROPS = { tooSmall: 0, overCap: 0 };

function fromCache(faces: readonly CachedFace[], obstacles: readonly CachedObstacle[], width: number, height: number): Detected {
  return {
    faces: faces.map((c) => ({ id: c.id, face: adaptCached(c, width, height), box: c.box, lm: c.lm })),
    obstacles: [...obstacles],
    dropped: { ...NO_DROPS },
    known: true,
    detector: null,
  };
}

/**
 * The zoomed hand-over retry's crop (camera per-person spec §5.4, K21), in the width × height image's px: a square of
 * side min(long edge, box width / HANDOVER_ZOOM_FACE) centred on the box, moved inside the image and clipped to it.
 */
export function zoomCrop(box: Rect, width: number, height: number): PxRect {
  const side = Math.max(1, Math.round(Math.min(Math.max(width, height), (box.w * width) / HANDOVER_ZOOM_FACE)));
  const w = Math.min(side, width);
  const h = Math.min(side, height);
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
  return {
    x: clamp(Math.round((box.x + box.w / 2) * width - side / 2), width - w),
    y: clamp(Math.round((box.y + box.h / 2) * height - side / 2), height - h),
    w,
    h,
  };
}

/** `r` of the bitmap copied 1:1 for one detection: an OffscreenCanvas, a document canvas where its 2D context is missing */
function cropCanvas(bitmap: ImageBitmap, r: PxRect): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(r.w, r.h);
    const ctx = canvas.getContext('2d') as CanvasDrawImage | null;
    if (ctx) {
      ctx.drawImage(bitmap, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      return canvas;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = r.w;
  canvas.height = r.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2D context for the hand-over crop');
  ctx.drawImage(bitmap, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  return canvas;
}

const centreOf = (b: Rect) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/**
 * One face answer (step-1 spec §6.5, camera per-person spec §5.4). BlazeFace full-range misses a face that fills the
 * frame or is cut off by its edge (a close-up, a forehead cut at the brows, a face partly past a side), which the
 * camera's short-range detector finds, and a face under its ~9 % floor, which the camera hands over down to 3 % (K17).
 * A seed is missed when its point lies in no padded full-range face box (SEED_BOX_PAD): the camera's face seed, and the
 * centre of each camera hand-over box (`boxes`, the photo's first answer only). The retries, each at most once:
 * 1. no usable face (none that prepareFaces keeps): the short-range answer is taken whole when it has a face. A throw
 *    propagates (detectOnce: unsure, so the bounded re-detect asks again);
 * 2. the seeds still missed: the face seed (when the answer has faces) and every box a quarter of the long edge wide or
 *    more (its crop would be the whole image: a large face full-range missed) share one short-range pass, the one of 1
 *    if it ran; its faces that hold any of those seeds are added (D2). Each smaller box gets one full-range detection
 *    on its zoomCrop, its faces mapped back to the photo's UV (mapLandmarks), and the one nearest the box's centre whose
 *    padded box holds it is added (K21). A throw in either keeps the answer (that seed stays missed: firstAnswer counts
 *    a box's person, the face seed routes as an import's, C6).
 * The faces added join the answer through prepareWith, each in place of any face on its head (sameHead: their landmarks
 * nearly coincide, however the detectors box that head), under prepareFaces' rules (MIN_FACE_FRAC, the cap, display
 * order and ids). Otherwise full-range faces are never merged with a short-range pass: that would cost every photo a
 * second graph rebuild and inference (§6.5). The tracker given may be upTracker's, so a sideways scan retries the same way.
 */
function detectFaces(
  tracker: Tracker,
  bitmap: ImageBitmap,
  width: number,
  height: number,
  seed: { x: number; y: number } | null,
  boxes: readonly Rect[],
): { prepared: PreparedFaces; detector: 'full-range' | 'short-range' } {
  const raw = tracker.detectImage(bitmap, { maxFaces: EDIT_DETECT_FACES });
  let base: readonly Landmarks478[] = raw;
  let first = prepareFaces(raw, width, height);
  // what that detection ran (read right after it, synchronously: the same answer the switch to IMAGE got)
  const detector = tracker.photoDetector;
  if (detector !== 'full-range') return { prepared: first, detector };
  // one per answer that runs any retry (counted before it runs, so a retry that throws counts too)
  let counted = false;
  const count = () => {
    if (counted) return;
    counted = true;
    const dbg = debugState();
    if (dbg) dbg.detectRetries = (dbg.detectRetries ?? 0) + 1;
  };
  let short: Landmarks478[] | null = null;
  const runShort = (): Landmarks478[] => {
    if (short) return short;
    count();
    return (short = tracker.detectImage(bitmap, { maxFaces: EDIT_DETECT_FACES, detector: 'camera' }));
  };
  // 1. no usable face: the short-range answer, taken whole when it has one
  if (!first.faces.length) {
    const r = prepareFaces(runShort(), width, height);
    if (r.faces.length) {
      base = short!;
      first = r;
    }
  }
  // 2. the seeds still missed
  const missed = (pt: { x: number; y: number }) => seedPrimary(pt, first.faces) === null;
  const long = Math.max(width, height);
  const lost = boxes.filter((b) => missed(centreOf(b)));
  const big = lost.filter((b) => b.w * width >= HANDOVER_ZOOM_FACE * long);
  const small = lost.filter((b) => b.w * width < HANDOVER_ZOOM_FACE * long);
  const pointMissed = !!seed && first.faces.length > 0 && missed(seed);
  const held: PreparedFace[] = [];
  if (pointMissed || big.length) {
    try {
      const r = prepareFaces(runShort(), width, height).faces;
      // each face once, however many seeds it holds
      for (const pt of [...(pointMissed && seed ? [seed] : []), ...big.map(centreOf)]) for (const f of r) if (seedPrimary(pt, [f]) !== null && !held.includes(f)) held.push(f);
    } catch (err) {
      // an extra pass over an answer that has faces (or a box retry after 1 answered): the answer stands
      reportError('still detect retry', err);
    }
  }
  for (const b of small) {
    const c = centreOf(b);
    const d = (f: PreparedFace) => Math.hypot(f.box.x + f.box.w / 2 - c.x, f.box.y + f.box.h / 2 - c.y);
    try {
      const crop = zoomCrop(b, width, height);
      count();
      const lms = tracker.detectImage(cropCanvas(bitmap, crop), { maxFaces: EDIT_DETECT_FACES }).map((l) => mapLandmarks(l, crop, width, height));
      const hit = prepareFaces(lms, width, height).faces.filter((f) => seedPrimary(c, [f]) !== null);
      if (hit.length) held.push(hit.reduce((x, y) => (d(x) <= d(y) ? x : y)));
    } catch (err) {
      // that box stays missed (firstAnswer counts its person for the toast)
      reportError('still detect zoomed retry', err);
    }
  }
  return { prepared: held.length ? prepareWith(base, held, width, height) : first, detector };
}

function detectOnce(tracker: Tracker | null, bitmap: ImageBitmap, width: number, height: number, seed: { x: number; y: number } | null, boxes: readonly Rect[]): Detected {
  if (!tracker) return { faces: [], obstacles: [], dropped: { ...NO_DROPS }, known: true, detector: null };
  try {
    const { prepared: p, detector } = detectFaces(tracker, bitmap, width, height, seed, boxes);
    const dbg = debugState();
    if (dbg) dbg.detectCalls++;
    return { faces: p.faces, obstacles: p.obstacles, dropped: p.dropped, known: true, detector };
  } catch (err) {
    reportError('still detect', err);
    return { faces: [], obstacles: [], dropped: { ...NO_DROPS }, known: false, detector: null };
  }
}
