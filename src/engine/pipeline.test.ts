import { describe, expect, it } from 'vitest';
import { makeFace } from '../app/testFakes';
import type { BodyField, FaceProtect } from '../types';
import {
  bodyFieldValid,
  bodyUploadNeeded,
  faceProtectValid,
  MAX_BODY_FIELD_EDGE,
  planPasses,
  protectUploadNeeded,
  tableFaces,
  type BodyUploadKey,
  type FrameFace,
  type PassPlanInput,
  type ProtectUploadKey,
} from './pipeline';

const skinOn = { smooth: 0.55, sharpen: 0.4, whiten: 0.125, rosy: 0.0875, filterAmount: 0 };
const skinOff = { smooth: 0, sharpen: 0, whiten: 0, rosy: 0, filterAmount: 0 };

const base: PassPlanInput = {
  anyFace: true,
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
    expect(planPasses({ ...base, anyFace: false })).toEqual({ mask: false, makeup: false, reshape: false, mean: true });
  });

  it('skips face passes at faceWeight 0', () => {
    expect(planPasses({ ...base, anyFace: false })).toMatchObject({ mask: false, makeup: false, reshape: false });
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
    expect(planPasses({ ...base, anyFace: false, bodyOn: true })).toEqual({ mask: false, makeup: false, reshape: true, mean: true });
  });

  it('runs reshape at faceWeight 0 and with every face delta 0 when the body is on', () => {
    expect(planPasses({ ...base, anyFace: false, bodyOn: true })).toMatchObject({ mask: false, makeup: false, reshape: true });
    expect(planPasses({ ...base, reshapeActive: false, bodyOn: true }).reshape).toBe(true);
  });

  it('keeps the face plan unchanged when the body is off', () => {
    for (const i of [base, { ...base, anyFace: false }, { ...base, anyFace: false }, { ...base, reshapeActive: false }]) {
      const { reshape, ...rest } = planPasses({ ...i, bodyOn: true });
      const { reshape: r0, ...rest0 } = planPasses(i);
      expect(rest).toEqual(rest0);
      expect(reshape).toBe(true);
      expect(r0).toBe(i.anyFace && i.reshapeActive);
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

describe('faceProtectValid / protectUploadNeeded (瘦臉 background limit)', () => {
  const prot = (w: number, h: number): FaceProtect => ({ width: w, height: h, data: new Float32Array(w * h), version: 1 });
  it('accepts a positive integer size within the cap with enough floats', () => {
    expect(faceProtectValid(prot(192, 256))).toBe(true);
    expect(faceProtectValid({ ...prot(4, 4), data: new Float32Array(20) })).toBe(true);
    expect(faceProtectValid(prot(0, 4))).toBe(false);
    expect(faceProtectValid({ ...prot(4, 4), height: 4.5 })).toBe(false);
    expect(faceProtectValid(prot(MAX_BODY_FIELD_EDGE + 1, 1))).toBe(false);
    expect(faceProtectValid({ ...prot(4, 4), data: new Float32Array(15) })).toBe(false);
    expect(faceProtectValid({ ...prot(4, 4), data: new Uint8Array(16) as unknown as Float32Array })).toBe(false);
  });
  it('re-uploads only when the object, buffer, version or size changes', () => {
    const p = prot(4, 4);
    const keyOf = (q: FaceProtect): ProtectUploadKey => ({ protect: q, data: q.data, version: q.version, width: q.width, height: q.height, usable: true });
    expect(protectUploadNeeded(null, p)).toBe(true);
    expect(protectUploadNeeded(keyOf(p), p)).toBe(false);
    expect(protectUploadNeeded(keyOf(p), { ...p })).toBe(true);
    expect(protectUploadNeeded(keyOf(p), { ...p, version: 2 })).toBe(true);
    const k = keyOf(p);
    p.version++;
    expect(protectUploadNeeded(k, p)).toBe(true);
  });
});

describe('tableFaces (S §4.1)', () => {
  const f = (cx: number, over: Partial<FrameFace> = {}): FrameFace => ({
    face: makeFace(0, cx),
    weight: 1,
    reshape: { faceSlim: 0.1, faceV: 0, faceNarrow: 0, chin: 0, forehead: 0, noseSlim: 0, mouthSize: 0, eyeDistance: 0, eyeEnlarge: 0 },
    makeup: { lip: 0, blush: 0, lipColor: null, blushColor: null },
    kS: 1,
    kR: 1,
    protect: null,
    centre: [cx, 0.5],
    presence: 1,
    ...over,
  });
  const prot = { width: 4, height: 4, data: new Float32Array(16), version: 1 };
  it('one face: no cap; its limit is layer 0 over the whole photo', () => {
    const t = tableFaces({ faces: [f(0.5, { protect: prot })], obstacles: [] }, 1);
    expect(t.faces[0]).toMatchObject({ cap: -1, layer: 0, window: { x: 0, y: 0, w: 1, h: 1 } });
    expect(t.protects).toEqual([prot]);
  });
  it('two faces and an obstacle: caps; a neutral or weight-0 face is listed with zero deltas and no layer', () => {
    const neutral = f(0.7, { reshape: { ...f(0).reshape, faceSlim: 0 }, protect: prot });
    const t = tableFaces({ faces: [f(0.3), neutral, f(0.9, { weight: 0 })], obstacles: [[0.4, 0.5]] }, 1);
    expect(t.faces[0].cap).toBeCloseTo(0.05);
    expect(t.faces[1].layer).toBe(-1);
    expect(Object.values(t.faces[2].u).every((v) => v === 0)).toBe(true);
  });
});
