// OWNER: app-glue agent. Editor session for one still image: detect once, render on demand (rAF-coalesced).
import { adapt } from '../tracking/adapter111';
import type { BeautyParams, Engine, Face, RenderInput, Tracker } from '../types';
import { debugState, reportError } from './debug';

export interface StillSession {
  readonly width: number;
  readonly height: number;
  readonly face: Face | null;
  /**
   * false when the detector threw, so `face: null` is not a real "no face" (the tracker rebuilds its graph
   * on the next call). A null from a tracker that is recovering cannot be told apart here: callers combine
   * this with the tracker health (svc.tracker).
   */
  readonly faceKnown: boolean;
  /** schedule a render with these params (coalesced to one per animation frame) */
  render(params: BeautyParams): void;
  /** show the original while held */
  setCompare(on: boolean): void;
  /**
   * Resolves once what an export of `params` needs is resident (the filter LUT may still be downloading:
   * no SW, Lockdown Mode, slow network). Never rejects: a LUT that fails to load is skipped by the preview
   * too, so the export then matches it without the filter.
   */
  prepareExport(params: BeautyParams): Promise<void>;
  /**
   * true when an export of `params` would match the preview right now: the static textures and the filter
   * LUT have settled (loaded or failed) on the current context. false → prepareExport first.
   */
  exportReady(params: BeautyParams): boolean;
  /** full-resolution export, never mirrored (synchronous; call prepareExport first so it matches the preview) */
  exportImageData(params: BeautyParams): ImageData;
  /**
   * The screen is closing but an export is still pending: stop drawing to the shared display canvas (another
   * screen owns it now). prepareExport / exportImageData keep working until dispose.
   */
  stopDisplay(): void;
  dispose(): void;
}

export interface StillSessionOptions {
  /** close `bitmap` on dispose (default true). false lets the caller rebind the same photo to a new engine. */
  ownsBitmap?: boolean;
  /**
   * The face already detected on this same bitmap (e.g. by the session this one replaces after an engine
   * swap): used as is, without detecting again. undefined → detect.
   */
  face?: Face | null;
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
  const detected = opts.face !== undefined ? { face: opts.face, known: true } : detectOnce(tracker, bitmap, width, height);
  const face = detected.face;
  // window.__meiyan.face describes whatever is on screen: the photo now (the live loop is stopped)
  const dbg = debugState();
  if (dbg) dbg.face = face !== null;
  const faceWeight = face ? 1 : 0;
  const requestedFilters = new Set<string>();
  /** filters whose load settled (loaded or failed) on the current context, and whether `ready` has */
  const settledFilters = new Set<string>();
  let staticsSettled = false;
  /** bumped on every restore: loads started against the old context no longer count as settled */
  let gen = 0;
  let displayOff = false;

  let params: BeautyParams | null = null;
  let compare = false;
  let raf = 0;
  let disposed = false;

  const input = (p: BeautyParams): RenderInput => ({ source: bitmap, width, height, face, faceWeight, params: p });

  function schedule(): void {
    if (disposed || displayOff || raf || !params) return;
    raf = requestAnimationFrame(flush);
  }

  function flush(): void {
    raf = 0;
    if (disposed || displayOff || !params) return;
    // context lost: keep the pending render and retry next frame (the engine rebuilds itself on restore)
    if (engine.lost) {
      schedule();
      return;
    }
    try {
      // the engine is shared with the live loop, whose front-camera preview is mirrored
      engine.setOptions({ mirror: false });
      if (compare) engine.renderOriginal({ source: bitmap, width, height }, { still: true });
      else engine.render(input(params), { still: true });
    } catch (err) {
      reportError('still render', err);
    }
  }

  function ensureFilter(id: string): void {
    if (id === 'none' || requestedFilters.has(id)) return;
    requestedFilters.add(id);
    const g = gen;
    const settled = () => {
      if (g === gen) settledFilters.add(id);
    };
    // the first render may have gone out before the LUT was uploaded → draw again once it is
    engine.loadFilter(id).then(
      () => {
        settled();
        schedule();
      },
      (err: unknown) => {
        settled();
        reportError(`filter ${id}`, err);
      },
    );
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
  // else asks for a frame: redraw now, re-request the filter (dropped with the old context) and redraw
  // again once the static textures are back. The engine's own listener was added first, so it has
  // already rebuilt by the time this runs.
  const onRestored = () => {
    if (disposed) return;
    gen++;
    requestedFilters.clear();
    settledFilters.clear();
    staticsSettled = false;
    if (params) ensureFilter(params.filterId);
    trackStatics();
    schedule();
  };
  engine.canvas.addEventListener('webglcontextrestored', onRestored);

  function prepare(p: BeautyParams, retries: number): Promise<void> {
    if (disposed) return Promise.resolve();
    // static textures (skin LUTs, makeup) too: after a context restore they reload asynchronously
    const ready = engine.ready;
    const g = gen;
    const statics = ready.catch(() => undefined);
    let load: Promise<void>;
    if (p.filterId === 'none') load = Promise.resolve();
    else {
      try {
        load = engine.loadFilter(p.filterId);
      } catch (err) {
        load = Promise.reject(err);
      }
    }
    return Promise.all([statics, load.catch(() => undefined)]).then(() => {
      // still lost (or closed): exportImageData throws and the callers handle that
      if (disposed || engine.lost) return;
      // lost and restored meanwhile: the loads above settled against the dead context without leaving
      // their textures behind, so wait for the reloaded ones (new `ready`, a fresh filter load)
      if (engine.ready !== ready || g !== gen) {
        if (retries > 0) return prepare(p, retries - 1);
        return;
      }
      staticsSettled = true;
      if (p.filterId !== 'none') settledFilters.add(p.filterId);
    });
  }

  return {
    width,
    height,
    face,
    faceKnown: detected.known,
    render(p) {
      if (disposed) return;
      params = p;
      ensureFilter(p.filterId);
      schedule();
    },
    setCompare(on) {
      if (compare === on) return;
      compare = on;
      schedule();
    },
    prepareExport(p) {
      return prepare(p, PREPARE_RETRIES);
    },
    exportReady(p) {
      if (disposed || engine.lost || !staticsSettled) return false;
      return p.filterId === 'none' || settledFilters.has(p.filterId);
    },
    exportImageData(p) {
      if (disposed) throw new Error('StillSession: disposed');
      ensureFilter(p.filterId);
      const img = engine.renderToImageData(input(p), { mirror: false });
      // the display keeps showing the last params; redraw in case the offscreen render disturbed it
      schedule();
      return img;
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
      if (!ownsBitmap) return;
      try {
        bitmap.close();
      } catch {
        // already closed / detached: nothing to free
      }
    },
  };
}

function detectOnce(
  tracker: Tracker | null,
  bitmap: ImageBitmap,
  width: number,
  height: number,
): { face: Face | null; known: boolean } {
  if (!tracker) return { face: null, known: true };
  try {
    const lm = tracker.detectImage(bitmap);
    return { face: lm ? adapt(lm, width, height) : null, known: true };
  } catch (err) {
    reportError('still detect', err);
    return { face: null, known: false };
  }
}
