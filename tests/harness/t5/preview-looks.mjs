// T5 harness: the 質感 tuning sheet (v0.4 step-2 spec §4.6). Grades sample_face.png, the thumbnail swatch and a
// gradient chart with every look at 程度 50, 80 and 100 (LUT mix + the look's 調節 offsets through adjustMath.ts, as
// the app draws them at seed 0), under a first row of 原圖 · 濾鏡 膠片 (its default 0.6) · 原圖 for comparison.
// Output (gitignored): previews/looks.png (face), previews/looks_swatch.png, previews/looks_chart.png.
// Usage: node tests/harness/t5/preview-looks.mjs   (Node ≥ 22.18: the generator imports src/engine/*.ts)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { LOOK_IDS, THUMB, applyLut, drawSwatch, encodePng, gradeLook } from '../../../scripts/gen-luts.mjs';
import { resampleRgb } from '../../../scripts/gen-y4m.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const out = join(here, 'previews');
mkdirSync(out, { recursive: true });
const readPng = (p) => PNG.sync.read(readFileSync(p));

const FW = 250;
const FH = 375;
const face = readPng(join(root, 'tests', 'fixtures', 'sample_face.png'));
const rgb = resampleRgb(face.data, face.width, face.height, { x: 0, y: 0, w: face.width, h: face.height }, FW, FH);
const small = Buffer.alloc(FW * FH * 4);
for (let i = 0; i < FW * FH; i++) {
  small[i * 4] = Math.round(rgb[i * 3]);
  small[i * 4 + 1] = Math.round(rgb[i * 3 + 1]);
  small[i * 4 + 2] = Math.round(rgb[i * 3 + 2]);
  small[i * 4 + 3] = 255;
}

function hsv(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}
const CW = 360;
const CH = 150;
const chart = Buffer.alloc(CW * CH * 4);
for (let y = 0; y < CH; y++) {
  for (let x = 0; x < CW; x++) {
    let c;
    if (y < 50) c = hsv(x, 1, 1 - y / 60);
    else if (y < 100) c = hsv(x, 0.45, 1 - (y - 50) / 60);
    else if (y < 125) c = [x / (CW - 1), x / (CW - 1), x / (CW - 1)];
    else {
      const t = x / (CW - 1);
      c = [141 + (241 - 141) * t, 85 + (194 - 85) * t, 60 + (167 - 60) * t].map((v) => v / 255);
    }
    const i = (y * CW + x) * 4;
    chart[i] = Math.round(c[0] * 255);
    chart[i + 1] = Math.round(c[1] * 255);
    chart[i + 2] = Math.round(c[2] * 255);
    chart[i + 3] = 255;
  }
}

function sheet(cells, cw, ch, cols) {
  const rows = Math.ceil(cells.length / cols);
  const gap = 6;
  const W = cols * cw + (cols + 1) * gap;
  const H = rows * ch + (rows + 1) * gap;
  const buf = Buffer.alloc(W * H * 4, 0);
  for (let i = 3; i < buf.length; i += 4) buf[i] = 255;
  cells.forEach((cell, k) => {
    const ox = gap + (k % cols) * (cw + gap);
    const oy = gap + Math.floor(k / cols) * (ch + gap);
    for (let y = 0; y < ch; y++) cell.copy(buf, ((oy + y) * W + ox) * 4, y * cw * 4, (y + 1) * cw * 4);
  });
  return { buf, W, H };
}

const filmFilter = readPng(join(root, 'public', 'luts', 'filters', 'film.png')).data;
const swatch = drawSwatch(THUMB);
for (const [name, img, w, h] of [
  ['looks', small, FW, FH],
  ['looks_swatch', swatch, THUMB, THUMB],
  ['looks_chart', chart, CW, CH],
]) {
  const cells = [img, applyLut(filmFilter, img, 0.6), img];
  for (const id of LOOK_IDS) {
    const lut = readPng(join(root, 'public', 'luts', 'looks', `look_${id}.png`)).data;
    for (const a of [0.5, 0.8, 1]) cells.push(gradeLook(id, lut, img, w, h, a));
  }
  const s = sheet(cells, w, h, 3);
  writeFileSync(join(out, `${name}.png`), encodePng(s.buf, s.W, s.H));
}
console.log('previews written to tests/harness/t5/previews/looks.png, looks_swatch.png, looks_chart.png');
