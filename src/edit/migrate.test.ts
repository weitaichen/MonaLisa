import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyPreset, defaultParams, PARAM_DEFS, sanitizeParams, setParam } from '../engine/params';
import { makeBodyDetection } from '../app/testFakes';
import { adaptCached, boxIoU, prepareFaces } from '../detect/faces';
import { seedPrimary } from '../detect/persons';
import { normalizeDetect, withBodies } from '../detect/cache';
import { cacheBody, makeCache } from '../detect/testCaches';
import { sampleFaceAt } from '../detect/testMeshes';
import { boxCentre, capsFor, ovalBox } from '../engine/passes/faceCap';
import { cropValid, IDENTITY_GEOMETRY, maxFit } from '../geometry/view';
import { normalizeEntry } from '../store/history';
import { stableKey } from '../store/undo';
import type { BeautyParams, DetectionCache, EditState, Face, HistoryEntry, Landmarks478, ParamId, Pose33, Stroke } from '../types';
import { buildFrame } from './frame';
import { editFromLegacy, legacyProjection, splitLegacy } from './legacy';
import { bodyAnswer, completeAnswer, firstAnswer, handOverEdit, handOverOf, importEdit, openState, preAnswerCache } from './migrate';
import { assignPersons, defaultPhoto, editFlipView, naturalPerson, neutralPerson, neutralPhoto, personFromPreset, resetAll, withPersons } from './state';
import { completionOf, frameFacesOf, protectRequests, sessionPlan } from '../ui/editorModel';

const SIZE = { width: 2048, height: 1536 };
const v1 = (over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: 'e',
  createdAt: 1,
  updatedAt: 1,
  original: new Blob([]),
  thumb: new Blob([]),
  params: applyPreset('refined', 1),
  width: 2048,
  height: 1536,
  ...over,
});
const v2 = (over: Partial<HistoryEntry> = {}): HistoryEntry => {
  const edit = assignPersons(editFromLegacy(applyPreset('glow', 1), { primaryInit: true }), ['f0', 'f1'], 'f0');
  const params = sanitizeParams(legacyProjection(edit, 'f0'));
  return v1({ schema: 2, edit, params, paramsKey: stableKey(params), detect: makeCache(), ...over });
};
/** a stored record read back as the editor reads it: normalizeEntry (which checks paramsKey), then openState */
const reopen = (raw: unknown, size = SIZE) => openState(normalizeEntry(raw)!, size);

describe('openState (S §5.3)', () => {
  it('v1, no body: the look on p0 and as primaryInit, the template neutral, detection wanted', () => {
    const o = openState(v1(), SIZE);
    expect(Object.keys(o.edit.persons)).toEqual(['p0']);
    expect(o.edit.primaryInit).toEqual(splitLegacy(applyPreset('refined', 1)).person);
    expect(o.edit.template).toEqual(neutralPerson());
    expect(o).toMatchObject({ detect: null, rematch: null, v1Body: null, cacheDropped: false });
    expect(sessionPlan(o.detect, true).asks).toBe(true);
    expect(legacyProjection(o.edit, 'p0')).toEqual(applyPreset('refined', 1));
  });
  it('v1 with a body: b0, complete for people = 1 and not for ≥ 2; body null = nobody, complete', () => {
    expect(openState(v1({ body: makeBodyDetection(1, 2048, 1536) }), SIZE).v1Body).toMatchObject({ complete: true, bodies: [{ id: 'b0' }] });
    expect(openState(v1({ body: makeBodyDetection(3, 2048, 1536) }), SIZE).v1Body?.complete).toBe(false);
    expect(openState(v1({ body: null }), SIZE).v1Body).toEqual({ bodies: [], complete: true });
  });
  it('v1 with a body taken at another aspect: not trusted (美體 re-detects, as cachedBodyFits did in 0.3)', () => {
    expect(openState(v1({ body: makeBodyDetection(1, 1536, 2048) }), SIZE).v1Body).toBeNull();
    expect(openState(v1({ body: makeBodyDetection(1, 1440, 1080) }), SIZE).v1Body).toMatchObject({ bodies: [{ id: 'b0' }] });
    expect(openState(v1({ body: makeBodyDetection(1, 2048, 1536) }), { width: 0, height: 0 }).v1Body).toBeNull();
    expect(openState(v1({ body: null }), { width: 1536, height: 2048 }).v1Body).toEqual({ bodies: [], complete: true });
    const edit = editFromLegacy(applyPreset('refined', 1), { primaryInit: true });
    const closed = v1({ schema: 2, edit, params: legacyProjection(edit, 'p0'), body: makeBodyDetection(1, 1536, 2048) });
    expect(openState(closed, SIZE).v1Body).toBeNull();
  });
  it('v1 with a cache (defensive): p0 goes to the cache primary at once, no detection', () => {
    const o = openState(v1({ detect: makeCache({ primary: 'f1' }) }), SIZE);
    expect(Object.keys(o.edit.persons).sort()).toEqual(['f0', 'f1']);
    expect(o.edit.persons.f1).toEqual(splitLegacy(applyPreset('refined', 1)).person);
    expect(sessionPlan(o.detect, true).asks).toBe(false);
  });
  it('v2 with a fitting cache: used as is, no detector (also at a 1440 decode)', () => {
    const o = openState(v2(), { width: 1440, height: 1080 });
    expect(o.detect).toEqual(makeCache());
    expect(sessionPlan(o.detect, true).asks).toBe(false);
    expect(Object.keys(o.edit.persons).sort()).toEqual(['f0', 'f1']);
  });
  it('v2 with a 基本模式 cache: the cache, plus one detection when a tracker exists', () => {
    const o = openState(v2({ detect: makeCache({ faceScans: [] }) }), SIZE);
    expect(o.detect).not.toBeNull();
    expect(sessionPlan(o.detect, true).asks).toBe(true);
  });
  it('v2 closed before an answer: the stored edit with p0, detection wanted', () => {
    const edit = editFromLegacy(setParam(defaultParams(), 'shape.eyeEnlarge', 0.8), { primaryInit: true });
    const o = openState(v1({ schema: 2, edit, params: legacyProjection(edit, 'p0') }), SIZE);
    expect(o.edit.persons.p0.values['shape.eyeEnlarge']).toBe(0.8);
    expect(sessionPlan(o.detect, true).asks).toBe(true);
  });
  it('v2 whose cache does not fit: dropped, persons kept for the rematch, toast', () => {
    const o = openState(v2(), { width: 1536, height: 2048 });
    expect(o.detect).toBeNull();
    expect(Object.keys(o.edit.persons).sort()).toEqual(['f0', 'f1']);
    expect(o.rematch).toEqual({ f0: makeCache().faces[0].box, f1: makeCache().faces[1].box });
    expect(o).toMatchObject({ cacheDropped: true });
    expect(sessionPlan(o.detect, true).asks).toBe(true);
  });
  it('v2 whose cache was corrupt: the stale boxes from normalizeEntry drive the rematch', () => {
    const o = openState(v2({ detect: undefined, staleBoxes: { f0: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }, detectLost: true }), SIZE);
    expect(o.rematch).toEqual({ f0: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } });
    expect(o.cacheDropped).toBe(true);
  });
  it('v2 whose edit is unusable opens as v1 from params', () => {
    const o = openState(v1({ schema: 2, edit: undefined }), SIZE);
    expect(Object.keys(o.edit.persons)).toEqual(['p0']);
  });
  it('a paramsKey mismatch (0.3 edited the entry after a rollback) rebuilds the photo and the primary from params', () => {
    const edited = setParam(applyPreset('glow', 1), 'skin.whiten', 0.9);
    const o = reopen(v2({ params: sanitizeParams(edited) }));
    expect(o.edit.photo.values['skin.whiten']).toBe(0.9);
    expect(o.edit.persons.f0).toEqual(splitLegacy(sanitizeParams(edited)).person);
    expect(o.edit.persons.f1).toEqual(v2().edit!.persons.f1);
  });
  it('a paramsKey mismatch with a cache that does not fit: the stored primary is rebuilt, no phantom p0 joins the rematch', () => {
    const edited = setParam(applyPreset('glow', 1), 'shape.eyeEnlarge', 0.9);
    const o = reopen(v2({ params: sanitizeParams(edited) }), { width: 1536, height: 2048 });
    expect(Object.keys(o.edit.persons).sort()).toEqual(['f0', 'f1']);
    expect(o.edit.persons.f0).toEqual(splitLegacy(sanitizeParams(edited)).person);
    expect(o.edit.persons.f1).toEqual(v2().edit!.persons.f1);
    expect(o).toMatchObject({ detect: null, cacheDropped: true });
  });
  it('opens a v2 entry with its stored geometry, validated against the entry size (S §5)', () => {
    const edit = editFlipView({ v: 2, photo: defaultPhoto(), persons: { p0: naturalPerson() }, template: neutralPerson(), primaryInit: null });
    const entry = {
      id: 'g1', createdAt: 1, updatedAt: 1,
      original: new Blob(['o'], { type: 'image/jpeg' }), thumb: new Blob(['t'], { type: 'image/jpeg' }),
      width: 1536, height: 2048, schema: 2 as const, edit, params: defaultParams(),
    };
    expect(openState(entry, { width: 1536, height: 2048 }).edit.photo.geometry.flipH).toBe(true);
    const broken = { ...entry, edit: { ...edit, photo: { ...edit.photo, geometry: { ...edit.photo.geometry, crop: { x: 2, y: 2, w: 1, h: 1 } } } } };
    expect(openState(broken, { width: 1536, height: 2048 }).edit.photo.geometry).toEqual(IDENTITY_GEOMETRY);
  });
  it('a crop valid for the stored size also fits the bitmap decoded now (2048 vs 1440 tier: the aspect rounds apart)', () => {
    // 1537 × 2048 stored; a tier-L reopen decodes 1081 × 1440 (aspect +2.7e-4); the reverse is a tier-H reopen of a
    // tier-L entry. Max-fit crops at θ ≠ 0 touch the rotated edge, so the rounding alone pushes them past it
    const cases: [{ width: number; height: number }, { width: number; height: number }][] = [
      [{ width: 1537, height: 2048 }, { width: 1081, height: 1440 }],
      [{ width: 1081, height: 1440 }, { width: 1537, height: 2048 }],
      [{ width: 2048, height: 1365 }, { width: 1440, height: 960 }],
    ];
    for (const [stored, decoded] of cases) {
      for (const g of [
        { flipH: false, quarter: 0 as const, straighten: 10, crop: maxFit(10, stored.width, stored.height, stored.width / stored.height) },
        { flipH: true, quarter: 1 as const, straighten: -7.5, crop: maxFit(-7.5, stored.height, stored.width, 1) },
      ]) {
        const label = `${stored.width}×${stored.height} → ${decoded.width}×${decoded.height}, θ ${g.straighten}`;
        expect(cropValid(g, stored), label).toBe(true);
        const edit = { v: 2 as const, photo: { ...defaultPhoto(), geometry: g }, persons: { p0: naturalPerson() }, template: neutralPerson(), primaryInit: null };
        const entry = {
          id: 'g2', createdAt: 1, updatedAt: 1,
          original: new Blob(['o'], { type: 'image/jpeg' }), thumb: new Blob(['t'], { type: 'image/jpeg' }),
          ...stored, schema: 2 as const, edit, params: defaultParams(),
        };
        const out = openState(entry, decoded).edit.photo.geometry;
        // valid for the decode the editor draws, with every handle live (cropFits at 1e-9), and still the user's crop
        expect(cropValid(out, decoded), label).toBe(true);
        expect([out.flipH, out.quarter, out.straighten], label).toEqual([g.flipH, g.quarter, g.straighten]);
        for (const k of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(out.crop[k] - g.crop[k]), `${label} ${k}`).toBeLessThan(1e-3);
      }
    }
    // the same decode size changes nothing
    const g = { flipH: false, quarter: 0 as const, straighten: 10, crop: maxFit(10, 1537, 2048, 1537 / 2048) };
    const same = { id: 'g3', createdAt: 1, updatedAt: 1, original: new Blob(['o']), thumb: new Blob(['t']), width: 1537, height: 2048, schema: 2 as const, params: defaultParams(),
      edit: { v: 2 as const, photo: { ...defaultPhoto(), geometry: g }, persons: { p0: naturalPerson() }, template: neutralPerson(), primaryInit: null } };
    expect(openState(same, { width: 1537, height: 2048 }).edit.photo.geometry).toEqual(g);
  });
});

