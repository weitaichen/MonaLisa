import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EDIT_DETECT_FACES, LIVE_DETECT_FACES, LIVE_SOLO_AFTER_MS, LOST_HOLD_MS } from '../config/limits';
import { splitLegacy } from '../edit/legacy';
import { defaultPhoto, naturalPerson, neutralPerson } from '../edit/state';
import { applyPreset } from '../engine/params';
import { adapt } from '../tracking/adapter111';
import type { CameraLook, DebugState, Face, Facing, PersonParams, Prefs, Rect } from '../types';
import { normalizedCropRect } from '../ui/imaging';
import type { LiveTrackView } from './faceTracks';
import { AUTO_TIER, FACE_EASE_MS } from './liveCore';
import { LivePersons } from './livePersons';
import { type LiveDeps, type LiveStats, autoTierSession, liveFrame, resetAutoTierSession, startLiveLoop } from './live';
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
    /** LiveDeps.group */
    group?: boolean;
    /** the tracker's full-range detector is in before the loop starts */
    fullRange?: boolean;
  } = {},
) {
  const clock = installWorkClock();
  const video = new FakeVideo();
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
    group: opts.group,
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
  // the two-face tests run the group path off: they check the loop on persons over VIDEO detections, which the front
  // camera's second face would otherwise move to the group path (K18; its own describe below)
  it('each face renders its own person: the edited one at its params, the untouched one at 原圖 and weight 0', () => {
    const persons = fresh();
    const { engine, loop } = setup({ faces: 2, persons, group: false });
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
  });
  it('liveFrame orders present edited faces first, then present, then held, cut at MAX_RENDER_FACES', () => {
    const persons = fresh();
    const ids = Array.from({ length: 12 }, () => persons.claim({ x: 0.4, y: 0.4, w: 0.1, h: 0.1 }, 16 / 9, 0));
    persons.write(ids.filter((id) => id % 2 === 1), naturalPerson());
    const view = (id: number): LiveTrackView => ({
      id, person: id, box: { x: 0.4, y: 0.4, w: 0.1, h: 0.1 }, rawBox: { x: 0.4, y: 0.4, w: 0.1, h: 0.1 }, face: makeFace(id),
      weight: 0, presence: 1, edited: persons.edited(id), selected: false, present: id > 4, seen: 0, view: 'video',
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
    // the group path off: the back camera's stream stays on VIDEO, where the fake answers faces (the session is what
    // this checks; the group path's own back-camera start is tested below)
    const { camera, loop } = setup({ persons, group: false });
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
    const { loop } = setup({ faces: 2, persons, group: false });
    vi.advanceTimersByTime(600);
    const right = loop.tracks().find((t) => t.box.x > 0.5)!;
    expect(loop.hitTest(right.box.x + right.box.w / 2, 0.5, 0.01, 0.01)).toBe(right.person);
    loop.select(right.person);
    expect(loop.selection()).toBe(right.person);
    persons.edit(naturalPerson());
    vi.advanceTimersByTime(300);
    const shot = loop.capture()!;
    const now = loop.tracks().find((t) => t.person === right.person)!;
    expect(shot.seed).toEqual({ x: now.rawBox.x + now.rawBox.w / 2, y: now.rawBox.y + now.rawBox.h / 2 });
    expect(shot.persons).toEqual([{ rawBox: now.rawBox, params: naturalPerson() }]);
    persons.setAll(true);
    expect(loop.capture()!.seed).toBe('all');
    loop.stop();
  });
  it('debug: boxes carry c{n} and edited; selected is the target track; passes are the last frame’s; LiveStats.target is emitted at once', () => {
    const persons = fresh();
    const { loop, stats, engine } = setup({ faces: 2, persons, group: false });
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

/** OffscreenCanvas stand-in: drawImage records the source rect the loop copied */
class FakeView {
  src = [0, 0, 0, 0];
  constructor(
    public width: number,
    public height: number,
  ) {}
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

describe('the group path in the live loop (§6.3, §6.4, §6.6, K13, K18)', () => {
  let xs: number[];
  let orig: typeof adapt | undefined;
  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', FakeView);
    orig = vi.mocked(adapt).getMockImplementation();
    vi.mocked(adapt).mockImplementation((lm) => makeFace(++faceSeq, lm.points[0])); // a 0.4 × 0.4 face centred at (points[0], 0.5)
    xs = [0.25, 0.75];
  });
  afterEach(() => {
    vi.mocked(adapt).mockImplementation(orig!);
  });
  it('the back camera starts on the group path: IMAGE calls on the views at EDIT_DETECT_FACES with the full-range detector', () => {
    const { tracker, loop } = setup({ facing: 'environment', frame: whole, fullRange: true });
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
  it('the front camera: solo until a second face, then group; solo again LIVE_SOLO_AFTER_MS after the group thins to one; persons carry over', () => {
    const { tracker, loop } = setup({ frame: whole });
    xs = [0.25];
    tracker!.detectVideo.mockImplementation(() => xs.map(lmX));
    viewDetect(tracker!, () => xs);
    vi.advanceTimersByTime(500);
    expect([dbg()!.livePath, tracker!.detectView.mock.calls.length]).toEqual(['solo', 0]);
    const p = loop.tracks()[0].person;
    xs = [0.25, 0.75];
    vi.advanceTimersByTime(100);
    expect(dbg()!.livePath).toBe('group');
    expect(loop.tracks().some((t) => t.person === p)).toBe(true);
    xs = [0.25];
    vi.advanceTimersByTime(LIVE_SOLO_AFTER_MS + 500); // the 0.75 track drops after LOST_HOLD_MS, then the 5 s count
    expect(dbg()!.livePath).toBe('group');
    vi.advanceTimersByTime(1100);
    expect(dbg()!.livePath).toBe('solo');
    expect(loop.tracks().map((t) => t.person)).toEqual([p]);
    loop.stop();
  });
  it('the front camera: a second face the visible crop does not hold whole never starts the group path (A1, K18, §6.6); a crop that holds it does', () => {
    let frame = normalizedCropRect(1280, 720, 3 / 4); // x 0.289–0.711
    const { tracker, loop } = setup({ frame: () => frame });
    xs = [0.5, 0.1]; // the 0.5 face inside the crop; the 0.1 face (box x −0.1–0.3) outside it but for a sliver cut by its edge
    tracker!.detectVideo.mockImplementation(() => xs.map(lmX));
    viewDetect(tracker!, () => xs);
    const paths = new Set<string | undefined>();
    for (let t = 0; t < 10_000; t += 100) {
      vi.advanceTimersByTime(100);
      paths.add(dbg()!.livePath);
    }
    expect([...paths]).toEqual(['solo']);
    expect(tracker!.detectView).not.toHaveBeenCalled();
    expect(loop.tracks()).toHaveLength(2); // the solo path's VIDEO call still tracks both on the whole frame
    frame = whole();
    vi.advanceTimersByTime(100);
    expect(dbg()!.livePath).toBe('group');
    expect(loop.tracks()).toHaveLength(2);
    loop.stop();
  });
  it('one face never leaves the solo path (A1): detectVideo every frame with the camera bundle, never detectView', () => {
    const { tracker, loop } = setup();
    vi.advanceTimersByTime(33 * 300 + 1);
    expect(tracker!.detectVideo).toHaveBeenCalledTimes(300);
    expect(tracker!.detectVideo.mock.calls.every((c) => c[2].detector === 'camera' && c[2].maxFaces === LIVE_DETECT_FACES)).toBe(true);
    expect(tracker!.detectView).not.toHaveBeenCalled();
    loop.stop();
  });
  it('LIVE_GROUP off (deps.group false): option C, VIDEO on every facing with LIVE_DETECTOR’s bundle', () => {
    const back = setup({ facing: 'environment', group: false, fullRange: true });
    vi.advanceTimersByTime(200);
    expect(back.tracker!.detectVideo.mock.calls.at(-1)![2]).toEqual({ maxFaces: LIVE_DETECT_FACES, detector: 'photo' });
    expect(back.tracker!.detectView).not.toHaveBeenCalled();
    back.loop.stop();
    back.video.halt();
    const front = setup({ group: false });
    vi.advanceTimersByTime(200);
    expect(front.tracker!.detectVideo.mock.calls.at(-1)![2]).toEqual({ maxFaces: LIVE_DETECT_FACES, detector: 'camera' });
    front.loop.stop();
  });
  it('the detector is fixed per stream session: a full-range download landing mid-stream is used from the next session', () => {
    const { tracker, camera, loop } = setup({ facing: 'environment', frame: whole });
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
  it('cadence: two faces and a 64 ms detection skip frames (every 5 at R 5 ms); one face detects every frame', () => {
    const { tracker, engine, clock, loop } = setup({ facing: 'environment', frame: whole });
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
  it('K13: capture detects first when the last detection is older than the captured frame; on the group path, every refresh view', () => {
    const solo = setup({ prefs: { tier: 'L' } });
    vi.advanceTimersByTime(33 * 12 + 1); // frame 12 does not detect on tier L
    const n = solo.tracker!.detectVideo.mock.calls.length;
    solo.loop.capture();
    expect(solo.tracker!.detectVideo.mock.calls.length).toBe(n + 1);
    solo.loop.stop();
    solo.video.halt();
    const group = setup({ facing: 'environment', frame: whole });
    viewDetect(group.tracker!, () => xs);
    vi.advanceTimersByTime(500);
    group.video.currentTime += 1 / 30; // a frame newer than the last detection
    const m = group.tracker!.detectView.mock.calls.length;
    group.loop.capture();
    expect(group.tracker!.detectView.mock.calls.length - m).toBe(dbg()!.liveViews!.length);
    group.loop.stop();
  });
  it('Review Focus #2: a ratio change on the group path drops the faces outside the new crop within LOST_HOLD_MS and keeps the others', () => {
    let frame = whole();
    const { tracker, loop } = setup({ facing: 'environment', frame: () => frame });
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
    const { tracker, engine, loop } = setup({ facing: 'environment', frame: whole });
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
    const { stats, loop } = setup({ faces: 2, group: false }); // VIDEO detections (the group path is tested above)
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
