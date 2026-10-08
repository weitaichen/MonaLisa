import { describe, expect, it } from 'vitest';
import type { BodyField } from '../types';
import { bodyFieldValid, bodyUploadNeeded, MAX_BODY_FIELD_EDGE, planPasses, type BodyUploadKey, type PassPlanInput } from './pipeline';

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
  bodyOn: false,
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

describe('planPasses with a body field', () => {
  it('runs reshape for a body-only frame (no face), but no face pass', () => {
    expect(planPasses({ ...base, hasFace: false, bodyOn: true })).toEqual({ mask: false, makeup: false, reshape: true, mean: true });
  });

  it('runs reshape at faceWeight 0 and with every face delta 0 when the body is on', () => {
    expect(planPasses({ ...base, faceWeight: 0, bodyOn: true })).toMatchObject({ mask: false, makeup: false, reshape: true });
    expect(planPasses({ ...base, reshapeActive: false, bodyOn: true }).reshape).toBe(true);
  });

  it('keeps the face plan unchanged when the body is off', () => {
    for (const i of [base, { ...base, hasFace: false }, { ...base, faceWeight: 0 }, { ...base, reshapeActive: false }]) {
      const { reshape, ...rest } = planPasses({ ...i, bodyOn: true });
      const { reshape: r0, ...rest0 } = planPasses(i);
      expect(rest).toEqual(rest0);
      expect(reshape).toBe(true);
      expect(r0).toBe(i.hasFace && i.faceWeight > 0 && i.reshapeActive);
    }
  });
});

const field = (width: number, height: number, version = 1): BodyField => ({ width, height, data: new Float32Array(width * height * 2), version });

describe('bodyFieldValid', () => {
  it('accepts a well-formed field, also with a longer buffer', () => {
    expect(bodyFieldValid(field(192, 256))).toBe(true);
    expect(bodyFieldValid({ ...field(4, 4), data: new Float32Array(64) })).toBe(true);
  });

  it('rejects empty / fractional / oversized sizes and short or wrongly typed data', () => {
    expect(bodyFieldValid(field(0, 256))).toBe(false);
    expect(bodyFieldValid({ ...field(4, 4), width: 4.5 })).toBe(false);
    expect(bodyFieldValid(field(MAX_BODY_FIELD_EDGE + 1, 2))).toBe(false);
    expect(bodyFieldValid({ ...field(4, 4), data: new Float32Array(31) })).toBe(false);
    expect(bodyFieldValid({ ...field(4, 4), data: new Float64Array(32) as unknown as Float32Array })).toBe(false);
  });
});

describe('bodyUploadNeeded', () => {
  const keyOf = (f: BodyField): BodyUploadKey => ({ field: f, data: f.data, version: f.version, width: f.width, height: f.height, usable: true });

  it('uploads the first field and again only when version, size, buffer or object change', () => {
    const f = field(8, 6, 3);
    expect(bodyUploadNeeded(null, f)).toBe(true);
    const k = keyOf(f);
    expect(bodyUploadNeeded(k, f)).toBe(false);
    f.version++;
    expect(bodyUploadNeeded(k, f)).toBe(true);
    expect(bodyUploadNeeded(keyOf(f), { ...f })).toBe(true); // new object, same version
    const g = field(8, 6, 3);
    expect(bodyUploadNeeded(keyOf(f), { ...f, data: g.data })).toBe(true);
    expect(bodyUploadNeeded(keyOf(f), { ...f, width: 6, height: 8 })).toBe(true);
  });
});
