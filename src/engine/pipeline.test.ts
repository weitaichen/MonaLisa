import { describe, expect, it } from 'vitest';
import { makeFace } from '../app/testFakes';
import type { BodyField, FaceProtect } from '../types';
import {
  bodyFieldValid,
  bodyUploadNeeded,
  faceProtectValid,
  MAX_BODY_FIELD_EDGE,
  pickFull,
  planFrame,
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
  // a beautified face: v0.3's clear 1 − w
  maskClear: [0, 0],
  matchGpupixel: false,
  skin: skinOn,
  makeupActive: true,
  makeupReady: true,
  reshapeActive: true,
  bodyOn: false,
  adjustOn: false,
};
/** no face: the global skin at weight 1 (clear 1) */
const noFace = { anyFace: false, maskClear: [1, 1] } satisfies Partial<PassPlanInput>;

describe('planPasses', () => {
  it('runs everything with a face and active params', () => {
    expect(planPasses(base)).toEqual({ mask: true, makeup: true, reshape: true, mean: true, adjust: false });
  });

  it('skips every face pass without a face, keeping skin', () => {
    expect(planPasses({ ...base, ...noFace })).toEqual({ mask: false, makeup: false, reshape: false, mean: true, adjust: false });
  });

  it('skips face passes at faceWeight 0', () => {
    expect(planPasses({ ...base, ...noFace })).toMatchObject({ mask: false, makeup: false, reshape: false });
  });

  it('match-GPUPixel mode disables only the mask', () => {
    expect(planPasses({ ...base, matchGpupixel: true })).toEqual({ mask: false, makeup: true, reshape: true, mean: true, adjust: false });
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

describe('planPasses: the mask clear (S §3.3, A2)', () => {
  it('keeps the mask pass when no listed face has weight but the clear is below 1: the clear carries the global weight', () => {
    expect(planPasses({ ...base, anyFace: false, maskClear: [0, 0] }).mask).toBe(true);
    expect(planPasses({ ...base, anyFace: false, maskClear: [0.4, 0.4] }).mask).toBe(true);
    expect(planPasses({ ...base, anyFace: false, maskClear: [1, 0] }).mask).toBe(true);
  });

  it('skips it only when the mask would be white in every channel the composite uses', () => {
    expect(planPasses({ ...base, ...noFace }).mask).toBe(false);
    // a strength of 0 makes its channel's clear irrelevant (skinMaxima clears it to 0 then)
    expect(planPasses({ ...base, anyFace: false, maskClear: [0, 1], skin: { ...skinOn, smooth: 0 } }).mask).toBe(false);
    expect(planPasses({ ...base, anyFace: false, maskClear: [1, 0], skin: { ...skinOn, rosy: 0 } }).mask).toBe(false);
  });

  it('the clear turns on no face pass, and no mask in match-GPUPixel mode or without mean', () => {
    expect(planPasses({ ...base, anyFace: false, maskClear: [0, 0] })).toEqual({ mask: true, makeup: false, reshape: false, mean: true, adjust: false });
    expect(planPasses({ ...base, anyFace: false, maskClear: [0, 0], matchGpupixel: true }).mask).toBe(false);
    expect(planPasses({ ...base, anyFace: false, maskClear: [0, 0], skin: skinOff }).mask).toBe(false);
  });
});

describe('planFrame (run()’s plan of a job)', () => {
  const reshape = { faceSlim: 0.1, faceV: 0, faceNarrow: 0, chin: 0, forehead: 0, noseSlim: 0, mouthSize: 0, eyeDistance: 0, eyeEnlarge: 0 };
  const makeup = { lip: 0.5, blush: 0, lipColor: null, blushColor: null };
  const job = (weights: number[], maskClear: [number, number]) => ({
    faces: weights.map((weight) => ({ weight, reshape, makeup })),
    maskClear,
    matchGpupixel: false,
    skin: skinOn,
    adjust: { on: false },
  });

  it('a face with weight drives every face pass', () => {
    expect(planFrame(job([1, 0], [0, 0]), true, false)).toEqual({ mask: true, makeup: true, reshape: true, mean: true, adjust: false });
  });

  it('two listed faces at weight 0 (the target track lost beside a present face): the mask pass stays on with clear 0', () => {
    expect(planFrame(job([0, 0], [0, 0]), true, false)).toEqual({ mask: true, makeup: false, reshape: false, mean: true, adjust: false });
  });

  it('no listed face and the global skin at weight 1: no face pass, the white mask', () => {
    expect(planFrame(job([], [1, 1]), true, false)).toEqual({ mask: false, makeup: false, reshape: false, mean: true, adjust: false });
  });

  it('the 調節 program follows the job’s adjust.on (step-2 spec §4.1)', () => {
    expect(planFrame({ ...job([1, 0], [0, 0]), adjust: { on: true } }, true, false)).toEqual({ mask: true, makeup: true, reshape: true, mean: true, adjust: true });
    expect(planFrame({ ...job([], [1, 1]), adjust: { on: true } }, true, false).adjust).toBe(true);
  });
});

describe('planPasses: the 調節 program (step-2 spec §4.1)', () => {
  it('adjust follows adjustOn exactly and changes no other pass', () => {
    const off = planPasses({ ...base, adjustOn: false });
    const on = planPasses({ ...base, adjustOn: true });
    expect(off.adjust).toBe(false);
    expect(on.adjust).toBe(true);
    expect({ ...on, adjust: false }).toEqual(off);
  });
});

describe('planPasses with a body field', () => {
  it('runs reshape for a body-only frame (no face), but no face pass', () => {
    expect(planPasses({ ...base, ...noFace, bodyOn: true })).toEqual({ mask: false, makeup: false, reshape: true, mean: true, adjust: false });
  });

  it('runs reshape at faceWeight 0 and with every face delta 0 when the body is on', () => {
    expect(planPasses({ ...base, ...noFace, bodyOn: true })).toMatchObject({ mask: false, makeup: false, reshape: true });
    expect(planPasses({ ...base, reshapeActive: false, bodyOn: true }).reshape).toBe(true);
  });

  it('keeps the face plan unchanged when the body is off', () => {
    for (const i of [base, { ...base, ...noFace }, { ...base, ...noFace }, { ...base, reshapeActive: false }]) {
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

describe('planPasses with geometry and windows (step 3)', () => {
  const quiet: PassPlanInput = { ...base, anyFace: false, reshapeActive: false, bodyOn: false };
  it('identity geometry and no window keep P2 skipped (v0.3 parity)', () => {
    expect(planPasses({ ...quiet, geoIdentity: true, windowed: false }).reshape).toBe(false);
    expect(planPasses(quiet).reshape).toBe(false);
  });
  it('a geometry or a window always runs P2', () => {
    expect(planPasses({ ...quiet, geoIdentity: false }).reshape).toBe(true);
    expect(planPasses({ ...quiet, windowed: true }).reshape).toBe(true);
  });
});

describe('pickFull (skin-cleanup spec §4.1 ping-pong)', () => {
  it('a pass writes its preferred buffer unless that buffer is its input', () => {
    expect(pickFull('A', null)).toBe('A');
    expect(pickFull('B', null)).toBe('B');
    expect(pickFull('A', 'A')).toBe('B');
    expect(pickFull('B', 'A')).toBe('B');
    expect(pickFull('B', 'B')).toBe('A');
    expect(pickFull('A', 'B')).toBe('A');
  });

  it('every pass on: P0b src→A, P0d A→B, P1 B→A, P2 A→B; the capture then takes A', () => {
    let cur: 'A' | 'B' | null = null;
    const chain = (['A', 'B', 'A', 'B'] as const).map((prefer) => (cur = pickFull(prefer, cur)));
    expect(chain).toEqual(['A', 'B', 'A', 'B']);
    expect(cur === 'A' ? 'B' : 'A').toBe('A');
  });

  it('no step-4 pass: makeup still writes A and reshape B, as v0.3 does', () => {
    expect(pickFull('A', null)).toBe('A');
    expect(pickFull('B', 'A')).toBe('B');
    expect(pickFull('B', null)).toBe('B');
  });
});
