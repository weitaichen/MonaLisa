import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EDIT_DETECT_FACES, LIVE_DETECT_FACES, LOST_HOLD_MS, REID_GRACE_MS } from '../config/limits';
import { splitLegacy } from '../edit/legacy';
import { defaultPhoto, naturalPerson, neutralPerson } from '../edit/state';
import { applyPreset } from '../engine/params';
import type { RecordSink } from '../media/recordCanvas';
import { adapt } from '../tracking/adapter111';
import type { CameraLook, DebugState, Face, Facing, PersonParams, Prefs, Rect } from '../types';
import { normalizedCropRect } from '../ui/imaging';
import type { LiveTrackView } from './faceTracks';
import { AUTO_TIER, FACE_EASE_MS } from './liveCore';
import { LivePersons } from './livePersons';
import { type LiveDeps, type LiveStats, autoTierSession, liveFrame, liveRoute, resetAutoTierSession, startLiveLoop } from './live';
import {
  type FakeTracker,
  FakeVideo,
  faceOf,
  fakeCamera,
  fakeEngine,
  fakeTracker,
  installWorkClock,
  makeFace,
  makeLandmarks,
  prefs as makePrefs,
  stubRaf,
  weightOf,
} from './testFakes';

let faceSeq = 0;
vi.mock('../tracking/adapter111', () => ({
  adapt: vi.fn((lm: { points: Float32Array }) => makeFace(++faceSeq, lm.points[0] > 0.5005 ? 0.75 : 0.25)),
}));

const params = applyPreset('natural');
const look = splitLegacy(params);
/** a session in which every face is edited with `p` (全部套用 on): the v0.5 tests' one look on every face */
function editedAll(p: PersonParams): LivePersons {
  const s = new LivePersons();
  s.setAll(true);
  s.edit(p);
  return s;
}

