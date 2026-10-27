// Tests for src/engine/assets.ts (lives here because src/engine/*.test.ts belongs to the engine-core task).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crc32, readStoredZip, writeStoredZip } from '../engine/faceBundle';
import type { EngineAssetsProgress } from '../types';

type AssetsModule = typeof import('../engine/assets');

async function fresh(): Promise<AssetsModule> {
  vi.resetModules();
  return import('../engine/assets');
}

interface Served {
  status?: number;
  bytes?: Uint8Array;
  chunk?: number;
  headers?: Record<string, string>;
  /** never deliver body bytes (stall) */
  hang?: boolean;
  /** advertise this Content-Length instead of the real size */
  lengthOverride?: number;
}

function bytes(n: number, seed = 1): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 31 + seed) & 255;
  return b;
}

/** fetch stub: routes by path, streams bodies in chunks, honours AbortSignal like the real thing */
function stubFetch(routes: Record<string, Served | (() => Served)>) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const r = routes[url];
    const spec = typeof r === 'function' ? r() : r;
    if (!spec) return new Response('nope', { status: 404 });
    const signal = init?.signal;
    if (signal?.aborted) throw signal.reason;
    const body = spec.bytes ?? new Uint8Array(0);
    const chunk = spec.chunk ?? 65536;
    const headers: Record<string, string> = { 'content-type': 'application/octet-stream', ...spec.headers };
    if (!('content-length' in headers)) headers['content-length'] = String(spec.lengthOverride ?? body.byteLength);
    if (headers['content-length'] === '') delete headers['content-length'];
    let off = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        signal?.addEventListener('abort', () => c.error(signal.reason));
      },
      pull(c) {
        if (spec.hang) return new Promise<void>(() => {});
        if (off >= body.byteLength) return c.close();
        c.enqueue(body.slice(off, off + chunk));
        off += chunk;
      },
    });
    return new Response(spec.status && spec.status >= 400 ? 'err' : stream, { status: spec.status ?? 200, headers });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

const MODEL = '/models/face_landmarker/float16-1/face_landmarker.task';
const WASM = '/mediapipe/0.10.35/vision_wasm_internal.wasm';
const LOADER = '/mediapipe/0.10.35/vision_wasm_internal.js';
const DETECTOR = '/models/face_detector/full-range-float16-1/blaze_face_full_range.tflite';

/** bytes with the TFLite file identifier at byte 4 */
function tflite(n: number, seed: number): Uint8Array {
  const b = bytes(n, seed);
  b.set([0x54, 0x46, 0x4c, 0x33], 4);
  return b;
}

