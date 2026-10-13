// editorModel.ts: when the editor trusts a "no face", how often it re-detects, and 儲存 surviving a session swap.
import { describe, expect, it, vi } from 'vitest';
import type { BodyFieldInput } from '../body/field';
import type { BodyMeasure } from '../body/measure';
import { fakeBodyTracker, makeBodyDetection, makeBodyDetections, makeBodyField, makeFace } from '../app/testFakes';
import { personInfos } from '../detect/cache';
import { cacheBody, makeCache } from '../detect/testCaches';
import { applyPreset, setHeightBand, setParam } from '../engine/params';
import type { BeautyParams, BodyField, EditState, Face, ParamId, PersonId, RegionStatus, Selection, TrackerState } from '../types';
import { lensFor, P0_INFO } from '../edit/lens';
import { editFromLegacy } from '../edit/legacy';
import { assignPersons, withPersons } from '../edit/state';
import {
  answerNotices,
  ANY_FIELD,
  BODY_DRAFT_LONG_EDGE,
  BODY_NONE_REASON,
  BODY_UNMEASURED_REASON,
  BodyFieldMemo,
  bodyInputKey,
  bodyPanelContext,
  changedPersons,
  detectBody,
  detectSession,
  exportOnLatest,
  FieldDraftGate,
  fieldInputOf,
  frameFacesOf,
  hitCtxOf,
  MAX_REDETECTS,
  measuredAvailable,
  measurePersons,
  needsBodyMeasure,
  protectRequests,
  rebaseStamp,
  RedetectBudget,
  sessionPlan,
  shouldDetectBody,
  stampIs,
  suggestedBand,
  thumbRect,
  undoToast,
  type BodyDet,
} from './editorModel';
import { BODY_ERROR_NOTE, bodyNote, INITIAL_SELECTION, itemsFor, sliderFor } from './panelModel';

const lensOfEdit = (e: EditState) => lensFor(e, { kind: 'person', id: 'p0' }, P0_INFO, 'p0');
const lensOf = (p: BeautyParams) => lensOfEdit(editFromLegacy(p));

const FACE = {} as Face;
const session = (face: Face | null, faceKnown = true) => ({ faces: face ? [face] : [], faceKnown });

describe('detectSession', () => {
  it('a healthy tracker that found nothing is a definite "no face"', () => {
    expect(detectSession(true, () => true, () => session(null)).unsure).toBe(false);
  });

  it('a face is always an answer, even from a tracker reported unhealthy', () => {
    expect(detectSession(true, () => false, () => session(FACE)).unsure).toBe(false);
  });

  it('unsure when the tracker was unhealthy before the call, or the call threw', () => {
    expect(detectSession(true, () => false, () => session(null)).unsure).toBe(true);
    expect(detectSession(true, () => true, () => session(null, false)).unsure).toBe(true);
  });

  it('unsure when the detect call itself found the tracker lost (it reports "lost" before returning null)', () => {
    let health: TrackerState = 'ok';
    const r = detectSession(
      true,
      () => health === 'ok',
      () => {
        health = 'lost'; // tracker.ts usable() → retire() → onStateChange('lost'), synchronously
        return session(null);
      },
    );
    expect(r.unsure).toBe(true);
  });

  it('基本模式 (no tracker) is never unsure', () => {
    expect(detectSession(false, () => false, () => session(null, false)).unsure).toBe(false);
  });

  it('a cached answer is never unsure: "no face" reopened while the tracker is lost / failed is still "no face" (S §3.3 item 3)', () => {
    const noFace = makeCache({ faces: [], persons: [] });
    const plan = sessionPlan(noFace, true);
    expect(plan).toEqual({ useCache: true, asks: false });
    // the tracker is down before and after: the cached faces (none) are the answer, so no 「臉部偵測重新啟動中…」 note
    expect(detectSession(plan.asks, () => false, () => session(null)).unsure).toBe(false);
    // no upright scan cached (only a rotated one): the tracker is asked, and an unhealthy one cannot answer
    const rotated = sessionPlan(makeCache({ faces: [], persons: [], faceScans: [{ quarter: 1, flipH: false }] }), true);
    expect(rotated).toEqual({ useCache: false, asks: true });
    expect(detectSession(rotated.asks, () => false, () => session(null)).unsure).toBe(true);
    // no cache: the tracker is asked; 基本模式 uses any cache it has and asks nobody
    expect(sessionPlan(null, true)).toEqual({ useCache: false, asks: true });
    expect(sessionPlan(makeCache({ faceScans: [] }), false)).toEqual({ useCache: true, asks: false });
    expect(sessionPlan(null, false)).toEqual({ useCache: false, asks: false });
  });
});

