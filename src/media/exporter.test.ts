import { afterEach, describe, expect, it, vi } from 'vitest';
import { canShareFiles, jpegFileName, saveFile } from './exporter';

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
