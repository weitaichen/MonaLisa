import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyPreset, defaultParams, PARAM_DEFS, sanitizeParams, setParam } from '../engine/params';
import { makeBodyDetection } from '../app/testFakes';
import { prepareFaces } from '../detect/faces';
import { normalizeDetect, withBodies } from '../detect/cache';
import { cacheBody, makeCache } from '../detect/testCaches';
import { cropValid, IDENTITY_GEOMETRY, maxFit } from '../geometry/view';
import { normalizeEntry } from '../store/history';
import { stableKey } from '../store/undo';
import type { BeautyParams, EditState, Face, HistoryEntry, Landmarks478, ParamId, Pose33, Stroke } from '../types';
import { editFromLegacy, legacyProjection, splitLegacy } from './legacy';
import { bodyAnswer, cameraShotEdit, firstAnswer, importEdit, openState, preAnswerCache } from './migrate';
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
  it('a camera seed when the editor finds no face (C3): p0, the all-skin person the camera drew, keeps the look; a seed outside the frame still discards it', () => {
    const look = { photo: splitLegacy(defaultParams()).photo, person: personFromPreset('glow', 1) };
    const none = { faces: [], obstacles: [], dropped: { tooSmall: 0, overCap: 0 } };
    const inside = cameraShotEdit(look, { x: 0.5, y: 0.4 });
    const a = firstAnswer({ ...base, prepared: none, faceSeed: { x: 0.5, y: 0.4 } });
    expect(Object.keys(a.rebase(inside).persons)).toEqual(['p0']);
    expect(a.rebase(inside).persons.p0).toEqual(look.person);
    // a body-only person (no face anywhere) gets it too: p0 hands over to the primary body person
    const withBody = firstAnswer({ ...base, prepared: none, v1Body: { bodies: [cacheBody('b0', 0.5)], complete: true }, faceSeed: { x: 0.5, y: 0.4 } });
    expect(withBody.rebase(inside).persons.b0).toEqual(look.person);
    // the beautified face was outside the saved crop: the shot drew no 磨皮 in frame
    const outside = cameraShotEdit(look, { x: 1.3, y: 0.4 });
    const out = firstAnswer({ ...base, prepared: none, faceSeed: { x: 1.3, y: 0.4 } });
    expect(out.rebase(outside).persons.p0).toEqual(neutralPerson());
  });
  it('bodies found before the first face answer (S §7) build the 基本模式 form of the cache; the answer merges into it: a camera seed still names the primary, b0’s person keeps the local 美體 values', () => {
    const look = { photo: splitLegacy(defaultParams()).photo, person: personFromPreset('glow', 1) };
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
    const shotOf = (seed: { x: number; y: number }) => waist(pre.rebase(cameraShotEdit(look, seed)));
    const shot = shotOf({ x: 0.7, y: 0.4 });
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
    // the seed in no face box: everyone starts from the template, but b0's person keeps the 美體 edit made on it
    const miss = firstAnswer({ ...base, detect: pre.detect, prepared: two, faceSeed: { x: 0.05, y: 0.95 } });
    const m = miss.rebase(shotOf({ x: 0.05, y: 0.95 }));
    expect(m.persons.b0.values['body.waist']).toBe(0.7);
    expect(m.persons.b0.values['skin.smooth']).toBe(0);
    expect(m.persons.f1).toEqual(neutralPerson());
    // without a seed b0's person is the primary (A13) and keeps everything it had
    const plain = firstAnswer({ ...base, detect: pre.detect, prepared: two });
    expect(plain.detect.primary).toBe('b0');
    expect(plain.rebase(shot).persons.b0).toEqual(shot.persons.b0);
  });
  it('a 美體 cache is stored before the first face answer and reopened: the 美體 edit stays on the same body (D4)', () => {
    // face A scores best as a face; B's body scores best as a body, so p0 (the 美體 edits) sits on B's body
    const onA = { pose: poseOnFace(two.faces[0].face), mask: null, score: 0.2 };
    const onB = { pose: poseOnFace(two.faces[1].face), mask: null, score: 0.5 };
    const pre = bodyAnswer(preAnswerCache(size, null), [onA, onB], size);
    const held = pre.detect.persons.find((p) => p.id === pre.detect.primary)!;
    expect(pre.detect.bodies!.find((b) => b.id === held.body)!.pose).toBe(onB.pose);
    const edit = withPersons(pre.rebase(importEdit({ photo: defaultPhoto(), person: naturalPerson() })), [held.id], (p) => ({ ...p, values: { ...p.values, 'body.waist': 0.7 } }));
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

  it('R2 (E1): a camera seed names face A, whose body person got 細腰 before the answer: A gets the look’s face part and keeps its 細腰', () => {
    const look = { photo: splitLegacy(defaultParams()).photo, person: personFromPreset('glow', 1) };
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
    const shot = pre.rebase(cameraShotEdit(look, seed));
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
