// loadImageTexture's upload options (face-detail spec §4.10: lashes.png is uploaded R8 with mipmaps), on a GL
// stand-in that records every call. The GPU result is checked by the makeup e2e harness, which samples lashes.png.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadImageTexture } from './gl';

/** a WebGL2 stand-in that records every call; constants read as their own names */
function recordingGl() {
  const calls: [string, unknown[]][] = [];
  const gl = new Proxy(
    {},
    {
      get: (_t, k) =>
        typeof k === 'string' && /^[A-Z0-9_]+$/.test(k)
          ? k
          : (...args: unknown[]) => {
              calls.push([String(k), args]);
              return k === 'createTexture' ? { id: 'tex' } : null;
            },
    },
  ) as unknown as WebGL2RenderingContext;
  return { gl, calls };
}

const bitmap = { width: 512, height: 128, close: vi.fn() };
const uploads = (calls: [string, unknown[]][]) => calls.filter(([n]) => n === 'texImage2D').map(([, a]) => a);
const minFilters = (calls: [string, unknown[]][]) =>
  calls.filter(([n, a]) => n === 'texParameteri' && a[1] === 'TEXTURE_MIN_FILTER').map(([, a]) => a[2]);

beforeEach(() => {
  bitmap.close.mockClear();
  vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, blob: async () => ({}) }));
  vi.stubGlobal('createImageBitmap', async () => bitmap);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadImageTexture', () => {
  it('without options uploads RGBA8 LINEAR and builds no mip chain (unchanged)', async () => {
    const { gl, calls } = recordingGl();
    const t = await loadImageTexture(gl, '/makeup/gp/lip.png');
    expect(uploads(calls)).toEqual([['TEXTURE_2D', 0, 'RGBA8', 'RGBA', 'UNSIGNED_BYTE', bitmap]]);
    expect(calls.some(([n]) => n === 'generateMipmap')).toBe(false);
    expect(minFilters(calls)).toEqual(['LINEAR']);
    expect([t.width, t.height]).toEqual([512, 128]);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it('r8 + mipmap uploads R8 from RED with the unpack state, then samples the mip chain LINEAR_MIPMAP_LINEAR', async () => {
    const { gl, calls } = recordingGl();
    const t = await loadImageTexture(gl, '/makeup/own/lashes.png', { r8: true, mipmap: true });
    expect(uploads(calls)).toEqual([['TEXTURE_2D', 0, 'R8', 'RED', 'UNSIGNED_BYTE', bitmap]]);
    const names = calls.map(([n]) => n);
    const upload = names.indexOf('texImage2D');
    const unpack = calls.findIndex(([n, a]) => n === 'pixelStorei' && a[0] === 'UNPACK_COLORSPACE_CONVERSION_WEBGL');
    expect(unpack).toBeGreaterThanOrEqual(0);
    expect(unpack).toBeLessThan(upload);
    const mip = names.indexOf('generateMipmap');
    expect(mip).toBeGreaterThan(upload);
    expect(minFilters(calls).at(-1)).toBe('LINEAR_MIPMAP_LINEAR');
    const lastMin = calls.findLastIndex(([n, a]) => n === 'texParameteri' && a[1] === 'TEXTURE_MIN_FILTER');
    expect(lastMin).toBeGreaterThan(mip);
    expect([t.width, t.height]).toEqual([512, 128]);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it('mipmap alone keeps the RGBA8 upload and adds the mip chain', async () => {
    const { gl, calls } = recordingGl();
    await loadImageTexture(gl, '/x.png', { mipmap: true });
    expect(uploads(calls)).toEqual([['TEXTURE_2D', 0, 'RGBA8', 'RGBA', 'UNSIGNED_BYTE', bitmap]]);
    expect(minFilters(calls)).toEqual(['LINEAR', 'LINEAR_MIPMAP_LINEAR']);
  });
});
