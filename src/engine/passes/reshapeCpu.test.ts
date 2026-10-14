import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Face, Landmarks478, ParamId, PersonParams } from '../../types';
import { MAX_RENDER_FACES } from '../../config/limits';
import { prepareFaces } from '../../detect/faces';
import { applyPreset, neutralValue, PARAM_DEFS, paramsInGroup, setParam, SPLIT_IDS } from '../params';
import { adapt } from '../../tracking/adapter111';
import { apply, glMat3, IDENTITY_GEOMETRY, rotateLeft, vToO } from '../../geometry/view';
import { faceDetailMoves, faceWidthIso, IDENTITY_VIEW, RESHAPE_FS, reshapeFs, reshapeGeometry, reshapeUniforms } from './reshape';
import { reshapeMapCpu, reshapeMapMulti, shiftEllipseUv, squeezeAxisUv, withView } from './reshapeCpu';
import { reshapeMapCpuV03 } from './reshapeCpuV03';
import { attenuate, boxCentre, capsFor, influenceBox, ovalBox, WHOLE, type TableFace } from './faceCap';
import type { ReshapeUniforms as RU } from './reshape';
import { MIN_DET } from '../../body/field';
import { syntheticPortrait } from '../../body/synthetic';
import { buildFaceProtect } from '../../tracking/faceProtect';
import { shaderHash } from '../shaderHash';

const PINNED = '913c3d3b';

const lm = JSON.parse(readFileSync(new URL('../../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
  width: number;
  height: number;
  points: number[];
  mirrored: number[];
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
  return { pts111: iso(face.pts111), ext: iso(face.ext), oval: iso(face.oval), yaw, iris: iso(face.iris), lids: iso(face.lids) };
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
  // Step 5 (face-detail spec §4.2) adds three settings: every 美型 item at + max, every one at − max (the one-way ones at
  // max), and + max with the six split items' right sides at 0. Measured: min det J 0.476 / 0.442 / 0.461 (worst: the
  // − max setting, 3 faces 1.0 FW apart at 0°); the 8 landmarks keep ≥ 0.927 at 1.2 FW and ≥ 0.982 from 1.3 FW; 額頭
  // 1.000 from 2.0 FW; 下巴 keeps 0.684 at 2.0 FW, 0.808 at 2.1 and 0.919 from 2.2 with the − max setting (下頜線 at max
  // carries the chin point farther when the face is alone, and the cap holds the same budget), ≥ 0.998 with the other
  // two. So the step-5 settings keep every floor except 下巴 at 2.0 FW, pinned there at ≥ 0.68.
  it('fold and strength sweep (accepted radius-cap trade-off, S §4.4): min det J ≥ MIN_DET on a 0.02 FW grid; the 8 eye / nose / mouth landmarks keep ≥ 0.9 from 1.3 FW (≥ 0.8 at 1.2 FW, measured 0.838); 額頭 ≥ 0.9 from 2.0 FW; 下巴 ≥ 0.9 from 2.2 FW (≥ 0.7 at 2.0 FW, measured 0.708)', () => {
    const FW = 0.12;
    const oneWay: ParamId[] = ['shape.eyeEnlarge', 'shape.faceSlim', 'shape.faceV', 'shape.faceNarrow', 'shape.noseSlim'];
    const bi: ParamId[] = ['shape.chin', 'shape.forehead', 'shape.mouthSize', 'shape.eyeDistance'];
    // step 5: every 美型 item at its extreme, both signs, and the six split items at opposite extremes
    const ALL15_HI = Object.fromEntries(paramsInGroup('shape').map((d) => [d.id, 1]));
    const ALL15_LO = Object.fromEntries(paramsInGroup('shape').map((d) => [d.id, d.bidirectional ? 0 : 1]));
    const settings = [
      ...[0, 1].map((end) => reshapeUniforms(bi.reduce((p, id) => setParam(p, id, end), oneWay.reduce((p, id) => setParam(p, id, 1), applyPreset('original', 1))).values, 1)),
      reshapeUniforms({ ...NEUTRAL, ...ALL15_HI }, 1),
      reshapeUniforms({ ...NEUTRAL, ...ALL15_LO }, 1),
      reshapeUniforms({ ...NEUTRAL, ...ALL15_HI }, 1, Object.fromEntries(SPLIT_IDS.map((id) => [id, 0]))),
    ];
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
                  const chinFloor = dFW >= 2.2 - 1e-9 ? 0.9 : dFW < 2.05 && settings.indexOf(u) >= 2 ? 0.68 : 0.7;
                  expect(chin, `下巴 ${count} faces ${dFW.toFixed(1)} FW ${deg}° yaw ${yaw} setting ${settings.indexOf(u)}`).toBeGreaterThanOrEqual(chinFloor);
                }
              }
            }
    console.log(
      `sweep worst min det J ${worst.toFixed(3)} (${worstAt}; grid step ${FOLD_STEP / FW} FW over each influence box); ` +
        `the 8 landmarks keep ≥ ${featureWorst12.toFixed(3)} at 1.2 FW, ≥ ${featureWorst13.toFixed(3)} from 1.3 FW; ` +
        `at ≥ 2.0 FW 下巴 keeps ≥ ${chinWorst.toFixed(3)}, 額頭 ≥ ${foreheadWorst.toFixed(3)}`,
    );
  }, 360_000);
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