/** the param ids a build stores: 0.3 and 0.4 step 1 (26: no 調節, no 膚質), steps 2–3 (38: no 膚質) */
const IDS_03: readonly ParamId[] = PARAM_DEFS.filter((d) => d.group !== 'adjust' && d.group !== 'tone').map((d) => d.id);
const IDS_STEP3: readonly ParamId[] = PARAM_DEFS.filter((d) => d.group !== 'tone').map((d) => d.id);
/** `p` as a build that knew only `ids` stored it (its sanitizeParams keeps no other value) */
const storedBy = (p: BeautyParams, ids: readonly ParamId[]) => ({ ...p, values: Object.fromEntries(ids.map((id) => [id, p.values[id]])) });

describe('openState: what counts as 0.3 editing a v2 entry after a rollback (S §5.3)', () => {
  /** a v2 edit with what only 0.4 holds: two persons, 膚質 values, 調節, 質感, a flip and a spot */
  const rich = (): EditState => {
    let e = assignPersons(editFromLegacy(applyPreset('glow', 1), { primaryInit: true }), ['f0', 'f1'], 'f0');
    e = withPersons(e, ['f0'], (p) => ({ ...p, values: { ...p.values, 'tone.even': 0.6, 'shape.eyeEnlarge': 0.7 }, preset: 'custom' }));
    e = withPersons(e, ['f1'], (p) => ({ ...p, values: { ...p.values, 'tone.teeth': 0.4 }, preset: 'custom' }));
    e = editFlipView(e);
    const spots = [{ x: 0.4, y: 0.3, r: 0.01, dx: 0.02, dy: 0, owner: 'f0' }];
    return { ...e, photo: { ...e.photo, values: { ...e.photo.values, 'adjust.exposure': 0.7 }, look: { id: 'cinema', amount: 0.5 }, spots } };
  };
  /** the params 0.4 writes beside it (paramsPatch) */
  const projected = (e: EditState) => sanitizeParams(legacyProjection(e, 'f0'));
  /** the stored record, read back as the editor reads it (normalizeEntry, then openState) */
  const record = (edit: EditState, params: unknown, paramsKey: string) => ({ ...v1(), schema: 2, edit, params, paramsKey, detect: makeCache() });
  const asWritten = (edit: EditState) => reopen(record(edit, projected(edit), stableKey(projected(edit))));

  for (const [build, ids] of [
    ['steps 2–3 (38 params, this build 44)', IDS_STEP3],
    ['0.4 step 1 (26 params)', IDS_03],
  ] as const) {
    it(`an entry saved by ${build} opens with its v2 edit: params a later build adds never count as a 0.3 edit`, () => {
      const edit = rich();
      const old = storedBy(projected(edit), ids);
      const o = reopen(record(edit, old, stableKey(old)));
      expect(o.edit).toEqual(asWritten(edit).edit);
      expect(o.edit.photo.geometry.flipH).toBe(true);
      expect(o.edit.photo.spots).toHaveLength(1);
      expect(o.edit.photo.look).toEqual({ id: 'cinema', amount: 0.5 });
      expect(o.edit.persons.f0.values['tone.even']).toBe(0.6);
    });
  }
  it('nor does anything else the sanitizer re-derives on read (a stored preset id its values no longer match)', () => {
    const edit = rich();
    // what a later build that retunes a preset does to every params stored with that preset's id
    const stale = { ...projected(edit), presetId: 'glow' as const, presetAmount: 1 };
    expect(sanitizeParams(stale).presetId).toBe('custom');
    expect(reopen(record(edit, stale, stableKey(stale))).edit).toEqual(asWritten(edit).edit);
  });
  it('params that are not an object were not written by 0.3 (it always writes one): the v2 edit opens', () => {
    const edit = rich();
    expect(reopen(record(edit, 'garbage', stableKey(projected(edit)))).edit).toEqual(asWritten(edit).edit);
  });
  it('0.3 rewrote params: still detected; what it stored wins for the photo and the primary, what it cannot write keeps the v2 state', () => {
    const edit = rich();
    const key = stableKey(projected(edit));
    // 0.3's updateEntry spreads the record: a new params with its own 26 ids, the 0.4 key left behind
    const by03 = storedBy(setParam(setParam(projected(edit), 'skin.whiten', 0.9), 'shape.eyeEnlarge', 0.3), IDS_03);
    const o = reopen(record(edit, by03, key));
    expect(o.edit.photo.values['skin.whiten']).toBe(0.9);
    expect(o.edit.persons.f0.values['shape.eyeEnlarge']).toBe(0.3);
    // sanitizeParams fills these with defaults (0.5, 0): 0.3 never wrote them, so the v2 values stand
    expect(o.edit.photo.values['adjust.exposure']).toBe(0.7);
    expect(o.edit.persons.f0.values['tone.even']).toBe(0.6);
    expect(o.edit.persons.f1).toEqual(edit.persons.f1);
    // and so does what params cannot carry at all (splitLegacy's identity, none and null)
    expect(o.edit.photo.geometry).toEqual(edit.photo.geometry);
    expect(o.edit.photo.spots).toEqual(edit.photo.spots);
    expect(o.edit.photo.look).toEqual({ id: 'cinema', amount: 0.5 });
    // a preset 0.3 picked stands only while the merged values still are that preset
    const refined = storedBy(applyPreset('refined', 1, projected(edit)), IDS_03);
    const r = reopen(record(edit, refined, key));
    expect(r.edit.photo.presetLink).toEqual({ id: 'refined', amount: 1 });
    expect(r.edit.persons.f0.values['shape.faceV']).toBe(0.3);
    expect(r.edit.persons.f0.values['tone.even']).toBe(0.6);
    expect(r.edit.persons.f0.preset).toBe('custom');
    const plain = withPersons(edit, ['f0'], (p) => ({ ...p, values: { ...p.values, 'tone.even': 0 } }));
    const back = reopen(record(plain, storedBy(applyPreset('refined', 1, projected(plain)), IDS_03), stableKey(projected(plain))));
    expect(back.edit.persons.f0.preset).toEqual({ id: 'refined', amount: 1 });
  });
});

describe('new photos (RM §3.7, 2026-10-18: 全部都原圖)', () => {
  it('a new photo, imported or handed over from the camera, opens at 原圖 for everyone', () => {
    const e = importEdit();
    expect(e).toEqual({ v: 2, photo: neutralPhoto(), persons: { p0: neutralPerson() }, template: neutralPerson(), primaryInit: null });
    expect(legacyProjection(e, 'p0')).toEqual(applyPreset('original', 1));
    // every person a detection adds starts there too
    const a = firstAnswer({ detect: null, prepared: prepareFaces([lmAt(0.3, 0.4, 0.2), lmAt(0.7, 0.4, 0.12)], 1000, 1000), size: { width: 1000, height: 1000 }, v1Body: null, rematch: null, faceSeed: { x: 0.7, y: 0.4 } });
    expect(Object.values(a.rebase(e).persons)).toEqual([neutralPerson(), neutralPerson()]);
  });
});

describe('the camera hand-over (camera per-person spec §3.8, §5.3)', () => {
  const box = { x: 0.4, y: 0.3, w: 0.2, h: 0.2 };
  it('handOverOf: null when nothing is set; otherwise the photo look, the edited persons and the ambient person', () => {
    expect(handOverOf(neutralPhoto(), [], null)).toBeNull();
    expect(handOverOf({ ...neutralPhoto(), presetLink: null }, [], neutralPerson())).toBeNull();
    expect(handOverOf(defaultPhoto(), [], null)).toEqual({ photo: defaultPhoto(), persons: [], ambient: null });
    expect(handOverOf(neutralPhoto(), [{ box, params: naturalPerson() }], null)?.persons).toEqual([{ box, params: naturalPerson() }]);
    expect(handOverOf(neutralPhoto(), [], naturalPerson())?.ambient).toEqual(naturalPerson());
    // round 1 (C7): the persons found never edited go with the edited ones, never alone
    expect(handOverOf(neutralPhoto(), [{ box, params: null }], null)).toBeNull();
    expect(handOverOf(defaultPhoto(), [{ box, params: null }], null)?.persons).toEqual([]);
    expect(handOverOf(neutralPhoto(), [{ box, params: null }, { box, params: naturalPerson(), held: true }], null)?.persons).toHaveLength(2);
  });
  it('handOverEdit: the camera photo look from the first frame, p0 the ambient person or 原圖, template 原圖', () => {
    const e = handOverEdit({ photo: defaultPhoto(), persons: [{ box, params: naturalPerson() }], ambient: null });
    expect(e).toEqual({ v: 2, photo: defaultPhoto(), persons: { p0: neutralPerson() }, template: neutralPerson(), primaryInit: null });
    expect(handOverEdit({ photo: neutralPhoto(), persons: [], ambient: naturalPerson() }).persons.p0).toEqual(naturalPerson());
  });
});

/**
 * An edit whose p0 holds `person` when the first face answer lands: what the user set while the tracker could not
 * answer yet (S §3.3 item 2). A camera shot opens at 原圖 like an import (2026-10-18), so the hand-over itself puts
 * nothing on p0; the C2 cases below pin how the seed routes p0, whatever it holds.
 */
const p0Holding = (person: EditState['template']): EditState => withPersons(importEdit(), ['p0'], () => person);

// (copied verbatim from src/detect/faces.test.ts)
const fx = (n: string) => JSON.parse(readFileSync(new URL(`../../tests/fixtures/${n}`, import.meta.url), 'utf8'));
const sample = fx('landmarks_sample_face.json') as { points: number[] };

