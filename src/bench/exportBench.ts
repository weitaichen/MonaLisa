// Phase 0 export rows (step-3 spec §6.4) on synthetic frames, so no photo is needed: decode of 12 / 24 / 48 MP JPEGs to
// a 4096 long edge, a tiled render of 4096 × 3072 (6 faces, body field, θ = 12°) at TILE 512 / 1024 / 2048 with the
// putImageData into the output canvas, JPEG q 0.95 and PNG encode through the export's own opaque surface, a canvas-area
// probe, and P2's cost with geometry at 2048. The frames carry seeded noise, so file sizes and codec times are a photo's.
// A picked photo adds its own decode and encode rows. The share-activation row is manual on the device.
import { defaultPhoto, naturalPerson } from '../edit/state';
import { FACE_TEMPLATE } from '../engine/passes/faceMesh';
import { IDENTITY_GEOMETRY, setStraighten, snapCrop, viewSize } from '../geometry/view';
import { browserRunnerDeps, type TileInputBase } from '../media/exportFull';
import { faceBoundsFor, planTiles, type TileGrid } from '../media/exportPlan';
import { createSurface, FULL_JPEG_QUALITY } from '../media/exporter';
import { importPhotoInfo } from '../media/importer';
import type { BodyField, Engine, Face, RenderFace, RenderInput } from '../types';
import { type ExportBenchRow, median } from './report';

const now = () => performance.now();

/** six template faces in a 3 × 2 grid with 大眼 and 瘦臉 on (the face warps' window growth and the N-face pass) */
export function gridFaces(): RenderFace[] {
  const ext = [0.5, 0.2, 0.5, 0.26, 0.5, 0.33, 0.5, 0.4, 0.5, 0.71, 0.5, 0.68, 0.3, 0.45, 0.7, 0.45];
  const base = naturalPerson();
  const person = { ...base, values: { ...base.values, 'shape.eyeEnlarge': 0.6, 'shape.faceSlim': 0.6 } };
  const out: RenderFace[] = [];
  for (let k = 0; k < 6; k++) {
    const ox = 0.02 + (k % 3) * 0.33;
    const oy = 0.04 + Math.floor(k / 3) * 0.48;
    const at = (a: ArrayLike<number>) => Float32Array.from(a, (v, i) => (i % 2 === 0 ? ox + v * 0.3 : oy + v * 0.45));
    const pts111 = at(FACE_TEMPLATE);
    // the contour points stand in for the oval: enough for the bench's mask and box work
    const face: Face = { pts111, ext: at(ext), oval: pts111.slice(0, 72), yaw: 0 };
    out.push({ face, weight: 1, person, protect: null });
  }
  return out;
}

/** rows of one noise strip: a whole strip (≥ 64 rows of ≥ 2048 px) is far past deflate's 32 KB window, so PNG gains nothing from the repeat */
export const NOISE_ROWS = 64;
/** ± per channel around 128 under 'overlay': at 4096 × 3072 the export's JPEG q 0.95 is about 4 MB and its PNG about 25 MB on desktop Chromium, S §4.5's 12 MP estimates (4–7 MB, 15–25 MB) */
export const NOISE_AMP = 16;

/**
 * `width` × `rows` RGBA of seeded uniform noise in 128 ± `amp` per channel, alpha 255 (a 32-bit LCG's top byte). A
 * camera photo's sensor noise and texture stand-in: without it the gradient-and-rectangles frame's 4096 × 3072 decode
 * encodes to 0.2 MB of JPEG (3× faster) and 0.7 MB of PNG (15× faster) on desktop Chromium.
 */
export function noiseStrip(width: number, rows: number, seed = 0x9e3779b9, amp = NOISE_AMP): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(width * rows * 4);
  const span = 2 * amp + 1;
  let x = seed >>> 0;
  for (let i = 0; i < out.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      out[i + k] = 128 - amp + (((x >>> 24) * span) >>> 8);
    }
    out[i + 3] = 255;
  }
  return out;
}

/** a JPEG (q 0.92) with a camera photo's entropy: a gradient, 400 flat patches, then the noise strip overlaid every NOISE_ROWS rows */
export async function synthJpeg(w: number, h: number): Promise<Blob> {
  const c = new OffscreenCanvas(w, h);
  // full width, so no row of the frame repeats within deflate's window (a narrow tile would let a PNG of it cheat)
  const strip = new OffscreenCanvas(w, NOISE_ROWS);
  try {
    const ctx = c.getContext('2d');
    const sctx = strip.getContext('2d');
    if (!ctx || !sctx) throw new Error(`no 2D context at ${w}×${h}`);
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#d8b49a');
    g.addColorStop(1, '#4a6680');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `hsl(${(i * 37) % 360} 40% 50%)`;
      ctx.fillRect(((i * 97) % 100) * (w / 100), ((i * 53) % 100) * (h / 100), w / 40, h / 40);
    }
    // no full-frame getImageData (a 48 MP one is 190 MB): one W × 64 ImageData, drawn down the frame
    sctx.putImageData(new ImageData(noiseStrip(w, NOISE_ROWS), w, NOISE_ROWS), 0, 0);
    ctx.globalCompositeOperation = 'overlay';
    for (let y = 0; y < h; y += NOISE_ROWS) ctx.drawImage(strip, 0, y);
    ctx.globalCompositeOperation = 'source-over';
    return await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  } finally {
    // iOS frees canvas backing stores only on GC: release eagerly
    c.width = c.height = 0;
    strip.width = strip.height = 0;
  }
}

