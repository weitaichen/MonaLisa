// Builds the single-channel makeup masks used for tinted shades (RB §2.5):
//   public/makeup/gp/lip_mask.png   = clamp((1 − min(G,B)) / (1 − 40/255))   from lip.png (GPUPixel mouth.png)
//   public/makeup/gp/blush_mask.png = clamp((1 − min(G,B)) / (1 − 221/255))  from blush.png (GPUPixel blusher.png)
// Stored as greyscale RGBA (R=G=B=mask, A=255), no colour chunks, so the shader can read `.r`.
// The denominators are each texture's darkest min(G,B), so the strongest point maps to 1.
// It also writes the lashes texture (8-bit greyscale, no colour chunks, uploaded R8 with mipmaps):
//   public/makeup/own/lashes.png = coverage of 42 procedural lashes (face-detail spec §4.10), original work
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'public', 'makeup', 'gp');

export const MASKS = [
  { src: 'lip.png', dst: 'lip_mask.png', darkest: 40, blurSigma: 0 },
  // blusher.png spans only ~34 grey levels (min(G,B) 221..255), so the stretched mask would step in
  // ~7.5/255 increments; a tiny blur (far below the blush's own ~50 px falloff) restores a smooth ramp.
  { src: 'blush.png', dst: 'blush_mask.png', darkest: 221, blurSigma: 1.5 },
];

/** Float mask in 0..1 from an RGBA buffer per the RB §2.5 formula. */
export function maskFromRgba(data, width, height, darkest) {
  const out = new Float32Array(width * height);
  const denom = 1 - darkest / 255;
  for (let i = 0; i < width * height; i++) {
    const m = 1 - Math.min(data[i * 4 + 1], data[i * 4 + 2]) / 255;
    out[i] = Math.min(1, Math.max(0, m / denom));
  }
  return out;
}

/** Separable Gaussian blur with clamped edges. */
export function blur(mask, width, height, sigma) {
  if (sigma <= 0) return mask;
  const r = Math.ceil(sigma * 3);
  const k = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    k.push(w);
    sum += w;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(mask.length);
  const out = new Float32Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) a += mask[y * width + Math.min(width - 1, Math.max(0, x + i))] * k[i + r];
      tmp[y * width + x] = a;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) a += tmp[Math.min(height - 1, Math.max(0, y + i)) * width + x] * k[i + r];
      out[y * width + x] = a;
    }
  }
  return out;
}

export function maskToPng(mask, width, height) {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    const v = Math.round(Math.min(1, Math.max(0, mask[i])) * 255);
    png.data[i * 4] = v;
    png.data[i * 4 + 1] = v;
    png.data[i * 4 + 2] = v;
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png, { colorType: 6 });
}

export const LASHES_W = 512;
export const LASHES_H = 128;
export const LASH_COUNT = 42;
/** coverage supersampling per texel side, and Bézier segments per lash */
const SS = 8;
const SEGMENTS = 64;

/** eye x (0 outer corner … 1 inner corner) → texture column; u = (x + 0.2) / 1.2 */
export const lashColumn = (x) => ((x + 0.2) / 1.2) * LASHES_W;

/** 42 roots at x_k = 0.02 + 0.96·(k + 0.5 + j_k)/42, j_k ∈ ±0.3 from a fixed LCG (seed 0x6d6c): deterministic output */
export function lashRoots() {
  let seed = 0x6d6c;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const out = [];
  for (let k = 0; k < LASH_COUNT; k++) {
    const j = (rnd() * 2 - 1) * 0.3;
    out.push(0.02 + (0.96 * (k + 0.5 + j)) / LASH_COUNT);
  }
  return out;
}

/**
 * Coverage 0..1 per texel; row 127 is the root, row 0 the tip side. Each lash is a quadratic Bézier from its root
 * (vertical start) to a tip shifted outward by lean(x)·0.35 eye units, lean(x) = 0.15 + 0.35·(1 − x); every third
 * lash is 85 % long; thickness tapers 3.2 → 0.6 px. Coverage is 8 × 8 supersampled per lash, combined with max.
 */