/** the recorded sample face moved so its points' bbox is centred at (cx, cy) with width w (UV), same aspect */
function lmAt(cx: number, cy: number, w: number): Landmarks478 {
  const p = sample.points;
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
  for (let i = 0; i < 478; i++) {
    x0 = Math.min(x0, p[i * 3]); x1 = Math.max(x1, p[i * 3]);
    y0 = Math.min(y0, p[i * 3 + 1]); y1 = Math.max(y1, p[i * 3 + 1]);
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

describe('firstAnswer (S §3.3 item 4, §5.3 answer-time rows, C2)', () => {
  const size = { width: 1000, height: 1000 };
  const two = prepareFaces([lmAt(0.3, 0.4, 0.2), lmAt(0.7, 0.4, 0.12)], 1000, 1000);
  const v1edit = () => openState(v1(), SIZE).edit;
  const base = { detect: null, size, v1Body: null, rematch: null, faceSeed: null } as const;
  it('a v1 entry: the look on the primary (largest × central), neutral for the rest, a cache scanned upright', () => {
    const a = firstAnswer({ ...base, prepared: two });
    const e = a.rebase(v1edit());
    expect(a.detect.primary).toBe('f0');
    expect(e.persons.f0).toEqual(splitLegacy(applyPreset('refined', 1)).person);
    expect(e.persons.f1).toEqual(neutralPerson());
    expect(a.detect.faceScans).toEqual([{ quarter: 0, flipH: false }]);
    expect(e.primaryInit).toBeNull();
  });
  it('基本模式 (no tracker): the p0 form, faceScans []', () => {
    const a = firstAnswer({ ...base, prepared: null });
    expect(a.detect.faceScans).toEqual([]);
    expect(Object.keys(a.rebase(v1edit()).persons)).toEqual(['p0']);
  });
  it('v1 with a body that pairs with no face (A13): b0 keeps the 9 local 美體 values, the face primary gets the face look', () => {
    const p = setParam(applyPreset('refined', 1), 'body.waist', 0.7);
    const edit = openState(v1({ params: p }), SIZE).edit;
    const a = firstAnswer({ ...base, prepared: two, v1Body: { bodies: [cacheBody('b0', 0.92)], complete: true } });
    const e = a.rebase(edit);
    const b0 = a.detect.persons.find((x) => x.body === 'b0')!;
    expect(b0.face).toBeNull();
    expect(e.persons[b0.id].values['body.waist']).toBe(0.7);
    expect(e.persons[b0.id].values['skin.smooth']).toBe(0);
    expect(e.persons.f0.values['body.waist']).toBe(0);
    expect(e.persons.f0.values['skin.smooth']).toBe(personFromPreset('refined', 1).values['skin.smooth']);
  });
  it('a camera seed on face B makes B the primary with p0’s params; no box contains the seed → the score primary gets them, as on an import', () => {
    const look = { person: personFromPreset('glow', 1) };
    const shot = p0Holding(look.person);
    const a = firstAnswer({ ...base, prepared: two, faceSeed: { x: 0.7, y: 0.4 } });
    expect(a.detect.primary).toBe('f1');
    expect(a.rebase(shot).persons.f1).toEqual(look.person);
    expect(a.rebase(shot).persons.f0).toEqual(neutralPerson());
    // p0 holds only the user's own edits (the shot opens at 原圖): a seed that matches nothing never drops them
    const miss = firstAnswer({ ...base, prepared: two, faceSeed: { x: 0.05, y: 0.95 } });
    expect(miss.detect.primary).toBe('f0');
    expect(miss.rebase(shot).persons).toEqual(firstAnswer({ ...base, prepared: two }).rebase(shot).persons);
    expect(miss.rebase(shot).persons.f0).toEqual(look.person);
    expect(miss.rebase(shot).persons.f1).toEqual(neutralPerson());
  });
  it('C6: 磨皮 80 set on a shot while 正在分析 shows survives a first answer whose seed lies in no face box, in every undo state', () => {
    const smooth = (v: number) => (e: EditState) => withPersons(e, ['p0'], (p) => ({ ...p, values: { ...p.values, 'skin.smooth': v }, preset: 'custom' }));
    // the undo stack of a shot handed over from 預覽: 原圖, then the user's 磨皮 drags made before the face answer
    const states = [importEdit(), smooth(0.5)(importEdit()), smooth(0.8)(importEdit())];
    const a = firstAnswer({ ...base, prepared: two, faceSeed: { x: 0.05, y: 0.95 } });
    const after = states.map(a.rebase);
    expect(after.map((e) => e.persons.f0.values['skin.smooth'])).toEqual([0, 0.5, 0.8]);
    expect(after.every((e) => e.persons.f1.values['skin.smooth'] === 0)).toBe(true);
    // identical to the same edit on an import (no seed)
    const imported = firstAnswer({ ...base, prepared: two });
    expect(after).toEqual(states.map(imported.rebase));
  });
  it('a camera seed when the editor finds no face (C3): p0, the all-skin person, keeps its params, also for a seed outside the frame', () => {
    const look = { person: personFromPreset('glow', 1) };
    const none = { faces: [], obstacles: [], dropped: { tooSmall: 0, overCap: 0 } };
    const inside = p0Holding(look.person);
    const a = firstAnswer({ ...base, prepared: none, faceSeed: { x: 0.5, y: 0.4 } });
    expect(Object.keys(a.rebase(inside).persons)).toEqual(['p0']);
    expect(a.rebase(inside).persons.p0).toEqual(look.person);
    // a body-only person (no face anywhere) gets it too: p0 hands over to the primary body person
    const withBody = firstAnswer({ ...base, prepared: none, v1Body: { bodies: [cacheBody('b0', 0.5)], complete: true }, faceSeed: { x: 0.5, y: 0.4 } });
    expect(withBody.rebase(inside).persons.b0).toEqual(look.person);
    // the tracked face was outside the saved crop: p0 still holds only the user's own edits, so they stay
    const outside = p0Holding(look.person);
    const out = firstAnswer({ ...base, prepared: none, faceSeed: { x: 1.3, y: 0.4 } });
    expect(out.rebase(outside).persons.p0).toEqual(look.person);
  });
  it('bodies found before the first face answer (S §7) build the 基本模式 form of the cache; the answer merges into it: a camera seed still names the primary, b0’s person keeps the local 美體 values', () => {
    const look = { person: personFromPreset('glow', 1) };
    const onF0 = { pose: poseOnFace(two.faces[0].face), mask: null, score: 0.9 };
    const lone = { pose: cacheBody('x', 0.95).pose, mask: null, score: 0.1 };
    // the 美體 detection while the face tracker could not answer: the bodies by centre x, p0 handed to the best score
    const pre = bodyAnswer(preAnswerCache(size, null), [lone, onF0], size);
    expect(pre.detect.persons).toEqual([
      { id: 'b0', face: null, body: 'b0' },
      { id: 'b1', face: null, body: 'b1' },
    ]);
    expect(pre.detect).toMatchObject({ primary: 'b0', faces: [], faceScans: [] });
    const waist = (e: EditState) => withPersons(e, ['b0'], (p) => ({ ...p, values: { ...p.values, 'body.waist': 0.7 } }));
    const shot = waist(pre.rebase(p0Holding(look.person)));
    expect(shot.persons.b0.values['skin.smooth']).toBe(look.person.values['skin.smooth']);
    // the seed is on face B (f1); b0 pairs with face A and keeps its id (A15)
    const a = firstAnswer({ ...base, detect: pre.detect, prepared: two, faceSeed: { x: 0.7, y: 0.4 } });
    expect(a.detect.persons.find((p) => p.id === 'b0')?.face).toBe('f0');
    expect(a.detect.primary).toBe('f1');
    const e = a.rebase(shot);
    expect(e.persons.f1.values['skin.smooth']).toBe(look.person.values['skin.smooth']);
    expect(e.persons.f1.values['body.waist']).toBe(0);
    expect(e.persons.b0.values['body.waist']).toBe(0.7);
    expect(e.persons.b0.values['skin.smooth']).toBe(0);
    expect(e.persons.b1).toEqual(neutralPerson());
    expect(e.persons.p0).toBeUndefined();
    // without a seed b0's person is the primary (A13) and keeps everything it had
    const plain = firstAnswer({ ...base, detect: pre.detect, prepared: two });
    expect(plain.detect.primary).toBe('b0');
    expect(plain.rebase(shot).persons.b0).toEqual(shot.persons.b0);
    // the seed in no face box: as without a seed (C6), so b0's person keeps the face and 美體 edits made on it
    const miss = firstAnswer({ ...base, detect: pre.detect, prepared: two, faceSeed: { x: 0.05, y: 0.95 } });
    expect(miss.detect.primary).toBe('b0');
    const m = miss.rebase(shot);
    expect(m).toEqual(plain.rebase(shot));
    expect(m.persons.b0.values['body.waist']).toBe(0.7);
    expect(m.persons.b0.values['skin.smooth']).toBe(look.person.values['skin.smooth']);
    expect(m.persons.f1).toEqual(neutralPerson());
  });
  it('a 美體 cache is stored before the first face answer and reopened: the 美體 edit stays on the same body (D4)', () => {
    // face A scores best as a face; B's body scores best as a body, so p0 (the 美體 edits) sits on B's body
    const onA = { pose: poseOnFace(two.faces[0].face), mask: null, score: 0.2 };
    const onB = { pose: poseOnFace(two.faces[1].face), mask: null, score: 0.5 };
    const pre = bodyAnswer(preAnswerCache(size, null), [onA, onB], size);
    const held = pre.detect.persons.find((p) => p.id === pre.detect.primary)!;
    expect(pre.detect.bodies!.find((b) => b.id === held.body)!.pose).toBe(onB.pose);
    const edit = withPersons(pre.rebase(p0Holding(naturalPerson())), [held.id], (p) => ({ ...p, values: { ...p.values, 'body.waist': 0.7 } }));
    // the autosave writes the cache with the edit (the tracker never answered); the reopen reads both
    const params = sanitizeParams(legacyProjection(edit, pre.detect.primary));
    const o = reopen(v1({ width: 1000, height: 1000, schema: 2, edit, params, paramsKey: stableKey(params), detect: { ...pre.detect, bodyScans: [0] } }), size);
    expect(o.detect?.bodies?.map((b) => b.id)).toEqual(pre.detect.bodies!.map((b) => b.id));
    const a = firstAnswer({ ...base, detect: o.detect, prepared: two, v1Body: o.v1Body, rematch: o.rematch });
    const e = a.rebase(o.edit);
    const onBPerson = a.detect.persons.find((p) => p.body === held.body)!;
    expect(onBPerson.face).toBe('f1');
    expect(e.persons[onBPerson.id].values['body.waist']).toBe(0.7);
    const onAPerson = a.detect.persons.find((p) => p.face === 'f0')!;
    expect(e.persons[onAPerson.id].values['body.waist']).toBe(0);
  });
  it('a dropped cache rematched with a body that pairs with no face (D1): the rematched primary keeps its stored params', () => {
    const glow = assignPersons(editFromLegacy(applyPreset('glow', 1), { primaryInit: true }), ['f0', 'f1'], 'f0');
    const stored = withPersons(glow, ['f0'], () => personFromPreset('refined', 1));
    const rematch = { f0: two.faces[0].box, f1: two.faces[1].box };
    const lone = { pose: cacheBody('x', 0.95).pose, mask: null, score: 0.9 };
    // the reviewer's probe: the lone body as the answer's b0, beside the rematch
    const probe = firstAnswer({ ...base, prepared: two, rematch, v1Body: { bodies: [{ id: 'b0', ...lone }], complete: true } });
    expect(probe.detect.persons.map((p) => p.id)).toEqual(['f0', 'f1', 'b0']);
    expect(probe.detect.primary).toBe('f0');
    expect(probe.rebase(stored).persons.f0).toEqual(stored.persons.f0);
    // the editor's path: 美體 found the lone body while the tracker could not answer; the rematch rides in that cache
    const pre = bodyAnswer(preAnswerCache(size, rematch), [lone], size);
    expect(pre.detect.rematch).toEqual(rematch);
    const meanwhile = withPersons(pre.rebase(stored), [pre.detect.primary], (p) => ({ ...p, values: { ...p.values, 'body.waist': 0.7 } }));
    expect(Object.keys(meanwhile.persons).sort()).toEqual(['b0', 'f0', 'f1']);
    const a = firstAnswer({ ...base, detect: pre.detect, prepared: two });
    expect(a.dropped).toBe(true);
    expect(a.detect.rematch).toBeUndefined();
    expect(a.detect.primary).toBe('f0');
    const e = a.rebase(meanwhile);
    expect(e.persons.f0).toEqual(stored.persons.f0);
    expect(e.persons.f1).toEqual(stored.persons.f1);
    expect(e.persons.b0.values['body.waist']).toBe(0.7);
    // and so after a reopen: the stored cache carries the rematch, the edit the persons it names
    const params = sanitizeParams(legacyProjection(meanwhile, 'b0'));
    const o = reopen(v1({ width: 1000, height: 1000, schema: 2, edit: meanwhile, params, paramsKey: stableKey(params), detect: pre.detect }), size);
    expect(o.detect?.rematch).toEqual(rematch);
    expect(Object.keys(o.edit.persons).sort()).toEqual(['b0', 'f0', 'f1']);
    const r = firstAnswer({ ...base, detect: o.detect, prepared: two });
    expect(r.dropped).toBe(true);
    expect(r.rebase(o.edit).persons.f0).toEqual(stored.persons.f0);
  });
  it('a stored rematched person a new face pairs with keeps its params over the body person 美體 made of it meanwhile', () => {
    // the stale f1 is the face that pairs with the body 美體 found first: the stored params win (S §5.3)
    const stored = withPersons(assignPersons(editFromLegacy(applyPreset('glow', 1), { primaryInit: true }), ['f0', 'f1'], 'f0'), ['f1'], () => personFromPreset('refined', 1));
    const pre = bodyAnswer(preAnswerCache(size, { f1: two.faces[1].box }), [{ pose: poseOnFace(two.faces[1].face), mask: null, score: 0.3 }], size);
    const a = firstAnswer({ ...base, detect: pre.detect, prepared: two });
    const owner = a.detect.persons.find((p) => p.face === 'f1')!;
    expect(owner.id).toBe('b0');
    expect(a.rebase(pre.rebase(stored)).persons.b0).toEqual(stored.persons.f1);
  });
  it('p0: an edit made before the answer goes to the primary (unsure → 大眼 0.8 → 2 faces)', () => {
    const e0 = openState(v1(), SIZE).edit;
    const meanwhile = { ...e0, persons: { p0: { ...e0.persons.p0, values: { ...e0.persons.p0.values, 'shape.eyeEnlarge': 0.8 } } } };
    const e = firstAnswer({ ...base, prepared: two }).rebase(meanwhile);
    expect(e.persons.f0.values['shape.eyeEnlarge']).toBe(0.8);
    expect(e.persons.f1).toEqual(neutralPerson());
  });
  it('a dropped cache is rematched by face box: ids renamed, the 長腿 anchor follows, unmatched persons get the template', () => {
    const glow = assignPersons(editFromLegacy(applyPreset('glow', 1), { primaryInit: true }), ['f0', 'f1'], 'f0');
    const old = withPersons(glow, ['f1'], () => personFromPreset('refined', 1));
    const anchored = { ...old, photo: { ...old.photo, legsAnchor: 'f1' } };
    // the old f1 sits where the new f0 is; the old f0 matches nothing
    const a = firstAnswer({ ...base, prepared: two, rematch: { f1: two.faces[0].box, f0: { x: 0.9, y: 0.9, w: 0.05, h: 0.05 } } });
    const e = a.rebase(anchored);
    expect(a.dropped).toBe(true);
    expect(e.persons.f0).toEqual(personFromPreset('refined', 1));
    expect(e.photo.legsAnchor).toBe('f0');
    expect(e.persons.f1).toEqual(old.template);
    expect(old.template).toEqual(neutralPerson());
  });
  it('a 基本模式 cache with bodies gains its faces; the body person keeps its id and params (A15)', () => {
    const basic = firstAnswer({ ...base, prepared: null, v1Body: { bodies: [cacheBody('b0', 0.3)], complete: true } });
    const merged = firstAnswer({ ...base, detect: basic.detect, prepared: two });
    expect(merged.detect.persons.map((p) => p.id)).toContain('b0');
    expect(merged.detect.faceScans).toEqual([{ quarter: 0, flipH: false }]);
  });
  it('a 基本模式 cache whose primary body person pairs with no face: A13 hands the face part to the face-score person, the body keeps its 美體 values', () => {
    const p = setParam(applyPreset('refined', 1), 'body.waist', 0.7);
    const basic = firstAnswer({ ...base, prepared: null, v1Body: { bodies: [cacheBody('b0', 0.95)], complete: true } });
    const e0 = basic.rebase(openState(v1({ params: p }), SIZE).edit);
    expect(basic.detect.primary).toBe('b0');
    expect(e0.persons.b0.values['body.waist']).toBe(0.7);
    const merged = firstAnswer({ ...base, detect: basic.detect, prepared: two });
    expect(merged.detect.persons.find((x) => x.id === 'b0')?.face).toBeNull();
    expect(merged.detect.primary).toBe('f0');
    const e = merged.rebase(e0);
    expect(e.persons.f0.values['skin.smooth']).toBe(personFromPreset('refined', 1).values['skin.smooth']);
    expect(e.persons.f0.values['body.waist']).toBe(0);
    expect(e.persons.b0.values['body.waist']).toBe(0.7);
    expect(e.persons.b0.values['skin.smooth']).toBe(0);
    expect(e.persons.f1).toEqual(neutralPerson());
    // a face that pairs with the body person: it keeps everything, and the primary (A15)
    const paired = firstAnswer({ ...base, prepared: null, v1Body: { bodies: [{ id: 'b0', pose: poseOnFace(two.faces[1].face), mask: null, score: 0.3 }], complete: true } });
    const m = firstAnswer({ ...base, detect: paired.detect, prepared: two });
    expect(m.detect.primary).toBe('b0');
    expect(m.rebase(paired.rebase(openState(v1({ params: p }), SIZE).edit)).persons.b0).toEqual(paired.rebase(openState(v1({ params: p }), SIZE).edit).persons.b0);
  });
  it('a sideways re-scan (S §3.6) appends its up-frame to faceScans, finds or not; the cache only grows', () => {
    const upright = firstAnswer({ ...base, prepared: { faces: [], obstacles: [], dropped: { tooSmall: 0, overCap: 0 } } });
    expect(upright.detect.faceScans).toEqual([{ quarter: 0, flipH: false }]);
    const found = firstAnswer({ ...base, detect: upright.detect, prepared: two, quarter: 3 });
    expect(found.detect.faceScans).toEqual([{ quarter: 0, flipH: false }, { quarter: 3, flipH: false }]);
    expect(found.detect.persons.map((p) => p.id)).toEqual(['f0', 'f1']);
    const nobody = firstAnswer({ ...base, detect: { ...upright.detect, bodies: [], bodyScans: [0] }, prepared: { faces: [], obstacles: [], dropped: { tooSmall: 0, overCap: 0 } }, quarter: 1 });
    expect(nobody.detect.faceScans).toEqual([{ quarter: 0, flipH: false }, { quarter: 1, flipH: false }]);
    expect(nobody.detect.bodyScans).toEqual([0]);
    // 基本模式 still records nothing
    expect(firstAnswer({ ...base, prepared: null, quarter: 1 }).detect.faceScans).toEqual([]);
  });
  it('D3: an answer the short-range detector gave while full-range was missing marks the cache; a full-range answer clears the mark', () => {
    const short = firstAnswer({ ...base, prepared: two, detector: 'short-range' });
    expect(short.detect.photoDetector).toBe('short-range');
    expect(firstAnswer({ ...base, prepared: two, detector: 'full-range' }).detect).not.toHaveProperty('photoDetector');
    // the faceless form detected again once the detector is in (completeAnswer runs firstAnswer so): the faces merge in, unmarked
    const none = firstAnswer({ ...base, prepared: { faces: [], obstacles: [], dropped: { tooSmall: 0, overCap: 0 } }, detector: 'short-range' });
    expect(none.detect).toMatchObject({ photoDetector: 'short-range', persons: [{ id: 'p0' }] });
    const later = firstAnswer({ ...base, detect: none.detect, prepared: two, detector: 'full-range' });
    expect(later.detect.persons.map((p) => p.id)).toEqual(['f0', 'f1']);
    expect(later.detect).not.toHaveProperty('photoDetector');
    // no detection of its own (基本模式) keeps what the cache says; a stored round trip keeps the mark
    expect(firstAnswer({ ...base, detect: none.detect, prepared: null }).detect.photoDetector).toBe('short-range');
    expect(normalizeDetect(structuredClone(short.detect)).cache?.photoDetector).toBe('short-range');
  });
  it('the short-range mark stands for each up-frame it may concern: a full-range "nobody" in another up-frame keeps it, faces lift it', () => {
    const nobody = { faces: [], obstacles: [], dropped: { tooSmall: 0, overCap: 0 } };
    // nobody upright, short-range; then the turned photo's scan with full-range finds nobody either
    const upright = firstAnswer({ ...base, prepared: nobody, detector: 'short-range' }).detect;
    const turned = firstAnswer({ ...base, detect: upright, prepared: nobody, quarter: 1, detector: 'full-range' }).detect;
    expect(turned.faceScans).toEqual([{ quarter: 0, flipH: false, detector: 'short-range' }, { quarter: 1, flipH: false }]);
    // the upright record is still the short-range one: the mark stays, so the completion asks it again
    expect(turned.photoDetector).toBe('short-range');
    expect(completionOf(turned)).toEqual({ quarter: 0 });
    // faces found full-range in the turned photo: a cache with faces is never scanned again, nothing is left to complete
    const found = firstAnswer({ ...base, detect: upright, prepared: two, quarter: 1, detector: 'full-range' }).detect;
    expect(found).not.toHaveProperty('photoDetector');
  });
  it('completeAnswer: a faceless short-range cache takes the full-range answer upright, which replaces the upright record; the turned one stays owed', () => {
    const nobody = { faces: [], obstacles: [], dropped: { tooSmall: 0, overCap: 0 } };
    const upright = firstAnswer({ ...base, prepared: nobody, detector: 'short-range' }).detect;
    const marked = firstAnswer({ ...base, detect: upright, prepared: nobody, quarter: 1, detector: 'short-range' }).detect;
    expect(marked).toMatchObject({ photoDetector: 'short-range', faceScans: [{ quarter: 0, detector: 'short-range' }, { quarter: 1, detector: 'short-range' }] });
    // nobody upright again: that record is a full-range one now; the turned one is still owed its look (the scan asks it
    // when the photo is shown turned), so the mark stays
    const still = completeAnswer(marked, nobody, size);
    expect(still.detect.faceScans).toEqual([{ quarter: 1, flipH: false, detector: 'short-range' }, { quarter: 0, flipH: false }]);
    expect(still.detect.photoDetector).toBe('short-range');
    expect(completionOf(still.detect)).toEqual({ quarter: 1 });
    expect(still.added).toEqual([]);
    expect(still.rebase(v1edit())).toEqual(firstAnswer({ ...base, detect: marked, prepared: nobody }).rebase(v1edit()));
    // that scan, full-range, finds nobody either: nothing is owed, the mark goes
    const done = firstAnswer({ ...base, detect: still.detect, prepared: nobody, quarter: 1, detector: 'full-range' }).detect;
    expect(done.faceScans).toEqual([{ quarter: 0, flipH: false }, { quarter: 1, flipH: false }]);
    expect(done).not.toHaveProperty('photoDetector');
    // faces: they merge as into a 基本模式 cache (A15), the look on the primary, the mark and the flags gone, the upright
    // record last (where the faces were found)
    const merged = completeAnswer(marked, two, size);
    expect(merged.detect.persons.map((p) => p.id)).toEqual(['f0', 'f1']);
    expect(merged.detect.faceScans).toEqual([{ quarter: 1, flipH: false }, { quarter: 0, flipH: false }]);
    expect(merged.detect).not.toHaveProperty('photoDetector');
    expect(merged.added).toEqual(['f0', 'f1']);
    expect(merged.rebase(v1edit()).persons.f0).toEqual(splitLegacy(applyPreset('refined', 1)).person);
  });
  it('completeAnswer: an up-frame a full-range scan answered keeps its record, so it is not scanned again (round 4 F4)', () => {
    const nobody = { faces: [], obstacles: [], dropped: { tooSmall: 0, overCap: 0 } };
    // nobody upright, short-range; the photo turned while the detector was landing: the scan of q1 ran full-range
    const upright = firstAnswer({ ...base, prepared: nobody, detector: 'short-range' }).detect;
    const turned = firstAnswer({ ...base, detect: upright, prepared: nobody, quarter: 1, detector: 'full-range' }).detect;
    expect(turned.photoDetector).toBe('short-range');
    // the completion asks upright, full-range: nobody. Every record is a full-range one now, the mark goes, and q1's stays
    const done = completeAnswer(turned, nobody, size, 0).detect;
    expect(done.faceScans).toEqual([{ quarter: 1, flipH: false }, { quarter: 0, flipH: false }]);
    expect(done).not.toHaveProperty('photoDetector');
    // round 3 kept the upright record alone ([0]), so the turned up-frame was scanned once more, full-range again
    expect(done.faceScans.map((s) => s.quarter)).toContain(1);
  });
  it('completeAnswer: a faceless cache whose upright record is full-range already is completed where a short-range one is owed', () => {
    const nobody = { faces: [], obstacles: [], dropped: { tooSmall: 0, overCap: 0 } };
    const upright = firstAnswer({ ...base, prepared: nobody, detector: 'full-range' }).detect;
    const turned = firstAnswer({ ...base, detect: upright, prepared: nobody, quarter: 3, detector: 'short-range' }).detect;
    expect(turned).toMatchObject({ photoDetector: 'short-range', faceScans: [{ quarter: 0 }, { quarter: 3, detector: 'short-range' }] });
    expect(completionOf(turned)).toEqual({ quarter: 3 });
    // its faces, found there, full-range: the cache gains them, that record last
    const found = completeAnswer(turned, two, size, 3).detect;
    expect(found.faceScans).toEqual([{ quarter: 0, flipH: false }, { quarter: 3, flipH: false }]);
    expect(found.faces).toHaveLength(2);
    expect(found).not.toHaveProperty('photoDetector');
  });
  it('completeAnswer: a short-range cache with faces only gains persons; every stored one keeps its id and params', () => {
    const one = prepareFaces([lmAt(0.3, 0.4, 0.2)], 1000, 1000);
    const short = firstAnswer({ ...base, prepared: one, quarter: 0, detector: 'short-range' });
    const e0 = withPersons(short.rebase(v1edit()), [short.detect.primary], (q) => ({ ...q, values: { ...q.values, 'shape.eyeEnlarge': 1 }, preset: 'custom' }));
    const c = completeAnswer(short.detect, two, size);
    expect(c.added).toHaveLength(1);
    expect(c.detect.persons.slice(0, 1)).toEqual(short.detect.persons);
    expect(c.detect.primary).toBe(short.detect.primary);
    // the records stay, without the short-range flag the mark took with it
    expect(short.detect.faceScans).toEqual([{ quarter: 0, flipH: false, detector: 'short-range' }]);
    expect(c.detect.faceScans).toEqual([{ quarter: 0, flipH: false }]);
    expect(c.detect).not.toHaveProperty('photoDetector');
    const e = c.rebase(e0);
    expect(e.persons[short.detect.primary]).toEqual(e0.persons[short.detect.primary]);
    expect(e.persons[c.added[0]]).toEqual(e0.template);
    expect(e.photo).toBe(e0.photo);
  });
  /** what the engine draws an edit with: the frame (faces, params, obstacle centres), the caps and the 瘦臉 limits' inputs */
  const drawn = (cache: DetectionCache, edit: EditState) => {
    const faces = cache.faces.map((c) => ({ id: c.id, face: adaptCached(c, size.width, size.height), box: c.box, lm: c.lm }));
    const frame = buildFrame(edit, frameFacesOf(cache, faces), cache.obstacles, new Map(), cache.primary);
    return { frame, caps: capsFor(frame.faces.map((f) => boxCentre(ovalBox(f.face))), frame.obstacles ?? [], 1), protects: protectRequests(cache, faces, edit, size) };
  };
  /** an edit of an answer's cache with 瘦臉 at the top on its primary */
  const slimmed = (a: { rebase: (e: EditState) => EditState; detect: DetectionCache }) =>
    withPersons(a.rebase(v1edit()), [a.detect.primary], (q) => ({ ...q, values: { ...q.values, 'shape.faceSlim': 1 }, preset: 'custom' }));
  it("completeAnswer that adds nobody leaves an edited photo's render as it was: a tiny face beside the jaw still bounds 瘦臉 (round 4 F2)", () => {
    const a = sampleFaceAt(0.5, 0.5, 0.4);
    // O: a background face under MIN_FACE_FRAC beside A's jaw, outside A's face oval
    const short = firstAnswer({ ...base, prepared: prepareFaces([a, sampleFaceAt(0.344, 0.604, 0.025)], 1000, 1000), quarter: 0, detector: 'short-range' });
    expect(short.detect.obstacles).toHaveLength(1);
    const slim = slimmed(short);
    const before = drawn(short.detect, slim);
    // A's 瘦臉 stops short of O: half their distance
    expect(before.caps[0]).toBeGreaterThan(0.05);
    expect(before.caps[0]).toBeLessThan(0.15);
    // the detector lands: full-range finds the same two, boxed a hair apart
    const c = completeAnswer(short.detect, prepareFaces([sampleFaceAt(0.501, 0.5, 0.4), sampleFaceAt(0.3445, 0.6045, 0.025)], 1000, 1000), size);
    expect(c.added).toEqual([]);
    expect(c.detect).not.toHaveProperty('photoDetector');
    expect(drawn(c.detect, c.rebase(slim))).toEqual(before);
  });
  it('completeAnswer that adds nobody but a face below MIN_FACE_FRAC short-range missed: it joins as an obstacle and bounds 瘦臉 (round 5 G3)', () => {
    const a = sampleFaceAt(0.5, 0.5, 0.4);
    const alone = firstAnswer({ ...base, prepared: prepareFaces([a], 1000, 1000), quarter: 0, detector: 'short-range' });
    const edited = slimmed(alone);
    // nothing near A: its 瘦臉 is unbounded
    const unbounded = drawn(alone.detect, edited);
    expect(unbounded.caps[0]).toBeLessThan(0);
    // the detector lands: full-range finds A and, beside its jaw, the tiny face short-range missed
    const gained = completeAnswer(alone.detect, prepareFaces([sampleFaceAt(0.501, 0.5, 0.4), sampleFaceAt(0.3445, 0.6045, 0.025)], 1000, 1000), size);
    expect(gained.added).toEqual([]);
    expect([alone.detect.obstacles.length, gained.detect.obstacles.length]).toEqual([0, 1]);
    const bounded = drawn(gained.detect, gained.rebase(edited));
    expect(bounded.caps[0]).toBeGreaterThan(0.05);
    expect(bounded.caps[0]).toBeLessThan(0.2);
    // the faces and their params are as they were; the cap is what changed, so the editor owes the thumbnail
    // (completionShows). Round 4's doc said a completion that adds nobody leaves every cap as it was
    expect(bounded.frame.faces).toEqual(unbounded.frame.faces);
  });
  it('C7: 重置 on a 0.4.0 entry whose stored template is the 自然 camera look: the faces found after it start at 原圖, every one', () => {
    // 0.4.0's importEdit(look): the 自然 look on p0 and as the template; a sideways photo, so upright found no face
    const old: EditState = { v: 2, photo: defaultPhoto(), persons: { p0: naturalPerson() }, template: naturalPerson(), primaryInit: null };
    const upright = firstAnswer({ ...base, prepared: { faces: [], obstacles: [], dropped: { tooSmall: 0, overCap: 0 } } }).detect;
    const params = sanitizeParams(legacyProjection(old, 'p0'));
    const o = reopen(v1({ width: 1000, height: 1000, schema: 2, edit: old, params, paramsKey: stableKey(params), detect: upright }), size);
    expect(o.detect).toEqual(upright);
    expect(o.edit.template).toEqual(naturalPerson());
    const reset = resetAll(o.edit);
    // 裁切 › 旋轉 upright: the re-scan in the new up-frame finds both faces
    const a = firstAnswer({ ...base, detect: o.detect, prepared: two, quarter: 1 });
    expect(a.detect.persons.map((p) => p.id)).toEqual(['f0', 'f1']);
    const e = a.rebase(reset);
    expect(e.persons).toEqual({ f0: neutralPerson(), f1: neutralPerson() });
    // the same entry closed before any answer (no cache): the first answer after 重置 gives 原圖 to everyone too
    const closed = reopen(v1({ width: 1000, height: 1000, schema: 2, edit: old, params, paramsKey: stableKey(params) }), size);
    expect(closed.detect).toBeNull();
    expect(firstAnswer({ ...base, prepared: two }).rebase(resetAll(closed.edit)).persons).toEqual({ f0: neutralPerson(), f1: neutralPerson() });
    // without 重置 the stored edit keeps what 0.4.0 saved (an entry keeps its look)
    expect(a.rebase(o.edit).persons.f1).toEqual(naturalPerson());
  });

  describe('firstAnswer with a camera hand-over (camera per-person spec §5.4)', () => {
    const at = (cx: number, w: number) => ({ x: cx - w / 2, y: 0.4 - w / 2, w, h: w });
    const nat = naturalPerson();
    const ref = personFromPreset('refined', 1);
    const opened = handOverEdit({ photo: defaultPhoto(), persons: [], ambient: null });
    it('each matched face takes its camera person’s params; the seed names the primary; an unmatched person is counted', () => {
      const a = firstAnswer({ ...base, prepared: two, faceSeed: { x: 0.7, y: 0.4 }, handOver: [{ box: at(0.3, 0.2), params: nat }, { box: at(0.71, 0.1), params: ref }, { box: at(0.95, 0.05), params: nat }] });
      const e = a.rebase(opened);
      expect([a.detect.primary, e.persons.f0, e.persons.f1, a.handOverMissed]).toEqual(['f1', nat, ref, 1]);
      expect(e.photo).toEqual(defaultPhoto());
    });
    it('an edit made before the answer (p0 ≠ the template) stays with the primary; the others still take theirs', () => {
      const touched = withPersons(opened, ['p0'], (p) => ({ ...p, values: { ...p.values, 'skin.smooth': 0.8 }, preset: 'custom' }));
      const a = firstAnswer({ ...base, prepared: two, faceSeed: { x: 0.7, y: 0.4 }, handOver: [{ box: at(0.3, 0.2), params: nat }, { box: at(0.71, 0.1), params: ref }] });
      const e = a.rebase(touched);
      expect(e.persons.f1.values['skin.smooth']).toBe(0.8);
      expect(e.persons.f0).toEqual(nat);
    });
    it('no face in the answer: every camera person is missed, p0 stays as the edit opened', () => {
      const a = firstAnswer({ ...base, prepared: prepareFaces([], 1000, 1000), handOver: [{ box: at(0.3, 0.2), params: nat }] });
      expect(a.handOverMissed).toBe(1);
      expect(a.rebase(opened).persons).toEqual({ p0: neutralPerson() });
    });
    it('a camera box on an obstacle (a face the cap dropped) matches nothing; every undo state takes the same mapping', () => {
      const eleven = prepareFaces(Array.from({ length: 11 }, (_, i) => lmAt(0.05 + i * 0.09, 0.5, i === 10 ? 0.05 : 0.07)), 1000, 1000);
      expect(eleven.obstacles).toHaveLength(1);
      const a = firstAnswer({ ...base, prepared: eleven, handOver: [{ box: eleven.obstacles[0].box, params: nat }, { box: eleven.faces[0].box, params: ref }] });
      expect(a.handOverMissed).toBe(1);
      const older = withPersons(opened, ['p0'], (p) => ({ ...p, values: { ...p.values, 'skin.smooth': 0.3 }, preset: 'custom' }));
      const owner = a.detect.persons.find((p) => p.face === eleven.faces[0].id)!.id;
      expect(a.rebase(opened).persons[owner]).toEqual(ref);
      expect(Object.keys(a.rebase(older).persons)).toEqual(Object.keys(a.rebase(opened).persons));
    });
    it('round 1 (C10): a camera box on an obstacle whose centre a neighbour’s padded box holds is the obstacle’s: the neighbour keeps 原圖', () => {
      // ten faces, and an eleventh, smaller, cheek to cheek with the tenth: over the cap, an obstacle
      const lms = [...Array.from({ length: 10 }, (_, i) => lmAt(0.05 + i * 0.09, 0.5, 0.07)), lmAt(0.905, 0.5, 0.05)];
      const eleven = prepareFaces(lms, 1000, 1000);
      expect(eleven.obstacles).toHaveLength(1);
      const ob = eleven.obstacles[0].box;
      const tenth = eleven.faces[9];
      // the precondition: the centre rule alone would hand the obstacle's person to the tenth face
      expect(boxIoU(ob, tenth.box)).toBeLessThan(0.3);
      expect(seedPrimary({ x: ob.x + ob.w / 2, y: ob.y + ob.h / 2 }, [tenth])).toBe(tenth.id);
      const a = firstAnswer({ ...base, prepared: eleven, handOver: [{ box: ob, params: nat }] });
      expect(a.handOverMissed).toBe(1);
      const owner = a.detect.persons.find((p) => p.face === tenth.id)!.id;
      expect(a.rebase(opened).persons[owner] ?? opened.template).toEqual(neutralPerson());
    });
    it('round 1 (C7): a person never edited (params null) keeps their face from an edited held box on it; a held person missed is not counted', () => {
      // f1 (x 0.64–0.76) found at the shutter and never edited; an edited person held where f1 now stands
      const a = firstAnswer({ ...base, prepared: two, handOver: [{ box: at(0.7, 0.12), params: null }, { box: at(0.72, 0.12), params: nat, held: true }, { box: at(0.3, 0.2), params: ref }] });
      const e = a.rebase(opened);
      expect([e.persons.f0, e.persons.f1 ?? e.template]).toEqual([ref, neutralPerson()]);
      // the held person was dropped uncounted (they may have left the picture); found ones still count
      expect(a.handOverMissed).toBe(0);
      const b = firstAnswer({ ...base, prepared: two, handOver: [{ box: at(0.95, 0.05), params: nat, held: true }, { box: at(0.05, 0.05), params: nat }] });
      expect(b.handOverMissed).toBe(1);
      // nobody edited: nothing is handed over (no count, no params)
      const c = firstAnswer({ ...base, prepared: two, handOver: [{ box: at(0.7, 0.12), params: null }] });
      expect(c.handOverMissed).toBeUndefined();
      expect(c.rebase(opened).persons).toEqual(firstAnswer({ ...base, prepared: two }).rebase(opened).persons);
    });
    it('round 2 (D6): an edited person held at the shutter gives their params only to a face of their size in their place, never by the padded centre to a smaller face at their spot', () => {
      // a held box 0.3 wide where f1 (0.12 wide) now stands, never tracked by the camera: its centre in f1's padded box
      const stale = at(0.7, 0.3);
      expect(boxIoU(stale, two.faces[1].box)).toBeLessThan(0.3);
      expect(seedPrimary({ x: 0.7, y: 0.4 }, [two.faces[1]])).toBe(two.faces[1].id);
      const found = firstAnswer({ ...base, prepared: two, handOver: [{ box: stale, params: nat }] });
      expect(found.rebase(opened).persons.f1).toEqual(nat); // a found box: the centre rule, its face on the captured frame
      const held = firstAnswer({ ...base, prepared: two, handOver: [{ box: stale, params: nat, held: true }] });
      const e = held.rebase(opened);
      expect(e.persons.f1 ?? e.template).toEqual(neutralPerson());
      expect(held.handOverMissed).toBe(0);
      // a blink: the held box on their own face still takes it
      const blink = firstAnswer({ ...base, prepared: two, handOver: [{ box: two.faces[1].box, params: nat, held: true }] });
      expect(blink.rebase(opened).persons.f1).toEqual(nat);
    });
    it('round 3 (E4): a held person on their own face keeps it from a found neighbour whose centre its padded box holds, edited or never edited; the neighbour the editor missed is counted', () => {
      const f = two.faces[1].box;
      const A = { ...f, x: f.x + 0.004 }; // held at the shutter (a blink), on their own face f1
      const B = { x: f.x + 0.75 * f.w, y: f.y + 0.1 * f.h, w: 0.75 * f.w, h: 0.8 * f.h }; // found beside A, partly behind
      expect(boxIoU(A, B)).toBeLessThan(0.3); // shotPersons keeps A
      expect(boxIoU(B, f)).toBeLessThan(0.3);
      expect(seedPrimary({ x: B.x + B.w / 2, y: B.y + B.h / 2 }, [two.faces[1]])).toBe(two.faces[1].id);
      for (const bParams of [nat, null]) {
        const a = firstAnswer({ ...base, prepared: two, handOver: [{ box: A, params: ref, held: true }, { box: B, params: bParams }] });
        expect(a.rebase(opened).persons.f1).toEqual(ref);
        expect(a.handOverMissed).toBe(bParams ? 1 : 0);
      }
    });
    it('round 3 (E5): a person unseen at the shutter since a no-answer (stale: the box is the last answer’s, not the captured frame’s) is a guess, as a held one: never given a smaller face at their spot by the padded centre, but counted when missed', () => {
      // their old box 0.3 wide where f1 (0.12 wide) now stands: its centre in f1's padded box, at IoU < 0.3
      const old = at(0.7, 0.3);
      const a = firstAnswer({ ...base, prepared: two, handOver: [{ box: old, params: nat, stale: true }] });
      const e = a.rebase(opened);
      expect(e.persons.f1 ?? e.template).toEqual(neutralPerson());
      expect(a.handOverMissed).toBe(1); // not known missing: counted
      // their own face, of their size in their place: paired
      expect(firstAnswer({ ...base, prepared: two, handOver: [{ box: two.faces[1].box, params: nat, stale: true }] }).rebase(opened).persons.f1).toEqual(nat);
      // never edited, on their own face: it keeps that face from an edited held box there
      const blocked = firstAnswer({ ...base, prepared: two, handOver: [{ box: two.faces[1].box, params: null, stale: true }, { box: { ...two.faces[1].box, x: two.faces[1].box.x + 0.01 }, params: nat, held: true }] });
      const eb = blocked.rebase(opened);
      expect(eb.persons.f1 ?? eb.template).toEqual(neutralPerson());
    });
    it('round 4 (F2): a person unseen at the shutter since a no-answer, their face 0.4 of a width from their last box (IoU 0.22), the only face in the photo: that face takes their params, and nobody is counted missing', () => {
      // the solo path: the tracker stops answering (a context loss, the rebuild throttle) and the shutter's re-ask too;
      // the box is the last answer's, and the phone moved a little since
      const one = prepareFaces([lmAt(0.5, 0.4, 0.2)], 1000, 1000);
      const f = one.faces[0].box;
      const old = { ...f, x: f.x - 0.4 * f.w, y: f.y - 0.4 * f.h };
      expect(boxIoU(old, f)).toBeLessThan(0.3);
      const a = firstAnswer({ ...base, prepared: one, handOver: [{ box: old, params: nat, stale: true }] });
      const owner = a.detect.persons.find((p) => p.face === one.faces[0].id)!.id;
      expect(a.rebase(opened).persons[owner]).toEqual(nat);
      expect(a.handOverMissed).toBe(0); // no 「未偵測到臉部」 toast for a face 編輯 found
      // held there instead (known missing, they may have left): only a face of their size in their place, uncounted (D6)
      const held = firstAnswer({ ...base, prepared: one, handOver: [{ box: old, params: nat, held: true }] });
      expect(held.rebase(opened).persons[owner] ?? opened.template).toEqual(neutralPerson());
      expect(held.handOverMissed).toBe(0);
    });
    it('round 5 (G3): that stale person keeps their moved face from a smaller neighbour found at the shutter, partly behind them, whose own face the editor missed: edited or never edited, the neighbour is the one dropped, counted when edited', () => {
      const one = prepareFaces([lmAt(0.5, 0.4, 0.2)], 1000, 1000);
      const f = one.faces[0].box;
      const old = { ...f, x: f.x - 0.4 * f.w, y: f.y - 0.4 * f.h }; // A's last answer's box (F2's case)
      const B = { x: f.x + 0.85 * f.w, y: f.y + 0.6 * f.h, w: 0.6 * f.w, h: 0.5 * f.h }; // found, 0.6 of A's width
      const c = (b: typeof f) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
      const d = (b: typeof f) => Math.hypot(c(b).x - c(f).x, c(b).y - c(f).y);
      // the preconditions: no IoU pair, both centres in the face's padded box, A's nearer
      expect([boxIoU(old, f), boxIoU(B, f), boxIoU(old, B)].every((v) => v < 0.3)).toBe(true);
      expect([seedPrimary(c(old), one.faces), seedPrimary(c(B), one.faces)]).toEqual([one.faces[0].id, one.faces[0].id]);
      expect(d(old)).toBeLessThan(d(B));
      for (const bParams of [ref, null]) {
        const a = firstAnswer({ ...base, prepared: one, handOver: [{ box: old, params: nat, stale: true }, { box: B, params: bParams }] });
        const owner = a.detect.persons.find((p) => p.face === one.faces[0].id)!.id;
        expect(a.rebase(opened).persons[owner]).toEqual(nat);
        expect(a.handOverMissed).toBe(bParams ? 1 : 0); // B, not A: 編輯 found A's face
      }
    });
  });
});

/** a pose whose face points sit on the face's own landmarks (a perfect pair); poseOnFace of src/detect/cache.test.ts */
function poseOnFace(face: Face): Pose33 {
  const P = face.pts111;
  const points = new Float32Array(33 * 4);
  const set = (i: number, k: number) => {
    points[i * 4] = P[k * 2];
    points[i * 4 + 1] = P[k * 2 + 1];
    points[i * 4 + 3] = 0.99;
  };
  set(0, 46);
  set(2, 105);
  set(5, 104);
  set(9, 90);
  set(10, 84);
  for (let i = 11; i < 33; i++) {
    points[i * 4] = P[46 * 2];
    points[i * 4 + 1] = P[46 * 2 + 1] + 0.05 + i * 0.01;
    points[i * 4 + 3] = 0.99;
  }
  return { points };
}

describe('bodyAnswer (S §3.4 P4, §7): a 美體 detection joined to the persons', () => {
  const size = { width: 1000, height: 1000 };
  const two = prepareFaces([lmAt(0.3, 0.4, 0.2), lmAt(0.7, 0.4, 0.12)], 1000, 1000);
  const base = { detect: null, size, v1Body: null, rematch: null, faceSeed: null } as const;
  it('pairs against the cache’s own faces, so it needs no session (an engine recovery has none, Review Focus #4)', () => {
    const a = firstAnswer({ ...base, prepared: two });
    const onF1 = { pose: poseOnFace(two.faces[1].face), mask: null, score: 0.2 };
    const lone = { pose: cacheBody('x', 0.95).pose, mask: null, score: 0.1 };
    const b = bodyAnswer(a.detect, [onF1, lone], size);
    expect(b.detect.persons).toEqual([
      { id: 'f0', face: 'f0', body: null },
      { id: 'f1', face: 'f1', body: 'b0' },
      { id: 'b1', face: null, body: 'b1' },
    ]);
    // the answer pairing against the session's faces gives (a session built from the cache adapts the same landmarks)
    expect(b.detect).toEqual(withBodies(a.detect, [onF1, lone], (id) => two.faces.find((f) => f.id === id)!.face).cache);
    // what pairing against no session did: f1's own body split off as a body-only person, for good
    expect(withBodies(a.detect, [onF1, lone], () => null).cache.persons.map((p) => p.id)).toEqual(['f0', 'f1', 'b0', 'b1']);
    // the rebase: the new body-only person starts from the template, the others keep their params
    const e = a.rebase(openState(v1(), SIZE).edit);
    const e2 = b.rebase(e);
    expect(Object.keys(e2.persons)).toEqual(['f0', 'f1', 'b1']);
    expect(e2.persons.f0).toEqual(e.persons.f0);
    expect(e2.persons.f1).toEqual(e.persons.f1);
    expect(e2.persons.b1).toEqual(e.template);
  });
  it('the A13 split re-detected (v1 people ≥ 2, b0 unmatched): b0’s v0.3 美體 values move to the new primary body person', () => {
    const p = setParam(applyPreset('refined', 1), 'body.waist', 0.7);
    const first = firstAnswer({ ...base, prepared: two, v1Body: { bodies: [cacheBody('b0', 0.92)], complete: false } });
    const e = first.rebase(openState(v1({ params: p }), SIZE).edit);
    expect(first.detect.primary).toBe('f0');
    expect(e.persons.b0.values['body.waist']).toBe(0.7);
    // no pose matches b0 any more: one body pairs with f0, two stand alone (the central one scores best)
    const onF0 = { pose: poseOnFace(two.faces[0].face), mask: null, score: 0.9 };
    const edge = { pose: cacheBody('x', 0.08).pose, mask: null, score: 0.2 };
    const central = { pose: cacheBody('x', 0.5).pose, mask: null, score: 0.1 };
    const b = bodyAnswer(first.detect, [onF0, edge, central], size);
    expect(b.detect.persons.map((x) => [x.id, x.body])).toEqual([['f0', 'b2'], ['f1', null], ['b1', 'b1'], ['b3', 'b3']]);
    const e2 = b.rebase(e);
    expect(Object.keys(e2.persons).sort()).toEqual(['b1', 'b3', 'f0', 'f1']);
    // v0.3's body edit keeps rendering, on the body v0.3's selectPerson picks now; nobody else's params change
    expect(e2.persons.b3).toEqual(e.persons.b0);
    expect(e2.persons.b1).toEqual(e.template);
    expect(e2.persons.f0).toEqual(e.persons.f0);
    expect(e2.persons.f0.values['body.waist']).toBe(0);
  });
});

/** a big central body whose face points sit on no face (it pairs with none): selectPerson's first choice */
function wideBody(): Pose33 {
  const points = new Float32Array(33 * 4);
  for (let i = 0; i < 33; i++) {
    points[i * 4] = 0.25 + (i % 2 ? 0.5 : 0);
    points[i * 4 + 1] = 0.05 + (0.9 * i) / 32;
    points[i * 4 + 3] = 0.99;
  }
  return { points };
}

describe('persons before the first face answer: a dropped cache, an unsure tracker, 美體 first (S §5.3 R1–R3)', () => {
  const size = { width: 1000, height: 1000 };
  const two = prepareFaces([lmAt(0.3, 0.4, 0.2), lmAt(0.7, 0.4, 0.12)], 1000, 1000);
  const one = prepareFaces([lmAt(0.3, 0.4, 0.2)], 1000, 1000);
  const base = { detect: null, size, v1Body: null, rematch: null, faceSeed: null } as const;
  const waist = (e: EditState, id: string, v: number) => withPersons(e, [id], (p) => ({ ...p, values: { ...p.values, 'body.waist': v } }));
  const withWaist = (p: EditState['template'], v: number) => ({ ...p, values: { ...p.values, 'body.waist': v } });
  /** the record the autosave writes (edit, its projection, the cache), read back as the editor reads it */
  const stored = (edit: EditState, detect: HistoryEntry['detect']) => {
    const params = sanitizeParams(legacyProjection(edit, detect?.primary ?? 'p0'));
    return v1({ width: 1000, height: 1000, schema: 2, edit, params, paramsKey: stableKey(params), detect });
  };
  const bodyOn = (face: Face, score: number) => ({ pose: poseOnFace(face), mask: null, score });

  it('R2 (E1): a camera seed names face A, whose body person got 細腰 before the answer: A gets p0’s face part and keeps its 細腰', () => {
    const look = { person: personFromPreset('glow', 1) };
    const seed = { x: 0.3, y: 0.4 };
    const onA = bodyOn(two.faces[0].face, 0.2);
    const onB = bodyOn(two.faces[1].face, 0.9);
    const pre = bodyAnswer(preAnswerCache(size, null), [onA, onB], size);
    const bodyOf = (id: string) => pre.detect.bodies!.find((b) => b.id === pre.detect.persons.find((p) => p.id === id)!.body)!.pose;
    // p0's look sits on B's body (selectPerson's choice); A's body person is a template person the user set 細腰 on
    const holder = pre.detect.primary;
    const a0 = pre.detect.persons.find((p) => p.id !== holder)!.id;
    expect(bodyOf(holder)).toBe(onB.pose);
    expect(bodyOf(a0)).toBe(onA.pose);
    const shot = pre.rebase(p0Holding(look.person));
    const edited = waist(shot, a0, 0.5);
    const a = firstAnswer({ ...base, detect: pre.detect, prepared: two, faceSeed: seed });
    expect(a.detect.primary).toBe(a0);
    const e = a.rebase(edited);
    expect(e.persons[a0]).toEqual(withWaist(look.person, 0.5));
    // B's body person keeps the look's local 美體 values (none in 光澤) on its own face values: the template
    expect(e.persons[holder]).toEqual(neutralPerson());
    expect(e.persons.p0).toBeUndefined();
    // every undo state merges the same way: ↶ past the 細腰 keeps the face part on A
    expect(a.rebase(shot).persons[a0]).toEqual(look.person);
  });

  it('R2 (E1): the holder’s body pairs with no face, so face A’s body person (細腰 meanwhile) is the primary: it gets 0.3’s face look and keeps its 細腰', () => {
    const v1e = openState(v1({ params: setParam(applyPreset('refined', 1), 'body.waist', 0.7) }), SIZE).edit;
    const onA = bodyOn(two.faces[0].face, 0.2);
    const pre = bodyAnswer(preAnswerCache(size, null), [onA, { pose: wideBody(), mask: null, score: 0.9 }], size);
    const holder = pre.detect.primary;
    const a0 = pre.detect.persons.find((p) => p.id !== holder)!.id;
    expect(pre.detect.bodies!.find((b) => b.id === a0)!.pose).toBe(onA.pose);
    const plain = pre.rebase(v1e);
    expect(plain.persons[holder]).toEqual(v1e.persons.p0);
    const a = firstAnswer({ ...base, detect: pre.detect, prepared: two });
    expect(a.detect.persons.find((p) => p.id === holder)?.face).toBeNull();
    expect(a.detect.primary).toBe(a0);
    const e = a.rebase(waist(plain, a0, 0.5));
    expect(e.persons[a0]).toEqual(withWaist(v1e.persons.p0, 0.5));
    // the holder keeps 0.3's body edit (細腰 0.7) on a neutral face; the other face starts neutral
    expect(e.persons[holder]).toEqual(withWaist(neutralPerson(), 0.7));
    expect(e.persons.f1).toEqual(neutralPerson());
    expect(a.rebase(plain).persons[a0]).toEqual(withWaist(v1e.persons.p0, 0));
  });

  it('R1 (E3): a dropped edit’s person without a face box goes at the 美體 merge: no new body person reads its params, its 長腿 anchor goes too', () => {
    // the stored persons: b0 (face A, an A15 id: in the rematch) and b1 (C, body-only, 細腰 0.9, anchored: no face box)
    let stale = assignPersons(editFromLegacy(applyPreset('glow', 1), { primaryInit: true }), ['b0', 'b1'], 'b0');
    stale = withPersons(stale, ['b0'], () => personFromPreset('refined', 1));
    stale = { ...waist(stale, 'b1', 0.9), photo: { ...stale.photo, legsAnchor: 'b1' } };
    const rematch = { b0: one.faces[0].box };
    const A = bodyOn(one.faces[0].face, 0.5);
    const C = { pose: cacheBody('x', 0.8).pose, mask: null, score: 0.5 };
    const pre = bodyAnswer(preAnswerCache(size, rematch), [A, C], size);
    // b0 is reserved for its stored person; the new bodies take b1 and b2
    expect(pre.detect.persons.map((p) => p.id)).toEqual(['b1', 'b2']);
    expect(pre.detect.rematch).toEqual(rematch);
    const e = pre.rebase(stale);
    expect(Object.keys(e.persons).sort()).toEqual(['b0', 'b1', 'b2']);
    expect(e.persons.b0).toEqual(stale.persons.b0);
    for (const id of ['b1', 'b2']) expect(e.persons[id].values['body.waist']).toBe(0);
    expect(e.photo.legsAnchor).toBeNull();
    // the face answer renames b0 onto A's body person (a stored person wins its claim) and says so
    const a = firstAnswer({ ...base, detect: pre.detect, prepared: one });
    expect(a.dropped).toBe(true);
    const owner = a.detect.persons.find((p) => p.face === 'f0')!;
    const done = a.rebase(e);
    expect(done.persons[owner.id]).toEqual(stale.persons.b0);
    expect(Object.values(done.persons).every((p) => p.values['body.waist'] === 0)).toBe(true);
  });

  it('R1 (E3, Codex): four bodies beside a reserved b0: the lowest-scoring one is dropped, the stored b0 waits for the face answer, also after a reopen', () => {
    const stale = withPersons(assignPersons(editFromLegacy(applyPreset('glow', 1), { primaryInit: true }), ['b0'], 'b0'), ['b0'], () => personFromPreset('refined', 1));
    const rematch = { b0: one.faces[0].box };
    const A = bodyOn(one.faces[0].face, 0.6);
    const lone = (x: number, score: number) => ({ pose: cacheBody('x', x).pose, mask: null, score });
    const weakest = lone(0.85, 0.1);
    const pre = bodyAnswer(preAnswerCache(size, rematch), [A, lone(0.55, 0.5), lone(0.7, 0.4), weakest], size);
    expect(pre.detect.bodies!.map((b) => b.id)).toEqual(['b1', 'b2', 'b3']);
    expect(pre.detect.bodies!.some((b) => b.pose === weakest.pose)).toBe(false);
    expect(pre.detect.persons.map((p) => p.id)).toEqual(['b1', 'b2', 'b3']);
    const e = pre.rebase(stale);
    expect(e.persons.b0).toEqual(stale.persons.b0);
    // the reopen keeps the rematch (no person of the cache uses b0) and the person it names
    expect(normalizeDetect(pre.detect)).toMatchObject({ lost: false, cache: { rematch } });
    const o = reopen(stored(e, pre.detect), size);
    expect(o.detect?.rematch).toEqual(rematch);
    expect(o.edit.persons.b0).toEqual(stale.persons.b0);
    const a = firstAnswer({ ...base, detect: o.detect, prepared: one });
    expect(a.dropped).toBe(true);
    const owner = a.detect.persons.find((p) => p.face === 'f0')!;
    expect(owner.id).toBe('b1');
    expect(a.rebase(o.edit).persons.b1).toEqual(stale.persons.b0);
  });

  it('R1 at a first answer without 美體: a stored person no box names is dropped before the new persons take their ids', () => {
    // a corrupt cache: f0's box was unreadable, f1's was not. The new face f0 is somebody new: the template
    const old = withPersons(assignPersons(editFromLegacy(applyPreset('glow', 1), { primaryInit: true }), ['f0', 'f1'], 'f0'), ['f0'], () => personFromPreset('refined', 1));
    const anchored = { ...old, photo: { ...old.photo, legsAnchor: 'f0' } };
    const a = firstAnswer({ ...base, prepared: two, rematch: { f1: two.faces[1].box } });
    const e = a.rebase(anchored);
    expect(a.dropped).toBe(true);
    expect(e.persons.f0).toEqual(old.template);
    expect(e.persons.f1).toEqual(old.persons.f1);
    expect(e.photo.legsAnchor).toBeNull();
  });

  it('R3 (E5): a dropped cache with no readable face box ({}) still says so at the face answer, in this session and after a reopen', () => {
    // a body-only person (細腰 0.9) of a cache that cannot be read: no face box, so the rematch is {}
    const edit = waist(assignPersons(editFromLegacy(applyPreset('glow', 1), { primaryInit: true }), ['b0'], 'b0'), 'b0', 0.9);
    const params = sanitizeParams(legacyProjection(edit, 'b0'));
    const o = reopen(v1({ width: 1000, height: 1000, schema: 2, edit, params, paramsKey: stableKey(params), detect: { v: 7 } as unknown as HistoryEntry['detect'] }), size);
    expect(o).toMatchObject({ detect: null, rematch: {}, cacheDropped: true });
    const pre = bodyAnswer(preAnswerCache(size, o.rematch), [{ pose: cacheBody('x', 0.5).pose, mask: null, score: 0.3 }], size);
    expect(pre.detect.rematch).toEqual({});
    // the stored b0 is dropped at the merge: the new body b0 starts from the look, not from its 細腰
    const e = pre.rebase(o.edit);
    expect(Object.keys(e.persons)).toEqual(['b0']);
    expect(e.persons.b0.values['body.waist']).toBe(0);
    expect(firstAnswer({ ...base, detect: pre.detect, prepared: two, rematch: o.rematch }).dropped).toBe(true);
    // closed before the face answer: the reopen keeps the empty rematch, so the answer still shows the reset toast
    const back = reopen(stored(e, pre.detect), size);
    expect(back.detect?.rematch).toEqual({});
    const a = firstAnswer({ ...base, detect: back.detect, prepared: two });
    expect(a.dropped).toBe(true);
    expect(a.detect.rematch).toBeUndefined();
  });

  it('R3 (E5): a 美體 cache that carried a rematch and no longer fits hands the rematch on with its own boxes', () => {
    const old = withPersons(assignPersons(editFromLegacy(applyPreset('glow', 1), { primaryInit: true }), ['f0', 'f1'], 'f0'), ['f0'], () => personFromPreset('refined', 1));
    const rematch = { f0: two.faces[0].box, f1: two.faces[1].box };
    const pre = bodyAnswer(preAnswerCache(size, rematch), [{ pose: cacheBody('x', 0.95).pose, mask: null, score: 0.3 }], size);
    const e = pre.rebase(old);
    const o = reopen(stored(e, { ...pre.detect, width: 1000, height: 1300 }), size);
    expect(o).toMatchObject({ detect: null, rematch, cacheDropped: true });
    const a = firstAnswer({ ...base, prepared: two, rematch: o.rematch });
    const done = a.rebase(o.edit);
    expect(done.persons.f0).toEqual(old.persons.f0);
    expect(done.persons.f1).toEqual(old.persons.f1);
  });

  it('staleFirst (E7): two bodies, the stored person’s face pairs with the body that does not hold the look: its stored params win over this session’s', () => {
    // f1 is stored as the primary; f0 (refined) is the stale person the rematch names
    const old = withPersons(assignPersons(editFromLegacy(applyPreset('glow', 1), { primaryInit: true }), ['f0', 'f1'], 'f1'), ['f0'], () => personFromPreset('refined', 1));
    const onF0 = bodyOn(two.faces[0].face, 0.3);
    const onF1 = bodyOn(two.faces[1].face, 0.3);
    const pre = bodyAnswer(preAnswerCache(size, { f0: two.faces[0].box }), [onF0, onF1], size);
    const holder = pre.detect.primary;
    const other = pre.detect.persons.find((p) => p.id !== holder)!.id;
    expect(pre.detect.bodies!.find((b) => b.id === other)!.pose).toBe(onF0.pose);
    // the body person f0's face pairs with got 細腰 meanwhile: the edit lists it before the stored f0
    const meanwhile = waist(pre.rebase(old), other, 0.6);
    expect(Object.keys(meanwhile.persons)).toEqual([...pre.detect.persons.map((p) => p.id), 'f0']);
    const a = firstAnswer({ ...base, detect: pre.detect, prepared: two });
    const owner = a.detect.persons.find((p) => p.face === 'f0')!;
    expect(owner.id).toBe(other);
    expect(a.dropped).toBe(true);
    const e = a.rebase(meanwhile);
    expect(e.persons[other]).toEqual(old.persons.f0);
    expect(e.persons.f0).toBeUndefined();
  });
});

describe('openState: the liquify frame (push-brush spec §3.3, §5)', () => {
  const rec = (id: string): Stroke => ({ id, kind: 'push', radius: 0.05, strength: 0.75, points: Float32Array.of(0.3, 0.3, 0.3125, 0.3) });
  const withStrokesEntry = (strokes: unknown[]): HistoryEntry => {
    const edit = { v: 2, photo: { ...defaultPhoto(), strokes }, persons: { p0: naturalPerson() }, template: neutralPerson(), primaryInit: null } as unknown as EditState;
    return { id: 'e1', createdAt: 1, updatedAt: 1, original: new Blob(['o']), thumb: new Blob(['t']), width: 1536, height: 2048, params: defaultParams(), schema: 2, edit } as HistoryEntry;
  };

  it('frame comes from the entry, not the decode (a tier-L reopen decodes at 1440)', () => {
    const st = openState(withStrokesEntry([rec('a')]), { width: 1080, height: 1440 });
    expect(st.frame).toEqual({ width: 1536, height: 2048 });
    expect(st.edit.photo.strokes.map((s) => s.id)).toEqual(['a']);
  });

  // PB §5.2 is normative: a malformed record drops alone (rules 1–4); only the caps (rule 5) drop everything after them.
  // (PB §7's row "along with every later record" contradicts §5.2; this plan follows §5.2.)
  it('drops only the corrupt record and keeps the replay order of the rest', () => {
    const bad = { ...rec('x'), points: Float32Array.of(0.3, NaN, 0.31, 0.3) };
    const st = openState(withStrokesEntry([rec('a'), bad, rec('b')]), { width: 1536, height: 2048 });
    expect(st.edit.photo.strokes.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('a v1 entry has no strokes', () => {
    const v1Entry = { id: 'e0', createdAt: 1, updatedAt: 1, original: new Blob(['o']), thumb: new Blob(['t']), width: 1536, height: 2048, params: defaultParams() } as HistoryEntry;
    const st = openState(v1Entry, { width: 1536, height: 2048 });
    expect(st.edit.photo.strokes).toEqual([]);
    expect(st.frame).toEqual({ width: 1536, height: 2048 });
  });
});
