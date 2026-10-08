// editorModel.ts: when the editor trusts a "no face", how often it re-detects, and 儲存 surviving a session swap.
import { describe, expect, it, vi } from 'vitest';
import type { BodyMeasure } from '../body/measure';
import { fakeBodyTracker, makeBodyDetection, makeBodyField } from '../app/testFakes';
import { applyPreset, setBodyProtect, setFilter, setHeightBand, setParam } from '../engine/params';
import type { BeautyParams, BodyField, Face, ParamId, RegionStatus, TrackerState } from '../types';
import {
  ANY_FIELD,
  BODY_DRAFT_LONG_EDGE,
  BODY_NONE_REASON,
  BODY_UNMEASURED_REASON,
  BodyFieldMemo,
  bodyPanelContext,
  bodyParamsKey,
  bodyToPersist,
  cachedBodyFits,
  detectBody,
  detectSession,
  exportOnLatest,
  FieldDraftGate,
  MAX_REDETECTS,
  measureSafe,
  needsBodyMeasure,
  RedetectBudget,
  shouldDetectBody,
  stampIs,
  suggestedBand,
  type BodyDet,
} from './editorModel';
import { BODY_ERROR_NOTE, bodyNote, INITIAL_SELECTION, itemsFor } from './panelModel';

const FACE = {} as Face;
const session = (face: Face | null, faceKnown = true) => ({ face, faceKnown });

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

  it('bodyParamsKey follows sliders, band and 背景保護, not skin / filter / presets', () => {
    const k = bodyParamsKey(base);
    expect(bodyParamsKey(setParam(base, 'skin.smooth', 0.9))).toBe(k);
    expect(bodyParamsKey(setFilter(base, 'mono'))).toBe(k);
    expect(bodyParamsKey(applyPreset('glow', 0.3, base))).toBe(k);
    expect(bodyParamsKey(setParam(base, 'body.waist', 0.4))).not.toBe(k);
    expect(bodyParamsKey(setBodyProtect(base, false))).not.toBe(k);
    expect(bodyParamsKey(setHeightBand(base, { top: 0.5, bottom: 0.8, amount: 0.5 }))).not.toBe(k);
  });

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
    expect(shouldDetectBody({ phase: 'cache' }, { tabOpen: true, entered: true, params: edited })).toBe(false);
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
    const t = fakeBodyTracker(det);
    const img = {} as ImageBitmap;
    const order: string[] = [];
    const pause = async () => {
      order.push('pause');
      expect(t.detect).not.toHaveBeenCalled();
    };
    expect(await detectBody(async () => t, img, { pause })).toBe(det);
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
    const t = fakeBodyTracker(det);
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
    expect(await detectBody(async () => t, {} as ImageBitmap, { recoverWait })).toBe(det);
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
    const t = fakeBodyTracker(det);
    expect(await detectBody(async () => t, {} as ImageBitmap, { cancelled: () => true })).toBeUndefined();
    expect(t.detect).not.toHaveBeenCalled();
  });

  it('cachedBodyFits: same aspect only ("no person" always fits)', () => {
    expect(cachedBodyFits(makeBodyDetection(1, 1536, 2048), 768, 1024)).toBe(true);
    expect(cachedBodyFits(makeBodyDetection(1, 1536, 2048), 1024, 768)).toBe(false);
    expect(cachedBodyFits(makeBodyDetection(1, 1536, 2048), 0, 0)).toBe(false);
    expect(cachedBodyFits(null, 1024, 768)).toBe(true);
  });

  it('measureSafe: only a person gets a measure; a throwing measure is reported, not fatal', () => {
    const m = measure();
    const fn = vi.fn(() => m);
    const onError = vi.fn();
    expect(measureSafe({ phase: 'done', det }, null, fn, onError)).toBe(m);
    expect(fn).toHaveBeenCalledWith(det, null);
    expect(measureSafe({ phase: 'done', det: null }, null, fn, onError)).toBeNull();
    expect(measureSafe({ phase: 'working' }, null, fn, onError)).toBeNull();
    const boom = () => {
      throw new Error('bad mask');
    };
    expect(measureSafe({ phase: 'done', det }, null, boom, onError)).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
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
    expect(bodyPanelContext({ phase: 'cache' }, { state: 'idle' }, null, avail).status).toBe('loading');
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
    const slim = itemsFor(setParam(applyPreset('natural', 1), 'body.slim', 0), { ...INITIAL_SELECTION, tab: 'body' }, c).find(
      (i) => i.key === 'body.slim',
    )!;
    expect(slim).toMatchObject({ disabled: true, reason: BODY_ERROR_NOTE });
    // without a cause the note is the generic one
    expect(bodyNote({ ...c, message: undefined })?.text).toBe(BODY_ERROR_NOTE);
  });

  it('bodyPanelContext → panel: 背景保護 is off when the measure has no person mask (CPU fallback)', () => {
    const p = applyPreset('natural', 1);
    const s = { ...INITIAL_SELECTION, tab: 'body' as const };
    const protect = (c: ReturnType<typeof bodyPanelContext>) => itemsFor(p, s, c).find((i) => i.key === 'protect')!;
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

  it('BodyFieldMemo rebuilds only for body params / measure changes, passing the previous field', () => {
    let v = 0;
    const build = vi.fn((_m: BodyMeasure | null, p: BeautyParams, _a: number, prev?: BodyField | null) => {
      if (!needsBodyMeasure(p) && !p.heightBand) return null;
      const f = prev ?? makeBodyField(0, 0);
      f.version = ++v; // refills the same buffer
      return f;
    });
    const memo = new BodyFieldMemo(build);
    const m = measure();
    expect(memo.update(m, base, 0.75)).toEqual({ field: null, changed: false });
    expect(build).toHaveBeenCalledTimes(1);
    expect(memo.update(m, setParam(base, 'skin.whiten', 0.9), 0.75).changed).toBe(false);
    expect(build).toHaveBeenCalledTimes(1);

    const slim = setParam(base, 'body.slim', 0.6);
    const a = memo.update(m, slim, 0.75);
    expect(a.changed).toBe(true);
    expect(a.field?.version).toBe(1);
    const b = memo.update(m, setParam(slim, 'body.slim', 0.7), 0.75);
    expect(b.changed).toBe(true); // same object, new version
    expect(b.field).toBe(a.field);
    expect(build.mock.calls[2][3]).toBe(a.field);
    expect(memo.update(m, setFilter(setParam(slim, 'body.slim', 0.7), 'warm'), 0.75).changed).toBe(false);

    // a new measure (e.g. the face was found on a re-detect: head anchors) rebuilds
    expect(memo.update(measure(), setParam(slim, 'body.slim', 0.7), 0.75).changed).toBe(true);
    // back to neutral → no field
    expect(memo.update(m, base, 0.75)).toEqual({ field: null, changed: true });
  });

  it('BodyFieldMemo: a drag step builds a draft; the commit with the same params rebuilds it at full resolution', () => {
    const build = vi.fn((_m: BodyMeasure | null, _p: BeautyParams, _a: number, _prev?: BodyField | null, edge?: number) => {
      const f = makeBodyField(0.01);
      f.width = edge ?? 256;
      return f;
    });
    const memo = new BodyFieldMemo(build);
    const m = measure();
    const slim = setParam(base, 'body.slim', 0.6);
    const draft = memo.update(m, slim, 0.75, true);
    expect(draft.changed).toBe(true);
    expect(build.mock.calls[0][4]).toBe(BODY_DRAFT_LONG_EDGE);
    // the next drag step at the same value: nothing to do
    expect(memo.update(m, slim, 0.75, true).changed).toBe(false);
    // the commit (or an export) at the same value: full resolution
    const full = memo.update(m, slim, 0.75);
    expect(full.changed).toBe(true);
    expect(build).toHaveBeenCalledTimes(2);
    expect(build.mock.calls[1][4]).toBeUndefined();
    expect(full.field?.width).toBe(256);
    // a full field answers a later draft request (a pending drag frame after the commit) and a repeated commit
    expect(memo.update(m, slim, 0.75, true).changed).toBe(false);
    expect(memo.update(m, slim, 0.75).changed).toBe(false);
    expect(build).toHaveBeenCalledTimes(2);
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

  it('bodyToPersist: a fresh detection (person or nobody) once; nothing while unknown or already stored', () => {
    expect(bodyToPersist({ phase: 'done', det }, false)).toBe(det);
    expect(bodyToPersist({ phase: 'done', det: null }, false)).toBeNull();
    expect(bodyToPersist({ phase: 'done', det }, true)).toBeUndefined();
    expect(bodyToPersist({ phase: 'working' }, false)).toBeUndefined();
    expect(bodyToPersist({ phase: 'error', message: 'x' }, false)).toBeUndefined();
  });
});
