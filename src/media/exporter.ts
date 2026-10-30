// OWNER: media agent. Encoding + saving via the share sheet (RB §1 #10, §4 "Capture and save").
import type { ExportFormat, SaveResult } from '../types';
import { fitLongEdge } from './importer';

export const JPEG_QUALITY = 0.92;
export const THUMB_QUALITY = 0.85;

/** 原始解析度 JPEG quality (C §4.6); 標準 and the camera keep JPEG_QUALITY */
export const FULL_JPEG_QUALITY = 0.95;

const MIME: Record<ExportFormat, 'image/jpeg' | 'image/png'> = { jpeg: 'image/jpeg', png: 'image/png' };
const EXT: Record<ExportFormat, string> = { jpeg: 'jpg', png: 'png' };

/** meiyan-YYYYMMDD-HHMMSS.<ext> in local time (the prefix stays, C §3.8); photos and videos are named alike */
export function stampedName(ext: string, d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  const time = `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `meiyan-${date}-${time}.${ext}`;
}

/** meiyan-YYYYMMDD-HHMMSS.jpg|.png in local time (the prefix stays, C §3.8) */
export function outputFileName(format: ExportFormat, d: Date = new Date()): string {
  return stampedName(EXT[format], d);
}

/** meiyan-YYYYMMDD-HHMMSS.jpg in local time. */
export function jpegFileName(d: Date = new Date()): string {
  return outputFileName('jpeg', d);
}

/** Encode `img` as a JPEG (at `quality`) or a lossless PNG File, EXIF-free, on an opaque surface. */
export async function encodeOutput(img: ImageData, format: ExportFormat, quality: number = JPEG_QUALITY): Promise<File> {
  const type = MIME[format];
  const surface = createSurface(img.width, img.height, { type, alpha: false });
  try {
    surface.ctx.putImageData(img, 0, 0);
    const blob = await surface.toBlob(format === 'jpeg' ? quality : undefined);
    return new File([blob], outputFileName(format), { type, lastModified: Date.now() });
  } finally {
    surface.release();
  }
}

/** JPEG-encode `img` as a File named meiyan-YYYYMMDD-HHMMSS.jpg (EXIF-free). */
export function encodeJpeg(img: ImageData, quality: number = JPEG_QUALITY): Promise<File> {
  return encodeOutput(img, 'jpeg', quality);
}

/** PNG-encode `img` (lossless, opaque) as a File named meiyan-YYYYMMDD-HHMMSS.png (no metadata). */
export function encodePng(img: ImageData): Promise<File> {
  return encodeOutput(img, 'png');
}

/** Encode any drawable to a JPEG Blob, scaled so the long edge ≤ maxLongEdge (thumbnails, history originals). */
export async function toJpegBlob(
  src: ImageData | ImageBitmap | HTMLCanvasElement,
  maxLongEdge: number,
  quality: number = THUMB_QUALITY,
): Promise<Blob> {
  const { width, height } = fitLongEdge(src.width, src.height, maxLongEdge);
  if (!width || !height) throw new Error('toJpegBlob: empty source');
  const surface = createSurface(width, height);
  let temp: ImageBitmap | null = null;
  try {
    const { ctx } = surface;
    if (!isImageData(src)) {
      drawScaled(ctx, src, width, height);
    } else if (width === src.width && height === src.height) {
      ctx.putImageData(src, 0, 0);
    } else {
      // putImageData cannot scale; go through a bitmap so drawImage can resample.
      temp = await createImageBitmap(src);
      drawScaled(ctx, temp, width, height);
    }
    return await surface.toBlob(quality);
  } finally {
    temp?.close();
    surface.release();
  }
}

/** true when the share sheet can take files (call before showing the 儲存 affordance text). */
export function canShareFiles(file: File): boolean {
  if (typeof navigator === 'undefined') return false;
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/**
 * MUST be called synchronously inside the tap handler (5 s transient activation).
 * Uses navigator.share({files}); AbortError → 'cancelled'; unsupported/failed → 'fallback'
 * (caller then shows the long-press <img> overlay).
 */
export function saveFile(file: File): Promise<SaveResult> {
  // Deliberately not async and nothing awaited before share(): it must run inside the gesture.
  if (!canShareFiles(file)) return Promise.resolve('fallback');
  let shared: Promise<void>;
  try {
    // No title/text so iOS offers "Save Image" (RB §4 "Capture and save").
    shared = navigator.share({ files: [file] });
  } catch {
    return Promise.resolve('fallback');
  }
  return shared.then(
    (): SaveResult => 'shared',
    (e: unknown): SaveResult => (errorName(e) === 'AbortError' ? 'cancelled' : 'fallback'),
  );
}

// ── internals ──

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface Surface {
  ctx: Ctx2D;
  /** `quality` is ignored for PNG */
  toBlob(quality?: number): Promise<Blob>;
  release(): void;
}

export interface SurfaceOptions {
  /** default image/jpeg (thumbnails, history originals) */
  type?: 'image/jpeg' | 'image/png';
  /** false: an opaque context (every exported pixel is opaque anyway) */
  alpha?: boolean;
  /** the patch reader reads its pixels back on every tap (skin-cleanup spec §3.4) */
  willReadFrequently?: boolean;
}

/** OffscreenCanvas when it can encode (Safari 16.4+), else a detached <canvas>. */
export function createSurface(width: number, height: number, opts: SurfaceOptions = {}): Surface {
  const type = opts.type ?? 'image/jpeg';
  // annotated: an inferred `{ alpha: boolean } | undefined` sends <canvas>.getContext to its RenderingContext overload
  const settings: CanvasRenderingContext2DSettings = {};
  if (opts.alpha === false) settings.alpha = false;
  if (opts.willReadFrequently) settings.willReadFrequently = true;
  const ctxOpts: CanvasRenderingContext2DSettings | undefined = Object.keys(settings).length ? settings : undefined;
  const enc = (quality?: number): ImageEncodeOptions => (quality === undefined ? { type } : { type, quality });
  if (typeof OffscreenCanvas !== 'undefined' && typeof OffscreenCanvas.prototype.convertToBlob === 'function') {
    const oc = new OffscreenCanvas(width, height);
    const ctx = oc.getContext('2d', ctxOpts);
    if (ctx) {
      return {
        ctx,
        toBlob: (quality) => oc.convertToBlob(enc(quality)),
        release: () => {
          oc.width = oc.height = 0;
        },
      };
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', ctxOpts);
  if (!ctx) throw new Error('exporter: 2D canvas unavailable');
  return {
    ctx,
    toBlob: (quality) =>
      new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(`exporter: ${type} encode failed`))), type, quality),
      ),
    // iOS caps total canvas memory and frees backing stores only on GC; release eagerly.
    release: () => {
      canvas.width = canvas.height = 0;
    },
  };
}

function drawScaled(ctx: Ctx2D, src: CanvasImageSource, width: number, height: number): void {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, width, height);
}

function isImageData(x: unknown): x is ImageData {
  return typeof ImageData !== 'undefined' && x instanceof ImageData;
}

function errorName(e: unknown): string {
  return typeof e === 'object' && e !== null && 'name' in e ? String(e.name) : '';
}
