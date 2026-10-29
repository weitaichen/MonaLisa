import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Rect as UvRect } from '../types';
import { createRecordCanvas, recordSize } from './recordCanvas';

// ── minimal fakes (no jsdom): the pieces of document, canvas, 2D context and MediaStream the sink touches ──

/** one call on the 2D context: the method, then its arguments */
type Call = [string, ...unknown[]];

class FakeTrack {
  stops = 0;
  stop() {
    this.stops++;
  }
}

/** A detached canvas that remembers how it was set up and logs what is done to its context, in order. */
class FakeCanvas {
  // a new <canvas> is 300 × 150: the recording canvas has to size it itself
  width = 300;
  height = 150;
  /** getContext(type, options) of every call */
  contextAsks: [string, unknown][] = [];
  /** captureStream(fps) of every call */
  captureAsks: (number | undefined)[] = [];
  /** false: getContext answers null, as a browser out of canvas memory does */
  hasContext = true;
  readonly track = new FakeTrack();
  /** tracks added to the stream after the canvas made it (addTrack) */
  readonly added: FakeTrack[] = [];
  readonly stream = { getTracks: () => [this.track, ...this.added] } as unknown as MediaStream;
  /** every setTransform / drawImage on the context, in order */
  readonly calls: Call[] = [];
  /** starts with smoothing off, so a test that sees it on knows the sink switched it on */
  readonly ctx = {
    imageSmoothingEnabled: false,
    setTransform: (...a: number[]) => this.calls.push(['setTransform', ...a]),
    drawImage: (...a: unknown[]) => this.calls.push(['drawImage', ...a]),
  };
  getContext(type: string, options?: unknown) {
    this.contextAsks.push([type, options]);
    return this.hasContext ? this.ctx : null;
  }
  captureStream(fps?: number) {
    this.captureAsks.push(fps);
    return this.stream;
  }
}

/** A document that only makes canvases (it has no body to attach one to, and any other tag throws). */
function fakeDoc(over: Partial<FakeCanvas> = {}) {
  const made: FakeCanvas[] = [];
  const doc = {
    createElement(tag: string) {
      if (tag !== 'canvas') throw new Error(`unexpected <${tag}>`);
      const canvas = Object.assign(new FakeCanvas(), over);
      made.push(canvas);
      return canvas;
    },
  } as unknown as Document;
  return { doc, made };
}

/** a recording canvas of the given size on a fake document */
function setup(width: number, height: number) {
  const { doc, made } = fakeDoc();
  const rc = createRecordCanvas(width, height, doc);
  return { rc, canvas: made[0], made };
}

type Source = CanvasImageSource & { width: number; height: number };
/** the engine's canvas: only its size matters here, the fake context never reads pixels */
const source = (width: number, height: number): Source => ({ width, height }) as unknown as Source;

/** the 3:4 picture frame of a 9:16 source: the middle three quarters of its height */
const CROP: UvRect = { x: 0, y: 0.125, w: 1, h: 0.75 };

// ── recordSize ──

describe('recordSize', () => {
  it.each([
    [1080, 1440, 1080, 1440],
    [1080, 1920, 1080, 1920],
    [1920, 1080, 1920, 1080],
    [720, 960, 720, 960],
  ])('keeps a crop that already fits: %i×%i is %i×%i', (w, h, width, height) => {
    expect(recordSize(w, h)).toEqual({ width, height });
  });

  it.each([
    [2160, 2880, 1080, 1440],
    [2880, 2160, 1440, 1080],
    [1440, 1440, 1080, 1080],
  ])('scales a bigger crop down to a short edge of 1080: %i×%i is %i×%i', (w, h, width, height) => {
    expect(recordSize(w, h)).toEqual({ width, height });
  });

  it.each([
    [1080, 2400, 864, 1920],
    [2400, 1080, 1920, 864],
  ])('keeps the long edge at 1920: %i×%i is %i×%i', (w, h, width, height) => {
    expect(recordSize(w, h)).toEqual({ width, height });
  });

  it('rounds down to even and never upscales', () => {
    expect(recordSize(721, 961)).toEqual({ width: 720, height: 960 });
    expect(recordSize(539, 959)).toEqual({ width: 538, height: 958 });
    // a crop in canvas pixels is a UV fraction times the canvas size, so it may be fractional
    expect(recordSize(607.5, 1080)).toEqual({ width: 606, height: 1080 });
  });

  it('keeps both sides even after scaling', () => {
    // 1200 × 1850 → ×0.9 → 1080 × 1665, and 999 × 2500 → ×0.768 → 767.2 × 1920: an odd side drops to the even below
    expect(recordSize(1200, 1850)).toEqual({ width: 1080, height: 1664 });
    expect(recordSize(999, 2500)).toEqual({ width: 766, height: 1920 });
  });

  it('lands exactly on the cap when float error would leave it a hair short', () => {
    // h × (1920 / h) is 1919.9999999999998 for some h: a plain floor would give 1918
    for (let h = 1921; h <= 4000; h++) expect(recordSize(1000, h).height, `1000 × ${h}`).toBe(1920);
    for (let w = 1921; w <= 4000; w++) expect(recordSize(w, 1000).width, `${w} × 1000`).toBe(1920);
    for (let n = 1081; n <= 4000; n++) expect(recordSize(n, n), `${n} × ${n}`).toEqual({ width: 1080, height: 1080 });
  });

  it('is not thrown off by float noise in a UV × pixels crop size', () => {
    expect(recordSize(1079.9999999999998, 1439.9999999999998)).toEqual({ width: 1080, height: 1440 });
    expect(recordSize(1080.0000000000002, 1440.0000000000002)).toEqual({ width: 1080, height: 1440 });
  });
});

