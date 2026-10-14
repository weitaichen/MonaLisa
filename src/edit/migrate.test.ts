import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyPreset, defaultParams, PARAM_DEFS, sanitizeParams, setParam } from '../engine/params';
import { makeBodyDetection } from '../app/testFakes';
import { prepareFaces } from '../detect/faces';
import { withBodies } from '../detect/cache';
import { cacheBody, makeCache } from '../detect/testCaches';
import { IDENTITY_GEOMETRY } from '../geometry/view';
import { normalizeEntry } from '../store/history';
import { stableKey } from '../store/undo';
import type { BeautyParams, EditState, Face, HistoryEntry, Landmarks478, ParamId, Pose33 } from '../types';
import { editFromLegacy, legacyProjection, splitLegacy } from './legacy';
import { bodyAnswer, cameraShotEdit, firstAnswer, importEdit, openState } from './migrate';
import { assignPersons, defaultPhoto, editFlipView, naturalPerson, neutralPerson, personFromPreset, withPersons } from './state';
import { sessionPlan } from '../ui/editorModel';

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

describe('new photos (RM §3.7)', () => {
  const look = { photo: splitLegacy(defaultParams()).photo, person: naturalPerson() };
  it('an import gives everyone the camera look', () => {
    const e = importEdit(look);
    expect(e.template).toEqual(look.person);
    expect(e.persons.p0).toEqual(look.person);
    expect(e.primaryInit).toBeNull();
  });
  it('a shot seeded on one face: only the primary gets the look; 全部套用 or no face: everyone', () => {
    expect(cameraShotEdit(look, { x: 0.4, y: 0.5 }).template).toEqual(neutralPerson());
    expect(cameraShotEdit(look, { x: 0.4, y: 0.5 }).primaryInit).toEqual(look.person);
    expect(cameraShotEdit(look, 'all').template).toEqual(look.person);
    expect(cameraShotEdit(look, null).template).toEqual(look.person);
  });
});

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
  it('a camera seed on face B makes B the primary with the look; no box contains the seed → everyone from the template', () => {
    const look = { photo: splitLegacy(defaultParams()).photo, person: personFromPreset('glow', 1) };
    const shot = cameraShotEdit(look, { x: 0.7, y: 0.4 });
    const a = firstAnswer({ ...base, prepared: two, faceSeed: { x: 0.7, y: 0.4 } });
    expect(a.detect.primary).toBe('f1');
    expect(a.rebase(shot).persons.f1).toEqual(look.person);
    expect(a.rebase(shot).persons.f0).toEqual(neutralPerson());
    const miss = firstAnswer({ ...base, prepared: two, faceSeed: { x: 0.05, y: 0.95 } });
    expect(Object.values(miss.rebase(shot).persons).every((p) => JSON.stringify(p) === JSON.stringify(neutralPerson()))).toBe(true);
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