type V2 = [number, number];
const W = lm.width;
const H = lm.height;
const mirroredFace = adapt({ points: new Float32Array(lm.mirrored) }, W, H);
const NEUTRAL = Object.fromEntries(PARAM_DEFS.map((d) => [d.id, neutralValue(d)])) as Record<ParamId, number>;
const U5 = (over: Partial<Record<ParamId, number>> = {}, right: PersonParams['right'] = null) =>
  reshapeUniforms({ ...NEUTRAL, ...over }, 1, right);
const pt = (f: Face, i: number): V2 => [f.pts111[i * 2], f.pts111[i * 2 + 1]];
const moved = (map: (x: number, y: number) => V2, q: V2) => {
  const s = map(q[0], q[1]);
  return Math.hypot((s[0] - q[0]) * W, (s[1] - q[1]) * H);
};

/** min det J (px Jacobian, forward differences) and max move (fractions of FW) on a 300 × 300 grid over `box` */
function sweep(f: Face, map: (x: number, y: number) => V2, box: readonly number[]): { minDet: number; maxMoveFW: number } {
  const N = 300;
  const x0 = Math.max(0, box[0]);
  const y0 = Math.max(0, box[1]);
  const dx = (Math.min(1, box[2]) - x0) / N;
  const dy = (Math.min(1, box[3]) - y0) / N;
  const fw = faceWidthIso(f, aspect);
  let minDet = Infinity;
  let maxMove = 0;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const u = x0 + (i + 0.5) * dx;
      const v = y0 + (j + 0.5) * dy;
      const a = map(u, v);
      const b = map(u + dx, v);
      const c = map(u, v + dy);
      const j00 = (b[0] - a[0]) / dx;
      const j10 = ((b[1] - a[1]) / dx) * (H / W);
      const j01 = ((c[0] - a[0]) / dy) * (W / H);
      const j11 = (c[1] - a[1]) / dy;
      minDet = Math.min(minDet, j00 * j11 - j01 * j10);
      maxMove = Math.max(maxMove, Math.hypot(a[0] - u, (a[1] - v) / aspect) / fw);
    }
  return { minDet, maxMoveFW: maxMove };
}

