// createTracker recovery paths against a fake MediaPipe: lost GL context (event and poll),
// poisoned-graph rebuilds, throttling, escalation, logging and the GPU → CPU last resort.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EDIT_DETECT_FACES, LIVE_DETECT_FACES } from '../config/limits';
import { crc32, readStoredZip, writeStoredZip } from '../engine/faceBundle';
import type { TrackerState } from '../types';

const h = vi.hoisted(() => ({
  created: [] as FakeLandmarkerT[],
  /** decides what the next createFromOptions call does (default: succeed) */
  onCreate: null as null | ((o: { canvas?: unknown; baseOptions: { delegate: string } }) => void),
}));

interface FakeLandmarkerT {
  delegate: string;
  canvas: FakeCanvas | undefined;
  opts: { numFaces?: number; runningMode?: string; baseOptions: { modelAssetBuffer?: Uint8Array; delegate: string } };
  detectForVideo: ReturnType<typeof vi.fn>;
  detect: ReturnType<typeof vi.fn>;
  setOptions: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

const FACE = Array.from({ length: 478 }, (_, i) => ({ x: i / 478, y: 0.5, z: 0 }));
const hit = () => ({ faceLandmarks: [FACE] });

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: vi.fn(async () => ({})) },
  FaceLandmarker: {
    createFromOptions: vi.fn(
      async (
        _fs: unknown,
        o: { canvas?: FakeCanvas; baseOptions: { modelAssetBuffer?: Uint8Array; delegate: string }; numFaces?: number; runningMode?: string },
      ) => {
        h.onCreate?.(o);
        const lm: FakeLandmarkerT = {
          delegate: o.baseOptions.delegate,
          canvas: o.canvas,
          opts: o,
          detectForVideo: vi.fn(hit),
          detect: vi.fn(hit),
          setOptions: vi.fn(async () => undefined),
          close: vi.fn(),
        };
        h.created.push(lm);
        return lm;
      },
    ),
  },
}));

