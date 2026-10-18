import { describe, expect, it } from 'vitest';
import { IDENTITY_WIN, NO_FOLDS, TONE_ZERO, type FoldChords } from './passes/toneGeometry';
import { shaderHash } from './shaderHash';
import { MAX_RENDER_FACES } from '../config/limits';
import { gaussWeights, lFactor, MAX_FOLDS, MAX_MOUTHS, RETOUCH_FS, sigmaLow, sigmaMid, TONE, TONE_BLUR_FS, TONE_DOWN8_FS, TONE_FIELD_FS, TONE_LBOX_FS } from './shaders/tone';
import { bandOf, deltaTexel, foldBand, fromYcc, lipGuard, LUMA709, makeImg, q8, retouchCpu, retouchPixel, sample, toneFieldCpu, toYcc, type Img } from './toneCpu';

const SKIN = [0.8, 0.62, 0.52] as const;
const lum = (c: ArrayLike<number>) => LUMA709[0] * c[0] + LUMA709[1] * c[1] + LUMA709[2] * c[2];
function image(w: number, h: number, f: (x: number, y: number) => readonly number[]): Img {
  const o = makeImg(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = f(x, y);
      o.d.set([q8(c[0]), q8(c[1]), q8(c[2]), 1], (y * w + x) * 4);
    }
  return o;
}
/** a ¼-res target filled with one value */
const quarter = (w: number, h: number, rgba: readonly number[]) => makeImg(Math.ceil(w / 4), Math.ceil(h / 4), rgba);
const Q = (w: number, h: number, even = 0, b = TONE_ZERO) => quarter(w, h, [even, 1, b, 0]);
const R = (w: number, h: number, rgba: readonly number[] = [0, 0, 0, 0]) => quarter(w, h, rgba);
const px = (a: Img, x: number, y: number) => Array.from(a.d.subarray((y * a.w + x) * 4, (y * a.w + x) * 4 + 3));

