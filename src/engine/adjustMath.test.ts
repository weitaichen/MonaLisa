// 調節 maths against the step-2 spec §8.1 list: each item moves the right thing, neutral is exact, every stage is
// continuous at neutral, the curve is monotone under fuzzing, grain is tile-independent, the look is all-or-nothing.
import { describe, expect, it } from 'vitest';
import type { AdjustId } from '../types';
import {
  ADJUST_IDS,
  ADJUST_ONE_WAY,
  adjustRgb,
  adjustUniforms,
  adjustValuesNeutral,
  adjustWanted,
  curveAt,
  curveKnots,
  effectiveAdjust,
  enc,
  frameFor,
  lin,
  luma,
  neutralAdjust as neutralOf,
  offsetToShader,
  seedMix,
  type AdjustFrame,
  type AdjustValues,
} from './adjustMath';
import { lookDef, LOOKS } from './looks';
import { fromDisplay, paramDef, signed } from './params';

const F = frameFor({ width: 1080, height: 1080 });
const MID: [number, number] = [0.5, 0.5];
const U = (values: AdjustValues) => adjustUniforms(values, null, false, F);
/** display units → stored 0..1 value */
const at = (id: AdjustId, d: number) => (ADJUST_ONE_WAY.has(id) ? d / 100 : (d + 50) / 100);
const one = (id: AdjustId, d: number) => U({ [id]: at(id, d) });
const grey = (v: number): [number, number, number] => [v, v, v];
const level = (v: number) => Math.round(v * 255);

describe('neutral', () => {
  it('every value neutral and no look: the 調節 program is off', () => {
    const u = U({});
    expect(u.on).toBe(false);
    expect(u.adjustOn).toBe(false);
    expect(u.lookAmt).toBe(0);
  });

  it('forced on with neutral values, adjustRgb is the exact identity on a 17³ grid', () => {
    const u = { ...U({}), adjustOn: true };
    for (let r = 0; r <= 16; r++)
      for (let g = 0; g <= 16; g++)
        for (let b = 0; b <= 16; b++) {
          const c = [r / 16, g / 16, b / 16];
          expect(adjustRgb(c, u, MID)).toEqual(c);
        }
  });

  it('every stage is continuous at neutral: ±0.1 display unit changes no 8-bit colour by more than 1 level', () => {
    for (const id of ADJUST_IDS)
      for (const d of ADJUST_ONE_WAY.has(id) ? [0.1] : [0.1, -0.1]) {
        const u = one(id, d);
        for (let r = 0; r <= 32; r += 2)
          for (let g = 0; g <= 32; g += 2)
            for (let b = 0; b <= 32; b += 2) {
              const c = [r / 32, g / 32, b / 32];
              for (const uv of [MID, [0.02, 0.03], [0.97, 0.4]] as [number, number][]) {
                const o = adjustRgb(c, u, uv);
                for (let k = 0; k < 3; k++) expect(Math.abs(level(o[k]) - level(c[k])), `${id} ${d}`).toBeLessThanOrEqual(1);
              }
            }
      }
  });
});

