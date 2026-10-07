import { describe, expect, it } from 'vitest';
import { planPasses, type PassPlanInput } from './pipeline';

const skinOn = { smooth: 0.55, sharpen: 0.4, whiten: 0.125, rosy: 0.0875, filterAmount: 0 };
const skinOff = { smooth: 0, sharpen: 0, whiten: 0, rosy: 0, filterAmount: 0 };

const base: PassPlanInput = {
  hasFace: true,
  faceWeight: 1,
  matchGpupixel: false,
  skin: skinOn,
  makeupActive: true,
  makeupReady: true,
  reshapeActive: true,
};

describe('planPasses', () => {
  it('runs everything with a face and active params', () => {
    expect(planPasses(base)).toEqual({ mask: true, makeup: true, reshape: true, mean: true });
  });

  it('skips every face pass without a face, keeping skin', () => {
    expect(planPasses({ ...base, hasFace: false })).toEqual({ mask: false, makeup: false, reshape: false, mean: true });
  });

  it('skips face passes at faceWeight 0', () => {
    expect(planPasses({ ...base, faceWeight: 0 })).toMatchObject({ mask: false, makeup: false, reshape: false });
  });

  it('match-GPUPixel mode disables only the mask', () => {
    expect(planPasses({ ...base, matchGpupixel: true })).toEqual({ mask: false, makeup: true, reshape: true, mean: true });
  });

  it('skips makeup until its textures are ready, and when inactive', () => {
    expect(planPasses({ ...base, makeupReady: false }).makeup).toBe(false);
    expect(planPasses({ ...base, makeupActive: false }).makeup).toBe(false);
    expect(planPasses({ ...base, reshapeActive: false }).reshape).toBe(false);
  });

  it('skips mean and mask when neither smoothing nor rosy is on', () => {
    expect(planPasses({ ...base, skin: { ...skinOff, sharpen: 0.4, whiten: 0.2 } })).toMatchObject({ mean: false, mask: false });
  });
});
