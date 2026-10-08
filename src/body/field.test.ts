import { describe, expect, it } from 'vitest';
import type { BeautyParams, BodyDetection, Face, ParamId } from '../types';
import { defaultParams, resetGroup, setBodyProtect, setHeightBand, setParam } from '../engine/params';
import { warpImage, fieldAt } from './cpuWarp';
import { bodyActive, BODY_FIELD_LONG_EDGE, bodyFieldCacheStats, buildBodyField, fieldMinJacobian, MIN_DET } from './field';
import { fieldSize } from './geom';
import { loadPoseFixture } from './fixtures.node';
import { MaskSampler } from './mask';
import { measureBody, type BodyMeasure } from './measure';
import { syntheticFigure } from './synthetic';

const ALL: ParamId[] = ['body.legs', 'body.slim', 'body.waist', 'body.whr', 'body.legSlim', 'body.arms', 'body.shoulder', 'body.neck', 'body.head'];

function withMax(ids: ParamId[], base: BeautyParams = defaultParams()): BeautyParams {
  return ids.reduce((p, id) => setParam(p, id, 1), base);
}

interface Scene {
  name: string;
  det: BodyDetection;
  face: Face | null;
}

const scenes: Scene[] = [
  { name: 'synthetic', det: syntheticFigure().det, face: syntheticFigure().face },
  { name: 'synthetic arms down', det: syntheticFigure({ armsDown: true }).det, face: syntheticFigure({ armsDown: true }).face },
  { name: 'synthetic landscape', det: syntheticFigure({ width: 1200, height: 900 }).det, face: syntheticFigure({ width: 1200, height: 900 }).face },
  { name: 'synthetic no mask', det: { ...syntheticFigure().det, mask: null }, face: syntheticFigure().face },
];
for (const f of ['pose_fullbody.json', 'fullbody_yoga.pose.json']) {
  const det = loadPoseFixture(f);
  if (det) scenes.push({ name: f, det, face: null });
}

function silhouetteWidth(m: BodyMeasure, data: Uint8Array | Uint8ClampedArray, w: number, h: number): number {
  const t = m.trunk!;
  const s = new MaskSampler({ width: w, height: h, data: Uint8Array.from(data) }, m.aspect);
  const p: [number, number] = [t.s[0] + t.u[0] * t.waistT * t.len, t.s[1] + t.u[1] * t.waistT * t.len];
  return s.march(p, t.n, 0.4)!.dist + s.march(p, [-t.n[0], -t.n[1]], 0.4)!.dist;
}

/**
 * Per-side silhouette distance from the torso axis at the measured waist station, for the sides that face open
 * background (an arm lying along the scanline is not slimmed away, by design).
 */
function waistSides(m: BodyMeasure, data: Uint8Array | Uint8ClampedArray, w: number, h: number): (number | null)[] {
  const t = m.trunk!;
  const s = new MaskSampler({ width: w, height: h, data: Uint8Array.from(data) }, m.aspect);
  const p: [number, number] = [t.s[0] + t.u[0] * t.waistT * t.len, t.s[1] + t.u[1] * t.waistT * t.len];
  const i = Math.round((t.waistT + 0.1) / 0.025);
  return [
    [t.n, t.halfP[i], t.reachP[i]],
    [[-t.n[0], -t.n[1]], t.halfM[i], t.reachM[i]],
  ].map(([d, half]) => {
    // open side: the scanline leaves the person right at the torso edge (no arm lying against it)
    const dd = s.march(p, d as [number, number], 0.4)!.dist;
    return Math.abs(dd - (half as number)) < 0.12 * (half as number) ? dd : null;
  });
}

