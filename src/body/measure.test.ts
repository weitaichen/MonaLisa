import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BodyDetection, Face } from '../types';
import { adapt } from '../tracking/adapter111';
import { LM, measureBody, paramAvailability, REASONS } from './measure';
import { syntheticFigure } from './synthetic';
import { loadPoseFixture } from './fixtures.node';

const setVis = (det: BodyDetection, ids: number[], v: number) => {
  const pts = new Float32Array(det.pose.points);
  for (const i of ids) pts[i * 4 + 3] = v;
  return { ...det, pose: { points: pts } };
};

describe('measureBody', () => {
  const fig = syntheticFigure();

  it('measures widths from the mask (synthetic figure: known torso / limb sizes)', () => {
    const m = measureBody(fig.det, fig.face);
    expect(Object.values(m.regions).every((r) => r.ok)).toBe(true);
    const t = m.trunk!;
    // the synthetic torso has its narrowest point at t ≈ 0.6 and the shoulder half-width is 0.0567 (Q units)
    expect(t.waistT).toBeGreaterThan(0.45);
    expect(t.waistT).toBeLessThan(0.7);
    expect(t.waistW).toBeGreaterThan(0.04);
    expect(t.waistW).toBeLessThan(0.055);
    expect(t.hipW).toBeGreaterThan(t.waistW * 1.15);
    const upper = m.limbs.find((l) => l.kind === 'upperArm')!;
    expect(upper.w).toBeCloseTo(0.024, 2);
    // thighs drawn overlapping at the crotch: compressed on the outer side only
    const thighs = m.limbs.filter((l) => l.kind === 'thigh');
    expect(thighs.map((l) => l.side).sort()).toEqual([-1, 1]);
    expect(m.facing).toBe('front');
    expect(m.head?.faceH).toBeGreaterThan(0.08);
  });

  it('gates regions with 繁體中文 reasons', () => {
    expect(paramAvailability(null, 'body.legs')).toEqual({ ok: false, reason: REASONS.none });
    expect(paramAvailability(null, 'skin.smooth').ok).toBe(true);

    const noFace = measureBody(fig.det, null);
    expect(paramAvailability(noFace, 'body.head')).toEqual({ ok: false, reason: REASONS.noFace });
    expect(paramAvailability(noFace, 'body.neck').ok).toBe(false);
    expect(paramAvailability(noFace, 'body.waist').ok).toBe(true);

    const half = measureBody(syntheticFigure({ halfBody: true }).det, null);
    expect(paramAvailability(half, 'body.legs')).toEqual({ ok: false, reason: REASONS.legs });
    expect(paramAvailability(half, 'body.legSlim').reason).toBe('拍攝全身照可使用長腿／瘦腿');

    const hiddenKnee = measureBody(setVis(fig.det, [LM.lKnee], 0.4), fig.face);
    expect(hiddenKnee.regions.legs.ok).toBe(false);
    expect(hiddenKnee.regions.torso.ok).toBe(true);

    const noHips = measureBody(setVis(fig.det, [LM.lHip, LM.rHip], 0.3), fig.face);
    expect(paramAvailability(noHips, 'body.slim')).toEqual({ ok: false, reason: REASONS.torso });
    expect(paramAvailability(noHips, 'body.shoulder').ok).toBe(true);

    const noArm = measureBody(setVis(fig.det, [LM.lWrist, LM.rWrist], 0.2), fig.face);
    expect(paramAvailability(noArm, 'body.arms')).toEqual({ ok: false, reason: REASONS.arms });

    const noMask = measureBody({ ...fig.det, mask: null }, fig.face);
    expect(paramAvailability(noMask, 'body.whr')).toEqual({ ok: false, reason: REASONS.whrMask });
    expect(paramAvailability(noMask, 'body.waist').ok).toBe(true); // conservative keypoint widths
  });

  it('rejects a person too small in the frame', () => {
    const det = fig.det;
    const pts = new Float32Array(det.pose.points);
    for (let i = 0; i < 33; i++) {
      pts[i * 4] = 0.5 + (pts[i * 4] - 0.5) * 0.4;
      pts[i * 4 + 1] = 0.5 + (pts[i * 4 + 1] - 0.5) * 0.4;
    }
    const m = measureBody({ ...det, mask: null, pose: { points: pts } }, null);
    expect(m.regions.torso).toEqual({ ok: false, reason: REASONS.small });
  });

  it('keypoints outside the frame margin count as missing', () => {
    const pts = new Float32Array(fig.det.pose.points);
    pts[LM.lFoot * 4 + 1] = 0.995;
    expect(measureBody({ ...fig.det, pose: { points: pts } }, null).regions.legs.ok).toBe(false);
  });

  it('turns 直角肩 off with raised arms', () => {
    const pts = new Float32Array(fig.det.pose.points);
    // elbows level with the shoulders
    pts[LM.lElbow * 4 + 1] = pts[LM.lShoulder * 4 + 1];
    pts[LM.rElbow * 4 + 1] = pts[LM.rShoulder * 4 + 1];
    const m = measureBody({ ...fig.det, pose: { points: pts } }, null);
    expect(paramAvailability(m, 'body.shoulder')).toEqual({ ok: false, reason: REASONS.armsRaised });
  });

  const real = loadPoseFixture('pose_fullbody.json');
  it.skipIf(!real)('fixture fullbody.jpg: every region except the head (masked face, no Face passed) is usable', () => {
    const m = measureBody(real!, null);
    expect(m.regions.torso.ok && m.regions.legs.ok && m.regions.arms.ok && m.regions.shoulder.ok).toBe(true);
    expect(m.regions.head.ok).toBe(false);
    // mask widths exceed the joint distance (the hip joints sit inside the pelvis)
    const t = m.trunk!;
    expect(t.hipW * 2).toBeGreaterThan(t.len * 0.4);
    expect(t.waistW).toBeLessThan(t.hipW);
  });

  const portrait = loadPoseFixture('sample_face.pose.json');
  it.skipIf(!portrait)('portrait close-up: shoulders hidden under the hair → 直角肩 off (it would warp the jaw), head tools on', () => {
    const lm = JSON.parse(readFileSync('tests/fixtures/landmarks_sample_face.json', 'utf8')) as { width: number; height: number; points: number[] };
    const face: Face = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
    const m = measureBody(portrait!, face);
    expect(paramAvailability(m, 'body.shoulder')).toEqual({ ok: false, reason: REASONS.shoulder });
    expect(m.shoulders).toBeNull();
    expect(paramAvailability(m, 'body.head').ok).toBe(true);
    expect(paramAvailability(m, 'body.waist')).toEqual({ ok: false, reason: REASONS.torso });
  });

  it.skipIf(!real)('fixture fullbody.jpg: the waist is placed where both flanks are visible, not at the hand on the belly', () => {
    const m = measureBody(real!, null);
    const t = m.trunk!;
    // the forearm and hand cross the torso at t ≈ 0.4–0.6; the visible (narrowest open) waist is below them
    expect(t.waistT).toBeGreaterThan(0.62);
    expect(t.waistT).toBeLessThanOrEqual(0.75);
    // the shoulder contour is found on both sides of a full-body shot
    expect(m.shoulders?.found).toEqual([true, true]);
    expect(m.legs!.ankleY).toBeGreaterThan(m.legs!.kneeY);
    expect(m.legs!.ankleY).toBeLessThan(m.legs!.feetY);
  });
});
