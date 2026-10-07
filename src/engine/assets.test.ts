// Regression: the wasm loader script is part of the engine download whether or not a service worker controls the
// page (the broader loadEngineAssets suite lives in src/media/assets.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const MODEL = '/models/face_landmarker/float16-1/face_landmarker.task';
const WASM = '/mediapipe/0.10.35/vision_wasm_internal.wasm';
const LOADER = '/mediapipe/0.10.35/vision_wasm_internal.js';

function setup(controller: object | null) {
  const calls: string[] = [];
  const drained: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const res = new Response(new Uint8Array(64).fill(7), {
        headers: { 'content-type': 'application/octet-stream', 'content-length': '64' },
      });
      // record whether the page consumed the body (a controlled page must, so the SW route stores it)
      const ab = res.arrayBuffer.bind(res);
      res.arrayBuffer = () => (drained.push(url), ab());
      return res;
    }),
  );
  const put = vi.fn(async (_url: string, _res: Response) => {});
  vi.stubGlobal('caches', {
    has: async () => false,
    open: async () => ({ put, keys: async () => [], delete: async () => false }),
  });
  vi.stubGlobal('navigator', { serviceWorker: { controller } });
  return { calls, drained, put };
}

async function fresh() {
  vi.resetModules();
  return import('./assets');
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('loadEngineAssets: wasm loader warm-up', () => {
  it('a SW-controlled page still fetches and drains the loader before done, without stashing it', async () => {
    const { calls, drained, put } = setup({});
    const { loadEngineAssets } = await fresh();
    await loadEngineAssets();
    expect(calls).toEqual([MODEL, WASM, LOADER]);
    expect(drained).toContain(LOADER);
    await new Promise((r) => setTimeout(r, 20));
    expect(put).not.toHaveBeenCalled();
  });

  it('an uncontrolled page stashes the loader in ENGINE_CACHE', async () => {
    const { calls, put } = setup(null);
    const { loadEngineAssets } = await fresh();
    await loadEngineAssets();
    expect(calls).toEqual([MODEL, WASM, LOADER]);
    await vi.waitFor(() => expect(put.mock.calls.map((c) => c[0])).toContain(LOADER));
  });

  it('a failing loader fetch never fails the download', async () => {
    setup({});
    const fetchMock = vi.mocked(fetch);
    const ok = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input) === LOADER) throw new TypeError('offline');
      return ok(input, init);
    });
    const { loadEngineAssets } = await fresh();
    const r = await loadEngineAssets();
    expect(r.modelBuffer.byteLength).toBe(64);
  });
});