function setup(
  opts: {
    prefs?: Partial<Prefs>;
    tracker?: boolean;
    engineTier?: 'H' | 'M' | 'L';
    period?: number;
    faces?: number;
    persons?: LivePersons;
    facing?: Facing;
    /** LiveDeps.getFrame */
    frame?: () => Rect;
    /** the tracker's full-range detector is in before the loop starts */
    fullRange?: boolean;
    /** false: the video has no rVFC, so the loop polls with rAF (stubbed) */
    rvfc?: false;
  } = {},
) {
  const clock = installWorkClock();
  const video = new FakeVideo();
  if (opts.rvfc === false) {
    stubRaf();
    Object.defineProperty(video, 'requestVideoFrameCallback', { value: undefined });
  }
  const camera = fakeCamera(video, 'live', opts.facing ?? 'user');
  const engine = fakeEngine(clock, opts.engineTier ?? 'M');
  const tracker = opts.tracker === false ? null : fakeTracker(clock, true, opts.faces ?? 1);
  if (tracker && opts.fullRange) tracker.photoDetector = 'full-range';
  let p = makePrefs(opts.prefs);
  const stats: LiveStats[] = [];
  const deps: LiveDeps = {
    camera,
    engine,
    tracker,
    persons: opts.persons ?? editedAll(look.person),
    getPhoto: () => look.photo,
    getPrefs: () => p,
    getFrame: opts.frame,
    onStats: (s) => stats.push(s),
  };
  const loop = startLiveLoop(deps);
  video.play(opts.period ?? 33);
  return {
    clock,
    video,
    camera,
    engine,
    tracker,
    loop,
    stats,
    setPrefs(over: Partial<Prefs>) {
      p = { ...p, ...over };
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', {});
  resetAutoTierSession();
  faceSeq = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const dbg = () => (globalThis as unknown as { window: { __meiyan?: DebugState } }).window.__meiyan;

/**
 * The compositor while a frame's work holds the main thread (round-1 review C3): the camera keeps presenting frames
 * (presentedFrames, currentTime) but the next frame callback runs on the first frame after that work ends, so a 112 ms
 * frame at 33 ms frames shows up on the next callback as 3 skipped frames and a 132 ms interval. (FakeVideo alone calls
 * back on every tick, whatever the work.) The frames passed are those presented from the frame's own presentation to the
 * work's end, so a callback FakeVideo.presentLag after its frame's presentation (a device's latency) passes them sooner.
 */
function blockingCompositor(video: FakeVideo): { lateBy: number; newest: boolean } {
  const present = video.present.bind(video);
  /**
   * `lateBy`: frames every callback also misses whatever the main thread did (GPU back-pressure); `newest`: the rVFC
   * spec's own order, the first callback after the work runs on the newest frame presented during it, not the next one
   */
  const io = { lateBy: 0, newest: false };
  let blocked = 0;
  video.present = (periodMs = 33) => {
    if (blocked > 0) {
      blocked--;
      video.presentedFrames += 1;
      video.currentTime += periodMs / 1000;
      return;
    }
    const t0 = performance.now();
    present(periodMs);
    const during = Math.floor((video.presentLag + performance.now() - t0) / periodMs);
    blocked = (io.newest ? Math.max(0, during - 1) : during) + io.lateBy;
  };
  return io;
}

describe('frame loop basics', () => {
  it('renders one processed frame per video frame with full source size and current params', () => {
    const { engine, tracker, loop } = setup();
    vi.advanceTimersByTime(33 * 30 + 1);
    expect(engine.render).toHaveBeenCalledTimes(30);
    expect(tracker!.detectVideo).toHaveBeenCalledTimes(30);
    const input = engine.lastInput()!;
    expect(input.width).toBe(1280);
    expect(input.height).toBe(720);
    expect(input.photo).toEqual(splitLegacy(params).photo);
    expect(input.source).toBeDefined();
    loop.stop();
  });

  it('passes strictly increasing timestamps to the tracker', () => {
    const { tracker, loop } = setup();
    vi.advanceTimersByTime(33 * 10 + 1);
    const ts = tracker!.detectVideo.mock.calls.map((c) => c[1]);
    for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThan(ts[i - 1]);
    loop.stop();
  });

  it('sets mirror = front camera and syncs engine options from prefs once, not per frame', () => {
    // the back camera runs the group path: node has no canvas for its view copy, so the guarded call reports that
    // (once) and answers null (A5)
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { engine, camera, loop, setPrefs } = setup();
    vi.advanceTimersByTime(33 * 5 + 1);
    expect(engine.setOptions).toHaveBeenCalledTimes(1);
    expect(engine.setOptions).toHaveBeenLastCalledWith({ mirror: true, matchGpupixel: false, showLandmarks: false });
    setPrefs({ showLandmarks: true });
    vi.advanceTimersByTime(33);
    expect(engine.setOptions).toHaveBeenLastCalledWith({ mirror: true, matchGpupixel: false, showLandmarks: true });
    camera.set({ facing: 'environment' });
    vi.advanceTimersByTime(33);
    expect(engine.setOptions).toHaveBeenLastCalledWith({ mirror: false, matchGpupixel: false, showLandmarks: true });
    expect(engine.setOptions).toHaveBeenCalledTimes(3);
    loop.stop();
  });

  it('requests the active filter LUT once', () => {
    const clock = installWorkClock();
    const video = new FakeVideo();
    const engine = fakeEngine(clock);
    let p = applyPreset('glow');
    const loop = startLiveLoop({
      camera: fakeCamera(video),
      engine,
      tracker: null,
      persons: new LivePersons(),
      getPhoto: () => splitLegacy(p).photo,
      getPrefs: () => makePrefs(),
    });
    video.play();
    vi.advanceTimersByTime(33 * 5 + 1);
    expect(engine.loadFilter).toHaveBeenCalledTimes(1);
    expect(engine.loadFilter).toHaveBeenCalledWith('warm');
    p = applyPreset('natural'); // filter 'none' → nothing to load
    vi.advanceTimersByTime(33 * 5);
    expect(engine.loadFilter).toHaveBeenCalledTimes(1);
    loop.stop();
  });

  it('stop() cancels the pending frame, the watchdog and the camera subscription', () => {
    const { engine, video, camera, loop } = setup();
    vi.advanceTimersByTime(33 * 3 + 1);
    const n = engine.render.mock.calls.length;
    loop.stop();
    expect(video.pending).toBe(0);
    expect(camera.listeners).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(engine.render.mock.calls.length).toBe(n);
    expect(vi.getTimerCount()).toBe(1); // only the fake video's own interval is left
  });

  it('a throwing render does not end the loop', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { engine, loop } = setup();
    engine.render.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    vi.advanceTimersByTime(33 * 10 + 1);
    expect(engine.render).toHaveBeenCalledTimes(10);
    expect(err).toHaveBeenCalledTimes(1);
    expect(dbg()?.lastError).toContain('boom');
    loop.stop();
  });

  it('a throwing tracker degrades to "no face" for that frame but still renders', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { engine, tracker, loop } = setup();
    tracker!.detectVideo.mockImplementation(() => {
      throw new Error('wasm');
    });
    vi.advanceTimersByTime(33 * 5 + 1);
    expect(engine.render).toHaveBeenCalledTimes(5);
    expect(faceOf(engine.lastInput())).toBeNull();
    loop.stop();
  });
});

describe('pausing', () => {
  it('does not render while the camera is not live, resumes when it is', () => {
    const { engine, camera, loop } = setup();
    vi.advanceTimersByTime(33 * 3 + 1);
    expect(engine.render).toHaveBeenCalledTimes(3);
    camera.set({ state: 'interrupted' });
    vi.advanceTimersByTime(33 * 10);
    expect(engine.render).toHaveBeenCalledTimes(3);
    expect(dbg()?.fps).toBe(0);
    expect(dbg()?.face).toBe(false);
    camera.set({ state: 'live' });
    vi.advanceTimersByTime(33 * 3);
    expect(engine.render).toHaveBeenCalledTimes(6);
    loop.stop();
  });

  it('does not render while the engine context is lost', () => {
    const { engine, loop } = setup();
    vi.advanceTimersByTime(33 * 2 + 1);
    engine.lost = true;
    vi.advanceTimersByTime(33 * 10);
    expect(engine.render).toHaveBeenCalledTimes(2);
    engine.lost = false;
    vi.advanceTimersByTime(33 * 2);
    expect(engine.render).toHaveBeenCalledTimes(4);
    loop.stop();
  });

  it('skips frames until the video has data', () => {
    const { engine, video, loop } = setup();
    video.readyState = 1;
    vi.advanceTimersByTime(33 * 5 + 1);
    expect(engine.render).not.toHaveBeenCalled();
    video.readyState = 4;
    vi.advanceTimersByTime(33);
    expect(engine.render).toHaveBeenCalledTimes(1);
    loop.stop();
  });

  it('a resumed stream fades the face back in from zero', () => {
    const { engine, camera, loop } = setup();
    vi.advanceTimersByTime(33 * 10 + 1);
    expect(weightOf(engine.lastInput())).toBe(1);
    camera.set({ state: 'interrupted' });
    camera.set({ state: 'live' });
    vi.advanceTimersByTime(33);
    expect(weightOf(engine.lastInput())).toBe(0);
    vi.advanceTimersByTime(33 * 6);
    expect(weightOf(engine.lastInput())).toBe(1);
    loop.stop();
  });
});

describe('face weight easing', () => {
  it('eases in over ~150 ms when a face appears', () => {
    const { engine, loop } = setup();
    vi.advanceTimersByTime(34);
    const weights: number[] = [];
    for (let i = 0; i < 8; i++) {
      vi.advanceTimersByTime(33);
      weights.push(weightOf(engine.lastInput()));
    }
    for (let i = 1; i < weights.length; i++) expect(weights[i]).toBeGreaterThanOrEqual(weights[i - 1]);
    expect(weights[0]).toBeGreaterThan(0);
    expect(weights[0]).toBeLessThan(0.3);
    const fullAt = weights.indexOf(1);
    // reaches 1 between 150 ms and 150 ms + one frame after the first frame
    expect((fullAt + 1) * 33).toBeGreaterThanOrEqual(FACE_EASE_MS);
    expect((fullAt + 1) * 33).toBeLessThanOrEqual(FACE_EASE_MS + 33);
    loop.stop();
  });

  it('holds the last face while fading out, then renders without a face', () => {
    const { engine, tracker, loop } = setup();
    vi.advanceTimersByTime(33 * 10 + 1);
    const lastFace = faceOf(engine.lastInput()) as Face;
    expect(lastFace).not.toBeNull();
    tracker!.face = false;
    vi.advanceTimersByTime(33);
    const a = engine.lastInput()!;
    expect(faceOf(a)).toBe(lastFace);
    expect(weightOf(a)).toBeGreaterThan(0);
    expect(weightOf(a)).toBeLessThan(1);
    vi.advanceTimersByTime(33 * 5);
    const b = engine.lastInput()!;
    expect(faceOf(b)).toBeNull();
    expect(weightOf(b)).toBe(0);
    expect(dbg()?.face).toBe(false);
    loop.stop();
  });

  it('基本模式 (no tracker): never a face, never detects', () => {
    const { engine, loop } = setup({ tracker: false });
    vi.advanceTimersByTime(33 * 10 + 1);
    expect(engine.render).toHaveBeenCalledTimes(10);
    expect(engine.render.mock.calls.every((c) => faceOf(c[0]) === null && weightOf(c[0]) === 0)).toBe(true);
    loop.stop();
  });
});

describe('tier L detection cadence', () => {
  it('detects every second frame and reuses the last landmarks in between', () => {
    const { engine, tracker, loop } = setup({ prefs: { tier: 'L' } });
    vi.advanceTimersByTime(33 * 20 + 1);
    expect(engine.render).toHaveBeenCalledTimes(20);
    expect(tracker!.detectVideo).toHaveBeenCalledTimes(10);
    const faces = engine.render.mock.calls.slice(10).map((c) => faceOf(c[0]));
    for (let i = 0; i < faces.length; i += 2) expect(faces[i + 1]).toBe(faces[i]);
    expect(faces[2]).not.toBe(faces[0]);
    loop.stop();
  });

  it('detects every frame on H and M', () => {
    const { tracker, loop } = setup({ prefs: { tier: 'M' } });
    vi.advanceTimersByTime(33 * 10 + 1);
    expect(tracker!.detectVideo).toHaveBeenCalledTimes(10);
    loop.stop();
  });
});

describe('tiers', () => {
  it('explicit pref → engine.setTier, no automatic change even when slow', () => {
    const { engine, tracker, loop } = setup({ prefs: { tier: 'M' }, engineTier: 'H' });
    tracker!.cost = 60;
    vi.advanceTimersByTime(20000);
    expect(engine.setTier.mock.calls).toEqual([['M']]);
    expect(engine.tier).toBe('M');
    loop.stop();
  });

  it('auto starts at H and stays there when frames are cheap', () => {
    const { engine, tracker, loop } = setup({ engineTier: 'M' });
    tracker!.cost = 12;
    engine.cost = 6;
    vi.advanceTimersByTime(20000);
    expect(engine.setTier.mock.calls).toEqual([['H']]);
    loop.stop();
  });

  it('auto steps down H → M → L after warm-up + sustained slow frames, never below L, never up', () => {
    const { engine, tracker, loop, stats } = setup({ engineTier: 'H' });
    tracker!.cost = 45;
    engine.cost = 5;
    // 50 ms of synchronous work per 33 ms camera frame
    vi.advanceTimersByTime(AUTO_TIER.warmupMs / 2);
    expect(engine.tier).toBe('H');
    vi.advanceTimersByTime(AUTO_TIER.warmupMs + AUTO_TIER.sustainMs);
    expect(engine.tier).toBe('M');
    expect(stats.at(-1)?.tier).toBe('M');
    vi.advanceTimersByTime(AUTO_TIER.warmupMs + AUTO_TIER.sustainMs + 500);
    expect(engine.tier).toBe('L');
    // make it fast again: still no step-up
    tracker!.cost = 1;
    engine.cost = 1;
    vi.advanceTimersByTime(30000);
    expect(engine.setTier.mock.calls).toEqual([['M'], ['L']]);
    expect(autoTierSession()).toBe('L');
    loop.stop();
  });

  it('does not step down when only the camera is slow (no dropped frames)', () => {
    const { engine, tracker, loop } = setup({ engineTier: 'H', period: 66 });
    tracker!.cost = 15;
    engine.cost = 5;
    vi.advanceTimersByTime(20000);
    expect(engine.tier).toBe('H');
    expect(dbg()?.fps).toBeGreaterThan(14);
    expect(dbg()?.fps).toBeLessThan(16);
    loop.stop();
  });

  it('steps down when the compositor reports dropped frames even if CPU work looks cheap', () => {
    const { engine, video, tracker, loop } = setup({ engineTier: 'H', period: 66 });
    video.presentStep = 2;
    tracker!.cost = 15;
    engine.cost = 5;
    vi.advanceTimersByTime(AUTO_TIER.warmupMs + AUTO_TIER.sustainMs + 1000);
    expect(engine.tier).toBe('M');
    loop.stop();
  });

  it('an amortized detection is not charged again on the next frame for the frames it blocked (k > 1, round-1 review C3)', () => {
    const { engine, video, tracker, loop } = setup({ engineTier: 'H', faces: 2 });
    blockingCompositor(video);
    // a 111 ms detection at 33 ms frames blocks 3 of them: R + D / k is about 20 ms at k 6, under the 40 ms budget
    tracker!.cost = 111;
    engine.cost = 1;
    vi.advanceTimersByTime(20000);
    expect(dbg()?.liveEvery).toBe(6);
    expect(engine.setTier).not.toHaveBeenCalled();
    expect(engine.tier).toBe('H');
    expect(autoTierSession()).toBe('H');
    loop.stop();
  });

  it('still steps down when a frame drops more frames than the last detection explains (k > 1)', () => {
    const { engine, video, tracker, loop } = setup({ engineTier: 'H', faces: 2 });
    const compositor = blockingCompositor(video);
    tracker!.cost = 111;
    engine.cost = 1;
    vi.advanceTimersByTime(AUTO_TIER.warmupMs + AUTO_TIER.sustainMs + 1000);
    expect(engine.tier).toBe('H');
    // GPU back-pressure: from now on every callback is 2 frames late, whatever the main thread did
    compositor.lateBy = 2;
    vi.advanceTimersByTime(AUTO_TIER.warmupMs + AUTO_TIER.sustainMs + 1000);
    expect(engine.tier).toBe('M');
    loop.stop();
  });

  it.each([
    [2, 45],
    [6, 111],
  ])('one frame of GPU back-pressure at k %i still steps down: only the frames the detection blocked are forgiven (round-2 review D3)', (k, d) => {
    const { engine, video, tracker, loop } = setup({ engineTier: 'H', faces: 2 });
    const compositor = blockingCompositor(video);
    tracker!.cost = d;
    engine.cost = 1;
    vi.advanceTimersByTime(AUTO_TIER.warmupMs + AUTO_TIER.sustainMs + 1000);
    expect(dbg()?.liveEvery).toBe(k);
    expect(engine.tier).toBe('H');
    // every callback one frame late: at k 2 every frame is a detecting one or the one after it, and the latter used to
    // be forgiven ⌈(D + R) / T⌉ frames, one more than the 45 ms detection passed (and the former, its own drops)
    compositor.lateBy = 1;
    vi.advanceTimersByTime(AUTO_TIER.warmupMs + AUTO_TIER.sustainMs + 1000);
    expect(engine.tier).toBe('M');
    loop.stop();
  });

  it('a callback that runs late after its frame’s presentation is forgiven the frames presented while its detection ran (k 2, D3)', () => {
    const { engine, video, tracker, loop } = setup({ engineTier: 'H', faces: 2 });
    const compositor = blockingCompositor(video);
    // 25 ms after the frame, a 46 ms callback passes the frames at 33 and 67 ms: both the detection's, counted from the
    // frame's presentation time (from the callback's start, 46 / 33 is one, and the tier stepped down for nothing)
    video.presentLag = 25;
    tracker!.cost = 45;
    engine.cost = 1;
    vi.advanceTimersByTime(20000);
    expect(dbg()?.liveEvery).toBe(2);
    expect(engine.setTier).not.toHaveBeenCalled();
    compositor.lateBy = 1;
    vi.advanceTimersByTime(AUTO_TIER.warmupMs + AUTO_TIER.sustainMs + 1000);
    expect(engine.tier).toBe('M');
    loop.stop();
  });

  it('on rVFC’s own order (the callback after the work runs on the newest frame presented during it) a detection’s drops are forgiven and back-pressure still steps down (D3)', () => {
    const a = setup({ engineTier: 'H', faces: 2 });
    blockingCompositor(a.video).newest = true;
    a.tracker!.cost = 111;
    a.engine.cost = 1;
    vi.advanceTimersByTime(20000);
    expect(dbg()?.liveEvery).toBe(6);
    expect(a.engine.setTier).not.toHaveBeenCalled();
    a.loop.stop();
    a.video.halt();
    resetAutoTierSession();
    const b = setup({ engineTier: 'H', faces: 2 });
    const compositor = blockingCompositor(b.video);
    compositor.newest = true;
    b.tracker!.cost = 45;
    b.engine.cost = 1;
    vi.advanceTimersByTime(AUTO_TIER.warmupMs + AUTO_TIER.sustainMs + 1000);
    expect(dbg()?.liveEvery).toBe(2);
    expect(b.engine.tier).toBe('H');
    // one frame late: the frame after the detection drops the one frame the detection passed, which cannot be told from
    // its own; the detecting frame's drop is charged (it came before the detection ran), and the frame after it is
    // weighted by its own frame only, not the detection's
    compositor.lateBy = 1;
    vi.advanceTimersByTime(AUTO_TIER.warmupMs + AUTO_TIER.sustainMs + 1000);
    expect(b.engine.tier).toBe('M');
    b.loop.stop();
  });

  it('a step-down taken on the group path does not stick after leaving it, and holds when it is back (K22, round-1 review C3)', () => {
    vi.stubGlobal('OffscreenCanvas', FakeView);
    const { engine, tracker, clock, loop, setPrefs } = setup({ engineTier: 'H', frame: whole, prefs: { groupMode: true } });
    // one face: a whole-view call every frame, 61 ms of work per 33 ms frame; the solo path's call is cheap
    viewDetect(tracker!, () => [0.5], clock, 60);
    tracker!.detectVideo.mockImplementation(() => [lmX(0.5)]);
    engine.cost = 1;
    vi.advanceTimersByTime(AUTO_TIER.warmupMs + AUTO_TIER.sustainMs + 1000);
    expect(engine.tier).toBe('M');
    // the device's tier (the export and import limits read it) is the solo path's
    expect(autoTierSession()).toBe('H');
    setPrefs({ groupMode: false });
    vi.advanceTimersByTime(100);
    expect(engine.tier).toBe('H');
    setPrefs({ groupMode: true });
    vi.advanceTimersByTime(100);
    expect(engine.tier).toBe('M');
    loop.stop();
    // a later loop of the same page session: each path starts where it ended
    const b = setup({ engineTier: 'H', frame: whole, prefs: { groupMode: true } });
    viewDetect(b.tracker!, () => [0.5]);
    vi.advanceTimersByTime(100);
    expect(b.engine.tier).toBe('M');
    b.loop.stop();
  });

  it('a 合照模式 toggle starts a new measurement: the group path’s slow frames are never charged to the solo path (C3)', () => {
    vi.stubGlobal('OffscreenCanvas', FakeView);
    const { engine, tracker, clock, loop, setPrefs } = setup({ engineTier: 'H', frame: whole, prefs: { groupMode: true } });
    viewDetect(tracker!, () => [0.5], clock, 60);
    tracker!.detectVideo.mockImplementation(() => [lmX(0.5)]);
    // over budget since the warm-up ended, a frame short of the sustain: then turned off (the cost EMA takes a few
    // frames to fall under the budget, and the solo path would take the step-down)
    vi.advanceTimersByTime(AUTO_TIER.warmupMs + AUTO_TIER.sustainMs - 10);
    expect(engine.tier).toBe('H');
    setPrefs({ groupMode: false });
    vi.advanceTimersByTime(AUTO_TIER.warmupMs + AUTO_TIER.sustainMs + 1000);
    expect(engine.tier).toBe('H');
    expect(autoTierSession()).toBe('H');
    loop.stop();
  });

  it('a step-down on the solo path holds on the group path too (the render is the same)', () => {
    vi.stubGlobal('OffscreenCanvas', FakeView);
    const { engine, tracker, loop, setPrefs } = setup({ engineTier: 'H', frame: whole });
    tracker!.cost = 60;
    viewDetect(tracker!, () => [0.5]);
    vi.advanceTimersByTime(AUTO_TIER.warmupMs + AUTO_TIER.sustainMs + 1000);
    expect(engine.tier).toBe('M');
    setPrefs({ groupMode: true });
    vi.advanceTimersByTime(100);
    expect(engine.tier).toBe('M');
    expect(autoTierSession()).toBe('M');
    loop.stop();
  });

  it('the auto result carries over to the next loop in the same session', () => {
    const a = setup({ engineTier: 'H' });
    a.tracker!.cost = 60;
    vi.advanceTimersByTime(AUTO_TIER.warmupMs + AUTO_TIER.sustainMs + 1000);
    expect(a.engine.tier).toBe('M');
    a.loop.stop();
    a.video.halt();
    const b = setup({ engineTier: 'H' });
    vi.advanceTimersByTime(100);
    expect(b.engine.setTier.mock.calls).toEqual([['M']]);
    b.loop.stop();
  });

  it('switching the pref from explicit back to auto uses the session tier and re-warms', () => {
    const { engine, tracker, loop, setPrefs } = setup({ prefs: { tier: 'H' }, engineTier: 'H' });
    tracker!.cost = 60;
    vi.advanceTimersByTime(10000);
    expect(engine.tier).toBe('H');
    setPrefs({ tier: 'auto' });
    vi.advanceTimersByTime(AUTO_TIER.warmupMs);
    expect(engine.tier).toBe('H'); // warm-up restarted at the switch
    vi.advanceTimersByTime(AUTO_TIER.sustainMs + 1000);
    expect(engine.tier).toBe('M');
    loop.stop();
  });
});

describe('stats', () => {
  it('fps EMA ≈ 30 at a 33 ms cadence; detect/render ms are smoothed; __meiyan updated', () => {
    const { tracker, engine, loop, stats } = setup({ prefs: { tier: 'M' } });
    tracker!.cost = 9;
    engine.cost = 4;
    vi.advanceTimersByTime(3000);
    const d = dbg()!;
    expect(d.fps).toBeCloseTo(1000 / 33, 1);
    expect(d.detectMs).toBeCloseTo(9, 3);
    expect(d.renderMs).toBeCloseTo(4, 3);
    expect(d.tier).toBe('M');
    expect(d.face).toBe(true);
    expect(d.delegate).toBe('GPU');
    // throttled: ~4 per second, not 1 per frame
    expect(stats.length).toBeGreaterThan(8);
    expect(stats.length).toBeLessThan(20);
    expect(stats.at(-1)).toMatchObject({ tier: 'M', face: true });
    loop.stop();
  });

  it('emits immediately when the face state changes', () => {
    const { tracker, loop, stats } = setup({ prefs: { tier: 'M' } });
    vi.advanceTimersByTime(1000);
    const n = stats.length;
    tracker!.face = false;
    vi.advanceTimersByTime(34);
    expect(stats.length).toBe(n + 1);
    expect(stats.at(-1)!.face).toBe(false);
    loop.stop();
  });
});

describe('compare and capture', () => {
  it('compare renders the original, immediately on toggle, then per frame', () => {
    const { engine, loop } = setup();
    vi.advanceTimersByTime(33 * 3 + 1);
    loop.setCompare(true);
    expect(engine.renderOriginal).toHaveBeenCalledTimes(1);
    expect(engine.renderOriginal.mock.calls[0][0]).toMatchObject({ width: 1280, height: 720 });
    vi.advanceTimersByTime(33 * 3);
    expect(engine.renderOriginal).toHaveBeenCalledTimes(4);
    expect(engine.render).toHaveBeenCalledTimes(3);
    loop.setCompare(false);
    expect(engine.render).toHaveBeenCalledTimes(4);
    loop.stop();
  });

  it('capture() is null before the first frame, then renders full video res with the shown face', () => {
    const { engine, loop } = setup();
    expect(loop.capture()).toBeNull();
    vi.advanceTimersByTime(33 * 10 + 1);
    const img = loop.capture()?.image ?? null;
    expect(img).not.toBeNull();
    const [input, opts] = engine.renderToImageData.mock.calls[0];
    expect(input).toMatchObject({ width: 1280, height: 720 });
    expect(weightOf(input)).toBe(1);
    expect(input.photo).toEqual(splitLegacy(params).photo);
    expect(faceOf(input)).toBe(faceOf(engine.lastInput()));
    expect(opts).toEqual({ mirror: true });
    loop.stop();
  });

  it('capture mirror = prefs.mirrorOnSave && front camera', () => {
    const { engine, camera, loop, setPrefs } = setup();
    vi.advanceTimersByTime(33 * 2 + 1);
    setPrefs({ mirrorOnSave: false });
    loop.capture();
    expect(engine.renderToImageData.mock.calls.at(-1)![1]).toEqual({ mirror: false });
    setPrefs({ mirrorOnSave: true });
    camera.set({ facing: 'environment' });
    vi.advanceTimersByTime(33);
    loop.capture();
    expect(engine.renderToImageData.mock.calls.at(-1)![1]).toEqual({ mirror: false });
    loop.stop();
  });

  it('capture() is null while paused or after stop', () => {
    const { camera, loop } = setup();
    vi.advanceTimersByTime(33 * 2 + 1);
    camera.set({ state: 'interrupted' });
    expect(loop.capture()).toBeNull();
    camera.set({ state: 'live' });
    vi.advanceTimersByTime(33);
    expect(loop.capture()).not.toBeNull();
    loop.stop();
    expect(loop.capture()).toBeNull();
  });

  it('round-6 review H1, U3: on the solo path a face the shutter’s call finds is drawn as the shot hands it over (全部套用’s newcomer, an edited person back past the hold): weight 1, the global skin off', () => {
    const drawnOf = (engine: ReturnType<typeof setup>['engine']) => {
      const [input] = engine.renderToImageData.mock.calls.at(-1)!;
      return { faces: input.faces.map((f) => [f.weight, f.presence, f.person]), skin: input.globalSkin!.weight };
    };
    // 全部套用 (the setup's session): no face in the preview, one on the shutter's frame
    const a = setup();
    a.tracker!.face = false;
    vi.advanceTimersByTime(33 * 10 + 1);
    a.tracker!.face = true;
    a.video.currentTime += 1 / 30;
    a.loop.capture();
    expect(drawnOf(a.engine)).toEqual({ faces: [[1, 1, look.person]], skin: 0 });
    expect([a.loop.tracks()[0].weight, a.loop.tracks()[0].presence]).toEqual([0, 0]); // the preview eases in from here
    a.loop.stop();
    a.video.halt();
    // an edited person away past the hold, back on the shutter's frame: re-identified there
    const persons = new LivePersons();
    const b = setup({ persons });
    vi.advanceTimersByTime(33 * 10 + 1);
    b.loop.select(b.loop.tracks()[0].person);
    persons.edit(naturalPerson());
    b.tracker!.face = false;
    vi.advanceTimersByTime(LOST_HOLD_MS + 500);
    expect(b.loop.tracks()).toHaveLength(0);
    b.tracker!.face = true;
    b.video.currentTime += 1 / 30;
    const shot = b.loop.capture()!;
    expect(shot.persons.map((p) => [p.params, p.held])).toEqual([[naturalPerson(), false]]);
    expect(drawnOf(b.engine)).toEqual({ faces: [[1, 1, naturalPerson()]], skin: 0 });
    b.loop.stop();
  });
});

describe('rVFC watchdog', () => {
  it('falls back to rAF polling when rVFC never fires while the video plays', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubRaf();
    const { engine, video, loop } = setup();
    video.rvfcSilent = true;
    vi.advanceTimersByTime(1900);
    expect(engine.render).not.toHaveBeenCalled(); // first silent check at 1 s, fallback on the 2nd
    vi.advanceTimersByTime(1000);
    // rAF ticks at 16 ms but only new frames (currentTime changed) are processed
    const n = engine.render.mock.calls.length;
    expect(n).toBeGreaterThan(10);
    vi.advanceTimersByTime(33 * 30);
    expect(engine.render.mock.calls.length - n).toBeGreaterThanOrEqual(29);
    expect(engine.render.mock.calls.length - n).toBeLessThanOrEqual(31);
    loop.stop();
  });

  it('stays on rVFC when frames arrive', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { engine, loop } = setup();
    vi.advanceTimersByTime(10000);
    expect(err).not.toHaveBeenCalled();
    expect(engine.render.mock.calls.length).toBeGreaterThan(290);
    loop.stop();
  });

  it('does not trip while the camera is not live', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { camera, video, loop } = setup();
    camera.set({ state: 'starting' });
    video.rvfcSilent = true;
    vi.advanceTimersByTime(5000);
    expect(err).not.toHaveBeenCalled();
    loop.stop();
  });
});

