// T5 harness helper: crops the face from previews/<id>.png (full strength) for original + 8 looks
// into previews/face_crops_full.png, for close inspection of skin rendering.
// Run after preview-luts.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { FILTER_IDS } from '../../../scripts/gen-luts.mjs';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'previews');
const read = (n) => PNG.sync.read(readFileSync(join(dir, n)));
const sheet = read('sheet_full.png');
const orig = { width: 500, data: Buffer.alloc(500 * 750 * 4) };
for (let y = 0; y < 750; y++) sheet.data.copy(orig.data, y * 500 * 4, ((6 + y) * sheet.width + 6) * 4, ((6 + y) * sheet.width + 506) * 4);
const imgs = [orig, ...FILTER_IDS.map((id) => read(`${id}.png`))];
const cw = 200;
const ch = 260;
const x0 = 130;
const y0 = 170;
const W = imgs.length * cw;
const out = new PNG({ width: W, height: ch });
imgs.forEach((im, k) => {
  for (let y = 0; y < ch; y++) im.data.copy(out.data, (y * W + k * cw) * 4, ((y0 + y) * im.width + x0) * 4, ((y0 + y) * im.width + x0 + cw) * 4);
});
writeFileSync(join(dir, 'face_crops_full.png'), PNG.sync.write(out));
