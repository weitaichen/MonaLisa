// Builds tests/fixtures/face.y4m for Chromium's fake camera
// (--use-file-for-fake-video-capture): sample_face.png (portrait) placed into a 1280×720
// landscape frame, face centred, pillarboxed with the photo's own edge colour, encoded as
// YUV4MPEG2 4:2:0 (BT.601 limited range, which is how Chromium interprets I420 from a file).
// Output is gitignored; regenerate with `node scripts/gen-y4m.mjs`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const W = 1280;
export const H = 720;
export const FRAMES = 30;

/**
 * Source rectangle (in sample_face.png pixels, 1000×1500) that becomes the 720-px-tall image
 * column. Chosen so the face (hairline → chin, cheek → cheek) lands in the frame centre.
 */
const CROP = { x: 0, y: 50, w: 1000, h: 1200 };
/** Source x that should land on the frame's horizontal centre (face midline). */
const FACE_CX = 470;

/**
 * Area-weighted (tent-filter) resample of a rectangle of an RGBA buffer, so downscaling does
 * not alias. Returns Float32 RGB in 0..255.
 */
export function resampleRgb(src, sw, sh, rect, dw, dh) {
  const out = new Float32Array(dw * dh * 3);
  const sx = rect.w / dw;
  const sy = rect.h / dh;
  const rx = Math.max(1, sx);
  const ry = Math.max(1, sy);
  const weights = (n, scale, radius, offset, limit) => {
    const taps = [];
    for (let i = 0; i < n; i++) {
      const c = offset + (i + 0.5) * scale - 0.5;
      const lo = Math.ceil(c - radius);
      const hi = Math.floor(c + radius);
      const list = [];
      let sum = 0;
      for (let s = lo; s <= hi; s++) {
        const w = Math.max(0, 1 - Math.abs(s - c) / radius);
        if (w <= 0) continue;
        list.push([Math.min(limit - 1, Math.max(0, s)), w]);
        sum += w;
      }
      taps.push(list.map(([s, w]) => [s, w / sum]));
    }
    return taps;
  };
  const tx = weights(dw, sx, rx, rect.x, sw);
  const ty = weights(dh, sy, ry, rect.y, sh);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (const [syy, wy] of ty[y]) {
        for (const [sxx, wx] of tx[x]) {
          const i = (syy * sw + sxx) * 4;
          const w = wx * wy;
          r += src[i] * w;
          g += src[i + 1] * w;
          b += src[i + 2] * w;
        }
      }
      const o = (y * dw + x) * 3;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
    }
  }
  return out;
}

function backdropColour(png) {
  const sum = [0, 0, 0];
  let n = 0;
  for (let y = 0; y < 250; y++) {
    for (const x0 of [0, png.width - 80]) {
      for (let x = x0; x < x0 + 80; x++) {
        const i = (y * png.width + x) * 4;
        sum[0] += png.data[i];
        sum[1] += png.data[i + 1];
        sum[2] += png.data[i + 2];
        n++;
      }
    }
  }
  return sum.map((v) => v / n);
}

/** Compose the 1280×720 RGB frame (Float32, 0..255). */
export function composeFrame(png) {
  const scale = H / CROP.h;
  const colW = Math.round(CROP.w * scale);
  const col = resampleRgb(png.data, png.width, png.height, CROP, colW, H);
  const left = Math.round(W / 2 - (FACE_CX - CROP.x) * scale);

  // Pillarbox colour: the studio backdrop (top corners of the photo), darkened so the frame edge
  // reads as a neutral border rather than part of the photo.
  const fill = backdropColour(png).map((v) => v * 0.6);

  const rgb = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3;
      const cx = x - left;
      if (cx >= 0 && cx < colW) {
        const i = (y * colW + cx) * 3;
        rgb[o] = col[i];
        rgb[o + 1] = col[i + 1];
        rgb[o + 2] = col[i + 2];
      } else {
        rgb[o] = fill[0];
        rgb[o + 1] = fill[1];
        rgb[o + 2] = fill[2];
      }
    }
  }
  return rgb;
}

const clamp8 = (v) => Math.min(255, Math.max(0, Math.round(v)));

/** RGB (0..255 floats) → I420 planes, BT.601 limited range, chroma averaged over 2×2 (centre siting). */
export function rgbToI420(rgb, w, h) {
  const Y = new Uint8Array(w * h);
  const U = new Uint8Array((w / 2) * (h / 2));
  const V = new Uint8Array((w / 2) * (h / 2));
  for (let i = 0; i < w * h; i++) {
    const r = rgb[i * 3] / 255;
    const g = rgb[i * 3 + 1] / 255;
    const b = rgb[i * 3 + 2] / 255;
    Y[i] = clamp8(16 + 65.481 * r + 128.553 * g + 24.966 * b);
  }
  for (let y = 0; y < h / 2; y++) {
    for (let x = 0; x < w / 2; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]) {
        const i = ((y * 2 + dy) * w + x * 2 + dx) * 3;
        r += rgb[i];
        g += rgb[i + 1];
        b += rgb[i + 2];
      }
      r /= 4 * 255;
      g /= 4 * 255;
      b /= 4 * 255;
      const o = y * (w / 2) + x;
      U[o] = clamp8(128 - 37.797 * r - 74.203 * g + 112 * b);
      V[o] = clamp8(128 + 112 * r - 93.786 * g - 18.214 * b);
    }
  }
  return { Y, U, V };
}

export function encodeY4m({ Y, U, V }, w, h, frames) {
  const header = Buffer.from(`YUV4MPEG2 W${w} H${h} F30:1 Ip A1:1 C420jpeg\n`, 'ascii');
  const frameHeader = Buffer.from('FRAME\n', 'ascii');
  const frame = Buffer.concat([frameHeader, Y, U, V]);
  return Buffer.concat([header, ...Array.from({ length: frames }, () => frame)]);
}

function main() {
  const src = PNG.sync.read(readFileSync(join(root, 'tests', 'fixtures', 'sample_face.png')));
  const rgb = composeFrame(src);
  const planes = rgbToI420(rgb, W, H);
  const out = join(root, 'tests', 'fixtures', 'face.y4m');
  mkdirSync(dirname(out), { recursive: true });
  const buf = encodeY4m(planes, W, H, FRAMES);
  writeFileSync(out, buf);
  console.log(`tests/fixtures/face.y4m ${W}x${H} ${FRAMES} frames (${(buf.length / 1e6).toFixed(1)} MB)`);

  // Optional RGB preview of the composed frame (for eyeballing / the fake-camera check).
  const previewArg = process.argv.indexOf('--preview');
  if (previewArg > 0 && process.argv[previewArg + 1]) {
    const png = new PNG({ width: W, height: H });
    for (let i = 0; i < W * H; i++) {
      png.data[i * 4] = clamp8(rgb[i * 3]);
      png.data[i * 4 + 1] = clamp8(rgb[i * 3 + 1]);
      png.data[i * 4 + 2] = clamp8(rgb[i * 3 + 2]);
      png.data[i * 4 + 3] = 255;
    }
    const p = process.argv[previewArg + 1];
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, PNG.sync.write(png));
    console.log(`preview -> ${p}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
