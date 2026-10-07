// T5 harness: shows the shipped icons as launchers would: apple-touch 180 and icon-192 with an
// iOS-style rounded mask (22.37 % radius) on a grey home screen, the maskable icon cropped to the
// minimum 80 % safe circle, plus a 60 px downscale. Output: previews/icons_masked.png
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (f) => PNG.sync.read(readFileSync(join(root, 'public', 'icons', f)));

const W = 1000;
const H = 560;
const out = new PNG({ width: W, height: H });
for (let i = 0; i < W * H; i++) out.data.set([128, 128, 132, 255], i * 4);

function place(img, ox, oy, size, mask) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // box-filter downscale from img to `size`
      const s = img.width / size;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let yy = Math.floor(y * s); yy < Math.floor((y + 1) * s); yy++) {
        for (let xx = Math.floor(x * s); xx < Math.floor((x + 1) * s); xx++) {
          const i = (yy * img.width + xx) * 4;
          r += img.data[i];
          g += img.data[i + 1];
          b += img.data[i + 2];
          n++;
        }
      }
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      if (!mask(u, v)) continue;
      out.data.set([r / n, g / n, b / n, 255], ((oy + y) * W + ox + x) * 4);
    }
  }
}
const rounded = (u, v) => {
  const rr = 0.2237;
  const dx = Math.max(0, Math.abs(u - 0.5) - (0.5 - rr));
  const dy = Math.max(0, Math.abs(v - 0.5) - (0.5 - rr));
  return Math.hypot(dx, dy) <= rr;
};
const safeCircle = (u, v) => Math.hypot(u - 0.5, v - 0.5) <= 0.4;
const all = () => true;

place(read('apple-touch-icon-180.png'), 20, 20, 180, rounded);
place(read('icon-192.png'), 220, 20, 192, rounded);
place(read('icon-512.png'), 440, 20, 512, all);
place(read('icon-512-maskable.png'), 20, 240, 300, safeCircle);
place(read('apple-touch-icon-180.png'), 340, 240, 60, rounded);
place(read('icon-512.png'), 420, 240, 60, rounded);
writeFileSync(join(here, 'previews', 'icons_masked.png'), PNG.sync.write(out));
console.log('previews/icons_masked.png');