describe('step-5 warps through the CPU port (face-detail spec §4.2, §8.1)', () => {
  // [id, value, min det J of S5 §4.2, max move of S5 §4.2 in FW]
  const TABLE: [ParamId, number, number, number][] = [
    ['shape.jawline', 1, 0.73, 0.05],
    ['shape.temple', 1, 0.62, 0.035],
    ['shape.temple', 0, 0.67, 0.035],
    ['shape.hairline', 1, 0.56, 0.024],
    ['shape.hairline', 0, 0.6, 0.024],
    ['shape.noseWing', 1, 0.72, 0.024],
    ['shape.noseWing', 0, 0.72, 0.024],
    ['shape.noseBridge', 1, 0.76, 0.012],
    ['shape.noseBridge', 0, 0.7, 0.012],
    ['shape.mouthHeight', 1, 0.73, 0.029],
    ['shape.mouthHeight', 0, 0.56, 0.029],
  ];
  for (const [name, f] of [
    ['fixture', face],
    ['mirrored', mirroredFace],
  ] as const) {
    for (const [id, v, det, move] of TABLE) {
      it(`${name}: ${id} = ${v}: min det J ≥ 0.5 and within ±0.05 of ${det}; max move ≈ ${move} FW`, () => {
        const u = U5({ [id]: v });
        const r = sweep(f, reshapeMapCpu(f, u, aspect), reshapeGeometry(f, aspect, u).box);
        expect(r.minDet).toBeGreaterThanOrEqual(0.5);
        expect(Math.abs(r.minDet - det)).toBeLessThanOrEqual(0.05);
        expect(r.maxMoveFW).toBeGreaterThan(0.7 * move);
        expect(r.maxMoveFW).toBeLessThan(1.3 * move);
      });
    }
  }

  it('directions: 下頜線 inward, 太陽穴 + outward, 髮際線 + down, 鼻翼 − together, 山根 + narrower, 嘴高 + up', () => {
    // backward map: content moves from map(q) to q, so the sample sits on the far side of the motion
    const jaw = reshapeMapCpu(face, U5({ 'shape.jawline': 1 }), aspect);
    for (const i of [8, 10, 12, 24, 22, 20]) {
      const s = jaw(...pt(face, i));
      const n = pt(face, 46);
      const p = pt(face, i);
      expect((s[0] - p[0]) * (n[0] - p[0]) + ((s[1] - p[1]) * (n[1] - p[1])) / (aspect * aspect)).toBeLessThan(0);
    }
    const g = reshapeGeometry(face, aspect, U5({ 'shape.temple': 1 }));
    const temple = reshapeMapCpu(face, U5({ 'shape.temple': 1 }), aspect);
    for (let k = 0; k < 6; k++) {
      const o: V2 = [g.templeAnchors[k * 2], g.templeAnchors[k * 2 + 1]];
      const t: V2 = [g.templeTargets[k * 2], g.templeTargets[k * 2 + 1]];
      const s = temple(...o);
      expect((s[0] - o[0]) * (t[0] - o[0]) + (s[1] - o[1]) * (t[1] - o[1])).toBeLessThan(0);
    }
    const hair = reshapeMapCpu(face, U5({ 'shape.hairline': 1 }), aspect);
    expect(hair(face.ext[0], face.ext[1])[1]).toBeLessThan(face.ext[1]);
    const wing = reshapeMapCpu(face, U5({ 'shape.noseWing': 0 }), aspect);
    const [l, r] = [pt(face, 80), pt(face, 81)];
    expect((wing(...l)[0] - l[0]) * (r[0] - l[0])).toBeLessThan(0);
    expect((wing(...r)[0] - r[0]) * (r[0] - l[0])).toBeGreaterThan(0);
    const root = reshapeMapCpu(face, U5({ 'shape.noseBridge': 1 }), aspect);
    const [a, b] = [pt(face, 78), pt(face, 79)];
    expect(Math.abs(root(...b)[0] - root(...a)[0])).toBeGreaterThan(Math.abs(b[0] - a[0]));
    const mouth = reshapeMapCpu(face, U5({ 'shape.mouthHeight': 1 }), aspect);
    expect(mouth(...pt(face, 106))[1]).toBeGreaterThan(pt(face, 106)[1]);
  });

  it('locality: 山根 never moves p55, p58 or a lid point; 嘴高 never moves p49; 髮際線 never moves a brow point', () => {
    for (const f of [face, mirroredFace]) {
      for (const v of [0, 1]) {
        const root = reshapeMapCpu(f, U5({ 'shape.noseBridge': v }), aspect);
        for (const i of [55, 58]) expect(moved(root, pt(f, i))).toBeLessThan(1e-6);
        for (let k = 0; k < 32; k++) expect(moved(root, [f.lids[k * 2], f.lids[k * 2 + 1]])).toBeLessThan(1e-6);
        expect(moved(reshapeMapCpu(f, U5({ 'shape.mouthHeight': v }), aspect), pt(f, 49))).toBeLessThan(1e-6);
        const hair = reshapeMapCpu(f, U5({ 'shape.hairline': v }), aspect);
        for (let i = 33; i <= 42; i++) expect(hair(...pt(f, i))).toEqual(pt(f, i));
        for (let i = 64; i <= 71; i++) expect(hair(...pt(f, i))).toEqual(pt(f, i));
      }
    }
  });

  it('山根 moves only along r̂; 鼻翼 mostly along r̂', () => {
    const [rx, ry] = reshapeGeometry(face, aspect, U5({ 'shape.noseBridge': 1 })).axes;
    for (const [id, tol] of [
      ['shape.noseBridge', 1e-9],
      ['shape.noseWing', 0.2],
    ] as const) {
      const map = reshapeMapCpu(face, U5({ [id]: 1 }), aspect);
      for (const i of [44, 45, 46, 78, 79, 80, 81, 82, 83]) {
        const q = pt(face, i);
        const s = map(...q);
        const d: V2 = [s[0] - q[0], (s[1] - q[1]) / aspect];
        const along = Math.abs(d[0] * rx + d[1] * ry);
        const across = Math.abs(-d[0] * ry + d[1] * rx);
        expect(across).toBeLessThanOrEqual(tol * Math.max(along, 1e-12) + 1e-12);
      }
    }
  });

  it('左右分開: L ≠ R moves the left half and leaves the right half (almost) still', () => {
    const on = { 'shape.faceSlim': 1, 'shape.faceV': 1, 'shape.faceNarrow': 1, 'shape.jawline': 1 };
    const off = { 'shape.faceSlim': 0, 'shape.faceV': 0, 'shape.faceNarrow': 0, 'shape.jawline': 0 };
    const leftOnly = reshapeMapCpu(face, U5(on, off), aspect);
    const rightOnly = reshapeMapCpu(face, U5(off, on), aspect);
    const mean = (map: (x: number, y: number) => V2, ids: number[]) => ids.reduce((s, i) => s + moved(map, pt(face, i)), 0) / ids.length;
    const L = [3, 7, 10];
    const R = [29, 25, 22];
    expect(mean(leftOnly, R)).toBeLessThan(0.05 * mean(leftOnly, L));
    expect(mean(rightOnly, L)).toBeLessThan(0.05 * mean(rightOnly, R));
  });

  it('with right = null, and with right equal to the values, the map is bit-identical to the v0.3 port', () => {
    const v = {
      'shape.faceSlim': 0.37, 'shape.faceV': 0.21, 'shape.faceNarrow': 0.3, 'shape.chin': 0.7, 'shape.forehead': 0.2,
      'shape.noseSlim': 0.4, 'shape.mouthSize': 0.8, 'shape.eyeDistance': 0.3, 'shape.eyeEnlarge': 0.6,
    };
    const u = U5(v);
    const same = U5(v, Object.fromEntries(SPLIT_IDS.map((id) => [id, { ...NEUTRAL, ...v }[id]])));
    const a = reshapeMapCpu(face, u, aspect);
    const b = reshapeMapCpu(face, same, aspect);
    const c = reshapeMapCpuV03(face, u, aspect);
    for (let j = 0; j <= 40; j++)
      for (let i = 0; i <= 40; i++) {
        const x = i / 40;
        const y = j / 40;
        expect(a(x, y)).toEqual(c(x, y));
        expect(b(x, y)).toEqual(c(x, y));
      }
  });

  it('faceDetailMoves bounds the measured move of the step-5 warps (step 3 displacementBound terms)', () => {
    let s = 3;
    const rnd = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let n = 0; n < 12; n++) {
      const values = {
        'shape.jawline': rnd(), 'shape.temple': rnd(), 'shape.hairline': rnd(), 'shape.noseWing': rnd(), 'shape.noseBridge': rnd(), 'shape.mouthHeight': rnd(),
      };
      const right = rnd() < 0.5 ? null : { 'shape.jawline': rnd(), 'shape.temple': rnd() };
      const u = U5(values, right);
      const g = reshapeGeometry(face, aspect, u);
      const m = faceDetailMoves(g, u, face);
      const bound = m.uv.reduce((acc, d) => acc + Math.hypot(d[0] * W, d[1] * H), 0) + m.iso.reduce((acc, l) => acc + l * W, 0);
      const map = reshapeMapCpu(face, u, aspect);
      let mx = 0;
      for (let j = 0; j <= 128; j++)
        for (let i = 0; i <= 128; i++) mx = Math.max(mx, moved(map, [g.box[0] + ((g.box[2] - g.box[0]) * i) / 128, g.box[1] + ((g.box[3] - g.box[1]) * j) / 128]));
      expect(mx).toBeLessThanOrEqual(bound + 1e-9);
    }
  });

  it('identity outside the box: every step-5 warp leaves its influence-box border unmoved, so the box skip cuts no warp (S5 §4.4, §8.1)', () => {
    const CASES: [ParamId, number][] = [
      ['shape.jawline', 1], ['shape.temple', 0], ['shape.temple', 1], ['shape.hairline', 0], ['shape.hairline', 1], ['shape.noseWing', 0],
      ['shape.noseWing', 1], ['shape.noseBridge', 0], ['shape.noseBridge', 1], ['shape.mouthHeight', 0], ['shape.mouthHeight', 1],
    ];
    for (const f of [face, mirroredFace])
      for (const [id, v] of CASES) {
        const u = U5({ [id]: v });
        const b = reshapeGeometry(f, aspect, u).box;
        const map = reshapeMapCpu(f, u, aspect);
        const e = 1e-7;
        let worst = 0;
        for (let i = 0; i <= 400; i++) {
          const x = b[0] + ((b[2] - b[0]) * i) / 400;
          const y = b[1] + ((b[3] - b[1]) * i) / 400;
          for (const q of [[x, b[1] + e], [x, b[3] - e], [b[0] + e, y], [b[2] - e, y]] as V2[]) worst = Math.max(worst, moved(map, q));
        }
        // just inside the border the chain runs; it must already be the identity there (measured 0 px; 0.07–0.09 px
        // for 山根 with S5 §4.4's disc(c, max(r−, r+, ry)), which misses the band's corners: Task 6 uses the circumscribed disc)
        expect(worst, `${id} = ${v}`).toBeLessThan(1e-6);
      }
  });
});

