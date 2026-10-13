import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Face, Landmarks478, ParamId } from '../../types';
import { MAX_RENDER_FACES } from '../../config/limits';
import { prepareFaces } from '../../detect/faces';
import { applyPreset, setParam } from '../params';
import { adapt } from '../../tracking/adapter111';
import { apply, glMat3, IDENTITY_GEOMETRY, rotateLeft, vToO } from '../../geometry/view';
import { IDENTITY_VIEW, RESHAPE_FS, reshapeFs, reshapeGeometry, reshapeUniforms } from './reshape';
import { reshapeMapCpu, reshapeMapMulti, withView } from './reshapeCpu';
import { reshapeMapCpuV03 } from './reshapeCpuV03';
import { attenuate, boxCentre, capsFor, influenceBox, ovalBox, WHOLE, type TableFace } from './faceCap';
import type { ReshapeUniforms as RU } from './reshape';
import { MIN_DET } from '../../body/field';
import { syntheticPortrait } from '../../body/synthetic';
import { buildFaceProtect } from '../../tracking/faceProtect';
import { shaderHash } from '../shaderHash';

const PINNED = 'e65a71b2';

const lm = JSON.parse(readFileSync(new URL('../../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
  width: number;
  height: number;
  points: number[];
};
const face = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
const aspect = lm.width / lm.height;
// 原圖 base: every other face slider neutral
const params = (ids: ParamId[]) => ids.reduce((p, id) => setParam(p, id, 1), applyPreset('original', 1)).values;

describe('reshapeMapCpu (CPU port of RESHAPE_FS)', () => {
  it('is pinned to the shader text: a RESHAPE_FS edit must be mirrored in reshapeCpu.ts (then update this hash)', () => {
    // The e2e reshape.spec.ts compares the port with the real shader pixel by pixel; this is the cheap tripwire.
    expect(RESHAPE_FS).toContain('uniform highp sampler2D uFaces');
    expect(reshapeFs('ubo')).toContain('#define FACE_TABLE_UBO');
    // step 3: P2's view uniforms (geometry, tile, window)
    expect(RESHAPE_FS).toContain('uniform mat3 uGeo');
    expect(reshapeFs('ubo')).toContain('uniform vec4 uWin');
    expect(shaderHash(RESHAPE_FS)).toBe(PINNED);
  });

  it('is the identity with no face / all deltas zero, and outside the influence box', () => {
    const u = reshapeUniforms(params(['shape.faceSlim', 'shape.faceV', 'shape.faceNarrow']), 1);
    const map = reshapeMapCpu(face, u, aspect);
    const g = reshapeGeometry(face, aspect, u);
    for (const [x, y] of [
      [0.02, 0.02],
      [g.box[0] - 0.01, 0.5],
      [0.5, g.box[3] + 0.01],
    ])
      expect(map(x, y)).toEqual([x, y]);
    expect(reshapeMapCpu(face, reshapeUniforms(params([]), 1), aspect)(0.5, 0.5)).toEqual([0.5, 0.5]);
    expect(reshapeMapCpu(null, u, aspect)(0.5, 0.5)).toEqual([0.5, 0.5]);
  });

  it('瘦臉 pulls the cheek contour inward: the output samples the source farther out at the cheek', () => {
    const map = reshapeMapCpu(face, reshapeUniforms(params(['shape.faceSlim']), 1), aspect);
    const P = face.pts111;
    const c = [(P[0] + P[64]) / 2, (P[1] + P[65]) / 2];
    for (const i of [7, 25]) {
      const p: [number, number] = [P[i * 2], P[i * 2 + 1]];
      const s = map(p[0], p[1]);
      // backward map: the output pixel at the old contour now shows source farther from the face centre
      expect(Math.hypot(s[0] - c[0], s[1] - c[1])).toBeGreaterThan(Math.hypot(p[0] - c[0], p[1] - c[1]) + 0.005);
    }
  });

  it('applies the body field first (outermost backward map), like the shader', () => {
    const d = Math.fround(0.01);
    const body = { width: 2, height: 2, data: new Float32Array([d, 0, d, 0, d, 0, d, 0]), version: 1 };
    const u = reshapeUniforms(params(['shape.faceSlim']), 1);
    const both = reshapeMapCpu(face, u, aspect, body);
    const faceOnly = reshapeMapCpu(face, u, aspect);
    const a = both(0.5, 0.6);
    const b = faceOnly(0.5 + d, 0.6);
    expect(a[0]).toBeCloseTo(b[0], 12);
    expect(a[1]).toBeCloseTo(b[1], 12);
    expect(Math.abs(b[0] - (0.5 + d))).toBeGreaterThan(1e-4); // the face warp acts there
  });
});

/** the fixture face rescaled to face width `fw` (iso) at centre (cx, cy) on an aspect-1 image, with `yaw` */
function placed(cx: number, cy: number, fw: number, yaw = 0): Face {
  const iso = (a: Float32Array) => {
    const out = new Float32Array(a.length);
    const b = ovalBox(face);
    const c = [b.x + b.w / 2, (b.y + b.h / 2) / aspect];
    const k = fw / Math.hypot(face.pts111[0] - face.pts111[64], (face.pts111[1] - face.pts111[65]) / aspect);
    for (let i = 0; i < a.length; i += 2) {
      out[i] = cx + (a[i] - c[0]) * k;
      out[i + 1] = cy + (a[i + 1] / aspect - c[1]) * k;
    }
    return out;
  };
  return { pts111: iso(face.pts111), ext: iso(face.ext), oval: iso(face.oval), yaw };
}

/**
 * Smallest forward-difference det J of `map` (aspect 1) on a square grid of step `h` (UV) covering `box` padded by one
 * step, each sample mapped once; −∞ on a non-finite value. The fold check of the sweep runs it over every face's
 * influence box (outside them the map is the identity) with h = 0.02 FW: a fold narrower than about 0.2 FW passed the
 * old 41-point grid over the whole layout (steps up to 0.24 FW; Task 16 review).
 */
function minDetGrid(map: (x: number, y: number) => [number, number], box: readonly [number, number, number, number], h: number): number {
  const x0 = box[0] - h;
  const y0 = box[1] - h;
  const nx = Math.ceil((box[2] + h - x0) / h);
  const ny = Math.ceil((box[3] + h - y0) / h);
  let prev: Float64Array | null = null;
  let min = Infinity;
  for (let j = 0; j <= ny; j++) {
    const row = new Float64Array(2 * (nx + 1));
    for (let i = 0; i <= nx; i++) {
      const s = map(x0 + i * h, y0 + j * h);
      if (!Number.isFinite(s[0]) || !Number.isFinite(s[1])) return -Infinity;
      row[2 * i] = s[0];
      row[2 * i + 1] = s[1];
    }
    if (prev)
      for (let i = 0; i < nx; i++) {
        // the cell at (i, j − 1): a = prev[i], +x = prev[i + 1], +y = row[i]
        const ax = prev[2 * i];
        const ay = prev[2 * i + 1];
        const det = ((prev[2 * i + 2] - ax) / h) * ((row[2 * i + 1] - ay) / h) - ((prev[2 * i + 3] - ay) / h) * ((row[2 * i] - ax) / h);
        min = Math.min(min, det);
      }
    prev = row;
  }
  return min;
}

const tf = (f: Face, u: RU, extra: Partial<TableFace> = {}): TableFace => ({ face: f, u: attenuate(u, f.yaw), layer: -1, window: WHOLE, centre: boxCentre(ovalBox(f)), cap: -1, ...extra });

/** the recorded 478 landmarks moved so their bbox is centred at (cx, cy) with width w (UV); lmAt of detect/faces.test.ts */
function lmAt(cx: number, cy: number, w: number): Landmarks478 {
  const p = lm.points;
  let x0 = 1;
  let x1 = 0;
  let y0 = 1;
  let y1 = 0;
  for (let i = 0; i < 478; i++) {
    x0 = Math.min(x0, p[i * 3]);
    x1 = Math.max(x1, p[i * 3]);
    y0 = Math.min(y0, p[i * 3 + 1]);
    y1 = Math.max(y1, p[i * 3 + 1]);
  }
  const s = w / (x1 - x0);
  const out = new Float32Array(478 * 3);
  for (let i = 0; i < 478; i++) {
    out[i * 3] = cx + (p[i * 3] - (x0 + x1) / 2) * s;
    out[i * 3 + 1] = cy + (p[i * 3 + 1] - (y0 + y1) / 2) * s;
    out[i * 3 + 2] = p[i * 3 + 2] * s;
  }
  return { points: out };
}

describe('withView (P2 under geometry and windows, step 3)', () => {
  const u = reshapeUniforms(params(['shape.faceSlim', 'shape.eyeEnlarge']), 1);
  const map = reshapeMapCpu(face, u, aspect);

  it('the identity view is the map itself, exactly', () => {
    const m = withView(map, IDENTITY_VIEW);
    for (const [x, y] of [[0.3, 0.4], [0.51, 0.62], [0.9, 0.1]]) expect(m(x, y)).toEqual(map(x, y));
  });

  it('a geometry view samples the map at Geo⁻¹(v); a window rescales the result', () => {
    const g = rotateLeft(IDENTITY_GEOMETRY);
    const oSize = { width: lm.width, height: lm.height };
    const geo = glMat3(vToO(g, oSize));
    const view = { geo, tile: [0.25, 0.2, 0.5, 0.5] as const, win: [0.1, 0.2, 0.6, 0.5] as const };
    const m = withView(map, view);
    const v: [number, number] = [0.25 + 0.4 * 0.5, 0.2 + 0.7 * 0.5];
    const o = apply(vToO(g, oSize), v);
    const t = map(o[0], o[1]);
    const got = m(0.4, 0.7);
    expect(got[0]).toBeCloseTo((t[0] - 0.1) / 0.6, 6);
    expect(got[1]).toBeCloseTo((t[1] - 0.2) / 0.5, 6);
  });
});

describe('N-face port (S §4.4)', () => {
  it('one face is bit-exact with the frozen v0.3 port, with and without the limit and the body field', () => {
    const pr = syntheticPortrait();
    const prot = buildFaceProtect(pr.face, null, pr.width, pr.height);
    const d = Math.fround(0.01);
    const body = { width: 2, height: 2, data: new Float32Array([d, 0, d, 0, d, 0, d, 0]), version: 1 };
    for (const ids of [['shape.faceSlim', 'shape.faceV'], ['shape.chin', 'shape.eyeEnlarge', 'shape.mouthSize', 'shape.eyeDistance']] as const) {
      const u = reshapeUniforms(params(ids as unknown as ParamId[]), 1);
      for (const [f, a, p, b] of [
        [face, aspect, null, null],
        [pr.face, pr.width / pr.height, prot, null],
        [face, aspect, null, body],
      ] as const) {
        const now = reshapeMapCpu(f, u, a, b, p);
        const then = reshapeMapCpuV03(f, u, a, b, p);
        for (let y = 0.02; y < 1; y += 0.024) for (let x = 0.02; x < 1; x += 0.024) expect(now(x, y)).toEqual(then(x, y));
      }
    }
  });
  it('two faces: the sum of each face alone with its cap (obstacle at the other centre)', () => {
    const u = reshapeUniforms(params(['shape.faceSlim', 'shape.faceV', 'shape.eyeEnlarge']), 1);
    const A = placed(0.3, 0.5, 0.12);
    const B = placed(0.48, 0.5, 0.12);
    const cap = Math.hypot(0.18, 0) / 2;
    const both = reshapeMapMulti([tf(A, u, { cap }), tf(B, u, { cap })], 1);
    const a = reshapeMapMulti([tf(A, u, { cap })], 1);
    const b = reshapeMapMulti([tf(B, u, { cap })], 1);
    for (let y = 0.3; y < 0.7; y += 0.013)
      for (let x = 0.15; x < 0.65; x += 0.013) {
        const s = both(x, y);
        const ea = a(x, y);
        const eb = b(x, y);
        expect(s[0]).toBeCloseTo(ea[0] + eb[0] - x, 12);
        expect(s[1]).toBeCloseTo(ea[1] + eb[1] - y, 12);
      }
  });
  // Strength: the radius-cap trade-off measured at Task 16, ACCEPTED on 2026-10-13 (spec §4.4; the cap is unchanged).
  // The binding measure is the plan's 8 pts111 landmarks (72, 73, 75, 76 on the eyes, 46, 47 on the nose, 98, 102 on
  // the mouth): their mean |displacement| with the neighbours over the same face's alone. With 瘦臉 / V臉 / 窄臉 at max the
  // contour warps carry the mouth about 0.10 FW, more than the cap budget holds 0.33 FW from the box centre at 1.2 FW
  // spacing (cap 0.6 FW: B = 0.45 · (0.27 − 0.3 · 0.6) ≈ 0.081 FW), so the mean keeps 0.838 at 1.2 FW (the mouth
  // landmarks 0.61–0.71; the mouth slider and 下巴 alone keep ≥ 0.99), 0.918 at 1.3 and 0.969 at 1.4: ≥ 0.9 from 1.3 FW,
  // and 1.2 FW is pinned at ≥ 0.8 so the trade cannot get worse unnoticed. (For reference only, not asserted: the mean
  // over the featurePolys interiors of faceProtect.test.ts, pooled, keeps 0.722 at 1.2 FW, 0.805 at 1.3, 0.875 at 1.4
  // and 0.932 at 1.5; the mouth polygon alone 0.564 at 1.2.) 下巴 and 額頭 at the chin point pts111[16] and the forehead
  // point ext[0] with the sweep's combined settings: 額頭 keeps ≥ 0.998 from 1.8 FW (pinned ≥ 0.9 from 2.0 FW); 下巴
  // keeps 0.708 at 2.0 FW, 0.837 at 2.1 and 0.939 at 2.2 (the contour items carry the chin point about 0.15 FW; the 下巴
  // slider alone keeps ≥ 0.995 from 1.8 FW): ≥ 0.9 from 2.2 FW, pinned ≥ 0.7 at 2.0–2.1 FW. The fold bound is never
  // relaxed.
  it('fold and strength sweep (accepted radius-cap trade-off, S §4.4): min det J ≥ MIN_DET on a 0.02 FW grid; the 8 eye / nose / mouth landmarks keep ≥ 0.9 from 1.3 FW (≥ 0.8 at 1.2 FW, measured 0.838); 額頭 ≥ 0.9 from 2.0 FW; 下巴 ≥ 0.9 from 2.2 FW (≥ 0.7 at 2.0 FW, measured 0.708)', () => {
    const FW = 0.12;
    const oneWay: ParamId[] = ['shape.eyeEnlarge', 'shape.faceSlim', 'shape.faceV', 'shape.faceNarrow', 'shape.noseSlim'];
    const bi: ParamId[] = ['shape.chin', 'shape.forehead', 'shape.mouthSize', 'shape.eyeDistance'];
    const settings = [0, 1].map((end) => reshapeUniforms(bi.reduce((p, id) => setParam(p, id, end), oneWay.reduce((p, id) => setParam(p, id, 1), applyPreset('original', 1))).values, 1));
    const featureMean = (map: (x: number, y: number) => [number, number], f: Face) => {
      const P = f.pts111;
      let s = 0;
      for (const k of [72, 73, 75, 76, 46, 47, 98, 102]) s += Math.hypot(...(map(P[k * 2], P[k * 2 + 1]).map((v, i) => v - P[k * 2 + i]) as [number, number]));
      return s / 8;
    };
    const moved = (map: (x: number, y: number) => [number, number], x: number, y: number) => {
      const s = map(x, y);
      return Math.hypot(s[0] - x, s[1] - y);
    };
    // 0.02 FW (0.0024 UV): worst 0.503 (3 faces 1.0 FW apart at 0°). A one-off run at 0.0125 FW (0.0015 UV, the Task 16
    // review's grid) found 0.478 (2 faces 1.0 FW apart at 0°) but took 2.5× as long (23 s alone, about 48 s in the suite)
    const FOLD_STEP = 0.02 * FW;
    let worst = Infinity;
    let worstAt = '';
    let featureWorst12 = Infinity;
    let featureWorst13 = Infinity;
    let chinWorst = Infinity;
    let foreheadWorst = Infinity;
    for (const u of settings)
      for (const yaw of [0, 0.3])
        for (const deg of [0, 45, 90])
          for (const count of [2, 3])
            for (let dFW = 0.6; dFW <= 2.6001; dFW += 0.1) {
              const dx = Math.cos((deg * Math.PI) / 180) * dFW * FW;
              const dy = Math.sin((deg * Math.PI) / 180) * dFW * FW;
              const faces = Array.from({ length: count }, (_, i) => placed(0.5 + (i - (count - 1) / 2) * dx, 0.5 + (i - (count - 1) / 2) * dy, FW, yaw));
              const centres = faces.map((f) => boxCentre(ovalBox(f)));
              const caps = capsFor(centres, [], 1);
              const table = faces.map((f, i) => tf(f, u, { cap: caps[i] }));
              const map = reshapeMapMulti(table, 1);
              // the fold check: every face's influence box on the fine grid (outside the boxes the map is the identity)
              let m = Infinity;
              for (const t of table) {
                const box = influenceBox(t, 1);
                if (box[0] <= box[2]) m = Math.min(m, minDetGrid(map, box, FOLD_STEP));
              }
              if (m < worst) {
                worst = m;
                worstAt = `${count} faces ${dFW.toFixed(1)} FW ${deg}° yaw ${yaw} end ${settings.indexOf(u)}`;
              }
              expect(m, `${count} faces ${dFW.toFixed(1)} FW ${deg}° yaw ${yaw}`).toBeGreaterThanOrEqual(MIN_DET);
              if (dFW >= 1.2 - 1e-9) {
                const alone = reshapeMapMulti([tf(faces[0], u)], 1);
                const kept = featureMean(map, faces[0]) / featureMean(alone, faces[0]);
                if (dFW >= 1.3 - 1e-9) featureWorst13 = Math.min(featureWorst13, kept);
                else featureWorst12 = Math.min(featureWorst12, kept);
                expect(kept, `${count} faces ${dFW.toFixed(1)} FW ${deg}° yaw ${yaw}`).toBeGreaterThanOrEqual(dFW >= 1.3 - 1e-9 ? 0.9 : 0.8);
                if (dFW >= 2.0 - 1e-9) {
                  const P = faces[0].pts111;
                  const E = faces[0].ext;
                  const chin = moved(map, P[32], P[33]) / moved(alone, P[32], P[33]);
                  const forehead = moved(map, E[0], E[1]) / moved(alone, E[0], E[1]);
                  chinWorst = Math.min(chinWorst, chin);
                  foreheadWorst = Math.min(foreheadWorst, forehead);
                  expect(forehead, `額頭 ${count} faces ${dFW.toFixed(1)} FW ${deg}° yaw ${yaw}`).toBeGreaterThanOrEqual(0.9);
                  expect(chin, `下巴 ${count} faces ${dFW.toFixed(1)} FW ${deg}° yaw ${yaw}`).toBeGreaterThanOrEqual(dFW >= 2.2 - 1e-9 ? 0.9 : 0.7);
                }
              }
            }
    console.log(
      `sweep worst min det J ${worst.toFixed(3)} (${worstAt}; grid step ${FOLD_STEP / FW} FW over each influence box); ` +
        `the 8 landmarks keep ≥ ${featureWorst12.toFixed(3)} at 1.2 FW, ≥ ${featureWorst13.toFixed(3)} from 1.3 FW; ` +
        `at ≥ 2.0 FW 下巴 keeps ≥ ${chinWorst.toFixed(3)}, 額頭 ≥ ${foreheadWorst.toFixed(3)}`,
    );
  }, 180_000);
  // The fold bound alone does not need the cap here: with the cap off, the 4-item setting with 2 faces at 0° still keeps
  // min det J 0.367 at 0.3 FW and 0.459 at 0.5 FW (≥ MIN_DET). What the cap is for is pinned on a fine grid: each face's
  // displacement is exactly 0 outside its disc, the map is the identity outside every disc, and no output point samples
  // the source across the line halfway to another face (nearest-centre cell). With the cap off, every case below has
  // 51–1519 grid points crossing that line and 11 000–17 000 moving outside the discs; a budget reaching only 1.05 cap_f
  // already moves points outside the disc while det J stays ≥ MIN_DET (measured at the Task 16 review).
  it('touching faces (0.3 and 0.5 FW apart) stay finite and fold-free, and neither face is pulled into the other (Review Focus #1)', () => {
    const FW = 0.12;
    const oneWay: ParamId[] = ['shape.eyeEnlarge', 'shape.faceSlim', 'shape.faceV', 'shape.faceNarrow', 'shape.noseSlim'];
    const bi: ParamId[] = ['shape.chin', 'shape.forehead', 'shape.mouthSize', 'shape.eyeDistance'];
    const settings = [
      reshapeUniforms(params(['shape.faceSlim', 'shape.faceV', 'shape.eyeEnlarge', 'shape.chin']), 1),
      // the sweep's: every one-way item at max with each end of the bidirectional ones
      ...[0, 1].map((end) => reshapeUniforms(bi.reduce((p, id) => setParam(p, id, end), oneWay.reduce((p, id) => setParam(p, id, 1), applyPreset('original', 1))).values, 1)),
    ];
    const iso = (x: number, y: number, c: readonly [number, number]) => Math.hypot(x - c[0], y - c[1]); // aspect 1
    for (const [k, u] of settings.entries())
      for (const deg of [0, 45, 90])
        for (const count of [2, 3])
          for (const d of [0.3, 0.5]) {
            const tag = `setting ${k}, ${count} faces ${d} FW ${deg}°`;
            const dx = Math.cos((deg * Math.PI) / 180) * d * FW;
            const dy = Math.sin((deg * Math.PI) / 180) * d * FW;
            const faces = Array.from({ length: count }, (_, i) => placed(0.5 + (i - (count - 1) / 2) * dx, 0.5 + (i - (count - 1) / 2) * dy, FW));
            const centres = faces.map((f) => boxCentre(ovalBox(f)));
            const caps = capsFor(centres, [], 1);
            for (const c of caps) expect(c, tag).toBeCloseTo((d * FW) / 2, 3);
            const map = reshapeMapMulti(faces.map((f, i) => tf(f, u, { cap: caps[i] })), 1);
            const alone = faces.map((f, i) => reshapeMapMulti([tf(f, u, { cap: caps[i] })], 1));
            expect(minDetGrid(map, [0.3, 0.3, 0.7, 0.7], 0.0125 * FW), tag).toBeGreaterThanOrEqual(MIN_DET);
            const cell = (x: number, y: number) => {
              let best = 0;
              for (let f = 1; f < count; f++) if (iso(x, y, centres[f]) < iso(x, y, centres[best])) best = f;
              return best;
            };
            let nonFinite = 0;
            let crossed = 0;
            let leaked = 0;
            let outsideMoved = 0;
            let insideMoved = 0;
            for (let j = 0; j <= 200; j++)
              for (let i = 0; i <= 200; i++) {
                const x = 0.3 + i * 0.002;
                const y = 0.3 + j * 0.002;
                const s = map(x, y);
                if (!Number.isFinite(s[0]) || !Number.isFinite(s[1])) nonFinite++;
                if (cell(s[0], s[1]) !== cell(x, y)) crossed++;
                let covered = false;
                for (let f = 0; f < count; f++) {
                  if (iso(x, y, centres[f]) < caps[f]) {
                    covered = true;
                    continue;
                  }
                  const a = alone[f](x, y);
                  if (a[0] !== x || a[1] !== y) leaked++;
                }
                if (s[0] !== x || s[1] !== y) {
                  if (covered) insideMoved++;
                  else outsideMoved++;
                }
              }
            expect(nonFinite, `${tag}: non-finite samples`).toBe(0);
            expect(crossed, `${tag}: output points sampling across the halfway line`).toBe(0);
            expect(leaked, `${tag}: a face displacing outside its own disc`).toBe(0);
            expect(outsideMoved, `${tag}: points outside every disc that move`).toBe(0);
            expect(insideMoved, `${tag}: the faces still warp`).toBeGreaterThan(0);
          }
  }, 60_000);
  it('an obstacle (a dropped face) that is the nearest neighbour sets the cap', () => {
    const A = placed(0.4, 0.5, 0.12);
    const caps = capsFor([boxCentre(ovalBox(A)), [0.9, 0.5]], [[0.47, 0.5]], 1);
    expect(caps[0]).toBeCloseTo(Math.abs(0.47 - boxCentre(ovalBox(A))[0]) / 2, 6);
  });
  it('7 faces (S §8.1): the one the face cap drops is an obstacle; it sets the cap of the one face it is nearest to, and only that one', () => {
    // six faces in a 3 × 2 grid (0.15 UV across, 0.3 down) and a seventh, smaller one 0.1 UV left of the top-left face:
    // prepareFaces keeps the six largest (MAX_RENDER_FACES) and makes the seventh an obstacle (dropped.overCap)
    const lms = [0.35, 0.5, 0.65].flatMap((x) => [0.35, 0.65].map((y) => lmAt(x, y, 0.1)));
    const prep = prepareFaces([...lms, lmAt(0.25, 0.35, 0.08)], 1000, 1000, MAX_RENDER_FACES);
    expect(prep.faces).toHaveLength(MAX_RENDER_FACES);
    expect(prep.obstacles).toHaveLength(1);
    expect(prep.dropped).toEqual({ tooSmall: 0, overCap: 1 });
    const centres = prep.faces.map((f) => boxCentre(f.box));
    const obstacle = boxCentre(prep.obstacles[0].box);
    const iso = (a: readonly [number, number], b: readonly [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]); // aspect 1
    const near = centres.reduce((best, c, i) => (iso(c, obstacle) < iso(centres[best], obstacle) ? i : best), 0);
    const caps = capsFor(centres, [obstacle], 1);
    const listedOnly = capsFor(centres, [], 1);
    caps.forEach((c, i) => {
      if (i === near) {
        expect(c).toBeCloseTo(iso(centres[i], obstacle) / 2, 12);
        expect(c).toBeLessThan(listedOnly[i] - 0.01);
      } else expect(c, `face ${i}`).toBe(listedOnly[i]); // the obstacle is nobody else's nearest neighbour
    });
    // the map: identical to the map without the obstacle outside the near face's old disc; between its new cap and the
    // old one (where it warped before) it is the identity now, so the dropped face is never pulled
    // every item at its maximum (the sweep's end-1 setting)
    const all = reshapeUniforms(
      params(['shape.eyeEnlarge', 'shape.faceSlim', 'shape.faceV', 'shape.faceNarrow', 'shape.noseSlim', 'shape.chin', 'shape.forehead', 'shape.mouthSize', 'shape.eyeDistance']),
      1,
    );
    const tableOf = (cs: readonly number[]) => prep.faces.map((f, i) => tf(f.face, all, { centre: centres[i], cap: cs[i] }));
    const withObstacle = reshapeMapMulti(tableOf(caps), 1);
    const without = reshapeMapMulti(tableOf(listedOnly), 1);
    let outside = 0;
    let differs = 0;
    let annulus = 0;
    let moved = 0;
    let movedBefore = 0;
    for (let j = 0; j <= 350; j++)
      for (let i = 0; i <= 375; i++) {
        const x = 0.1 + i * 0.002;
        const y = 0.15 + j * 0.002;
        const d = iso([x, y], centres[near]);
        const s = withObstacle(x, y);
        const b = without(x, y);
        if (d >= listedOnly[near]) {
          outside++;
          if (s[0] !== b[0] || s[1] !== b[1]) differs++;
        } else if (d >= caps[near]) {
          annulus++;
          if (s[0] !== x || s[1] !== y) moved++;
          if (b[0] !== x || b[1] !== y) movedBefore++;
        }
      }
    expect(outside).toBeGreaterThan(100_000);
    expect(differs, 'the other five faces warp exactly as without the obstacle').toBe(0);
    expect(annulus).toBeGreaterThan(1000);
    expect(moved, 'beyond its new cap the near face moves nothing').toBe(0);
    expect(movedBefore, 'without the obstacle the near face warps there (the check is not vacuous)').toBeGreaterThan(100);
  });
});
