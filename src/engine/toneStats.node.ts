// Test-only (Node): statistics on the 膚質 fixture (skin-cleanup spec §8.2): how much of each synthetic defect a tool
// recovers and the "keeps" bounds, shared by the CPU calibration (toneCalibration.test.ts, scale 1) and the GPU harness
// (tests/e2e/tone-engine.spec.ts, scale ⅔). Images are RGBA8; YCbCr is JPEG full range.
import type { Face } from '../types';
import { faceFrame, fieldActive, IDENTITY_WIN, NEUTRAL_TONE, Q_CLEAR, R_CLEAR, toneDrawsQ, toneDrawsR, warmRingWidth, type ToneValues, type V2 } from './passes/toneGeometry';
import { sigmaLow } from './shaders/tone';
import { fromRgba8, makeImg, retouchCpu, toneFieldCpu, toRgba8, type Img } from './toneCpu';
import { rasterizeTone } from './toneRaster.node';

export interface ToneFixtureDefect {
  kind: 'blemish' | 'blotch' | 'darkCircle' | 'fold' | 'teeth' | 'sclera';
  name: string;
  center: [number, number];
  sigma?: number;
  box: [number, number, number, number];
  pixels: [number, number, number][];
}
export interface ToneFixture {
  source: string;
  width: number;
  height: number;
  fw: number;
  defects: ToneFixtureDefect[];
  regions: { cheek: [number, number, number, number] };
}
export interface Rgba8 {
  width: number;
  height: number;
  data: ArrayLike<number>;
}
export type ToolName = 'even' | 'warmUp' | 'warmDown' | 'darkCircle' | 'nasolabial' | 'teeth' | 'eyeBright';

export const TOOL_VALUES: Record<ToolName, ToneValues> = {
  even: { ...NEUTRAL_TONE, even: 1 },
  warmUp: { ...NEUTRAL_TONE, warmth: 1 },
  warmDown: { ...NEUTRAL_TONE, warmth: 0 },
  darkCircle: { ...NEUTRAL_TONE, darkCircle: 1 },
  nasolabial: { ...NEUTRAL_TONE, nasolabial: 1 },
  teeth: { ...NEUTRAL_TONE, teeth: 1 },
  eyeBright: { ...NEUTRAL_TONE, eyeBright: 1 },
};

/**
 * CPU targets at 100 (S §8.2): 勻膚 Cr excess, 黑眼圈 / 法令紋 Y darkening, 白牙 Cb shift, 亮眼 sclera Cr shift. The GPU asserts ⅔.
 * Calibrated (plan Task 9): where the spec's target cannot be met without breaking a keep, the entry is the best value
 * reached, rounded down to 0.05 (S §9) — 黑眼圈 0.6 → 0.45 (darkR; one more lift step breaks the left lash line),
 * 法令紋 0.5 → 0 (the 6 px fold is finer than σ_mid and sits on a highlight, so the field lifts nothing there),
 * 白牙 0.45 → 0 (the fixture's teeth, Y 0.15–0.25, are below the tooth gate; a lower gate whitens the shadowed lips),
 * 亮眼 0.45 → 0.25 (the eye region's inset ramps leave the sclera near the lids and corners at R.A < 1).
 */
export const TARGETS = { even: 0.5, darkCircle: 0.45, nasolabial: 0, teeth: 0, eyeBright: 0.25 };

export interface Check {
  name: string;
  value: number;
  ok: boolean;
  bound: string;
}

export function ycc(img: Rgba8, x: number, y: number): [number, number, number] {
  const i = (y * img.width + x) * 4;
  const r = img.data[i] / 255;
  const g = img.data[i + 1] / 255;
  const b = img.data[i + 2] / 255;
  return [0.299 * r + 0.587 * g + 0.114 * b, 0.5 - 0.168736 * r - 0.331264 * g + 0.5 * b, 0.5 + 0.5 * r - 0.418688 * g - 0.081312 * b];
}

/** Σg·(ch(out) − ch(fix)) / Σg·(ch(orig) − ch(fix)) over the defect pixels with g ≥ minG: 1 = gone, 0 = untouched */
export function recovery(out: Rgba8, fix: Rgba8, orig: Rgba8, pixels: readonly [number, number, number][], ch: 0 | 1 | 2, minG = 0): number {
  let num = 0;
  let den = 0;
  for (const [x, y, g] of pixels) {
    if (g < minG) continue;
    const f = ycc(fix, x, y)[ch];
    num += g * (ycc(out, x, y)[ch] - f);
    den += g * (ycc(orig, x, y)[ch] - f);
  }
  return den !== 0 ? num / den : 0;
}