class FakeCanvas {
  width: number;
  height: number;
  lost = false;
  private listeners = new Map<string, (() => void)[]>();
  private gl: { isContextLost: () => boolean } | null = null;
  constructor(w: number, hh: number) {
    this.width = w;
    this.height = hh;
  }
  addEventListener(type: string, fn: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  getContext(type: string) {
    if (type === '2d') return { drawImage: vi.fn() };
    if (type === 'webgl2') return (this.gl ??= { isContextLost: () => this.lost });
    return null;
  }
  /** WEBGL_lose_context: flip the flag, optionally fire the event */
  lose(fire: boolean) {
    this.lost = true;
    if (fire) for (const fn of this.listeners.get('webglcontextlost') ?? []) fn();
  }
}

class FakeDocument {
  visibilityState: 'visible' | 'hidden' = 'visible';
  private fns: (() => void)[] = [];
  addEventListener(_t: string, fn: () => void) {
    this.fns.push(fn);
  }
  removeEventListener(_t: string, fn: () => void) {
    this.fns = this.fns.filter((f) => f !== fn);
  }
  set(v: 'visible' | 'hidden') {
    this.visibilityState = v;
    for (const fn of this.fns) fn();
  }
}

const video = { readyState: 4, videoWidth: 640, videoHeight: 480 } as unknown as HTMLVideoElement;
const image = { width: 100, height: 100 } as unknown as ImageBitmap;
const ONE = { maxFaces: LIVE_DETECT_FACES };

let doc: FakeDocument;
let states: TrackerState[];

async function load() {
  const mod = await import('./tracker');
  return mod;
}

async function make(delegate: 'auto' | 'GPU' | 'CPU' = 'auto') {
  const { createTracker } = await load();
  return createTracker({ modelBuffer: new Uint8Array(1), wasmBase: '/wasm', delegate, onStateChange: (s) => states.push(s) });
}

const last = () => h.created[h.created.length - 1];

beforeEach(() => {
  h.created.length = 0;
  h.onCreate = null;
  states = [];
  doc = new FakeDocument();
  vi.stubGlobal('OffscreenCanvas', FakeCanvas);
  vi.stubGlobal('document', doc);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createTracker: lost GL context', () => {
  it('detects a lost context by polling, replaces the instance on a fresh canvas and resumes', async () => {
    const t = await make();
    const first = last();
    expect(t.delegate).toBe('GPU');
    expect(t.detectVideo(video, 10, ONE)).not.toBeNull();

    first.canvas!.lose(false); // no event: WebKit may not fire it on OffscreenCanvas
    expect(t.detectVideo(video, 20, ONE)).toBeNull();
    expect(t.detectImage(image, ONE)).toEqual([]);
    expect(first.detectForVideo).toHaveBeenCalledTimes(1);
    expect(first.detect).not.toHaveBeenCalled();
    expect(states).toEqual(['lost']);

    await vi.advanceTimersByTimeAsync(500);
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(h.created).toHaveLength(2);
    const second = last();
    expect(second.canvas).toBeInstanceOf(FakeCanvas);
    expect(second.canvas).not.toBe(first.canvas);
    expect(second.delegate).toBe('GPU');
    expect(states).toEqual(['lost', 'ok']);

    expect(t.detectVideo(video, 5, ONE)).not.toBeNull(); // stale timestamp: still strictly increasing
    expect(second.detectForVideo).toHaveBeenCalledTimes(1);
    expect(second.detectForVideo.mock.calls[0][1]).toBeGreaterThan(20);
    expect(second.setOptions).not.toHaveBeenCalled(); // new graph already in VIDEO
    expect(t.detectImage(image, ONE)).toHaveLength(1);
    expect(second.setOptions).toHaveBeenLastCalledWith({ runningMode: 'IMAGE', numFaces: LIVE_DETECT_FACES });
  });

  it('reacts to the webglcontextlost event and ignores later events from retired canvases', async () => {
    const t = await make();
    const first = last();
    first.canvas!.lose(true);
    expect(states).toEqual(['lost']);
    await vi.advanceTimersByTimeAsync(500);
    expect(h.created).toHaveLength(2);
    first.canvas!.lose(true); // late event from the old canvas
    expect(t.detectVideo(video, 1, ONE)).not.toBeNull();
    expect(states).toEqual(['lost', 'ok']);
  });

  it('only watches the context on the GPU delegate', async () => {
    const t = await make('CPU');
    last().canvas!.lose(true);
    expect(t.detectVideo(video, 1, ONE)).not.toBeNull();
    expect(states).toEqual([]);
  });

  it('waits while hidden and replaces on return to the foreground', async () => {
    const t = await make();
    doc.visibilityState = 'hidden';
    last().canvas!.lose(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.created).toHaveLength(1);
    doc.set('visible');
    await vi.advanceTimersByTimeAsync(500);
    expect(h.created).toHaveLength(2);
    expect(t.detectVideo(video, 1, ONE)).not.toBeNull();
  });

  it('a lost context found on return to the foreground triggers recovery without a detect call', async () => {
    await make();
    doc.visibilityState = 'hidden';
    last().canvas!.lost = true; // lost while in the background, no event
    doc.set('visible');
    expect(states).toEqual(['lost']);
    await vi.advanceTimersByTimeAsync(500);
    expect(h.created).toHaveLength(2);
  });

  it("backs off, falls back to CPU on 'auto' only after GPU retries, then makes a frame copy", async () => {
    const t = await make();
    h.onCreate = (o) => {
      if (o.baseOptions.delegate === 'GPU') throw new Error('no GPU context');
    };
    last().canvas!.lose(true);
    await vi.advanceTimersByTimeAsync(500); // attempt 1: GPU only
    await vi.advanceTimersByTimeAsync(1000); // attempt 2: GPU only
    expect(h.created).toHaveLength(1);
    expect(t.delegate).toBe('GPU');
    await vi.advanceTimersByTimeAsync(2000); // attempt 3: GPU, then CPU
    expect(h.created).toHaveLength(2);
    expect(t.delegate).toBe('CPU');
    expect(states).toEqual(['lost', 'ok']);
    expect(t.detectVideo(video, 1, ONE)).not.toBeNull();
    expect(last().detectForVideo.mock.calls[0][0]).toBeInstanceOf(FakeCanvas); // CPU path copies the frame
  });

  it("reports 'failed' after the self-retries and retries again when provoked", async () => {
    const t = await make('GPU');
    h.onCreate = () => {
      throw new Error('still down');
    };
    last().canvas!.lose(true);
    await vi.advanceTimersByTimeAsync(60_000);
    const { SELF_RETRY_ATTEMPTS } = await load();
    expect(states).toEqual(['lost', 'failed']);
    const calls = (await import('@mediapipe/tasks-vision')).FaceLandmarker.createFromOptions as unknown as ReturnType<typeof vi.fn>;
    const before = calls.mock.calls.length;
    expect(before).toBe(1 + SELF_RETRY_ATTEMPTS);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls.mock.calls.length).toBe(before); // no more self-retries
    h.onCreate = null;
    expect(t.detectVideo(video, 1, ONE)).toBeNull(); // provokes one more attempt
    await vi.advanceTimersByTimeAsync(5000);
    expect(states).toEqual(['lost', 'failed', 'ok']);
    expect(t.detectVideo(video, 2, ONE)).not.toBeNull();
  });

  it('closes an instance that finishes creating after the tracker was closed', async () => {
    const t = await make();
    last().canvas!.lose(true);
    let resolveGate!: () => void;
    const gate = new Promise<void>((r) => (resolveGate = r));
    const mp = (await import('@mediapipe/tasks-vision')).FaceLandmarker.createFromOptions as unknown as ReturnType<typeof vi.fn>;
    const impl = mp.getMockImplementation() as (...a: unknown[]) => Promise<unknown>;
    mp.mockImplementationOnce(async (...a: unknown[]) => {
      await gate;
      return impl(...a);
    });
    await vi.advanceTimersByTimeAsync(500);
    t.close();
    resolveGate();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.created).toHaveLength(2);
    expect(last().close).toHaveBeenCalledTimes(1);
    expect(t.detectVideo(video, 1, ONE)).toBeNull();
  });