describe('RedetectBudget', () => {
  it('detects again while answers stay unsure and the tracker is ok, up to MAX_REDETECTS', () => {
    const b = new RedetectBudget('ok');
    for (let i = 0; i < MAX_REDETECTS; i++) expect(b.next(true, 'ok')).toBe(true);
    expect(b.next(true, 'ok')).toBe(false);
  });

  it('two throwing detects then a success: the third re-detect still runs', () => {
    const b = new RedetectBudget('ok');
    expect(b.next(true, 'ok')).toBe(true); // first detect threw
    expect(b.next(true, 'ok')).toBe(true); // re-detect 1 threw
    expect(b.next(true, 'ok')).toBe(true); // re-detect 2 threw → re-detect 3 (finds the face)
    expect(b.next(false, 'ok')).toBe(false); // a definite answer: no more
  });

  it('waits while the tracker is not ok and never re-detects a definite answer', () => {
    const b = new RedetectBudget('lost');
    expect(b.next(true, 'lost')).toBe(false);
    expect(b.next(true, 'failed')).toBe(false);
    expect(b.next(false, 'ok')).toBe(false);
  });

  it('a tracker flapping ok → lost inside the re-detect gets another try once it is ok again', () => {
    const b = new RedetectBudget('lost');
    expect(b.next(true, 'ok')).toBe(true); // recovered: re-detect
    expect(b.next(true, 'lost')).toBe(false); // lost again during it: unsure, wait
    expect(b.next(true, 'ok')).toBe(true); // back: try again
  });

  it('a recovery refills a spent budget', () => {
    const b = new RedetectBudget('ok');
    for (let i = 0; i < MAX_REDETECTS; i++) b.next(true, 'ok');
    expect(b.next(true, 'ok')).toBe(false);
    expect(b.next(true, 'lost')).toBe(false); // 3rd throw escalated: the tracker replaces its instance
    expect(b.next(true, 'ok')).toBe(true);
  });
});