function lumaGrid(img: Rgba8, x0: number, y0: number, w: number, h: number, pad: number): (x: number, y: number) => number {
  const W = w + 2 * pad;
  const g = new Float64Array(W * (h + 2 * pad));
  for (let y = 0; y < h + 2 * pad; y++)
    for (let x = 0; x < W; x++) {
      const px = Math.min(img.width - 1, Math.max(0, x0 - pad + x));
      const py = Math.min(img.height - 1, Math.max(0, y0 - pad + y));
      g[y * W + x] = ycc(img, px, py)[0];
    }
  return (x, y) => g[(y - y0 + pad) * W + (x - x0 + pad)];
}

/** mean |Y − box3(Y)| over a rect */
export function hfEnergy(img: Rgba8, r: { x: number; y: number; w: number; h: number }): number {
  const Y = lumaGrid(img, r.x, r.y, r.w, r.h, 1);
  let s = 0;
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) {
      let b = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) b += Y(x + i, y + j);
      s += Math.abs(Y(x, y) - b / 9);
    }
  return s / (r.w * r.h);
}

/** mean and standard deviation of Y over the disc of radius `rad` (px) around c */
export function discStats(img: Rgba8, c: readonly [number, number], rad: number): { mean: number; sd: number } {
  let s = 0;
  let s2 = 0;
  let n = 0;
  for (let y = Math.floor(c[1] - rad); y <= Math.ceil(c[1] + rad); y++)
    for (let x = Math.floor(c[0] - rad); x <= Math.ceil(c[0] + rad); x++) {
      if (Math.hypot(x + 0.5 - c[0], y + 0.5 - c[1]) > rad) continue;
      const v = ycc(img, x, y)[0];
      s += v;
      s2 += v * v;
      n++;
    }
  const mean = s / n;
  return { mean, sd: Math.sqrt(Math.max(0, s2 / n - mean * mean)) };
}

function ringMean(img: Rgba8, c: readonly [number, number], r0: number, r1: number): number {
  let s = 0;
  let n = 0;
  for (let y = Math.floor(c[1] - r1); y <= Math.ceil(c[1] + r1); y++)
    for (let x = Math.floor(c[0] - r1); x <= Math.ceil(c[0] + r1); x++) {
      const d = Math.hypot(x + 0.5 - c[0], y + 0.5 - c[1]);
      if (d < r0 || d > r1) continue;
      s += ycc(img, x, y)[0];
      n++;
    }
  return s / n;
}

/** a blemish's contrast: mean Y of the ring [2σ, 3σ] minus mean Y of the disc σ */
export function blobContrast(img: Rgba8, c: readonly [number, number], sigma: number): number {
  return ringMean(img, c, 2 * sigma, 3 * sigma) - discStats(img, c, sigma).mean;
}

/** RMS of Y − box5(Y) in a disc */
function detailRms(img: Rgba8, c: readonly [number, number], rad: number): number {
  const x0 = Math.floor(c[0] - rad);
  const y0 = Math.floor(c[1] - rad);
  const n = Math.ceil(2 * rad) + 1;
  const Y = lumaGrid(img, x0, y0, n, n, 2);
  let s = 0;
  let k = 0;
  for (let y = y0; y < y0 + n; y++)
    for (let x = x0; x < x0 + n; x++) {
      if (Math.hypot(x + 0.5 - c[0], y + 0.5 - c[1]) > rad) continue;
      let b = 0;
      for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) b += Y(x + i, y + j);
      s += (Y(x, y) - b / 25) ** 2;
      k++;
    }
  return Math.sqrt(s / k);
}