describe('the live loop on persons (camera per-person spec §8, §7.5)', () => {
  const fresh = () => new LivePersons();
  // 合照模式 off (the default prefs): the loop on persons over VIDEO detections; the group path has its own describe below
  it('each face renders its own person: the edited one at its params, the untouched one at 原圖 and weight 0', () => {
    const persons = fresh();
    const { engine, loop } = setup({ faces: 2, persons });
    vi.advanceTimersByTime(300);
    const right = loop.tracks().find((v) => v.box.x > 0.5)!;
    persons.write([right.person], naturalPerson());
    vi.advanceTimersByTime(300);
    const [a, b] = engine.lastInput()!.faces;
    expect(a).toMatchObject({ weight: 1, person: naturalPerson() });
    expect(b).toMatchObject({ weight: 0, person: neutralPerson() });
    expect(engine.lastInput()!.globalSkin).toEqual({ smooth: 0, rosy: 0, weight: 0 });
    loop.stop();
  });
  it('基本模式 draws the ambient person on all skin; with a tracker the global skin is 原圖 (§3.6, K11)', () => {
    const persons = fresh();
    persons.setAmbient(naturalPerson());
    const basic = setup({ tracker: false, persons });
    vi.advanceTimersByTime(100);
    expect(basic.engine.lastInput()!.globalSkin).toMatchObject({ smooth: naturalPerson().values['skin.smooth'], weight: 1 });
    basic.loop.stop();
    basic.video.halt();
    // the same session's ambient person on a loop with a tracker (round-7 review J1): no face in view, nothing drawn on
    // the skin, in the preview and in a shot
    const tracked = setup({ persons });
    tracked.tracker!.face = false;
    vi.advanceTimersByTime(33 * 10 + 1);
    expect(tracked.engine.lastInput()!.globalSkin).toEqual({ smooth: 0, rosy: 0, weight: 1 });
    tracked.video.currentTime += 1 / 30;
    tracked.loop.capture();
    expect(tracked.engine.renderToImageData.mock.calls.at(-1)![0].globalSkin).toEqual({ smooth: 0, rosy: 0, weight: 1 });
    tracked.loop.stop();
  });
  it('liveFrame orders present edited faces first, then present, then held, cut at MAX_RENDER_FACES', () => {
    const persons = fresh();
    const ids = Array.from({ length: 12 }, () => persons.claim({ x: 0.4, y: 0.4, w: 0.1, h: 0.1 }, 16 / 9, 0));
    persons.write(ids.filter((id) => id % 2 === 1), naturalPerson());
    const view = (id: number): LiveTrackView => ({
      id, person: id, box: { x: 0.4, y: 0.4, w: 0.1, h: 0.1 }, rawBox: { x: 0.4, y: 0.4, w: 0.1, h: 0.1 }, face: makeFace(id),
      weight: 0, presence: 1, edited: persons.edited(id), selected: false, present: id > 4, stale: false, seen: 0, view: 'video',
    });
    const f = liveFrame(ids.map(view), 1, look.photo, persons);
    expect(f.faces.map((x) => x.face.pts111[0])).toEqual([5, 7, 9, 11, 6, 8, 10, 12, 1, 2]);
    expect(f.faces[0].person).toEqual(naturalPerson());
    expect(f.faces[4].person).toEqual(neutralPerson());
  });
  it('pause and stop release the tracks into the away pool; the next live frame re-identifies them in place', () => {
    const persons = fresh();
    const { camera, loop } = setup({ persons });
    vi.advanceTimersByTime(300);
    const p = loop.tracks()[0].person;
    persons.write([p], naturalPerson());
    camera.set({ state: 'interrupted' });
    vi.advanceTimersByTime(20_000);
    camera.set({ state: 'live' });
    vi.advanceTimersByTime(100);
    expect(loop.tracks()[0].person).toBe(p);
    loop.stop();
    const again = setup({ persons });
    vi.advanceTimersByTime(100);
    expect(again.loop.tracks()[0].person).toBe(p);
    again.loop.stop();
  });
  it.each([true, false])('Review Focus #1: a flip (session ended first: %s) never hands a front-camera person to the back camera', (ended) => {
    const persons = fresh();
    // 合照模式 off: the back camera's stream stays on VIDEO, where the fake answers faces (the session is what this
    // checks; the group path's own back-camera start is tested below)
    const { camera, loop } = setup({ persons });
    vi.advanceTimersByTime(300);
    persons.write([loop.tracks()[0].person], naturalPerson());
    if (ended) persons.clear();
    camera.set({ state: 'starting' });
    camera.set({ state: 'live', facing: 'environment' });
    vi.advanceTimersByTime(300);
    expect(persons.edited(loop.tracks()[0].person)).toBe(false);
    loop.stop();
  });
  it('select pins a person; capture hands over every edited person in view and the seed of the target, or all', () => {
    const persons = fresh();
    const { loop, tracker } = setup({ faces: 2, persons });
    vi.advanceTimersByTime(600);
    const right = loop.tracks().find((t) => t.box.x > 0.5)!;
    expect(loop.hitTest(right.box.x + right.box.w / 2, 0.5, 0.01, 0.01)).toBe(right.person);
    loop.select(right.person);
    expect(loop.selection()).toBe(right.person);
    persons.edit(naturalPerson());
    vi.advanceTimersByTime(300);
    const shot = loop.capture()!;
    const now = loop.tracks().find((t) => t.person === right.person)!;
    const left = loop.tracks().find((t) => t.person !== right.person)!;
    expect(shot.seed).toEqual({ x: now.rawBox.x + now.rawBox.w / 2, y: now.rawBox.y + now.rawBox.h / 2 });
    // round 1 (C7): the person found never edited goes too, without params, so their box keeps their face in 編輯
    expect(shot.persons).toEqual([
      { rawBox: left.rawBox, params: null, held: false, stale: false },
      { rawBox: now.rawBox, params: naturalPerson(), held: false, stale: false },
    ]);
    // the edited person missing at the shutter (held): handed over, marked held
    tracker!.count = 1;
    vi.advanceTimersByTime(300);
    expect(loop.tracks().find((t) => t.person === right.person)?.present).toBe(false);
    expect(loop.capture()!.persons.map((p) => [p.params !== null, p.held])).toEqual([
      [false, false],
      [true, true],
    ]);
    persons.setAll(true);
    expect(loop.capture()!.seed).toBe('all');
    loop.stop();
  });
  it('round-2 review D7: after a no-answer on the shutter’s frame the solo path asks once more; a track still unseen is not known missing, so it goes as found: a never-edited one still blocks, an edited one is not marked held', () => {
    const persons = fresh();
    const { loop, tracker } = setup({ faces: 2, persons });
    vi.advanceTimersByTime(600);
    loop.select(loop.tracks().find((t) => t.box.x > 0.5)!.person);
    persons.edit(naturalPerson());
    vi.advanceTimersByTime(300);
    // the frame's call has no answer (the rebuild throttle after a GPU failure): every track unseen since
    tracker!.unusable = true;
    vi.advanceTimersByTime(33);
    expect(loop.tracks().map((t) => [t.present, t.stale])).toEqual([
      [false, true],
      [false, true],
    ]);
    let n = tracker!.detectVideo.mock.calls.length;
    const still = loop.capture()!;
    expect(tracker!.detectVideo.mock.calls.length).toBe(n + 1); // asked again; still no answer
    // round 3 (E5): marked stale, their boxes the last answer's, not the captured frame's (a guess in 編輯: round-4 review F2)
    expect(still.persons.map((p) => [p.params !== null, p.held, p.stale]).sort()).toEqual([
      [false, false, true],
      [true, false, true],
    ]);
    // the tracker answers again by the shutter: the captured frame's own landmarks
    vi.advanceTimersByTime(33);
    tracker!.unusable = false;
    n = tracker!.detectVideo.mock.calls.length;
    loop.capture();
    expect(tracker!.detectVideo.mock.calls.length).toBe(n + 1);
    expect(loop.tracks().map((t) => [t.present, t.stale])).toEqual([
      [true, false],
      [true, false],
    ]);
    // answered on the frame: no second call
    n = tracker!.detectVideo.mock.calls.length;
    expect(loop.capture()!.persons.map((p) => [p.params !== null, p.held, p.stale]).sort()).toEqual([
      [false, false, false],
      [true, false, false],
    ]);
    expect(tracker!.detectVideo.mock.calls.length).toBe(n);
    loop.stop();
  });
  it('round-3 review E5: a person already missing before a no-answer stays known missing at the shutter: the edited one goes held, the never-edited one is not handed over', () => {
    const persons = fresh();
    const { loop, tracker } = setup({ faces: 2, persons });
    vi.advanceTimersByTime(600);
    loop.select(loop.tracks().find((t) => t.box.x > 0.5)!.person);
    persons.edit(naturalPerson());
    vi.advanceTimersByTime(300);
    // both walk out: missed, held
    tracker!.count = 0;
    vi.advanceTimersByTime(300);
    expect(loop.tracks().map((t) => [t.present, t.stale])).toEqual([
      [false, false],
      [false, false],
    ]);
    // then the tracker cannot answer (the rebuild throttle after a GPU failure), on the shutter's frame too
    tracker!.unusable = true;
    vi.advanceTimersByTime(33);
    expect(loop.tracks().map((t) => [t.present, t.stale])).toEqual([
      [false, false],
      [false, false],
    ]);
    const n = tracker!.detectVideo.mock.calls.length;
    const shot = loop.capture()!;
    expect(tracker!.detectVideo.mock.calls.length).toBe(n + 1);
    expect(shot.persons.map((p) => [p.params !== null, p.held, p.stale])).toEqual([[true, true, false]]);
    loop.stop();
  });
  it('debug: boxes carry c{n} and edited; selected is the target track; passes are the last frame’s; LiveStats.target is emitted at once', () => {
    const persons = fresh();
    const { loop, stats, engine } = setup({ faces: 2, persons });
    engine.render.mockImplementation((i) => ({ cpuMs: 0, width: i.width, height: i.height, passes: ['composite'] }));
    vi.advanceTimersByTime(600);
    const d = dbg()!;
    expect(d.boxes.map((b) => [b.person, b.edited])).toEqual(loop.tracks().map((t) => [`c${t.person}`, false]));
    const sel = loop.tracks().find((t) => t.selected)!;
    expect(d.selected).toBe(`t${sel.id}`);
    expect(d.passes).toEqual(['composite']);
    const n = stats.length;
    loop.select(loop.tracks().find((t) => !t.selected)!.person);
    vi.advanceTimersByTime(34);
    expect(stats.slice(n).some((s) => s.target !== stats[n - 1].target)).toBe(true);
    loop.stop();
  });
});