  it('close() survives a throwing close on a dead context and stops pending retries', async () => {
    const t = await make();
    const first = last();
    first.close.mockImplementation(() => {
      throw new Error('context lost');
    });
    first.canvas!.lose(true);
    t.close();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.created).toHaveLength(1);
    expect(first.close).toHaveBeenCalledTimes(1);
  });
});

describe('createTracker: inference failures', () => {
  it('rethrows, then rebuilds the graph in place on the next call', async () => {
    const t = await make();
    const lm = last();
    lm.detectForVideo.mockImplementationOnce(() => {
      throw new Error('ROI width and height must be > 0');
    });
    expect(() => t.detectVideo(video, 1, ONE)).toThrow('ROI');
    expect(t.detectVideo(video, 2, ONE)).not.toBeNull();
    expect(lm.setOptions).toHaveBeenCalledWith({ runningMode: 'VIDEO', numFaces: LIVE_DETECT_FACES }); // same-mode rebuild
    expect(t.detectVideo(video, 3, ONE)).not.toBeNull();
    expect(lm.setOptions).toHaveBeenCalledTimes(1);
    expect(h.created).toHaveLength(1);
  });

  it('a synchronously throwing setOptions still switches mode and the photo gets its face', async () => {
    const t = await make();
    const lm = last();
    lm.detectForVideo.mockImplementationOnce(() => {
      throw new Error('Graph has errors');
    });
    lm.setOptions.mockImplementationOnce(() => {
      throw new Error('close old graph');
    });
    expect(() => t.detectVideo(video, 1, ONE)).toThrow();
    expect(t.detectImage(image, ONE)).toHaveLength(1);
    expect(lm.setOptions.mock.calls).toEqual([[{ runningMode: 'IMAGE', numFaces: LIVE_DETECT_FACES }]]);
    expect(t.detectVideo(video, 2, ONE)).not.toBeNull();
    expect(lm.setOptions.mock.calls).toEqual([[{ runningMode: 'IMAGE', numFaces: LIVE_DETECT_FACES }], [{ runningMode: 'VIDEO', numFaces: LIVE_DETECT_FACES }]]);
  });

  it('logs each distinct error once', async () => {
    const t = await make();
    const lm = last();
    const warn = console.warn as unknown as ReturnType<typeof vi.fn>;
    warn.mockClear();
    for (const msg of ['A', 'A', 'B']) {
      lm.detect.mockImplementationOnce(() => {
        throw new Error(msg);
      });
      expect(() => t.detectImage(image, ONE)).toThrow(msg);
      expect(t.detectImage(image, ONE)).toHaveLength(1); // resets the consecutive count
    }
    expect(warn).toHaveBeenCalledTimes(2);
    expect(h.created).toHaveLength(1);
  });

  it('throttles live rebuilds to one per interval, then replaces the instance', async () => {
    const { REBUILD_INTERVAL_MS, ESCALATE_AFTER } = await load();
    const t = await make();
    const lm = last();
    lm.detectForVideo.mockImplementation(() => {
      throw new Error('Graph has errors');
    });
    expect(() => t.detectVideo(video, 1, ONE)).toThrow(); // failure 1
    expect(() => t.detectVideo(video, 2, ONE)).toThrow(); // immediate rebuild, failure 2
    expect(lm.setOptions).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 10; i++) expect(t.detectVideo(video, 3 + i, ONE)).toBeNull(); // throttled: no inference
    expect(lm.detectForVideo).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(REBUILD_INTERVAL_MS);
    expect(() => t.detectVideo(video, 20, ONE)).toThrow(); // second rebuild, failure 3 → escalate
    expect(lm.setOptions).toHaveBeenCalledTimes(2);
    expect(ESCALATE_AFTER).toBe(3);
    expect(states).toEqual(['lost']);
    expect(t.detectVideo(video, 21, ONE)).toBeNull();
    await vi.advanceTimersByTimeAsync(500);
    expect(lm.close).toHaveBeenCalled();
    expect(h.created).toHaveLength(2);
    expect(last().delegate).toBe('GPU'); // first replacement stays on GPU
    expect(t.detectVideo(video, 22, ONE)).not.toBeNull();
  });

  it("'auto': a GPU graph that never worked goes to CPU after its GPU replacement fails too", async () => {
    const t = await make();
    const failAll = (lm: FakeLandmarkerT) =>
      lm.detectForVideo.mockImplementation(() => {
        throw new Error('shader compile failed');
      });
    const burn = async () => {
      for (let i = 0; i < 3; i++) {
        try {
          t.detectVideo(video, performance.now(), ONE);
        } catch {
          /* expected */
        }
        vi.advanceTimersByTime(1000);
      }
      await vi.advanceTimersByTimeAsync(5000);
    };
    failAll(last());
    await burn();
    expect(h.created.map((l) => l.delegate)).toEqual(['GPU', 'GPU']);
    failAll(last());
    await burn();
    expect(h.created.map((l) => l.delegate)).toEqual(['GPU', 'GPU', 'CPU']);
    expect(t.delegate).toBe('CPU');
    expect(t.detectVideo(video, performance.now(), ONE)).not.toBeNull();
  });

  it('a GPU graph that has worked is never moved to CPU by failures', async () => {
    const t = await make();
    expect(t.detectVideo(video, 1, ONE)).not.toBeNull();
    for (let round = 0; round < 2; round++) {
      last().detectForVideo.mockImplementation(() => {
        throw new Error('Graph has errors');
      });
      for (let i = 0; i < 3; i++) {
        try {
          t.detectVideo(video, performance.now(), ONE);
        } catch {
          /* expected */
        }
        vi.advanceTimersByTime(1000);
      }
      await vi.advanceTimersByTimeAsync(5000);
    }
    expect(h.created.every((l) => l.delegate === 'GPU')).toBe(true);
    expect(h.created).toHaveLength(3);
  });

  it("stops replacing after MAX_ESCALATIONS when fresh instances fail too, reports 'failed', recovers on success", async () => {
    const { MAX_ESCALATIONS, REBUILD_INTERVAL_MS } = await load();
    expect(MAX_ESCALATIONS).toBeGreaterThanOrEqual(2);
    const t = await make();
    let broken = true;
    const step = async () => {
      for (const lm of h.created)
        lm.detectForVideo.mockImplementation(() => {
          if (broken) throw new Error('Graph has errors');
          return hit();
        });
      try {
        t.detectVideo(video, performance.now(), ONE);
      } catch {
        /* expected */
      }
      await vi.advanceTimersByTimeAsync(REBUILD_INTERVAL_MS);
    };
    for (let i = 0; i < 60; i++) await step();
    expect(h.created).toHaveLength(1 + MAX_ESCALATIONS);
    expect(states.at(-1)).toBe('failed');
    for (let i = 0; i < 60; i++) await step(); // another minute of failures: no new instances
    expect(h.created).toHaveLength(1 + MAX_ESCALATIONS);
    expect(h.created.slice(0, -1).every((l) => l.close.mock.calls.length > 0)).toBe(true);
    expect(last().close).not.toHaveBeenCalled();
    broken = false;
    await step();
    expect(t.detectVideo(video, performance.now(), ONE)).not.toBeNull();
    expect(states.at(-1)).toBe('ok');
  });

  it('explicit delegate never falls back', async () => {
    const t = await make('GPU');
    h.onCreate = (o) => {
      if (o.baseOptions.delegate === 'GPU') throw new Error('no GPU');
    };
    last().canvas!.lose(true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.created).toHaveLength(1);
    expect(t.delegate).toBe('GPU');
  });
});