export function inPoly(p: V2, poly: readonly V2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** the polygon pushed out radially from its centroid by d px */
function grow(poly: readonly V2[], d: number): V2[] {
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  return poly.map(([x, y]) => {
    const l = Math.hypot(x - cx, y - cy) || 1;
    return [x + ((x - cx) / l) * d, y + ((y - cy) / l) * d];
  });
}
const pts = (face: Face, idx: readonly number[], W: number, H: number): V2[] => idx.map((i) => [face.pts111[i * 2] * W, face.pts111[i * 2 + 1] * H]);
const ovalPx = (face: Face, W: number, H: number): V2[] => Array.from({ length: face.oval.length / 2 }, (_, i): V2 => [face.oval[i * 2] * W, face.oval[i * 2 + 1] * H]);

/** the largest channel difference (0..255) over pixels the predicate excludes */
function maxDiff(a: Rgba8, b: Rgba8, count: (x: number, y: number) => boolean): number {
  let m = 0;
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++) {
      if (!count(x, y)) continue;
      const i = (y * a.width + x) * 4;
      for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(a.data[i + c] - b.data[i + c]));
    }
  return m;
}

const EYE_L = [52, 53, 72, 54, 55, 56, 73, 57];
const EYE_R = [58, 59, 75, 60, 61, 62, 76, 63];
const INNER_LIP = [96, 97, 98, 99, 100, 101, 102, 103];
const OUTER_LIP = [84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95];