/** a small face_landmarker.task: stored zip with a (short-range) face_detector.tflite, one more entry and, like the shipped one, face_blendshapes.tflite */
function bundle(blendshapes = false): { zip: Uint8Array; detector: Uint8Array; other: Uint8Array } {
  const e = (name: string, data: Uint8Array) => ({ name, data, crc: crc32(data), time: 0, date: 0, madeBy: 20, external: 0 });
  const detector = tflite(700, 3);
  const other = tflite(3000, 5);
  const entries = [e('face_detector.tflite', detector), e('face_landmarks_detector.tflite', other)];
  if (blendshapes) entries.push(e('face_blendshapes.tflite', tflite(900, 6)));
  return { zip: writeStoredZip(entries), detector, other };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('loadEngineAssets', () => {
  it('streams the model with progress, warms the wasm and its loader, then reports done', async () => {
    const model = bytes(300_000);
    const wasm = bytes(120_000, 7);
    const { calls } = stubFetch({ [MODEL]: { bytes: model, chunk: 50_000 }, [WASM]: { bytes: wasm } });
    const { loadEngineAssets, ENGINE_PATHS } = await fresh();
    expect(ENGINE_PATHS.model).toBe(MODEL);
    const ev: EngineAssetsProgress[] = [];
    const { modelBuffer } = await loadEngineAssets((p) => ev.push(p));
    expect(modelBuffer).toEqual(model);
    // the loader is requested too, so an offline first tracker start finds it (C1)
    expect(calls).toEqual([MODEL, DETECTOR, WASM, LOADER]);

    const m = ev.filter((e) => e.phase === 'model');
    expect(m[0]).toEqual({ phase: 'model', loaded: 0, total: 300_000 });
    expect(m.at(-1)).toEqual({ phase: 'model', loaded: 300_000, total: 300_000 });
    for (let i = 1; i < m.length; i++) expect(m[i].loaded).toBeGreaterThanOrEqual(m[i - 1].loaded);
    const w = ev.filter((e) => e.phase === 'wasm');
    expect(w.at(-1)).toEqual({ phase: 'wasm', loaded: 120_000, total: 120_000 });
    expect(ev.at(-1)).toEqual({ phase: 'done', loaded: 420_000, total: 420_000 });
    // phases strictly in order
    const order = ev.map((e) => e.phase).filter((p, i, a) => p !== a[i - 1]);
    expect(order).toEqual(['model', 'wasm', 'done']);
  });

  it('missing Content-Length → total 0 until the end', async () => {
    const model = bytes(200_000);
    stubFetch({ [MODEL]: { bytes: model, chunk: 1000, headers: { 'content-length': '' } }, [WASM]: { bytes: bytes(10) } });
    const { loadEngineAssets } = await fresh();
    const ev: EngineAssetsProgress[] = [];
    await loadEngineAssets((p) => ev.push(p));
    const m = ev.filter((e) => e.phase === 'model');
    expect(m.slice(0, -1).every((e) => e.total === 0)).toBe(true);
    expect(m.at(-1)).toEqual({ phase: 'model', loaded: 200_000, total: 200_000 });
  });

  it('Content-Encoding makes the declared length meaningless → total 0', async () => {
    stubFetch({
      [MODEL]: { bytes: bytes(5000), lengthOverride: 1234, headers: { 'content-encoding': 'br' } },
      [WASM]: { bytes: bytes(10) },
    });
    const { loadEngineAssets } = await fresh();
    const ev: EngineAssetsProgress[] = [];
    const { modelBuffer } = await loadEngineAssets((p) => ev.push(p));
    expect(modelBuffer.byteLength).toBe(5000);
    expect(ev.find((e) => e.phase === 'model')).toEqual({ phase: 'model', loaded: 0, total: 0 });
  });

  it('memoised: concurrent and late callers share one download and one buffer', async () => {
    const { fetchMock } = stubFetch({ [MODEL]: { bytes: bytes(100_000) }, [WASM]: { bytes: bytes(100) } });
    const { loadEngineAssets } = await fresh();
    const a: EngineAssetsProgress[] = [];
    const b: EngineAssetsProgress[] = [];
    const [ra, rb] = await Promise.all([loadEngineAssets((p) => a.push(p)), loadEngineAssets((p) => b.push(p))]);
    expect(ra.modelBuffer).toBe(rb.modelBuffer);
    expect(fetchMock).toHaveBeenCalledTimes(4); // model + full-range detector + wasm + loader, once
    expect(a.at(-1)?.phase).toBe('done');
    expect(b.at(-1)?.phase).toBe('done');

    const late: EngineAssetsProgress[] = [];
    const rc = await loadEngineAssets((p) => late.push(p));
    expect(rc.modelBuffer).toBe(ra.modelBuffer);
    expect(late).toEqual([a.at(-1)]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    // finished callers are unsubscribed
    expect(a.filter((e) => e.phase === 'done')).toHaveLength(1);
  });

  it('a failed model download rejects, clears the memo and can be retried', async () => {
    let fail = true;
    const { calls } = stubFetch({
      [MODEL]: () => (fail ? { status: 503 } : { bytes: bytes(1000) }),
      [WASM]: { bytes: bytes(10) },
    });
    const { loadEngineAssets } = await fresh();
    await expect(loadEngineAssets()).rejects.toThrow(/503/);
    // the photo detector was requested beside the model; nothing after the failed model
    expect(calls).toEqual([MODEL, DETECTOR]);
    fail = false;
    const r = await loadEngineAssets();
    expect(r.modelBuffer.byteLength).toBe(1000);
  });

  it('a failure after progress was reported does not replay stale progress to the retry', async () => {
    let attempt = 0;
    stubFetch({
      [MODEL]: () => (++attempt === 1 ? { bytes: bytes(500), lengthOverride: 2000 } : { bytes: bytes(3000) }),
      [WASM]: { bytes: bytes(10) },
    });
    const { loadEngineAssets } = await fresh();
    const first: EngineAssetsProgress[] = [];
    await expect(loadEngineAssets((p) => first.push(p))).rejects.toThrow(/truncated/);
    expect(first.length).toBeGreaterThan(0);
    const ev: EngineAssetsProgress[] = [];
    const r = await loadEngineAssets((p) => ev.push(p));
    expect(r.modelBuffer.byteLength).toBe(3000);
    expect(ev[0]).toEqual({ phase: 'model', loaded: 0, total: 3000 });
  });

  it('wasm warm-up failure is non-fatal', async () => {
    stubFetch({ [MODEL]: { bytes: bytes(1000) }, [WASM]: { status: 404 } });
    const { loadEngineAssets } = await fresh();
    const ev: EngineAssetsProgress[] = [];
    const r = await loadEngineAssets((p) => ev.push(p));
    expect(r.modelBuffer.byteLength).toBe(1000);
    expect(ev.at(-1)).toEqual({ phase: 'done', loaded: 1000, total: 1000 });
  });

  it('truncated body, HTML fallback and empty body are rejected', async () => {
    stubFetch({ [MODEL]: { bytes: bytes(500), lengthOverride: 1000 }, [WASM]: { bytes: bytes(10) } });
    let m = await fresh();
    await expect(m.loadEngineAssets()).rejects.toThrow(/truncated/);

    stubFetch({ [MODEL]: { bytes: bytes(500), headers: { 'content-type': 'text/html; charset=utf-8' } } });
    m = await fresh();
    await expect(m.loadEngineAssets()).rejects.toThrow(/HTML/);

    stubFetch({ [MODEL]: { bytes: new Uint8Array(0) } });
    m = await fresh();
    await expect(m.loadEngineAssets()).rejects.toThrow(/empty/);
  });

  it('a stalled download is aborted so the caller can retry', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    stubFetch({ [MODEL]: { bytes: bytes(1000), hang: true } });
    const { loadEngineAssets, STALL_TIMEOUT_MS } = await fresh();
    const p = loadEngineAssets();
    const settled = expect(p).rejects.toThrow(/stalled/);
    await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS + 10);
    await settled;
  });

  it('requests persistent storage only when standalone', async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    stubFetch({ [MODEL]: { bytes: bytes(10) }, [WASM]: { bytes: bytes(10) } });
    vi.stubGlobal('navigator', { standalone: true, storage: { persist } });
    let m = await fresh();
    await m.loadEngineAssets();
    expect(persist).toHaveBeenCalledTimes(1);

    persist.mockClear();
    vi.stubGlobal('navigator', { storage: { persist } });
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(display-mode: standalone)' }));
    m = await fresh();
    await m.loadEngineAssets();
    expect(persist).toHaveBeenCalledTimes(1);

    persist.mockClear();
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    m = await fresh();
    await m.loadEngineAssets();
    expect(persist).not.toHaveBeenCalled();
  });

  it('a throwing progress callback does not break the download', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFetch({ [MODEL]: { bytes: bytes(1000) }, [WASM]: { bytes: bytes(10) } });
    const { loadEngineAssets } = await fresh();
    const r = await loadEngineAssets(() => {
      throw new Error('ui bug');
    });
    expect(r.modelBuffer.byteLength).toBe(1000);
  });
});

