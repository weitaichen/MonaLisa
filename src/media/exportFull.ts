// Tiled full-resolution export (step-3 spec §4.4 runner): decode the source at the plan's size, render each tile through
// the engine into one output canvas, free the GL and the decode, then encode. Every big resource is registered on the
// abort signal, so 取消, ✕ or the app going to the background frees it synchronously inside abort(). The crash breadcrumb
// brackets the run: only a kill while visible leaves it (S §3.7).
import { FULL_EXPORT_MAX_EDGE } from '../config/limits';
import { IDENTITY_GEOMETRY, snapCrop } from '../geometry/view';
import { clearExportGuard, writeExportGuard, type ExportDebugKnob, type ExportGuard } from '../store/settings';
import type { PxRect, RenderInput, Size } from '../types';
import type { ExportPlan } from './exportPlan';
import { createSurface, outputFileName } from './exporter';
import { importPhoto } from './importer';

export type TileInputBase = Omit<RenderInput, 'source' | 'width' | 'height' | 'sourceWindow' | 'output'>;

export interface TileRenderer {
  renderTile(input: RenderInput, read: PxRect): ImageData;
  releaseBuffers(): void;
}

export interface OutputCanvas {
  put(img: ImageData, x: number, y: number): void;
  /** quality: JPEG only */
  encode(quality?: number): Promise<Blob>;
  /** canvas to 0 × 0 */
  release(): void;
}

export interface RunnerDeps {
  decode(blob: Blob, maxLongEdge: number): Promise<ImageBitmap>;
  crop(full: ImageBitmap, r: PxRect): Promise<ImageBitmap>;
  createCanvas(width: number, height: number, type: 'image/jpeg' | 'image/png'): OutputCanvas;
  nextFrame(): Promise<void>;
  sleep(ms: number): Promise<void>;
  writeGuard(g: ExportGuard): void;
  clearGuard(): void;
}

/**
 * One source window as its own bitmap, copied 1:1 through a 2D canvas. Not createImageBitmap(full, x, y, w, h): Chromium
 * crops a bitmap decoded with imageOrientation 'from-image' in the file's stored orientation, so an EXIF-orientation-6
 * photo exported tiles of the wrong, sideways region; drawImage honours the orientation the decode applied.
 */
async function cropWindow(full: ImageBitmap, r: PxRect): Promise<ImageBitmap> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const oc = new OffscreenCanvas(r.w, r.h);
    const ctx = oc.getContext('2d');
    if (ctx) {
      ctx.drawImage(full, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      const bmp = oc.transferToImageBitmap();
      // iOS frees canvas backing stores only on GC: release eagerly
      oc.width = oc.height = 0;
      return bmp;
    }
  }
  const c = document.createElement('canvas');
  c.width = r.w;
  c.height = r.h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('exportFull: 2D canvas unavailable');
  ctx.drawImage(full, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  try {
    return await createImageBitmap(c);
  } finally {
    c.width = c.height = 0;
  }
}

export const browserRunnerDeps: RunnerDeps = {
  // the import's own decoder: EXIF orientation, probeSize, the <img> fallback (importer.ts:4-13)
  decode: (blob, edge) => importPhoto(blob, edge),
  crop: cropWindow,
  createCanvas: (w, h, type) => {
    const s = createSurface(w, h, { type, alpha: false });
    return { put: (img, x, y) => s.ctx.putImageData(img, x, y), encode: (q) => s.toBlob(q), release: () => s.release() };
  },
  nextFrame: () => new Promise<void>((r) => requestAnimationFrame(() => r())),
  sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
  writeGuard: writeExportGuard,
  clearGuard: clearExportGuard,
};

export class ExportError extends Error {
  constructor(
    readonly kind: 'aspect' | 'size' | 'knob' | 'draw',
    message: string,
  ) {
    super(message);
    this.name = 'ExportError';
  }
}

export interface RunOptions {
  signal: AbortSignal;
  onProgress?(fraction: number): void;
  /** the working bitmap's size: the decode must have its aspect within 1 % */
  working: Size;
  knob?: ExportDebugKnob;
  /**
   * What a tile draws with besides `input` (the static textures, each 濾鏡 / 質感 LUT's state), or null while some of it
   * is not resident. Read right before every tile: null, or an entry that differs (Object.is) from the first tile's,
   * fails the export with ExportError('draw') and the caller falls back, so one file never mixes tiles drawn with and
   * without a LUT.
   */
  drawState?(): readonly unknown[] | null;
}

const abortError = () => new DOMException('export cancelled', 'AbortError');