describe('each item moves the right thing (±max)', () => {
  it('亮度: mid grey 0.5 → 0.653 / 0.324, black and white fixed', () => {
    expect(adjustRgb(grey(0.5), one('adjust.brightness', 50), MID)[0]).toBeCloseTo(0.653, 2);
    expect(adjustRgb(grey(0.5), one('adjust.brightness', -50), MID)[0]).toBeCloseTo(0.324, 2);
    for (const d of [50, -50]) {
      expect(adjustRgb(grey(0), one('adjust.brightness', d), MID)).toEqual([0, 0, 0]);
      expect(adjustRgb(grey(1), one('adjust.brightness', d), MID)).toEqual([1, 1, 1]);
    }
  });

  it('曝光: ±1 EV on linear 18 % grey (± 1 %), white stays ≤ 1, no jump off 0', () => {
    const g18 = enc(0.18);
    expect(Math.abs(lin(adjustRgb(grey(g18), one('adjust.exposure', 50), MID)[0]) / 0.18 - 2)).toBeLessThan(0.02);
    expect(Math.abs(lin(adjustRgb(grey(g18), one('adjust.exposure', -50), MID)[0]) / 0.18 - 0.5)).toBeLessThan(0.005);
    expect(adjustRgb(grey(1), one('adjust.exposure', 50), MID)[0]).toBeLessThanOrEqual(1);
    const tiny = U({ 'adjust.exposure': 0.5 + 0.0005 }); // s = 0.001
    for (let i = 0; i <= 255; i++) expect(Math.abs(adjustRgb(grey(i / 255), tiny, MID)[0] - i / 255)).toBeLessThan(0.002);
  });

  it('對比: + widens the 10–90 % spread, − narrows it, 0.5 fixed', () => {
    const spread = (d: number) =>
      adjustRgb(grey(0.9), one('adjust.contrast', d), MID)[0] - adjustRgb(grey(0.1), one('adjust.contrast', d), MID)[0];
    expect(spread(50)).toBeGreaterThan(0.85);
    expect(spread(-50)).toBeLessThan(0.75);
    expect(adjustRgb(grey(0.5), one('adjust.contrast', 50), MID)[0]).toBeCloseTo(0.5, 9);
  });

  it('高光 moves Y > 0.6 at least 4× more than Y < 0.3; 陰影 the reverse', () => {
    const moves = (id: AdjustId) => {
      let hi = 0;
      let nh = 0;
      let lo = 0;
      let nl = 0;
      for (let i = 0; i <= 255; i++) {
        const y = i / 255;
        const d = Math.abs(adjustRgb(grey(y), one(id, 50), MID)[0] - y);
        if (y > 0.6) {
          hi += d;
          nh++;
        }
        if (y < 0.3) {
          lo += d;
          nl++;
        }
      }
      return { hi: hi / nh, lo: lo / nl };
    };
    const h = moves('adjust.highlights');
    expect(h.hi).toBeGreaterThan(4 * h.lo);
    const s = moves('adjust.shadows');
    expect(s.lo).toBeGreaterThan(4 * s.hi);
  });

  it('色溫 + warms grey (R/B up) at constant luminance, − cools; 色調 + is magenta', () => {
    const L = (c: number[]) => luma(c.map(lin));
    const warm = adjustRgb(grey(0.5), one('adjust.temperature', 50), MID);
    const cool = adjustRgb(grey(0.5), one('adjust.temperature', -50), MID);
    expect(warm[0] / warm[2]).toBeGreaterThan(1.1);
    expect(cool[0] / cool[2]).toBeLessThan(0.9);
    expect(Math.abs(L(warm) / L(grey(0.5)) - 1)).toBeLessThan(0.01);
    const t = adjustRgb(grey(0.5), one('adjust.tint', 50), MID);
    expect(t[1] / (t[0] + t[2])).toBeLessThan(0.48);
  });

  it('飽和: −50 is black and white; +50 raises the chroma of a 70 %-saturated colour without clipping it', () => {
    const c = [0.5, 0.3, 0.15];
    const bw = adjustRgb(c, one('adjust.saturation', -50), MID);
    expect(bw[0]).toBeCloseTo(bw[1], 9);
    expect(bw[1]).toBeCloseTo(bw[2], 9);
    const sat = adjustRgb(c, one('adjust.saturation', 50), MID);
    for (const v of sat) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
    }
    expect(Math.max(...sat) - Math.min(...sat)).toBeGreaterThan(0.35 * 1.5);
  });

  it('鮮艷度 +: a muted blue gains more than a vivid red; a skin patch gains at most half of a non-skin hue of equal S and V', () => {
    const u = one('adjust.vibrance', 50);
    const chroma = (c: number[]) => Math.max(...c) - Math.min(...c);
    const gain = (c: number[]) => chroma(adjustRgb(c, u, MID)) / chroma(c) - 1;
    expect(gain([0.4, 0.45, 0.55])).toBeGreaterThan(gain([0.9, 0.2, 0.2]));
    expect(gain([0.8, 0.6, 0.5])).toBeLessThanOrEqual(0.5 * gain([0.5, 0.65, 0.8]));
    expect(gain([0.8, 0.6, 0.5])).toBeGreaterThan(0);
  });

  it('褪色 100: black → 41 ± 1, white → 245 ± 1 (/255)', () => {
    for (const v of adjustRgb(grey(0), one('adjust.fade', 100), MID)) expect(Math.abs(v * 255 - 41)).toBeLessThanOrEqual(1);
    for (const v of adjustRgb(grey(1), one('adjust.fade', 100), MID)) expect(Math.abs(v * 255 - 245)).toBeLessThanOrEqual(1);
  });

  it('暗角 100: the corner × 0.3^(1/2.2) ± 0.5 %, the centre untouched, symmetric, aspect-aware', () => {
    const u = one('adjust.vignette', 100);
    const k = 0.3 ** (1 / 2.2);
    for (const uv of [[0, 0], [1, 0], [0, 1], [1, 1]] as [number, number][])
      expect(Math.abs(adjustRgb(grey(0.6), u, uv)[0] / 0.6 / k - 1)).toBeLessThan(0.005);
    expect(adjustRgb(grey(0.6), u, MID)[0]).toBe(0.6);
    const wide = adjustUniforms({ 'adjust.vignette': 1 }, null, false, frameFor({ width: 2000, height: 1000 }));
    // the middle of the right edge of a 2:1 frame lies nearer its corner radius than in a square frame
    expect(adjustRgb(grey(0.6), wide, [1, 0.5])[0]).toBeLessThan(adjustRgb(grey(0.6), u, [1, 0.5])[0]);
  });
});

