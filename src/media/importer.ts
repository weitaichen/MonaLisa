// OWNER: media agent. File → orientation-corrected, downscaled ImageBitmap (RB §4 "Photo import").

/** Decode `file` (JPEG/PNG/HEIC) honouring EXIF orientation, downscaled so the long edge ≤ maxLongEdge. */
export async function importPhoto(file: Blob, maxLongEdge: number): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== 'function') throw new Error('importPhoto: createImageBitmap unsupported');
  try {
    return await importViaBitmap(file, maxLongEdge);
  } catch (e) {
    // e.g. a decoder that createImageBitmap(Blob) lacks but <img> has (HEIC on some WebKit builds).
    console.warn('[importer] createImageBitmap path failed, falling back to <img>', e);
    return importViaImageElement(file, maxLongEdge);
  }
}

/** Pure helper: target size for a w×h image so the long edge ≤ maxLongEdge (never upscales). */
export function fitLongEdge(w: number, h: number, maxLongEdge: number): { width: number; height: number } {
  if (!(w > 0 && h > 0)) return { width: 0, height: 0 };
  const s = Math.min(1, maxLongEdge / Math.max(w, h));
  if (!(s > 0)) return { width: 1, height: 1 };
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

/**
 * Oriented size from the encoded header only. A detached <img> parses metadata on load and decodes pixels only
 * when painted or decode()d, so never call decode() here. naturalWidth/Height honour EXIF orientation (WebKit
 * naturalDimensions(FromImage); Chromium verified), the same axes as createImageBitmap 'from-image'.
 */
export function probeSize(file: Blob): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('importPhoto: could not read image header'));
    img.src = url;
  }).finally(() => {
    img.onload = img.onerror = null;
    img.removeAttribute('src');
    URL.revokeObjectURL(url);
  });
}

/**
 * Primary path. The oriented size comes from the header (`probe`), so there is exactly one createImageBitmap
 * decode, resized whenever the image does not fit. A full-size probe bitmap would itself be the memory peak
 * (a 24 MP photo is ~96 MB as RGBA, 48 MP ~195 MB; RB §1 #6 records kills at ~100 MB on an SE 3).
 * Note: WebKit's createImageBitmap(Blob) still decodes the full frame once internally (no subsampling for
 * ImageBitmap), so this halves the peak rather than removing it.
 */
export async function importViaBitmap(
  file: Blob,
  maxLongEdge: number,
  probe: (file: Blob) => Promise<{ width: number; height: number }> = probeSize,
): Promise<ImageBitmap> {
  let pw: number;
  let ph: number;
  try {
    ({ width: pw, height: ph } = await probe(file));
    if (!(pw > 0 && ph > 0)) throw new Error('importPhoto: header reported no size');
  } catch {
    // A format only createImageBitmap reads: fall back to a full decode for the size (the old behaviour).
    const full = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const fit = fitLongEdge(full.width, full.height, maxLongEdge);
    if (fit.width === full.width && fit.height === full.height) return full;
    pw = full.width;
    ph = full.height;
    full.close();
  }
  const target = fitLongEdge(pw, ph, maxLongEdge);
  if (!target.width || !target.height) throw new Error('importPhoto: image has no size');
  if (target.width === pw && target.height === ph) return createImageBitmap(file, { imageOrientation: 'from-image' });

  let bmp = await decodeResized(file, target.width, target.height);
  if (bmp.width === target.height && bmp.height === target.width && target.width !== target.height) {
    // The browser applied resize* in pre-rotation axes, then rotated: the result is squashed. Ask again in
    // those axes so the rotated output comes out at the target size undistorted.
    bmp.close();
    bmp = await decodeResized(file, target.height, target.width);
  }
  if (bmp.width === target.width && bmp.height === target.height) return bmp;
  // resize* ignored (older engines ignore unknown dictionary members): scale the full decode on a canvas.
  if (bmp.width === pw && bmp.height === ph) return scaleBitmap(bmp, target.width, target.height);
  bmp.close();
  throw new Error(`importPhoto: unexpected decode size ${bmp.width}×${bmp.height}, wanted ${target.width}×${target.height}`);
}

function decodeResized(file: Blob, w: number, h: number): Promise<ImageBitmap> {
  return createImageBitmap(file, {
    imageOrientation: 'from-image',
    resizeWidth: w,
    resizeHeight: h,
    resizeQuality: 'high',
  });
}

/** Fallback path: <img> decode (applies EXIF orientation by default) + canvas downscale. */
export async function importViaImageElement(file: Blob, maxLongEdge: number): Promise<ImageBitmap> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const { width, height } = fitLongEdge(img.naturalWidth, img.naturalHeight, maxLongEdge);
    if (!width || !height) throw new Error('importPhoto: image has no size');
    return await drawToBitmap(img, width, height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function scaleBitmap(src: ImageBitmap, w: number, h: number): Promise<ImageBitmap> {
  try {
    return await drawToBitmap(src, w, h);
  } finally {
    src.close();
  }
}

async function drawToBitmap(src: CanvasImageSource, w: number, h: number): Promise<ImageBitmap> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('importPhoto: 2D canvas unavailable');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    return await createImageBitmap(canvas);
  } finally {
    // iOS keeps canvas backing stores until GC and caps total canvas memory; release eagerly.
    canvas.width = canvas.height = 0;
  }
}