/** OffscreenCanvas stand-in: drawImage records the source rect the loop copied; `made` lists every one created */
class FakeView {
  static made: FakeView[] = [];
  src = [0, 0, 0, 0];
  constructor(
    public width: number,
    public height: number,
  ) {
    FakeView.made.push(this);
  }
  getContext() {
    return { drawImage: (_v: unknown, sx: number, sy: number, sw: number, sh: number) => void (this.src = [sx, sy, sw, sh]) };
  }
}
const lmX = (x: number) => {
  const l = makeLandmarks();
  l.points[0] = x;
  return l;
};
/** a detectView that sees the faces at stream x `xs()` (boxes x ± 0.2, y 0.3–0.7) whose box lies inside the copied view */
function viewDetect(t: FakeTracker, xs: () => readonly number[], clock?: { work(ms: number): void }, cost = 0, W = 1280, H = 720) {
  t.detectView.mockImplementation((img) => {
    clock?.work(cost);
    const [sx, sy, sw, sh] = (img as unknown as FakeView).src;
    return xs()
      .filter((x) => (x - 0.2) * W >= sx && (x + 0.2) * W <= sx + sw && 0.3 * H >= sy && 0.7 * H <= sy + sh)
      .map((x) => lmX((x * W - sx) / sw));
  });
}
const whole = (): Rect => ({ x: 0, y: 0, w: 1, h: 1 });

describe('liveRoute: the path and graph of a stream by 合照模式 and facing (camera per-person spec §6.3, K22)', () => {
  it('off: one VIDEO pass over the whole frame on the facing’s detector (the solo path; option C on the back camera)', () => {
    expect(liveRoute('user', false)).toEqual({ path: 'solo', mode: 'VIDEO', detector: 'camera' });
    expect(liveRoute('environment', false)).toEqual({ path: 'solo', mode: 'VIDEO', detector: 'photo' });
  });
  it('on: the group path’s IMAGE calls on both cameras, on the facing’s detector (no wait for a second face, K18 replaced)', () => {
    expect(liveRoute('user', true)).toEqual({ path: 'group', mode: 'IMAGE', detector: 'camera' });
    expect(liveRoute('environment', true)).toEqual({ path: 'group', mode: 'IMAGE', detector: 'photo' });
  });
});