// ── createRecordCanvas ──

describe('createRecordCanvas', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('makes one detached canvas of the given size with an opaque 2D context and a 30 fps stream', () => {
    const { rc, canvas, made } = setup(1080, 1440);
    expect(made).toHaveLength(1);
    expect([canvas.width, canvas.height]).toEqual([1080, 1440]);
    expect(canvas.contextAsks).toEqual([['2d', { alpha: false }]]);
    expect(canvas.captureAsks).toEqual([30]);
    expect(rc.stream).toBe(canvas.stream);
    expect([rc.width, rc.height]).toEqual([1080, 1440]);
  });

  it('throws when the browser has no 2D context to give', () => {
    const { doc } = fakeDoc({ hasContext: false });
    expect(() => createRecordCanvas(1080, 1440, doc)).toThrow('2D canvas unavailable');
  });

  it('uses the global document when none is given', () => {
    const { doc, made } = fakeDoc();
    vi.stubGlobal('document', doc);
    const rc = createRecordCanvas(8, 6);
    expect(made).toHaveLength(1);
    expect([made[0].width, made[0].height]).toEqual([8, 6]);
    expect([rc.width, rc.height]).toEqual([8, 6]);
  });
});

// ── the sink ──

describe('the sink', () => {
  it('frame() draws the crop of the source into the whole canvas', () => {
    const { rc, canvas } = setup(720, 960);
    const src = source(1080, 1920);
    rc.sink.frame(src, CROP, false);
    // the crop is UV × the source's pixels; the destination is the whole canvas, not the crop's size
    expect(canvas.calls).toEqual([['drawImage', src, 0, 240, 1080, 1440, 0, 0, 720, 960]]);
    expect(canvas.calls[0][1]).toBe(src);
    expect(canvas.ctx.imageSmoothingEnabled).toBe(true);
  });

  it('frame() maps each field of the crop to its own axis of the source', () => {
    const { rc, canvas } = setup(600, 300);
    const src = source(800, 400);
    rc.sink.frame(src, { x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, false);
    // x and w scale by the width, y and h by the height: 200 / 400 / 200 / 100, and no other pairing gives these
    expect(canvas.calls).toEqual([['drawImage', src, 200, 200, 400, 100, 0, 0, 600, 300]]);
  });

  it('frame() keeps the crop exactly UV × pixels, even between two pixels', () => {
    const { rc, canvas } = setup(720, 960);
    const src = source(960, 540); // the 1280 × 720 camera frame drawn at the 540 tier
    // the 3:4 crop of that frame, centred: x = 370 / 1280, w = 540 / 1280
    rc.sink.frame(src, { x: 0.2890625, y: 0, w: 0.421875, h: 1 }, false);
    expect(canvas.calls).toEqual([['drawImage', src, 277.5, 0, 405, 540, 0, 0, 720, 960]]);
  });

  it('frame() mirrors when flipX', () => {
    const { rc, canvas } = setup(720, 960);
    const src = source(1080, 1920);
    rc.sink.frame(src, CROP, true);
    expect(canvas.calls).toEqual([
      ['setTransform', -1, 0, 0, 1, 720, 0],
      ['drawImage', src, 0, 240, 1080, 1440, 0, 0, 720, 960],
      ['setTransform', 1, 0, 0, 1, 0, 0],
    ]);
  });

  it('frame() does not change the transform when it is not mirroring', () => {
    const { rc, canvas } = setup(720, 960);
    rc.sink.frame(source(1080, 1920), CROP, false);
    expect(canvas.calls.map(([method]) => method)).toEqual(['drawImage']);
  });

  it('frame() leaves no mirror behind for the next frame', () => {
    const { rc, canvas } = setup(720, 960);
    const src = source(1080, 1920);
    rc.sink.frame(src, CROP, true);
    rc.sink.frame(src, CROP, false);
    // the second frame is drawn after the reset and sets nothing of its own
    expect(canvas.calls.map(([method]) => method)).toEqual(['setTransform', 'drawImage', 'setTransform', 'drawImage']);
    expect(canvas.calls[2]).toEqual(['setTransform', 1, 0, 0, 1, 0, 0]);
  });

  it('frame() scales a smaller source into the fixed canvas', () => {
    const { rc, canvas } = setup(1080, 1440);
    const big = source(1080, 1920);
    const small = source(540, 960); // the auto tier stepped down
    rc.sink.frame(big, CROP, false);
    rc.sink.frame(small, CROP, false);
    expect(canvas.calls).toEqual([
      ['drawImage', big, 0, 240, 1080, 1440, 0, 0, 1080, 1440],
      ['drawImage', small, 0, 120, 540, 720, 0, 0, 1080, 1440],
    ]);
    // W × H unchanged: the encoder never sees a different size
    expect([canvas.width, canvas.height]).toEqual([1080, 1440]);
    expect([rc.width, rc.height]).toEqual([1080, 1440]);
  });
});

// ── release ──

describe('release', () => {
  it('release() stops the stream and frees the canvas', () => {
    const { rc, canvas } = setup(1080, 1440);
    rc.release();
    expect(canvas.track.stops).toBe(1);
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
  });

  it('release() leaves a track added to the stream alone (a microphone track belongs to mic.ts)', () => {
    const { rc, canvas } = setup(1080, 1440);
    const mic = new FakeTrack();
    canvas.added.push(mic); // rc.stream.addTrack(micTrack)
    rc.release();
    expect(canvas.track.stops).toBe(1);
    expect(mic.stops).toBe(0);
  });
});
