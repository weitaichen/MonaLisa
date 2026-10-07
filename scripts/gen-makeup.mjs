// Builds the single-channel makeup masks used for tinted shades (RB §2.5):
//   public/makeup/gp/lip_mask.png   = clamp((1 − min(G,B)) / (1 − 40/255))   from lip.png (GPUPixel mouth.png)
//   public/makeup/gp/blush_mask.png = clamp((1 − min(G,B)) / (1 − 221/255))  from blush.png (GPUPixel blusher.png)
// Stored as greyscale RGBA (R=G=B=mask, A=255), no colour chunks, so the shader can read `.r`.
// The denominators are each texture's darkest min(G,B), so the strongest point maps to 1.
import { readFileSync, writeFileSync } from 'node:fs';
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

function main() {
  for (const m of MASKS) {
    const src = PNG.sync.read(readFileSync(join(dir, m.src)));
    const mask = blur(maskFromRgba(src.data, src.width, src.height, m.darkest), src.width, src.height, m.blurSigma);
    writeFileSync(join(dir, m.dst), maskToPng(mask, src.width, src.height));
    let max = 0;
    for (const v of mask) max = Math.max(max, v);
    console.log(`public/makeup/gp/${m.dst} ${src.width}x${src.height} max ${max.toFixed(3)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