describe('tone curve fuzz', () => {
  it('2000 random (亮度, 對比, 高光, 陰影): knots non-decreasing, f(0) = 0, f(1) = 1, samples monotone, finite, in [0, 1]', () => {
    let s = 1;
    const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32) * 2 - 1;
    for (let k = 0; k < 2000; k++) {
      const kn = curveKnots(rnd(), rnd(), rnd(), rnd());
      expect(kn.y[0]).toBe(0);
      expect(kn.y[8]).toBe(1);
      for (let i = 1; i < 9; i++) expect(kn.y[i]).toBeGreaterThanOrEqual(kn.y[i - 1]);
      let prev = 0;
      for (let j = 0; j <= 1000; j++) {
        const v = curveAt(kn, j / 1000);
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
        expect(v).toBeLessThanOrEqual(1);
        prev = v;
      }
    }
  }, 120_000);

  it('extreme combinations (對比 +50, 陰影 −50, 曝光 −50, 飽和 +50, 鮮艷度 +50) stay finite and in range', () => {
    const u = U({ 'adjust.contrast': 1, 'adjust.shadows': 0, 'adjust.exposure': 0, 'adjust.saturation': 1, 'adjust.vibrance': 1 });
    for (let i = 0; i <= 64; i++) for (const v of adjustRgb([i / 64, 1 - i / 64, 0.3], u, MID)) expect(v >= 0 && v <= 1).toBe(true);
  });
});

