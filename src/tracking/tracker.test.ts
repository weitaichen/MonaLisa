// createTracker recovery paths against a fake MediaPipe: lost GL context (event and poll),
// poisoned-graph rebuilds, throttling, escalation, logging and the GPU → CPU last resort.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackerState } from '../types';

const h = vi.hoisted(() => ({
  created: [] as FakeLandmarkerT[],
  /** decides what the next createFromOptions call does (default: succeed) */
  onCreate: null as null | ((o: { canvas?: unknown; baseOptions: { delegate: string } }) => void),
}));

interface FakeLandmarkerT {
  delegate: string;
  canvas: FakeCanvas | undefined;
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
    createFromOptions: vi.fn(async (_fs: unknown, o: { canvas?: FakeCanvas; baseOptions: { delegate: string } }) => {
      h.onCreate?.(o);
      const lm: FakeLandmarkerT = {
        delegate: o.baseOptions.delegate,
        canvas: o.canvas,
        detectForVideo: vi.fn(hit),
        detect: vi.fn(hit),
        setOptions: vi.fn(async () => undefined),
        close: vi.fn(),
      };
      h.created.push(lm);
      return lm;
    }),
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
    expect(t.detectVideo(video, 10)).not.toBeNull();

    first.canvas!.lose(false); // no event: WebKit may not fire it on OffscreenCanvas
    expect(t.detectVideo(video, 20)).toBeNull();
    expect(t.detectImage(image)).toBeNull();
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

    expect(t.detectVideo(video, 5)).not.toBeNull(); // stale timestamp: still strictly increasing
    expect(second.detectForVideo).toHaveBeenCalledTimes(1);
    expect(second.detectForVideo.mock.calls[0][1]).toBeGreaterThan(20);
    expect(second.setOptions).not.toHaveBeenCalled(); // new graph already in VIDEO
    expect(t.detectImage(image)).not.toBeNull();
    expect(second.setOptions).toHaveBeenLastCalledWith({ runningMode: 'IMAGE' });
  });

  it('reacts to the webglcontextlost event and ignores later events from retired canvases', async () => {
    const t = await make();
    const first = last();
    first.canvas!.lose(true);
    expect(states).toEqual(['lost']);
    await vi.advanceTimersByTimeAsync(500);
    expect(h.created).toHaveLength(2);
    first.canvas!.lose(true); // late event from the old canvas
    expect(t.detectVideo(video, 1)).not.toBeNull();
    expect(states).toEqual(['lost', 'ok']);
  });

  it('only watches the context on the GPU delegate', async () => {
    const t = await make('CPU');
    last().canvas!.lose(true);
    expect(t.detectVideo(video, 1)).not.toBeNull();
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
    expect(t.detectVideo(video, 1)).not.toBeNull();
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
    expect(t.detectVideo(video, 1)).not.toBeNull();
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
    expect(t.detectVideo(video, 1)).toBeNull(); // provokes one more attempt
    await vi.advanceTimersByTimeAsync(5000);
    expect(states).toEqual(['lost', 'failed', 'ok']);
    expect(t.detectVideo(video, 2)).not.toBeNull();
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
    expect(t.detectVideo(video, 1)).toBeNull();
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
    expect(() => t.detectVideo(video, 1)).toThrow('ROI');
    expect(t.detectVideo(video, 2)).not.toBeNull();
    expect(lm.setOptions).toHaveBeenCalledWith({ runningMode: 'VIDEO' }); // same-mode rebuild
    expect(t.detectVideo(video, 3)).not.toBeNull();
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
    expect(() => t.detectVideo(video, 1)).toThrow();
    expect(t.detectImage(image)).not.toBeNull();
    expect(lm.setOptions.mock.calls).toEqual([[{ runningMode: 'IMAGE' }]]);
    expect(t.detectVideo(video, 2)).not.toBeNull();
    expect(lm.setOptions.mock.calls).toEqual([[{ runningMode: 'IMAGE' }], [{ runningMode: 'VIDEO' }]]);
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
      expect(() => t.detectImage(image)).toThrow(msg);
      expect(t.detectImage(image)).not.toBeNull(); // resets the consecutive count
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
    expect(() => t.detectVideo(video, 1)).toThrow(); // failure 1
    expect(() => t.detectVideo(video, 2)).toThrow(); // immediate rebuild, failure 2
    expect(lm.setOptions).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 10; i++) expect(t.detectVideo(video, 3 + i)).toBeNull(); // throttled: no inference
    expect(lm.detectForVideo).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(REBUILD_INTERVAL_MS);
    expect(() => t.detectVideo(video, 20)).toThrow(); // second rebuild, failure 3 → escalate
    expect(lm.setOptions).toHaveBeenCalledTimes(2);
    expect(ESCALATE_AFTER).toBe(3);
    expect(states).toEqual(['lost']);
    expect(t.detectVideo(video, 21)).toBeNull();
    await vi.advanceTimersByTimeAsync(500);
    expect(lm.close).toHaveBeenCalled();
    expect(h.created).toHaveLength(2);
    expect(last().delegate).toBe('GPU'); // first replacement stays on GPU
    expect(t.detectVideo(video, 22)).not.toBeNull();
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
          t.detectVideo(video, performance.now());
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
    expect(t.detectVideo(video, performance.now())).not.toBeNull();
  });

  it('a GPU graph that has worked is never moved to CPU by failures', async () => {
    const t = await make();
    expect(t.detectVideo(video, 1)).not.toBeNull();
    for (let round = 0; round < 2; round++) {
      last().detectForVideo.mockImplementation(() => {
        throw new Error('Graph has errors');
      });
      for (let i = 0; i < 3; i++) {
        try {
          t.detectVideo(video, performance.now());
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
        t.detectVideo(video, performance.now());
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
    expect(t.detectVideo(video, performance.now())).not.toBeNull();
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
