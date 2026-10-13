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

export const browserRunnerDeps: RunnerDeps = {
  // the import's own decoder: EXIF orientation, probeSize, the <img> fallback (importer.ts:4-13)
  decode: (blob, edge) => importPhoto(blob, edge),
  crop: (full, r) => createImageBitmap(full, r.x, r.y, r.w, r.h),
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
    readonly kind: 'aspect' | 'size' | 'knob',
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
}

const abortError = () => new DOMException('export cancelled', 'AbortError');

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
