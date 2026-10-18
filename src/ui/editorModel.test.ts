// editorModel.ts: when the editor trusts a "no face", how often it re-detects, and 儲存 surviving a session swap.
import { describe, expect, it, vi } from 'vitest';
import type { BodyFieldInput } from '../body/field';
import type { BodyMeasure } from '../body/measure';
import { fakeBodyTracker, makeBodyDetection, makeBodyDetections, makeBodyField, makeFace } from '../app/testFakes';
import { personInfos } from '../detect/cache';
import { prepareFaces } from '../detect/faces';
import { cacheBody, makeCache } from '../detect/testCaches';
import { sampleFaceAt } from '../detect/testMeshes';
import { applyPreset, setHeightBand, setParam } from '../engine/params';
import type { BeautyParams, BodyField, DetectionCache, EditState, Face, ParamId, PersonId, RegionStatus, Selection, TrackerState } from '../types';
import { lensFor, P0_INFO } from '../edit/lens';
import { flipView, IDENTITY_GEOMETRY, rotateLeft, upQuarter, vToO } from '../geometry/view';
import { editFromLegacy } from '../edit/legacy';
import { bodyAnswer, completeAnswer, firstAnswer, preAnswerCache } from '../edit/migrate';
import { assignPersons, withPersons } from '../edit/state';
import {
  addBodyScan,
  bodyScansAfter,
  addFaceScan,
  answerNotices,
  ANY_FIELD,
  BODY_DRAFT_LONG_EDGE,
  BODY_NONE_REASON,
  BODY_UNMEASURED_REASON,
  BodyFieldMemo,
  bodyInputKey,
  bodyPanelContext,
  changedPersons,
  completionDue,
  completionHeld,
  completionOf,
  completionShows,
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
  needsBodyScan,
  needsFaceScan,
  outputImage,
  outputSettled,
  outputWaits,
  personBodyGate,
  protectRequests,
  rebaseStamp,
  RedetectBudget,
  rescanOf,
  RESTORE_POLL_MS,
  sessionPlan,
  settleBodyAnswer,
  shouldDetectBody,
  stampIs,
  suggestedBand,
  thumbRect,
  undoToast,
  whenRestored,
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

  it('a short-range cache is drawn as it is, faceless or not: a definite answer whatever the tracker health (§6.5)', () => {
    const faces = makeCache({ photoDetector: 'short-range' });
    const none = makeCache({ faces: [], persons: [{ id: 'p0', face: null, body: null }], primary: 'p0', photoDetector: 'short-range' });
    for (const c of [faces, none]) {
      const plan = sessionPlan(c, true);
      expect(plan).toEqual({ useCache: true, asks: false });
      // reopened while the tracker is lost or failed (iOS back from the background): still a definite answer, so
      // faceAnswer is not 'recovering' / 'paused' and no 膚質 tool (祛痘 included) is gated
      expect(detectSession(plan.asks, () => false, () => session(null)).unsure).toBe(false);
    }
  });
});

