import { describe, expect, it } from 'vitest';
import { BLUSH_BOUNDS, FACE_INDICES, FACE_TEMPLATE, LIP_BOUNDS, TEMPLATE_FRAME, templateUvs } from './faceMesh';

const P = (i: number) => [FACE_TEMPLATE[i * 2], FACE_TEMPLATE[i * 2 + 1]];

describe('faceMesh (GPUPixel template)', () => {
  it('has 111 points × 2 coords, all inside the unit frame', () => {
    expect(FACE_TEMPLATE.length).toBe(222);
    for (const v of FACE_TEMPLATE) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('has 528 indices (176 triangles), all < 111, covering every point', () => {
    expect(FACE_INDICES.length).toBe(528);
    const used = new Set<number>();
    for (const i of FACE_INDICES) {
      expect(i).toBeLessThan(111);
      used.add(i);
    }
    expect(used.size).toBe(111);
  });

  it('spot-checks verbatim values and template rules', () => {
    expect(P(0)[0]).toBeCloseTo(0.302451, 6);
    expect(P(16)[0]).toBe(0.5);
    expect(P(16)[1]).toBeCloseTo(0.709867, 6);
    expect(P(110)[0]).toBeCloseTo(0.613928, 6);
    expect(Array.from(FACE_INDICES.slice(0, 6))).toEqual([33, 34, 64, 64, 34, 65]);
    expect(Array.from(FACE_INDICES.slice(-3))).toEqual([24, 90, 25]);
    // 104/105 (pupils) equal 74/77; 106 = mid(98,102) (RB §2.7 template-midpoint rules)
    expect(P(104)).toEqual(P(74));
    expect(P(105)).toEqual(P(77));
    expect(P(106)[1]).toBeCloseTo((P(98)[1] + P(102)[1]) / 2, 5);
  });

  it('template contour is mirror-symmetric about x = 0.5 (0 ↔ 32)', () => {
    for (let i = 0; i <= 32; i++) {
      expect(P(i)[0] + P(32 - i)[0]).toBeCloseTo(1, 5);
      expect(P(i)[1]).toBeCloseTo(P(32 - i)[1], 5);
    }
  });

  it('makeup UVs follow (template·1280 − bounds.xy)/bounds.wh and frame the lips / cheeks', () => {
    const lip = templateUvs(LIP_BOUNDS);
    const blush = templateUvs(BLUSH_BOUNDS);
    expect(lip[0]).toBeCloseTo((FACE_TEMPLATE[0] * TEMPLATE_FRAME - 502.5) / 262.5, 6);
    for (let i = 84; i <= 103; i++) {
      for (const c of [lip[i * 2], lip[i * 2 + 1]]) {
        expect(c).toBeGreaterThan(0);
        expect(c).toBeLessThan(1);
      }
    }
    for (const i of [109, 110]) {
      for (const c of [blush[i * 2], blush[i * 2 + 1]]) {
        expect(c).toBeGreaterThan(0);
        expect(c).toBeLessThan(1);
      }
    }
  });
});