describe('exportOnLatest', () => {
  interface Fake {
    id: string;
    disposed: boolean;
  }
  const make = (id: string): Fake => ({ id, disposed: false });
  const run = async (s: Fake) => {
    await Promise.resolve(); // prepareExport (the LUT download)
    if (s.disposed) throw new Error('StillSession: disposed');
    return `file from ${s.id}`;
  };

  it('a session replaced while preparing: the export comes from the replacement', async () => {
    const old = make('old');
    let current = old;
    const p = exportOnLatest(old, run, (failed) => (current !== failed ? current : null));
    // the re-detect swaps sessions while the export waits
    old.disposed = true;
    current = make('new');
    const r = await p;
    expect(r.result).toBe('file from new');
    expect(r.s).toBe(current);
  });

  it('a failure on the still-current session stands', async () => {
    const s = make('a');
    const failing = vi.fn(async () => {
      throw new Error('encode failed');
    });
    await expect(exportOnLatest(s, failing, (f) => (f !== s ? s : null))).rejects.toThrow('encode failed');
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it('retries are capped', async () => {
    let n = 0;
    const failing = vi.fn(async () => {
      throw new Error('disposed');
    });
    await expect(exportOnLatest(make('0'), failing, () => make(String(++n)), 2)).rejects.toThrow('disposed');
    expect(failing).toHaveBeenCalledTimes(3);
  });
});

// ───────────────────────── 美體 ─────────────────────────

describe('美體 decisions', () => {
  const base = applyPreset('natural');
  const det = makeBodyDetection(1);
  const measure = (people = 1): BodyMeasure =>
    ({
      people,
      aspect: 0.75,
      regions: {
        head: { ok: false, reason: '需要偵測到臉部' },
        shoulder: { ok: true, reason: null },
        arms: { ok: true, reason: null },
        torso: { ok: true, reason: null },
        legs: { ok: false, reason: '拍攝全身照可使用長腿／瘦腿' },
      },
    }) as BodyMeasure;
  const avail = (m: BodyMeasure | null, id: ParamId): RegionStatus =>
    m ? (id === 'body.legs' ? m.regions.legs : m.regions.torso) : { ok: false, reason: 'no measure' };

  it('needsBodyMeasure: any slider off neutral (美臀 is centre-zero); the band alone needs no detection', () => {
    expect(needsBodyMeasure(base)).toBe(false);
    expect(needsBodyMeasure(setParam(base, 'body.hip', 0.5))).toBe(false);
    expect(needsBodyMeasure(setParam(base, 'body.hip', 0.3))).toBe(true);
    expect(needsBodyMeasure(setParam(base, 'body.legs', 0.2))).toBe(true);
    expect(needsBodyMeasure(setHeightBand(base, { top: 0.5, bottom: 0.8, amount: 1 }))).toBe(false);
  });

  it('shouldDetectBody: first tab open, or at once for params that use body sliders; waits for the cache read', () => {
    const idle: BodyDet = { phase: 'idle' };
    expect(shouldDetectBody(idle, { tabOpen: false, entered: false, params: base })).toBe(false);
    expect(shouldDetectBody(idle, { tabOpen: true, entered: true, params: base })).toBe(true);
    const edited = setParam(base, 'body.slim', 0.5);
    expect(shouldDetectBody(idle, { tabOpen: false, entered: false, params: edited })).toBe(true);
    expect(shouldDetectBody({ phase: 'working' }, { tabOpen: true, entered: true, params: base })).toBe(false);
    // a finished detection (cached or not, person or not) is never repeated
    for (const d of [det, null]) {
      expect(shouldDetectBody({ phase: 'done', det: d }, { tabOpen: true, entered: true, params: edited })).toBe(false);
    }
  });

  it('an error is retried only when the user comes back to the 美體 tab', () => {
    const err: BodyDet = { phase: 'error', message: 'x' };
    expect(shouldDetectBody(err, { tabOpen: true, entered: false, params: setParam(base, 'body.slim', 1) })).toBe(false);
    expect(shouldDetectBody(err, { tabOpen: true, entered: true, params: base })).toBe(true);
  });

  it('detectBody runs the tracker on the photo after the pause; failures propagate', async () => {
    const dets = makeBodyDetections(1);
    const t = fakeBodyTracker(dets);
    const img = {} as ImageBitmap;
    const order: string[] = [];
    const pause = async () => {
      order.push('pause');
      expect(t.detect).not.toHaveBeenCalled();
    };
    expect(await detectBody(async () => t, img, { pause })).toBe(dets);
    expect(order).toEqual(['pause']);
    expect(t.detect).toHaveBeenCalledWith(img);
    t.result = null;
    expect(await detectBody(async () => t, img)).toBeNull();
    t.detect.mockImplementationOnce(() => {
      throw new Error('graph');
    });
    await expect(detectBody(async () => t, img)).rejects.toThrow('graph');
    await expect(detectBody(() => Promise.reject(new Error('download')), img)).rejects.toThrow('download');
  });

  it('detectBody waits out a recovering tracker (BodyTrackerRecovering) instead of failing', async () => {
    const dets = makeBodyDetections(1);
    const t = fakeBodyTracker(dets);
    const recovering = () => Object.assign(new Error('rebuilding'), { name: 'BodyTrackerRecovering' });
    t.detect
      .mockImplementationOnce(() => {
        throw recovering();
      })
      .mockImplementationOnce(() => {
        throw recovering();
      });
    let waits = 0;
    const recoverWait = async () => {
      waits++;
    };
    expect(await detectBody(async () => t, {} as ImageBitmap, { recoverWait })).toBe(dets);
    expect(waits).toBe(2);
    // still recovering after every try → the error surfaces (重試)
    t.detect.mockImplementation(() => {
      throw recovering();
    });
    await expect(detectBody(async () => t, {} as ImageBitmap, { recoverWait })).rejects.toThrow('rebuilding');
    // closed while waiting → undefined
    let closed = false;
    const n = t.detect.mock.calls.length;
    const p = detectBody(async () => t, {} as ImageBitmap, {
      recoverWait: async () => {
        closed = true;
      },
      cancelled: () => closed,
    });
    expect(await p).toBeUndefined();
    expect(t.detect.mock.calls.length).toBe(n + 1);
  });

  it('detectBody: closed meanwhile → undefined, the (closed) photo is never touched', async () => {
    const t = fakeBodyTracker(makeBodyDetections(1));
    expect(await detectBody(async () => t, {} as ImageBitmap, { cancelled: () => true })).toBeUndefined();
    expect(t.detect).not.toHaveBeenCalled();
  });

  it('bodyPanelContext: loading with the model download progress', () => {
    const c = bodyPanelContext({ phase: 'working' }, { state: 'loading', step: 'model', progress: 0.42 }, null, avail);
    expect(c.status).toBe('loading');
    expect(c.progress).toBe(0.42);
    expect(c.availability('body.slim').ok).toBe(false);
    const creating = bodyPanelContext({ phase: 'working' }, { state: 'loading', step: 'tracker', progress: 1 }, null, avail);
    expect(creating.progress).toBeUndefined();
    const started = bodyPanelContext({ phase: 'working' }, { state: 'loading', step: 'model', progress: null }, null, avail);
    expect(started.progress).toBe(0);
    expect(bodyPanelContext({ phase: 'idle' }, { state: 'idle' }, null, avail).status).toBe('idle');
  });

  it('bodyPanelContext: no person → none with the manual-增高 reason', () => {
    const c = bodyPanelContext({ phase: 'done', det: null }, { state: 'ready' }, null, avail);
    expect(c.status).toBe('none');
    expect(c.availability('body.waist')).toEqual({ ok: false, reason: BODY_NONE_REASON });
    expect(BODY_NONE_REASON).toBe('未偵測到人物，仍可使用手動增高');
  });

  it('bodyPanelContext: ready → per-slider gating from the measure, people from the measure', () => {
    const c = bodyPanelContext({ phase: 'done', det: makeBodyDetection(3) }, { state: 'ready' }, measure(3), avail);
    expect(c.status).toBe('ready');
    expect(c.people).toBe(3);
    expect(c.availability('body.waist').ok).toBe(true);
    expect(c.availability('body.legs')).toEqual({ ok: false, reason: '拍攝全身照可使用長腿／瘦腿' });
    // a cached detection read back while the tracker never loaded is just as ready
    expect(bodyPanelContext({ phase: 'done', det }, { state: 'idle' }, measure(), avail).status).toBe('ready');
  });

  it('bodyPanelContext: an error offers 重試 and keeps the reason', () => {
    const retry = vi.fn();
    const c = bodyPanelContext({ phase: 'error', message: '網路連線不穩，請確認網路後重試' }, { state: 'idle' }, null, avail, retry);
    expect(c.status).toBe('error');
    expect(c.retry).toBe(retry);
    expect(c.availability('body.slim')).toEqual({ ok: false, reason: '網路連線不穩，請確認網路後重試' });
  });

  it('bodyPanelContext → panel: the friendly error cause reaches the strip note, the sliders stay off', () => {
    const hint = '目前沒有網路連線，請連上網路後重試';
    const c = bodyPanelContext({ phase: 'error', message: hint }, { state: 'error', message: 'TypeError', hint }, null, avail, vi.fn());
    expect(c.message).toBe(hint);
    const note = bodyNote(c)!;
    expect(note.text).toContain(hint);
    expect(note.text).toContain('仍可使用手動增高');
    expect(note.action?.label).toBe('重試');
    const slim = itemsFor(lensOf(setParam(applyPreset('natural', 1), 'body.slim', 0)), { ...INITIAL_SELECTION, tab: 'body' }, c).find(
      (i) => i.key === 'body.slim',
    )!;
    expect(slim).toMatchObject({ disabled: true, reason: BODY_ERROR_NOTE });
    // without a cause the note is the generic one
    expect(bodyNote({ ...c, message: undefined })?.text).toBe(BODY_ERROR_NOTE);
  });

  it('bodyPanelContext → panel: 背景保護 is off when the measure has no person mask (CPU fallback)', () => {
    const p = applyPreset('natural', 1);
    const s = { ...INITIAL_SELECTION, tab: 'body' as const };
    const protect = (c: ReturnType<typeof bodyPanelContext>) => itemsFor(lensOf(p), s, c).find((i) => i.key === 'protect')!;
    const masked = { ...measure(), mask: { width: 4, height: 4, data: new Uint8Array(16) } } as BodyMeasure;
    const withMask = bodyPanelContext({ phase: 'done', det }, { state: 'ready' }, masked, avail);
    expect(withMask.hasMask).toBe(true);
    expect(protect(withMask).disabled).toBe(false);
    const noMask = bodyPanelContext({ phase: 'done', det }, { state: 'ready' }, { ...masked, mask: null }, avail);
    expect(noMask.hasMask).toBe(false);
    expect(protect(noMask)).toMatchObject({ disabled: true, reason: '無法取得人像輪廓，背景保護暫不可用' });
    // no measure at all: the field has no mask to protect with either
    expect(bodyPanelContext({ phase: 'done', det }, { state: 'ready' }, null, avail).hasMask).toBe(false);
  });

  it('a detection without a usable measure is ready but every slider stays off', () => {
    const c = bodyPanelContext({ phase: 'done', det }, { state: 'ready' }, null, avail);
    expect(c.status).toBe('ready');
    expect(c.availability('body.slim')).toEqual({ ok: false, reason: BODY_UNMEASURED_REASON });
  });

  it('suggestedBand: hips → ankles of a clearly visible person, else the panel default', () => {
    const d = makeBodyDetection();
    const pt = d.pose.points;
    const b = suggestedBand(d)!;
    expect(b.top).toBeCloseTo((pt[23 * 4 + 1] + pt[24 * 4 + 1]) / 2, 6);
    expect(b.bottom).toBeCloseTo((pt[27 * 4 + 1] + pt[28 * 4 + 1]) / 2, 6);
    expect(bodyPanelContext({ phase: 'done', det: d }, { state: 'ready' }, measure(), avail).suggestedBand).toEqual(b);
    pt[27 * 4 + 3] = 0.2; // ankle hidden (a portrait)
    expect(suggestedBand(d)).toBeUndefined();
    expect('suggestedBand' in bodyPanelContext({ phase: 'done', det: d }, { state: 'ready' }, measure(), avail)).toBe(false);
    expect(suggestedBand(null)).toBeUndefined();
  });

  it('FieldDraftGate: only the params change of a drag step takes the draft path', () => {
    const gate = new FieldDraftGate();
    const pending = { phase: 'loading' };
    // first run (no drag): full
    expect(gate.next(pending)).toBe('full');
    // a drag step: its params change previews a draft, and the pending draft frame still builds a draft
    gate.noteUpdate(false);
    expect(gate.next(pending)).toBe('draft');
    expect(gate.draft).toBe(true);
    // the commit: full
    gate.noteUpdate(true);
    expect(gate.next(pending)).toBe('full');
    expect(gate.draft).toBe(false);
  });

  it('FieldDraftGate: a measure change after an aborted drag builds full (re-arms the encode), not a draft', () => {
    const gate = new FieldDraftGate();
    const before = { measure: 'band only' };
    gate.next(before);
    // a 增高 line drag that never commits (the overlay unmounted by 按住對比 mid-drag)
    gate.noteUpdate(false);
    expect(gate.next(before)).toBe('draft');
    // the detection arrives: a new measure with no params change must build the full field now
    const after = { measure: 'detected' };
    expect(gate.next(after)).toBe('full');
    // ...also while a drag really is in progress; its next step goes back to drafts
    gate.noteUpdate(false);
    expect(gate.next(after)).toBe('draft');
    expect(gate.next({ measure: 'face changed' })).toBe('full');
  });

  it('FieldDraftGate: a full build (settleField) or undo / redo clears a stale drag flag', () => {
    const gate = new FieldDraftGate();
    const m = {};
    gate.next(m);
    gate.noteUpdate(false); // drag step, never committed
    gate.noteFull(); // the encode debounce settled the field
    expect(gate.draft).toBe(false);
    expect(gate.next(m)).toBe('full');
    // the next real drag step drafts again
    gate.noteUpdate(false);
    expect(gate.next(m)).toBe('draft');
  });

  it('output stamps: a new 美體 field at the same params makes the share file and the autosave stale', () => {
    const key = 'k';
    // encoded and autosaved with field generation 1 (增高 only, the detection not there yet)
    const fresh = { key, field: 1 };
    expect(stampIs(fresh, key, 1)).toBe(true);
    // the detection arrives: same params, field generation 2 → encode and save again
    expect(stampIs(fresh, key, 2)).toBe(false);
    expect(stampIs(fresh, 'other', 1)).toBe(false);
    expect(stampIs(null, key, 1)).toBe(false);
    // a reopened entry is saved with whatever field it had: rebuilding that field writes nothing
    const reopened = { key, field: ANY_FIELD };
    expect(stampIs(reopened, key, 0)).toBe(true);
    expect(stampIs(reopened, key, 7)).toBe(true);
    expect(stampIs(reopened, 'edited', 7)).toBe(false);
  });

});

describe('BodyFieldMemo (multi-person)', () => {
  it('rebuilds only when the input key changes; a full build answers a later draft', () => {
    const build = vi.fn((_i: BodyFieldInput, _p?: BodyField | null, _e?: number) => makeBodyField());
    const memo = new BodyFieldMemo(build);
    const m = {} as BodyMeasure;
    const input = (waist: number): BodyFieldInput => ({ edited: [{ id: 'f0', measure: m, values: { 'body.waist': waist } as never }], masks: [], heightBand: null, legs: { value: 0, measure: null }, bodyProtect: true, aspect: 0.75 });
    expect(memo.update(input(0.5)).changed).toBe(true);
    expect(memo.update(input(0.5), true).changed).toBe(false);
    expect(memo.update(input(0.6), true).changed).toBe(true);
    expect(build.mock.calls.at(-1)![2]).toBe(BODY_DRAFT_LONG_EDGE);
  });
  it('a drag step builds a draft; the commit with the same input rebuilds it at full resolution; then neither rebuilds', () => {
    const build = vi.fn((_i: BodyFieldInput, _p?: BodyField | null, edge?: number) => {
      const f = makeBodyField(0.01);
      f.width = edge ?? 256;
      return f;
    });
    const memo = new BodyFieldMemo(build);
    const input: BodyFieldInput = { edited: [{ id: 'f0', measure: {} as BodyMeasure, values: { 'body.slim': 0.6 } as never }], masks: [], heightBand: null, legs: { value: 0, measure: null }, bodyProtect: true, aspect: 0.75 };
    expect(memo.update(input, true).changed).toBe(true);
    expect(build.mock.calls[0][2]).toBe(BODY_DRAFT_LONG_EDGE);
    // the next drag step at the same value: nothing to do
    expect(memo.update(input, true).changed).toBe(false);
    // the commit (or an export) at the same value: full resolution
    const full = memo.update(input);
    expect(full.changed).toBe(true);
    expect(build).toHaveBeenCalledTimes(2);
    expect(build.mock.calls[1][2]).toBeUndefined();
    expect(full.field?.width).toBe(256);
    // a full field answers a later draft request (a pending drag frame after the commit) and a repeated commit
    expect(memo.update(input, true).changed).toBe(false);
    expect(memo.update({ ...input }).changed).toBe(false);
    expect(build).toHaveBeenCalledTimes(2);
  });
  it('the previous field is passed to the build: the same object refilled (a new version) is a change; null → null is not', () => {
    let v = 0;
    const build = vi.fn((i: BodyFieldInput, prev?: BodyField | null) => {
      if (!i.edited.length) return null;
      const f = prev ?? makeBodyField(0, 0);
      f.version = ++v; // refills the same buffer
      return f;
    });
    const memo = new BodyFieldMemo(build);
    const none: BodyFieldInput = { edited: [], masks: [], heightBand: null, legs: { value: 0, measure: null }, bodyProtect: true, aspect: 0.75 };
    const slim = (x: number): BodyFieldInput => ({ ...none, edited: [{ id: 'f0', measure: {} as BodyMeasure, values: { 'body.slim': x } as never }] });
    expect(memo.update(none)).toEqual({ field: null, changed: false });
    const a = memo.update(slim(0.6));
    expect(a.changed).toBe(true);
    expect(a.field?.version).toBe(1);
    const b = memo.update(slim(0.7));
    expect(b).toMatchObject({ changed: true, field: a.field }); // same object, new version
    expect(build.mock.calls[2][1]).toBe(a.field);
    // back to neutral → no field
    expect(memo.update(none)).toEqual({ field: null, changed: true });
  });
  it('bodyInputKey: equal inputs share a key; a measure, a mask, the band, 長腿 or its anchor, 背景保護 or the aspect change it', () => {
    const m = {} as BodyMeasure;
    const mask = { width: 1, height: 1, data: new Uint8Array(1) };
    const base: BodyFieldInput = { edited: [{ id: 'f0', measure: m, values: { 'body.waist': 0.5 } as never }], masks: [{ id: 'f0', mask }], heightBand: null, legs: { value: 0, measure: null }, bodyProtect: true, aspect: 0.75 };
    const k = bodyInputKey(base);
    expect(bodyInputKey({ ...base, edited: [{ ...base.edited[0], values: { 'body.waist': 0.5 } as never }] })).toBe(k);
    const variants: BodyFieldInput[] = [
      { ...base, edited: [{ ...base.edited[0], measure: {} as BodyMeasure }] },
      { ...base, masks: [{ id: 'f0', mask: { ...mask } }] },
      { ...base, heightBand: { top: 0.3, bottom: 0.6, amount: 0.5 } },
      { ...base, legs: { value: 0.4, measure: null } },
      { ...base, legs: { value: 0, measure: m } },
      { ...base, bodyProtect: false },
      { ...base, aspect: 0.5 },
    ];
    for (const v of variants) expect(bodyInputKey(v)).not.toBe(k);
  });
});

describe('persons in the editor model (S §3.3)', () => {
  const cache = makeCache({ bodies: [cacheBody('b0', 0.3), cacheBody('b1', 0.7)], persons: [{ id: 'f0', face: 'f0', body: 'b0' }, { id: 'f1', face: 'f1', body: null }, { id: 'b1', face: null, body: 'b1' }] });
  it('each body person is measured with its paired face, or none', () => {
    const seen: [number, boolean][] = [];
    const ms = measurePersons(cache, () => FACE, (d, f) => (seen.push([d.pose.points[0], f !== null]), {} as BodyMeasure), () => undefined);
    expect([...ms.keys()]).toEqual(['f0', 'b1']);
    expect(seen.map(([, f]) => f)).toEqual([true, false]);
  });
  it('a body person without a measure (measureBody threw) can use no local 美體 item: no dead slider (Review Focus #2)', () => {
    // the waist is measurable on any measure; nothing without one
    const torso = (m: BodyMeasure | null, id: ParamId): RegionStatus => (m && id === 'body.waist' ? { ok: true, reason: null } : { ok: false, reason: 'x' });
    const lens = (s: Selection, ms: ReadonlyMap<PersonId, BodyMeasure>) =>
      lensFor(assignPersons(editFromLegacy(applyPreset('natural', 1)), ['f0', 'f1', 'b1'], 'f0'), s, personInfos(cache), 'f0', {
        available: (p, id) => measuredAvailable(ms, p, id, torso),
      });
    const s = { ...INITIAL_SELECTION, tab: 'body' as const, body: 'body.waist' as const };
    const waist = (l: ReturnType<typeof lens>, c: ReturnType<typeof bodyPanelContext>) => itemsFor(l, s, c).find((i) => i.key === 'body.waist')!;
    // every measure threw: the context reads BODY_UNMEASURED_REASON, and so does the item, for 全部 and each body person
    const boom = (): BodyMeasure => {
      throw new Error('bad mask');
    };
    const onError = vi.fn();
    const none = measurePersons(cache, () => FACE, boom, onError);
    expect(none.size).toBe(0);
    expect(onError).toHaveBeenCalledTimes(2); // reported once per body person, never thrown
    const unmeasured = bodyPanelContext({ phase: 'done', det: makeBodyDetection(2) }, { state: 'ready' }, null, torso);
    for (const sel of [{ kind: 'all' }, { kind: 'person', id: 'f0' }, { kind: 'person', id: 'b1' }] as Selection[]) {
      expect(waist(lens(sel, none), unmeasured), JSON.stringify(sel)).toMatchObject({ disabled: true, reason: BODY_UNMEASURED_REASON });
      expect(sliderFor(lens(sel, none), s, unmeasured), JSON.stringify(sel)).toBeNull();
    }
    // only b1 measured: 全部 writes b1 alone; f0 (a body, no measure) has no slider
    const m = {} as BodyMeasure;
    const some = new Map([['b1', m]]);
    const measured = bodyPanelContext({ phase: 'done', det: makeBodyDetection(2) }, { state: 'ready' }, m, torso);
    expect(lens({ kind: 'all' }, some).targets('body.waist')).toEqual(['b1']);
    expect(waist(lens({ kind: 'all' }, some), measured).disabled).toBe(false);
    expect(waist(lens({ kind: 'person', id: 'f0' }, some), measured).disabled).toBe(true);
    expect(sliderFor(lens({ kind: 'person', id: 'f0' }, some), s, measured)).toBeNull();
  });
  it('fieldInputOf lists only persons with a body and a non-neutral local item; 長腿 anchors on the primary with a body', () => {
    const m0 = {} as BodyMeasure;
    const m1 = {} as BodyMeasure;
    const e = lensFor(assignPersons(editFromLegacy(applyPreset('natural', 1)), ['f0', 'f1', 'b1'], 'f0'), { kind: 'person', id: 'b1' }, personInfos(cache), 'f0').set('body.waist', 0.5);
    const i = fieldInputOf(e, cache, new Map([['f0', m0], ['b1', m1]]), 0.75);
    expect(i.edited.map((p) => p.id)).toEqual(['b1']);
    expect(i.legs.measure).toBe(m0);
    // 長腿 on: every body person rides along (hands-rigid term), as one person did in v0.3
    const legs = { ...e, photo: { ...e.photo, values: { ...e.photo.values, 'body.legs': 0.3 } } };
    expect(fieldInputOf(legs, cache, new Map([['f0', m0], ['b1', m1]]), 0.75).edited.map((p) => p.id)).toEqual(['f0', 'b1']);
  });
  it('frameFacesOf links faces to persons; protectRequests: windows with ≥ 2 faces and the others’ ovals', () => {
    const faces = [{ id: 'f0', face: makeFace(0, 0.3), box: cache.faces[0].box, lm: cache.faces[0].lm }, { id: 'f1', face: makeFace(1, 0.7), box: cache.faces[1].box, lm: cache.faces[1].lm }];
    expect(frameFacesOf(cache, faces).map((f) => f.person)).toEqual(['f0', 'f1']);
    const r = protectRequests(cache, faces, assignPersons(editFromLegacy(applyPreset('natural', 1)), ['f0', 'f1', 'b1'], 'f0'), { width: 1600, height: 1200 });
    expect(r[0].others.otherOvals).toHaveLength(1);
    expect(r[0].others.window).not.toBeNull();
    expect(r[0].contour).toBe(true);
  });
  it('rebaseStamp: a saved output stays saved across a detection-driven rebase; an unsaved one stays unsaved (U2, S §8.1)', () => {
    const saved = { key: 'a', field: ANY_FIELD };
    expect(rebaseStamp(saved, 'a', 'b', 3)).toEqual({ key: 'b', field: ANY_FIELD });
    expect(stampIs(rebaseStamp(saved, 'a', 'b', 3), 'b', 7)).toBe(true);
    expect(rebaseStamp({ key: 'x', field: 2 }, 'a', 'b', 2)).toEqual({ key: 'x', field: 2 });
    expect(rebaseStamp(null, 'a', 'b', 0)).toBeNull();
  });
});

describe('editor persons UI helpers (S §1.1 item 8, §2.6)', () => {
  const base = assignPersons(editFromLegacy(applyPreset('natural', 1)), ['f0', 'f1', 'b1'], 'f0');
  const bump = (e: EditState, id: string) => withPersons(e, [id], (p) => ({ ...p, values: { ...p.values, 'shape.eyeEnlarge': 0.9 } }));
  it('changedPersons compares each person by key', () => {
    expect(changedPersons(base, bump(base, 'f1'))).toEqual(['f1']);
    expect(changedPersons(base, bump(bump(base, 'f1'), 'f0')).sort()).toEqual(['f0', 'f1']);
    expect(changedPersons(base, base)).toEqual([]);
  });
  it('undo / redo toast only when the step touched persons other than the selected one', () => {
    const n = (id: string) => ({ f0: 1, f1: 2, b1: 3 })[id] ?? 0;
    expect(undoToast('undo', ['f1'], { kind: 'person', id: 'f0' }, n)).toBe('已復原人物 2 的變更');
    expect(undoToast('redo', ['f1', 'b1'], { kind: 'person', id: 'f0' }, n)).toBe('已重做人物 2、3 的變更');
    expect(undoToast('undo', ['f0', 'f1'], { kind: 'person', id: 'f0' }, n)).toBeNull();
    expect(undoToast('undo', ['f1'], { kind: 'all' }, n)).toBeNull();
    expect(undoToast('undo', [], { kind: 'person', id: 'f0' }, n)).toBeNull();
  });
  it('answer notices: over cap wins over too small, both only with the strip; the first group photo ever adds the hint', () => {
    const c = makeCache({ dropped: { tooSmall: 1, overCap: 2 } });
    expect(answerNotices(c, 3, true)).toEqual(['偵測到超過 6 張臉，只會美化最大的 6 張', '點選臉部或下方人物，可個別調整']);
    expect(answerNotices({ ...c, dropped: { tooSmall: 1, overCap: 0 } }, 3, false)).toEqual(['有些臉太小，不會套用臉部效果']);
    expect(answerNotices(c, 1, true)).toEqual([]);
  });
  it('thumbRect: the face box padded 30 %, square in pixels; a body-only person uses its head points', () => {
    const c = makeCache({ bodies: [cacheBody('b0', 0.8)], persons: [{ id: 'f0', face: 'f0', body: null }, { id: 'f1', face: 'f1', body: null }, { id: 'b0', face: null, body: 'b0' }] });
    const r = thumbRect(c, c.persons[0]);
    expect(r.w * c.width).toBeCloseTo(r.h * c.height, 6);
    expect(r.x + r.w / 2).toBeCloseTo(0.3, 6);
    const b = thumbRect(c, c.persons[2]);
    expect(b.x + b.w / 2).toBeCloseTo(0.8, 1);
    expect(b.y).toBeLessThan(0.4);
  });
  it('hitCtxOf: faces with their persons; bodies only on 美體; 44 pt in UV of the layer', () => {
    const c = makeCache();
    const ctx = hitCtxOf(c, false, null, { width: 440, height: 330 });
    expect(ctx.faces.map((f) => f.person)).toEqual(['f0', 'f1']);
    expect(ctx.bodies).toBeUndefined();
    expect([ctx.minW, ctx.minH]).toEqual([0.1, 44 / 330]);
    const withBody = makeCache({ bodies: [cacheBody('b0', 0.8)], persons: [{ id: 'f0', face: 'f0', body: null }, { id: 'f1', face: 'f1', body: null }, { id: 'b0', face: null, body: 'b0' }] });
    expect(hitCtxOf(withBody, true, null, { width: 440, height: 330 }).bodies?.map((b) => b.person)).toEqual(['b0']);
  });
});