describe('the group path in the live loop (§6.3, §6.4, §6.6, K13, K22)', () => {
  // 合照模式 (prefs.groupMode, K22) picks the path: off by default (option C), on in every group-path test
  const on = { groupMode: true };
  let xs: number[];
  let orig: typeof adapt | undefined;
  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', FakeView);
    FakeView.made = [];
    orig = vi.mocked(adapt).getMockImplementation();
    vi.mocked(adapt).mockImplementation((lm) => makeFace(++faceSeq, lm.points[0])); // a 0.4 × 0.4 face centred at (points[0], 0.5)
    xs = [0.25, 0.75];
  });
  afterEach(() => {
    vi.mocked(adapt).mockImplementation(orig!);
  });
  it('合照模式 on: the back camera starts on the group path: IMAGE calls on the views at EDIT_DETECT_FACES with the full-range detector', () => {
    const { tracker, loop } = setup({ facing: 'environment', frame: whole, fullRange: true, prefs: on });
    viewDetect(tracker!, () => xs);
    vi.advanceTimersByTime(1000);
    expect(tracker!.detectVideo).not.toHaveBeenCalled();
    expect(tracker!.detectView.mock.calls[0][0]).toBeInstanceOf(FakeView);
    expect(tracker!.detectView.mock.calls[0][1]).toEqual({ maxFaces: EDIT_DETECT_FACES, detector: 'photo' });
    expect(dbg()).toMatchObject({ livePath: 'group', liveDetector: 'full-range' });
    expect(dbg()!.liveViews![0]).toBe('whole');
    expect(loop.tracks()).toHaveLength(2);
    loop.stop();
  });
  it('合照模式 on: the front camera runs the group path from its first frame, one face included, and stays on it (K22 replaces K18’s wait and return)', () => {
    const { tracker, loop } = setup({ frame: whole, prefs: on });
    xs = [0.25];
    viewDetect(tracker!, () => xs);
    vi.advanceTimersByTime(500);
    expect(tracker!.detectVideo).not.toHaveBeenCalled();
    expect(tracker!.detectView.mock.calls[0][1]).toEqual({ maxFaces: EDIT_DETECT_FACES, detector: 'camera' });
    expect(dbg()).toMatchObject({ livePath: 'group', liveDetector: 'short-range' });
    expect(loop.tracks()).toHaveLength(1);
    vi.advanceTimersByTime(10_000);
    expect(dbg()!.livePath).toBe('group');
    expect(tracker!.detectVideo).not.toHaveBeenCalled();
    loop.stop();
  });
  it('合照模式 off: a second face never moves the front camera to the group path (the user’s choice, K22)', () => {
    const { tracker, loop } = setup({ frame: whole });
    tracker!.detectVideo.mockImplementation(() => xs.map(lmX));
    viewDetect(tracker!, () => xs);
    const paths = new Set<string | undefined>();
    for (let t = 0; t < 10_000; t += 100) {
      vi.advanceTimersByTime(100);
      paths.add(dbg()!.livePath);
    }
    expect([...paths]).toEqual(['solo']);
    expect(tracker!.detectView).not.toHaveBeenCalled();
    expect(loop.tracks()).toHaveLength(2);
    loop.stop();
  });
  it('one face with 合照模式 off never leaves the solo path (A1): detectVideo every frame with the camera bundle, never detectView', () => {
    const { tracker, loop } = setup();
    vi.advanceTimersByTime(33 * 300 + 1);
    expect(tracker!.detectVideo).toHaveBeenCalledTimes(300);
    expect(tracker!.detectVideo.mock.calls.every((c) => c[2].detector === 'camera' && c[2].maxFaces === LIVE_DETECT_FACES)).toBe(true);
    expect(tracker!.detectView).not.toHaveBeenCalled();
    loop.stop();
  });
  it('合照模式 off (the default prefs): option C, VIDEO on every facing with LIVE_DETECTOR’s bundle', () => {
    const back = setup({ facing: 'environment', fullRange: true });
    vi.advanceTimersByTime(200);
    expect(back.tracker!.detectVideo.mock.calls.at(-1)![2]).toEqual({ maxFaces: LIVE_DETECT_FACES, detector: 'photo' });
    expect(back.tracker!.detectView).not.toHaveBeenCalled();
    expect(dbg()).toMatchObject({ livePath: 'solo', liveDetector: 'full-range', liveViews: [] });
    back.loop.stop();
    back.video.halt();
    const front = setup();
    vi.advanceTimersByTime(200);
    expect(front.tracker!.detectVideo.mock.calls.at(-1)![2]).toEqual({ maxFaces: LIVE_DETECT_FACES, detector: 'camera' });
    front.loop.stop();
  });
  it.each(['user', 'environment'] as const)(
    'toggling 合照模式 mid-stream (%s) moves the path on the next frame, both ways; every track keeps its person, every person their params, nobody swapped',
    (facing) => {
      const persons = new LivePersons();
      const { tracker, loop, setPrefs } = setup({ facing, frame: whole, fullRange: true, persons });
      tracker!.detectVideo.mockImplementation(() => xs.map(lmX));
      viewDetect(tracker!, () => xs);
      vi.advanceTimersByTime(500);
      expect(dbg()!.livePath).toBe('solo');
      const byX = () => Object.fromEntries(loop.tracks().map((t) => [Math.round((t.box.x + t.box.w / 2) * 4) / 4, t.person]));
      const before = byX();
      const left = before[0.25];
      const right = before[0.75];
      expect([left, right].every((id) => id !== undefined)).toBe(true);
      loop.select(right);
      persons.edit(naturalPerson());
      const check = () => {
        expect(byX()).toEqual(before);
        expect(persons.params(right)).toEqual(naturalPerson());
        expect(persons.edited(left)).toBe(false);
        expect(loop.selection()).toBe(right);
        expect(loop.tracks().every((t) => t.present)).toBe(true);
      };
      const views = tracker!.detectView.mock.calls.length;
      setPrefs({ groupMode: true });
      vi.advanceTimersByTime(34);
      expect(dbg()!.livePath).toBe('group');
      expect(dbg()!.liveViews![0]).toBe('whole');
      expect(tracker!.detectView.mock.calls.length).toBeGreaterThan(views);
      vi.advanceTimersByTime(2000);
      check();
      const videos = tracker!.detectVideo.mock.calls.length;
      setPrefs({ groupMode: false });
      vi.advanceTimersByTime(34);
      expect(dbg()).toMatchObject({ livePath: 'solo', liveViews: [] });
      expect(tracker!.detectVideo.mock.calls.length).toBeGreaterThan(videos);
      vi.advanceTimersByTime(2000);
      check();
      loop.stop();
    },
  );
  it.each([
    // a far face under option C's floor: only the group path finds it; turned off, then on again
    ['a face only 合照模式 finds (far, under option C’s floor)', true, [0.25], [0.25, 0.75]],
    // a face mostly outside the crop: only the solo path's whole frame finds it; turned on, then off again
    ['a face only the solo path finds (mostly outside the crop)', false, [0.25, 0.75], [0.25]],
  ] as const)(
    'toggling 合照模式 away from the only path that finds %s and back after more than REID_GRACE_MS: the same person, edited and selected (K22)',
    (_, startOn, soloXs, groupXs) => {
      const persons = new LivePersons();
      const { tracker, loop, setPrefs } = setup({ facing: 'environment', frame: whole, fullRange: true, persons, prefs: { groupMode: startOn } });
      tracker!.detectVideo.mockImplementation(() => soloXs.map(lmX));
      viewDetect(tracker!, () => groupXs);
      vi.advanceTimersByTime(1000);
      const far = () => loop.tracks().find((t) => t.box.x > 0.5);
      const p = far()!.person;
      loop.select(p);
      persons.edit(naturalPerson());
      setPrefs({ groupMode: !startOn });
      vi.advanceTimersByTime(LOST_HOLD_MS + REID_GRACE_MS + 1000);
      // the path in use cannot see them: their track is gone, the person is away (and the target is the auto pick)
      expect(far()).toBeUndefined();
      expect(loop.tracks()).toHaveLength(1);
      setPrefs({ groupMode: startOn });
      vi.advanceTimersByTime(1000);
      expect(far()?.person).toBe(p);
      expect(persons.params(p)).toEqual(naturalPerson());
      expect(far()!.edited).toBe(true);
      expect(loop.selection()).toBe(p);
      loop.stop();
    },
  );
  it('the detector is fixed per stream session: a full-range download landing mid-stream is used from the next session', () => {
    const { tracker, camera, loop } = setup({ facing: 'environment', frame: whole, prefs: on });
    viewDetect(tracker!, () => xs);
    vi.advanceTimersByTime(200);
    expect(tracker!.detectView.mock.calls.at(-1)![1].detector).toBe('camera');
    tracker!.photoDetector = 'full-range';
    vi.advanceTimersByTime(200);
    expect(tracker!.detectView.mock.calls.at(-1)![1].detector).toBe('camera');
    camera.set({ state: 'interrupted' });
    camera.set({ state: 'live' });
    vi.advanceTimersByTime(200);
    expect(tracker!.detectView.mock.calls.at(-1)![1].detector).toBe('photo');
    loop.stop();
  });
  it('the detector is kept per camera stream: a new loop over the same live stream keeps it, the next stream takes the download (round-1 review C14)', () => {
    const { tracker, camera, engine, video, loop } = setup({ facing: 'environment', frame: whole });
    Object.assign(video, { srcObject: {} });
    vi.advanceTimersByTime(200);
    const last = () => tracker!.detectVideo.mock.calls.at(-1)![2].detector;
    expect(last()).toBe('camera');
    tracker!.photoDetector = 'full-range';
    // Review → 重拍: the stream stays live and the remounted camera starts a new loop on it (no flip, no warm-up)
    loop.stop();
    const again = () =>
      startLiveLoop({ camera, engine, tracker, persons: new LivePersons(), getPhoto: () => look.photo, getPrefs: () => makePrefs(), getFrame: whole });
    const b = again();
    vi.advanceTimersByTime(200);
    expect(last()).toBe('camera');
    // a context loss's pause and resume on the same stream: still its detector
    engine.lost = true;
    vi.advanceTimersByTime(100);
    engine.lost = false;
    vi.advanceTimersByTime(200);
    expect(last()).toBe('camera');
    // a new stream (a flip, a start, a resume: each warms behind the spinner) takes the full-range detector
    Object.assign(video, { srcObject: {} });
    camera.set({ state: 'starting' });
    camera.set({ state: 'live' });
    vi.advanceTimersByTime(200);
    expect(last()).toBe('photo');
    // and a later loop on that stream keeps it
    b.stop();
    const c = again();
    vi.advanceTimersByTime(200);
    expect(last()).toBe('photo');
    c.stop();
  });
  it('round-7 review J2: a 基本模式 loop fixes no stream detector, so the late tracker on that back-camera stream takes the full-range one', () => {
    const { camera, engine, video, clock, loop } = setup({ tracker: false, facing: 'environment', frame: whole });
    Object.assign(video, { srcObject: {} });
    vi.advanceTimersByTime(200);
    loop.stop();
    // 0.5.1's late tracker, full-range in, adopted while this stream stays live: a new loop on it (RM §15)
    const tracker = fakeTracker(clock, true, 1);
    tracker.photoDetector = 'full-range';
    const b = startLiveLoop({ camera, engine, tracker, persons: new LivePersons(), getPhoto: () => look.photo, getPrefs: () => makePrefs(), getFrame: whole });
    vi.advanceTimersByTime(200);
    expect(tracker.detectVideo.mock.calls.at(-1)![2].detector).toBe('photo');
    b.stop();
  });
  it('cadence: two faces and a 64 ms detection skip frames (every 5 at R 5 ms); one face detects every frame', () => {
    const { tracker, engine, clock, loop } = setup({ facing: 'environment', frame: whole, prefs: on });
    viewDetect(tracker!, () => xs, clock, 64);
    engine.cost = 5;
    vi.advanceTimersByTime(3000);
    expect(dbg()!.liveEvery).toBe(5);
    const n = tracker!.detectView.mock.calls.length;
    vi.advanceTimersByTime(33 * 50);
    expect(tracker!.detectView.mock.calls.length - n).toBe(10);
    xs = [0.5];
    vi.advanceTimersByTime(2000);
    expect(dbg()!.liveEvery).toBe(1);
    loop.stop();
  });
  it.each([
    ['solo path, rVFC', false, undefined],
    ['group path, rVFC', true, undefined],
    ['solo path, the rAF fallback', false, false],
  ] as const)(
    'cadence (round-1 review C16, %s): T is the camera’s own interval at k ≤ 2 too, so a 55 ms camera (low light) with D + R 46 ms detects every frame',
    (how, groupMode, rvfc) => {
      // at the default T (33.3 ms) D + R = 46 gives k = 2; at the camera's real 55 ms, k = 1. With rVFC every frame
      // measures T from the frames' own timestamps (k never leaves 1); without, at k = 2 every frame detects or follows
      // a detection, and an interval after a frame without one measures it (k = 2 first, then 1)
      const { tracker, engine, clock, loop } = setup({ frame: whole, period: 55, prefs: { tier: 'M', groupMode }, rvfc });
      tracker!.detectVideo.mockImplementation(() => {
        clock.work(36);
        return xs.map(lmX);
      });
      viewDetect(tracker!, () => xs, clock, 36);
      engine.cost = 10;
      const seen = new Set<number>();
      for (let t = 0; t < 8000; t += 110) {
        vi.advanceTimersByTime(110);
        seen.add(dbg()!.liveEvery!);
      }
      expect([...seen].sort()).toEqual(how.includes('rAF') ? [1, 2] : [1]);
      expect(dbg()!.liveEvery).toBe(1);
      expect(loop.tracks()).toHaveLength(2);
      loop.stop();
    },
  );
  it('K13: capture detects first when the last detection is older than the captured frame; on the group path, the views of the cycle that can refresh a track it hands over (round-2 review D10)', () => {
    const solo = setup({ prefs: { tier: 'L' } });
    vi.advanceTimersByTime(33 * 12 + 1); // frame 12 does not detect on tier L
    const n = solo.tracker!.detectVideo.mock.calls.length;
    solo.loop.capture();
    expect(solo.tracker!.detectVideo.mock.calls.length).toBe(n + 1);
    solo.loop.stop();
    solo.video.halt();
    const group = setup({ facing: 'environment', frame: whole, prefs: on });
    viewDetect(group.tracker!, () => xs);
    vi.advanceTimersByTime(500);
    group.video.currentTime += 1 / 30; // a frame newer than the last detection
    const m = group.tracker!.detectView.mock.calls.length;
    group.loop.capture();
    // both 0.4-wide faces are large: the whole view is the own view of each, run once
    expect(group.tracker!.detectView.mock.calls.length - m).toBe(1);
    expect((group.tracker!.detectView.mock.calls.at(-1)![0] as unknown as FakeView).width).toBe(1280);
    group.loop.stop();
  });
  it('K13 on the group path (round-1 review Codex #2, round-5 redesign): the shutter runs the cycle on the captured frame whatever its own call was, a scan or the whole view', () => {
    // the front camera on 1280 × 720: both 0.4-wide faces are large (the whole view refreshes them), and every fourth
    // call scans a 582 px tile instead, which holds one face at most
    const { tracker, loop } = setup({ frame: whole, prefs: on });
    viewDetect(tracker!, () => xs);
    const lastCall = () => tracker!.detectView.mock.calls.at(-1)![0] as unknown as FakeView;
    vi.advanceTimersByTime(300);
    let guard = 0;
    while (lastCall().width === 1280 && guard++ < 20) vi.advanceTimersByTime(33);
    expect(lastCall().width).toBe(582); // the frame's one call was a tile's scan
    const before = loop.tracks();
    expect(before.map((t) => t.edited)).toEqual([true, true]);
    const stale = before.filter((t) => t.seen < Math.max(...before.map((x) => x.seen)));
    expect(stale).toHaveLength(1); // the face the scan did not hold
    let n = tracker!.detectView.mock.calls.length;
    loop.capture(); // the same frame: its call ran, but one edited face's landmarks are older
    expect(tracker!.detectView.mock.calls.length - n).toBe(1);
    expect(lastCall().width).toBe(1280); // the refresh views: the whole view
    expect(loop.tracks().find((t) => t.id === stale[0].id)!.seen).toBeGreaterThan(stale[0].seen);
    guard = 0;
    do vi.advanceTimersByTime(33);
    while (lastCall().width !== 1280 && guard++ < 20);
    const fed = loop.tracks().map((t) => [t.id, t.person, t.present]);
    n = tracker!.detectView.mock.calls.length;
    loop.capture(); // the whole view's call on this frame refreshed both: the cycle runs all the same, the same answer
    expect(tracker!.detectView.mock.calls.length - n).toBe(1);
    expect(lastCall().width).toBe(1280);
    expect(loop.tracks().map((t) => [t.id, t.person, t.present])).toEqual(fed);
    loop.stop();
  });
  describe('K13 at the shutter (round-5 redesign: one complete refresh cycle on the captured frame, its answers one decision; round-2 review Codex #1, D7)', () => {
    // the front camera on 1280 × 720 over the whole frame: 582 px tiles at x 0 / 349 / 698, y 0 / 138; a face of radius
    // r (a fraction of the width, square in px) is small under 176 px (its own view a tile), large from it (the whole view)
    const W = 1280;
    const H = 720;
    /** `missedBy`: the rect of a view whose detection never finds this face (another view holding it does) */
    type Spot = { x: number; y: number; r: number; missedBy?: number[] };
    const T00 = [0, 0, 582, 582];
    const T20 = [698, 0, 582, 582];
    const WHOLE = [0, 0, W, H];
    /** each detectView call's source rect, read at call time (the tiles share one copy canvas per size) */
    let rects: number[][] = [];
    /** the rect of a view whose calls have no answer (null), else null */
    let failing: number[] | null = null;
    /** a view finds each face its copied rect holds whole; the whole view only faces at least 150 px wide (its floor) */
    function spots(t: FakeTracker, faces: () => readonly Spot[]) {
      rects = [];
      failing = null;
      vi.mocked(adapt).mockImplementation((lm, w, h) => {
        const f = makeFace(++faceSeq, lm.points[0]);
        for (let i = 0; i < 36; i++) {
          f.oval[i * 2] = lm.points[0] + lm.points[2] * Math.cos((i / 36) * 2 * Math.PI);
          f.oval[i * 2 + 1] = lm.points[1] + lm.points[2] * (w / h) * Math.sin((i / 36) * 2 * Math.PI);
        }
        return f;
      });
      t.detectView.mockImplementation((img) => {
        const [sx, sy, sw, sh] = (img as unknown as FakeView).src;
        rects.push([sx, sy, sw, sh]);
        if (t.unusable || failing?.join() === [sx, sy, sw, sh].join()) return null;
        const whole = sw === W && sh === H;
        return faces()
          .filter((f) => (f.x - f.r) * W >= sx && (f.x + f.r) * W <= sx + sw && f.y * H - f.r * W >= sy && f.y * H + f.r * W <= sy + sh)
          .filter((f) => (!whole || 2 * f.r * W >= 150) && f.missedBy?.join() !== [sx, sy, sw, sh].join())
          .map((f) => {
            const l = makeLandmarks();
            l.points.set([(f.x * W - sx) / sw, (f.y * H - sy) / sh, (f.r * W) / sw], 0);
            return l;
          });
      });
    }
    const srcs = (t: FakeTracker, from: number) => (expect(rects).toHaveLength(t.detectView.mock.calls.length), rects.slice(from));
    const lastSrc = (t: FakeTracker) => srcs(t, t.detectView.mock.calls.length - 1)[0];
    /** frames until the frame's one call was the view at `src` */
    function until(t: FakeTracker, src: number[]) {
      for (let guard = 0; guard < 40; guard++) {
        vi.advanceTimersByTime(33);
        if (lastSrc(t).join() === src.join()) return;
      }
      throw new Error(`no call on ${src.join()}`);
    }
    const centreX = (b: Rect) => b.x + b.w / 2;
    function scene(faces: () => readonly Spot[]) {
      const persons = new LivePersons();
      const s = setup({ frame: whole, prefs: on, persons });
      spots(s.tracker!, faces);
      vi.advanceTimersByTime(3000); // the scans find the small faces
      const at = (x: number) => s.loop.tracks().find((v) => Math.abs(centreX(v.box) - x) < 0.02);
      const edit = (x: number) => {
        s.loop.select(at(x)!.person);
        persons.edit(naturalPerson());
      };
      /** the last shot's render input for the track at x (by its shown face): [weight, presence, params]; null: not drawn */
      const drawn = (x: number) => {
        const v = at(x);
        const f = s.engine.renderToImageData.mock.calls.at(-1)![0].faces.find((d) => d.face === v?.face);
        return f ? [f.weight, f.presence, f.person] : null;
      };
      return { ...s, persons, at, edit, drawn };
    }
    it('Codex #1: a never-edited face found at the shutter (a blocker) whose own tile has not answered on the frame is refreshed there', () => {
      let b: Spot = { x: 0.85, y: 0.3, r: 0.03 };
      const { tracker, loop, at, edit } = scene(() => [{ x: 0.15, y: 0.3, r: 0.03 }, b]);
      expect(loop.tracks()).toHaveLength(2);
      edit(0.15); // A edited and selected; B, never tapped, goes as a blocker (params null)
      until(tracker!, T00); // the frame's call refreshed A only
      b = { ...b, x: 0.84 }; // B moved meanwhile
      const blocker = at(0.85)!;
      expect(blocker.seen).toBeLessThan(at(0.15)!.seen);
      const n = tracker!.detectView.mock.calls.length;
      const shot = loop.capture()!;
      expect(srcs(tracker!, n)).toEqual([WHOLE, T00, T20]); // the cycle: the whole view, then A's tile and B's
      const handed = shot.persons.find((p) => p.params === null)!;
      expect(centreX(handed.rawBox)).toBeCloseTo(0.84, 6); // the blocker's box is the captured frame's
      expect(handed.held).toBe(false);
      loop.stop();
    });
    it('the whole cycle runs, each view once, whatever answered on the frame: an answer on the same pixels changes nobody (round-2 review D10’s skip removed)', () => {
      let faces: Spot[] = [
        { x: 0.15, y: 0.3, r: 0.03 }, // A: small, t0,0's
        { x: 0.6, y: 0.6, r: 0.1 }, // B: large, the whole view's
      ];
      const { tracker, loop, at, edit } = scene(() => faces);
      edit(0.6);
      edit(0.15);
      expect([at(0.15)!.edited, at(0.6)!.edited]).toEqual([true, true]);
      const who = () => loop.tracks().map((v) => [v.id, v.person, v.present, v.stale]);
      for (const frame of [T00, WHOLE]) {
        until(tracker!, frame);
        const before = who();
        const n = tracker!.detectView.mock.calls.length;
        const shot = loop.capture()!;
        expect(srcs(tracker!, n)).toEqual([WHOLE, T00]);
        expect(who()).toEqual(before);
        expect(shot.persons.map((p) => [p.held, p.stale])).toEqual([
          [false, false],
          [false, false],
        ]);
      }
      // A leaves: held, missed by its own tile again at the shutter
      faces = [faces[1]];
      until(tracker!, T00);
      if (at(0.15)?.present !== false) until(tracker!, T00);
      expect(at(0.15)!.present).toBe(false);
      const n = tracker!.detectView.mock.calls.length;
      const shot = loop.capture()!;
      expect(srcs(tracker!, n)).toEqual([WHOLE, T00]);
      expect(shot.persons.map((p) => p.held).sort()).toEqual([false, true]);
      loop.stop();
    });
    it('a face its own tile misses on the frame is asked of the other tile of the cycle that holds it, which finds it (the e2e far10 clip: one tile’s detection can miss a face an overlapping tile finds)', () => {
      const T01 = [0, 138, 582, 582];
      // C: own view t0,0 (nearer centre), held by t0,1 too, never found by t0,0; D: own view t0,1, held by both
      const { tracker, loop, at, edit } = scene(() => [
        { x: 0.15, y: 0.45, r: 0.03, missedBy: T00 },
        { x: 0.3, y: 0.6, r: 0.03 },
      ]);
      expect(loop.tracks()).toHaveLength(2);
      edit(0.15);
      until(tracker!, T00); // the frame's call: t0,0 found D, missed C
      expect([at(0.15)!.present, at(0.3)!.present]).toEqual([false, true]);
      const n = tracker!.detectView.mock.calls.length;
      const shot = loop.capture()!;
      expect(srcs(tracker!, n)).toEqual([WHOLE, T00, T01]);
      expect(at(0.15)!.present).toBe(true);
      expect(shot.persons.find((p) => p.params !== null)!.held).toBe(false);
      loop.stop();
    });
    it('a handed track past the hold that its own tile misses at the shutter is found by another tile of the cycle: kept, the same person, handed over', () => {
      const T01 = [0, 138, 582, 582];
      let faces: Spot[] = [
        { x: 0.15, y: 0.45, r: 0.03, missedBy: T00 }, // C: own view t0,0, found by t0,1 only
        { x: 0.3, y: 0.6, r: 0.03 }, // D: own view t0,1 (keeps t0,1 in the cycle), never edited
      ];
      const { tracker, loop, video, at, edit } = scene(() => faces);
      edit(0.15);
      const c = at(0.15)!.person;
      faces = [faces[0]]; // D leaves: held, not handed over
      until(tracker!, T01);
      expect(at(0.3)!.present).toBe(false);
      video.currentTime += 1.5; // the shutter's frame 1.5 s on: C's track is past the hold for t0,0, which misses C
      const n = tracker!.detectView.mock.calls.length;
      const shot = loop.capture()!;
      expect(srcs(tracker!, n)).toEqual([WHOLE, T00, T01]);
      expect(loop.tracks().map((t) => [t.person, t.present])).toEqual([[c, true]]);
      expect(shot.persons.map((p) => [p.params !== null, p.held])).toEqual([[true, false]]);
      loop.stop();
    });
    it('every view of the cycle that can refresh a handed face runs, not only the first that feeds them all: a face only a later tile finds is in the shot (the e2e far10 clip)', () => {
      const T01 = [0, 138, 582, 582];
      let faces: Spot[] = [
        { x: 0.15, y: 0.45, r: 0.03 }, // A: edited, own view t0,0, held by t0,1 too
        { x: 0.3, y: 0.6, r: 0.03 }, // D: own view t0,1 (keeps it in the cycle), held by t0,0 too
      ];
      const { tracker, loop, video, at, edit } = scene(() => faces);
      edit(0.15);
      // X, beside A, which t0,0 never finds: on the shutter's frame (newer than the last detection) only t0,1 finds it
      faces = [...faces, { x: 0.22, y: 0.45, r: 0.03, missedBy: T00 }];
      video.currentTime += 1 / 30;
      const n = tracker!.detectView.mock.calls.length;
      const shot = loop.capture()!;
      expect(srcs(tracker!, n)).toEqual([WHOLE, T00, T01]); // t0,0 found A and D; t0,1 runs all the same
      expect(at(0.22)?.present).toBe(true);
      expect(shot.persons).toHaveLength(3);
      loop.stop();
    });
    it('D7: a no-answer on the frame answered for nobody: the views are asked again at the shutter', () => {
      const { tracker, loop, edit } = scene(() => [
        { x: 0.15, y: 0.3, r: 0.03 },
        { x: 0.6, y: 0.6, r: 0.1 },
      ]);
      edit(0.15);
      until(tracker!, T00);
      tracker!.unusable = true;
      vi.advanceTimersByTime(33); // this frame's call has no answer: it answers for nobody, what it could miss unseen since
      let n = tracker!.detectView.mock.calls.length;
      let shot = loop.capture()!;
      // the cycle asked once, and no answer still: unseen is not missing, so neither goes held (D7); both go stale,
      // their boxes not the captured frame's (round 3, E5): B unseen since the frame's whole-view call, A found before it
      expect(srcs(tracker!, n)).toEqual([WHOLE, T00]);
      expect(shot.persons.map((p) => [p.params !== null, p.held, p.stale]).sort()).toEqual([
        [false, false, true],
        [true, false, true],
      ]);
      tracker!.unusable = false;
      n = tracker!.detectView.mock.calls.length;
      shot = loop.capture()!;
      expect(srcs(tracker!, n)).toEqual([WHOLE, T00]);
      expect(loop.tracks().every((v) => v.present)).toBe(true);
      loop.stop();
    });
    it.each([
      // A (edited) t0,0's and B (never edited) the whole view's
      ['A small and B large', { x: 0.15, y: 0.3, r: 0.03 }, { x: 0.6, y: 0.6, r: 0.1 }, [WHOLE, T00]],
      // A (edited) inside t0,0 and t0,1, its own view t0,0; E (never edited) t0,1's only
      ['A in two tiles and E in one', { x: 0.15, y: 0.45, r: 0.03 }, { x: 0.25, y: 0.85, r: 0.03 }, [WHOLE, T00, [0, 138, 582, 582]]],
    ] as const)(
      'round-4 review F3, round-5 redesign: the shutter’s views without an answer (%s) are no event: A, found on the captured frame by its own tile, goes over as found; the other face, found before it, as stale, its track as it was',
      (_, a, other, views) => {
        const { tracker, loop, at, edit } = scene(() => [a, other]);
        expect(loop.tracks()).toHaveLength(2);
        edit(a.x);
        until(tracker!, T00); // the frame's call fed A only
        expect(at(other.x)!.seen).toBeLessThan(at(a.x)!.seen);
        const before = at(other.x)!;
        tracker!.unusable = true; // the shutter's calls have no answer (a throw is reported and is one too)
        const n = tracker!.detectView.mock.calls.length;
        const shot = loop.capture()!;
        expect(srcs(tracker!, n)).toEqual(views);
        expect(shot.persons.map((p) => [p.params !== null, p.held, p.stale]).sort()).toEqual([
          [false, false, true],
          [true, false, false],
        ]);
        expect([at(a.x)!.present, at(other.x)!.present, at(other.x)!.stale, at(other.x)!.seen]).toEqual([true, true, false, before.seen]);
        loop.stop();
      },
    );
    it.each([
      ['a frame newer than the last detection', true],
      ['the frame whose own call had no answer', false],
    ] as const)(
      'round-4 review Codex P2: with no track to refresh, %s still gets the whole view at the shutter: an edited person back within the grace is in the shot',
      (_, newer) => {
        const B: Spot = { x: 0.6, y: 0.6, r: 0.1 }; // large: the whole view's
        let faces: Spot[] = [B];
        const { tracker, loop, video, at, edit } = scene(() => faces);
        edit(0.6);
        const b = at(0.6)!.person;
        faces = [];
        vi.advanceTimersByTime(LOST_HOLD_MS + 500); // B missed past the hold: the track is dropped, B away (edited, in grace)
        expect(loop.tracks()).toHaveLength(0);
        // B still away: the cycle of B's last box, the whole view, finds nobody
        let n = tracker!.detectView.mock.calls.length;
        expect(loop.capture()!.persons).toEqual([]);
        expect(srcs(tracker!, n)).toEqual([WHOLE]);
        if (newer) video.currentTime += 1 / 30;
        else {
          tracker!.unusable = true;
          vi.advanceTimersByTime(33); // the frame's one call has no answer
          tracker!.unusable = false;
        }
        faces = [B]; // B back just before the shutter
        n = tracker!.detectView.mock.calls.length;
        const shot = loop.capture()!;
        expect(srcs(tracker!, n)).toEqual([WHOLE]);
        expect(loop.tracks().map((v) => [v.person, v.present])).toEqual([[b, true]]);
        expect(shot.persons.map((p) => [p.params, p.held, p.stale])).toEqual([[naturalPerson(), false, false]]);
        loop.stop();
      },
    );
    it('round-3 review E5: a face missing before a no-answer stays known missing at the shutter: the edited one goes held, the never-edited one is not handed over', () => {
      let faces: Spot[] = [
        { x: 0.15, y: 0.3, r: 0.03 }, // A: edited, t0,0's
        { x: 0.6, y: 0.6, r: 0.1 }, // B: never edited, the whole view's
      ];
      const { tracker, loop, at, edit } = scene(() => faces);
      edit(0.15);
      faces = []; // both leave: each missed by its own view's next call
      until(tracker!, T00);
      until(tracker!, WHOLE);
      const state = () => [at(0.15)!, at(0.6)!].map((v) => [v.present, v.stale]);
      expect(state()).toEqual([
        [false, false],
        [false, false],
      ]);
      tracker!.unusable = true;
      vi.advanceTimersByTime(33); // the frame's call has no answer
      expect(state()).toEqual([
        [false, false],
        [false, false],
      ]);
      const shot = loop.capture()!; // the shutter's calls have none either
      expect(shot.persons.map((p) => [p.params !== null, p.held, p.stale])).toEqual([[true, true, false]]);
      loop.stop();
    });
    it.each([
      // B large (256 px), the whole view's; C small, never edited, t0,0's: round 4 ran t0,0 only (C's view)
      ['large, the whole view’s', { x: 0.75, y: 0.6, r: 0.1 }, [WHOLE, T00]],
      // B small, t2,0's (under the whole view's floor): only the view of B's last box finds B
      ['small, a tile’s only', { x: 0.85, y: 0.3, r: 0.03 }, [WHOLE, T00, T20]],
    ] as const)(
      'round-5 review G1: on a frame newer than the last detection, an edited person back within the grace (%s) beside a tracked never-edited face is in the shot, drawn adjusted (round-6 review H1)',
      (_, B, views) => {
        const C: Spot = { x: 0.15, y: 0.3, r: 0.03 };
        let faces: Spot[] = [C, B];
        const { tracker, loop, video, at, edit, drawn } = scene(() => faces);
        expect(loop.tracks()).toHaveLength(2);
        edit(B.x);
        const b = at(B.x)!.person;
        faces = [C];
        vi.advanceTimersByTime(LOST_HOLD_MS + 500); // B missed past the hold: dropped, away (edited, in grace)
        expect(loop.tracks().map((v) => v.person)).not.toContain(b);
        video.currentTime += 1 / 30; // the captured frame is newer than the last detection
        faces = [C, B]; // B back just before the shutter
        const n = tracker!.detectView.mock.calls.length;
        const shot = loop.capture()!;
        expect(srcs(tracker!, n)).toEqual(views);
        expect(at(B.x)?.person).toBe(b);
        expect(shot.persons.map((p) => [p.params !== null, p.held, p.stale]).sort()).toEqual([
          [false, false, false],
          [true, false, false],
        ]);
        // U3: the photo draws B as 編輯 opens B, at weight 1 with B's params (their new track's easers are at 0), and C,
        // never edited, at 原圖 bounding B's cap in full
        expect(drawn(B.x)).toEqual([1, 1, naturalPerson()]);
        expect(drawn(C.x)).toEqual([0, 1, neutralPerson()]);
        expect([at(B.x)!.weight, at(B.x)!.presence]).toEqual([0, 0]); // the preview's easing is the preview's
        loop.stop();
      },
    );
    it.each([
      ['on the frame t0,0’s call fed A on', false, true],
      ['on a frame newer than the last detection', true, true],
      ['A never edited (a blocker), on the frame t0,0’s call fed A on', false, false],
    ] as const)(
      'round-5 review G2, Codex P2: t0,1, in the cycle for E, finds no face where A is; t0,0 finds A at the shutter too (%s): A goes over found',
      (_, newer, editA) => {
        const A: Spot = { x: 0.15, y: 0.45, r: 0.03, missedBy: [0, 138, 582, 582] }; // own view t0,0, inside t0,1 too
        const E: Spot = { x: 0.25, y: 0.85, r: 0.03 }; // t0,1's only
        const { tracker, loop, video, at, edit } = scene(() => [A, E]);
        expect(loop.tracks()).toHaveLength(2);
        edit(editA ? A.x : E.x);
        until(tracker!, T00); // the frame's call fed A
        if (newer) video.currentTime += 1 / 30;
        const n = tracker!.detectView.mock.calls.length;
        const shot = loop.capture()!;
        expect(srcs(tracker!, n)).toEqual([WHOLE, T00, [0, 138, 582, 582]]);
        expect(at(A.x)!.present).toBe(true);
        expect(shot.persons.map((p) => [p.params !== null, p.held, p.stale]).sort()).toEqual([
          [false, false, false],
          [true, false, false],
        ]);
        loop.stop();
      },
    );
    describe('round-6 review H1, U3: the shot draws every face found at the shutter as it hands it over, whatever the preview’s easing had reached', () => {
      it('an edited person held, then found again by the shutter’s cycle: weight 1 with their params (their easers had eased out); held at the shutter, at the eased weight', () => {
        const A: Spot = { x: 0.15, y: 0.3, r: 0.03 }; // small, t0,0's, edited
        const B: Spot = { x: 0.6, y: 0.6, r: 0.1 }; // large, never edited
        let faces: Spot[] = [A, B];
        const { tracker, loop, video, at, edit, drawn, engine } = scene(() => faces);
        edit(A.x);
        faces = [B]; // A looks down: missed by t0,0's next call, held
        until(tracker!, T00);
        expect(at(A.x)!.present).toBe(false);
        loop.capture(); // A still missing at the shutter: held, drawn at its eased weight and presence, as v0.5
        const eased = at(A.x)!;
        expect(eased.weight).toBeGreaterThan(0);
        expect(eased.weight).toBeLessThan(1);
        expect(drawn(A.x)).toEqual([eased.weight, eased.presence, naturalPerson()]);
        vi.advanceTimersByTime(400); // A's easers out to 0
        expect([at(A.x)!.present, at(A.x)!.weight, at(A.x)!.presence]).toEqual([false, 0, 0]);
        faces = [A, B]; // A looks back up, and the user taps
        video.currentTime += 1 / 30;
        const shot = loop.capture()!;
        expect(shot.persons.find((p) => p.params !== null)).toMatchObject({ held: false, stale: false });
        expect(drawn(A.x)).toEqual([1, 1, naturalPerson()]);
        expect(drawn(B.x)).toEqual([0, 1, neutralPerson()]);
        expect(engine.renderToImageData.mock.calls.at(-1)![0].globalSkin!.weight).toBe(0);
        expect([at(A.x)!.weight, at(A.x)!.presence]).toEqual([0, 0]);
        loop.stop();
      });
      it('an edited person the loop re-identified within FACE_EASE_MS before the tap: weight 1, not part-way', () => {
        const C: Spot = { x: 0.6, y: 0.6, r: 0.1 }; // large, the whole view's, edited
        let faces: Spot[] = [C];
        const { loop, video, at, edit, drawn } = scene(() => faces);
        edit(C.x);
        faces = [];
        vi.advanceTimersByTime(LOST_HOLD_MS + 500); // dropped, away
        faces = [C];
        vi.advanceTimersByTime(66); // the loop re-identifies C on its whole-view call
        expect(at(C.x)!.weight).toBeGreaterThan(0);
        expect(at(C.x)!.weight).toBeLessThan(1);
        video.currentTime += 1 / 30;
        loop.capture();
        expect(drawn(C.x)).toEqual([1, 1, naturalPerson()]);
        loop.stop();
      });
      it('全部套用: a newcomer the shutter’s cycle finds is drawn with the look, at weight 1', () => {
        const C: Spot = { x: 0.15, y: 0.3, r: 0.03 };
        const N: Spot = { x: 0.6, y: 0.6, r: 0.1 }; // large: the whole view finds it
        let faces: Spot[] = [C];
        const { loop, video, persons, at, drawn } = scene(() => faces);
        persons.setAll(true);
        persons.edit(naturalPerson());
        faces = [C, N]; // N steps in just before the shutter
        video.currentTime += 1 / 30;
        loop.capture();
        expect(at(N.x)!.edited).toBe(true);
        expect(drawn(N.x)).toEqual([1, 1, naturalPerson()]);
        expect(drawn(C.x)![0]).toBe(1);
        loop.stop();
      });
    });
    it('round-5 review G5: in the loop, a whole-view call without an answer on a later frame leaves a small face its tile fed before found: a no-answer marks unseen only what its view could miss', () => {
      const A: Spot = { x: 0.15, y: 0.3, r: 0.03 }; // small, t0,0's: the whole view cannot miss it
      const B: Spot = { x: 0.6, y: 0.6, r: 0.1 }; // large, the whole view's
      const { tracker, loop, at, edit } = scene(() => [A, B]);
      edit(0.15);
      until(tracker!, T00); // A fed on this frame
      const fed = at(A.x)!.seen;
      failing = WHOLE; // the whole view's calls have no answer from now on (its copy cannot be made, say)
      until(tracker!, WHOLE); // a later frame's whole-view call
      expect(at(A.x)!.seen).toBe(fed);
      expect([at(A.x)!.present, at(A.x)!.stale]).toEqual([true, false]);
      expect([at(B.x)!.present, at(B.x)!.stale]).toEqual([false, true]); // B, which it could miss, is unseen
      loop.stop();
    });
    it('round-5 review G4: in the loop, a view that keeps failing pauses no hold but those of what it could miss: an edited face that left elsewhere drops on time', () => {
      let faces: Spot[] = [
        { x: 0.15, y: 0.3, r: 0.03 }, // A: t0,0's
        { x: 0.85, y: 0.3, r: 0.03 }, // H: t2,0's
      ];
      const { tracker, loop, at, edit } = scene(() => faces);
      edit(0.85);
      until(tracker!, T20); // H's last sighting
      const h = at(0.85)!.id;
      faces = [faces[0]]; // H leaves
      failing = WHOLE; // and every whole-view call from now on has no answer
      let ms = 0;
      while (loop.tracks().some((v) => v.id === h) && ms < 3000) {
        vi.advanceTimersByTime(33);
        ms += 33;
      }
      // H is dropped by the first call past LOST_HOLD_MS from its last sighting: each whole-view gap paused every hold
      // before, and H went about a third later
      expect(ms).toBeGreaterThan(LOST_HOLD_MS - 100);
      expect(ms).toBeLessThan(LOST_HOLD_MS + 150);
      loop.stop();
    });
  });
  it('C6: 合照模式 on, a face the crop’s top edge cuts from the first frame gets a track (the whole view starts it)', () => {
    // the crop y 0.35–0.95 of 1280 × 720; the face's box is y 0.3–0.7, so the crop's top edge cuts it
    const { tracker, loop } = setup({ frame: () => ({ x: 0, y: 0.35, w: 1, h: 0.6 }), prefs: on });
    tracker!.detectView.mockImplementation((img) => ((img as unknown as FakeView).width === 1280 ? [lmX(0.5)] : []));
    vi.advanceTimersByTime(500);
    expect(loop.tracks().map((t) => [t.present, t.view])).toEqual([[true, 'whole']]);
    loop.stop();
  });
  it('C17: the view copies are released (0 × 0) when 合照模式 is turned off, when the views change (a ratio) and on stop', () => {
    let frame = whole();
    const { tracker, loop, setPrefs } = setup({ facing: 'environment', frame: () => frame, prefs: on });
    viewDetect(tracker!, () => xs);
    const released = (list: FakeView[]) => list.length > 0 && list.every((c) => c.width === 0 && c.height === 0);
    const since = (n: number) => FakeView.made.slice(n);
    vi.advanceTimersByTime(500);
    const first = since(0);
    expect(first.length).toBeGreaterThanOrEqual(2); // the whole view and a scanned tile
    setPrefs({ groupMode: false });
    vi.advanceTimersByTime(34);
    expect(released(first)).toBe(true);
    let n = FakeView.made.length;
    setPrefs({ groupMode: true });
    vi.advanceTimersByTime(500);
    const second = since(n);
    frame = normalizedCropRect(1280, 720, 3 / 4);
    vi.advanceTimersByTime(34);
    expect(released(second)).toBe(true);
    n = FakeView.made.length;
    vi.advanceTimersByTime(500);
    const third = since(n);
    loop.stop();
    expect(released(third)).toBe(true);
  });
  it('Review Focus #2: a ratio change on the group path drops the faces outside the new crop within LOST_HOLD_MS and keeps the others', () => {
    let frame = whole();
    const { tracker, loop } = setup({ facing: 'environment', frame: () => frame, prefs: on });
    xs = [0.25, 0.5];
    viewDetect(tracker!, () => xs);
    vi.advanceTimersByTime(500);
    const keep = loop.tracks().find((t) => Math.abs(t.box.x + t.box.w / 2 - 0.5) < 0.02)!.person;
    frame = normalizedCropRect(1280, 720, 3 / 4); // x 0.289–0.711: the 0.25 face is cut, the 0.5 face inside
    vi.advanceTimersByTime(LOST_HOLD_MS + 300);
    expect(loop.tracks().map((t) => t.person)).toEqual([keep]);
    loop.stop();
  });
  it('Review Focus #4: an IMAGE call that throws, then no answer (null: an instance being replaced, the rebuild throttle), holds every track, person and the pin; drawing goes on; detection resumes on the same persons', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { tracker, engine, loop } = setup({ facing: 'environment', frame: whole, prefs: on });
    viewDetect(tracker!, () => xs);
    vi.advanceTimersByTime(500);
    const before = loop.tracks().map((t) => t.person).sort();
    loop.select(before[1]);
    tracker!.detectView.mockImplementation(() => {
      throw new Error('graph');
    });
    const r = engine.render.mock.calls.length;
    vi.advanceTimersByTime(2000);
    expect(engine.render.mock.calls.length - r).toBeGreaterThanOrEqual(60);
    expect(loop.tracks().map((t) => t.person).sort()).toEqual(before);
    expect(loop.selection()).toBe(before[1]);
    tracker!.detectView.mockImplementation(() => null);
    vi.advanceTimersByTime(2000);
    expect(loop.tracks().map((t) => t.person).sort()).toEqual(before);
    expect(loop.selection()).toBe(before[1]);
    viewDetect(tracker!, () => xs);
    vi.advanceTimersByTime(300);
    expect(loop.tracks().map((t) => t.person).sort()).toEqual(before);
    expect(loop.tracks().every((t) => t.present)).toBe(true);
    loop.stop();
  });
});

