// createBodyTracker against a fake MediaPipe (delegate resolution, input downscale, mask selection, healing) and
// the pure helpers. The real model runs in headless Chromium: scripts/record-pose.mjs, tests/harness/b3/.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { BodyTracker } from '../types';

interface FakeMask {
  width: number;
  height: number;
  getAsFloat32Array: () => Float32Array;
}
interface FakeResult {
  landmarks: NormalizedLandmark[][];
  segmentationMasks?: FakeMask[];
  close: ReturnType<typeof vi.fn>;
}
interface CreateOpts {
  canvas?: FakeCanvas;
  baseOptions: { delegate: string; modelAssetBuffer: Uint8Array };
  runningMode: string;
  numPoses: number;
  outputSegmentationMasks: boolean;
}
interface FakeLandmarker {
  opts: CreateOpts;
  detect: ReturnType<typeof vi.fn>;
  detectForVideo: ReturnType<typeof vi.fn>;
  setOptions: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

const h = vi.hoisted(() => ({
  created: [] as FakeLandmarker[],
  onCreate: null as null | ((o: CreateOpts) => void),
  next: null as null | (() => FakeResult),
}));

class FakeCanvas {
  width: number;
  height: number;
  drawn: { w: number; h: number }[] = [];
  lost = false;
  private listeners = new Map<string, (() => void)[]>();
  constructor(w: number, hh: number) {
    this.width = w;
    this.height = hh;
  }
  addEventListener(type: string, fn: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  getContext(type: string) {
    if (type === '2d') return { drawImage: (_i: unknown, _x: number, _y: number, w: number, hh: number) => this.drawn.push({ w, h: hh }) };
    if (type === 'webgl2') return { isContextLost: () => this.lost };
    return null;
  }
  fire(type: string) {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }
}

/** a standing person spanning [x0,x1]×[y0,y1] in normalized coordinates */
function person(x0: number, x1: number, y0: number, y1: number, vis = 0.9): NormalizedLandmark[] {
  return Array.from({ length: 33 }, (_, i) => ({
    x: x0 + ((x1 - x0) * (i % 5)) / 4,
    y: y0 + ((y1 - y0) * i) / 32,
    z: -0.1,
    visibility: vis,
  }));
}

function mask(w: number, hh: number, fill: (x: number, y: number) => number): FakeMask {
  const a = new Float32Array(w * hh);
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) a[y * w + x] = fill(x, y);
  return { width: w, height: hh, getAsFloat32Array: () => a };
}

function result(poses: NormalizedLandmark[][], masks?: FakeMask[]): FakeResult {
  return { landmarks: poses, segmentationMasks: masks, close: vi.fn() };
}

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: vi.fn(async () => ({})) },
  PoseLandmarker: {
    createFromOptions: vi.fn(async (_fs: unknown, o: CreateOpts) => {
      h.onCreate?.(o);
      const run = () => (h.next ? h.next() : result([person(0.3, 0.7, 0.1, 0.9)], [mask(64, 100, () => 1)]));
      const lm: FakeLandmarker = {
        opts: o,
        detect: vi.fn(run),
        detectForVideo: vi.fn(run),
        setOptions: vi.fn(async () => undefined),
        close: vi.fn(),
      };
      h.created.push(lm);
      return lm;
    }),
  },
}));

const MODEL = new Uint8Array([1, 2, 3]);
const OPTS = { modelBuffer: MODEL, wasmBase: '/mediapipe/0.10.35', variant: 'full' as const, delegate: 'CPU' as const };
const img = (w: number, hh: number) => ({ width: w, height: hh }) as unknown as ImageBitmap;

/** the n-th instance has been created and swapped in (its creation promise has settled) */
async function replaced(n: number) {
  await vi.waitFor(() => expect(h.created).toHaveLength(n));
  await new Promise((r) => setTimeout(r, 0));
}

async function load() {
  return import('./bodyTracker');
}

