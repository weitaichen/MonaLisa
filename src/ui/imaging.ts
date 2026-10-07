// Pixel helpers for capture: the viewfinder crops the canvas with object-fit: cover, so the saved
// image is centre-cropped to the same ratio here (on the ImageData, before encoding).

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