describe('createTracker: multiple faces (S §3.4 T1, T2)', () => {
  const lmAt = (n: number) => ({ faceLandmarks: Array.from({ length: n }, () => FACE) });
  it('numFaces travels with runningMode in one setOptions; no call when neither changes', async () => {
    const t = await make();
    const lm = last();
    expect(lm.opts.numFaces).toBe(LIVE_DETECT_FACES); // the first instance
    t.detectImage(image, { maxFaces: 8 });
    t.detectImage(image, { maxFaces: 8 });
    expect(lm.setOptions.mock.calls).toEqual([[{ runningMode: 'IMAGE', numFaces: 8 }]]);
    t.detectVideo(video, 1, { maxFaces: 1 });
    expect(lm.setOptions).toHaveBeenLastCalledWith({ runningMode: 'VIDEO', numFaces: 1 });
  });
  it('maxFaces is clamped to 1…EDIT_DETECT_FACES', async () => {
    const t = await make();
    const lm = last();
    t.detectImage(image, { maxFaces: 99 });
    // EDIT_DETECT_FACES = MAX_EDIT_FACES + 2 = 12 (S §6.7)
    expect(EDIT_DETECT_FACES).toBe(12);
    expect(lm.setOptions).toHaveBeenLastCalledWith({ runningMode: 'IMAGE', numFaces: EDIT_DETECT_FACES });
    t.detectImage(image, { maxFaces: Number.NaN });
    expect(lm.setOptions).toHaveBeenLastCalledWith({ runningMode: 'IMAGE', numFaces: 1 });
  });
  it('a replacement is built with the last requested count, so the next call makes no setOptions', async () => {
    const t = await make();
    t.detectVideo(video, 1, { maxFaces: 3 });
    last().canvas!.lose(true);
    await vi.advanceTimersByTimeAsync(5000);
    const second = last();
    expect(second.opts.numFaces).toBe(3);
    expect(t.detectVideo(video, 2, { maxFaces: 3 })).toHaveLength(1);
    expect(second.setOptions).not.toHaveBeenCalled();
  });
  it('keeps every valid face in result order, [] for none; detectVideo: null for no answer, [] for no face', async () => {
    const t = await make();
    last().detect.mockReturnValueOnce({ faceLandmarks: [FACE, FACE.slice(0, 10), FACE] });
    expect(t.detectImage(image, { maxFaces: 4 })).toHaveLength(2);
    last().detectForVideo.mockReturnValueOnce(lmAt(0));
    expect(t.detectVideo(video, 1, { maxFaces: 3 })).toEqual([]);
    expect(t.detectVideo({ readyState: 1, videoWidth: 640, videoHeight: 480 } as unknown as HTMLVideoElement, 2, { maxFaces: 3 })).toBeNull();
  });
});