beforeEach(() => {
  h.created.length = 0;
  h.onCreate = null;
  h.next = null;
  vi.stubGlobal('OffscreenCanvas', FakeCanvas);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('pure helpers', () => {
  it('fitLongEdge caps the long edge, never upscales, keeps the aspect', async () => {
    const { fitLongEdge } = await load();
    expect(fitLongEdge(4032, 3024, 1280)).toEqual([1280, 960]);
    expect(fitLongEdge(3024, 4032, 1280)).toEqual([960, 1280]);
    expect(fitLongEdge(638, 1000, 1280)).toEqual([638, 1000]);
    expect(fitLongEdge(638, 1000, 256)).toEqual([163, 256]);
    expect(fitLongEdge(0, 0, 256)).toEqual([1, 1]);
  });

  it('resolveDelegate: masks need the GPU graph in 0.10.35; without masks the preference is kept', async () => {
    const { resolveDelegate } = await load();
    expect(resolveDelegate({ delegate: 'CPU' })).toEqual({ delegate: 'GPU', masks: true });
    expect(resolveDelegate({})).toEqual({ delegate: 'GPU', masks: true });
    expect(resolveDelegate({ delegate: 'CPU', outputMask: false })).toEqual({ delegate: 'CPU', masks: false });
    expect(resolveDelegate({ outputMask: false })).toEqual({ delegate: 'CPU', masks: false });
    expect(resolveDelegate({ delegate: 'GPU', outputMask: false })).toEqual({ delegate: 'GPU', masks: false });
  });

  it('selectPerson prefers the largest person, discounted by distance from the centre', async () => {
    const { selectPerson } = await load();
    expect(selectPerson([])).toBe(-1);
    // small bystander vs. big subject
    expect(selectPerson([person(0.05, 0.15, 0.5, 0.7), person(0.35, 0.65, 0.1, 0.95)])).toBe(1);
    // same size: the centred one wins
    expect(selectPerson([person(0.0, 0.3, 0.0, 0.6), person(0.35, 0.65, 0.2, 0.8)])).toBe(1);
    // off-frame landmarks are clipped, so a half-visible giant does not win by its imaginary extent
    expect(selectPerson([person(0.9, 3, -2, 3), person(0.3, 0.7, 0.1, 0.9)])).toBe(1);
  });

  it('toPose33 packs x, y, z, visibility; a missing visibility reads as 0', async () => {
    const { toPose33 } = await load();
    const p = person(0, 1, 0, 1, 0.75);
    p[5] = { x: 0.5, y: 0.25, z: 0, visibility: undefined as unknown as number };
    const out = toPose33(p);
    expect(out).toHaveLength(132);
    expect(Array.from(out.slice(0, 4))).toEqual([0, 0, expect.closeTo(-0.1, 6), 0.75]);
    expect(Array.from(out.slice(20, 24))).toEqual([0.5, 0.25, 0, 0]);
  });

  it('downscaleMask box-filters to the 256 long edge, row 0 = top, and averages partial coverage', async () => {
    const { downscaleMask } = await load();
    // 1024×512: top half person (1), bottom half background (0), plus a 2-px-wide stripe at x = 600..601
    const m = mask(1024, 512, (x, y) => (y < 256 || x === 600 || x === 601 ? 1 : 0));
    const out = downscaleMask(m.getAsFloat32Array(), 1024, 512)!;
    expect([out.width, out.height]).toEqual([256, 128]);
    expect(out.data[0]).toBe(255);
    expect(out.data[127 * 256]).toBe(0);
    // 4×4 source texels per output texel: the 2-px stripe covers half of column 150
    expect(out.data[100 * 256 + 150]).toBe(128);
    expect(out.data[100 * 256 + 151]).toBe(0);
  });

  it('downscaleMask returns null for an empty mask (failed GPU readback)', async () => {
    const { downscaleMask } = await load();
    expect(downscaleMask(new Float32Array(400 * 300), 400, 300)).toBeNull();
    expect(downscaleMask(new Float32Array(400 * 300).fill(0.3), 400, 300)).toBeNull();
  });

  it('toDetection keeps the original size, counts people and takes the mask of the selected person', async () => {
    const { toDetection } = await load();
    const small = person(0.05, 0.15, 0.5, 0.7);
    const big = person(0.3, 0.7, 0.05, 0.95);
    const det = toDetection(
      result([small, big], [mask(100, 100, (x) => (x < 10 ? 1 : 0)), mask(100, 100, (x) => (x >= 50 ? 1 : 0))]) as never,
      4000,
      3000,
    )!;
    expect(det.people).toBe(2);
    expect([det.width, det.height]).toEqual([4000, 3000]);
    expect(det.pose.points[0]).toBeCloseTo(0.3, 6);
    expect(det.mask!.data[0]).toBe(0);
    expect(det.mask!.data[99]).toBe(255);
    expect(toDetection(result([]) as never, 10, 10)).toBeNull();
    // incomplete poses are ignored
    expect(toDetection(result([big.slice(0, 20)]) as never, 10, 10)).toBeNull();
  });
});

describe('createBodyTracker', () => {
  it('creates one GPU graph with masks, IMAGE, numPoses 2 on its own canvas, and reports the real delegate', async () => {
    const { createBodyTracker } = await load();
    const t = await createBodyTracker(OPTS);
    expect(h.created).toHaveLength(1);
    const o = h.created[0].opts;
    expect(o.baseOptions).toEqual({ modelAssetBuffer: MODEL, delegate: 'GPU' });
    expect(o).toMatchObject({ runningMode: 'IMAGE', numPoses: 2, outputSegmentationMasks: true });
    expect(o.canvas).toBeInstanceOf(FakeCanvas);
    expect(t.delegate).toBe('GPU');
    expect(t.variant).toBe('full');
  });

  it('without masks the CPU preference is honoured', async () => {
    const { createBodyTracker } = await load();
    const t = await createBodyTracker({ ...OPTS, outputMask: false, runningMode: 'VIDEO' });
    expect(h.created[0].opts).toMatchObject({ outputSegmentationMasks: false, runningMode: 'VIDEO' });
    expect(t.delegate).toBe('CPU');
  });

  it('falls back to CPU without masks when the GPU graph cannot be created', async () => {
    h.onCreate = (o) => {
      if (o.baseOptions.delegate === 'GPU') throw new Error('no webgl');
    };
    const { createBodyTracker } = await load();
    const t = await createBodyTracker(OPTS);
    expect(t.delegate).toBe('CPU');
    expect(h.created.at(-1)!.opts.outputSegmentationMasks).toBe(false);
    h.next = () => result([person(0.3, 0.7, 0.1, 0.9)]);
    expect(t.detect(img(100, 100))!.mask).toBeNull();
  });

  it('detect downscales the input to ≤ 1280, reports the original size, closes the result', async () => {
    const { createBodyTracker } = await load();
    const t = await createBodyTracker(OPTS);
    const r = result([person(0.3, 0.7, 0.1, 0.9)], [mask(960, 1280, (x) => (x > 400 ? 1 : 0))]);
    h.next = () => r;
    const det = t.detect(img(3024, 4032))!;
    expect([det.width, det.height]).toEqual([3024, 4032]);
    expect(det.mask).toMatchObject({ width: 192, height: 256 });
    expect(r.close).toHaveBeenCalledTimes(1);
    const input = h.created[0].detect.mock.calls[0][0] as FakeCanvas;
    expect([input.width, input.height]).toEqual([960, 1280]);
    expect(input.drawn.at(-1)).toEqual({ w: 960, h: 1280 });
    // small photos are not upscaled
    t.detect(img(638, 1000));
    expect([input.width, input.height]).toEqual([638, 1000]);
  });

  it('no person → null; zero-sized input → null without inference', async () => {
    const { createBodyTracker } = await load();
    const t = await createBodyTracker(OPTS);
    h.next = () => result([]);
    expect(t.detect(img(100, 100))).toBeNull();
    expect(t.detect(img(0, 0))).toBeNull();
    expect(h.created[0].detect).toHaveBeenCalledTimes(1);
  });

  it('an inference error is rethrown and the graph is rebuilt in place on the next call', async () => {
    const { createBodyTracker } = await load();
    const t = await createBodyTracker(OPTS);
    const lm = h.created[0];
    lm.detect.mockImplementationOnce(() => {
      throw new Error('Graph has errors');
    });
    expect(() => t.detect(img(100, 100))).toThrow(/Graph has errors/);
    expect(lm.setOptions).not.toHaveBeenCalled();
    expect(t.detect(img(100, 100))).not.toBeNull();
    expect(lm.setOptions).toHaveBeenCalledWith({ runningMode: 'IMAGE' });
    expect(h.created).toHaveLength(1);
  });

  it('detectVideo switches the graph to VIDEO once and keeps timestamps strictly increasing', async () => {
    const { createBodyTracker } = await load();
    const t = await createBodyTracker(OPTS);
    const lm = h.created[0];
    const video = img(1920, 1080) as unknown as HTMLVideoElement;
    t.detectVideo(video, 100);
    t.detectVideo(video, 100);
    t.detectVideo(video, 50);
    t.detectVideo(video, 200);
    expect(lm.setOptions).toHaveBeenCalledTimes(1);
    expect(lm.setOptions).toHaveBeenCalledWith({ runningMode: 'VIDEO' });
    expect(lm.detectForVideo.mock.calls.map((c) => c[1])).toEqual([100, 101, 102, 200]);
    t.detect(img(10, 10));
    expect(lm.setOptions).toHaveBeenLastCalledWith({ runningMode: 'IMAGE' });
  });

  it('a lost GPU context throws BodyTrackerRecovering and is replaced in the background', async () => {
    const { createBodyTracker, BodyTrackerRecovering } = await load();
    const t = await createBodyTracker(OPTS);
    const first = h.created[0];
    first.opts.canvas!.lost = true;
    expect(() => t.detect(img(100, 100))).toThrow(BodyTrackerRecovering);
    expect(() => t.detect(img(100, 100))).toThrow(BodyTrackerRecovering);
    await vi.waitFor(() => expect(h.created).toHaveLength(2));
    await vi.waitFor(() => expect(first.close).toHaveBeenCalled());
    expect(t.detect(img(100, 100))).not.toBeNull();
    expect(h.created[1].detect).toHaveBeenCalledTimes(1);
    expect(h.created[1].opts.canvas).not.toBe(first.opts.canvas);
  });

  it('the webglcontextlost event alone also retires the instance', async () => {
    const { createBodyTracker, BodyTrackerRecovering } = await load();
    const t = await createBodyTracker(OPTS);
    h.created[0].opts.canvas!.fire('webglcontextlost');
    expect(() => t.detect(img(100, 100))).toThrow(BodyTrackerRecovering);
    await vi.waitFor(() => expect(h.created).toHaveLength(2));
  });

  it('repeated inference errors replace the instance (old one released first) instead of failing for the session', async () => {
    const { createBodyTracker, BodyTrackerRecovering, ESCALATE_AFTER } = await load();
    const t = await createBodyTracker(OPTS);
    const first = h.created[0];
    h.next = () => {
      throw new Error('Graph has errors');
    };
    for (let i = 1; i < ESCALATE_AFTER; i++) expect(() => t.detect(img(100, 100))).toThrow(/Graph has errors/);
    expect(() => t.detect(img(100, 100))).toThrow(BodyTrackerRecovering);
    // its heap is dead anyway: released before the next module is allocated (two pose heaps on a low-RAM iPhone)
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(() => t.detect(img(100, 100))).toThrow(BodyTrackerRecovering);
    await replaced(2);
    // the first replacement retries the same (GPU, masked) graph
    expect(h.created[1].opts).toMatchObject({ baseOptions: { delegate: 'GPU' }, outputSegmentationMasks: true });
    h.next = null;
    expect(t.detect(img(100, 100))).not.toBeNull();
    expect(h.created[1].detect).toHaveBeenCalledTimes(1);
    expect(h.created[1].setOptions).not.toHaveBeenCalled(); // a fresh graph needs no rebuild
    expect(first.close).toHaveBeenCalledTimes(1);
  });

  it('a GPU graph that never succeeded falls back to CPU without masks on the second escalation', async () => {
    const { createBodyTracker, BodyTrackerRecovering, ESCALATE_AFTER } = await load();
    const t = await createBodyTracker(OPTS);
    h.next = () => {
      throw new Error('gl readback failed');
    };
    const escalate = async (n: number) => {
      for (let i = 1; i < ESCALATE_AFTER; i++) expect(() => t.detect(img(100, 100))).toThrow(/gl readback failed/);
      expect(() => t.detect(img(100, 100))).toThrow(BodyTrackerRecovering);
      await replaced(n);
    };
    await escalate(2);
    expect(t.delegate).toBe('GPU');
    await escalate(3);
    expect(h.created[2].opts).toMatchObject({ baseOptions: { delegate: 'CPU' }, outputSegmentationMasks: false });
    expect(t.delegate).toBe('CPU');
    h.next = () => result([person(0.3, 0.7, 0.1, 0.9)]);
    expect(t.detect(img(100, 100))!.mask).toBeNull();
  });

  it('after MAX_ESCALATIONS the original error is rethrown and no further instance is created', async () => {
    const { createBodyTracker, BodyTrackerRecovering, ESCALATE_AFTER, MAX_ESCALATIONS } = await load();
    const t = await createBodyTracker(OPTS);
    h.next = () => {
      throw new Error('still broken');
    };
    for (let k = 1; k <= MAX_ESCALATIONS; k++) {
      for (let i = 1; i < ESCALATE_AFTER; i++) expect(() => t.detect(img(100, 100))).toThrow(/still broken/);
      expect(() => t.detect(img(100, 100))).toThrow(BodyTrackerRecovering);
      await replaced(k + 1);
    }
    for (let i = 0; i < 3 * ESCALATE_AFTER; i++) expect(() => t.detect(img(100, 100))).toThrow(/still broken/);
    await Promise.resolve();
    expect(h.created).toHaveLength(MAX_ESCALATIONS + 1);
  });

  it('a wasm abort escalates at once: an aborted module cannot be rebuilt in place', async () => {
    const { createBodyTracker, BodyTrackerRecovering } = await load();
    const t = await createBodyTracker(OPTS);
    h.created[0].detect.mockImplementationOnce(() => {
      throw new WebAssembly.RuntimeError('Aborted(OOM)');
    });
    expect(() => t.detect(img(100, 100))).toThrow(BodyTrackerRecovering);
    await replaced(2);
    expect(t.detect(img(100, 100))).not.toBeNull();
    // MediaPipe can also surface the abort as a plain Error
    h.created[1].detect.mockImplementationOnce(() => {
      throw new Error('Aborted(Assertion failed). Build with -sASSERTIONS for more info.');
    });
    expect(() => t.detect(img(100, 100))).toThrow(BodyTrackerRecovering);
    await replaced(3);
  });

  it('a completed inference resets the failure and escalation counters', async () => {
    const { createBodyTracker, BodyTrackerRecovering, ESCALATE_AFTER, MAX_ESCALATIONS } = await load();
    const t = await createBodyTracker(OPTS);
    const boom = () => {
      throw new Error('flaky');
    };
    // isolated failures between successes never escalate
    for (let k = 0; k < 2 * ESCALATE_AFTER; k++) {
      h.next = boom;
      for (let i = 1; i < ESCALATE_AFTER; i++) expect(() => t.detect(img(100, 100))).toThrow(/flaky/);
      h.next = () => result([]); // "no person" is a completed inference too
      expect(t.detect(img(100, 100))).toBeNull();
    }
    expect(h.created).toHaveLength(1);
    // escalations separated by a success each start over: never capped, never forced to CPU (GPU once worked)
    for (let k = 1; k <= MAX_ESCALATIONS + 1; k++) {
      h.next = boom;
      for (let i = 1; i < ESCALATE_AFTER; i++) expect(() => t.detect(img(100, 100))).toThrow(/flaky/);
      expect(() => t.detect(img(100, 100))).toThrow(BodyTrackerRecovering);
      await replaced(k + 1);
      h.next = null;
      expect(t.detect(img(100, 100))).not.toBeNull();
    }
    expect(h.created.every((lm) => lm.opts.baseOptions.delegate === 'GPU')).toBe(true);
  });

  // detectBody's real polling contract (≤ 20 waits while BodyTrackerRecovering), with a 500 ms clock step
  async function poller(t: BodyTracker, tick: () => void) {
    const { BodyTrackerRecovering, BodyTrackerUnavailable } = await load();
    const { detectBody, isRecovering } = await import('../ui/editorModel');
    const detect = () =>
      detectBody(async () => t, img(100, 100) as ImageBitmap, {
        recoverWait: async () => {
          tick();
          await new Promise((r) => setTimeout(r, 0));
        },
      });
    const fails = async () => {
      const e = await detect().then(
        () => null,
        (err: unknown) => err,
      );
      expect(e).toBeInstanceOf(BodyTrackerUnavailable);
      expect(isRecovering(e)).toBe(false);
      expect(e).not.toBeInstanceOf(BodyTrackerRecovering);
      return e as InstanceType<typeof BodyTrackerUnavailable>;
    };
    return { detect, fails };
  }

  it('a replacement that cannot be created is retried with backoff, one heap per try; the real error surfaces', async () => {
    const { createBodyTracker, CREATE_RETRY_MS } = await load();
    let clock = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const t = await createBodyTracker(OPTS);
    const oom = new WebAssembly.RuntimeError('Aborted(OOM)');
    h.created[0].detect.mockImplementationOnce(() => {
      throw oom;
    });
    // memory is still tight right after the abort: no graph can be built
    const attempts: string[] = [];
    let canCreate = false;
    h.onCreate = (o) => {
      attempts.push(o.baseOptions.delegate);
      if (!canCreate) throw new Error('out of memory');
    };
    const { detect, fails } = await poller(t, () => (clock += 500));
    const e = await fails();
    // one replacement try, not one per poll, and on the GPU graph only: a failed creation is no evidence against
    // the GPU graph (typically OOM), so it neither costs a second heap nor gives up the masks (round 3, G3)
    expect(attempts).toEqual(['GPU']);
    expect((e.cause as Error).message).toBe('out of memory');
    expect(e.trigger).toBe(oom);
    // 重試 inside the backoff window: the error again, no new heap
    await fails();
    expect(attempts).toHaveLength(1);
    // memory is back: the next try after the window restores detection on the GPU graph, masks included
    clock += CREATE_RETRY_MS;
    canCreate = true;
    expect((await detect())!.mask).not.toBeNull();
    expect(attempts).toEqual(['GPU', 'GPU']);
    expect(t.delegate).toBe('GPU');
    expect(h.created[0].close).toHaveBeenCalledTimes(1);
  });

  it('GPU builds that keep failing fall back to the CPU graph for one replacement, not for good', async () => {
    const { createBodyTracker, CREATE_RETRY_MS, GPU_CREATE_TRIES } = await load();
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const t = await createBodyTracker(OPTS);
    expect(t.detect(img(100, 100))!.mask).not.toBeNull();
    h.created[0].detect.mockImplementationOnce(() => {
      throw new WebAssembly.RuntimeError('Aborted(OOM)');
    });
    const attempts: string[] = [];
    let gpuOk = false;
    h.onCreate = (o) => {
      attempts.push(o.baseOptions.delegate);
      if (o.baseOptions.delegate === 'GPU' && !gpuOk) throw new Error('Failed to create WebGL2 context');
    };
    const { detect, fails } = await poller(t, () => (clock += 500));
    for (let k = 1; k <= GPU_CREATE_TRIES; k++) {
      await fails();
      clock += CREATE_RETRY_MS * 2 ** (k - 1);
    }
    expect(attempts).toEqual(['GPU', 'GPU']);
    // the sustained GPU failure (≥ 15 s): the next try builds the CPU graph, detection works without masks
    h.next = () => result([person(0.3, 0.7, 0.1, 0.9)]);
    expect((await detect())!.mask).toBeNull();
    expect(attempts).toEqual(['GPU', 'GPU', 'CPU']);
    expect(h.created.at(-1)!.opts.outputSegmentationMasks).toBe(false);
    expect(t.delegate).toBe('CPU');
    // not sticky: the next replacement tries the GPU graph again and gets the masks back
    h.next = null;
    gpuOk = true;
    h.created.at(-1)!.detect.mockImplementationOnce(() => {
      throw new WebAssembly.RuntimeError('Aborted(OOM)');
    });
    expect((await detect())!.mask).not.toBeNull();
    expect(attempts).toEqual(['GPU', 'GPU', 'CPU', 'GPU']);
    expect(t.delegate).toBe('GPU');
  });

  it('a lost-context instance is released before its replacement is created, and a failed one is backed off', async () => {
    const { createBodyTracker, BodyTrackerRecovering, BodyTrackerUnavailable, CREATE_RETRY_MS } = await load();
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const t = await createBodyTracker(OPTS);
    const first = h.created[0];
    const closedAtCreate: number[] = [];
    h.onCreate = () => {
      closedAtCreate.push(first.close.mock.calls.length);
      throw new Error('no webgl');
    };
    first.opts.canvas!.lost = true;
    expect(() => t.detect(img(100, 100))).toThrow(BodyTrackerRecovering);
    // its heap is dead: freed before the next one is allocated, not kept until a replacement succeeds (round 3, G4)
    expect(closedAtCreate).toEqual([1]);
    await new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < 20; i++) {
      clock += 100;
      expect(() => t.detect(img(100, 100))).toThrow(BodyTrackerUnavailable);
    }
    expect(closedAtCreate).toHaveLength(1); // one heap per try
    // later tries after each window: still exactly one close of the lost instance
    for (let k = 1; k <= 3; k++) {
      clock += CREATE_RETRY_MS * 2 ** (k - 1);
      expect(() => t.detect(img(100, 100))).toThrow(BodyTrackerRecovering);
      await new Promise((r) => setTimeout(r, 0));
      expect(() => t.detect(img(100, 100))).toThrow(BodyTrackerUnavailable);
    }
    expect(closedAtCreate).toEqual([1, 1, 1, 1]);
    t.close();
    expect(first.close).toHaveBeenCalledTimes(1);
  });

  it('wasm aborts separated by "no person" photos are each replaced: the cap never keeps a dead module (G1)', async () => {
    const { createBodyTracker, BodyTrackerRecovering, MAX_ESCALATIONS } = await load();
    const t = await createBodyTracker(OPTS);
    expect(t.detect(img(100, 100))!.mask).not.toBeNull(); // the GPU mask path works on this device
    for (let k = 1; k <= MAX_ESCALATIONS + 1; k++) {
      h.created[k - 1].detect.mockImplementation(() => {
        throw new WebAssembly.RuntimeError('Aborted(OOM)'); // an aborted module throws on every later call
      });
      expect(() => t.detect(img(100, 100))).toThrow(BodyTrackerRecovering);
      expect(h.created[k - 1].close).toHaveBeenCalledTimes(1);
      await replaced(k + 1);
      h.next = () => result([]); // a "no person" photo: a completed inference, the cap starts over
      expect(t.detect(img(100, 100))).toBeNull();
      h.next = null;
    }
    expect(t.detect(img(100, 100))!.mask).not.toBeNull();
    expect(h.created.map((lm) => lm.opts.baseOptions.delegate)).toEqual(['GPU', 'GPU', 'GPU', 'GPU']);
    expect(h.created.slice(0, -1).every((lm) => lm.close.mock.calls.length === 1)).toBe(true);
  });

  it('an abort storm past the cap stalls with backoff instead of keeping the dead module, and recovers (G1)', async () => {
    const { createBodyTracker, BodyTrackerRecovering, BodyTrackerUnavailable, MAX_ESCALATIONS, CREATE_RETRY_MS } =
      await load();
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const t = await createBodyTracker(OPTS);
    expect(t.detect(img(100, 100))!.mask).not.toBeNull();
    const abort = new WebAssembly.RuntimeError('Aborted(OOM)');
    h.next = () => {
      throw abort;
    };
    for (let k = 1; k <= MAX_ESCALATIONS; k++) {
      expect(() => t.detect(img(100, 100))).toThrow(BodyTrackerRecovering);
      await replaced(k + 1);
    }
    // the cap is reached: the aborted instance is released, not kept as live, and nothing is created at once
    let e: unknown;
    try {
      t.detect(img(100, 100));
    } catch (err) {
      e = err;
    }
    expect(e).toBeInstanceOf(BodyTrackerUnavailable);
    expect((e as Error).cause).toBe(abort);
    expect((e as InstanceType<typeof BodyTrackerUnavailable>).trigger).toBe(abort);
    expect(h.created[MAX_ESCALATIONS].close).toHaveBeenCalledTimes(1);
    clock += CREATE_RETRY_MS - 1;
    expect(() => t.detect(img(100, 100))).toThrow(BodyTrackerUnavailable);
    await Promise.resolve();
    expect(h.created).toHaveLength(MAX_ESCALATIONS + 1);
    // after the window: one attempt; still aborting → stalled again, for a doubled window (one heap per window)
    clock += 1;
    expect(() => t.detect(img(100, 100))).toThrow(BodyTrackerRecovering);
    await replaced(MAX_ESCALATIONS + 2);
    expect(() => t.detect(img(100, 100))).toThrow(BodyTrackerUnavailable);
    clock += CREATE_RETRY_MS;
    expect(() => t.detect(img(100, 100))).toThrow(BodyTrackerUnavailable);
    expect(h.created).toHaveLength(MAX_ESCALATIONS + 2);
    // memory is back: the first call after the window recovers, on the GPU graph with masks
    h.next = null;
    clock += CREATE_RETRY_MS;
    expect(() => t.detect(img(100, 100))).toThrow(BodyTrackerRecovering);
    await replaced(MAX_ESCALATIONS + 3);
    expect(t.detect(img(100, 100))!.mask).not.toBeNull();
    expect(t.delegate).toBe('GPU');
    expect(h.created.slice(0, -1).every((lm) => lm.close.mock.calls.length === 1)).toBe(true);
  });

  it('on a GPU graph that never read a mask back, aborts separated by "no person" still reach the CPU fallback', async () => {
    const { createBodyTracker, BodyTrackerRecovering, CPU_FALLBACK_AFTER } = await load();
    const t = await createBodyTracker(OPTS);
    for (let k = 1; k <= CPU_FALLBACK_AFTER; k++) {
      h.next = () => result([]);
      expect(t.detect(img(100, 100))).toBeNull();
      h.created[k - 1].detect.mockImplementationOnce(() => {
        throw new WebAssembly.RuntimeError('Aborted(OOM)');
      });
      expect(() => t.detect(img(100, 100))).toThrow(BodyTrackerRecovering);
      await replaced(k + 1);
    }
    expect(h.created.map((lm) => lm.opts.baseOptions.delegate)).toEqual(['GPU', 'GPU', 'CPU']);
  });

  it('the CPU fallback is sticky: a later CPU abort is replaced by CPU, not by the GPU graph that failed', async () => {
    const { createBodyTracker, BodyTrackerRecovering, ESCALATE_AFTER } = await load();
    const t = await createBodyTracker(OPTS);
    h.next = () => {
      throw new Error('GPU does not fully support 4-channel float32 or float16 formats');
    };
    const escalate = async (n: number) => {
      for (let i = 1; i < ESCALATE_AFTER; i++) expect(() => t.detect(img(100, 100))).toThrow(/4-channel/);
      expect(() => t.detect(img(100, 100))).toThrow(BodyTrackerRecovering);
      await replaced(n);
    };
    await escalate(2);
    await escalate(3);
    expect(t.delegate).toBe('CPU');
    h.next = () => result([person(0.3, 0.7, 0.1, 0.9)]);
    expect(t.detect(img(100, 100))).not.toBeNull();
    h.created[2].detect.mockImplementationOnce(() => {
      throw new WebAssembly.RuntimeError('Aborted(OOM)');
    });
    expect(() => t.detect(img(100, 100))).toThrow(BodyTrackerRecovering);
    await replaced(4);
    expect(h.created.map((lm) => lm.opts.baseOptions.delegate)).toEqual(['GPU', 'GPU', 'CPU', 'CPU']);
    expect(h.created[3].opts.outputSegmentationMasks).toBe(false);
    expect(t.detect(img(100, 100))).not.toBeNull();
  });

  it('a GPU graph that could not be created is not tried again by a later replacement', async () => {
    const { createBodyTracker, BodyTrackerRecovering } = await load();
    const attempts: string[] = [];
    h.onCreate = (o) => {
      attempts.push(o.baseOptions.delegate);
      if (o.baseOptions.delegate === 'GPU') throw new Error('no webgl');
    };
    const t = await createBodyTracker(OPTS);
    h.next = () => result([person(0.3, 0.7, 0.1, 0.9)]);
    h.created[0].detect.mockImplementationOnce(() => {
      throw new WebAssembly.RuntimeError('Aborted(OOM)');
    });
    expect(() => t.detect(img(100, 100))).toThrow(BodyTrackerRecovering);
    await replaced(2);
    expect(attempts).toEqual(['GPU', 'CPU', 'CPU']);
    expect(t.detect(img(100, 100))).not.toBeNull();
  });

  it('a "no person" GPU result does not prove the mask path: mask failures still fall back to CPU', async () => {
    const { createBodyTracker, BodyTrackerRecovering, ESCALATE_AFTER } = await load();
    const t = await createBodyTracker(OPTS);
    h.next = () => result([]); // no person: MediaPipe never clones a mask
    expect(t.detect(img(100, 100))).toBeNull();
    h.next = () => {
      throw new Error('GPU does not fully support 4-channel float32 or float16 formats');
    };
    for (const n of [2, 3]) {
      for (let i = 1; i < ESCALATE_AFTER; i++) expect(() => t.detect(img(100, 100))).toThrow(/4-channel/);
      expect(() => t.detect(img(100, 100))).toThrow(BodyTrackerRecovering);
      await replaced(n);
    }
    expect(h.created[2].opts).toMatchObject({ baseOptions: { delegate: 'CPU' }, outputSegmentationMasks: false });
    expect(t.delegate).toBe('CPU');
  });

  it('"no person" photos between mask failures do not restart the GPU retries: the CPU fallback still comes', async () => {
    const { createBodyTracker, BodyTrackerRecovering, ESCALATE_AFTER } = await load();
    const t = await createBodyTracker(OPTS);
    const boom = () => {
      throw new Error('GPU does not fully support 4-channel float32 or float16 formats');
    };
    for (const n of [2, 3]) {
      h.next = () => result([]);
      expect(t.detect(img(100, 100))).toBeNull();
      h.next = boom;
      for (let i = 1; i < ESCALATE_AFTER; i++) expect(() => t.detect(img(100, 100))).toThrow(/4-channel/);
      expect(() => t.detect(img(100, 100))).toThrow(BodyTrackerRecovering);
      await replaced(n);
    }
    expect(h.created.map((lm) => lm.opts.baseOptions.delegate)).toEqual(['GPU', 'GPU', 'CPU']);
  });

  it('a mask readback that throws counts as a failed inference and escalates to the CPU graph', async () => {
    const { createBodyTracker, BodyTrackerRecovering, ESCALATE_AFTER } = await load();
    const t = await createBodyTracker(OPTS);
    const results: FakeResult[] = [];
    h.next = () => {
      const r = result(
        [person(0.3, 0.7, 0.1, 0.9)],
        [
          {
            width: 64,
            height: 100,
            getAsFloat32Array: () => {
              throw new Error('readPixels: FLOAT not supported');
            },
          },
        ],
      );
      results.push(r);
      return r;
    };
    for (const n of [2, 3]) {
      for (let i = 1; i < ESCALATE_AFTER; i++) expect(() => t.detect(img(100, 100))).toThrow(/readPixels/);
      expect(() => t.detect(img(100, 100))).toThrow(BodyTrackerRecovering);
      await replaced(n);
    }
    expect(results.every((r) => r.close.mock.calls.length === 1)).toBe(true);
    expect(h.created[2].opts).toMatchObject({ baseOptions: { delegate: 'CPU' }, outputSegmentationMasks: false });
    h.next = () => result([person(0.3, 0.7, 0.1, 0.9)]);
    expect(t.detect(img(100, 100))!.mask).toBeNull();
  });

  it('close releases the instance once; later calls throw', async () => {
    const { createBodyTracker } = await load();
    const t = await createBodyTracker(OPTS);
    t.close();
    t.close();
    expect(h.created[0].close).toHaveBeenCalledTimes(1);
    expect(() => t.detect(img(10, 10))).toThrow(/closed/);
  });
});