describe('effective values and the look (step-2 spec §4.3)', () => {
  const film = lookDef('film')!;

  it('user value + amount × offset in shader space, clamped per item', () => {
    const e = effectiveAdjust({ 'adjust.fade': 0.9, 'adjust.contrast': 0.5 }, film, 0.8);
    expect(e['adjust.fade']).toBe(1); // 0.9 + 0.8·30/100 → clamped
    expect(e['adjust.contrast']).toBeCloseTo(0.8 * (-10 / 50), 12);
    expect(e['adjust.grain']).toBeCloseTo(0.8 * 0.35, 12);
    expect(effectiveAdjust({}, film, 0)['adjust.grain']).toBe(0);
    expect(effectiveAdjust({ 'adjust.exposure': Number.NaN }, null, 1)['adjust.exposure']).toBe(0);
  });

  it('offsetToShader matches the slider mapping: display d → shader value of fromDisplay(d)', () => {
    for (const id of ['adjust.exposure', 'adjust.fade'] as const) {
      const def = paramDef(id);
      for (let d = def.bidirectional ? -50 : 0; d <= (def.bidirectional ? 50 : 100); d++) {
        const v = fromDisplay(def, d);
        expect(offsetToShader(def, d)).toBeCloseTo(def.bidirectional ? signed(v) : v, 12);
      }
    }
  });

  it('effectiveAdjust adds offsetToShader of amount × offset for every look and item (one mapping; ADJUST_ONE_WAY is the one-way ParamDefs)', () => {
    for (const id of ADJUST_IDS) expect(ADJUST_ONE_WAY.has(id), id).toBe(!paramDef(id).bidirectional);
    for (const look of LOOKS)
      for (const amount of [0.3, 0.8, 1]) {
        const e = effectiveAdjust({}, look, amount);
        for (const id of ADJUST_IDS) {
          const o = offsetToShader(paramDef(id), amount * (look.offsets[id] ?? 0));
          const want = ADJUST_ONE_WAY.has(id) ? Math.min(1, Math.max(0, o)) : Math.min(1, Math.max(-1, o));
          expect(e[id], `${look.id} ${amount} ${id}`).toBeCloseTo(want, 12);
        }
      }
  });

  it('lookReady = false ignores the look entirely (no LUT, no offsets)', () => {
    const u = adjustUniforms({}, { def: film, amount: 0.8 }, false, F);
    expect(u.on).toBe(false);
    expect(u.lookAmt).toBe(0);
    expect(u.grain[0]).toBe(0);
  });

  it('a resident look draws its LUT mix and its offsets', () => {
    const u = adjustUniforms({}, { def: film, amount: 0.8 }, true, F);
    expect(u.on).toBe(true);
    expect(u.adjustOn).toBe(true);
    expect(u.lookAmt).toBe(0.8);
    expect(u.grain[0]).toBeGreaterThan(0);
    expect(u.fade[0]).toBeGreaterThan(0);
  });

  it('on is false exactly when every effective value is neutral and no look is drawn', () => {
    expect(adjustUniforms({}, { def: film, amount: 0 }, true, F).on).toBe(false);
    expect(U({ 'adjust.vibrance': 0.51 }).on).toBe(true);
    expect(U({ 'adjust.vignette': 0.01 }).on).toBe(true);
  });

  it('adjustValuesNeutral is exactly "no look drawn → on is false", near neutral, at the ends and on junk', () => {
    const near = [0, 1e-5, 5e-5, 1e-4, 1.5e-4, 0.01];
    const raws: unknown[] = [undefined, NaN, Infinity, -Infinity, -1, 2, 0, 1, 0.3, ...near, ...near.map((d) => 0.5 + d), ...near.map((d) => 0.5 - d)];
    for (const id of ADJUST_IDS) {
      for (const raw of raws) {
        const values = { [id]: raw } as AdjustValues;
        expect(adjustValuesNeutral(values), `${id} = ${String(raw)}`).toBe(!U(values).on);
      }
    }
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    for (let k = 0; k < 500; k++) {
      const values: Record<string, number> = {};
      for (const id of ADJUST_IDS) if (rnd() < 0.3) values[id] = rnd() < 0.5 ? neutralOf(id) + (rnd() - 0.5) * 4e-4 : rnd();
      expect(adjustValuesNeutral(values)).toBe(!U(values).on);
    }
  });

  it('the curve uniform while the curve is off is curveKnots(0, 0, 0, 0)', () => {
    const k = curveKnots(0, 0, 0, 0);
    const u = U({ 'adjust.vignette': 1 });
    expect(u.curveOn).toBe(false);
    expect(u.curve).toEqual(k.y.flatMap((y, i) => [y, k.m[i] / 8]));
    // each frame gets its own array: a caller that edits one changes no other frame
    expect(U({ 'adjust.vignette': 1 }).curve).not.toBe(u.curve);
  });

  it('adjustWanted: any non-neutral user value, or any look (resident or not)', () => {
    expect(adjustWanted({}, null)).toBe(false);
    expect(adjustWanted({ 'adjust.tint': 0.5, 'adjust.grain': 0 }, null)).toBe(false);
    expect(adjustWanted({ 'adjust.grain': 0.2 }, null)).toBe(true);
    expect(adjustWanted({}, { id: 'ccd' })).toBe(true);
  });
});

