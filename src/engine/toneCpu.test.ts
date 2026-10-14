import { describe, expect, it } from 'vitest';
import { IDENTITY_WIN, TONE_ZERO } from './passes/toneGeometry';
import { shaderHash } from './shaderHash';
import { gaussWeights, lFactor, RETOUCH_FS, sigmaLow, sigmaMid, TONE, TONE_BLUR_FS, TONE_DOWN8_FS, TONE_FIELD_FS, TONE_LBOX_FS } from './shaders/tone';
import { bandOf, fromYcc, LUMA709, makeImg, q8, retouchCpu, retouchPixel, sample, toneFieldCpu, toYcc, type Img } from './toneCpu';

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

describe('tone shaders pin', () => {
  it('is pinned to the shader text and the TONE table: a change must be mirrored in toneCpu.ts (then update this hash)', () => {
    expect(shaderHash([TONE_DOWN8_FS, TONE_BLUR_FS, TONE_LBOX_FS, TONE_FIELD_FS, RETOUCH_FS].join('\n'))).toBe('d0f4c8c3');
  });
});