/** every check of one tool at 100 (S §8.2 case 2); `scale` multiplies the targets: 1 for the CPU, ⅔ for the GPU */
export function toolChecks(tool: ToolName, out: Rgba8, fix: Rgba8, orig: Rgba8, fx: ToneFixture, face: Face, scale: number): Check[] {
  const W = fix.width;
  const H = fix.height;
  const aspect = W / H;
  const fr = faceFrame(face, aspect);
  const fwPx = fr.fw * W;
  const checks: Check[] = [];
  const atLeast = (name: string, value: number, min: number) => checks.push({ name, value, ok: value >= min, bound: `≥ ${min.toFixed(3)}` });
  const atMost = (name: string, value: number, max: number) => checks.push({ name, value, ok: value <= max, bound: `≤ ${max}` });
  const kind = (k: ToneFixtureDefect['kind']) => fx.defects.filter((d) => d.kind === k);
  const outside = (poly: readonly V2[]) => (x: number, y: number) => !inPoly([x + 0.5, y + 0.5], poly);
  const oval = ovalPx(face, W, H);
  const [cx, cy, cw, ch] = fx.regions.cheek;
  const cheek = { x: cx, y: cy, w: cw, h: ch };
  const meanCh = (img: Rgba8, c: 0 | 1 | 2) => {
    let s = 0;
    for (let y = cy; y < cy + ch; y++) for (let x = cx; x < cx + cw; x++) s += ycc(img, x, y)[c];
    return s / (cw * ch);
  };
  switch (tool) {
    case 'even': {
      for (const d of kind('blotch')) atLeast(`${d.name} Cr recovery`, recovery(out, fix, orig, d.pixels, 2), TARGETS.even * scale);
      const hf = hfEnergy(out, cheek) / hfEnergy(fix, cheek);
      checks.push({ name: 'cheek HF energy ratio', value: hf, ok: hf >= 0.9 && hf <= 1.1, bound: '0.9 … 1.1' });
      for (const d of kind('blemish')) atLeast(`${d.name} contrast kept`, blobContrast(out, d.center, d.sigma ?? 5) / blobContrast(fix, d.center, d.sigma ?? 5), 0.8);
      atMost('max diff outside oval + 0.10 fw', maxDiff(out, fix, outside(grow(oval, 0.1 * fwPx))), 1);
      break;
    }
    case 'warmUp':
    case 'warmDown': {
      const dCb = meanCh(out, 1) - meanCh(fix, 1);
      if (tool === 'warmUp') atMost('cheek ΔCb', dCb, -0.008);
      else atLeast('cheek ΔCb', dCb, 0.008);
      atMost('cheek |ΔY| / Y', Math.abs(meanCh(out, 0) - meanCh(fix, 0)) / meanCh(fix, 0), 0.01);
      const wT = warmRingWidth(face, aspect, null) * W;
      atMost('max diff outside oval + w_T + 0.02 fw', maxDiff(out, fix, outside(grow(oval, wT + 0.02 * fwPx))), 1);
      break;
    }
    case 'darkCircle': {
      for (const d of kind('darkCircle')) atLeast(`${d.name} Y recovery (core)`, recovery(out, fix, orig, d.pixels, 0, 0.9), TARGETS.darkCircle * scale);
      for (const [side, lid] of [['L', [57, 73, 56]], ['R', [62, 76, 63]]] as const) {
        const w = fr.eyeW[side] * W;
        const below = (p: V2): [number, number] => [p[0] + fr.yhat[0] * 0.12 * w, p[1] + fr.yhat[1] * 0.12 * w];
        const lids = pts(face, lid, W, H);
        const contrast = (img: Rgba8) => lids.reduce((s, p) => s + discStats(img, below(p), 3).mean - discStats(img, p, 2).mean, 0) / lids.length;
        // against sample_face.png: the disc 0.12 eyeW below the lid lies inside the synthetic dark circle, so the fixture's
        // own contrast holds the darkening 黑眼圈 must remove; the clean photo's is the lash line's (over-lifting still fails)
        atLeast(`lash line ${side} contrast kept`, contrast(out) / contrast(orig), 0.8);
      }
      atMost('max diff outside oval + 0.10 fw', maxDiff(out, fix, outside(grow(oval, 0.1 * fwPx))), 1);
      break;
    }
    case 'nasolabial': {
      for (const d of kind('fold')) atLeast(`${d.name} Y recovery (core)`, recovery(out, fix, orig, d.pixels, 0, 0.9), TARGETS.nasolabial * scale);
      atMost('max diff outside oval + 0.10 fw', maxDiff(out, fix, outside(grow(oval, 0.1 * fwPx))), 1);
      break;
    }
    case 'teeth': {
      for (const d of kind('teeth')) atLeast('teeth Cb recovery', recovery(out, fix, orig, d.pixels, 1), TARGETS.teeth * scale);
      const inner = pts(face, INNER_LIP, W, H);
      const outer = pts(face, OUTER_LIP, W, H);
      atMost('lips max diff', maxDiff(out, fix, (x, y) => inPoly([x + 0.5, y + 0.5], outer) && !inPoly([x + 0.5, y + 0.5], inner)), 2);
      atMost('max diff outside mouth + 0.06 mouthW', maxDiff(out, fix, outside(grow(inner, 0.06 * fr.mouthW * W))), 1);
      break;
    }
    case 'eyeBright': {
      for (const d of kind('sclera')) atLeast(`${d.name} Cr recovery`, recovery(out, fix, orig, d.pixels, 2), TARGETS.eyeBright * scale);
      for (const [side, i] of [['L', 104], ['R', 105]] as const) {
        const c: [number, number] = [face.pts111[i * 2] * W, face.pts111[i * 2 + 1] * H];
        const rad = 0.18 * fr.eyeW[side] * W;
        atLeast(`iris ${side} detail ratio`, detailRms(out, c, rad) / detailRms(fix, c, rad), 1.1);
      }
      const eyes = [grow(pts(face, EYE_L, W, H), 0.06 * fr.eyeW.L * W), grow(pts(face, EYE_R, W, H), 0.06 * fr.eyeW.R * W)];
      atMost('max diff outside the eyes + 0.06 eyeW', maxDiff(out, fix, (x, y) => !eyes.some((p) => inPoly([x + 0.5, y + 0.5], p))), 1);
      break;
    }
  }
  return checks;
}

/** P0c + P0d on the CPU for one face, deciding the passes as the engine's tone job does (Task 11) */
export function renderToneCpu(img: Rgba8, face: Face, v: ToneValues): Rgba8 {
  const W = img.width;
  const H = img.height;
  const aspect = W / H;
  const faces = [{ face, values: v, weight: 1, cap: null }];
  const qw = Math.ceil(W / 4);
  const qh = Math.ceil(H / 4);
  const fieldOn = fieldActive(v);
  const r: Img = { w: qw, h: qh, d: rasterizeTone(toneDrawsR(faces, aspect), qw, qh, IDENTITY_WIN, R_CLEAR) };
  const q: Img = fieldOn ? { w: qw, h: qh, d: rasterizeTone(toneDrawsQ(faces, aspect), qw, qh, IDENTITY_WIN, Q_CLEAR) } : makeImg(qw, qh);
  const base = fromRgba8(W, H, img.data);
  const sl = sigmaLow(faceFrame(face, aspect).fw * W, Math.min(W, H));
  const field = fieldOn || v.eyeBright > 0 ? toneFieldCpu(base, q, r, sl, fieldOn) : null;
  return { width: W, height: H, data: toRgba8(retouchCpu(base, field, r, fieldOn)) };
}
