// T5 harness: smooth gradient chart (hue × lightness sweep at two saturations, grey ramp, skin
// ramp) graded by every shipped LUT at full strength through the shader's 64³ lookup math.
// Banding, kinks or hue flips show up here long before they show on a photo.
// Output: previews/gradients.png (rows: original, then FILTER_IDS order).
// Usage: node tests/harness/t5/gradient-chart.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { FILTER_IDS, applyLut, encodePng } from '../../../scripts/gen-luts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const W = 360;
const H = 150;

function hsv(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

const chart = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let c;
    if (y < 50) c = hsv(x, 1, 1 - y / 50); // saturated hues, bright → dark
    else if (y < 100) c = hsv(x, 0.45, 1 - (y - 50) / 60); // muted hues
    else if (y < 125) c = [x / (W - 1), x / (W - 1), x / (W - 1)]; // grey ramp
    else {
      const t = x / (W - 1); // skin ramp: deep → fair
      c = [0.35 + 0.62 * t, 0.2 + 0.6 * t, 0.14 + 0.58 * t];
    }
    const i = (y * W + x) * 4;
    chart[i] = Math.round(c[0] * 255);
    chart[i + 1] = Math.round(c[1] * 255);
    chart[i + 2] = Math.round(c[2] * 255);
    chart[i + 3] = 255;
  }
}

const rows = [chart];
for (const id of FILTER_IDS) {
  const lut = PNG.sync.read(readFileSync(join(root, 'public', 'luts', 'filters', `${id}.png`)));
  rows.push(applyLut(lut.data, chart, 1));
}
const gap = 4;
const SH = rows.length * (H + gap);
const sheet = Buffer.alloc(W * SH * 4);
rows.forEach((r, k) => r.copy(sheet, k * (H + gap) * W * 4));
writeFileSync(join(here, 'previews', 'gradients.png'), encodePng(sheet, W, SH));
console.log('previews/gradients.png');