describe('the completion of a short-range answer (§6.5)', () => {
  const at = (...qs: (0 | 1 | 2 | 3)[]) => qs.map((quarter) => ({ quarter, flipH: false }));
  /** a record the short-range detector answered (FaceScanRecord.detector) */
  const owe = (quarter: 0 | 1 | 2 | 3) => ({ quarter, flipH: false, detector: 'short-range' as const });
  const none = (faceScans: DetectionCache['faceScans'] = at(0)) => makeCache({ faces: [], persons: [{ id: 'p0', face: null, body: null }], primary: 'p0', faceScans, photoDetector: 'short-range' });

  it('runs where the answer it completes was found: a cache with faces in its last face scan, a faceless one upright', () => {
    // faces found by a sideways scan after a faceless upright answer: the completion runs on that up-frame
    expect(completionOf(makeCache({ faceScans: at(0, 1), photoDetector: 'short-range' }))).toEqual({ quarter: 1 });
    expect(completionOf(makeCache({ faceScans: at(0, 3), photoDetector: 'short-range' }))).toEqual({ quarter: 3 });
    expect(completionOf(makeCache({ photoDetector: 'short-range' }))).toEqual({ quarter: 0 });
    // faceless: upright, whatever other up-frames the cache was scanned in, while the upright record is owed (or no record
    // says which is); else the last owed one (round 4)
    expect(completionOf(none(at(0, 1)))).toEqual({ quarter: 0 });
    expect(completionOf(none([owe(0), owe(1)]))).toEqual({ quarter: 0 });
    expect(completionOf(none([...at(0), owe(3)]))).toEqual({ quarter: 3 });
    expect(completionOf(none([...at(0), owe(1), owe(3)]))).toEqual({ quarter: 3 });
    // nothing to complete: no mark (0.4's caches, full-range answers), or no upright answer yet
    expect(completionOf(makeCache())).toBeNull();
    expect(completionOf({ ...none(), photoDetector: undefined })).toBeNull();
    expect(completionOf(none(at(1)))).toBeNull();
    expect(completionOf(null)).toBeNull();
  });

  it('is due once per open, with a tracker and the detector in', () => {
    const c = makeCache({ photoDetector: 'short-range' });
    expect(completionDue({ cache: c, tried: false, hasTracker: true, detectorIn: true })).toEqual({ quarter: 0 });
    // tried in this open (whatever it found): a later open tries again while the mark stays
    expect(completionDue({ cache: c, tried: true, hasTracker: true, detectorIn: true })).toBeNull();
    expect(completionDue({ cache: c, tried: false, hasTracker: false, detectorIn: true })).toBeNull();
    expect(completionDue({ cache: c, tried: false, hasTracker: true, detectorIn: false })).toBeNull();
    expect(completionDue({ cache: makeCache(), tried: false, hasTracker: true, detectorIn: true })).toBeNull();
  });

  it('waits for a bound definite session, a healthy tracker, no pending scan and nothing it would freeze', () => {
    const free = { bound: true, unsure: false, health: 'ok' as TrackerState, scanPending: false, busy: false };
    expect(completionHeld(free)).toBe(false);
    expect(completionHeld({ ...free, bound: false })).toBe(true);
    expect(completionHeld({ ...free, unsure: true })).toBe(true);
    // a recovering or paused tracker could not answer: the cached answer stands meanwhile, and the try is kept
    expect(completionHeld({ ...free, health: 'lost' })).toBe(true);
    expect(completionHeld({ ...free, health: 'failed' })).toBe(true);
    expect(completionHeld({ ...free, scanPending: true })).toBe(true);
    expect(completionHeld({ ...free, busy: true })).toBe(true);
  });

  it('a sideways faceless cache scanned short-range in two up-frames: the completion asks upright, and the scan asks the turned one again once full-range is in', () => {
    // nobody upright, nobody turned (q1), both short-range; the photo is shown turned
    const c = none([owe(0), owe(1)]);
    const turned = rotateLeft(rotateLeft(rotateLeft(IDENTITY_GEOMETRY)));
    expect(upQuarter(turned)).toBe(1);
    expect(needsFaceScan({ cache: c, geometry: turned, mode: 'normal', hasTracker: true })).toBe(false);
    const nobody = { faces: [], obstacles: [], dropped: { tooSmall: 0, overCap: 0 } };
    // the completion (upright, full-range) finds nobody either: the turned up-frame's record is still owed its look
    const done = completeAnswer(c, nobody, { width: 1000, height: 1000 }, completionOf(c)!.quarter).detect;
    expect(done.faceScans).toEqual([owe(1), ...at(0)]);
    expect(done.photoDetector).toBe('short-range');
    // the scan asks it, but only with full-range in (short-range would answer what it answered)
    expect(needsFaceScan({ cache: done, geometry: turned, mode: 'normal', hasTracker: true, fullRange: true })).toBe(true);
    expect(needsFaceScan({ cache: done, geometry: turned, mode: 'normal', hasTracker: true, fullRange: false })).toBe(false);
    expect(needsFaceScan({ cache: done, geometry: IDENTITY_GEOMETRY, mode: 'normal', hasTracker: true, fullRange: true })).toBe(false);
    // it is no fresh answer: its "nobody" says nothing (the short-range one said so when it was fresh)
    expect(rescanOf(done, 1)).toBe(true);
    expect(rescanOf(none(at(0)), 1)).toBe(false);
    // nobody there either, full-range: nothing is owed now, and no up-frame is scanned again
    const after = firstAnswer({ detect: done, prepared: nobody, size: { width: 1000, height: 1000 }, v1Body: null, rematch: null, faceSeed: null, quarter: 1, detector: 'full-range' }).detect;
    expect(after).not.toHaveProperty('photoDetector');
    expect(needsFaceScan({ cache: after, geometry: turned, mode: 'normal', hasTracker: true, fullRange: true })).toBe(false);
    expect(completionDue({ cache: after, tried: false, hasTracker: true, detectorIn: true })).toBeNull();
  });
  it('an up-frame scanned full-range before the completion is not scanned again after it (round 4 F4)', () => {
    // nobody upright short-range; turned while the detector landed: q1 answered full-range, nobody
    const c = none([owe(0), ...at(1)]);
    const turned = rotateLeft(rotateLeft(rotateLeft(IDENTITY_GEOMETRY)));
    const done = completeAnswer(c, { faces: [], obstacles: [], dropped: { tooSmall: 0, overCap: 0 } }, { width: 1000, height: 1000 }, 0).detect;
    expect(done).not.toHaveProperty('photoDetector');
    // round 3 dropped q1's record here: the scan asked it once more, full-range again, and said 「未偵測到臉部」 again
    expect(needsFaceScan({ cache: done, geometry: turned, mode: 'normal', hasTracker: true, fullRange: true })).toBe(false);
  });

  describe('what a completion into a cache with faces shows (completionShows, round 5 G3)', () => {
    const size = { width: 1000, height: 1000 };
    const short = (lms: ReturnType<typeof sampleFaceAt>[]) =>
      firstAnswer({ detect: null, prepared: prepareFaces(lms, 1000, 1000), size, v1Body: null, rematch: null, faceSeed: null, quarter: 0, detector: 'short-range' }).detect;
    const OVER = '偵測到超過 10 張臉，只會美化最大的 10 張';
    /** ten faces 0.08 wide in two rows of five, a group short-range found whole */
    const ten = Array.from({ length: 10 }, (_, i) => sampleFaceAt(0.1 + 0.2 * (i % 5), 0.25 + 0.3 * Math.floor(i / 5), 0.08));

    it('a tiny face full-range finds beside a cached one adds nobody but an obstacle: the render changed, the thumbnail is owed', () => {
      const a = sampleFaceAt(0.5, 0.5, 0.4);
      const cache = short([a]);
      expect(cache.obstacles).toEqual([]);
      // full-range finds A again and a background face under MIN_FACE_FRAC beside A's jaw (short-range missed it)
      const c = completeAnswer(cache, prepareFaces([a, sampleFaceAt(0.344, 0.604, 0.025)], 1000, 1000), size);
      expect(c.added).toEqual([]);
      expect(c.detect.obstacles).toHaveLength(1);
      const hint = vi.fn(() => true);
      // one person: no group notice, and the hint is not taken (round 4 owed nothing: the thumbnail kept the old render)
      expect(completionShows(cache, c.detect, c.added, hint)).toEqual({ redraws: true, notices: [] });
      expect(hint).not.toHaveBeenCalled();
    });

    it('an eleventh face found past the cap adds nobody, joins as an obstacle and says so; a cache over the cap already says nothing again', () => {
      const cache = short(ten);
      expect([cache.faces.length, cache.dropped.overCap]).toEqual([10, 0]);
      // full-range finds the ten and a larger eleventh below them: no free place, so it is an obstacle, over the cap
      const c = completeAnswer(cache, prepareFaces([...ten, sampleFaceAt(0.5, 0.85, 0.09)], 1000, 1000), size);
      expect(c.added).toEqual([]);
      expect(c.detect.faces.map((f) => f.id)).toEqual(cache.faces.map((f) => f.id));
      expect(c.detect.obstacles).toHaveLength(1);
      expect(c.detect.dropped.overCap).toBeGreaterThan(0);
      const hint = vi.fn(() => true);
      // round 4 showed the notice only when a face was added, so 「偵測到超過 10 張臉」 never showed here
      expect(completionShows(cache, c.detect, c.added, hint)).toEqual({ redraws: true, notices: [OVER] });
      expect(hint).not.toHaveBeenCalled();
      // the short-range answer was over the cap already (and said so then): nothing is said again
      const eleven = short([...ten, sampleFaceAt(0.5, 0.85, 0.07)]);
      expect(eleven.dropped.overCap).toBe(1);
      const again = completeAnswer(eleven, prepareFaces([...ten, sampleFaceAt(0.5, 0.85, 0.07)], 1000, 1000), size);
      expect(completionShows(eleven, again.detect, again.added, hint).notices).toEqual([]);
    });

    it('nothing new: no redraw, no notice; new faces: what an answer says, the hint taken from two persons on', () => {
      const cache = short(ten.slice(0, 2));
      const same = completeAnswer(cache, prepareFaces(ten.slice(0, 2), 1000, 1000), size);
      const hint = vi.fn(() => true);
      expect(completionShows(cache, same.detect, same.added, hint)).toEqual({ redraws: false, notices: [] });
      const more = completeAnswer(cache, prepareFaces(ten.slice(0, 3), 1000, 1000), size);
      expect(more.added).toHaveLength(1);
      expect(completionShows(cache, more.detect, more.added, hint)).toEqual({ redraws: true, notices: ['點選臉部或下方人物，可個別調整'] });
      expect(hint).toHaveBeenCalledTimes(1);
      // the first group photo's hint was taken before: nothing to say
      expect(completionShows(cache, more.detect, more.added, () => false)).toEqual({ redraws: true, notices: [] });
    });
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

describe('whenRestored (C §7: the 標準 fallback after a loss during the tiles waits for the restore)', () => {
  const fakeEngine = (lost: boolean) => {
    const canvas = new EventTarget();
    const engine = { lost, canvas };
    // the engine's own listener, registered first (createEngine): it rebuilds, then clears `lost`
    canvas.addEventListener('webglcontextrestored', () => (engine.lost = false));
    return engine;
  };

  it('a live engine resolves true at once', async () => {
    await expect(whenRestored(fakeEngine(false), 1000)).resolves.toBe(true);
  });

  it('resolves true on the restore, after the engine’s own listener rebuilt it', async () => {
    const e = fakeEngine(true);
    const p = whenRestored(e, 60_000);
    e.canvas.dispatchEvent(new Event('webglcontextrestored'));
    await expect(p).resolves.toBe(true);
  });

  it('resolves false when no restore comes in time, or the rebuild failed (still lost)', async () => {
    vi.useFakeTimers();
    try {
      const p = whenRestored(fakeEngine(true), 5000);
      vi.advanceTimersByTime(5000);
      await expect(p).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
    const broken = { lost: true, canvas: new EventTarget() };
    const q = whenRestored(broken, 60_000);
    broken.canvas.dispatchEvent(new Event('webglcontextrestored'));
    await expect(q).resolves.toBe(false);
  });

  it('ends as soon as the wait is superseded (重新載入引擎: a session on a new engine took over), not at the timeout', async () => {
    vi.useFakeTimers();
    try {
      let replaced = false;
      const settled: boolean[] = [];
      // the old engine is disposed by recoverEngine: its canvas never fires webglcontextrestored again
      void whenRestored(fakeEngine(true), 60_000, () => replaced).then((v) => settled.push(v));
      await vi.advanceTimersByTimeAsync(2000);
      expect(settled).toEqual([]);
      replaced = true;
      await vi.advanceTimersByTimeAsync(RESTORE_POLL_MS);
      // false (the old context is not back): encode throws ExportError('lost'), and exportOnLatest runs on the replacement
      expect(settled).toEqual([false]);
      expect(vi.getTimerCount()).toBe(0); // the timeout and the poll are gone
    } finally {
      vi.useRealTimers();
    }
  });

  it('a superseded check that is already true ends the wait at the first poll; a restore or the timeout clears the poll', async () => {
    vi.useFakeTimers();
    try {
      const at: number[] = [];
      const t0 = Date.now();
      void whenRestored(fakeEngine(true), 60_000, () => true).then(() => at.push(Date.now() - t0));
      await vi.advanceTimersByTimeAsync(RESTORE_POLL_MS);
      expect(at).toEqual([RESTORE_POLL_MS]);
      const e = fakeEngine(true);
      const p = whenRestored(e, 60_000, () => false);
      e.canvas.dispatchEvent(new Event('webglcontextrestored'));
      await expect(p).resolves.toBe(true);
      const q = whenRestored(fakeEngine(true), 5000, () => false);
      await vi.advanceTimersByTimeAsync(5000);
      await expect(q).resolves.toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
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
  it('BodyFieldMemo rebuilds on a 旋轉 (new up-frame) and not on a 翻轉', () => {
    const build = vi.fn((_i: BodyFieldInput, _p?: BodyField | null, _e?: number) => makeBodyField());
    const memo = new BodyFieldMemo(build);
    // the input shape of this file's existing BodyFieldMemo tests; draft = false, then `up`
    const input: BodyFieldInput = { edited: [{ id: 'f0', measure: {} as BodyMeasure, values: { 'body.slim': 0.6 } as never }], masks: [], heightBand: null, legs: { value: 0, measure: null }, bodyProtect: true, aspect: 0.75 };
    memo.update(input, false, 0);
    memo.update(input, false, upQuarter(flipView(IDENTITY_GEOMETRY)));
    expect(build).toHaveBeenCalledTimes(1);
    memo.update(input, false, upQuarter(rotateLeft(IDENTITY_GEOMETRY)));
    expect(build).toHaveBeenCalledTimes(2);
  });
  it('BodyFieldMemo hands the previous field to the build only in the upright frame (an odd U grid has swapped sides)', () => {
    const build = vi.fn((_i: BodyFieldInput, _p?: BodyField | null, _e?: number) => makeBodyField());
    const memo = new BodyFieldMemo(build);
    const slim = (x: number): BodyFieldInput => ({ edited: [{ id: 'f0', measure: {} as BodyMeasure, values: { 'body.slim': x } as never }], masks: [], heightBand: null, legs: { value: 0, measure: null }, bodyProtect: true, aspect: 0.75 });
    const a = memo.update(slim(0.6), false, 1);
    memo.update(slim(0.7), false, 1);
    expect(build.mock.calls[1][1]).toBeNull();
    memo.update(slim(0.7), false, 0);
    memo.update(slim(0.8), false, 0);
    expect(build.mock.calls[3][1]).toBe(build.mock.results[2].value);
    expect(a.field).not.toBeNull();
  });
});

describe('scans in the up frame (S §3.6, D5, D12)', () => {
  const turned = rotateLeft(IDENTITY_GEOMETRY); // upQuarter 3
  const empty = { faces: [], faceScans: [{ quarter: 0 as const, flipH: false }] }; // DetectionCache['faceScans'] quarters
  it('a face scan only in normal mode, with a tracker, an empty face cache and an unscanned up-frame', () => {
    expect(needsFaceScan({ cache: empty, geometry: turned, mode: 'normal', hasTracker: true })).toBe(true);
    expect(needsFaceScan({ cache: empty, geometry: turned, mode: 'crop', hasTracker: true })).toBe(false);
    expect(needsFaceScan({ cache: empty, geometry: turned, mode: 'normal', hasTracker: false })).toBe(false);
    expect(needsFaceScan({ cache: empty, geometry: IDENTITY_GEOMETRY, mode: 'normal', hasTracker: true })).toBe(false);
    expect(needsFaceScan({ cache: { ...empty, faces: [{}] }, geometry: turned, mode: 'normal', hasTracker: true })).toBe(false);
    expect(needsFaceScan({ cache: null, geometry: turned, mode: 'normal', hasTracker: true })).toBe(false);
    // no upright answer yet (a 基本模式 cache, or one 美體 wrote while the tracker could not answer): the session asks
    // upright first, so no up-frame is forced, upright or turned
    const unscanned = { faces: [], faceScans: [] };
    expect(needsFaceScan({ cache: unscanned, geometry: turned, mode: 'normal', hasTracker: true })).toBe(false);
    expect(needsFaceScan({ cache: unscanned, geometry: IDENTITY_GEOMETRY, mode: 'normal', hasTracker: true })).toBe(false);
  });

  it('a scan counts for both flip states', () => {
    const scanned = { faces: [], faceScans: addFaceScan(empty.faceScans, 3) };
    expect(needsFaceScan({ cache: scanned, geometry: turned, mode: 'normal', hasTracker: true })).toBe(false);
    expect(needsFaceScan({ cache: scanned, geometry: flipView(turned), mode: 'normal', hasTracker: true })).toBe(false);
    expect(addFaceScan(scanned.faceScans, 3)).toEqual(scanned.faceScans);
  });

  it('a body re-scan only when nobody was found and the up-frame is new; absent bodyScans = [0]', () => {
    expect(needsBodyScan({ bodies: [] }, turned)).toBe(true);
    expect(needsBodyScan({ bodies: [] }, IDENTITY_GEOMETRY)).toBe(false);
    expect(needsBodyScan({ bodies: [{}] }, turned)).toBe(false);
    expect(needsBodyScan({ bodies: null }, turned)).toBe(false);
    expect(needsBodyScan({ bodies: [], bodyScans: addBodyScan(undefined, 3) }, turned)).toBe(false);
    expect(addBodyScan(undefined, 3)).toEqual([0, 3]);
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
  it('bodies found before the first face answer (S §7) are the cache: every body person measured, p0’s 美體 values on the primary body drive the field', () => {
    const size = { width: 1600, height: 1200 };
    const found = [cacheBody('x', 0.6), cacheBody('x', 0.2)].map((b) => ({ pose: b.pose, mask: b.mask, score: b.score }));
    const a = bodyAnswer(preAnswerCache(size, null), found, size);
    expect(a.detect.faces).toEqual([]);
    expect(a.detect.persons.map((p) => p.id)).toEqual(['b0', 'b1']);
    const seen: number[] = [];
    const ms = measurePersons(a.detect, () => FACE, (d) => (seen.push(d.pose.points[0]), {} as BodyMeasure), () => undefined);
    expect([...ms.keys()]).toEqual(['b0', 'b1']);
    const edit = a.rebase(withPersons(editFromLegacy(applyPreset('natural', 1)), ['p0'], (p) => ({ ...p, values: { ...p.values, 'body.waist': 0.7 } })));
    const input = fieldInputOf(edit, a.detect, ms, 4 / 3);
    const primary = a.detect.primary;
    expect(input.edited.map((p) => [p.id, p.values['body.waist']])).toEqual([[primary, 0.7]]);
    expect(input.legs.measure).toBe(ms.get(primary));
  });
  it('nobody found before the first face answer: the cache says so in its up-frame, and a turned photo asks again (S §3.6, D5)', () => {
    const size = { width: 1600, height: 1200 };
    const empty = preAnswerCache(size, null);
    // what the editor writes: the up-frames tried start empty (no detection ran on this cache before)
    const a = bodyAnswer(empty, [], size);
    const cache = { ...a.detect, bodyScans: bodyScansAfter(empty, 0) };
    expect(cache).toMatchObject({ bodies: [], persons: [{ id: 'p0', face: null, body: null }], bodyScans: [0] });
    expect(needsBodyScan(cache, IDENTITY_GEOMETRY)).toBe(false);
    expect(needsBodyScan(cache, rotateLeft(IDENTITY_GEOMETRY))).toBe(true);
    expect(bodyScansAfter(cache, 3)).toEqual([0, 3]);
    // first tried turned: upright was not tried yet (a cache written before 美體 ran, faces or not, alike)
    const turned = { ...a.detect, bodyScans: bodyScansAfter(empty, 3) };
    expect(turned.bodyScans).toEqual([3]);
    expect(needsBodyScan(turned, IDENTITY_GEOMETRY)).toBe(true);
    expect(bodyScansAfter(makeCache(), 3)).toEqual([3]);
    // no face scan in a new up-frame before the upright face answer: the session asks upright first
    expect(needsFaceScan({ cache, geometry: rotateLeft(IDENTITY_GEOMETRY), mode: 'normal', hasTracker: true })).toBe(false);
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
    // … and says why: f0 itself has no measure (v0.3's BODY_UNMEASURED_REASON), not the generic 此照片無法使用這個效果
    const gated = { ...measured, personGate: personBodyGate(some, torso) };
    expect(waist(lens({ kind: 'person', id: 'f0' }, some), gated)).toMatchObject({ disabled: true, reason: BODY_UNMEASURED_REASON });
    expect(waist(lens({ kind: 'person', id: 'b1' }, some), gated).disabled).toBe(false);
    expect(waist(lens({ kind: 'all' }, some), gated).disabled).toBe(false);
    // a measured person its own measure refuses reads that measure's reason
    const legsOff = (m: BodyMeasure | null, id: ParamId): RegionStatus => (m ? (id === 'body.legSlim' ? { ok: false, reason: 'legs' } : { ok: true, reason: null }) : { ok: false, reason: 'x' });
    const legsLens = lensFor(assignPersons(editFromLegacy(applyPreset('natural', 1)), ['f0', 'f1', 'b1'], 'f0'), { kind: 'person', id: 'b1' }, personInfos(cache), 'f0', {
      available: (p, id) => measuredAvailable(some, p, id, legsOff),
    });
    const legsCtx = { ...bodyPanelContext({ phase: 'done', det: makeBodyDetection(2) }, { state: 'ready' }, m, torso), personGate: personBodyGate(some, legsOff) };
    expect(itemsFor(legsLens, s, legsCtx).find((i) => i.key === 'body.legSlim')).toMatchObject({ disabled: true, reason: 'legs' });
  });
  it('personBodyGate: that person’s own measure decides; none → BODY_UNMEASURED_REASON', () => {
    const m = {} as BodyMeasure;
    const avail = (x: BodyMeasure | null, id: ParamId): RegionStatus => (x === m && id === 'body.waist' ? { ok: true, reason: null } : { ok: false, reason: 'no' });
    const gate = personBodyGate(new Map([['b1', m]]), avail);
    expect(gate('b1', 'body.waist')).toEqual({ ok: true, reason: null });
    expect(gate('b1', 'body.hip')).toEqual({ ok: false, reason: 'no' });
    expect(gate('f0', 'body.waist')).toEqual({ ok: false, reason: BODY_UNMEASURED_REASON });
  });
  it('outputWaits: the encode / autosave waits for each hold on its own; the timer reads the live stroke (step-6 review)', () => {
    const clear = { noSession: false, lost: false, exportBusy: false, stroke: false, rebuild: false, geoDrag: false };
    expect(outputWaits(clear)).toBe(false);
    for (const k of Object.keys(clear) as (keyof typeof clear)[]) expect(outputWaits({ ...clear, [k]: true }), k).toBe(true);
    // the ~1 ms window: the timer fires after a finger went down (live stroke set, stamps applied in that frame) but
    // before the `drawing` flip's cleanup cancelled it; the effect saw drawing = false when it armed the timer
    const armedWith = { ...clear, stroke: false };
    const firesWith = { ...clear, stroke: true };
    expect(outputWaits(armedWith)).toBe(false);
    expect(outputWaits(firesWith)).toBe(true);
  });
  it('outputSettled / outputImage: an owed thumbnail is drawn whatever the plan, also when the share file is made already (crop spec §7)', () => {
    // a working-size JPEG: 儲存 inside the debounce made the share file, then a flush with the context lost kept the
    // params without a thumbnail (saved, thumbOwed): the restore's re-run must still draw it, as a render of its own
    const fresh = { preEncodes: true, shareReady: true, thumbOwed: true, saved: true };
    expect(outputSettled(fresh)).toBe(false);
    expect(outputImage({ ...fresh, entry: true })).toBe('thumb');
    // nothing owed: settled, nothing rendered
    expect(outputSettled({ ...fresh, thumbOwed: false })).toBe(true);
    expect(outputImage({ ...fresh, thumbOwed: false, entry: true })).toBe(null);
    // a tiled or PNG plan has no share file to make: the owed thumbnail alone, as before
    const png = { preEncodes: false, shareReady: false, thumbOwed: true, saved: true };
    expect(outputSettled(png)).toBe(false);
    expect(outputImage({ ...png, entry: true })).toBe('thumb');
    expect(outputSettled({ ...png, thumbOwed: false })).toBe(true);
    // a share file to make: its encode serves the thumbnail and the autosave
    const stale = { preEncodes: true, shareReady: false, thumbOwed: true, saved: true };
    expect(outputSettled(stale)).toBe(false);
    expect(outputImage({ ...stale, entry: true })).toBe('encode');
    expect(outputImage({ ...stale, thumbOwed: false, saved: false, entry: true })).toBe('encode');
    // not saved: the autosave renders its own image (and its write carries the thumbnail); no entry yet (its addEntry
    // still pending): no thumbnail of its own to rewrite
    expect(outputSettled({ ...fresh, thumbOwed: false, saved: false })).toBe(false);
    expect(outputImage({ ...fresh, saved: false, entry: true })).toBe(null);
    expect(outputImage({ ...fresh, entry: false })).toBe(null);
  });
  it('settleBodyAnswer: a merge failure is the detection error; a notice failure after a merge is not (step-1 review)', () => {
    const report = vi.fn((_e: unknown, where: string) => `reported ${where}`);
    const order: string[] = [];
    // the merge worked, the notices threw: done, the failure reported on its own
    expect(
      settleBodyAnswer(
        () => order.push('merge'),
        () => {
          order.push('notify');
          throw new Error('toast');
        },
        report,
      ),
    ).toEqual({ ok: true });
    expect(order).toEqual(['merge', 'notify']);
    expect(report).toHaveBeenLastCalledWith(expect.any(Error), 'body notices');
    // the merge threw: an error with its message, and no notices for a merge that did not happen
    const notify = vi.fn();
    expect(
      settleBodyAnswer(
        () => {
          throw new Error('bad cache');
        },
        notify,
        report,
      ),
    ).toEqual({ ok: false, message: 'reported body answer' });
    expect(notify).not.toHaveBeenCalled();
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
    expect(answerNotices(c, 3, true)).toEqual(['偵測到超過 10 張臉，只會美化最大的 10 張', '點選臉部或下方人物，可個別調整']);
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
    const toO = vToO(IDENTITY_GEOMETRY, { width: 1600, height: 1200 });
    const ctx = hitCtxOf(c, false, null, { width: 440, height: 330 }, toO);
    expect(ctx.faces.map((f) => f.person)).toEqual(['f0', 'f1']);
    expect(ctx.bodies).toBeUndefined();
    expect([ctx.minW, ctx.minH]).toEqual([0.1, 44 / 330]);
    const withBody = makeCache({ bodies: [cacheBody('b0', 0.8)], persons: [{ id: 'f0', face: 'f0', body: null }, { id: 'f1', face: 'f1', body: null }, { id: 'b0', face: null, body: 'b0' }] });
    expect(hitCtxOf(withBody, true, null, { width: 440, height: 330 }, toO).bodies?.map((b) => b.person)).toEqual(['b0']);
  });
  it('hitCtxOf: the 44 pt minimum is a 44 pt square at the tap taken V → O through the view (a crop, a quarter turn)', () => {
    const c = makeCache();
    const size = { width: 1600, height: 1200 };
    // a quarter-width crop shown on a 440 pt layer: 44 pt is 0.1 of V, 0.025 of O
    const crop = { ...IDENTITY_GEOMETRY, crop: { x: 0.5, y: 0, w: 0.25, h: 1 } };
    const cropped = hitCtxOf(c, false, null, { width: 440, height: 330 }, vToO(crop, size));
    expect(cropped.minW).toBeCloseTo(0.25 * 0.1, 12);
    expect(cropped.minH).toBeCloseTo(44 / 330, 12);
    // one 旋轉: the layer's width shows the O height, so O x takes its 44 pt from the layer height and O y from the width
    const turned = hitCtxOf(c, false, null, { width: 330, height: 440 }, vToO(rotateLeft(IDENTITY_GEOMETRY), size));
    expect(turned.minW).toBeCloseTo(44 / 440, 12);
    expect(turned.minH).toBeCloseTo(44 / 330, 12);
  });
});