describe('live loop on face tracks (S §3.3 Live camera, §3.4 T4)', () => {
  it('LiveStats.faces counts the shown tracks', () => {
    const { stats, loop } = setup({ faces: 2 }); // VIDEO detections, 合照模式 off (the group path is tested above)
    vi.advanceTimersByTime(600);
    expect(stats.at(-1)!.faces).toBe(2);
    loop.stop();
  });
  it('LiveStats.gpLeftOnLeft follows the tracked face: upright true, turned upside down false, emitted at once (S5 §3.4)', () => {
    // the mocked adapt: points[1] = 1 marks a face turned upside down (its GPUPixel-left eye p74 right of p77)
    const orig = vi.mocked(adapt).getMockImplementation()!;
    vi.mocked(adapt).mockImplementation((lm) => {
      const f = makeFace(++faceSeq, 0.25);
      const turned = lm.points[1] === 1;
      f.pts111.set(turned ? [0.3, 0.6] : [0.2, 0.4], 74 * 2);
      f.pts111.set(turned ? [0.2, 0.6] : [0.3, 0.4], 77 * 2);
      return f;
    });
    try {
      const { stats, loop, tracker } = setup();
      let turned = false;
      tracker!.detectVideo.mockImplementation(() => {
        const l = makeLandmarks();
        if (turned) l.points[1] = 1;
        return [l];
      });
      vi.advanceTimersByTime(600);
      expect(stats.at(-1)!.gpLeftOnLeft).toBe(true);
      turned = true;
      const n = stats.length;
      vi.advanceTimersByTime(600);
      // emitted as soon as it changed (no 250 ms throttle), then held
      expect(stats.slice(n).some((s) => s.gpLeftOnLeft === false)).toBe(true);
      expect(stats.at(-1)!.gpLeftOnLeft).toBe(false);
      loop.stop();
    } finally {
      vi.mocked(adapt).mockImplementation(orig);
    }
  });
});