describe('picture frame and grain size (step-2 spec §4.4–4.5)', () => {
  it('frameFor: the whole source by default, a camera ratio crop, degenerate rects fall back to the whole source', () => {
    expect(frameFor({ width: 2048, height: 1536 })).toEqual({ vMap: [1, 1, 0, 0], vSize: [2048, 1536], fullShortEdge: 1536, seed: 0 });
    const crop = frameFor({ width: 1280, height: 720 }, { x: 0.25, y: 0, w: 0.5, h: 1 }, 9);
    expect(crop.vMap).toEqual([2, 1, -0.5, 0]);
    expect(crop.vSize).toEqual([640, 720]);
    expect(crop.seed).toBe(9);
    for (const bad of [{ x: 0, y: 0, w: 0, h: 1 }, { x: Number.NaN, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 1, h: -1 }, null, undefined])
      expect(frameFor({ width: 640, height: 480 }, bad).vMap).toEqual([1, 1, 0, 0]);
    expect(frameFor({ width: 0, height: 0 }).vSize).toEqual([1, 1]);
    const u = adjustUniforms({ 'adjust.vignette': 1, 'adjust.grain': 1 }, null, false, frameFor({ width: 0, height: 0 }, { x: 0, y: 0, w: 0, h: 0 }));
    for (const v of adjustRgb(grey(0.5), u, [0.3, 0.7])) expect(Number.isFinite(v)).toBe(true);
  });

  it('grain cells follow fullShortEdge (1 px at 1080) and damp below 1 px per cell; thumbnails use 1 px cells at 0.6', () => {
    const at1080 = adjustUniforms({ 'adjust.grain': 1 }, null, false, frameFor({ width: 1080, height: 1920 }));
    expect(at1080.grainScale).toEqual([1080, 1920]);
    expect(at1080.grain[0]).toBeCloseTo(0.08, 12);
    const preview = adjustUniforms({ 'adjust.grain': 1 }, null, false, frameFor({ width: 2048, height: 1536 }));
    expect(preview.grainScale[0]).toBeCloseTo(2048 / (1536 / 1080), 9);
    const tierL = adjustUniforms({ 'adjust.grain': 1 }, null, false, frameFor({ width: 540, height: 960 }));
    expect(tierL.grain[0]).toBeCloseTo(0.08 * 0.5, 12);
    const thumb = adjustUniforms({ 'adjust.grain': 1 }, null, false, { ...frameFor({ width: 96, height: 96 }), thumb: true });
    expect(thumb.grainScale).toEqual([96, 96]);
    expect(thumb.grain[0]).toBeCloseTo(0.08 * 0.6, 12);
    expect(adjustUniforms({}, null, false, frameFor({ width: 8, height: 8 }, null, 5)).seedMix).toBe(seedMix(5));
  });

  it('grain std on flat grey is proportional to 顆粒 (within 5 %)', () => {
    const std = (v: number) => {
      const u = U({ 'adjust.grain': v });
      let s1 = 0;
      let s2 = 0;
      let n = 0;
      for (let y = 0; y < 256; y++)
        for (let x = 0; x < 256; x++) {
          const o = adjustRgb(grey(0.5), u, [(x + 0.5) / 1080, (y + 0.5) / 1080])[0];
          s1 += o;
          s2 += o * o;
          n++;
        }
      return Math.sqrt(s2 / n - (s1 / n) ** 2);
    };
    expect(Math.abs(std(1) / std(0.5) - 2)).toBeLessThan(0.1);
  });

  it('tile independence: a 64×64 region through two different windows gives the same grain and vignette', () => {
    const W = 4032;
    const H = 3024;
    const whole: AdjustFrame = { vMap: [1, 1, 0, 0], vSize: [W, H], fullShortEdge: H, seed: 0 };
    const [x0, y0, tw, th] = [1024, 512, 1024, 1024];
    const tile: AdjustFrame = { vMap: [tw / W, th / H, x0 / W, y0 / H], vSize: [W, H], fullShortEdge: H, seed: 0 };
    const vals = { 'adjust.grain': 1, 'adjust.vignette': 0.6 };
    const a = adjustUniforms(vals, null, false, whole);
    const b = adjustUniforms(vals, null, false, tile);
    for (let j = 0; j < 64; j++)
      for (let i = 0; i < 64; i++) {
        const ga = adjustRgb(grey(0.5), a, [(x0 + 100 + i + 0.5) / W, (y0 + 200 + j + 0.5) / H]);
        const gb = adjustRgb(grey(0.5), b, [(100 + i + 0.5) / tw, (200 + j + 0.5) / th]);
        expect(Math.abs(ga[0] - gb[0])).toBeLessThan(1e-6);
      }
  });
});
