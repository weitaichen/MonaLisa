// Test doubles for the app-glue unit tests (never imported by app code).
import { vi } from 'vitest';
import type {
  CameraController,
  CameraSnapshot,
  CameraState,
  Engine,
  Face,
  Facing,
  Landmarks478,
  Prefs,
  RenderInput,
  Tier,
  Tracker,
} from '../types';

/** performance.now() = fake-timer clock + simulated synchronous work (`work(ms)`). */
export function installWorkClock() {
  const base = performance.now.bind(performance);
  let extra = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => base() + extra);
  return {
    work(ms: number) {
      extra += ms;
    },
  };
}

export function makeFace(tag = 0): Face {
  const pts111 = new Float32Array(222).fill(0.5);
  pts111[0] = tag;
  return { pts111, ext: new Float32Array(16), oval: new Float32Array(72), yaw: 0 };
}

export function makeLandmarks(): Landmarks478 {
  return { points: new Float32Array(478 * 3).fill(0.5) };
}

type FrameCb = (now: number, md: VideoFrameCallbackMetadata) => void;

/** Minimal HTMLVideoElement: rVFC callbacks driven by a fake-timer interval. */
export class FakeVideo {
  readyState = 4;
  videoWidth = 1280;
  videoHeight = 720;
  paused = false;
  currentTime = 0;
  presentedFrames = 0;
  /** frames per tick added to presentedFrames (2 = we "missed" one) */
  presentStep = 1;
  /** when true frames advance currentTime but no rVFC callback ever fires */
  rvfcSilent = false;
  private cbs = new Map<number, FrameCb>();
  private nextId = 1;
  private timer: ReturnType<typeof setInterval> | null = null;

  requestVideoFrameCallback(cb: FrameCb): number {
    const id = this.nextId++;
    this.cbs.set(id, cb);
    return id;
  }

  cancelVideoFrameCallback(id: number): void {
    this.cbs.delete(id);
  }

  get pending(): number {
    return this.cbs.size;
  }

  play(periodMs = 33): void {
    this.halt();
    this.timer = setInterval(() => this.present(periodMs), periodMs);
  }

  halt(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  present(periodMs = 33): void {
    this.presentedFrames += this.presentStep;
    this.currentTime += periodMs / 1000;
    if (this.rvfcSilent) return;
    const list = [...this.cbs.values()];
    this.cbs.clear();
    // frame timestamps follow the fake-timer clock only; simulated work shows up in performance.now()
    // differences (how the loop measures detect/render cost), not in the camera cadence
    const now = Date.now();
    for (const cb of list) {
      cb(now, {
        presentedFrames: this.presentedFrames,
        expectedDisplayTime: now,
        height: this.videoHeight,
        width: this.videoWidth,
        mediaTime: this.currentTime,
        presentationTime: now,
      });
    }
  }
}

export interface FakeEngine extends Engine {
  tier: Tier;
  lost: boolean;
  /** simulated CPU cost of each render() / renderOriginal() call, ms */
  cost: number;
  setTier: ReturnType<typeof vi.fn<(t: Tier) => void>>;
  setOptions: ReturnType<typeof vi.fn<Engine['setOptions']>>;
  loadFilter: ReturnType<typeof vi.fn<Engine['loadFilter']>>;
  render: ReturnType<typeof vi.fn<Engine['render']>>;
  renderToImageData: ReturnType<typeof vi.fn<Engine['renderToImageData']>>;
  renderOriginal: ReturnType<typeof vi.fn<Engine['renderOriginal']>>;
  /** last RenderInput passed to render() */
  lastInput(): RenderInput | undefined;
}

export function fakeEngine(clock?: { work(ms: number): void }, tier: Tier = 'M'): FakeEngine {
  const e = {
    // listeners only (webglcontextlost / restored); nothing draws to it
    canvas: new EventTarget() as unknown as HTMLCanvasElement,
    ready: Promise.resolve(),
    tier,
    lost: false,
    cost: 0,
    setTier: vi.fn((t: Tier) => {
      e.tier = t;
    }),
    setOptions: vi.fn(),
    loadFilter: vi.fn(() => Promise.resolve()),
    render: vi.fn((input: RenderInput) => {
      clock?.work(e.cost);
      return { cpuMs: e.cost, width: input.width, height: input.height, passes: [] };
    }),
    renderToImageData: vi.fn(
      (input: RenderInput) =>
        ({ width: input.width, height: input.height, data: new Uint8ClampedArray(4) }) as unknown as ImageData,
    ),
    renderOriginal: vi.fn(() => {
      clock?.work(e.cost);
    }),
    dispose: vi.fn(),
    lastInput(): RenderInput | undefined {
      const calls = e.render.mock.calls;
      return calls.length ? calls[calls.length - 1][0] : undefined;
    },
  };
  return e as unknown as FakeEngine;
}

export interface FakeCamera extends CameraController {
  set(patch: Partial<CameraSnapshot>): void;
  readonly listeners: number;
}

export function fakeCamera(video: FakeVideo, state: CameraState = 'live', facing: Facing = 'user'): FakeCamera {
  const subs = new Set<(s: CameraSnapshot) => void>();
  let snapshot: CameraSnapshot = { state, facing, error: null, width: video.videoWidth, height: video.videoHeight };
  const cam = {
    video: video as unknown as HTMLVideoElement,
    get snapshot() {
      return snapshot;
    },
    start: vi.fn(() => Promise.resolve()),
    resume: vi.fn(() => Promise.resolve()),
    flip: vi.fn(() => Promise.resolve()),
    stop: vi.fn(),
    // like the real controller (src/media/camera.ts): calls back immediately with the current snapshot
    subscribe(cb: (s: CameraSnapshot) => void) {
      subs.add(cb);
      cb(snapshot);
      return () => {
        subs.delete(cb);
      };
    },
    set(patch: Partial<CameraSnapshot>) {
      snapshot = { ...snapshot, ...patch };
      for (const cb of subs) cb(snapshot);
    },
    get listeners() {
      return subs.size;
    },
  };
  return cam as unknown as FakeCamera;
}

export interface FakeTracker extends Tracker {
  face: boolean;
  /** simulated cost of each detect call, ms */
  cost: number;
  detectVideo: ReturnType<typeof vi.fn<Tracker['detectVideo']>>;
  detectImage: ReturnType<typeof vi.fn<Tracker['detectImage']>>;
}

export function fakeTracker(clock?: { work(ms: number): void }, face = true): FakeTracker {
  const t = {
    delegate: 'GPU' as const,
    face,
    cost: 0,
    detectVideo: vi.fn(() => {
      clock?.work(t.cost);
      return t.face ? makeLandmarks() : null;
    }),
    detectImage: vi.fn(() => (t.face ? makeLandmarks() : null)),
    close: vi.fn(),
  };
  return t as unknown as FakeTracker;
}

export function prefs(over: Partial<Prefs> = {}): Prefs {
  return {
    mirrorOnSave: true,
    tier: 'auto',
    matchGpupixel: false,
    showLandmarks: false,
    delegate: 'auto',
    installHintDismissed: false,
    ...over,
  };
}

/** rAF on top of the fake setTimeout (Node has none). */
export function stubRaf() {
  let id = 0;
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const n = ++id;
    timers.set(
      n,
      setTimeout(() => {
        timers.delete(n);
        cb(performance.now());
      }, 16),
    );
    return n;
  });
  vi.stubGlobal('cancelAnimationFrame', (n: number) => {
    const t = timers.get(n);
    if (t) clearTimeout(t);
    timers.delete(n);
  });
  return { get pending() { return timers.size; } };
}