describe('調節 and 質感 in the live loop (step-2 spec §2.3, §4.4–4.5)', () => {
  const lookWith = (photo: Partial<CameraLook['photo']> = {}): CameraLook => ({
    photo: { ...defaultPhoto(), ...photo },
    person: naturalPerson(),
  });

  it('reads the picture frame every frame; the grain seed advances once per drawn frame, not on redraw; capture uses it', () => {
    const clock = installWorkClock();
    const video = new FakeVideo();
    const engine = fakeEngine(clock);
    let frame: Rect = { x: 0.25, y: 0, w: 0.5, h: 1 };
    const look = lookWith();
    const loop = startLiveLoop({
      camera: fakeCamera(video),
      engine,
      tracker: null,
      persons: new LivePersons(),
      getPhoto: () => look.photo,
      getPrefs: () => makePrefs(),
      getFrame: () => frame,
    });
    video.play();
    vi.advanceTimersByTime(33 * 4 + 1);
    const seeds = engine.render.mock.calls.map(([i]) => i.grainSeed!);
    expect(seeds.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < seeds.length; i++) expect(seeds[i]).toBe(seeds[i - 1] + 1);
    expect(engine.lastInput()!.pictureFrame).toEqual(frame);
    frame = { x: 0, y: 0.2, w: 1, h: 0.6 }; // ratio change: the vignette follows at once
    vi.advanceTimersByTime(33);
    expect(engine.lastInput()!.pictureFrame).toEqual(frame);
    const seed = engine.lastInput()!.grainSeed;
    loop.setCompare(true);
    loop.setCompare(false); // a redraw of the same video frame keeps its grain
    expect(engine.lastInput()!.grainSeed).toBe(seed);
    expect(loop.capture()).not.toBeNull();
    const [shot] = engine.renderToImageData.mock.calls.at(-1)!;
    expect(shot.grainSeed).toBe(seed);
    expect(shot.pictureFrame).toEqual(frame);
    loop.stop();
  });

  it('requests the 質感 LUT with the 濾鏡 LUT, once each', () => {
    const clock = installWorkClock();
    const video = new FakeVideo();
    const engine = fakeEngine(clock);
    const look = lookWith({ filterId: 'warm', look: { id: 'ccd', amount: 0.8 } });
    const loop = startLiveLoop({ camera: fakeCamera(video), engine, tracker: null, persons: new LivePersons(), getPhoto: () => look.photo, getPrefs: () => makePrefs() });
    video.play();
    vi.advanceTimersByTime(33 * 5 + 1);
    expect(engine.loadLut.mock.calls.filter(([k, id]) => k === 'filter' && id === 'warm')).toHaveLength(1);
    expect(engine.loadLut.mock.calls.filter(([k, id]) => k === 'look' && id === 'ccd')).toHaveLength(1);
    loop.stop();
  });
});

