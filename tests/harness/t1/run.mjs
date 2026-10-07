// T1 harness driver: `node tests/harness/t1/run.mjs` (starts its own Vite on :5181 with the
// harness config, no HMR). Runs window.runT1() in headless Chromium, writes PNGs to
// tests/harness/t1/out/, and checks pixels against the decoded fixture with pngjs.
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });
const URL_ = process.env.T1_URL ?? 'http://localhost:5181/tests/harness/t1/index.html';

const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail ?? ''}`);
};

const src = PNG.sync.read(readFileSync(join(root, 'tests/fixtures/sample_face.png')));
const W = src.width;
const H = src.height;

function decode(dataUrl) {
  return PNG.sync.read(Buffer.from(dataUrl.split(',')[1], 'base64'));
}
function px(img, x, y) {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}
/** mean abs diff over RGB, in 0..255; mapX lets us compare against a mirrored source */
function mad(a, b, { mirrorB = false, flipB = false, y0 = 0, y1 = a.height } = {}) {
  let s = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < a.width; x++) {
      const bx = mirrorB ? b.width - 1 - x : x;
      const by = flipB ? b.height - 1 - y : y;
      const pa = px(a, x, y);
      const pb = px(b, bx, by);
      s += Math.abs(pa[0] - pb[0]) + Math.abs(pa[1] - pb[1]) + Math.abs(pa[2] - pb[2]);
      n += 3;
    }
  }
  return s / n;
}
const luma = (p) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
/** luma integral image for fast box means */
function integral(img) {
  const w = img.width;
  const h = img.height;
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += luma(px(img, x, y));
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
    }
  }
  return { I, w, h };
}
function boxMean({ I, w }, x, y, r) {
  const x0 = x - r, x1 = x + r + 1, y0 = y - r, y1 = y + r + 1;
  const W1 = w + 1;
  return (I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0]) / ((2 * r + 1) * (2 * r + 1));
}
const integrals = new Map();
/**
 * Patch statistics: mean luma, `hf` = 1-px Laplacian energy (what sharpen boosts), and `blemish` =
 * band-pass (box3 − box25) energy, the freckle / pore scale that skin smoothing targets.
 */
function patchStats(img, x0, y0, w, h) {
  if (!integrals.has(img)) integrals.set(img, integral(img));
  const ii = integrals.get(img);
  let sum = 0;
  let hf = 0;
  let bp = 0;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const c = luma(px(img, x, y));
      sum += c;
      const lap = 4 * c - luma(px(img, x - 1, y)) - luma(px(img, x + 1, y)) - luma(px(img, x, y - 1)) - luma(px(img, x, y + 1));
      hf += lap * lap;
      const d = boxMean(ii, x, y, 1) - boxMean(ii, x, y, 12);
      bp += d * d;
    }
  }
  const n = w * h;
  return { mean: sum / n, hf: hf / n, blemish: bp / n };
}
function meanRgb(img, x0, y0, w, h) {
  const m = [0, 0, 0];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) px(img, x, y).forEach((v, i) => (m[i] += v));
  return m.map((v) => v / (w * h));
}
/** nearest-neighbour resample of `img` to w×h (for comparing a downscaled display canvas) */
function resample(img, w, h) {
  const o = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor(((x + 0.5) * img.width) / w));
      const sy = Math.min(img.height - 1, Math.floor(((y + 0.5) * img.height) / h));
      const si = (sy * img.width + sx) * 4;
      const di = (y * w + x) * 4;
      for (let k = 0; k < 4; k++) o.data[di + k] = img.data[si + k];
    }
  return o;
}
/** side-by-side crop: left = a, right = b */
function sideBySide(a, b, x0, y0, w, h, scale = 1) {
  const o = new PNG({ width: w * 2 * scale + 4, height: h * scale });
  o.data.fill(255);
  for (const [img, ox] of [
    [a, 0],
    [b, w * scale + 4],
  ])
    for (let y = 0; y < h * scale; y++)
      for (let x = 0; x < w * scale; x++) {
        const p = px(img, x0 + Math.floor(x / scale), y0 + Math.floor(y / scale));
        const di = (y * o.width + ox + x) * 4;
        o.data[di] = p[0];
        o.data[di + 1] = p[1];
        o.data[di + 2] = p[2];
        o.data[di + 3] = 255;
      }
  return o;
}
// ── CPU reference of the GPUPixel whitening chain (beauty_face_unit_filter.cc), for fidelity ──
const lutImg = Object.fromEntries(
  ['gray', 'origin', 'skin', 'light'].map((n) => [n, PNG.sync.read(readFileSync(join(root, `public/luts/gp/lookup_${n}.png`)))]),
);
/** GL texture(): LINEAR + CLAMP_TO_EDGE, v = 0 at the PNG's top row */
function tex(img, u, v) {
  const x = Math.min(Math.max(u * img.width - 0.5, 0), img.width - 1);
  const y = Math.min(Math.max(v * img.height - 0.5, 0), img.height - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, img.width - 1), y1 = Math.min(y0 + 1, img.height - 1);
  const fx = x - x0, fy = y - y0;
  const out = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const g = (xx, yy) => img.data[(yy * img.width + xx) * 4 + k] / 255;
    out[k] = (g(x0, y0) * (1 - fx) + g(x1, y0) * fx) * (1 - fy) + (g(x0, y1) * (1 - fx) + g(x1, y1) * fx) * fy;
  }
  return out;
}
const mix3 = (a, b, t) => a.map((v, i) => v * (1 - t) + b[i] * t);
const clamp3 = (a) => a.map((v) => Math.min(1, Math.max(0, v)));
function lut16(img, t) {
  const b = t[2] * 15;
  const q1y = Math.floor(Math.floor(b) * 0.25), q1x = Math.floor(b) - q1y * 4;
  const q2y = Math.floor(Math.ceil(b) * 0.25), q2x = Math.ceil(b) - q2y * 4;
  const p2 = [t[0] * 0.234375 + 0.0078125, t[1] * 0.234375 + 0.0078125];
  return mix3(tex(img, q1x * 0.25 + p2[0], q1y * 0.25 + p2[1]), tex(img, q2x * 0.25 + p2[0], q2y * 0.25 + p2[1]), b - Math.floor(b));
}
function lut64(img, c) {
  const b = c[2] * 63;
  const q1y = Math.floor(Math.floor(b) / 8), q1x = Math.floor(b) - q1y * 8;
  const q2y = Math.floor(Math.ceil(b) / 8), q2x = Math.ceil(b) - q2y * 8;
  const k = 1 / 8 - 1 / 512;
  const a1 = tex(img, q1x / 8 + 0.5 / 512 + k * c[0], q1y / 8 + 0.5 / 512 + k * c[1]);
  const a2 = tex(img, q2x / 8 + 0.5 / 512 + k * c[0], q2y / 8 + 0.5 / 512 + k * c[1]);
  return mix3(a1, a2, b - Math.floor(b));
}
function whitenRef(rgb, whiten) {
  const epm = rgb;
  let color = clamp3(epm.map((v) => (v - 0.025882) * 1.02657));
  let texel = [tex(lutImg.gray, color[0], 0.5)[0], tex(lutImg.gray, color[1], 0.5)[1], tex(lutImg.gray, color[2], 0.5)[2]];
  texel = mix3(color, texel, 0.5);
  texel = clamp3(mix3(epm, texel, 0.7));
  const origin = lut16(lutImg.origin, texel);
  texel = clamp3(mix3(origin, color, 0.7));
  color = clamp3(lut16(lutImg.skin, texel));
  return mix3(color, lut64(lutImg.light, color), whiten);
}

// ── CPU reference of P3/P4 mean + GPUPixel smoothing (sharpen/whiten 0), RGBA8 intermediates ──
function sampleRow(img, xf, y) {
  // bilinear along x at an exact texel-centre row (CLAMP_TO_EDGE)
  const x = Math.min(Math.max(xf, 0), img.width - 1);
  const x0 = Math.floor(x), x1 = Math.min(x0 + 1, img.width - 1), f = x - x0;
  const a = px(img, x0, y), b = px(img, x1, y);
  return a.map((v, i) => (v * (1 - f) + b[i] * f) / 255);
}
function smoothRef(img, x, y, smooth) {
  const unit = 4 * (Math.min(img.width, img.height) / 720);
  const taps = [[0, 0.111111], [1.5, 0.222222], [-1.5, 0.222222], [3.5, 0.222222], [-3.5, 0.222222]];
  const hAt = (xx, yy) => {
    const acc = [0, 0, 0];
    for (const [o, w] of taps) sampleRow(img, xx + o * unit, yy).forEach((v, i) => (acc[i] += v * w));
    return acc.map((v) => Math.round(v * 255) / 255); // RGBA8 store
  };
  const mean = [0, 0, 0];
  for (const [o, w] of taps) {
    const yf = Math.min(Math.max(y + o * unit, 0), img.height - 1);
    const y0 = Math.floor(yf), y1 = Math.min(y0 + 1, img.height - 1), f = yf - y0;
    const a = hAt(x, y0), b = hAt(x, y1);
    for (let i = 0; i < 3; i++) mean[i] += (a[i] * (1 - f) + b[i] * f) * w;
  }
  const Mn = mean.map((v) => Math.round(v * 255) / 255);
  const I = px(img, x, y).map((v) => v / 255);
  const V = I.map((v, i) => Math.min(((v - Mn[i]) * 7.07) ** 2, 1));
  const p = Math.min(1, Math.max(0, (Math.min(I[0], Mn[0] - 0.1) - 0.2) * 4));
  const mv = (V[0] + V[1] + V[2]) / 3;
  const k = Math.min(1, Math.max(0, (1 - mv / (mv + 0.1)) * p * smooth));
  return mix3(I, Mn, k);
}

const save = (name, png) => writeFileSync(join(outDir, name), PNG.sync.write(png));

const server = await createServer({ configFile: join(here, 'vite.config.mjs'), server: { port: 5181, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const consoleLines = [];
page.on('console', (m) => {
  consoleLines.push(`[${m.type()}] ${m.text()}`);
  if (process.env.T1_VERBOSE) console.log(`  page> ${m.text()}`);
});
page.on('pageerror', (e) => consoleLines.push(`[pageerror] ${e.message}`));
await page.goto(URL_);
await page.waitForFunction(() => typeof window.runT1 === 'function', null, { timeout: 30000 });
const r = await page.evaluate(() => window.runT1());
const renderer = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
  return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER);
});
await browser.close();
await server.close();

console.log('renderer:', renderer);
console.log('console:', consoleLines.filter((l) => !l.includes('[vite]')).join('\n') || '(none)');
if (r.errors.length) console.log('page errors:\n' + r.errors.join('\n'));

const shots = Object.fromEntries(r.shots.map((s) => [s.name, decode(s.png)]));
for (const [name, img] of Object.entries(shots)) save(`${name}.png`, img);

check('(a) WebGL2 available', r.webgl2);
check('(a) engine created: all programs compiled + linked', r.createdOk, r.createError ?? '');
check('ready resolved (GPUPixel LUTs uploaded)', r.readyOk, r.readyError ?? '');
check('no page errors', r.errors.length === 0, r.errors[0]?.split('\n')[0] ?? '');

// (b) identity
const o = shots.original;
if (o) {
  check('(b) 原圖 capture size = source size', o.width === W && o.height === H, `${o.width}x${o.height}`);
  const d = mad(o, src);
  check('(b) 原圖 ≈ source (MAD < 2)', d < 2, `MAD=${d.toFixed(3)}/255`);
  // (d) orientation
  const topSame = mad(o, src, { y0: 0, y1: 20 });
  const topVsBottom = mad(o, src, { flipB: true, y0: 0, y1: 20 });
  check('(d) top rows of capture = top rows of source', topSame < 2 && topVsBottom > 10, `top=${topSame.toFixed(2)} vs flipped=${topVsBottom.toFixed(2)}`);
}
const om = shots.original_mirror;
if (om) {
  const dm = mad(om, src, { mirrorB: true });
  const dn = mad(om, src);
  check('(d) mirror capture = X-flipped source', dm < 2 && dn > 5, `vsMirrored=${dm.toFixed(3)} vsPlain=${dn.toFixed(2)}`);
}

// (c) look
// skin patches on the fixture (checked visually in out/patches.png)
const patches = {
  cheekL: [262, 600, 90, 80],
  cheekR: [560, 590, 90, 80],
  noseBridge: [385, 530, 70, 60],
  forehead: [430, 250, 120, 60],
};
// Max blemish-band ratio 自然/原圖. The nose bridge is ridge structure, not skin texture: 自然's
// sharpen (taps at shortEdge/720 = 1.39 px on this 1000-px-wide still, the same footprint as live)
// lifts part of it back, so it only has to come down, not by 15%.
const blemishMax = { noseBridge: 0.95 };
const nat = shots.natural;
if (nat && o) {
  for (const [k, p] of Object.entries(patches)) {
    const a = patchStats(o, ...p);
    const b = patchStats(nat, ...p);
    check(`(c) 自然 lowers blemish-band energy on ${k}`, b.blemish < a.blemish * (blemishMax[k] ?? 0.85), `blemish ${a.blemish.toFixed(2)} → ${b.blemish.toFixed(2)} (${((b.blemish / a.blemish) * 100).toFixed(0)}%), 1px-HF ${a.hf.toFixed(1)} → ${b.hf.toFixed(1)}, luma ${a.mean.toFixed(1)} → ${b.mean.toFixed(1)}`);
  }
  const dAll = mad(nat, src);
  check('(c) 自然 changes the image plausibly (1 < MAD < 25)', dAll > 1 && dAll < 25, `MAD=${dAll.toFixed(2)}`);
  save('cmp_natural_face.png', sideBySide(o, nat, 230, 330, 520, 600));
  const marked = PNG.sync.read(PNG.sync.write(o));
  for (const [x0, y0, w, h] of Object.values(patches))
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++)
        if (y === y0 || y === y0 + h - 1 || x === x0 || x === x0 + w - 1) {
          const i = (y * marked.width + x) * 4;
          marked.data[i] = 0;
          marked.data[i + 1] = 255;
          marked.data[i + 2] = 0;
        }
  save('patches.png', marked);
  save('cmp_natural_cheek_x3.png', sideBySide(o, nat, 280, 600, 140, 120, 3));
}
const wo = shots.whiten_only;
if (wo && o) {
  const a = patchStats(o, ...patches.cheekR);
  const b = patchStats(wo, ...patches.cheekR);
  check('(c) whitening brightens skin', b.mean > a.mean + 3, `luma ${a.mean.toFixed(1)} → ${b.mean.toFixed(1)}; rgb ${meanRgb(o, ...patches.cheekR).map((v) => v.toFixed(0))} → ${meanRgb(wo, ...patches.cheekR).map((v) => v.toFixed(0))}`);
  save('cmp_whiten_face.png', sideBySide(o, wo, 230, 330, 520, 600));
  // whiten_only = whiten 0.5 (v = 1), fade = smoothstep(0, 0.1, 0.5) = 1 → output is the raw chain
  let err = 0;
  let maxErr = 0;
  let n = 0;
  for (let i = 0; i < 4000; i++) {
    const x = (i * 7919) % W;
    const y = (i * 104729) % H;
    const want = whitenRef(px(src, x, y).map((v) => v / 255), 0.5).map((v) => Math.round(v * 255));
    const got = px(wo, x, y);
    for (let k = 0; k < 3; k++) {
      const e = Math.abs(want[k] - got[k]);
      err += e;
      maxErr = Math.max(maxErr, e);
      n++;
    }
  }
  check('(c) whitening = CPU reference of the GPUPixel chain (LUT orientation / no colour conversion)', err / n < 1 && maxErr <= 4, `MAD=${(err / n).toFixed(3)} max=${maxErr} over ${n / 3} px`);
}
const so = shots.smooth_only;
if (so && o) {
  const a = patchStats(o, ...patches.cheekR);
  const b = patchStats(so, ...patches.cheekR);
  check('(c) smoothing=1 strongly lowers skin blemish band', b.blemish < a.blemish * 0.6, `blemish ${a.blemish.toFixed(2)} → ${b.blemish.toFixed(2)}, 1px-HF ${a.hf.toFixed(2)} → ${b.hf.toFixed(2)}`);
  // dark (hair-free) background must be untouched by the red-channel skin ramp
  const bgA = meanRgb(o, 20, 20, 60, 60);
  const bgB = meanRgb(so, 20, 20, 60, 60);
  check('(c) smoothing leaves grey background untouched', Math.max(...bgA.map((v, i) => Math.abs(v - bgB[i]))) < 1.5, `${bgA.map((v) => v.toFixed(1))} → ${bgB.map((v) => v.toFixed(1))}`);
  {
    let err = 0;
    let maxErr = 0;
    let n = 0;
    for (let i = 0; i < 3000; i++) {
      const x = 30 + ((i * 7919) % (W - 60));
      const y = 30 + ((i * 104729) % (H - 60));
      const want = smoothRef(src, x, y, 1).map((v) => Math.round(v * 255));
      const got = px(so, x, y);
      for (let k = 0; k < 3; k++) {
        const e = Math.abs(want[k] - got[k]);
        err += e;
        maxErr = Math.max(maxErr, e);
        n++;
      }
    }
    check('(c) smoothing = CPU reference (sparse mean ×shortEdge/720 + GPUPixel gate)', err / n < 0.5 && maxErr <= 4, `MAD=${(err / n).toFixed(3)} max=${maxErr} over ${n / 3} px`);
  }
  save('cmp_smooth_cheek_x3.png', sideBySide(o, so, 280, 600, 140, 120, 3));
}
const sh = shots.sharpen_only;
if (sh && o) {
  const a = patchStats(o, ...patches.cheekR);
  const b = patchStats(sh, ...patches.cheekR);
  check('(c) sharpen raises HF energy', b.hf > a.hf * 1.2, `hf ${a.hf.toFixed(2)} → ${b.hf.toFixed(2)}`);
}
const ro = shots.rosy_only;
if (ro && o) {
  const a = meanRgb(o, ...patches.cheekR);
  const b = meanRgb(ro, ...patches.cheekR);
  const bg0 = meanRgb(o, 20, 20, 60, 60);
  const bg1 = meanRgb(ro, 20, 20, 60, 60);
  check('(c) rosy tints skin (R up more than B), background unchanged', b[0] - a[0] > 2 && b[0] - a[0] > b[2] - a[2] - 0.5 && Math.abs(bg1[0] - bg0[0]) < 1.5, `skin ${a.map((v) => v.toFixed(0))} → ${b.map((v) => v.toFixed(0))}, bg R ${bg0[0].toFixed(1)} → ${bg1[0].toFixed(1)}`);
  save('cmp_rosy_face.png', sideBySide(o, ro, 230, 330, 520, 600));
}
for (const id of ['natural', 'warm', 'mono']) {
  const f = shots[`filter_${id}`];
  if (!f) {
    check(`filter ${id} loaded`, false, r.filterLoaded[id]);
    continue;
  }
  const d = mad(f, src);
  check(`filter ${id} applied`, d > 1, `MAD=${d.toFixed(2)}`);
  if (id === 'mono') {
    const p = px(f, 680, 630);
    check('filter mono is near-grey', Math.max(...p) - Math.min(...p) < 30, `${p}`);
  }
}

// (e) display present
const dsp = shots.display_original;
if (dsp) {
  const d = mad(dsp, src);
  const dFlip = mad(dsp, src, { flipB: true });
  check('(e) display canvas upright (still, 原圖)', d < 2 && dFlip > 10, `vsSource=${d.toFixed(3)} vsFlipped=${dFlip.toFixed(2)}`);
}
const dspm = shots.display_original_mirror;
if (dspm) {
  const d = mad(dspm, src, { mirrorB: true });
  check('(e) display mirror = X-flipped source', d < 2, `MAD=${d.toFixed(3)}`);
}
const dro = shots.display_renderOriginal_mirror;
if (dro) {
  const d = mad(dro, src, { mirrorB: true });
  check('(e) renderOriginal upright + mirrored', d < 2, `MAD=${d.toFixed(3)}`);
}
const dn = shots.display_natural;
if (dn && nat) {
  const d = mad(dn, nat);
  check('(e) display 自然 = capture 自然', d < 1, `MAD=${d.toFixed(3)}`);
}
{
  // Sharpen footprint: what sharpen adds in the tier-M preview vs in the full-res capture
  // area-downsampled to the preview size. Taps fixed at 1 processing px gave ≈0.5 here.
  const po = shots.display_original_tierM;
  const ps = shots.display_sharpen_tierM;
  const co = shots.original;
  const cs = shots.sharpen_only;
  if (po && ps && co && cs) {
    const lumaDown = (img, w, h) => {
      const out = new Float64Array(w * h);
      const sx = img.width / w;
      const sy = img.height / h;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          let acc = 0;
          let wsum = 0;
          for (let yy = Math.floor(y * sy); yy < Math.min(img.height, Math.ceil((y + 1) * sy)); yy++) {
            const wy = Math.min(yy + 1, (y + 1) * sy) - Math.max(yy, y * sy);
            for (let xx = Math.floor(x * sx); xx < Math.min(img.width, Math.ceil((x + 1) * sx)); xx++) {
              const wx = Math.min(xx + 1, (x + 1) * sx) - Math.max(xx, x * sx);
              acc += luma(px(img, xx, yy)) * wx * wy;
              wsum += wx * wy;
            }
          }
          out[y * w + x] = acc / wsum;
        }
      return out;
    };
    const w = po.width;
    const h = po.height;
    const a = lumaDown(co, w, h);
    const b = lumaDown(cs, w, h);
    let ePrev = 0;
    let eCap = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const dp = luma(px(ps, x, y)) - luma(px(po, x, y));
        const dc = b[i] - a[i];
        ePrev += dp * dp;
        eCap += dc * dc;
      }
    const ratio = Math.sqrt(eCap / ePrev);
    check('(e) sharpen footprint: full-res capture ≈ tier M preview', ratio > 0.75 && ratio < 1.33, `RMS sharpen delta capture/preview = ${ratio.toFixed(3)} at ${w}x${h}`);
  }
}
const tm = shots.display_tier_M;
if (tm) {
  const d = mad(tm, resample(nat, tm.width, tm.height));
  check('(e) tier M display ≈ downscaled 自然 capture (look is resolution-stable)', d < 6, `MAD=${d.toFixed(2)} at ${tm.width}x${tm.height}`);
}
const ar = shots.after_restore_natural;
if (ar && nat) {
  const d = mad(ar, nat);
  check('context restore → identical 自然 capture', d < 0.5 && r.timings.lostFlag === 1 && r.timings.lostAfterRestore === 0, `MAD=${d.toFixed(3)} lost=${r.timings.lostFlag} afterRestore=${r.timings.lostAfterRestore}`);
}

// face path
console.log('face passes:', JSON.stringify(r.facePasses));
if (r.facePasses.glow) {
  const fp = r.facePasses;
  // The engine preloads the makeup textures when it builds the pipeline, so they are usually in
  // by the first face frame; either way the face passes must run and makeup must follow the load.
  check('face: first face frame runs the face passes (makeup once its textures are in)', fp.first.includes('reshape') && fp.first.includes('maskWarp'), JSON.stringify(fp.first));
  check('face: glow runs mask, makeup, reshape, mask warp, mean, composite', JSON.stringify(fp.glow) === '["mask","makeup","reshape","maskWarp","meanH","meanV","composite"]', JSON.stringify(fp.glow));
  check('face: match-GPUPixel drops only the mask', !fp.match.includes('mask') && fp.match.includes('reshape'), JSON.stringify(fp.match));
  check('face: overlay pass drawn when showLandmarks', fp.overlay.at(-1) === 'overlay', JSON.stringify(fp.overlay));
  const fo = shots.face_original;
  if (fo) check('face: 原圖 with a face ≈ source (no reshape/makeup at neutral)', mad(fo, src) < 2, `MAD=${mad(fo, src).toFixed(3)}`);
  const fw0 = shots.face_weight0_natural;
  if (fw0 && nat) check('face: faceWeight 0 ≡ no-face 自然', mad(fw0, nat) < 0.5, `MAD=${mad(fw0, nat).toFixed(3)}`);
  const fn = shots.face_natural;
  const fm = shots.face_natural_match;
  if (fn && fm) {
    // red hair passes GPUPixel's red-channel skin ramp; the face mask must keep it sharp
    const fs = shots.face_smooth_only;
    const fsm = shots.face_smooth_only_match;
    const hair = [300, 60, 80, 80];
    const hairMad = (img) => {
      let t = 0;
      for (let y = hair[1]; y < hair[1] + hair[3]; y++) for (let x = hair[0]; x < hair[0] + hair[2]; x++) px(img, x, y).forEach((v, i) => (t += Math.abs(v - px(src, x, y)[i])));
      return t / (hair[2] * hair[3] * 3);
    };
    if (fs && fsm) {
      const masked = hairMad(fs);
      const unmasked = hairMad(fsm);
      check('face: mask keeps hair unsmoothed (smooth=1; vs match-GPUPixel)', masked < 0.5 && unmasked > 1.5, `hair MAD vs source: masked ${masked.toFixed(2)}, match-GPUPixel ${unmasked.toFixed(2)}`);
      const sk = patchStats(fs, ...patches.cheekL).blemish;
      check('face: masked smoothing still smooths the cheek', sk < patchStats(o, ...patches.cheekL).blemish * 0.6, `cheekL blemish → ${sk.toFixed(2)}`);
      save('cmp_face_smooth_match_vs_masked.png', sideBySide(fsm, fs, 0, 450, 500, 600));
    }
    const fh = patchStats(fn, ...patches.forehead);
    check('face: masked 自然 still smooths the forehead', fh.blemish < patchStats(o, ...patches.forehead).blemish * 0.85, `forehead blemish → ${fh.blemish.toFixed(2)}`);
  }
  if (shots.face_glow && fo) save('cmp_face_glow.png', sideBySide(fo, shots.face_glow, 230, 330, 520, 600));
  if (shots.face_refined && fo) save('cmp_face_refined.png', sideBySide(fo, shots.face_refined, 150, 200, 700, 900));
}

// (f) GL errors
const bad = Object.entries(r.glErrors).filter(([, v]) => v !== 0);
check('(f) gl.getError() === NO_ERROR after every stage', bad.length === 0, bad.length ? JSON.stringify(bad) : `${Object.keys(r.glErrors).length} stages`);

// (g) sizes
const expect = {
  video_H: [1920, 1080],
  video_M: [1280, 720],
  video_L: [960, 540],
  face_H: [1000, 1500],
  face_M: [720, 1080],
  face_L: [540, 810],
  still: [1000, 1500],
};
for (const [k, [ew, eh]] of Object.entries(expect)) {
  const s = r.sizes[k];
  check(`(g) ${k} canvas ${ew}x${eh}`, s && s.canvas[0] === ew && s.canvas[1] === eh && s.stats[0] === ew && s.stats[1] === eh, s ? `canvas=${s.canvas} stats=${s.stats} passes=${s.passes.join(',')}` : 'missing');
}
for (const [k, v] of Object.entries(r.captureSizes)) check(`(g) capture ${k} at full source res`, v[0] === W && v[1] === H, `${v}`);
check('passes: 原圖 still runs composite only', JSON.stringify(r.sizes.still?.passes) === '["composite"]', JSON.stringify(r.sizes.still?.passes));
check('passes: 自然 no-face runs mean + composite', JSON.stringify(r.sizes.still_natural?.passes) === '["meanH","meanV","composite"]', JSON.stringify(r.sizes.still_natural?.passes));

console.log('timings (ms):', JSON.stringify(r.timings, (k, v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v)));
const failed = checks.filter((c) => !c.ok);
writeFileSync(join(outDir, 'results.json'), JSON.stringify({ renderer, checks, timings: r.timings, glErrors: r.glErrors, sizes: r.sizes, console: consoleLines }, null, 2));
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