describe('loadEngineAssets → the camera bundle and the photo detector', () => {
  it('the camera bundle comes without face_blendshapes.tflite; every other entry as shipped (S §6.5, C3)', async () => {
    const { zip, detector, other } = bundle(true);
    stubFetch({ [MODEL]: { bytes: zip }, [DETECTOR]: { bytes: tflite(1500, 8) }, [WASM]: { bytes: bytes(100) } });
    const { loadEngineAssets } = await fresh();
    const r = await loadEngineAssets();
    const e = readStoredZip(r.modelBuffer);
    expect(e.map((x) => x.name)).toEqual(['face_detector.tflite', 'face_landmarks_detector.tflite']);
    expect(e[0].data).toEqual(detector);
    expect(e[1].data).toEqual(other);
    expect(r).not.toHaveProperty('photoModelBuffer');
  });

  it('a shipped model that is not a stored zip is the camera bundle as it is (logged)', async () => {
    const model = bytes(5000, 4);
    stubFetch({ [MODEL]: { bytes: model }, [DETECTOR]: { bytes: tflite(1500, 8) }, [WASM]: { bytes: bytes(100) } });
    const { loadEngineAssets } = await fresh();
    expect((await loadEngineAssets()).modelBuffer).toEqual(model);
    expect(vi.mocked(console.warn).mock.calls.some((c) => String(c[0]).includes('stored zip'))).toBe(true);
  });

  it('one progress bar for the model and the detector, which download side by side; done adds the detector once it is in (C12)', async () => {
    const { zip } = bundle();
    const det = tflite(100_000, 8);
    const { calls } = stubFetch({ [MODEL]: { bytes: zip, chunk: 500 }, [DETECTOR]: { bytes: det, chunk: 50_000 }, [WASM]: { bytes: bytes(120_000, 7) } });
    const { loadEngineAssets, loadPhotoDetector } = await fresh();
    const ev: EngineAssetsProgress[] = [];
    await loadEngineAssets((p) => ev.push(p));
    expect(calls).toEqual([MODEL, DETECTOR, WASM, LOADER]);
    expect(await loadPhotoDetector()).toEqual(det);
    const m = ev.filter((e) => e.phase === 'model');
    expect(m.some((e) => e.total === zip.byteLength + 100_000)).toBe(true);
    expect(m.at(-1)).toEqual({ phase: 'model', loaded: zip.byteLength + 100_000, total: zip.byteLength + 100_000 });
    for (let i = 1; i < m.length; i++) expect(m[i].loaded).toBeGreaterThanOrEqual(m[i - 1].loaded);
    expect(ev.at(-1)).toEqual({ phase: 'done', loaded: zip.byteLength + 100_000 + 120_000, total: zip.byteLength + 100_000 + 120_000 });
    expect(ev.map((e) => e.phase).filter((p, i, a) => p !== a[i - 1])).toEqual(['model', 'wasm', 'done']);
  });

  it('the engine is done without waiting for the detector (C4): a stalled detector holds neither the camera nor done, and leaves the bar', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { zip } = bundle();
    stubFetch({ [MODEL]: { bytes: zip }, [DETECTOR]: { bytes: tflite(1500, 8), hang: true }, [WASM]: { bytes: bytes(100) } });
    const { loadEngineAssets, loadPhotoDetector, STALL_TIMEOUT_MS } = await fresh();
    const ev: EngineAssetsProgress[] = [];
    const r = await loadEngineAssets((p) => ev.push(p));
    expect(r.modelBuffer.byteLength).toBeGreaterThan(0);
    expect(ev.at(-1)).toEqual({ phase: 'done', loaded: zip.byteLength + 100, total: zip.byteLength + 100 });
    const pending = expect(loadPhotoDetector()).rejects.toThrow(/stalled/);
    await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS + 10);
    await pending;
    // nothing from the detector reaches the engine's listeners once its model phase is over
    expect(ev.map((e) => e.phase).filter((p, i, a) => p !== a[i - 1])).toEqual(['model', 'wasm', 'done']);
  });

  it('a detector that fails leaves the bar: the model phase ends at the model alone', async () => {
    stubFetch({ [MODEL]: { bytes: bytes(300_000), chunk: 1000 }, [DETECTOR]: { status: 404 }, [WASM]: { bytes: bytes(10) } });
    const { loadEngineAssets } = await fresh();
    const ev: EngineAssetsProgress[] = [];
    await loadEngineAssets((p) => ev.push(p));
    expect(ev.filter((e) => e.phase === 'model').at(-1)).toEqual({ phase: 'model', loaded: 300_000, total: 300_000 });
    expect(ev.at(-1)).toEqual({ phase: 'done', loaded: 300_010, total: 300_010 });
  });
});

