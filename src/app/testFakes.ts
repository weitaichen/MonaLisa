// Test doubles for the app-glue unit tests (never imported by app code).
import { vi } from 'vitest';
import type {
  BodyDetection,
  BodyDetections,
  BodyField,
  BodyTracker,
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

/** the one face a v0.3-style render input carried (legacyFrame), or null */
export const faceOf = (i: RenderInput | undefined): Face | null => i?.faces[0]?.face ?? null;
/** its weight (0 without a face) */
export const weightOf = (i: RenderInput | undefined): number => i?.faces[0]?.weight ?? 0;

export function makeFace(tag = 0, cx = 0.5): Face {
  const pts111 = new Float32Array(222).fill(0.5);
  pts111[0] = tag;
  // a non-degenerate oval (radius 0.2 around (cx, 0.5)): prepareFaces keeps it
  const oval = new Float32Array(72);
  for (let i = 0; i < 36; i++) {
    oval[i * 2] = cx + 0.2 * Math.cos((i / 36) * 2 * Math.PI);
    oval[i * 2 + 1] = 0.5 + 0.2 * Math.sin((i / 36) * 2 * Math.PI);
  }
  return { pts111, ext: new Float32Array(16), oval, yaw: 0 };
}

/** `tag` lands in the first coordinate (0.5 + tag/1000), so a mocked adapt can tell results apart */
export function makeLandmarks(tag = 0): Landmarks478 {
  const points = new Float32Array(478 * 3).fill(0.5);
  points[0] = 0.5 + tag / 1000;
  return { points };
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
  /** faces per detection */
  count: number;
  /** detectVideo answers null (no answer) while set */
  unusable: boolean;
  /** simulated cost of each detect call, ms */
  cost: number;
  detectVideo: ReturnType<typeof vi.fn<Tracker['detectVideo']>>;
  detectImage: ReturnType<typeof vi.fn<Tracker['detectImage']>>;
}

export function fakeTracker(clock?: { work(ms: number): void }, face = true, count = 1): FakeTracker {
  const faces = () => Array.from({ length: t.count }, (_, i) => makeLandmarks(i));
  const t = {
    delegate: 'GPU' as const,
    face,
    count,
    unusable: false,
    cost: 0,
    detectVideo: vi.fn(() => {
      clock?.work(t.cost);
      if (t.unusable) return null;
      return t.face ? faces() : [];
    }),
    detectImage: vi.fn(() => (t.face ? faces() : [])),
    close: vi.fn(),
  };
  return t as unknown as FakeTracker;
}

/** A tiny 美體 field (4×2 RG texels, constant `dx`). */
export function makeBodyField(dx = 0.01, version = 1): BodyField {
  const data = new Float32Array(4 * 2 * 2);
  for (let i = 0; i < data.length; i += 2) data[i] = dx;
  return { width: 4, height: 2, data, version };
}

/** A centred standing person (BlazePose 33 layout, all visible), a 4×8 mask, `people` detected. */
export function makeBodyDetection(people = 1, width = 1536, height = 2048): BodyDetection {
  // [y, |x − 0.5|] per landmark: face 0–10, shoulders 11/12, elbows, wrists + hands, hips, knees, ankles, feet
  const Y = [0.1, 0.09, 0.09, 0.09, 0.09, 0.09, 0.09, 0.1, 0.1, 0.12, 0.12, 0.22, 0.22, 0.36, 0.36, 0.48, 0.48,
    0.5, 0.5, 0.5, 0.5, 0.49, 0.49, 0.52, 0.52, 0.72, 0.72, 0.9, 0.9, 0.92, 0.92, 0.93, 0.93];
  const X = [0, 0.01, 0.015, 0.02, 0.01, 0.015, 0.02, 0.03, 0.03, 0.01, 0.01, 0.09, 0.09, 0.11, 0.11, 0.12, 0.12,
    0.125, 0.125, 0.12, 0.12, 0.115, 0.115, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.06, 0.06];
  const points = new Float32Array(33 * 4);
  for (let i = 0; i < 33; i++) {
    // odd indices are the person's left side = image right (unmirrored)
    const side = i === 0 ? 0 : i % 2 === 1 ? 1 : -1;
    points[i * 4] = 0.5 + side * X[i];
    points[i * 4 + 1] = Y[i];
    points[i * 4 + 3] = 0.99;
  }
  return { pose: { points }, mask: { width: 4, height: 8, data: new Uint8Array(32).fill(255) }, people, width, height };
}

/** `n` standing persons side by side (makeBodyDetection's pose shifted), each with its 4×8 mask */
export function makeBodyDetections(n = 1, width = 1536, height = 2048): BodyDetections {
  const one = makeBodyDetection(1, width, height);
  const bodies = Array.from({ length: n }, (_, i) => {
    const points = one.pose.points.slice();
    const dx = n === 1 ? 0 : (i - (n - 1) / 2) * (0.6 / n);
    for (let k = 0; k < 33; k++) points[k * 4] += dx;
    return { pose: { points }, mask: one.mask, score: 0.3 - Math.abs(dx) };
  });
  return { bodies, width, height };
}

export interface FakeBodyTracker extends BodyTracker {
  /** what detect() returns next (null = no person) */
  result: BodyDetections | null;
  detect: ReturnType<typeof vi.fn<BodyTracker['detect']>>;
  detectVideo: ReturnType<typeof vi.fn<BodyTracker['detectVideo']>>;
  close: ReturnType<typeof vi.fn<() => void>>;
}

export function fakeBodyTracker(result: BodyDetections | null = makeBodyDetections()): FakeBodyTracker {
  const t = {
    variant: 'full' as const,
    delegate: 'CPU' as const,
    result,
    detect: vi.fn(() => t.result),
    detectVideo: vi.fn(() => t.result),
    close: vi.fn(),
  };
  return t as unknown as FakeBodyTracker;
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
