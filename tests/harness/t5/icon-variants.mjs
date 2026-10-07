// T5 harness: renders the icon mark with / without the closed-eye arcs, at 512 and at
// home-screen sizes (60, 40 px), on one sheet for comparison. Output: previews/icon_variants.png
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { OPTIONS, renderIcon } from '../../../scripts/gen-icons.mjs';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'previews');
mkdirSync(dir, { recursive: true });
const cells = [];
for (const eyes of [false, true]) {
  OPTIONS.eyes = eyes;
  cells.push({ size: 300, data: renderIcon(300, 0.35, 4) });
  cells.push({ size: 60, data: renderIcon(60, 0.35, 8) });
  cells.push({ size: 40, data: renderIcon(40, 0.35, 8) });
}
const W = 2 * (300 + 60 + 40 + 40);
const H = 2 * 310;
const png = new PNG({ width: W, height: H });
png.data.fill(60);
cells.forEach((c, k) => {
  const row = Math.floor(k / 3);
  const ox = [0, 320, 400][k % 3];
  for (let y = 0; y < c.size; y++) c.data.copy(png.data, ((row * 310 + y) * W + ox) * 4, y * c.size * 4, (y + 1) * c.size * 4);
});
writeFileSync(join(dir, 'icon_variants.png'), PNG.sync.write(png));
console.log('previews/icon_variants.png');