describe('shiftEllipse and squeezeAxis ports (face-detail spec §4.2)', () => {
  const A = 1.5;
  const c: V2 = [0.5, 0.5];
  const ax: V2 = [1, 0];
  const ay: V2 = [0, 1];

  it('shiftEllipse: content within w ≤ 0.5 moves at least 0.878 of disp; C¹ across the axis; identity outside', () => {
    const r = [0.2, 0.1, 0.16] as const;
    const disp: V2 = [0.01, 0.02];
    for (const w of [0, 0.25, 0.5])
      for (let th = 0; th < 6; th++) {
        const qx = Math.cos(th) * w;
        const qy = Math.sin(th) * w;
        const tc: V2 = [c[0] + qx * r[0], c[1] + qy * (qy < 0 ? r[1] : r[2]) * A];
        const out = shiftEllipseUv(tc, c, ax, ay, r, disp, A);
        expect((tc[0] - out[0]) / disp[0]).toBeGreaterThanOrEqual(0.878);
      }
    const f = (y: number) => shiftEllipseUv([0.53, 0.5 + y], c, ax, ay, r, disp, A)[1] - (0.5 + y);
    const h = 1e-6;
    expect(Math.abs((f(0) - f(-h)) / h - (f(h) - f(0)) / h)).toBeLessThan(1e-4);
    expect(shiftEllipseUv([0.71, 0.5], c, ax, ay, r, disp, A)).toEqual([0.71, 0.5]);
  });

  it('squeezeAxis: zero on the axis and at |t| = 1, |v| = 1; det J within [1 − 0.8k, 1 + k] (k > 0) / [1 − |k|, 1 + 0.8|k|] (k < 0)', () => {
    const r = [0.05, 0.08, 0.06] as const;
    for (const k of [0.3, 0.5, -0.3, -0.5]) {
      expect(squeezeAxisUv([0.5, 0.52], c, ax, ay, r, k, A)).toEqual([0.5, 0.52]);
      expect(squeezeAxisUv([0.45, 0.5], c, ax, ay, r, k, A)).toEqual([0.45, 0.5]);
      expect(squeezeAxisUv([0.58, 0.5], c, ax, ay, r, k, A)).toEqual([0.58, 0.5]);
      expect(squeezeAxisUv([0.52, 0.5 + 0.06 * A], c, ax, ay, r, k, A)).toEqual([0.52, 0.5 + 0.06 * A]);
      const lo = k > 0 ? 1 - 0.8 * k : 1 - Math.abs(k);
      const hi = k > 0 ? 1 + k : 1 + 0.8 * Math.abs(k);
      const M = (x: number, y: number): V2 => {
        const o = squeezeAxisUv([x, y * A], c, ax, ay, r, k, A);
        return [o[0], o[1] / A];
      };
      const e = 1e-6;
      for (let i = 0; i <= 80; i++)
        for (let j = 0; j <= 80; j++) {
          const x = 0.44 + (0.15 * i) / 80;
          const y = 0.5 / A - 0.07 + (0.14 * j) / 80;
          const p = M(x + e, y);
          const q = M(x - e, y);
          const s = M(x, y + e);
          const t = M(x, y - e);
          const det = ((p[0] - q[0]) * (s[1] - t[1]) - (s[0] - t[0]) * (p[1] - q[1])) / (4 * e * e);
          expect(det).toBeGreaterThanOrEqual(lo - 1e-4);
          expect(det).toBeLessThanOrEqual(hi + 1e-4);
        }
    }
  });
});