describe('bodyActive / neutral', () => {
  it('neutral params (and the default) build no field', () => {
    const p = defaultParams();
    expect(bodyActive(p)).toBe(false);
    const m = measureBody(scenes[0].det, scenes[0].face);
    expect(buildBodyField(m, p, 2 / 3)).toBeNull();
    expect(buildBodyField(null, p, 2 / 3)).toBeNull();
    expect(bodyActive(setParam(p, 'body.hip', 0.5))).toBe(false); // 美臀 is centre-zero
    expect(bodyActive(setParam(p, 'body.hip', 0.6))).toBe(true);
    expect(bodyActive(resetGroup(withMax(ALL), 'body'))).toBe(false);
  });

  it('a slider whose region is unavailable moves nothing', () => {
    const m = measureBody(syntheticFigure({ halfBody: true }).det, null);
    expect(buildBodyField(m, withMax(['body.legs', 'body.legSlim']), 2 / 3)).toBeNull();
  });
});

describe('buildBodyField', () => {
  it('field size: ≈256 long edge matching the aspect', () => {
    const m = measureBody(scenes[0].det, scenes[0].face);
    const f = buildBodyField(m, withMax(['body.waist']), 600 / 900)!;
    expect([f.width, f.height]).toEqual([171, BODY_FIELD_LONG_EDGE]);
    const l = buildBodyField(null, setHeightBand(defaultParams(), { top: 0.3, bottom: 0.6, amount: 1 }), 4 / 3)!;
    expect([l.width, l.height]).toEqual([BODY_FIELD_LONG_EDGE, 192]);
  });

  it('increments the version and reuses the previous buffer', () => {
    const p = setHeightBand(defaultParams(), { top: 0.3, bottom: 0.6, amount: 1 });
    const a = buildBodyField(null, p, 0.75)!;
    const b = buildBodyField(null, { ...p, heightBand: { ...p.heightBand!, amount: 0.5 } }, 0.75, a)!;
    expect(b.data).toBe(a.data);
    expect(b.version).toBeGreaterThan(a.version);
  });

  it('manual 增高 works without any detection: rows above untouched, band stretched, frame size kept', () => {
    const f = buildBodyField(null, setHeightBand(defaultParams(), { top: 0.4, bottom: 0.6, amount: 1 }), 0.75)!;
    expect(f).not.toBeNull();
    expect(fieldAt(f, 0.5, 0.2)).toEqual([0, 0]);
    // well inside the band the backward slope is 1/1.15; below it the content is shifted down by 0.15·0.2
    const [, d1] = fieldAt(f, 0.5, 0.9);
    expect(d1).toBeCloseTo(-0.03, 3);
    for (let i = 0; i < f.data.length; i += 2) expect(f.data[i]).toBe(0); // vertical only
    expect(fieldMinJacobian(f)).toBeGreaterThan(0.8);
  });

  for (const sc of scenes) {
    it(`${sc.name}: every slider at max (alone and all together) never folds (min det J > 0.3)`, () => {
      const m = measureBody(sc.det, sc.face);
      const aspect = sc.det.width / sc.det.height;
      const cases: BeautyParams[] = [
        ...ALL.map((id) => withMax([id])),
        setParam(defaultParams(), 'body.hip', 1),
        setParam(defaultParams(), 'body.hip', 0),
        setParam(withMax(ALL), 'body.hip', 1),
        setParam(withMax(ALL), 'body.hip', 0),
        setBodyProtect(withMax(ALL), false),
        setHeightBand(withMax(ALL), { top: 0.1, bottom: 0.9, amount: 1 }),
      ];
      for (const p of cases) {
        const f = buildBodyField(m, p, aspect);
        if (f) expect(fieldMinJacobian(f)).toBeGreaterThan(0.3);
      }
    });
  }

  it('背景保護: the field is exactly zero outside the feathered person mask', () => {
    const fig = syntheticFigure();
    const m = measureBody(fig.det, fig.face);
    const local: ParamId[] = ['body.slim', 'body.waist', 'body.whr', 'body.legSlim', 'body.arms', 'body.shoulder', 'body.neck', 'body.head'];
    const f = buildBodyField(m, setParam(withMax(local), 'body.hip', 1), fig.width / fig.height)!;
    const s = new MaskSampler(fig.det.mask!, m.aspect);
    let outside = 0;
    let nonzero = 0;
    for (let y = 0; y < f.height; y++)
      for (let x = 0; x < f.width; x++) {
        const u = (x + 0.5) / f.width;
        const v = (y + 0.5) / f.height;
        // far from the person: nothing within 8 % of the image height
        let near = false;
        for (let a = 0; a < 16 && !near; a++)
          for (const r of [0.02, 0.04, 0.06, 0.08]) {
            const q: [number, number] = [u * m.aspect + Math.cos((a * Math.PI) / 8) * r, v + Math.sin((a * Math.PI) / 8) * r];
            if (s.at(q[0], q[1]) > 0.02) near = true;
          }
        if (near || s.at(u * m.aspect, v) > 0.02) continue;
        outside++;
        const i = (y * f.width + x) * 2;
        if (f.data[i] !== 0 || f.data[i + 1] !== 0) nonzero++;
      }
    expect(outside).toBeGreaterThan(f.width * f.height * 0.4);
    expect(nonzero).toBe(0);
  });

  it('背景保護 keeps background lines straight: pixels away from the person are bit-identical', () => {
    const fig = syntheticFigure();
    const m = measureBody(fig.det, fig.face);
    const W = 300;
    const H = 450;
    const img = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) img[y * W + x] = x % 10 < 2 || y % 10 < 2 ? 0 : 255;
    const f = buildBodyField(m, withMax(['body.slim', 'body.waist', 'body.head', 'body.shoulder']), fig.width / fig.height)!;
    const out = warpImage(img, W, H, 1, f);
    const s = new MaskSampler(fig.det.mask!, m.aspect);
    let changedFar = 0;
    let changedNear = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const q: [number, number] = [((x + 0.5) / W) * m.aspect, (y + 0.5) / H];
        let near = false;
        for (let a = 0; a < 16 && !near; a++)
          for (const r of [0, 0.02, 0.04, 0.06, 0.08]) if (s.at(q[0] + Math.cos((a * Math.PI) / 8) * r, q[1] + Math.sin((a * Math.PI) / 8) * r) > 0.02) near = true;
        if (out[y * W + x] !== img[y * W + x]) {
          if (near) changedNear++;
          else changedFar++;
        }
      }
    expect(changedNear).toBeGreaterThan(0);
    expect(changedFar).toBe(0);
  });

  const waistScenes = scenes.filter((s) => s.det.mask && !s.name.includes('landscape'));
  for (const sc of waistScenes) {
    it(`${sc.name}: 細腰 at max shrinks the measured mask waist by ≈ 10–15 % where the waist meets background`, () => {
      const m = measureBody(sc.det, sc.face);
      const mask = sc.det.mask!;
      const f = buildBodyField(m, withMax(['body.waist']), sc.det.width / sc.det.height)!;
      const before = waistSides(m, mask.data, mask.width, mask.height);
      const after = waistSides(m, warpImage(mask.data, mask.width, mask.height, 1, f), mask.width, mask.height);
      const open = before.flatMap((b, k) => (b !== null && after[k] !== null ? [1 - after[k]! / b] : []));
      for (const change of open) {
        expect(change).toBeGreaterThan(0.1);
        expect(change).toBeLessThan(0.15);
      }
      // An arm lying against the waist is not torn off the torso: the torso slims underneath and the arm is only
      // dragged a little, so the arm + torso silhouette changes less (known limitation, see the B1 report).
      const sb = silhouetteWidth(m, mask.data, mask.width, mask.height);
      const sa = silhouetteWidth(m, warpImage(mask.data, mask.width, mask.height, 1, f), mask.width, mask.height);
      expect(1 - sa / sb).toBeGreaterThan(open.length === 2 ? 0.1 : -1e-3);
      expect(1 - sa / sb).toBeLessThan(0.15);
    });
  }

  it('side view: 瘦身 + 細腰 slim the profile silhouette although the shoulder / hip keypoints nearly coincide', () => {
    // E4 regression: the mask widths were clamped to a range derived from the (foreshortened) shoulder / hip spans,
    // so in profile the trunk ring stayed inside the body and the silhouette barely moved.
    const fig = syntheticFigure();
    const side = (det: BodyDetection): BodyDetection => {
      const pts = new Float32Array(det.pose.points);
      for (const [i, x] of [[11, 0.51], [12, 0.49], [23, 0.505], [24, 0.495]]) pts[i * 4] = x;
      return { ...det, pose: { points: pts } };
    };
    const p = withMax(['body.slim', 'body.waist']);
    const shrink = (det: BodyDetection): number => {
      const m = measureBody(det, fig.face);
      const mask = det.mask!;
      const f = buildBodyField(m, p, fig.width / fig.height)!;
      expect(fieldMinJacobian(f)).toBeGreaterThan(0.3);
      return 1 - silhouetteWidth(m, warpImage(mask.data, mask.width, mask.height, 1, f), mask.width, mask.height) / silhouetteWidth(m, mask.data, mask.width, mask.height);
    };
    const m = measureBody(side(fig.det), fig.face);
    expect(m.facing).toBe('side');
    expect(m.regions.torso.ok).toBe(true);
    // the measured half-widths at the waist follow the mask, not the keypoint span
    const t = m.trunk!;
    const s = new MaskSampler(fig.det.mask!, m.aspect);
    const pw: [number, number] = [t.s[0] + t.u[0] * t.waistT * t.len, t.s[1] + t.u[1] * t.waistT * t.len];
    const i = Math.round((t.waistT + 0.1) / 0.025);
    expect(t.halfP[i] / s.march(pw, t.n, 0.4)!.dist).toBeGreaterThan(0.85);
    expect(t.halfP[i] / s.march(pw, t.n, 0.4)!.dist).toBeLessThan(1.15);
    expect(t.halfM[i] / s.march(pw, [-t.n[0], -t.n[1]], 0.4)!.dist).toBeGreaterThan(0.85);
    expect(t.halfM[i] / s.march(pw, [-t.n[0], -t.n[1]], 0.4)!.dist).toBeLessThan(1.15);
    const front = shrink(fig.det);
    const prof = shrink(side(fig.det));
    expect(prof).toBeGreaterThan(0.08);
    expect(prof).toBeGreaterThan(0.6 * front);
  });

  it('without background protection the capsules still vanish outside R (compact support)', () => {
    const fig = syntheticFigure();
    const m = measureBody(fig.det, fig.face);
    const f = buildBodyField(m, setBodyProtect(withMax(['body.waist']), false), fig.width / fig.height)!;
    expect(fieldAt(f, 0.05, 0.4)).toEqual([0, 0]);
    expect(fieldAt(f, 0.95, 0.4)).toEqual([0, 0]);
  });

  it('never samples outside the photo: a head at the top edge shrinks with the frame edge pinned (no smeared rows)', () => {
    // half-body crop: the hair reaches the top edge, so 小頭's outward backward map would read above row 0
    const fig = syntheticFigure({ halfBody: true });
    const m = measureBody(fig.det, fig.face);
    expect(m.regions.head.ok).toBe(true);
    const sets: ParamId[][] = [['body.head'], ['body.head', 'body.neck', 'body.shoulder', 'body.arms']];
    for (const [ids, protect] of sets.flatMap((ids) => [true, false].map((pr) => [ids, pr] as const))) {
      const p = setBodyProtect(withMax(ids), protect);
      const f = buildBodyField(m, p, fig.width / fig.height)!;
      expect(f).not.toBeNull();
      let worst = 0;
      for (let y = 0; y < f.height; y++) {
        for (let x = 0; x < f.width; x++) {
          const u = (x + 0.5) / f.width;
          const v = (y + 0.5) / f.height;
          const su = u + f.data[(y * f.width + x) * 2];
          const sv = v + f.data[(y * f.width + x) * 2 + 1];
          worst = Math.max(worst, -su, su - 1, -sv, sv - 1);
        }
      }
      expect(worst, `${ids.join('+')} protect ${protect}`).toBeLessThanOrEqual(0);
      expect(fieldMinJacobian(f)).toBeGreaterThan(0.3);
      if (ids.length === 1) {
        // the head still shrinks: between the edge and the head centre the output samples further up
        const [, dyTop] = fieldAt(f, 0.5, 0.06);
        expect(dyTop).toBeLessThan(-0.002);
      }
    }
  });

  it('pinning the frame edge never folds, so 小頭 near an edge leaves the other sliders at full strength', () => {
    // E3 regression: the edge limiter used to flatten the outermost rows (det J → 0), tripping the global fold
    // guard, which then scaled every local term (細腰 here) back by ~30 %.
    const peakWaistDx = (m: BodyMeasure, f: NonNullable<ReturnType<typeof buildBodyField>>): number => {
      const t = m.trunk!;
      const wv = t.s[1] + t.u[1] * t.waistT * t.len;
      let peak = 0;
      for (let y = 0; y < f.height; y++) {
        if (Math.abs((y + 0.5) / f.height - wv) > 0.05) continue;
        for (let x = 0; x < f.width; x++) peak = Math.max(peak, Math.abs(f.data[(y * f.width + x) * 2]));
      }
      return peak;
    };
    const cases = [
      { name: 'half body (hair at the top edge)', fig: syntheticFigure({ halfBody: true }), protect: [true, false] },
      { name: 'full body', fig: syntheticFigure(), protect: [false] },
    ];
    for (const { name, fig, protect } of cases) {
      const m = measureBody(fig.det, fig.face);
      const aspect = fig.width / fig.height;
      for (const pr of protect) {
        const waist = setBodyProtect(withMax(['body.waist']), pr);
        const base = peakWaistDx(m, buildBodyField(m, waist, aspect)!);
        expect(base).toBeGreaterThan(0.005);
        for (const head of [0.5, 1]) {
          const f = buildBodyField(m, setParam(waist, 'body.head', head), aspect)!;
          expect(peakWaistDx(m, f) / base, `${name} protect ${pr} 小頭 ${head}`).toBeGreaterThan(0.99);
          expect(fieldMinJacobian(f)).toBeGreaterThan(0.3);
        }
        // the edge pinning on its own keeps det J well clear of the guard's target (小頭 at the top edge, 瘦身's
        // trunk ring reaching the side edges of the half-body crop)
        for (const id of ['body.head', 'body.slim'] as ParamId[]) {
          const h = buildBodyField(m, setBodyProtect(withMax([id]), pr), aspect)!;
          expect(fieldMinJacobian(h), `${name} protect ${pr} ${id} alone`).toBeGreaterThan(MIN_DET + 0.05);
        }
      }
    }
  });

  it('長腿 stretches below the hips only and keeps the feet in frame', () => {
    const fig = syntheticFigure();
    const m = measureBody(fig.det, fig.face);
    const f = buildBodyField(m, withMax(['body.legs']), fig.width / fig.height)!;
    expect(fieldAt(f, 0.5, 0.3)).toEqual([0, 0]);
    // the source row of the output row just inside the margin is at or below the feet (feet stay visible)
    const [, dy] = fieldAt(f, 0.5, 0.975);
    expect(0.975 + dy).toBeGreaterThanOrEqual(m.legs!.feetY - 0.005);
    expect(dy).toBeLessThan(-0.02);
  });

  const fb = loadPoseFixture('pose_fullbody.json');
  describe.skipIf(!fb)('fixture fullbody.jpg (visual QA regressions)', () => {
    const m = fb ? measureBody(fb, null) : null;
    const aspect = fb ? fb.width / fb.height : 1;
    /** backward slope d(source row)/d(output row) on column u, for output rows whose source lies in [s0, s1] */
    const slopes = (f: NonNullable<ReturnType<typeof buildBodyField>>, u: number, s0: number, s1: number): number[] => {
      const out: number[] = [];
      const src = (y: number) => y + fieldAt(f, u, y)[1];
      for (let y = 0.002; y < 0.998; y += 0.002) {
        const a = src(y);
        if (a >= s0 && a <= s1) out.push((src(y + 0.002) - a) / 0.002);
      }
      return out;
    };

    it('長腿 stretches hips → ankles but moves the feet unscaled (no "big boots")', () => {
      const L = m!.legs!;
      const f = buildBodyField(m, withMax(['body.legs']), aspect)!;
      const feet = slopes(f, 0.5, L.ankleY + 0.005, L.feetY);
      expect(feet.length).toBeGreaterThan(10);
      for (const k of feet) expect(k).toBeCloseTo(1, 2);
      const thighs = slopes(f, 0.5, L.hipY + 0.05, L.kneeY);
      for (const k of thighs) expect(k).toBeLessThan(1 / 1.08);
    });

    it('長腿 keeps the outstretched hand at hip height unstretched', () => {
      const f = buildBodyField(m, withMax(['body.legs']), aspect)!;
      const hd = m!.hands.find((h) => h.a[1] > m!.legs!.hipY - 0.05)!;
      const u = (hd.a[0] + 0.8 * (hd.b[0] - hd.a[0])) / aspect;
      const y = hd.a[1] + 0.8 * (hd.b[1] - hd.a[1]);
      const k = slopes(f, u, y - 0.25 * hd.w, y + 0.25 * hd.w);
      expect(k.length).toBeGreaterThan(3);
      for (const v of k) expect(v).toBeGreaterThan(0.97);
    });

    it('torso sliders shift the hand on the belly rigidly instead of squeezing it', () => {
      const f = buildBodyField(m, setParam(withMax(['body.slim', 'body.waist', 'body.whr']), 'body.hip', 1), aspect)!;
      const t = m!.trunk!;
      const belly = m!.hands.find((h) => Math.abs((h.a[0] + h.b[0]) / 2 - (t.s[0] + t.h[0]) / 2) < 0.08)!;
      const tip: [number, number] = [belly.a[0] + 1.6 * (belly.b[0] - belly.a[0]), belly.a[1] + 1.6 * (belly.b[1] - belly.a[1])];
      const dx: number[] = [];
      for (let s = 0; s <= 1; s += 0.1)
        for (const o of [-0.4, 0, 0.4]) {
          const q = [belly.a[0] + s * (tip[0] - belly.a[0]), belly.a[1] + s * (tip[1] - belly.a[1]) + o * belly.w];
          dx.push(fieldAt(f, q[0] / aspect, q[1])[0] * fb!.width);
        }
      // the hand spans ~90 px; a squeeze would differ by ~10 px across it
      expect(Math.max(...dx) - Math.min(...dx)).toBeLessThan(2);
    });

    it('細腰 slims both flanks of the visible waist (no lopsided pull)', () => {
      const f = buildBodyField(m, withMax(['body.waist']), aspect)!;
      const mask = fb!.mask!;
      const t = m!.trunk!;
      const after = warpImage(mask.data, mask.width, mask.height, 1, f);
      const s0 = new MaskSampler(mask, aspect);
      const s1 = new MaskSampler({ width: mask.width, height: mask.height, data: Uint8Array.from(after) }, aspect);
      const p: [number, number] = [t.s[0] + t.u[0] * t.waistT * t.len, t.s[1] + t.u[1] * t.waistT * t.len];
      const moved = [t.n, [-t.n[0], -t.n[1]] as [number, number]].map((d) => (s0.march(p, d, 0.3)!.dist - s1.march(p, d, 0.3)!.dist) * fb!.height);
      for (const px of moved) expect(px).toBeGreaterThan(6);
      expect(Math.abs(moved[0] - moved[1])).toBeLessThan(0.35 * Math.max(...moved));
    });

    it('美臀 rounds the hip down into the thigh instead of a short lump that snaps back at the crotch', () => {
      const f = buildBodyField(m, setParam(defaultParams(), 'body.hip', 1), aspect)!;
      const mask = new MaskSampler(fb!.mask!, aspect);
      const L = m!.legs!;
      // outward displacement of the image-right silhouette edge, row by row from the hip line to the knee
      const prof: number[] = [];
      for (let y = L.hipY; y <= L.kneeY; y += 0.005) {
        let x = aspect;
        while (x > 0 && mask.at(x, y) < 0.5) x -= 0.001;
        prof.push(-fieldAt(f, x / aspect, y)[0] * fb!.width);
      }
      const peak = Math.max(...prof);
      expect(peak).toBeGreaterThan(4);
      // still widening at mid-thigh, and never more than a quarter of the peak gained or lost per 5 rows
      expect(prof[Math.round(prof.length / 2)]).toBeGreaterThan(0.25 * peak);
      for (let i = 1; i < prof.length; i++) expect(Math.abs(prof[i] - prof[i - 1])).toBeLessThan(0.25 * peak);
    });
  });
});

