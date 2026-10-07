import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPreset } from '../engine/params';
import type { DebugState, Face, Prefs } from '../types';
import { AUTO_TIER, FACE_EASE_MS } from './liveCore';
import { type LiveDeps, type LiveStats, autoTierSession, resetAutoTierSession, startLiveLoop } from './live';
import {
  FakeVideo,
  fakeCamera,
  fakeEngine,
  fakeTracker,
  installWorkClock,
  makeFace,
  prefs as makePrefs,
  stubRaf,
} from './testFakes';

let faceSeq = 0;
vi.mock('../tracking/adapter111', () => ({
  adapt: vi.fn(() => makeFace(++faceSeq)),
}));

const params = applyPreset('natural');

function setup(opts: { prefs?: Partial<Prefs>; tracker?: boolean; engineTier?: 'H' | 'M' | 'L'; period?: number } = {}) {
  const clock = installWorkClock();
  const video = new FakeVideo();
  const camera = fakeCamera(video);
  const engine = fakeEngine(clock, opts.engineTier ?? 'M');
  const tracker = opts.tracker === false ? null : fakeTracker(clock);
  let p = makePrefs(opts.prefs);
  const stats: LiveStats[] = [];
  const deps: LiveDeps = {
    camera,
    engine,
    tracker,
    getParams: () => params,
    getPrefs: () => p,
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
    expect(input.params).toBe(params);
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
      getParams: () => p,
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
    expect(engine.lastInput()!.face).toBeNull();
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
    expect(engine.lastInput()!.faceWeight).toBe(1);
    camera.set({ state: 'interrupted' });
    camera.set({ state: 'live' });
    vi.advanceTimersByTime(33);
    expect(engine.lastInput()!.faceWeight).toBe(0);
    vi.advanceTimersByTime(33 * 6);
    expect(engine.lastInput()!.faceWeight).toBe(1);
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
      weights.push(engine.lastInput()!.faceWeight);
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
    const lastFace = engine.lastInput()!.face as Face;
    expect(lastFace).not.toBeNull();
    tracker!.face = false;
    vi.advanceTimersByTime(33);
    const a = engine.lastInput()!;
    expect(a.face).toBe(lastFace);
    expect(a.faceWeight).toBeGreaterThan(0);
    expect(a.faceWeight).toBeLessThan(1);
    vi.advanceTimersByTime(33 * 5);
    const b = engine.lastInput()!;
    expect(b.face).toBeNull();
    expect(b.faceWeight).toBe(0);
    expect(dbg()?.face).toBe(false);
    loop.stop();
  });

  it('基本模式 (no tracker): never a face, never detects', () => {
    const { engine, loop } = setup({ tracker: false });
    vi.advanceTimersByTime(33 * 10 + 1);
    expect(engine.render).toHaveBeenCalledTimes(10);
    expect(engine.render.mock.calls.every((c) => c[0].face === null && c[0].faceWeight === 0)).toBe(true);
    loop.stop();
  });
});

describe('tier L detection cadence', () => {
  it('detects every second frame and reuses the last landmarks in between', () => {
    const { engine, tracker, loop } = setup({ prefs: { tier: 'L' } });
    vi.advanceTimersByTime(33 * 20 + 1);
    expect(engine.render).toHaveBeenCalledTimes(20);
    expect(tracker!.detectVideo).toHaveBeenCalledTimes(10);
    const faces = engine.render.mock.calls.slice(10).map((c) => c[0].face);
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
    const img = loop.capture();
    expect(img).not.toBeNull();
    const [input, opts] = engine.renderToImageData.mock.calls[0];
    expect(input).toMatchObject({ width: 1280, height: 720, faceWeight: 1, params });
    expect(input.face).toBe(engine.lastInput()!.face);
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
