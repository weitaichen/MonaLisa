// Pixel helpers for capture: the viewfinder crops the canvas with object-fit: cover, so the saved
// image is centre-cropped to the same ratio here (on the ImageData, before encoding).
import { mirrorSides } from '../edit/sides';
import type { FaceSeed, PersonParams, Rect as UvRect } from '../types';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Largest centred rect of aspect `ratio` (= width / height) inside w×h, in whole pixels. */
export function centerCropRect(w: number, h: number, ratio: number): Rect {
  if (!(w > 0 && h > 0 && ratio > 0)) return { x: 0, y: 0, width: Math.max(0, w | 0), height: Math.max(0, h | 0) };
  let cw = w;
  let ch = Math.round(w / ratio);
  if (ch > h) {
    ch = h;
    cw = Math.round(h * ratio);
  }
  cw = Math.min(w, Math.max(1, cw));
  ch = Math.min(h, Math.max(1, ch));
  return { x: Math.floor((w - cw) / 2), y: Math.floor((h - ch) / 2), width: cw, height: ch };
}

/** centerCropRect as normalized source UV (the camera's picture frame, step-2 spec §4.5); the whole frame when empty. */
export function normalizedCropRect(w: number, h: number, ratio: number): UvRect {
  if (!(w > 0 && h > 0)) return { x: 0, y: 0, w: 1, h: 1 };
  const r = centerCropRect(w, h, ratio);
  return { x: r.x / w, y: r.y / h, w: r.width / w, h: r.height / h };
}

/** Copy `rect` out of `src` (rows are top-first, as returned by the engine). */
export function cropPixels(
  src: Uint8ClampedArray,
  srcWidth: number,
  rect: Rect,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(rect.width * rect.height * 4);
  const rowBytes = rect.width * 4;
  for (let row = 0; row < rect.height; row++) {
    const from = ((rect.y + row) * srcWidth + rect.x) * 4;
    out.set(src.subarray(from, from + rowBytes), row * rowBytes);
  }
  return out;
}

export function cropImageData(img: ImageData, ratio: number): ImageData {
  const rect = centerCropRect(img.width, img.height, ratio);
  if (rect.width === img.width && rect.height === img.height) return img;
  return new ImageData(cropPixels(img.data, img.width, rect), rect.width, rect.height);
}

/**
 * The unprocessed current video frame with the same crop and mirroring as the capture,
 * used when the user opens a fresh shot in the editor.
 */
export async function grabOriginalFrame(video: HTMLVideoElement, ratio: number, mirror: boolean): Promise<ImageBitmap> {
  const rect = centerCropRect(video.videoWidth, video.videoHeight, ratio);
  const canvas = document.createElement('canvas');
  canvas.width = rect.width;
  canvas.height = rect.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  if (mirror) {
    ctx.translate(rect.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  const bmp = await createImageBitmap(canvas);
  canvas.width = canvas.height = 0; // release backing store promptly (iOS memory)
  return bmp;
}

/**
 * The camera's seed in the saved photo (S §3.4 C2): video UV → the centre crop, then mirrored when the shot is saved
 * mirrored. Not clamped: a seed outside the crop must not match an edge face.
 */
export function shotSeed(seed: { x: number; y: number } | 'all' | null, vw: number, vh: number, ratio: number, mirrored: boolean): FaceSeed {
  if (seed === null || seed === 'all') return seed;
  const r = centerCropRect(vw, vh, ratio);
  const x = (seed.x * vw - r.x) / r.width;
  const y = (seed.y * vh - r.y) / r.height;
  return { x: mirrored ? 1 - x : x, y };
}

/**
 * A camera person's box in the saved photo (camera per-person spec §5.3): video UV → shotSeed's centre crop, then
 * mirrored (x' = 1 − x' − w') when the shot is saved mirrored. Not clamped: a box cut by the crop keeps its true extent.
 */
export function shotBox(box: UvRect, vw: number, vh: number, ratio: number, mirrored: boolean): UvRect {
  const r = centerCropRect(vw, vh, ratio);
  const x = (box.x * vw - r.x) / r.width;
  const y = (box.y * vh - r.y) / r.height;
  const w = (box.w * vw) / r.width;
  const h = (box.h * vh) / r.height;
  return { x: mirrored ? 1 - x - w : x, y, w, h };
}

/**
 * The capture's edited persons (LiveLoop.capture().persons) as the hand-over gives them to 編輯 (§3.8, §5.3): each box
 * in the saved photo (shotBox), 左右分開 swapped when saved mirrored (mirrorSides, so the same cheek stays adjusted), and
 * only the persons whose box centre lies in the picture: one outside it is not in the photo, so it is not handed over
 * (never counted as a face the editor missed, Review Focus #5).
 */
export function shotPersons(
  persons: readonly { rawBox: UvRect; params: PersonParams }[],
  vw: number,
  vh: number,
  ratio: number,
  mirrored: boolean,
): { box: UvRect; params: PersonParams }[] {
  const out: { box: UvRect; params: PersonParams }[] = [];
  for (const p of persons) {
    const box = shotBox(p.rawBox, vw, vh, ratio, mirrored);
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    if (!(cx >= 0 && cx <= 1 && cy >= 0 && cy <= 1)) continue;
    out.push({ box, params: mirrored ? mirrorSides(p.params) : p.params });
  }
  return out;
}