describe('loadPhotoDetector (BlazeFace full-range, photos only)', () => {
  it('fetches the pinned detector path once for every caller and returns its bytes', async () => {
    const det = tflite(1500, 8);
    const { fetchMock } = stubFetch({ [DETECTOR]: { bytes: det } });
    const { loadPhotoDetector, ENGINE_PATHS } = await fresh();
    expect(ENGINE_PATHS.photoDetector).toBe(DETECTOR);
    const [a, b] = await Promise.all([loadPhotoDetector(), loadPhotoDetector()]);
    expect(a).toEqual(det);
    expect(b).toBe(a);
    expect(await loadPhotoDetector()).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a failed fetch is not kept (C4): it warns, rejects, and the next call fetches again', async () => {
    const warn = vi.mocked(console.warn);
    const cases: Served[] = [{ status: 404 }, { bytes: bytes(1500, 8) }, { bytes: tflite(900, 2), headers: { 'content-type': 'text/html' } }];
    for (const served of cases) {
      warn.mockClear();
      let broken = true;
      const { fetchMock } = stubFetch({ [DETECTOR]: () => (broken ? served : { bytes: tflite(1500, 8) }) });
      const { loadPhotoDetector } = await fresh();
      await expect(loadPhotoDetector()).rejects.toThrow();
      expect(warn.mock.calls.some((c) => String(c[0]).includes('full-range'))).toBe(true);
      broken = false;
      expect((await loadPhotoDetector()).byteLength).toBe(1500);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  });

  it('reports its own progress, then done', async () => {
    stubFetch({ [DETECTOR]: { bytes: tflite(150_000, 8), chunk: 50_000 } });
    const { loadPhotoDetector } = await fresh();
    const ev: EngineAssetsProgress[] = [];
    await loadPhotoDetector((p) => ev.push(p));
    expect(ev[0]).toEqual({ phase: 'model', loaded: 0, total: 150_000 });
    expect(ev.at(-1)).toEqual({ phase: 'done', loaded: 150_000, total: 150_000 });
  });
});

/** Minimal Cache Storage stub: one bucket per name, keyed by pathname. */
function stubCaches(opts: { openFails?: boolean; seed?: string[] } = {}) {
  const buckets = new Map<string, Map<string, Response | null>>();
  const bucket = (name: string) => {
    let b = buckets.get(name);
    if (!b) buckets.set(name, (b = new Map()));
    return b;
  };
  for (const k of opts.seed ?? []) bucket('meiyan-engine-v1').set(k, null);
  const put = vi.fn(async (name: string, url: string, res: Response) => {
    bucket(name).set(url, new Response(await res.arrayBuffer(), { headers: res.headers }));
  });
  const storage = {
    has: vi.fn(async (name: string) => buckets.has(name)),
    open: vi.fn(async (name: string) => {
      if (opts.openFails) throw new Error('quota');
      const b = bucket(name);
      return {
        put: (url: string, res: Response) => put(name, url, res),
        keys: async () => [...b.keys()].map((k) => new Request(`http://localhost${k}`)),
        delete: async (req: Request) => b.delete(new URL(req.url).pathname),
      };
    }),
  };
  vi.stubGlobal('caches', storage);
  return { buckets, put, storage };
}

describe('loadEngineAssets → Cache Storage', () => {
  it('an uncontrolled page stashes the validated model, wasm and loader in ENGINE_CACHE', async () => {
    const model = bytes(50_000);
    const wasm = bytes(20_000, 3);
    const loader = bytes(900, 5);
    stubFetch({ [MODEL]: { bytes: model }, [WASM]: { bytes: wasm }, [LOADER]: { bytes: loader } });
    const { buckets } = stubCaches();
    vi.stubGlobal('navigator', { serviceWorker: { controller: null } });
    const { loadEngineAssets, ENGINE_CACHE } = await fresh();
    expect(ENGINE_CACHE).toBe('meiyan-engine-v1');
    const r = await loadEngineAssets();
    expect(r.modelBuffer).toEqual(model);
    await vi.waitFor(() => expect(buckets.get(ENGINE_CACHE)?.size).toBe(3));
    const b = buckets.get(ENGINE_CACHE)!;
    expect(new Uint8Array(await b.get(MODEL)!.arrayBuffer())).toEqual(model);
    expect(new Uint8Array(await b.get(WASM)!.arrayBuffer())).toEqual(wasm);
    expect(new Uint8Array(await b.get(LOADER)!.arrayBuffer())).toEqual(loader);
  });

  it('an uncontrolled page stashes the full-range detector with the engine, so photo detection works offline', async () => {
    const det = tflite(1500, 8);
    stubFetch({ [MODEL]: { bytes: bundle().zip }, [DETECTOR]: { bytes: det }, [WASM]: { bytes: bytes(10) }, [LOADER]: { bytes: bytes(10) } });
    const { buckets } = stubCaches();
    vi.stubGlobal('navigator', { serviceWorker: { controller: null } });
    const { loadEngineAssets, ENGINE_CACHE } = await fresh();
    await loadEngineAssets();
    await vi.waitFor(() => expect(buckets.get(ENGINE_CACHE)?.size).toBe(4));
    expect(new Uint8Array(await buckets.get(ENGINE_CACHE)!.get(DETECTOR)!.arrayBuffer())).toEqual(det);
  });

  it('a page controlled by the service worker leaves caching to its CacheFirst route but still requests every engine file', async () => {
    const { calls } = stubFetch({ [MODEL]: { bytes: bytes(1000) }, [WASM]: { bytes: bytes(10) } });
    const { put } = stubCaches();
    vi.stubGlobal('navigator', { serviceWorker: { controller: {} } });
    const { loadEngineAssets } = await fresh();
    await loadEngineAssets();
    await new Promise((r) => setTimeout(r, 20));
    expect(put).not.toHaveBeenCalled();
    expect(calls).toEqual([MODEL, DETECTOR, WASM, LOADER]);
  });

  it('a truncated download is never stashed', async () => {
    stubFetch({ [MODEL]: { bytes: bytes(500), lengthOverride: 1000 }, [WASM]: { bytes: bytes(10) } });
    const { put } = stubCaches();
    const { loadEngineAssets } = await fresh();
    await expect(loadEngineAssets()).rejects.toThrow(/truncated/);
    await new Promise((r) => setTimeout(r, 20));
    expect(put).not.toHaveBeenCalled();
  });

  it('prunes entries of older engine versions and keeps the current ones', async () => {
    stubFetch({ [MODEL]: { bytes: bytes(1000) }, [WASM]: { bytes: bytes(10) }, [LOADER]: { bytes: bytes(10) } });
    const { buckets } = stubCaches({
      seed: [
        '/mediapipe/0.10.20/vision_wasm_internal.wasm',
        '/models/face_landmarker/float16-0/face_landmarker.task',
        '/mediapipe/0.10.35/vision_wasm_nosimd_internal.wasm',
        '/icons/icon-192.png',
        DETECTOR,
        '/models/face_detector/full-range-float16-0/blaze_face_full_range.tflite',
      ],
    });
    vi.stubGlobal('navigator', { serviceWorker: { controller: {} } });
    const { loadEngineAssets, ENGINE_CACHE } = await fresh();
    await loadEngineAssets();
    await vi.waitFor(() => expect(buckets.get(ENGINE_CACHE)?.size).toBe(3));
    expect([...buckets.get(ENGINE_CACHE)!.keys()].sort()).toEqual([
      '/icons/icon-192.png',
      '/mediapipe/0.10.35/vision_wasm_nosimd_internal.wasm',
      DETECTOR,
    ]);
  });

  it('a failing Cache Storage never fails the download', async () => {
    stubFetch({ [MODEL]: { bytes: bytes(1000) }, [WASM]: { bytes: bytes(10) }, [LOADER]: { bytes: bytes(10) } });
    stubCaches({ openFails: true });
    const { loadEngineAssets } = await fresh();
    const r = await loadEngineAssets();
    expect(r.modelBuffer.byteLength).toBe(1000);
    await new Promise((r) => setTimeout(r, 20));
  });
});

describe('loadPoseModel (美體)', () => {
  const FULL = '/models/pose_landmarker/full-float16-1/pose_landmarker_full.task';
  const LITE = '/models/pose_landmarker/lite-float16-1/pose_landmarker_lite.task';

  it('versioned self-hosted paths', async () => {
    const { POSE_MODELS } = await fresh();
    expect(POSE_MODELS).toEqual({ full: FULL, lite: LITE });
  });

  it('streams the model with progress, then reports done, and returns its bytes', async () => {
    const model = bytes(200_000, 9);
    const { calls } = stubFetch({ [FULL]: { bytes: model, chunk: 40_000 } });
    const { loadPoseModel } = await fresh();
    const ev: EngineAssetsProgress[] = [];
    expect(await loadPoseModel('full', (p) => ev.push(p))).toEqual(model);
    expect(calls).toEqual([FULL]);
    expect(ev[0]).toEqual({ phase: 'model', loaded: 0, total: 200_000 });
    expect(ev.at(-1)).toEqual({ phase: 'done', loaded: 200_000, total: 200_000 });
    expect(ev.map((e) => e.phase).filter((p, i, a) => p !== a[i - 1])).toEqual(['model', 'done']);
  });

  it('memoised per variant: concurrent and late callers share one download; variants are independent', async () => {
    const { calls } = stubFetch({ [FULL]: { bytes: bytes(1000) }, [LITE]: { bytes: bytes(500, 2) } });
    const { loadPoseModel } = await fresh();
    const [a, b] = await Promise.all([loadPoseModel('full'), loadPoseModel('full')]);
    expect(a).toBe(b);
    const late: EngineAssetsProgress[] = [];
    expect(await loadPoseModel('full', (p) => late.push(p))).toBe(a);
    expect(late).toEqual([{ phase: 'done', loaded: 1000, total: 1000 }]);
    expect((await loadPoseModel('lite')).byteLength).toBe(500);
    expect(calls).toEqual([FULL, LITE]);
  });

  it('does not report to engine-download listeners, and the engine does not report to it', async () => {
    stubFetch({ [FULL]: { bytes: bytes(1000) }, [MODEL]: { bytes: bytes(300) }, [WASM]: { bytes: bytes(10) } });
    const { loadPoseModel, loadEngineAssets } = await fresh();
    const eng: EngineAssetsProgress[] = [];
    const pose: EngineAssetsProgress[] = [];
    await Promise.all([loadEngineAssets((p) => eng.push(p)), loadPoseModel('full', (p) => pose.push(p))]);
    expect(pose.at(-1)).toEqual({ phase: 'done', loaded: 1000, total: 1000 });
    expect(pose.every((p) => p.phase !== 'wasm')).toBe(true);
    expect(eng.at(-1)).toEqual({ phase: 'done', loaded: 310, total: 310 });
    expect(eng.some((p) => p.loaded === 1000)).toBe(false);
  });

  it('a failed download rejects, clears the memo and can be retried', async () => {
    let fail = true;
    const { calls } = stubFetch({ [FULL]: () => (fail ? { status: 503 } : { bytes: bytes(800) }) });
    const { loadPoseModel } = await fresh();
    await expect(loadPoseModel('full')).rejects.toThrow(/503/);
    fail = false;
    expect((await loadPoseModel('full')).byteLength).toBe(800);
    expect(calls).toEqual([FULL, FULL]);
  });

  it('HTML fallback (missing model behind the SPA fallback) is rejected', async () => {
    stubFetch({ [FULL]: { bytes: bytes(100), headers: { 'content-type': 'text/html' } } });
    const { loadPoseModel } = await fresh();
    await expect(loadPoseModel('full')).rejects.toThrow(/HTML/);
  });

  it('an uncontrolled page stashes the validated model in ENGINE_CACHE; a controlled one leaves it to the SW', async () => {
    const model = bytes(3000, 4);
    stubFetch({ [LITE]: { bytes: model } });
    const { buckets } = stubCaches();
    vi.stubGlobal('navigator', { serviceWorker: { controller: null } });
    let mod = await fresh();
    await mod.loadPoseModel('lite');
    await vi.waitFor(() => expect(buckets.get(mod.ENGINE_CACHE)?.size).toBe(1));
    expect(new Uint8Array(await buckets.get(mod.ENGINE_CACHE)!.get(LITE)!.arrayBuffer())).toEqual(model);

    const { put } = stubCaches();
    vi.stubGlobal('navigator', { serviceWorker: { controller: {} } });
    mod = await fresh();
    await mod.loadPoseModel('lite');
    await new Promise((r) => setTimeout(r, 20));
    expect(put).not.toHaveBeenCalled();
  });

  it('the engine download prunes old pose versions but keeps the current pose models', async () => {
    stubFetch({ [MODEL]: { bytes: bytes(1000) }, [WASM]: { bytes: bytes(10) }, [LOADER]: { bytes: bytes(10) } });
    const { buckets } = stubCaches({
      seed: [FULL, LITE, '/models/pose_landmarker/full-float16-0/pose_landmarker_full.task'],
    });
    vi.stubGlobal('navigator', { serviceWorker: { controller: {} } });
    const { loadEngineAssets, ENGINE_CACHE } = await fresh();
    await loadEngineAssets();
    await vi.waitFor(() => expect(buckets.get(ENGINE_CACHE)?.size).toBe(2));
    expect([...buckets.get(ENGINE_CACHE)!.keys()].sort()).toEqual([FULL, LITE]);
  });
});