/** `p`, or an AbortError as soon as `signal` aborts: 取消, ✕ and the background abort do not wait for a LUT download */
export function abortable<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    p.catch(() => undefined);
    return Promise.reject(abortError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

const sameState = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

export async function runTiledExport(
  renderer: TileRenderer,
  sourceBlob: Blob,
  plan: ExportPlan,
  input: TileInputBase,
  opts: RunOptions,
  deps: RunnerDeps = browserRunnerDeps,
): Promise<File> {
  const decode = plan.decode;
  if (plan.mode !== 'tiled' || !decode) throw new Error('runTiledExport: not a tiled plan');
  const { signal } = opts;
  const knob = opts.knob ?? {};
  if (signal.aborted) throw abortError();
  const type = plan.format === 'png' ? 'image/png' : 'image/jpeg';
  let full: ImageBitmap | null = null;
  let canvas: OutputCanvas | null = null;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      full?.close();
    } catch {
      // already closed
    }
    full = null;
    canvas?.release();
    canvas = null;
    try {
      renderer.releaseBuffers();
    } catch {
      // a lost context has nothing to release
    }
    deps.clearGuard();
  };
  signal.addEventListener('abort', release, { once: true });
  const check = () => {
    if (signal.aborted) throw abortError();
  };
  deps.writeGuard({ at: Date.now(), w: plan.width, h: plan.height, format: plan.format });
  try {
    const bmp = await deps.decode(sourceBlob, FULL_EXPORT_MAX_EDGE);
    if (signal.aborted) {
      bmp.close();
      throw abortError();
    }
    full = bmp;
    if (knob.failAt === 'decode') throw new ExportError('knob', 'injected decode failure');
    if (Math.abs(bmp.width / bmp.height / (opts.working.width / opts.working.height) - 1) > 0.01) {
      throw new ExportError('aspect', `decoded ${bmp.width}×${bmp.height}, working ${opts.working.width}×${opts.working.height}`);
    }
    if (bmp.width !== decode.width || bmp.height !== decode.height) {
      throw new ExportError('size', `decoded ${bmp.width}×${bmp.height}, planned ${decode.width}×${decode.height}`);
    }
    if (knob.slowMs) {
      await deps.sleep(knob.slowMs);
      check();
    }
    canvas = deps.createCanvas(plan.width, plan.height, type);
    const geometry = snapCrop(input.geometry ?? IDENTITY_GEOMETRY, decode);
    /** the first tile's drawState: every later tile must draw with the same */
    let drawn: readonly unknown[] | null = null;
    for (let i = 0; i < plan.tiles.length; i++) {
      check();
      if (knob.failAt === 'tile') throw new ExportError('knob', 'injected tile failure');
      const t = plan.tiles[i];
      const tileBmp = await deps.crop(bmp, t.win);
      if (signal.aborted) {
        tileBmp.close();
        throw abortError();
      }
      let img: ImageData;
      try {
        // (here, not before the crop: renderTile is synchronous, so this is exactly what the tile draws with)
        if (opts.drawState) {
          const now = opts.drawState();
          if (!now) throw new ExportError('draw', `tile ${i}: a LUT it draws with is not resident`);
          if (!drawn) drawn = now;
          else if (!sameState(drawn, now)) throw new ExportError('draw', `tile ${i}: what the tiles draw with changed mid-export`);
        }
        img = renderer.renderTile(
          {
            ...input,
            geometry,
            source: tileBmp,
            width: t.win.w,
            height: t.win.h,
            sourceWindow: { x: t.win.x / decode.width, y: t.win.y / decode.height, w: t.win.w / decode.width, h: t.win.h / decode.height },
            output: {
              tile: { x: t.buf.x / plan.width, y: t.buf.y / plan.height, w: t.buf.w / plan.width, h: t.buf.h / plan.height },
              pixelSize: { width: t.buf.w, height: t.buf.h },
              fullShortEdge: plan.fullShortEdge,
            },
          },
          { x: t.out.x - t.buf.x, y: t.out.y - t.buf.y, w: t.out.w, h: t.out.h },
        );
      } finally {
        tileBmp.close();
      }
      canvas.put(img, t.out.x, t.out.y);
      opts.onProgress?.((i + 1) / plan.tiles.length);
      await deps.nextFrame();
    }
    check();
    // only the canvas and the encoder's copy stay alive while encoding (S §4.4 step 6)
    bmp.close();
    full = null;
    renderer.releaseBuffers();
    if (knob.failAt === 'encode') throw new ExportError('knob', 'injected encode failure');
    const blob = await canvas.encode(plan.format === 'jpeg' ? plan.quality : undefined);
    check();
    canvas.release();
    canvas = null;
    deps.clearGuard();
    return new File([blob], outputFileName(plan.format), { type, lastModified: Date.now() });
  } catch (e) {
    // a caught failure is no crash: memory and breadcrumb go now
    release();
    throw signal.aborted ? abortError() : e;
  } finally {
    signal.removeEventListener('abort', release);
  }
}
