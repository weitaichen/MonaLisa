// OWNER: app-glue agent. Editor session for one still image: detect once, render on demand (rAF-coalesced).
import { adapt } from '../tracking/adapter111';
import type { BeautyParams, Engine, Face, RenderInput, Tracker } from '../types';
import { debugState, reportError } from './debug';

export interface StillSession {
  readonly width: number;
  readonly height: number;
  readonly face: Face | null;
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
  /** full-resolution export, never mirrored (synchronous; call prepareExport first so it matches the preview) */
  exportImageData(params: BeautyParams): ImageData;
  dispose(): void;
}

export interface StillSessionOptions {
  /** close `bitmap` on dispose (default true). false lets the caller rebind the same photo to a new engine. */
  ownsBitmap?: boolean;
}

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
  const face = detectOnce(tracker, bitmap, width, height);
  // window.__meiyan.face describes whatever is on screen: the photo now (the live loop is stopped)
  const dbg = debugState();
  if (dbg) dbg.face = face !== null;
  const faceWeight = face ? 1 : 0;
  const requestedFilters = new Set<string>();

  let params: BeautyParams | null = null;
  let compare = false;
  let raf = 0;
  let disposed = false;

  const input = (p: BeautyParams): RenderInput => ({ source: bitmap, width, height, face, faceWeight, params: p });

  function schedule(): void {
    if (disposed || raf || !params) return;
    raf = requestAnimationFrame(flush);
  }

  function flush(): void {
    raf = 0;
    if (disposed || !params) return;
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
    // the first render may have gone out before the LUT was uploaded → draw again once it is
    engine.loadFilter(id).then(schedule, (err: unknown) => reportError(`filter ${id}`, err));
  }

  // static textures (skin LUTs, makeup) may still be uploading when the first render goes out
  engine.ready.then(schedule, (err: unknown) => reportError('engine ready', err));

  // After a restore the drawing buffer is blank and every texture reloads asynchronously, but nothing
  // else asks for a frame: redraw now, re-request the filter (dropped with the old context) and redraw
  // again once the static textures are back. The engine's own listener was added first, so it has
  // already rebuilt by the time this runs.
  const onRestored = () => {
    if (disposed) return;
    requestedFilters.clear();
    if (params) ensureFilter(params.filterId);
    engine.ready.then(schedule, (err: unknown) => reportError('engine ready', err));
    schedule();
  };
  engine.canvas.addEventListener('webglcontextrestored', onRestored);

  return {
    width,
    height,
    face,
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
      if (disposed) return Promise.resolve();
      // static textures (skin LUTs, makeup) too: after a context restore they reload asynchronously
      const statics = engine.ready.catch(() => undefined);
      if (p.filterId === 'none') return statics;
      let load: Promise<void>;
      try {
        load = engine.loadFilter(p.filterId);
      } catch (err) {
        load = Promise.reject(err);
      }
      return Promise.all([statics, load.catch(() => undefined)]).then(() => undefined);
    },
    exportImageData(p) {
      if (disposed) throw new Error('StillSession: disposed');
      ensureFilter(p.filterId);
      const img = engine.renderToImageData(input(p), { mirror: false });
      // the display keeps showing the last params; redraw in case the offscreen render disturbed it
      schedule();
      return img;
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

function detectOnce(tracker: Tracker | null, bitmap: ImageBitmap, width: number, height: number): Face | null {
  if (!tracker) return null;
  try {
    const lm = tracker.detectImage(bitmap);
    return lm ? adapt(lm, width, height) : null;
  } catch (err) {
    reportError('still detect', err);
    return null;
  }
}