describe('setRecordSink: the live loop feeds the beauty video’s recording (beauty-video spec §4.3)', () => {
  /** a RecordSink that logs its calls */
  const fakeSink = () => ({ frame: vi.fn<RecordSink['frame']>() });

  it('each frame after a beautified draw reaches the sink with the frame crop', () => {
    const crop = normalizedCropRect(1280, 720, 3 / 4);
    const { engine, loop } = setup({ frame: () => crop });
    const sink = fakeSink();
    loop.setRecordSink(sink);
    vi.advanceTimersByTime(33 * 5 + 1);
    expect(sink.frame).toHaveBeenCalledTimes(5);
    for (const [src, rect] of sink.frame.mock.calls) {
      expect(src).toBe(engine.canvas);
      expect(rect).toEqual(crop);
    }
    // each copy comes after its own frame's draw and before the next: the same task, the drawing buffer still valid
    const drawn = engine.render.mock.invocationCallOrder;
    sink.frame.mock.invocationCallOrder.forEach((copied, i) => {
      expect(copied).toBeGreaterThan(drawn[i]);
      expect(copied).toBeLessThan(drawn[i + 1] ?? Infinity);
    });
    loop.stop();
  });

  it('without a picture frame the whole frame goes to the sink', () => {
    const { loop } = setup();
    const sink = fakeSink();
    loop.setRecordSink(sink);
    vi.advanceTimersByTime(33 * 2 + 1);
    expect(sink.frame.mock.calls.map((c) => c[1])).toEqual([whole(), whole()]);
    loop.stop();
  });

  // the preview is always mirrored on the front camera: the recording is flipped back when a saved photo would not be
  const flips: [Facing, boolean, boolean][] = [
    ['user', false, true],
    ['user', true, false],
    ['environment', false, false],
    ['environment', true, false],
  ];
  it.each(flips)(
    'flipX only on the front camera with mirrorOnSave off: %s camera, mirrorOnSave %s → flipX %s',
    (facing, mirrorOnSave, flipX) => {
      const { loop } = setup({ tracker: false, facing, prefs: { mirrorOnSave } });
      const sink = fakeSink();
      loop.setRecordSink(sink);
      vi.advanceTimersByTime(33 * 3 + 1);
      expect(sink.frame.mock.calls.map((c) => c[2])).toEqual([flipX, flipX, flipX]);
      loop.stop();
    },
  );

  it('flipX is read on every frame: a pref or a camera flip changes the next frame', () => {
    const { camera, loop, setPrefs } = setup({ tracker: false });
    const sink = fakeSink();
    loop.setRecordSink(sink);
    vi.advanceTimersByTime(33 + 1);
    setPrefs({ mirrorOnSave: false });
    vi.advanceTimersByTime(33);
    camera.set({ facing: 'environment' });
    vi.advanceTimersByTime(33);
    expect(sink.frame.mock.calls.map((c) => c[2])).toEqual([false, true, false]);
    loop.stop();
  });

  it('no frame reaches the sink while 按住對比 holds; setRecordSink(null) stops it', () => {
    const { engine, loop } = setup();
    const sink = fakeSink();
    loop.setRecordSink(sink);
    vi.advanceTimersByTime(33 * 3 + 1);
    expect(sink.frame).toHaveBeenCalledTimes(3);
    loop.setCompare(true);
    vi.advanceTimersByTime(33 * 3);
    expect(sink.frame).toHaveBeenCalledTimes(3);
    // the toggle's redraw shows the beautified frame again at once; it is no new camera frame, so it is not recorded
    loop.setCompare(false);
    expect(engine.render).toHaveBeenCalledTimes(4);
    expect(sink.frame).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(33 * 2);
    expect(sink.frame).toHaveBeenCalledTimes(5);
    loop.setRecordSink(null);
    vi.advanceTimersByTime(33 * 3);
    expect(sink.frame).toHaveBeenCalledTimes(5);
    loop.stop();
  });

  it('a sink that throws is dropped, the preview goes on', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { engine, loop, stats } = setup();
    const sink = fakeSink();
    sink.frame.mockImplementation(() => {
      throw new Error('canvas gone');
    });
    loop.setRecordSink(sink);
    vi.advanceTimersByTime(33 + 1);
    // reported as the sink's own, and the frame it threw in ran to its end (its stats went out)
    expect(sink.frame).toHaveBeenCalledTimes(1);
    expect(dbg()?.lastError).toBe('live record: canvas gone');
    expect(stats).toHaveLength(1);
    vi.advanceTimersByTime(33 * 9);
    expect(engine.render).toHaveBeenCalledTimes(10);
    expect(sink.frame).toHaveBeenCalledTimes(1);
    expect(stats.length).toBeGreaterThan(1);
    loop.stop();
  });

  it('a lost engine’s frames do not reach the sink', () => {
    const { engine, loop } = setup();
    const sink = fakeSink();
    loop.setRecordSink(sink);
    vi.advanceTimersByTime(33 * 2 + 1);
    expect(sink.frame).toHaveBeenCalledTimes(2);
    // the context goes in the third frame's render, which then draws nothing: a copy of it would be a black frame
    // (the later frames are paused by the loop itself, as in 'does not render while the engine context is lost')
    engine.render.mockImplementationOnce((input) => {
      engine.lost = true;
      return { cpuMs: 0, width: input.width, height: input.height, passes: [] };
    });
    vi.advanceTimersByTime(33 * 5);
    expect(engine.render).toHaveBeenCalledTimes(3);
    expect(sink.frame).toHaveBeenCalledTimes(2);
    // back: the clip goes on with the next frame
    engine.lost = false;
    vi.advanceTimersByTime(33 * 2);
    expect(sink.frame).toHaveBeenCalledTimes(4);
    loop.stop();
  });

  it('the copy is not charged as render work: on frames that still come on time, it does not step the tier down', () => {
    const { clock, engine, loop } = setup({ engineTier: 'H' });
    engine.cost = 1;
    // 60 ms of copy per 33 ms frame, over the 40 ms budget were it counted in the frame's work. (A real copy that held
    // the main thread past a frame would still show as skipped frames; this fake clock delivers every frame.)
    loop.setRecordSink({ frame: () => clock.work(60) });
    vi.advanceTimersByTime(AUTO_TIER.warmupMs + AUTO_TIER.sustainMs + 1000);
    expect(dbg()?.renderMs).toBeCloseTo(1, 3);
    expect(engine.tier).toBe('H');
    expect(autoTierSession()).toBe('H');
    loop.stop();
  });
});