describe('toneCpu (skin-cleanup spec §4.3–4.4)', () => {
  it('neutral values give Δ = 0, and the retouch output equals the input bit for bit', () => {
    const base = image(160, 120, (x, y) => [0.7 + 0.1 * Math.sin(x / 7), 0.55, 0.45 + 0.05 * Math.cos(y / 5)]);
    const f = toneFieldCpu(base, Q(160, 120), R(160, 120), 30, true);
    for (let i = 0; i < f.delta8!.d.length; i += 4) for (let c = 0; c < 3; c++) expect(f.delta8!.d[i + c]).toBeCloseTo(TONE_ZERO, 6);
    expect(Array.from(retouchCpu(base, f, R(160, 120), true).d)).toEqual(Array.from(base.d));
  });

  it('勻膚 at 1 cancels ≥ 85 % of the mid-band chroma bC, while I − Mn changes ≤ 1/255 on average', () => {
    const w = 512;
    const h = 256;
    // a zero-luma chroma wave between σ_mid (7.2 px) and σ_low (61 px): R up, G down by the luma-neutral ratio
    const wave = (x: number) => 0.03 * Math.cos((2 * Math.PI * x) / 96);
    const base = image(w, h, (x) => [SKIN[0] + wave(x), SKIN[1] - (wave(x) * LUMA709[0]) / LUMA709[1], SKIN[2]]);
    const sl = sigmaLow(10_000, Math.min(w, h)); // the 0.12 SE cap
    const f = toneFieldCpu(base, Q(w, h, 1), R(w, h), sl, true);
    let dot = 0;
    let norm = 0;
    const m = [0, 0, 0, 0];
    const L = [0, 0, 0, 0];
    for (let y = 4; y < f.mn8.h - 4; y++)
      for (let x = 4; x < f.mn8.w - 4; x++) {
        const u = (x + 0.5) / f.mn8.w;
        const v = (y + 0.5) / f.mn8.h;
        sample(f.mn8, u, v, m);
        sample(f.l!, u, v, L);
        const { bC } = bandOf(m, L);
        for (let c = 0; c < 3; c++) {
          const d = (f.delta8!.d[(y * f.mn8.w + x) * 4 + c] - TONE_ZERO) / 2;
          dot += -d * bC[c];
          norm += bC[c] * bC[c];
        }
      }
    expect(dot / norm).toBeGreaterThanOrEqual(0.85);
    const out = retouchCpu(base, f, R(w, h), true);
    const fOut = toneFieldCpu(out, Q(w, h, 1), R(w, h), sl, false);
    let hf = 0;
    let n = 0;
    const a = [0, 0, 0, 0];
    const b = [0, 0, 0, 0];
    for (let y = 32; y < h - 32; y += 3)
      for (let x = 32; x < w - 32; x += 3) {
        sample(f.mn8, (x + 0.5) / w, (y + 0.5) / h, a);
        sample(fOut.mn8, (x + 0.5) / w, (y + 0.5) / h, b);
        for (let c = 0; c < 3; c++) hf += Math.abs(out.d[(y * w + x) * 4 + c] - b[c] - (base.d[(y * w + x) * 4 + c] - a[c]));
        n += 3;
      }
    expect((hf / n) * 255).toBeLessThanOrEqual(1);
  });

  it('勻膚 at full weight cancels the mid-band chroma bC and never inverts it (a gain above 1 is capped at 1)', () => {
    // bY = 0 (no lift), conf 1, gE 1, Q.R 1: Δ is exactly −bC, not −even.chroma·bC
    const L = [0.7, 0.55, 0.45, 1];
    const bC = [0.02, -0.02 * (LUMA709[0] / LUMA709[1]), 0];
    const m = [L[0] + bC[0], L[1] + bC[1], L[2] + bC[2], 1];
    expect(bandOf(m, L).bY).toBeCloseTo(0, 12);
    const d = deltaTexel(m, L, [1, 1, TONE_ZERO, 0], [0, 0, 0, 0], [0, 0, 0]);
    const c = bandOf(m, L).bC;
    for (let k = 0; k < 3; k++) expect(d[k]).toBeCloseTo(-c[k], 12);
    // at half weight the calibrated gain still acts: −min(1, 0.5·even.chroma)·bC
    const h = deltaTexel(m, L, [0.5, 1, TONE_ZERO, 0], [0, 0, 0, 0], [0, 0, 0]);
    for (let k = 0; k < 3; k++) expect(h[k]).toBeCloseTo(-Math.min(1, 0.5 * TONE.even.chroma) * c[k], 12);
  });

  describe('overlapping tools never add past one tool (S §4.3, §9)', () => {
    // a darker-than-reference texel with a chroma cast: bY −0.03 (gE = gD = 1), conf 1
    const L = [0.7, 0.55, 0.45, 1];
    const cast = [0.012, -0.012 * (LUMA709[0] / LUMA709[1]), 0];
    const m = [L[0] - 0.03 + cast[0], L[1] - 0.03 + cast[1], L[2] - 0.03 + cast[2], 1];
    const lumaOf = (d: ArrayLike<number>) => lum(d);
    const chromaOf = (d: ArrayLike<number>) => [0, 1, 2].map((k) => d[k] - lumaOf(d));
    const len = (v: readonly number[]) => Math.hypot(...v);

    it('勻膚 + 黑眼圈 combine as if one ran after the other, so their overlap never passes L (it used to add to 1.3 lift, 1.7 chroma)', () => {
      const { bY, bC } = bandOf(m, L);
      expect(bY).toBeCloseTo(-0.03, 12);
      // each alone keeps its own factor: 勻膚 0.45 lift, min(1, 1.08) chroma; 黑眼圈 0.85 lift, 0.70 chroma
      const e = deltaTexel(m, L, [1, 1, TONE_ZERO, 0], [0, 0, 0, 0], [0, 0, 0]);
      const k = deltaTexel(m, L, [0, 1, TONE_ZERO, 0], [1, 0, 0, 0], [0, 0, 0]);
      expect(lumaOf(e)).toBeCloseTo(TONE.even.lift * 0.03, 12);
      expect(lumaOf(k)).toBeCloseTo(TONE.darkCircle.lift * 0.03, 12);
      for (let c = 0; c < 3; c++) expect(chromaOf(k)[c]).toBeCloseTo(-TONE.darkCircle.chroma * bC[c], 12);
      // both at once equal 勻膚, then 黑眼圈 on its result against the same L (the guards are 1 at both steps here)
      const both = deltaTexel(m, L, [1, 1, TONE_ZERO, 0], [1, 0, 0, 0], [0, 0, 0]);
      const m1 = [m[0] + e[0], m[1] + e[1], m[2] + e[2], 1];
      const then = deltaTexel(m1, L, [0, 1, TONE_ZERO, 0], [1, 0, 0, 0], [0, 0, 0]);
      for (let c = 0; c < 3; c++) expect(both[c]).toBeCloseTo(e[c] + then[c], 12);
      // so the lift factor is 1 − 0.55 · 0.15 and the chroma factor 1: the texel ends between m and L, never past L
      expect(lumaOf(both)).toBeCloseTo((1 - (1 - TONE.even.lift) * (1 - TONE.darkCircle.lift)) * 0.03, 12);
      for (let c = 0; c < 3; c++) expect(chromaOf(both)[c]).toBeCloseTo(-bC[c], 12);
      expect(lumaOf(both)).toBeLessThanOrEqual(-bY);
      // and each slider still acts where the other is on (no dead slider): 黑眼圈 0.5 over 勻膚 1 lifts more than 勻膚 alone
      const half = deltaTexel(m, L, [1, 1, TONE_ZERO, 0], [0.5, 0, 0, 0], [0, 0, 0]);
      expect(lumaOf(half)).toBeGreaterThan(lumaOf(e) + 1 / 255);
    });

    it('法令紋 over 勻膚 / 黑眼圈: the lift is the larger of the two, the chroma correction no longer than the longer one', () => {
      // a fold depth across the band (bNY −0.02) with its own chroma, at full 法令紋 weight
      const fold = [-0.02 - 0.006, -0.02 + 0.006 * (LUMA709[0] / LUMA709[1]), -0.02];
      const foldY = lumaOf(fold);
      const n = deltaTexel(m, L, [0, 1, TONE_ZERO, 0], [0, 1, 0, 0], [0, 0, 0], fold);
      // alone: its calibrated gain, unchanged (1.20 of the valley depth)
      expect(lumaOf(n)).toBeCloseTo(TONE.nasolabial.lift * -foldY, 12);
      const e = deltaTexel(m, L, [1, 1, TONE_ZERO, 0], [0, 0, 0, 0], [0, 0, 0]);
      const en = deltaTexel(m, L, [1, 1, TONE_ZERO, 0], [0, 1, 0, 0], [0, 0, 0], fold);
      expect(lumaOf(en)).toBeCloseTo(Math.max(lumaOf(e), lumaOf(n)), 12);
      expect(len(chromaOf(en))).toBeLessThanOrEqual(Math.max(len(chromaOf(e)), len(chromaOf(n))) + 1e-12);
      // with every mid-band tool and 法令紋 at full weight the lift is still the larger of the mid band's (勻膚 then 黑眼圈) and 法令紋's
      const mid = deltaTexel(m, L, [1, 1, TONE_ZERO, 0], [1, 0, 0, 0], [0, 0, 0]);
      const all = deltaTexel(m, L, [1, 1, TONE_ZERO, 0], [1, 1, 0, 0], [0, 0, 0], fold);
      expect(lumaOf(mid)).toBeGreaterThan(lumaOf(n));
      expect(lumaOf(all)).toBeCloseTo(lumaOf(mid), 12);
      expect(len(chromaOf(all))).toBeLessThanOrEqual(Math.max(len(chromaOf(mid)), len(chromaOf(n))) + 1e-12);
    });
  });

  it('a mole (mid-band luma −0.2) is left alone by 勻膚', () => {
    const w = 256;
    const sMid = sigmaMid(w);
    const blob = (x: number, y: number) => 0.25 * Math.exp(-((x - 128) ** 2 + (y - 128) ** 2) / (2 * (3 * sMid) ** 2));
    const base = image(w, w, (x, y) => [SKIN[0] - blob(x, y), SKIN[1] - blob(x, y), SKIN[2] - blob(x, y)]);
    const f = toneFieldCpu(base, Q(w, w, 1), R(w, w), sigmaLow(10_000, w), true);
    const out = retouchCpu(base, f, R(w, w), true);
    for (const [x, y] of [[128, 128], [126, 130], [131, 127]]) for (let c = 0; c < 3; c++) expect(Math.abs(px(out, x, y)[c] - px(base, x, y)[c]) * 255).toBeLessThanOrEqual(1);
  });

  it('黑眼圈 lifts only darker-than-reference shading', () => {
    const w = 256;
    const s = 2.5 * sigmaMid(w);
    const g = (x: number, y: number, cx: number) => Math.exp(-((x - cx) ** 2 + (y - 128) ** 2) / (2 * s * s));
    const base = image(w, w, (x, y) => SKIN.map((v) => v - 0.06 * g(x, y, 70) + 0.06 * g(x, y, 186)));
    const f = toneFieldCpu(base, Q(w, w), R(w, w, [1, 0, 0, 0]), sigmaLow(10_000, w), true);
    const out = retouchCpu(base, f, R(w, w, [1, 0, 0, 0]), true);
    expect(lum(px(out, 70, 128)) - lum(px(base, 70, 128))).toBeGreaterThan(0.02);
    expect(Math.abs(lum(px(out, 186, 128)) - lum(px(base, 186, 128))) * 255).toBeLessThanOrEqual(1);
  });

  describe('法令紋: the valley depth across its band (S §4.3)', () => {
    // a fold like the fixture's foldL: a soft shadow (σ 0.84 σ_mid, Y × (1 − 0.12 g)) on the flank of a convex cheek
    // ridge, steep enough that the mid band makes no minimum across it, so no reference lower in the image (L) sees it
    const w = 800;
    const sMid = sigmaMid(w);
    const xf = 400;
    const ridge = (x: number) => 0.45 + 0.15 * Math.exp(-((x - (xf - 1.5 * sMid)) ** 2) / (2 * (3 * sMid) ** 2));
    const foldG = (x: number) => Math.exp(-((x - xf) ** 2) / (2 * (0.84 * sMid) ** 2));
    const skin = (y: number) => SKIN.map((v) => (v * y) / lum(SKIN));
    const orig = image(w, w, (x) => skin(ridge(x)));
    const fix = image(w, w, (x) => skin(ridge(x) * (1 - 0.12 * foldG(x + 0.5))));
    // R.G: a vertical band at xf, 1 on its centre line falling to 0 at ±2 σ_mid; its chord, iso, top to bottom
    const band = makeImg(w / 4, w / 4);
    for (let y = 0; y < w / 4; y++) for (let x = 0; x < w / 4; x++) band.d[(y * (w / 4) + x) * 4 + 1] = q8(Math.max(0, 1 - Math.abs((x + 0.5) * 4 - xf) / (2 * sMid)));
    const folds: FoldChords = { chords: [{ s: [xf / w, 0], e: [xf / w, 1] }] };
    const run = (img: Img, f: FoldChords) => retouchCpu(img, toneFieldCpu(img, Q(w, w), band, sigmaLow(10_000, w), true, f), band, true);
    const Y = (a: Img, x: number, y: number) => lum(px(a, x, y));

    it('lifts a soft fold that makes no mid-band minimum (it sits on the flank of a cheek ridge) by ≥ 50 % at its core', () => {
      // the premise: Mn8's luma falls steadily across the fold, within ±2 σ_mid of it
      const mn8 = toneFieldCpu(fix, Q(w, w), band, sigmaLow(10_000, w), false).mn8;
      const row: number[] = [];
      for (let i = Math.floor((xf - 2 * sMid) / 8); i <= Math.ceil((xf + 2 * sMid) / 8); i++) row.push(lum(px(mn8, i, mn8.h >> 1)));
      for (let i = 1; i < row.length; i++) expect(row[i]).toBeLessThan(row[i - 1]);
      const out = run(fix, folds);
      let num = 0;
      let den = 0;
      for (let y = 200; y < 600; y++)
        for (let x = 0; x < w; x++) {
          if (foldG(x + 0.5) < 0.9) continue;
          num += Y(out, x, y) - Y(fix, x, y);
          den += Y(orig, x, y) - Y(fix, x, y);
        }
      expect(num / den).toBeGreaterThanOrEqual(0.5);
    });

    it('leaves the ridge without a fold, and a linear slope, alone (only a valley across the band is lifted)', () => {
      const ramp = image(w, w, (x) => skin(0.3 + (0.35 * x) / w));
      for (const img of [orig, ramp]) {
        const out = run(img, folds);
        let max = 0;
        for (let i = 0; i < out.d.length; i++) if (i % 4 !== 3) max = Math.max(max, Math.abs(Math.round(out.d[i] * 255) - Math.round(img.d[i] * 255)));
        expect(max).toBeLessThanOrEqual(1);
      }
    });

    it('with no band listed, R.G alone changes nothing (as 白牙 without a lip guard)', () => {
      const out = run(fix, NO_FOLDS);
      let moved = 0;
      for (let i = 0; i < out.d.length; i++) if (out.d[i] !== fix.d[i]) moved++;
      expect(moved).toBe(0);
    });
  });

  it('膚色 ±1 moves skin Cb in opposite directions by similar amounts, keeps the luma, and leaves green and blue alone', () => {
    const w = 64;
    const base = image(w, w, (x) => (x < 22 ? SKIN : x < 44 ? [0.2, 0.6, 0.3] : [0.2, 0.3, 0.7]));
    const run = (b: number) => retouchCpu(base, toneFieldCpu(base, Q(w, w, 0, b), R(w, w), sigmaLow(10_000, w), true), R(w, w), true);
    const warm = run(1);
    const cool = run(0);
    const cb = (a: Img) => toYcc(...(px(a, 11, 32) as [number, number, number]))[1];
    const dWarm = cb(warm) - cb(base);
    const dCool = cb(cool) - cb(base);
    expect(dWarm).toBeLessThan(-0.008);
    expect(dCool).toBeGreaterThan(0.008);
    expect(Math.abs(dWarm) / Math.abs(dCool)).toBeGreaterThan(0.7);
    expect(Math.abs(dWarm) / Math.abs(dCool)).toBeLessThan(1.43);
    for (const a of [warm, cool]) {
      expect(Math.abs(lum(px(a, 11, 32)) - lum(px(base, 11, 32))) * 255).toBeLessThanOrEqual(1);
      expect(px(a, 33, 32)).toEqual(px(base, 33, 32));
      expect(px(a, 55, 32)).toEqual(px(base, 55, 32));
    }
  });

  it('白牙 neutralizes yellow-white and leaves lips and gums alone', () => {
    const tooth = [0.85, 0.8, 0.62];
    const out = retouchPixel([...tooth], tooth, tooth, 1, 0);
    expect(Math.abs(toYcc(...(out as [number, number, number]))[1] - 0.5)).toBeLessThanOrEqual(0.5 * Math.abs(toYcc(0.85, 0.8, 0.62)[1] - 0.5));
    for (const lip of [[0.75, 0.4, 0.42], [0.8, 0.45, 0.48]]) {
      const o = retouchPixel([...lip], lip, lip, 1, 0);
      for (let c = 0; c < 3; c++) expect(Math.abs(o[c] - lip[c]) * 255).toBeLessThan(0.5);
    }
  });

  it('白牙 whitens shadowed teeth (Y 0.15–0.25, as in sample_face.png) and leaves the dark gap between them alone', () => {
    const tooth = fromYcc(0.2, 0.43, 0.535);
    const out = retouchPixel([...tooth], tooth, tooth, 1, 0) as [number, number, number];
    expect(Math.abs(toYcc(...out)[1] - 0.5)).toBeLessThanOrEqual(0.5 * 0.07);
    expect(toYcc(...out)[0]).toBeGreaterThan(0.2 + 0.03);
    const gap = fromYcc(0.08, 0.47, 0.53);
    const g = retouchPixel([...gap], gap, gap, 1, 0);
    for (let c = 0; c < 3; c++) expect(Math.abs(g[c] - gap[c]) * 255).toBeLessThan(0.5);
  });

  it("白牙's lip guard: nothing outside the inner-lip polygon moves, by true distance at full resolution; inside it ramps in over TONE.teeth.inset·mouthW", () => {
    // R.B = 1 over the whole ¼ target, as the ¼-res fan reads past the lip line; a shadowed-tooth colour everywhere
    const w = 400;
    const h = 200;
    const aspect = w / h;
    const uv: [number, number][] = [[0.2, 0.5], [0.35, 0.4], [0.5, 0.38], [0.65, 0.4], [0.8, 0.5], [0.65, 0.6], [0.5, 0.62], [0.35, 0.6]];
    const mouthW = 0.6;
    const guards = { aspect, mouths: [{ ring: uv.map(([x, y]): [number, number] => [x, y / aspect]), mouthW }] };
    const tooth = fromYcc(0.2, 0.43, 0.535);
    const base = image(w, h, () => tooth);
    const rB = R(w, h, [0, 0, 1, 0]);
    const out = retouchCpu(base, null, rB, false, IDENTITY_WIN, guards);
    const full = retouchPixel([...tooth], tooth, tooth, 1, 0).map(q8);
    // the test's own polygon maths, in px
    const poly = uv.map(([x, y]) => [x * w, y * h]);
    const inside = (px: number, py: number) => {
      let r = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
        if (poly[i][1] > py !== poly[j][1] > py && px < ((poly[j][0] - poly[i][0]) * (py - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) r = !r;
      return r;
    };
    const edge = (px: number, py: number) =>
      Math.min(
        ...poly.map((a, i) => {
          const b = poly[(i + 1) % poly.length];
          const t = Math.min(1, Math.max(0, ((px - a[0]) * (b[0] - a[0]) + (py - a[1]) * (b[1] - a[1])) / ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2)));
          return Math.hypot(px - a[0] - t * (b[0] - a[0]), py - a[1] - t * (b[1] - a[1]));
        }),
      );
    const insetPx = TONE.teeth.inset * mouthW * w;
    let outsideN = 0;
    let deepN = 0;
    let rampN = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const o = px(out, x, y);
        const b = px(base, x, y);
        if (!inside(x + 0.5, y + 0.5)) {
          outsideN++;
          expect(o, `${x},${y}`).toEqual(b);
          continue;
        }
        const d = edge(x + 0.5, y + 0.5);
        if (d >= insetPx + 0.01) {
          deepN++;
          for (let c = 0; c < 3; c++) expect(Math.round(Math.abs(o[c] - full[c]) * 255), `${x},${y}`).toBeLessThanOrEqual(1);
        } else if (d > 0.2 * insetPx && d < 0.8 * insetPx) {
          rampN++;
          const db = (toYcc(...(o as [number, number, number]))[1] - toYcc(...(b as [number, number, number]))[1]) / (toYcc(...(full as [number, number, number]))[1] - toYcc(...(b as [number, number, number]))[1]);
          expect(db, `${x},${y}`).toBeGreaterThan(0);
          expect(db, `${x},${y}`).toBeLessThan(1);
        }
      }
    expect(Math.min(outsideN, deepN, rampN)).toBeGreaterThan(50);
    // no mouth listed: 白牙 has nowhere to act, whatever R.B says
    expect(Array.from(retouchCpu(base, null, rB, false).d)).toEqual(Array.from(base.d));
  });

  it('亮眼 moves a fully weighted sclera to neutral and never past it (a gain above 1 is capped at 1)', () => {
    const sclera = fromYcc(0.75, 0.49, 0.53);
    const o = toYcc(...(retouchPixel([...sclera], sclera, sclera, 0, 1) as [number, number, number]));
    expect(o[1]).toBeCloseTo(0.5, 9);
    expect(o[2]).toBeCloseTo(0.5, 9);
  });

  it('亮眼 detints the sclera, and its clarity term respects the ±0.12 clamp', () => {
    const sclera = [0.86, 0.78, 0.77];
    const o = retouchPixel([...sclera], sclera, sclera, 0, 1);
    const before = Math.abs(toYcc(0.86, 0.78, 0.77)[2] - 0.5);
    expect(Math.abs(toYcc(...(o as [number, number, number]))[2] - 0.5)).toBeLessThanOrEqual(0.5 * before);
    const iris = [0.3, 0.45, 0.35];
    const flat = retouchPixel([...iris], iris, iris, 0, 1);
    const sharp = retouchPixel([...iris], iris, iris.map((v) => v - 0.3), 0, 1);
    for (let c = 0; c < 3; c++) {
      expect(sharp[c] - flat[c]).toBeGreaterThan(0);
      expect(sharp[c] - flat[c]).toBeLessThanOrEqual(0.7 * 0.12 + 1e-9);
    }
  });

  it('σ_low and the L reduction', () => {
    expect(sigmaLow(589, 1000)).toBeCloseTo(47.12, 2);
    expect(sigmaLow(100, 1000)).toBeCloseTo(42.3, 6);
    expect(sigmaLow(5000, 1000)).toBe(120);
    expect(lFactor(96)).toBe(16);
    expect(lFactor(96.01)).toBe(32);
    for (const s of [0.5, 1.76, 2.9, 7.7]) {
      const w = gaussWeights(s);
      expect(w[0] + 2 * w.slice(1).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
      expect(w.length - 1).toBe(Math.min(31, Math.ceil(3 * s)));
    }
  });

  it('the Δ offset encoding round-trips within 0.5/255', () => {
    for (let d = -0.24; d <= 0.24; d += 0.0007) expect(Math.abs((q8(TONE_ZERO + 2 * d) - TONE_ZERO) / 2 - d)).toBeLessThanOrEqual(0.5 / 255);
  });

  it('YCbCr is JPEG full range and round-trips', () => {
    const [y, cb, cr] = toYcc(0.8, 0.62, 0.52);
    const back = fromYcc(y, cb, cr);
    expect(back[0]).toBeCloseTo(0.8, 5);
    expect(back[1]).toBeCloseTo(0.62, 5);
    expect(back[2]).toBeCloseTo(0.52, 5);
  });
});

describe('every rendered face reaches the tone passes (MAX_RENDER_FACES = 10, S §6.7)', () => {
  it('the arrays hold two fold chords and one mouth per rendered face, in the shaders and the CPU port', () => {
    expect(MAX_RENDER_FACES).toBe(10);
    expect(MAX_FOLDS).toBe(20);
    expect(MAX_MOUTHS).toBe(10);
    expect(TONE_FIELD_FS).toContain('uniform vec4 uFold[20];');
    expect(RETOUCH_FS).toContain('uniform vec2 uMouth[80];');
    expect(RETOUCH_FS).toContain('uniform float uMouthW[10];');
  });
  it("白牙's lip guard reads the tenth face's mouth; 法令紋 reads the twentieth chord", () => {
    const sq = (cx: number): [number, number][] => [[cx - 0.02, 0.48], [cx + 0.02, 0.48], [cx + 0.02, 0.52], [cx - 0.02, 0.52]];
    const mouths = Array.from({ length: MAX_RENDER_FACES }, (_, f) => ({ ring: sq(0.05 + f * 0.1), mouthW: 0.04 }));
    const last = 0.05 + (MAX_RENDER_FACES - 1) * 0.1;
    expect(lipGuard(last, 0.5, { aspect: 1, mouths })).toBeGreaterThan(0.5);
    expect(lipGuard(last, 0.5, { aspect: 1, mouths: mouths.slice(0, -1) })).toBe(0);
    // a dark horizontal valley (rows 23–33). 20 chords: nineteen far-off vertical ones and, last, one along the
    // valley. At the texel on the valley the nearest chord is the last one, so the band runs across the valley and
    // finds it; without that chord the nearest is vertical, the band runs along the valley and sees no depth
    const base0 = image(256, 64, (_, y) => (Math.abs(y - 28) < 6 ? [0.3, 0.3, 0.3] : [0.7, 0.7, 0.7]));
    const far = Array.from({ length: MAX_FOLDS - 1 }, (): [number, number, number, number] => [0, 0, 0, 8]);
    const chords: [number, number, number, number][] = [...far, [190, 28, 250, 28]];
    expect(chords).toHaveLength(20);
    const d = foldBand({ base0, chords, k: 14 }, 27, 3, [0, 0, 0]);
    expect(d).not.toBeNull();
    expect(d![0]).toBeLessThan(-0.3);
    expect(foldBand({ base0, chords: chords.slice(0, -1), k: 14 }, 27, 3, [0, 0, 0])![0]).toBeCloseTo(0, 6);
  });
});

describe('tone shaders pin', () => {
  it('is pinned to the shader text and the TONE table: a change must be mirrored in toneCpu.ts (then update this hash)', () => {
    expect(shaderHash([TONE_DOWN8_FS, TONE_BLUR_FS, TONE_LBOX_FS, TONE_FIELD_FS, RETOUCH_FS].join('\n'))).toBe('085ca0a9');
  });
});
