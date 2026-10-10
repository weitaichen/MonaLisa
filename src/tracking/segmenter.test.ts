import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mp = vi.hoisted(() => ({
  options: [] as unknown[],
  segment: vi.fn(),
  close: vi.fn(),
}));

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: vi.fn(async () => ({})) },
  ImageSegmenter: {
    createFromOptions: vi.fn(async (_fs: unknown, o: unknown) => {
      mp.options.push(o);
      return { segment: mp.segment, close: mp.close };
    }),
  },
  PoseLandmarker: {},
}));

import { createPersonSegmenter, SEG_INPUT_MAX_EDGE, SegmenterContextLostError } from './segmenter';

class FakeCanvas {
  draws: unknown[][] = [];
  listeners = new Map<string, Set<() => void>>();
  /** what isContextLost() of its WebGL context answers */
  glLost = false;
  /** getContext('webgl2' | 'webgl') calls */
  glGets = 0;
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext(type: string) {
    if (type === 'webgl2' || type === 'webgl') {
      this.glGets++;
      return { isContextLost: () => this.glLost };
    }
    return { drawImage: (...a: unknown[]) => this.draws.push(a) };
  }
  addEventListener(type: string, f: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(f);
  }
  removeEventListener(type: string, f: () => void) {
    this.listeners.get(type)?.delete(f);
  }
  fire(type: string) {
    for (const f of this.listeners.get(type) ?? []) f();
  }
}
/** the GraphRunner canvas handed to createFromOptions */
const glCanvas = (i = 0) => (mp.options[i] as { canvas: FakeCanvas }).canvas;

/** a confidence mask: the left half is the person */
function result(w: number, h: number) {
  const f = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w / 2; x++) f[y * w + x] = 1;
  return { confidenceMasks: [{ width: w, height: h, getAsFloat32Array: () => f }], close: vi.fn() };
}

