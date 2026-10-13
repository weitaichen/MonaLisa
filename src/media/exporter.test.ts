import { afterEach, describe, expect, it, vi } from 'vitest';
import { canShareFiles, createSurface, encodeOutput, encodePng, jpegFileName, outputFileName, saveFile } from './exporter';

describe('jpegFileName', () => {
  it('is meiyan-YYYYMMDD-HHMMSS.jpg in local time, zero-padded', () => {
    expect(jpegFileName(new Date(2026, 9, 7, 9, 5, 3))).toBe('meiyan-20261007-090503.jpg');
    expect(jpegFileName(new Date(2027, 0, 1, 23, 59, 59))).toBe('meiyan-20270101-235959.jpg');
  });
  it('defaults to now', () => {
    expect(jpegFileName()).toMatch(/^meiyan-\d{8}-\d{6}\.jpg$/);
  });
});

describe('saveFile', () => {
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'meiyan-20261007-090503.jpg', {
    type: 'image/jpeg',
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubShare(share: (d: ShareData) => Promise<void>, canShare: (d?: ShareData) => boolean = () => true) {
    const nav = { share: vi.fn(share), canShare: vi.fn(canShare) };
    vi.stubGlobal('navigator', nav);
    return nav;
  }

  it('calls navigator.share synchronously with only the file', async () => {
    const nav = stubShare(() => Promise.resolve());
    const p = saveFile(file);
    expect(nav.share).toHaveBeenCalledTimes(1); // before any microtask: still inside the tap
    expect(nav.share).toHaveBeenCalledWith({ files: [file] });
    await expect(p).resolves.toBe('shared');
  });

  it('AbortError → cancelled', async () => {
    stubShare(() => Promise.reject(new DOMException('user cancelled', 'AbortError')));
    await expect(saveFile(file)).resolves.toBe('cancelled');
  });

  it('other rejections (no activation, busy) → fallback', async () => {
    stubShare(() => Promise.reject(new DOMException('no gesture', 'NotAllowedError')));
    await expect(saveFile(file)).resolves.toBe('fallback');
    stubShare(() => Promise.reject(new DOMException('busy', 'InvalidStateError')));
    await expect(saveFile(file)).resolves.toBe('fallback');
  });

  it('a synchronous throw → fallback', async () => {
    stubShare(() => {
      throw new TypeError('bad');
    });
    await expect(saveFile(file)).resolves.toBe('fallback');
  });

  it('canShare false or missing → fallback without calling share', async () => {
    const nav = stubShare(
      () => Promise.resolve(),
      () => false,
    );
    expect(canShareFiles(file)).toBe(false);
    await expect(saveFile(file)).resolves.toBe('fallback');
    expect(nav.share).not.toHaveBeenCalled();

    vi.stubGlobal('navigator', { share: () => Promise.resolve() });
    expect(canShareFiles(file)).toBe(false);
    await expect(saveFile(file)).resolves.toBe('fallback');
  });

  it('canShare throwing is treated as unsupported', () => {
    stubShare(
      () => Promise.resolve(),
      () => {
        throw new TypeError('files not supported');
      },
    );
    expect(canShareFiles(file)).toBe(false);
  });

  it('canShare is asked about files', () => {
    const nav = stubShare(() => Promise.resolve());
    expect(canShareFiles(file)).toBe(true);
    expect(nav.canShare).toHaveBeenCalledWith({ files: [file] });
  });
});

describe('outputFileName', () => {
  it('names JPEG .jpg and PNG .png with the meiyan- prefix', () => {
    const d = new Date(2026, 9, 12, 8, 4, 2);
    expect(outputFileName('jpeg', d)).toBe('meiyan-20261012-080402.jpg');
    expect(outputFileName('png', d)).toBe('meiyan-20261012-080402.png');
    expect(jpegFileName(d)).toBe(outputFileName('jpeg', d));
  });
});

describe('encodeOutput', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  interface Rec {
    ctxOpts: unknown;
    blobOpts: ImageEncodeOptions | undefined;
    put: unknown[][];
  }
  /** an OffscreenCanvas stand-in that records its context options and encode calls */
  function stubOffscreen(): Rec[] {
    const made: Rec[] = [];
    class FakeOC {
      width: number;
      height: number;
      rec: Rec = { ctxOpts: undefined, blobOpts: undefined, put: [] };
      constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
        made.push(this.rec);
      }
      getContext(_type: string, opts?: unknown) {
        this.rec.ctxOpts = opts;
        return { putImageData: (...a: unknown[]) => this.rec.put.push(a) };
      }
      convertToBlob(opts?: ImageEncodeOptions) {
        this.rec.blobOpts = opts;
        return Promise.resolve(new Blob(['x'], { type: opts?.type ?? 'image/png' }));
      }
    }
    vi.stubGlobal('OffscreenCanvas', FakeOC);
    return made;
  }
  const img = { width: 3, height: 2, data: new Uint8ClampedArray(24) } as unknown as ImageData;

  it('JPEG: image/jpeg at the given quality, an opaque surface, a .jpg File', async () => {
    const made = stubOffscreen();
    const f = await encodeOutput(img, 'jpeg', 0.95);
    expect(f.type).toBe('image/jpeg');
    expect(f.name).toMatch(/^meiyan-\d{8}-\d{6}\.jpg$/);
    expect(made[0].blobOpts).toEqual({ type: 'image/jpeg', quality: 0.95 });
    expect(made[0].ctxOpts).toEqual({ alpha: false });
    expect(made[0].put).toHaveLength(1);
  });

  it('PNG: image/png without a quality, a .png File', async () => {
    const made = stubOffscreen();
    const f = await encodePng(img);
    expect(f.type).toBe('image/png');
    expect(f.name).toMatch(/\.png$/);
    expect(made[0].blobOpts).toEqual({ type: 'image/png' });
  });

  it("createSurface keeps today's defaults (JPEG, default alpha) for thumbnails", async () => {
    const made = stubOffscreen();
    const s = createSurface(4, 4);
    await s.toBlob(0.85);
    expect(made[0].ctxOpts).toBeUndefined();
    expect(made[0].blobOpts).toEqual({ type: 'image/jpeg', quality: 0.85 });
  });
});
