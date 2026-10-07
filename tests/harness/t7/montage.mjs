// Combine screenshots (1179×2556 @3x) into a side-by-side sheet at 1x (box-filtered) for review.
// Usage: node tests/harness/t7/montage.mjs out.png shot1 shot2 ...
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';
const [out, ...names] = process.argv.slice(2);
const S = 3;
const imgs = names.map((n) => PNG.sync.read(readFileSync(`tests/harness/t7/shots/${n}.png`)));
const w = Math.floor(imgs[0].width / S), h = Math.floor(imgs[0].height / S), gap = 8;
const dst = new PNG({ width: imgs.length * (w + gap) - gap, height: h });
dst.data.fill(80);
imgs.forEach((img, k) => {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const acc = [0, 0, 0];
    for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) {
      const i = ((y * S + dy) * img.width + x * S + dx) * 4;
      acc[0] += img.data[i]; acc[1] += img.data[i + 1]; acc[2] += img.data[i + 2];
    }
    const o = (y * dst.width + k * (w + gap) + x) * 4;
    dst.data[o] = acc[0] / 9; dst.data[o + 1] = acc[1] / 9; dst.data[o + 2] = acc[2] / 9; dst.data[o + 3] = 255;
  }
});
writeFileSync(out, PNG.sync.write(dst));
