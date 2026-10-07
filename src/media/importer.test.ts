import { afterEach, describe, expect, it, vi } from 'vitest';
import { fitLongEdge, importViaBitmap } from './importer';

describe('fitLongEdge', () => {
  it('downscales so the long edge equals the limit, keeping aspect', () => {
    expect(fitLongEdge(4032, 3024, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(fitLongEdge(3024, 4032, 2048)).toEqual({ width: 1536, height: 2048 });
    expect(fitLongEdge(1000, 1500, 1440)).toEqual({ width: 960, height: 1440 });
    expect(fitLongEdge(8064, 6048, 1440)).toEqual({ width: 1440, height: 1080 });
  });

  it('never upscales', () => {
    expect(fitLongEdge(1000, 1500, 2048)).toEqual({ width: 1000, height: 1500 });
    expect(fitLongEdge(2048, 2048, 2048)).toEqual({ width: 2048, height: 2048 });
    expect(fitLongEdge(10, 5, Infinity)).toEqual({ width: 10, height: 5 });
  });

  it('rounds to whole pixels and keeps extreme aspect ratios at least 1 px', () => {
    expect(fitLongEdge(3001, 2001, 1000)).toEqual({ width: 1000, height: 667 });
    expect(fitLongEdge(20000, 3, 2000)).toEqual({ width: 2000, height: 1 });
  });

  it('degenerate input', () => {
    expect(fitLongEdge(0, 100, 50)).toEqual({ width: 0, height: 0 });
    expect(fitLongEdge(Number.NaN, 100, 50)).toEqual({ width: 0, height: 0 });
    expect(fitLongEdge(100, 100, 0)).toEqual({ width: 1, height: 1 });
  });

  it('long edge is exactly the limit for every aspect', () => {
    for (let w = 1500; w <= 6000; w += 37) {
      const { width, height } = fitLongEdge(w, 3000, 2048);
      expect(Math.max(width, height)).toBe(2048);
    }
  });
});

// ── importViaBitmap against simulated engines (headless Chromium only exercises the spec behaviour) ──

interface FakeFile {
  rawW: number;
  rawH: number;
  /** EXIF orientation ≥ 5: displayed axes are swapped */
  rot: boolean;
}

interface FakeBitmap {
  width: number;
  height: number;
  /** x-scale / y-scale of the picture relative to its displayed original: 1 = undistorted */
  distortion: number;
  close: ReturnType<typeof vi.fn>;
}

interface FakeCanvas {
  width: number;
  height: number;
  drawn: { distortion: number } | null;
}

/** spec: resize* in displayed axes · preRotate: resize* in stored axes, then rotate · ignoreResize: no resize support */
type Mode = 'spec' | 'preRotate' | 'ignoreResize';

function stubEngine(mode: Mode) {
  const calls: (ImageBitmapOptions | undefined)[] = [];
  const made: FakeBitmap[] = [];
  const bitmap = (width: number, height: number, distortion: number): FakeBitmap => {
    const b = { width, height, distortion, close: vi.fn() };
    made.push(b);
    return b;
  };
  vi.stubGlobal('createImageBitmap', async (src: FakeFile | FakeCanvas, opts?: ImageBitmapOptions) => {
    calls.push(opts);
    if ('drawn' in src) return bitmap(src.width, src.height, src.drawn?.distortion ?? Number.NaN); // canvas fallback
    const [ow, oh] = src.rot ? [src.rawH, src.rawW] : [src.rawW, src.rawH];
    const rw = opts?.resizeWidth;
    const rh = opts?.resizeHeight;
    if (!rw || !rh || mode === 'ignoreResize') return bitmap(ow, oh, 1);
    if (mode === 'spec') return bitmap(rw, rh, rw / ow / (rh / oh));
    // preRotate: the stored image is scaled to rw×rh, then rotated for display (axes swap when rot)
    const sx = rw / src.rawW;
    const sy = rh / src.rawH;
    return src.rot ? bitmap(rh, rw, sy / sx) : bitmap(rw, rh, sx / sy);
  });
  vi.stubGlobal('document', {
    createElement: () => {
      const c: FakeCanvas & { getContext(): unknown } = {
        width: 0,
        height: 0,
        drawn: null,
        getContext: () => ({
          drawImage: (img: FakeBitmap, _x: number, _y: number, w: number, h: number) => {
            c.drawn = { distortion: (img.distortion * (w / img.width)) / (h / img.height) };
          },
        }),
      };
      return c;
    },
  });
  return { calls, made };
}

describe('importViaBitmap', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  /** header probe: oriented size without decoding (what <img>.naturalWidth/Height report) */
  const header = async (f: Blob) => {
    const { rawW, rawH, rot } = f as unknown as FakeFile;
    return rot ? { width: rawH, height: rawW } : { width: rawW, height: rawH };
  };
  const run = (f: FakeFile, edge: number, probe = header) =>
    importViaBitmap(f as unknown as Blob, edge, probe) as unknown as Promise<FakeBitmap>;
  const portrait: FakeFile = { rawW: 4032, rawH: 3024, rot: true }; // iPhone portrait shot, EXIF 6
  const landscape: FakeFile = { rawW: 4032, rawH: 3024, rot: false };

  const cases: [string, FakeFile, [number, number]][] = [
    ['portrait EXIF 6', portrait, [1536, 2048]],
    ['landscape', landscape, [2048, 1536]],
  ];
  for (const mode of ['spec', 'preRotate', 'ignoreResize'] as const) {
    for (const [label, file, want] of cases) {
      it(`${mode} engine, ${label} → ${want.join('×')}, undistorted`, async () => {
        const { made } = stubEngine(mode);
        const bmp = await run(file, 2048);
        expect([bmp.width, bmp.height]).toEqual(want);
        expect(bmp.distortion).toBeCloseTo(1, 3);
        for (const b of made) if (b !== bmp) expect(b.close).toHaveBeenCalled();
        expect(bmp.close).not.toHaveBeenCalled();
      });
    }
  }

  it('decodes once, unresized, when the image already fits', async () => {
    const { calls } = stubEngine('spec');
    const bmp = await run({ rawW: 1000, rawH: 1500, rot: false }, 2048);
    expect([bmp.width, bmp.height]).toEqual([1000, 1500]);
    expect(calls).toEqual([{ imageOrientation: 'from-image' }]);
  });

  it('asks for high-quality, orientation-aware resizing in displayed axes', async () => {
    const { calls } = stubEngine('spec');
    await run(portrait, 1440);
    expect(calls[0]).toEqual({ imageOrientation: 'from-image', resizeWidth: 1080, resizeHeight: 1440, resizeQuality: 'high' });
  });

  it('never allocates a full-size bitmap for an oversized image on a resize-capable engine', async () => {
    for (const mode of ['spec', 'preRotate'] as const) {
      const { calls } = stubEngine(mode);
      for (const f of [portrait, landscape, { rawW: 8064, rawH: 6048, rot: true }]) await run(f, 2048);
      expect(calls.length).toBeGreaterThan(0);
      for (const c of calls) expect(c?.resizeWidth && c?.resizeHeight).toBeTruthy();
    }
  });

  it('falls back to a createImageBitmap size probe when the header cannot be read', async () => {
    const { calls, made } = stubEngine('spec');
    const unreadable = async () => {
      throw new Error('no header');
    };
    const bmp = await run(portrait, 2048, unreadable);
    expect([bmp.width, bmp.height]).toEqual([1536, 2048]);
    expect(calls[0]).toEqual({ imageOrientation: 'from-image' });
    expect(made[0].close).toHaveBeenCalled();
    // ...and returns that decode as-is when it already fits
    const small = await run({ rawW: 800, rawH: 600, rot: false }, 2048, unreadable);
    expect([small.width, small.height]).toEqual([800, 600]);
    expect(small.close).not.toHaveBeenCalled();
  });
});
