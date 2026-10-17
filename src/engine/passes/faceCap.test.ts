import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { adapt } from '../../tracking/adapter111';
import { applyPreset, setParam } from '../params';
import { EMPTY_BOX, reshapeGeometry, reshapeUniforms } from './reshape';
import { attenuate, capBox, capsFor, FT, influenceBox, ovalBox, boxCentre, packFaceTable, uMaxBox, WHOLE } from './faceCap';
import { reshapeMapMulti } from './reshapeCpu';
import { syntheticPortrait } from '../../body/synthetic';
import { buildFaceProtect } from '../../tracking/faceProtect';

const lm = JSON.parse(readFileSync(new URL('../../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8'));
const face = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
const aspect = lm.width / lm.height;
const max = reshapeUniforms(['shape.faceSlim', 'shape.eyeEnlarge'].reduce((p, id) => setParam(p, id as never, 1), applyPreset('original', 1)).values, 1);

describe('capsFor (S §4.1)', () => {
  it('half the iso distance to the nearest other face or obstacle; −1 without a neighbour', () => {
    expect(capsFor([[0.5, 0.5]], [], 1)).toEqual([-1]);
    // (0.6 − 0.2 is 0.39999999999999997 in doubles: compare closely, never exactly)
    const two = capsFor([[0.2, 0.5], [0.6, 0.5]], [], 1);
    expect(two).toHaveLength(2);
    for (const c of two) expect(c).toBeCloseTo(0.2, 12);
    expect(capsFor([[0.2, 0.5]], [[0.3, 0.5]], 1)[0]).toBeCloseTo(0.05);
  });
  it('presence divides a neighbour’s distance; presence 0 ignores it', () => {
    expect(capsFor([[0.2, 0.5], [0.6, 0.5]], [], 1, [1, 0.5])[0]).toBeCloseTo(0.4);
    expect(capsFor([[0.2, 0.5], [0.6, 0.5]], [], 1, [1, 0])[0]).toBe(-1);
  });
  it('iso units: a 3:1 panorama and a 1:3 screenshot (Review Focus #5)', () => {
    expect(capsFor([[0.1, 0.5], [0.2, 0.5]], [], 3)[0]).toBeCloseTo(0.05);
    expect(capsFor([[0.5, 0.1], [0.5, 0.4]], [], 3)[0]).toBeCloseTo(0.05); // dy 0.3 UV = 0.1 iso
    expect(capsFor([[0.5, 0.1], [0.5, 0.4]], [], 1 / 3)[0]).toBeCloseTo(0.45);
    // the iso disc of radius 0.1 is 0.1 wide in u and 0.1 · 3 tall in v
    const b = capBox([0.05, 0.5], 0.1, 3);
    [0.05 - 0.1, 0.5 - 0.3, 0.05 + 0.1, 0.5 + 0.3].forEach((want, i) => expect(b[i]).toBeCloseTo(want, 12));
    // … and 0.1 / 3 tall in v on a 1:3 screenshot
    const s = capBox([0.5, 0.05], 0.1, 1 / 3);
    [0.4, 0.05 - 0.1 / 3, 0.6, 0.05 + 0.1 / 3].forEach((want, i) => expect(s[i]).toBeCloseTo(want, 12));
  });
});

describe('face table packing (S §4.4)', () => {
  const t = { face, u: attenuate(max, face.yaw), layer: 0, window: WHOLE, centre: boxCentre(ovalBox(face)), cap: -1 };
  it('rows of 96 texels: pts111, ext, targets, strengths, radii, protect, box, cap, window', () => {
    const out = new Float32Array(FT.ROW * 4 * 2);
    packFaceTable([t, { ...t, u: reshapeUniforms(applyPreset('original', 1).values, 1), cap: 0.1 }], aspect, out);
    expect(Array.from(out.subarray(0, 222))).toEqual(Array.from(face.pts111));
    expect(Array.from(out.subarray(FT.EXT * 4, FT.EXT * 4 + 16))).toEqual(Array.from(face.ext));
    const g = reshapeGeometry(face, aspect, t.u);
    expect(out[FT.S1 * 4]).toBe(Math.fround(t.u.faceSlim));
    expect(out[FT.S2 * 4 + 3]).toBe(Math.fround(t.u.eyeEnlarge));
    expect(out[FT.RADII * 4 + 3]).toBe(0);
    expect(Array.from(out.subarray(FT.BOX * 4, FT.BOX * 4 + 4))).toEqual(g.box.map(Math.fround));
    expect(out[FT.CAP * 4 + 2]).toBe(-1);
    expect(Array.from(out.subarray(FT.WIN * 4, FT.WIN * 4 + 4))).toEqual([0, 0, 1, 1]);
    const row = FT.ROW * 4;
    expect(Array.from(out.subarray(row + FT.BOX * 4, row + FT.BOX * 4 + 4))).toEqual(EMPTY_BOX.map(Math.fround)); // not drawn
    expect(out[row + FT.CAP * 4 + 2]).toBe(Math.fround(0.1));
  });
  it('a capped face’s influence box is clipped to its cap disc; uMaxBox covers every item at its maximum', () => {
    const c = t.centre;
    // the aspect enters through the y bounds (Review Focus #5): the photo's own, a 3:1 panorama and a 1:3 screenshot
    for (const a of [aspect, 3, 1 / 3]) {
      const capped = influenceBox({ ...t, cap: 0.02 }, a);
      expect(capped[0], `aspect ${a}`).toBeGreaterThanOrEqual(c[0] - 0.02 - 1e-9);
      expect(capped[2], `aspect ${a}`).toBeLessThanOrEqual(c[0] + 0.02 + 1e-9);
      expect(capped[1], `aspect ${a}`).toBeGreaterThanOrEqual(c[1] - 0.02 * a - 1e-9);
      expect(capped[3], `aspect ${a}`).toBeLessThanOrEqual(c[1] + 0.02 * a + 1e-9);
      // the warp box reaches past the small disc on every side, so the clip is the disc's box itself
      capBox(c, 0.02, a).forEach((want, i) => expect(capped[i], `aspect ${a} [${i}]`).toBeCloseTo(want, 12));
    }
    const um = uMaxBox(face, aspect);
    const g = reshapeGeometry(face, aspect, t.u).box;
    expect(um[0]).toBeLessThanOrEqual(g[0]);
    expect(um[3]).toBeGreaterThanOrEqual(g[3]);
  });
});

describe('the protect window (texel 74, S §4.4, §4.7)', () => {
  it('a per-face window packs as x0, y0, 1/w, 1/h', () => {
    const out = new Float32Array(FT.ROW * 4);
    const t = { face, u: attenuate(max, face.yaw), layer: 0, window: { x: 0.2, y: 0.3, w: 0.5, h: 0.25 }, centre: boxCentre(ovalBox(face)), cap: 0.1 };
    packFaceTable([t], aspect, out);
    expect(Array.from(out.subarray(FT.WIN * 4, FT.WIN * 4 + 4))).toEqual([Math.fround(0.2), Math.fround(0.3), 2, 4]);
  });
  it('the CPU port reads a windowed layer at (tc0 − xy) / wh: the same limit as the whole-photo grid it was cut from', () => {
    // a whole-photo limit, and its texels i0…i0+nw, j0…j0+nh as a windowed layer (texel-aligned, so both grids hold the
    // same values at the same photo points); a swapped x / y or a missing reciprocal reads other texels
    const pr = syntheticPortrait();
    const a = pr.width / pr.height;
    const whole = buildFaceProtect(pr.face, null, pr.width, pr.height);
    expect(whole.window).toBeUndefined();
    const W = whole.width;
    const H = whole.height;
    const [i0, j0, nw, nh] = [Math.round(W * 0.1), Math.round(H * 0.15), Math.round(W * 0.8), Math.round(H * 0.6)];
    const data = new Float32Array(nw * nh);
    for (let j = 0; j < nh; j++) data.set(whole.data.subarray((j0 + j) * W + i0, (j0 + j) * W + i0 + nw), j * nw);
    const window = { x: i0 / W, y: j0 / H, w: nw / W, h: nh / H };
    const cut = { width: nw, height: nh, data, version: 1, window };
    const u = attenuate(reshapeUniforms(['shape.faceSlim', 'shape.faceV', 'shape.faceNarrow'].reduce((p, id) => setParam(p, id as never, 1), applyPreset('original', 1)).values, 1), pr.face.yaw);
    const base = { face: pr.face, u, layer: 0, centre: boxCentre(ovalBox(pr.face)), cap: -1 };
    const fromWhole = reshapeMapMulti([{ ...base, window: WHOLE }], a, { protects: [whole] });
    const fromCut = reshapeMapMulti([{ ...base, window }], a, { protects: [cut] });
    const misread = reshapeMapMulti([{ ...base, window: WHOLE }], a, { protects: [cut] });
    const unlimited = reshapeMapMulti([{ ...base, layer: -1, window: WHOLE }], a);
    // one texel of margin inside the window: the clamp-to-edge rows differ between the two grids, nothing else
    const [mx, my] = [1 / W, 1 / H];
    let n = 0;
    let worst = 0;
    let limited = 0;
    let wrong = 0;
    for (let v = window.y + my; v <= window.y + window.h - my; v += 0.004)
      for (let x = window.x + mx; x <= window.x + window.w - mx; x += 0.004) {
        const p = fromCut(x, v);
        const q = fromWhole(x, v);
        worst = Math.max(worst, Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]));
        const f = unlimited(x, v);
        if (Math.hypot(q[0] - f[0], q[1] - f[1]) > 1e-4) limited++;
        const m = misread(x, v);
        if (Math.hypot(m[0] - q[0], m[1] - q[1]) > 1e-4) wrong++;
        n++;
      }
    expect(n).toBeGreaterThan(10_000);
    expect(worst, 'windowed vs whole-photo grid, UV').toBeLessThan(1e-10);
    expect(limited, 'the limit binds somewhere in the window').toBeGreaterThan(100);
    expect(wrong, 'reading the cut grid as the whole photo goes wrong').toBeGreaterThan(100);
  });
});
