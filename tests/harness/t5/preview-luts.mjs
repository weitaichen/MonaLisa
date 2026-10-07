// T5 harness: grade tests/fixtures/sample_face.png with every SHIPPED LUT (read back from
// public/luts/filters/*.png, through the same 64³ lookup math as the shader) and write previews:
//   previews/<id>.png             full strength
//   previews/sheet_default.png    3×3 grid at each filter's default amount (original top-left)
//   previews/sheet_full.png       3×3 grid at full strength
//   previews/thumbs.png           all thumbnails (2× nearest) in strip order
// Usage: node tests/harness/t5/preview-luts.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { FILTER_IDS, applyLut, encodePng } from '../../../scripts/gen-luts.mjs';
import { resampleRgb } from '../../../scripts/gen-y4m.mjs';
import { FILTERS } from '../../../src/engine/params.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const out = join(here, 'previews');
mkdirSync(out, { recursive: true });

const readPng = (p) => PNG.sync.read(readFileSync(p));
const face = readPng(join(root, 'tests', 'fixtures', 'sample_face.png'));

// 500×750 working copy keeps the run fast and the sheets readable.
const CW = 500;
const CH = 750;
const rgb = resampleRgb(face.data, face.width, face.height, { x: 0, y: 0, w: face.width, h: face.height }, CW, CH);
const small = Buffer.alloc(CW * CH * 4);
for (let i = 0; i < CW * CH; i++) {
  small[i * 4] = Math.round(rgb[i * 3]);
  small[i * 4 + 1] = Math.round(rgb[i * 3 + 1]);
  small[i * 4 + 2] = Math.round(rgb[i * 3 + 2]);
  small[i * 4 + 3] = 255;
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

// The fixture is a dark, moody studio shot; phone selfies are brighter. A ~+1 EV copy (exponential
// shoulder, white stays white) shows how each look behaves on typical, brighter input.
const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const enc = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const bright = Buffer.from(small);
for (let i = 0; i < bright.length; i += 4) {
  for (let c = 0; c < 3; c++) {
    const y = (1 - Math.exp(-2.2 * lin(small[i + c] / 255))) / (1 - Math.exp(-2.2));
    bright[i + c] = Math.round(enc(y) * 255);
  }
}

const defaults = Object.fromEntries(FILTERS.map((f) => [f.id, f.defaultAmount]));
const atDefault = [small];
const atFull = [small];
const brightDefault = [bright];
for (const id of FILTER_IDS) {
  const lut = readPng(join(root, 'public', 'luts', 'filters', `${id}.png`));
  if (lut.width !== 512 || lut.height !== 512) throw new Error(`${id}: bad size`);
  const full = applyLut(lut.data, small, 1);
  atFull.push(full);
  atDefault.push(applyLut(lut.data, small, defaults[id]));
  brightDefault.push(applyLut(lut.data, bright, defaults[id]));
  writeFileSync(join(out, `${id}.png`), encodePng(full, CW, CH));
  console.log(`${id}: default amount ${defaults[id]}`);
}
for (const [name, cells] of [
  ['sheet_default', atDefault],
  ['sheet_full', atFull],
  ['sheet_bright_default', brightDefault],
]) {
  const s = sheet(cells, CW, CH, 3);
  writeFileSync(join(out, `${name}.png`), encodePng(s.buf, s.W, s.H));
}

// thumbnails, 2× nearest-neighbour so they are easy to inspect
const ids = ['none', ...FILTER_IDS];
const T = 96;
const Z = 2;
const thumbs = ids.map((id) => {
  const t = readPng(join(root, 'public', 'luts', 'filters', `${id}_thumb.png`));
  if (t.width !== T || t.height !== T) throw new Error(`${id}_thumb: bad size`);
  const big = Buffer.alloc(T * Z * T * Z * 4);
  for (let y = 0; y < T * Z; y++) {
    for (let x = 0; x < T * Z; x++) t.data.copy(big, (y * T * Z + x) * 4, (((y / Z) | 0) * T + ((x / Z) | 0)) * 4, (((y / Z) | 0) * T + ((x / Z) | 0)) * 4 + 4);
  }
  return big;
});
const ts = sheet(thumbs, T * Z, T * Z, 9);
writeFileSync(join(out, 'thumbs.png'), encodePng(ts.buf, ts.W, ts.H));
console.log('previews written to tests/harness/t5/previews/');