describe('draft builds (a drag step) and the per-measure mask cache', () => {
  const DRAFT = 128;
  const fig = syntheticFigure();
  const aspect = fig.width / fig.height;
  const draftScenes = scenes.filter((sc) => !sc.name.includes('landscape'));

  it('a draft field has the draft size and samples the same warp in UV as the full one', () => {
    const sets: ParamId[][] = [['body.waist'], ['body.slim'], ['body.legs'], ['body.head'], ALL];
    for (const sc of draftScenes) {
      const m = measureBody(sc.det, sc.face);
      const a = sc.det.width / sc.det.height;
      for (const ids of sets) {
        const p = withMax(ids);
        const full = buildBodyField(m, p, a);
        const draft = buildBodyField(m, p, a, full, DRAFT);
        if (!full) {
          expect(draft).toBeNull();
          continue;
        }
        const label = `${sc.name} ${ids.join('+')}`;
        expect([draft!.width, draft!.height], label).toEqual(fieldSize(a, DRAFT));
        expect(draft!.data, label).not.toBe(full.data); // a different size never reuses the buffer
        // Q-space displacement (image height = 1), sampled on a 200×200 UV lattice
        let peak = 0;
        let worst = 0;
        let sq = 0;
        let n = 0;
        for (let v = 0.0025; v < 1; v += 0.005)
          for (let u = 0.0025; u < 1; u += 0.005) {
            const [fx, fy] = fieldAt(full, u, v);
            const [dx, dy] = fieldAt(draft!, u, v);
            peak = Math.max(peak, Math.hypot(fx * a, fy));
            const e = Math.hypot((fx - dx) * a, fy - dy);
            worst = Math.max(worst, e);
            sq += e * e;
            n++;
          }
        expect(peak, label).toBeGreaterThan(0.003);
        // within half a draft texel everywhere (silhouette edges / the 背景保護 ring), and close on average
        expect(worst, label).toBeLessThan(0.5 / DRAFT);
        expect(Math.sqrt(sq / n), label).toBeLessThan(0.05 * peak);
      }
    }
  });

  for (const sc of scenes) {
    it(`${sc.name}: draft fields never fold either (min det J ≥ MIN_DET > 0.3)`, () => {
      const m = measureBody(sc.det, sc.face);
      const a = sc.det.width / sc.det.height;
      const cases: BeautyParams[] = [
        ...ALL.map((id) => withMax([id])),
        setParam(defaultParams(), 'body.hip', 1),
        setParam(withMax(ALL), 'body.hip', 1),
        setParam(withMax(ALL), 'body.hip', 0),
        setBodyProtect(withMax(ALL), false),
        setHeightBand(withMax(ALL), { top: 0.1, bottom: 0.9, amount: 1 }),
      ];
      for (const p of cases) {
        const f = buildBodyField(m, p, a, null, DRAFT);
        if (!f) continue;
        expect([f.width, f.height]).toEqual(fieldSize(a, DRAFT));
        expect(fieldMinJacobian(f)).toBeGreaterThan(0.3);
        expect(fieldMinJacobian(f)).toBeGreaterThanOrEqual(MIN_DET);
      }
    });
  }

  it('the mask grid is built once per measure and size, reused across slider changes, and changes nothing', () => {
    const m = measureBody(fig.det, fig.face);
    const n0 = bodyFieldCacheStats.maskGrids;
    const waist = (x: number) => setParam(defaultParams(), 'body.waist', x);
    const warm = buildBodyField(m, waist(0.5), aspect)!;
    buildBodyField(m, waist(0.8), aspect);
    buildBodyField(m, withMax(['body.slim', 'body.arms']), aspect);
    expect(bodyFieldCacheStats.maskGrids - n0).toBe(1);
    // 背景保護 off and the manual band alone never touch the mask
    buildBodyField(m, setBodyProtect(waist(1), false), aspect);
    buildBodyField(m, setHeightBand(defaultParams(), { top: 0.3, bottom: 0.6, amount: 1 }), aspect);
    expect(bodyFieldCacheStats.maskGrids - n0).toBe(1);
    // a draft is another grid size: one more, then reused too
    buildBodyField(m, waist(0.6), aspect, null, DRAFT);
    buildBodyField(m, waist(0.7), aspect, null, DRAFT);
    expect(bodyFieldCacheStats.maskGrids - n0).toBe(2);
    // a new detection is a new measure object: built afresh, and the cached build is bit-identical to it
    const fresh = { ...m };
    const cold = buildBodyField(fresh, waist(0.5), aspect)!;
    expect(bodyFieldCacheStats.maskGrids - n0).toBe(3);
    const again = buildBodyField(m, waist(0.5), aspect)!;
    expect(bodyFieldCacheStats.maskGrids - n0).toBe(3);
    expect(Array.from(again.data)).toEqual(Array.from(cold.data));
    expect(Array.from(warm.data)).toEqual(Array.from(cold.data));
  });

  it('timing: a warm full build (one slider) beats a cold one, and a draft beats both', () => {
    // relative checks on interleaved minima only (load spikes hit both sides); the numbers are reported
    const m = measureBody(fig.det, fig.face);
    const RUNS = 15;
    const t = { cold: Infinity, warm: Infinity, draft: Infinity };
    const time = (k: keyof typeof t, fn: () => unknown) => {
      const t0 = performance.now();
      fn();
      t[k] = Math.min(t[k], performance.now() - t0);
    };
    buildBodyField(m, setParam(defaultParams(), 'body.waist', 0.2), aspect); // warm the JIT and the cache
    buildBodyField(m, setParam(defaultParams(), 'body.waist', 0.2), aspect, null, DRAFT);
    for (let i = 0; i < RUNS; i++) {
      const p = setParam(defaultParams(), 'body.waist', 0.3 + (0.7 * i) / RUNS);
      time('cold', () => buildBodyField({ ...m }, p, aspect)); // a measure the cache has never seen
      time('warm', () => buildBodyField(m, p, aspect));
      time('draft', () => buildBodyField(m, p, aspect, null, DRAFT));
    }
    console.info(
      `buildBodyField 細腰 (${fieldSize(aspect, BODY_FIELD_LONG_EDGE).join('×')} full / ${fieldSize(aspect, DRAFT).join('×')} draft), min of ${RUNS}: ` +
        `cold ${t.cold.toFixed(2)} ms, warm ${t.warm.toFixed(2)} ms, draft ${t.draft.toFixed(2)} ms`,
    );
    expect(t.warm).toBeLessThan(t.cold);
    expect(t.draft).toBeLessThan(0.6 * t.warm);
  });
});