describe('createTracker: the full-range photo detector (BlazeFace full-range for IMAGE, the camera bundle for VIDEO)', () => {
  // a camera bundle and a detector small enough to read back (withFaceDetector assembles the photo bundle from them)
  const entry = (name: string, data: Uint8Array) => ({ name, data, crc: crc32(data), time: 0, date: 0, madeBy: 20, external: 0 });
  const tfl = (n: number, seed: number) => {
    const b = new Uint8Array(n).map((_, i) => (i * 13 + seed) & 255);
    b.set([0x54, 0x46, 0x4c, 0x33], 4);
    return b;
  };
  const SHORT = tfl(64, 1);
  const LANDMARKS = tfl(96, 2);
  const CAMERA = writeStoredZip([entry('face_detector.tflite', SHORT), entry('face_landmarks_detector.tflite', LANDMARKS)]);
  const FULL = tfl(80, 3);
  async function makeWith(detector?: () => Uint8Array | null) {
    const { createTracker } = await load();
    return createTracker({ modelBuffer: CAMERA, fullRangeDetector: detector, wasmBase: '/wasm', delegate: 'auto', onStateChange: (s) => states.push(s) });
  }
  type Sent = { baseOptions?: { modelAssetBuffer: Uint8Array }; runningMode?: string; numFaces?: number };
  const sent = (lm: FakeLandmarkerT) => lm.setOptions.mock.calls.map((c) => c[0] as Sent);
  /** a setOptions call as its shape: the model as 'camera' (the very buffer), 'photo' (camera bundle + FULL) or absent */
  const shape = (o: Sent) => {
    const buf = o.baseOptions?.modelAssetBuffer;
    const model = !buf ? undefined : buf === CAMERA ? 'camera' : isPhoto(buf) ? 'photo' : 'other';
    return { ...(model ? { model } : {}), runningMode: o.runningMode, numFaces: o.numFaces };
  };
  const isPhoto = (buf: Uint8Array) => {
    const e = readStoredZip(buf);
    const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
    return e.length === 2 && e[0].name === 'face_detector.tflite' && same(e[0].data, FULL) && e[1].name === 'face_landmarks_detector.tflite' && same(e[1].data, LANDMARKS);
  };

  it('is created with the camera bundle; a photo switches to the photo bundle (the camera bundle with the detector) in the same setOptions as runningMode and numFaces', async () => {
    const t = await makeWith(() => FULL);
    const lm = last();
    expect(lm.opts.baseOptions.modelAssetBuffer).toBe(CAMERA);
    expect(t.photoDetector).toBe('full-range');
    expect(t.detectImage(image, { maxFaces: 8 })).toHaveLength(1);
    t.detectImage(image, { maxFaces: 8 });
    expect(sent(lm).map(shape)).toEqual([{ model: 'photo', runningMode: 'IMAGE', numFaces: 8 }]);
    expect(t.detectVideo(video, 1, ONE)).not.toBeNull();
    expect(sent(lm).map(shape)).toEqual([
      { model: 'photo', runningMode: 'IMAGE', numFaces: 8 },
      { model: 'camera', runningMode: 'VIDEO', numFaces: LIVE_DETECT_FACES },
    ]);
  });

  it('keeps no photo bundle: every switch to it assembles a new one (MediaPipe copies what it is given)', async () => {
    const t = await makeWith(() => FULL);
    const lm = last();
    t.detectImage(image, { maxFaces: 8 });
    t.detectVideo(video, 1, ONE);
    t.detectImage(image, { maxFaces: 8 });
    const [a, , b] = sent(lm).map((o) => o.baseOptions!.modelAssetBuffer);
    expect(isPhoto(a) && isPhoto(b)).toBe(true);
    expect(a).not.toBe(b);
  });

  it('reads the detector at each switch to a photo: none yet → photos run the camera bundle; the first photo after it arrives switches (C4)', async () => {
    let det: Uint8Array | null = null;
    const t = await makeWith(() => det);
    const lm = last();
    expect(t.photoDetector).toBe('short-range');
    t.detectImage(image, { maxFaces: 8 });
    expect(sent(lm).map(shape)).toEqual([{ runningMode: 'IMAGE', numFaces: 8 }]);
    det = FULL;
    expect(t.photoDetector).toBe('full-range');
    t.detectImage(image, { maxFaces: 8 });
    expect(sent(lm).map(shape)).toEqual([
      { runningMode: 'IMAGE', numFaces: 8 },
      { model: 'photo', runningMode: 'IMAGE', numFaces: 8 },
    ]);
  });

  it("detector 'camera' runs the camera bundle in IMAGE (the short-range retry, S §6.5); the camera then switches mode only, the next photo back to the photo bundle", async () => {
    const t = await makeWith(() => FULL);
    const lm = last();
    t.detectImage(image, { maxFaces: EDIT_DETECT_FACES });
    expect(t.detectImage(image, { maxFaces: EDIT_DETECT_FACES, detector: 'camera' })).toHaveLength(1);
    t.detectImage(image, { maxFaces: EDIT_DETECT_FACES, detector: 'camera' });
    t.detectVideo(video, 1, ONE);
    t.detectImage(image, { maxFaces: EDIT_DETECT_FACES });
    expect(sent(lm).map(shape)).toEqual([
      { model: 'photo', runningMode: 'IMAGE', numFaces: EDIT_DETECT_FACES },
      { model: 'camera', runningMode: 'IMAGE', numFaces: EDIT_DETECT_FACES },
      { runningMode: 'VIDEO', numFaces: LIVE_DETECT_FACES },
      { model: 'photo', runningMode: 'IMAGE', numFaces: EDIT_DETECT_FACES },
    ]);
    expect(lm.detect).toHaveBeenCalledTimes(4);
  });

  it('a detector the photo bundle cannot be assembled from is refused once (logged): photos stay on the camera bundle', async () => {
    const warn = vi.mocked(console.warn);
    const notTflite = new Uint8Array(80).fill(9);
    const t = await makeWith(() => notTflite);
    const lm = last();
    expect(t.detectImage(image, { maxFaces: 8 })).toHaveLength(1);
    expect(t.photoDetector).toBe('short-range');
    t.detectImage(image, { maxFaces: 8 });
    expect(sent(lm).map(shape)).toEqual([{ runningMode: 'IMAGE', numFaces: 8 }]);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('photo model'))).toHaveLength(1);
  });

  it('a camera bundle that is not a stored zip leaves photos on it', async () => {
    const { createTracker } = await load();
    const shipped = new Uint8Array(50).fill(3);
    const t = await createTracker({ modelBuffer: shipped, fullRangeDetector: () => FULL, wasmBase: '/wasm', delegate: 'auto' });
    t.detectImage(image, { maxFaces: 8 });
    expect(last().setOptions.mock.calls).toEqual([[{ runningMode: 'IMAGE', numFaces: 8 }]]);
    expect(t.photoDetector).toBe('short-range');
  });

  it('the camera never carries a model: a count change in VIDEO sends runningMode and numFaces only', async () => {
    const t = await makeWith(() => FULL);
    const lm = last();
    t.detectVideo(video, 1, ONE);
    expect(lm.setOptions).not.toHaveBeenCalled();
    t.detectVideo(video, 2, { maxFaces: 1 });
    expect(lm.setOptions.mock.calls).toEqual([[{ runningMode: 'VIDEO', numFaces: 1 }]]);
  });

  it('without a detector (no getter, or a getter answering null or throwing) photos keep the camera bundle and no setOptions carries one', async () => {
    for (const det of [undefined, () => null, () => {
      throw new Error('services gone');
    }]) {
      const t = await makeWith(det);
      const lm = last();
      t.detectImage(image, { maxFaces: 8 });
      t.detectImage(image, { maxFaces: 8, detector: 'camera' });
      t.detectVideo(video, 1, ONE);
      expect(lm.setOptions.mock.calls).toEqual([[{ runningMode: 'IMAGE', numFaces: 8 }], [{ runningMode: 'VIDEO', numFaces: LIVE_DETECT_FACES }]]);
      expect(t.photoDetector).toBe('short-range');
      t.close();
    }
  });

  it('a replacement after a lost context is built on the camera bundle and gets the photo bundle with the next photo', async () => {
    const t = await makeWith(() => FULL);
    t.detectImage(image, { maxFaces: 8 }); // the lost graph held the photo bundle
    last().canvas!.lose(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(h.created).toHaveLength(2);
    const second = last();
    expect(second.opts.baseOptions.modelAssetBuffer).toBe(CAMERA);
    expect(t.detectImage(image, { maxFaces: 8 })).toHaveLength(1);
    expect(sent(second).map(shape)).toEqual([{ model: 'photo', runningMode: 'IMAGE', numFaces: 8 }]);
    t.detectVideo(video, 1, ONE);
    expect(shape(sent(second)[1])).toEqual({ model: 'camera', runningMode: 'VIDEO', numFaces: LIVE_DETECT_FACES });
  });

  it('a replacement made while the camera runs stays on the camera bundle without a setOptions', async () => {
    const t = await makeWith(() => FULL);
    t.detectVideo(video, 1, ONE);
    last().canvas!.lose(true);
    await vi.advanceTimersByTimeAsync(500);
    const second = last();
    expect(t.detectVideo(video, 2, ONE)).not.toBeNull();
    expect(second.setOptions).not.toHaveBeenCalled();
  });

  it('the in-place rebuild after a failed photo inference keeps the photo bundle without resending it', async () => {
    const t = await makeWith(() => FULL);
    const lm = last();
    lm.detect.mockImplementationOnce(() => {
      throw new Error('Graph has errors');
    });
    expect(() => t.detectImage(image, { maxFaces: 8 })).toThrow('Graph');
    expect(t.detectImage(image, { maxFaces: 8 })).toHaveLength(1);
    expect(sent(lm).map(shape)).toEqual([
      { model: 'photo', runningMode: 'IMAGE', numFaces: 8 },
      { runningMode: 'IMAGE', numFaces: 8 },
    ]);
  });

  it('a synchronously throwing model switch still counts as switched (the bundle sets the model before rebuilding)', async () => {
    const t = await makeWith(() => FULL);
    const lm = last();
    lm.setOptions.mockImplementationOnce(() => {
      throw new Error('close old graph');
    });
    expect(t.detectImage(image, { maxFaces: 8 })).toHaveLength(1);
    t.detectImage(image, { maxFaces: 8 });
    t.detectVideo(video, 1, ONE);
    expect(sent(lm).map(shape)).toEqual([
      { model: 'photo', runningMode: 'IMAGE', numFaces: 8 },
      { model: 'camera', runningMode: 'VIDEO', numFaces: LIVE_DETECT_FACES },
    ]);
  });

  // v0.6 camera per person (spec §6.3, §6.6): the back camera's detector in VIDEO, the group path's views, warm-up
  it("detectVideo with detector 'photo' runs the photo bundle in VIDEO, switching once; the default stays the camera bundle", async () => {
    const t = await makeWith(() => FULL);
    const lm = last();
    t.detectVideo(video, 1, { maxFaces: LIVE_DETECT_FACES, detector: 'photo' });
    t.detectVideo(video, 2, { maxFaces: LIVE_DETECT_FACES, detector: 'photo' });
    expect(sent(lm).map(shape)).toEqual([{ model: 'photo', runningMode: 'VIDEO', numFaces: LIVE_DETECT_FACES }]);
    t.detectVideo(video, 3, ONE);
    expect(sent(lm).map(shape).at(-1)).toEqual({ model: 'camera', runningMode: 'VIDEO', numFaces: LIVE_DETECT_FACES });
  });

  it('detectImage takes an OffscreenCanvas (a group-path view)', async () => {
    const t = await makeWith(() => FULL);
    const c = new OffscreenCanvas(720, 720);
    expect(t.detectImage(c, { maxFaces: EDIT_DETECT_FACES })).toHaveLength(1);
    expect(last().detect).toHaveBeenCalledWith(c);
  });

  it('detectView: IMAGE on a view with the live guards: null while the rebuild throttle holds or the instance is dead (detectImage says [] there), [] for no face', async () => {
    const { REBUILD_INTERVAL_MS } = await load();
    const t = await makeWith(() => FULL);
    const lm = last();
    const v = new OffscreenCanvas(720, 720);
    const o = { maxFaces: EDIT_DETECT_FACES, detector: 'photo' } as const;
    expect(t.detectView(v, o)).toHaveLength(1);
    expect(lm.detect).toHaveBeenCalledWith(v);
    expect(sent(lm).map(shape).at(-1)).toEqual({ model: 'photo', runningMode: 'IMAGE', numFaces: EDIT_DETECT_FACES });
    lm.detect.mockImplementation(() => {
      throw new Error('Graph has errors');
    });
    expect(() => t.detectView(v, o)).toThrow(); // failure 1
    expect(() => t.detectView(v, o)).toThrow(); // the immediate rebuild, failure 2
    expect(t.detectView(v, o)).toBeNull(); // throttled: no inference, no answer
    expect(lm.detect).toHaveBeenCalledTimes(3);
    lm.detect.mockImplementation(() => ({ faceLandmarks: [] }));
    vi.advanceTimersByTime(REBUILD_INTERVAL_MS);
    expect(t.detectView(v, o)).toEqual([]);
    lm.canvas!.lose(false); // found by the poll: the instance is retired and replaced
    expect(t.detectView(v, o)).toBeNull();
    expect(t.detectImage(image, { maxFaces: EDIT_DETECT_FACES })).toEqual([]);
  });

  it('detectView answers null for an empty view or a closed tracker, without an inference', async () => {
    const t = await makeWith(() => FULL);
    const lm = last();
    expect(t.detectView(new OffscreenCanvas(0, 720), { maxFaces: EDIT_DETECT_FACES, detector: 'photo' })).toBeNull();
    t.close();
    expect(t.detectView(new OffscreenCanvas(720, 720), { maxFaces: EDIT_DETECT_FACES, detector: 'photo' })).toBeNull();
    expect(lm.detect).not.toHaveBeenCalled();
    expect(lm.setOptions).not.toHaveBeenCalled();
  });

  it("a replacement made while full-range VIDEO ran starts on the camera bundle; the next detectVideo with detector 'photo' switches it back", async () => {
    const t = await makeWith(() => FULL);
    t.detectVideo(video, 1, { maxFaces: LIVE_DETECT_FACES, detector: 'photo' });
    last().canvas!.lose(true);
    await vi.advanceTimersByTimeAsync(500);
    const second = last();
    expect(second.opts.baseOptions.modelAssetBuffer).toBe(CAMERA);
    t.detectVideo(video, 2, { maxFaces: LIVE_DETECT_FACES, detector: 'photo' });
    expect(sent(second).map(shape)).toEqual([{ model: 'photo', runningMode: 'VIDEO', numFaces: LIVE_DETECT_FACES }]);
  });

  it.each([
    ['IMAGE', 'photo', { model: 'photo', runningMode: 'IMAGE', numFaces: EDIT_DETECT_FACES }, 'detect'],
    // the graph holds the photo bundle from the detectImage below, so going back to VIDEO carries the camera bundle
    ['VIDEO', 'camera', { model: 'camera', runningMode: 'VIDEO', numFaces: LIVE_DETECT_FACES }, 'detectForVideo'],
    ['VIDEO', 'photo', { model: 'photo', runningMode: 'VIDEO', numFaces: LIVE_DETECT_FACES }, 'detectForVideo'],
  ] as const)('warm(%s, %s) switches the graph and runs one call on a 64 × 64 blank canvas', async (mode, det, want, call) => {
    const t = await makeWith(() => FULL);
    const lm = last();
    if (mode === 'VIDEO' && det === 'camera') t.detectImage(image, { maxFaces: 8 }); // leave VIDEO first
    t.warm(mode, det);
    expect(sent(lm).map(shape).at(-1)).toEqual(want);
    const arg = lm[call].mock.calls.at(-1)![0] as FakeCanvas;
    expect([arg.width, arg.height]).toEqual([64, 64]);
  });

  it('warm in VIDEO keeps the timestamps strictly increasing for the live loop that follows', async () => {
    const t = await makeWith(() => FULL);
    const lm = last();
    t.warm('VIDEO', 'camera'); // before any frame
    t.detectVideo(video, 5000, ONE);
    t.warm('VIDEO', 'camera');
    t.detectVideo(video, 5000, ONE);
    const ts = lm.detectForVideo.mock.calls.map((c) => c[1] as number);
    expect(ts).toHaveLength(4);
    expect(ts.every((x) => Number.isFinite(x))).toBe(true);
    for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThan(ts[i - 1]);
  });

  it('warm never throws: a closed tracker or a throwing inference is a no-op (noted once)', async () => {
    const t = await makeWith(() => FULL);
    last().detect.mockImplementation(() => {
      throw new Error('graph');
    });
    expect(() => t.warm('IMAGE', 'photo')).not.toThrow();
    t.close();
    expect(() => t.warm('VIDEO', 'camera')).not.toThrow();
  });
});