beforeEach(() => {
  vi.stubGlobal('OffscreenCanvas', FakeCanvas);
  mp.options.length = 0;
  mp.segment.mockReset();
  mp.close.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const opts = { modelBuffer: new Uint8Array(4), wasmBase: '/mediapipe/0.10.35' };
const image = (w: number, h: number) => ({ width: w, height: h }) as unknown as ImageBitmap;

describe('createPersonSegmenter', () => {
  it('builds the CPU IMAGE graph with confidence masks only (the measured, abort-free combination)', async () => {
    await createPersonSegmenter(opts);
    expect(mp.options[0]).toEqual({
      canvas: expect.any(FakeCanvas),
      baseOptions: { modelAssetBuffer: opts.modelBuffer, delegate: 'CPU' },
      runningMode: 'IMAGE',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
  });

  it('segments a ≤ SEG_INPUT_MAX_EDGE copy and returns a ≈ 256 long-edge person mask; results are closed', async () => {
    const s = await createPersonSegmenter(opts);
    const r = result(342, 512);
    mp.segment.mockReturnValue(r);
    const m = s.segment(image(3024, 4032));
    const input = mp.segment.mock.calls[0][0] as FakeCanvas;
    expect([input.width, input.height]).toEqual([384, SEG_INPUT_MAX_EDGE]);
    expect(input.draws[0].slice(1)).toEqual([0, 0, 384, 512]);
    expect(m).not.toBeNull();
    expect(Math.max(m!.width, m!.height)).toBe(256);
    expect(m!.data[0]).toBe(255); // left: person
    expect(m!.data[m!.width - 1]).toBe(0);
    expect(r.close).toHaveBeenCalledTimes(1);
    expect(s.dead).toBe(false);
    expect(s.lost).toBe(false);
  });

  it('an empty mask reads as nobody (null)', async () => {
    const s = await createPersonSegmenter(opts);
    mp.segment.mockReturnValue({ confidenceMasks: [{ width: 4, height: 4, getAsFloat32Array: () => new Float32Array(16) }], close: vi.fn() });
    expect(s.segment(image(40, 40))).toBeNull();
  });

  it('a throw kills the instance (every later call throws); an abort also releases the graph', async () => {
    const s = await createPersonSegmenter(opts);
    mp.segment.mockImplementationOnce(() => {
      throw new Error('inference failed');
    });
    expect(() => s.segment(image(40, 40))).toThrow('inference failed');
    expect(s.dead).toBe(true);
    expect(s.lost).toBe(false); // not a context loss: the caller must not rebuild it
    expect(() => s.segment(image(40, 40))).toThrow();
    expect(mp.close).not.toHaveBeenCalled();

    const t = await createPersonSegmenter(opts);
    mp.segment.mockImplementationOnce(() => {
      throw new Error('Aborted(native code called abort())');
    });
    expect(() => t.segment(image(40, 40))).toThrow('Aborted');
    expect(mp.close).toHaveBeenCalledTimes(1);
    t.close(); // idempotent
    expect(mp.close).toHaveBeenCalledTimes(1);
  });

  // CPU inference still runs the mask postprocessor in the GraphRunner canvas's WebGL2 context (iOS can take it)
  describe('WebGL context loss of the GraphRunner canvas', () => {
    it('owns a 1×1 canvas for the graph and does not make a context on it before the library has', async () => {
      const s = await createPersonSegmenter(opts);
      expect([glCanvas().width, glCanvas().height]).toEqual([1, 1]);
      expect(glCanvas().listeners.get('webglcontextlost')?.size).toBe(1);
      expect(glCanvas().glGets).toBe(0);
      mp.segment.mockReturnValue(result(40, 40));
      s.segment(image(40, 40));
      expect(glCanvas().glGets).toBe(1); // the library's own context, looked up once
      s.segment(image(40, 40));
      expect(glCanvas().glGets).toBe(1);
    });

    it('webglcontextlost between photos: dead + lost at once, the next call throws the loss and releases the graph', async () => {
      const s = await createPersonSegmenter(opts);
      mp.segment.mockReturnValue(result(40, 40));
      expect(s.segment(image(40, 40))).not.toBeNull();
      glCanvas().fire('webglcontextlost');
      expect(s.dead).toBe(true);
      expect(s.lost).toBe(true);
      mp.segment.mockClear();
      expect(() => s.segment(image(40, 40))).toThrow(SegmenterContextLostError);
      expect(mp.segment).not.toHaveBeenCalled();
      expect(mp.close).toHaveBeenCalledTimes(1);
      expect(glCanvas().listeners.get('webglcontextlost')?.size).toBe(0);
      expect(() => s.segment(image(40, 40))).toThrow();
      s.close();
      expect(mp.close).toHaveBeenCalledTimes(1);
    });

    it('a loss with no event between photos: dead + lost already when polled, so the caller rebuilds before segment()', async () => {
      const s = await createPersonSegmenter(opts);
      mp.segment.mockReturnValue(result(40, 40));
      expect(s.segment(image(40, 40))).not.toBeNull();
      glCanvas().glLost = true; // no webglcontextlost event
      expect(s.dead).toBe(true);
      expect(s.lost).toBe(true);
      expect(mp.close).not.toHaveBeenCalled(); // the getters only report: the caller close()s it (or segment() does)
      mp.segment.mockClear();
      expect(() => s.segment(image(40, 40))).toThrow(SegmenterContextLostError);
      expect(mp.segment).not.toHaveBeenCalled();
      expect(mp.close).toHaveBeenCalledTimes(1);
      expect(glCanvas().glGets).toBe(1); // still the one cached lookup of the library's context
    });

    it('a never-run instance is not polled: the getters make no context on the canvas before the library has', async () => {
      const s = await createPersonSegmenter(opts);
      glCanvas().glLost = true;
      expect(s.dead).toBe(false);
      expect(s.lost).toBe(false);
      expect(glCanvas().glGets).toBe(0);
    });

    it('an instance that died of a throw never turns `lost` later (no rebuild of a permanent failure)', async () => {
      const s = await createPersonSegmenter(opts);
      mp.segment.mockReturnValueOnce(result(40, 40));
      s.segment(image(40, 40));
      mp.segment.mockImplementationOnce(() => {
        throw new Error('inference failed');
      });
      expect(() => s.segment(image(40, 40))).toThrow('inference failed');
      glCanvas().glLost = true;
      expect(s.dead).toBe(true);
      expect(s.lost).toBe(false);
    });

    it('a context lost during inference (no event yet): the all-zero mask is never returned as "nobody"', async () => {
      const s = await createPersonSegmenter(opts);
      const blank = { confidenceMasks: [{ width: 4, height: 4, getAsFloat32Array: () => new Float32Array(16) }], close: vi.fn() };
      mp.segment.mockImplementationOnce(() => {
        glCanvas().glLost = true;
        return blank;
      });
      expect(() => s.segment(image(40, 40))).toThrow(SegmenterContextLostError);
      expect(blank.close).toHaveBeenCalledTimes(1);
      expect(s.dead).toBe(true);
      expect(s.lost).toBe(true);
      expect(mp.close).toHaveBeenCalledTimes(1);
    });

    it('a loss that makes the graph throw reads as the loss (the cause kept), not as a permanent failure', async () => {
      const s = await createPersonSegmenter(opts);
      const boom = new Error('texImage2D failed');
      mp.segment.mockImplementationOnce(() => {
        glCanvas().glLost = true;
        throw boom;
      });
      let err: unknown;
      try {
        s.segment(image(40, 40));
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(SegmenterContextLostError);
      expect((err as Error).cause).toBe(boom);
      expect(s.lost).toBe(true);
      expect(mp.close).toHaveBeenCalledTimes(1);
    });

    it('a failed graph creation drops the listener', async () => {
      const { ImageSegmenter } = await import('@mediapipe/tasks-vision');
      vi.mocked(ImageSegmenter.createFromOptions).mockImplementationOnce(async (_fs, o) => {
        mp.options.push(o);
        throw new Error('no graph');
      });
      await expect(createPersonSegmenter(opts)).rejects.toThrow('no graph');
      expect(glCanvas().listeners.get('webglcontextlost')?.size).toBe(0);
    });
  });
});