const mb = (bytes: number) => (bytes / 1048576).toFixed(1);

/**
 * Row 3 through the export's own encoder: exportFull's output canvas is an opaque createSurface of the output type
 * (browserRunnerDeps.createCanvas), so the PNG is encoded the way the export encodes it. Only toBlob is timed.
 */
export async function timeEncode(src: ImageBitmap, type: 'image/jpeg' | 'image/png'): Promise<{ ms: number; bytes: number }> {
  const s = createSurface(src.width, src.height, { type, alpha: false });
  try {
    s.ctx.drawImage(src, 0, 0);
    const t = now();
    const b = await s.toBlob(type === 'image/jpeg' ? FULL_JPEG_QUALITY : undefined);
    return { ms: now() - t, bytes: b.size };
  } finally {
    s.release();
  }
}

const ENCODE_TYPES = ['image/jpeg', 'image/png'] as const;

function synthField(): BodyField {
  const w = 32;
  const h = 24;
  const data = new Float32Array(w * h * 2);
  for (let i = 0; i < w * h; i++) {
    data[i * 2] = 0.01 * Math.sin(i * 0.3);
    data[i * 2 + 1] = 0.008 * Math.cos(i * 0.2);
  }
  return { width: w, height: h, data, version: 1 };
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function runExportBench(engine: Engine, onRow: (r: ExportBenchRow) => void, picked?: File): Promise<ExportBenchRow[]> {
  const rows: ExportBenchRow[] = [];
  const push = (r: ExportBenchRow) => {
    rows.push(r);
    onRow(r);
  };
  const fail = (name: string, e: unknown) => push({ name, ms: null, detail: `failed: ${errText(e)}` });

  /** row 3 for one bitmap, both output types; the MB lets a reader check the content was photo-like */
  const encodeRows = async (src: ImageBitmap, prefix: string) => {
    for (const type of ENCODE_TYPES) {
      const name = `${prefix}${type}`;
      try {
        const r = await timeEncode(src, type);
        push({ name, ms: r.ms, detail: `${mb(r.bytes)} MB at ${src.width}×${src.height}` });
      } catch (e) {
        fail(name, e);
      }
    }
  };

  // rows 1 and 3 — a real photo from 照片 (HEIC cannot be synthesized): its decode to 4096, then its encodes. Encoded
  // and closed here, before the synthetic rows, so its 4096 bitmap never adds to their peaks.
  if (picked) {
    const name = `decode picked ${picked.type || 'unknown'}`;
    let bmp: ImageBitmap | null = null;
    try {
      const t = now();
      const info = await importPhotoInfo(picked, 4096);
      bmp = info.bitmap;
      push({
        name,
        ms: now() - t,
        detail: `${info.bitmap.width}×${info.bitmap.height} from ${info.oriented.width}×${info.oriented.height}, ${mb(picked.size)} MB, via ${info.path}`,
      });
    } catch (e) {
      fail(name, e);
    }
    try {
      if (bmp) await encodeRows(bmp, 'encode picked ');
    } finally {
      bmp?.close();
    }
  }

  // row 1 — synthetic 12 / 24 / 48 MP JPEGs (the encode is not timed, only the import's decode)
  for (const [w, h, label] of [
    [4032, 3024, '12MP'],
    [5712, 4284, '24MP'],
    [8064, 6048, '48MP'],
  ] as const) {
    try {
      const blob = await synthJpeg(w, h);
      const t = now();
      const info = await importPhotoInfo(blob, 4096);
      push({
        name: `decode ${label}`,
        ms: now() - t,
        detail: `${info.bitmap.width}×${info.bitmap.height} from ${info.oriented.width}×${info.oriented.height}, ${mb(blob.size)} MB, via ${info.path}`,
      });
      info.bitmap.close();
    } catch (e) {
      fail(`decode ${label}`, e);
    }
  }

  // rows 2 and 3 — the tiled render of a 4096 × 3072 frame, then the encoders at that size
  let full: ImageBitmap | null = null;
  try {
    full = (await importPhotoInfo(await synthJpeg(4096, 3072), 4096)).bitmap;
    const decode = { width: full.width, height: full.height };
    const g = snapCrop(setStraighten(IDENTITY_GEOMETRY, 12, decode), decode);
    const V = viewSize(g, decode);
    const body = synthField();
    const faces = gridFaces();
    const oAspect = decode.width / decode.height;
    const fullShortEdge = Math.min(decode.width, decode.height);
    const grid: TileGrid = { V, decode, geometry: g, oAspect, fullShortEdge };
    const base: TileInputBase = { faces, obstacles: [], globalSkin: null, photo: { ...defaultPhoto(), geometry: g }, body, geometry: g, oAspect };
    const bounds = { body, faces: faceBoundsFor(faces, oAspect) };
    for (const T of [512, 1024, 2048]) {
      let out: OffscreenCanvas | null = null;
      try {
        out = new OffscreenCanvas(V.width, V.height);
        const ctx = out.getContext('2d', { alpha: false });
        if (!ctx) throw new Error(`no 2D context at ${V.width}×${V.height}`);
        const tiles = planTiles(grid, bounds, T);
        let tileMs = 0;
        let putMs = 0;
        const t = now();
        for (const tj of tiles) {
          // the export's own window copy (exportFull's cropWindow, through a 2D canvas)
          const bmp = await browserRunnerDeps.crop(full, tj.win);
          let img: ImageData;
          const t1 = now();
          try {
            img = engine.renderTile(
              {
                ...base,
                source: bmp,
                width: tj.win.w,
                height: tj.win.h,
                sourceWindow: { x: tj.win.x / decode.width, y: tj.win.y / decode.height, w: tj.win.w / decode.width, h: tj.win.h / decode.height },
                output: {
                  tile: { x: tj.buf.x / V.width, y: tj.buf.y / V.height, w: tj.buf.w / V.width, h: tj.buf.h / V.height },
                  pixelSize: { width: tj.buf.w, height: tj.buf.h },
                  fullShortEdge,
                },
              },
              { x: tj.out.x - tj.buf.x, y: tj.out.y - tj.buf.y, w: tj.out.w, h: tj.out.h },
            );
          } finally {
            bmp.close();
          }
          const t2 = now();
          tileMs += t2 - t1;
          ctx.putImageData(img, tj.out.x, tj.out.y);
          putMs += now() - t2;
        }
        push({
          name: `tiled render TILE ${T}`,
          ms: now() - t,
          detail: `${tiles.length} tiles of ${V.width}×${V.height}, ${(tileMs / tiles.length).toFixed(1)} ms/tile (render + readPixels), putImageData ${(putMs / tiles.length).toFixed(1)} ms/tile, 6 faces, body field, θ 12°`,
        });
      } catch (e) {
        fail(`tiled render TILE ${T}`, e);
      } finally {
        if (out) out.width = out.height = 0;
        engine.releaseBuffers();
      }
    }

    await encodeRows(full, 'encode ');
  } catch (e) {
    fail('tiled render', e);
  } finally {
    full?.close();
  }

  // row 4 — the canvas-area probe (C §11 Q4)
  for (const [w, h] of [
    [4096, 4096],
    [8192, 6144],
  ] as const) {
    const t = now();
    let c: OffscreenCanvas | null = null;
    try {
      c = new OffscreenCanvas(w, h);
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('no 2D context');
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(w - 2, h - 2, 2, 2);
      const px = ctx.getImageData(w - 1, h - 1, 1, 1).data;
      push({ name: `canvas ${w}×${h}`, ms: now() - t, detail: px[0] === 255 && px[3] === 255 ? 'ok' : `read back ${Array.from(px).join(',')}` });
    } catch (e) {
      fail(`canvas ${w}×${h}`, e);
    } finally {
      if (c) c.width = c.height = 0;
    }
  }

  // row 6 — P2 forced by a non-identity geometry at the working size (S §6.3: ≤ 4 ms over the same edit without it)
  let src: ImageBitmap | null = null;
  try {
    const bmp = (await importPhotoInfo(await synthJpeg(2048, 1536), 2048)).bitmap;
    src = bmp;
    const size = { width: bmp.width, height: bmp.height };
    const input = (geometry = IDENTITY_GEOMETRY): RenderInput => ({
      source: bmp,
      ...size,
      faces: [],
      obstacles: [],
      globalSkin: null,
      photo: { ...defaultPhoto(), geometry },
      geometry,
    });
    const time = (g = IDENTITY_GEOMETRY) => {
      const xs: number[] = [];
      for (let i = 0; i < 5; i++) {
        const t = now();
        engine.renderToImageData(input(g), { mirror: false });
        xs.push(now() - t);
      }
      return median(xs);
    };
    // the row's value: 翻轉 forces P2 at the same V size, so the difference is P2 alone; θ 12° also shrinks V (max-fit)
    const plain = time();
    const flipped = time({ ...IDENTITY_GEOMETRY, flipH: true });
    const tilted = setStraighten(IDENTITY_GEOMETRY, 12, size);
    const turned = time(tilted);
    const vt = viewSize(tilted, size);
    push({
      name: 'P2 with geometry at 2048',
      ms: flipped - plain,
      detail: `identity ${plain.toFixed(1)} ms, 翻轉 ${flipped.toFixed(1)} ms, θ 12° ${turned.toFixed(1)} ms at ${vt.width}×${vt.height} (median of 5, readback included)`,
    });
  } catch (e) {
    fail('P2 with geometry at 2048', e);
  } finally {
    src?.close();
  }

  // row 5 — the share activation window needs a real tap on the device
  push({ name: 'share after 3.5 / 4.5 / 5.5 s', ms: null, detail: 'manual on the iPhone (S §6.4 item 5)' });
  return rows;
}