export function lashes() {
  const W = LASHES_W;
  const H = LASHES_H;
  const out = new Float32Array(W * H);
  lashRoots().forEach((x, k) => {
    const len = k % 3 === 2 ? 0.85 : 1;
    const lean = 0.15 + 0.35 * (1 - x);
    const p0 = [lashColumn(x), H];
    const p1 = [lashColumn(x), H - 0.55 * len * H];
    const p2 = [lashColumn(x - lean * 0.35), H - len * H];
    const pts = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const c = t * t;
      pts.push([a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1], (3.2 + (0.6 - 3.2) * t) / 2]);
    }
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [px, py, r] of pts) {
      x0 = Math.min(x0, px - r);
      x1 = Math.max(x1, px + r);
      y0 = Math.min(y0, py - r);
      y1 = Math.max(y1, py + r);
    }
    const bx0 = Math.max(0, Math.floor(x0) - 1);
    const by0 = Math.max(0, Math.floor(y0) - 1);
    const bx1 = Math.min(W - 1, Math.ceil(x1) + 1);
    const by1 = Math.min(H - 1, Math.ceil(y1) + 1);
    const bw = bx1 - bx0 + 1;
    const hit = new Uint8Array(bw * (by1 - by0 + 1) * SS * SS);
    // rasterize each segment as a capsule over its own small box (radius interpolated along the segment)
    for (let i = 0; i < SEGMENTS; i++) {
      const [ax, ay, ar] = pts[i];
      const [cx, cy, cr] = pts[i + 1];
      const rmax = Math.max(ar, cr);
      const sx0 = Math.max(bx0, Math.floor(Math.min(ax, cx) - rmax));
      const sx1 = Math.min(bx1, Math.ceil(Math.max(ax, cx) + rmax));
      const sy0 = Math.max(by0, Math.floor(Math.min(ay, cy) - rmax));
      const sy1 = Math.min(by1, Math.ceil(Math.max(ay, cy) + rmax));
      const dx = cx - ax;
      const dy = cy - ay;
      const l2 = dx * dx + dy * dy || 1e-12;
      for (let py = sy0; py <= sy1; py++)
        for (let px = sx0; px <= sx1; px++)
          for (let s = 0; s < SS * SS; s++) {
            const qx = px + ((s % SS) + 0.5) / SS;
            const qy = py + (Math.floor(s / SS) + 0.5) / SS;
            const t = Math.min(1, Math.max(0, ((qx - ax) * dx + (qy - ay) * dy) / l2));
            const ex = ax + dx * t - qx;
            const ey = ay + dy * t - qy;
            const r = ar + (cr - ar) * t;
            if (ex * ex + ey * ey <= r * r) hit[((py - by0) * bw + (px - bx0)) * SS * SS + s] = 1;
          }
    }
    for (let py = by0; py <= by1; py++)
      for (let px = bx0; px <= bx1; px++) {
        let n = 0;
        const o = ((py - by0) * bw + (px - bx0)) * SS * SS;
        for (let s = 0; s < SS * SS; s++) n += hit[o + s];
        const v = n / (SS * SS);
        if (v > out[py * W + px]) out[py * W + px] = v;
      }
  });
  return out;
}

/** 8-bit greyscale PNG (no colour chunks): WebGL2 uploads it as R8 from the red channel */
export function lashesPng() {
  const png = new PNG({ width: LASHES_W, height: LASHES_H });
  png.data = Buffer.from(Uint8Array.from(lashes(), (v) => Math.round(Math.min(1, Math.max(0, v)) * 255)));
  return PNG.sync.write(png, { colorType: 0, inputColorType: 0, bitDepth: 8, inputHasAlpha: false });
}

function main() {
  for (const m of MASKS) {
    const src = PNG.sync.read(readFileSync(join(dir, m.src)));
    const mask = blur(maskFromRgba(src.data, src.width, src.height, m.darkest), src.width, src.height, m.blurSigma);
    writeFileSync(join(dir, m.dst), maskToPng(mask, src.width, src.height));
    let max = 0;
    for (const v of mask) max = Math.max(max, v);
    console.log(`public/makeup/gp/${m.dst} ${src.width}x${src.height} max ${max.toFixed(3)}`);
  }
  const own = join(root, 'public', 'makeup', 'own');
  mkdirSync(own, { recursive: true });
  writeFileSync(join(own, 'lashes.png'), lashesPng());
  console.log(`public/makeup/own/lashes.png ${LASHES_W}x${LASHES_H}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
