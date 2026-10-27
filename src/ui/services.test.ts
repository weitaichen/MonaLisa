// services.ts engine/tracker lifecycle: retry after a failed engine, one tracker build at a time,
// and delegate toggles that land while a build is in flight.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BodyTracker, BodyTrackerOptions, Engine, EngineAssetsProgress, Prefs, Tracker, TrackerOptions } from '../types';

type Services = typeof import('./services');
type Deps = typeof import('./deps').deps;

interface Deferred<T> {
  promise: Promise<T>;
  resolve(v: T): void;
  reject(e: unknown): void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function fakeEngine(ready: Promise<void>): Engine {
  ready.catch(() => undefined);
  return { ready, lost: false, dispose: vi.fn(), setOptions: vi.fn(), setTier: vi.fn() } as unknown as Engine;
}

interface FakeTracker {
  delegate: 'GPU' | 'CPU';
  close: ReturnType<typeof vi.fn>;
}

async function load(prefs: { current: Prefs }): Promise<{ svc: Services; deps: Deps }> {
  vi.resetModules();
  const canvas = { className: '', addEventListener: vi.fn() };
  vi.stubGlobal('document', { createElement: () => canvas });
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const svc = await import('./services');
  const { deps } = await import('./deps');
  svc.bindPrefs(() => prefs.current);
  deps.isWebGL2Supported = () => true;
  deps.loadEngineAssets = async () => ({ modelBuffer: new Uint8Array(4) });
  deps.loadPhotoDetector = async () => new Uint8Array(8);
  return { svc, deps };
}

const PREFS = { delegate: 'auto', matchGpupixel: false, showLandmarks: false, tier: 'auto' } as unknown as Prefs;

describe('services: engine retry', () => {
  let prefs: { current: Prefs };
  beforeEach(() => {
    prefs = { current: { ...PREFS } };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('重試 after engine.ready rejected builds a fresh engine instead of awaiting the dead promise', async () => {
    const { svc, deps } = await load(prefs);
    const engines: Engine[] = [];
    deps.createEngine = vi.fn(() => {
      const e = fakeEngine(engines.length === 0 ? Promise.reject(new Error('lut 404')) : Promise.resolve());
      engines.push(e);
      return e;
    }) as unknown as Deps['createEngine'];
    deps.createTracker = (async (o: TrackerOptions) => ({ delegate: o.delegate === 'CPU' ? 'CPU' : 'GPU', close: vi.fn() })) as unknown as Deps['createTracker'];

    await expect(svc.ensureEngine(true)).rejects.toThrow('lut 404');
    expect(svc.svc.get().engine.state).toBe('error');
    const bundle = await svc.ensureEngine(true);
    expect(deps.createEngine).toHaveBeenCalledTimes(2);
    expect(engines[0].dispose).toHaveBeenCalled();
    expect(bundle.engine).toBe(engines[1]);
    expect(svc.svc.get().engine.state).toBe('ready');
  });
});

describe('services: tracker builds', () => {
  let prefs: { current: Prefs };
  let made: FakeTracker[];
  let gates: Deferred<void>[];
  beforeEach(() => {
    prefs = { current: { ...PREFS } };
    made = [];
    gates = [];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function setup(failFirst = false) {
    const { svc, deps } = await load(prefs);
    deps.createEngine = (() => fakeEngine(Promise.resolve())) as unknown as Deps['createEngine'];
    deps.createTracker = (async (o: TrackerOptions): Promise<Tracker> => {
      const gate = deferred<void>();
      gates.push(gate);
      await gate.promise;
      if (failFirst && made.length === 0 && gates.length === 1) throw new Error('wasm failed');
      const t: FakeTracker = { delegate: o.delegate === 'CPU' ? 'CPU' : 'GPU', close: vi.fn() };
      made.push(t);
      return t as unknown as Tracker;
    }) as unknown as Deps['createTracker'];
    return svc;
  }
  const openAll = async () => {
    for (let i = 0; i < 10; i++) {
      await flush();
      for (const g of gates) g.resolve();
    }
    await flush();
  };
  const unclosed = () => made.filter((t) => t.close.mock.calls.length === 0);

  it('ensureEngine during a restart joins it: exactly one live tracker', async () => {
    const svc = await setup();
    const p0 = svc.ensureEngine();
    await openAll();
    await p0;
    prefs.current = { ...prefs.current, delegate: 'CPU' };
    const r = svc.restartTracker();
    await flush();
    const joined = svc.ensureEngine(); // Camera/Editor mount while the restart builds
    await openAll();
    await r;
    const bundle = await joined;
    expect(unclosed()).toHaveLength(1);
    expect(bundle.tracker).toBe(unclosed()[0]);
    expect(bundle.tracker?.delegate).toBe('CPU');
  });

  it('a CPU → auto double toggle while building ends on the last pref', async () => {
    const svc = await setup();
    const p0 = svc.ensureEngine();
    await openAll();
    await p0;
    prefs.current = { ...prefs.current, delegate: 'CPU' };
    const r1 = svc.restartTracker();
    await flush();
    prefs.current = { ...prefs.current, delegate: 'auto' };
    const r2 = svc.restartTracker();
    await openAll();
    await Promise.all([r1, r2]);
    const s = svc.svc.get().engine;
    expect(s.state).toBe('ready');
    if (s.state !== 'ready') return;
    expect(s.bundle.tracker?.delegate).toBe('GPU');
    expect(unclosed()).toHaveLength(1);
  });

  it('a delegate change during the first build is honoured when it finishes', async () => {
    const svc = await setup();
    const p0 = svc.ensureEngine();
    await flush();
    prefs.current = { ...prefs.current, delegate: 'CPU' };
    const r = svc.restartTracker(); // joins the in-flight build
    await openAll();
    await r;
    const b = await p0;
    expect(b.tracker?.delegate).toBe('CPU');
    expect(unclosed()).toHaveLength(1);
  });

  it('a tracker that failed to start can be retried by a delegate change', async () => {
    const svc = await setup(true);
    const p0 = svc.ensureEngine();
    await openAll();
    const b0 = await p0;
    expect(b0.basic).toBe(true);
    prefs.current = { ...prefs.current, delegate: 'CPU' };
    const r = svc.restartTracker();
    await openAll();
    await r;
    const s = svc.svc.get().engine;
    expect(s.state === 'ready' && s.bundle.basic).toBe(false);
  });

  it('the user-chosen 基本模式 is not turned into a tracker build by a delegate change', async () => {
    const svc = await setup();
    await svc.ensureEngine(true);
    prefs.current = { ...prefs.current, delegate: 'CPU' };
    await svc.restartTracker();
    expect(gates).toHaveLength(0);
  });

  describe('a tracker build that never finishes', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('falls back to 基本模式 with a note after the timeout instead of 正在啟動臉部偵測… forever', async () => {
      const svc = await setup();
      const p0 = svc.ensureEngine();
      await vi.advanceTimersByTimeAsync(svc.TRACKER_BUILD_TIMEOUT_MS - 1);
      expect(svc.svc.get().engine).toMatchObject({ state: 'loading', step: 'tracker' });
      await vi.advanceTimersByTimeAsync(1);
      const b = await p0;
      expect(b).toMatchObject({ tracker: null, basic: true });
      const s = svc.svc.get().engine;
      expect(s.state === 'ready' && s.note).toContain('基本模式');
    });

    it('the tracker that lands after the timeout takes the 基本模式 bundle\'s place', async () => {
      const svc = await setup();
      const p0 = svc.ensureEngine();
      await vi.advanceTimersByTimeAsync(svc.TRACKER_BUILD_TIMEOUT_MS);
      const fallback = await p0;
      gates[0].resolve();
      await flush();
      const s = svc.svc.get().engine;
      expect(s.state).toBe('ready');
      if (s.state !== 'ready') return;
      expect(s.bundle).not.toBe(fallback);
      expect(s.bundle).toMatchObject({ engine: fallback.engine, tracker: made[0], basic: false });
      expect(s.note).toBe('臉部偵測已啟動');
      expect(unclosed()).toHaveLength(1);
      expect(await svc.ensureEngine()).toBe(s.bundle);
    });

    it('a delegate change while the timed-out build still runs builds nothing beside it; that build is closed when it lands', async () => {
      const svc = await setup();
      const p0 = svc.ensureEngine();
      await vi.advanceTimersByTimeAsync(svc.TRACKER_BUILD_TIMEOUT_MS);
      await p0;
      prefs.current = { ...prefs.current, delegate: 'CPU' };
      const r = svc.restartTracker();
      await vi.advanceTimersByTimeAsync(1000);
      expect(gates).toHaveLength(1); // only the timed-out build: one MediaPipe graph initialising at a time
      gates[0].resolve();
      await flush();
      expect(made[0].close).toHaveBeenCalled(); // the pref moved on
      await openAll();
      await r;
      const s = svc.svc.get().engine;
      expect(s.state === 'ready' && s.bundle.tracker?.delegate).toBe('CPU');
      expect(unclosed()).toHaveLength(1);
    });

    it('a restart with the same pref while the timed-out build still runs: that build is closed when it lands, one tracker remains', async () => {
      const svc = await setup();
      const p0 = svc.ensureEngine();
      await vi.advanceTimersByTimeAsync(svc.TRACKER_BUILD_TIMEOUT_MS);
      await p0;
      const r = svc.restartTracker(); // e.g. a re-tap in 設定: the restart waits for the timed-out build
      gates[0].resolve();
      await flush();
      expect(made[0].close).toHaveBeenCalled();
      await openAll();
      await r;
      expect(unclosed()).toHaveLength(1);
      const s = svc.svc.get().engine;
      expect(s.state === 'ready' && s.bundle.tracker).toBe(unclosed()[0]);
    });

    it('a timed-out build that fails after all: 基本模式 stays, and a note says the recovery does not come', async () => {
      const svc = await setup(true); // the first build throws once its gate opens
      const p0 = svc.ensureEngine();
      await vi.advanceTimersByTimeAsync(svc.TRACKER_BUILD_TIMEOUT_MS);
      const fallback = await p0;
      gates[0].resolve();
      await flush();
      const s = svc.svc.get().engine;
      expect(s.state).toBe('ready');
      if (s.state !== 'ready') return;
      expect(s.bundle).not.toBe(fallback); // a fresh bundle: the camera shows the note
      expect(s.bundle).toMatchObject({ engine: fallback.engine, tracker: null, basic: true });
      expect(s.note).toContain('請把 App 關掉重新開啟');
    });

    it('a later build that gave up waiting (same pref) still takes the timed-out build\'s tracker when it lands', async () => {
      const svc = await setup();
      const p0 = svc.ensureEngine();
      await vi.advanceTimersByTimeAsync(svc.TRACKER_BUILD_TIMEOUT_MS);
      await p0;
      const r = svc.restartTracker();
      await vi.advanceTimersByTimeAsync(svc.TRACKER_BUILD_TIMEOUT_MS);
      await r;
      const stuck = svc.svc.get().engine;
      expect(stuck.state === 'ready' && stuck.note).toContain('臉部偵測無法啟動');
      gates[0].resolve();
      await flush();
      const s = svc.svc.get().engine;
      expect(s.state === 'ready' && s.bundle.tracker).toBe(made[0]);
      expect(s.state === 'ready' && s.note).toBe('臉部偵測已啟動');
      expect(unclosed()).toHaveLength(1);
      expect(gates).toHaveLength(1); // the give-up built nothing
    });

    it('a timed-out build that never lands: a later build gives up after the wait instead of starting beside it', async () => {
      const svc = await setup();
      const p0 = svc.ensureEngine();
      await vi.advanceTimersByTimeAsync(svc.TRACKER_BUILD_TIMEOUT_MS);
      await p0;
      prefs.current = { ...prefs.current, delegate: 'CPU' };
      const r = svc.restartTracker();
      await vi.advanceTimersByTimeAsync(svc.TRACKER_BUILD_TIMEOUT_MS);
      await r;
      expect(gates).toHaveLength(1);
      const s = svc.svc.get().engine;
      expect(s.state === 'ready' && s.bundle.basic).toBe(true);
    });
  });
});

describe('services: the full-range photo detector (C4)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function withTrackers(prefs: { current: Prefs }) {
    const loaded = await load(prefs);
    loaded.deps.createEngine = (() => fakeEngine(Promise.resolve())) as unknown as Deps['createEngine'];
    const opts: TrackerOptions[] = [];
    loaded.deps.createTracker = (async (o: TrackerOptions) => {
      opts.push(o);
      return { delegate: 'GPU', close: vi.fn() };
    }) as unknown as Deps['createTracker'];
    return { ...loaded, opts };
  }

  it('the engine (the camera) is ready without waiting for the detector; every tracker build reads it at each photo through fullRangeDetector', async () => {
    const prefs = { current: { ...PREFS } };
    const { svc, deps, opts } = await withTrackers(prefs);
    const camera = new Uint8Array(4);
    deps.loadEngineAssets = async () => ({ modelBuffer: camera });
    const det = deferred<Uint8Array>();
    deps.loadPhotoDetector = vi.fn(() => det.promise) as unknown as Deps['loadPhotoDetector'];
    await svc.ensureEngine();
    expect(svc.svc.get().engine.state).toBe('ready');
    expect(opts[0].modelBuffer).toBe(camera);
    expect(opts[0]).not.toHaveProperty('photoModelBuffer');
    expect(opts[0].fullRangeDetector!()).toBeNull();
    const bytes = new Uint8Array(6);
    det.resolve(bytes);
    await flush();
    expect(opts[0].fullRangeDetector!()).toBe(bytes);
    prefs.current = { ...PREFS, delegate: 'CPU' } as Prefs;
    await svc.restartTracker();
    expect(opts).toHaveLength(2);
    expect(opts[1].fullRangeDetector!()).toBe(bytes);
    expect(deps.loadPhotoDetector).toHaveBeenCalledTimes(1);
  });

  it('a failed detector download is not kept: the next photo asks again (fullRangeDetector), and the answer after it is used', async () => {
    const { svc, deps, opts } = await withTrackers({ current: { ...PREFS } });
    const bytes = new Uint8Array(6);
    const load = vi.fn().mockRejectedValueOnce(new Error('HTTP 404')).mockResolvedValueOnce(bytes);
    deps.loadPhotoDetector = load as unknown as Deps['loadPhotoDetector'];
    await svc.ensureEngine();
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(opts[0].fullRangeDetector!()).toBeNull(); // this photo detects short-range, and a retry starts
    expect(load).toHaveBeenCalledTimes(2);
    await flush();
    expect(opts[0].fullRangeDetector!()).toBe(bytes);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('svc.photoDetector says the detector is in whichever request brought it (round 4): a 5xx first, then a retry no editor asked for (a photo switching the tracker) lands', async () => {
    const { svc, deps, opts } = await withTrackers({ current: { ...PREFS } });
    const retry = deferred<Uint8Array>();
    const load = vi.fn().mockRejectedValueOnce(new Error('HTTP 503')).mockReturnValueOnce(retry.promise);
    deps.loadPhotoDetector = load as unknown as Deps['loadPhotoDetector'];
    await svc.ensureEngine();
    await flush();
    expect(svc.svc.get().photoDetector).toBe(false);
    const seen: boolean[] = [];
    svc.svc.subscribe((s) => seen.push(s.photoDetector));
    // a photo's switch to its model reads the detector: missing, so services asks again by itself
    expect(opts[0].fullRangeDetector!()).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
    await flush();
    expect(svc.svc.get().photoDetector).toBe(false);
    retry.resolve(new Uint8Array(6));
    await flush();
    // the store says so (an open editor completes its short-range answer on it, not on its own asks)
    expect(svc.svc.get().photoDetector).toBe(true);
    expect(seen.at(-1)).toBe(true);
    // and it stays in: an editor's later ask joins nothing, the bytes are there
    await svc.ensurePhotoDetector();
    expect(load).toHaveBeenCalledTimes(2);
    expect(svc.svc.get().photoDetector).toBe(true);
  });

  it('photoDetectorPending: a face detection waits for the first download when it lands within the cap; null once the detector is in', async () => {
    const { svc, deps } = await load({ current: { ...PREFS } });
    const first = deferred<Uint8Array>();
    const loadDet = vi.fn().mockReturnValueOnce(first.promise);
    deps.loadPhotoDetector = loadDet as unknown as Deps['loadPhotoDetector'];
    const p = svc.photoDetectorPending();
    expect(p).not.toBeNull();
    let done = false;
    void p!.then(() => (done = true));
    await flush();
    expect(done).toBe(false);
    first.resolve(new Uint8Array(6));
    await flush();
    expect(done).toBe(true);
    expect(svc.photoDetectorPending()).toBeNull();
    expect(loadDet).toHaveBeenCalledTimes(1);
  });

  it('photoDetectorPending: a hanging first download is waited for DETECTOR_WAIT_MS at most, once per session (D1)', async () => {
    vi.useFakeTimers();
    try {
      const { svc, deps } = await load({ current: { ...PREFS } });
      // the request never answers (lie-fi): its stall abort would come only after STALL_TIMEOUT_MS of silence per chunk
      deps.loadPhotoDetector = vi.fn(() => new Promise<Uint8Array>(() => undefined)) as unknown as Deps['loadPhotoDetector'];
      expect(svc.DETECTOR_WAIT_MS).toBe(3000);
      const p = svc.photoDetectorPending();
      expect(p).not.toBeNull();
      let done = false;
      void p!.then(() => (done = true));
      await vi.advanceTimersByTimeAsync(svc.DETECTOR_WAIT_MS - 1);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(done).toBe(true);
      // the cap is spent: the next photo detects with what is there at once, though the download is still in flight
      expect(svc.photoDetectorPending()).toBeNull();
      expect(deps.loadPhotoDetector).toHaveBeenCalledTimes(1);
      // one wait in the session (window.__meiyan, read by the e2e)
      expect(window.__meiyan?.detectorWaits).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('photoDetectorPending: a photo opened within the cap waits only for what is left of it', async () => {
    vi.useFakeTimers();
    try {
      const { svc, deps } = await load({ current: { ...PREFS } });
      deps.loadPhotoDetector = vi.fn(() => new Promise<Uint8Array>(() => undefined)) as unknown as Deps['loadPhotoDetector'];
      void svc.photoDetectorPending();
      await vi.advanceTimersByTimeAsync(2000);
      let done = false;
      void svc.photoDetectorPending()!.then(() => (done = true));
      await vi.advanceTimersByTimeAsync(999);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('photoDetectorPending: no wait on a retry after a failed first download (D1), though one is in flight', async () => {
    const { svc, deps } = await load({ current: { ...PREFS } });
    const first = deferred<Uint8Array>();
    const retry = deferred<Uint8Array>();
    const loadDet = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
    deps.loadPhotoDetector = loadDet as unknown as Deps['loadPhotoDetector'];
    const p = svc.photoDetectorPending();
    expect(svc.photoDetectorPending()).not.toBeNull(); // joins the same download
    first.reject(new TypeError('Failed to fetch'));
    await p;
    // the next photo starts a retry (the tracker's fullRangeDetector), and nothing waits for it
    void svc.ensurePhotoDetector();
    expect(loadDet).toHaveBeenCalledTimes(2);
    expect(svc.photoDetectorPending()).toBeNull();
    retry.resolve(new Uint8Array(6));
    await flush();
    expect(svc.photoDetectorPending()).toBeNull();
  });

  it("the engine download's own detector request is the session's first: when it fails before 'done', the request 'done' starts is a retry nobody waits for (D1)", async () => {
    const { svc, deps } = await load({ current: { ...PREFS } });
    // loadPhotoDetector as assets.ts has it: memoised while in flight, the memo cleared by a failure
    const attempts: Deferred<Uint8Array>[] = [];
    let memo: Promise<Uint8Array> | null = null;
    const loadDet = vi.fn(() => {
      if (!memo) {
        const d = deferred<Uint8Array>();
        attempts.push(d);
        const m = d.promise;
        memo = m;
        m.catch(() => {
          if (memo === m) memo = null;
        });
      }
      return memo;
    });
    deps.loadPhotoDetector = loadDet as unknown as Deps['loadPhotoDetector'];
    // the engine download starts the detector's request right after the model's, and never waits for it
    const engine = deferred<{ modelBuffer: Uint8Array }>();
    deps.loadEngineAssets = (() => {
      void deps.loadPhotoDetector().catch(() => undefined);
      return engine.promise;
    }) as unknown as Deps['loadEngineAssets'];
    const assets = svc.prefetchAssets();
    expect(attempts).toHaveLength(1);
    // lie-fi: the request is reset at once while the model downloads on
    attempts[0].reject(new TypeError('Failed to fetch'));
    await flush();
    engine.resolve({ modelBuffer: new Uint8Array(4) });
    await assets;
    await flush();
    // 'done' asks again, and that retry hangs: the first photo detects at once, short-range
    expect(attempts).toHaveLength(2);
    expect(svc.photoDetectorPending()).toBeNull();
    expect(window.__meiyan?.detectorWaits ?? 0).toBe(0);
    attempts[1].resolve(new Uint8Array(6));
    await flush();
    expect(svc.photoDetectorPending()).toBeNull();
    // two requests in all: services joined the engine's, it started no third
    expect(attempts).toHaveLength(2);
  });
});

describe('services: downloadHint', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('gives a friendly reason per failure kind', async () => {
    const { svc } = await load({ current: { ...PREFS } });
    vi.stubGlobal('navigator', { onLine: true });
    const p = '/models/face_landmarker/float16-1/face_landmarker.task';
    expect(svc.downloadHint(new TypeError('Load failed'))).toBe('網路連線不穩，請確認網路後重試');
    expect(svc.downloadHint(new Error(`${p}: HTTP 503`))).toBe('伺服器暫時無法回應，請稍後重試');
    expect(svc.downloadHint(new Error(`${p}: HTTP 404`))).toBe('找不到引擎檔案，請稍後重試或重新開啟 App');
    expect(svc.downloadHint(new Error(`${p}: got HTML, asset missing`))).toBe('找不到引擎檔案，請稍後重試或重新開啟 App');
    expect(svc.downloadHint(new Error(`${p}: stalled for 30000 ms`))).toBe('下載逾時，請確認網路後重試');
    expect(svc.downloadHint(new Error(`${p}: truncated (1/2 B)`))).toBe('下載不完整，請重試');
    expect(svc.downloadHint('weird')).toBe('請確認網路後重試');
    vi.stubGlobal('navigator', { onLine: false });
    expect(svc.downloadHint(new Error(`${p}: HTTP 503`))).toBe('目前沒有網路連線，請連上網路後重試');
  });

  it('a failed download records both the hint and the raw message', async () => {
    const { svc, deps } = await load({ current: { ...PREFS } });
    vi.stubGlobal('navigator', { onLine: true });
    deps.loadEngineAssets = () => Promise.reject(new TypeError('Failed to fetch'));
    await expect(svc.prefetchAssets()).rejects.toThrow('Failed to fetch');
    expect(svc.svc.get().assets).toEqual({ state: 'error', message: 'Failed to fetch', hint: '網路連線不穩，請確認網路後重試' });
  });
});

describe('services: self-healing tracker state', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('mirrors the current tracker\'s onStateChange into svc.tracker and republishes its delegate', async () => {
    const prefs = { current: { ...PREFS } };
    const { svc, deps } = await load(prefs);
    deps.createEngine = (() => fakeEngine(Promise.resolve())) as unknown as Deps['createEngine'];
    const opts: TrackerOptions[] = [];
    const made: { delegate: 'GPU' | 'CPU'; close: ReturnType<typeof vi.fn> }[] = [];
    deps.createTracker = (async (o: TrackerOptions) => {
      opts.push(o);
      const t = { delegate: 'GPU' as 'GPU' | 'CPU', close: vi.fn() };
      made.push(t);
      return t;
    }) as unknown as Deps['createTracker'];
    const published = () => (window as unknown as { __meiyan?: { delegate: string | null } }).__meiyan?.delegate;

    await svc.ensureEngine();
    expect(svc.svc.get().tracker).toBe('ok');
    const onState = opts[0].onStateChange!;
    expect(onState).toBeTypeOf('function');

    onState('lost');
    expect(svc.svc.get().tracker).toBe('lost');
    made[0].delegate = 'CPU'; // an 'auto' rebuild fell back to CPU
    onState('ok');
    expect(svc.svc.get().tracker).toBe('ok');
    expect(published()).toBe('CPU');
    onState('failed');
    expect(svc.svc.get().tracker).toBe('failed');

    // a replaced tracker no longer speaks for the UI; the new one starts healthy
    prefs.current = { ...PREFS, delegate: 'CPU' } as Prefs;
    await svc.restartTracker();
    expect(made[0].close).toHaveBeenCalled();
    expect(svc.svc.get().tracker).toBe('ok');
    onState('lost');
    expect(svc.svc.get().tracker).toBe('ok');
  });
});

describe('services: recoverEngine', () => {
  let prefs: { current: Prefs };
  let engines: (Engine & { lost: boolean; dispose: ReturnType<typeof vi.fn> })[];
  let readies: Deferred<void>[];
  let made: FakeTracker[];
  let opts: TrackerOptions[];
  beforeEach(() => {
    prefs = { current: { ...PREFS } };
    engines = [];
    readies = [];
    made = [];
    opts = [];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** engines after the first get a deferred `ready` (the reload after a lost context) */
  async function setup(basic = false) {
    const { svc, deps } = await load(prefs);
    // every makeCanvas() gets its own element, so a replaced canvas is observable
    vi.stubGlobal('document', { createElement: () => ({ className: '', addEventListener: vi.fn() }) });
    deps.createEngine = vi.fn(() => {
      let ready = Promise.resolve();
      if (engines.length > 0) {
        const d = deferred<void>();
        readies.push(d);
        ready = d.promise;
      }
      const e = fakeEngine(ready) as (typeof engines)[number];
      engines.push(e);
      return e;
    }) as unknown as Deps['createEngine'];
    deps.createTracker = (async (o: TrackerOptions) => {
      opts.push(o);
      const t: FakeTracker = { delegate: 'GPU', close: vi.fn() };
      made.push(t);
      return t;
    }) as unknown as Deps['createTracker'];
    const first = await svc.ensureEngine(basic);
    return { svc, first };
  }
  const unclosed = () => made.filter((t) => t.close.mock.calls.length === 0);

  it('a live engine: only clears the lost flag', async () => {
    const { svc } = await setup();
    svc.svc.set({ lost: true });
    svc.recoverEngine();
    expect(svc.svc.get().lost).toBe(false);
    expect(engines).toHaveLength(1);
    expect(svc.svc.get().engine.state).toBe('ready');
  });

  it('a lost engine: new canvas + engine, the same tracker, loading → ready', async () => {
    const { svc, first } = await setup();
    const canvas = svc.svc.get().canvas;
    engines[0].lost = true;
    svc.svc.set({ lost: true });
    svc.recoverEngine();
    expect(engines[0].dispose).toHaveBeenCalled();
    expect(engines).toHaveLength(2);
    expect(svc.svc.get().canvas).not.toBe(canvas);
    expect(svc.svc.get().lost).toBe(false);
    expect(svc.svc.get().engine).toEqual({ state: 'loading', step: 'engine' });
    readies[0].resolve();
    await flush();
    const s = svc.svc.get().engine;
    expect(s.state).toBe('ready');
    if (s.state !== 'ready') return;
    expect(s.bundle.engine).toBe(engines[1]);
    expect(s.bundle.tracker).toBe(first.tracker);
    expect(s.bundle.basic).toBe(false);
    expect(made).toHaveLength(1);
    expect(unclosed()).toHaveLength(1);
  });

  it('without a tracker the recovered bundle stays basic', async () => {
    const { svc } = await setup(true);
    engines[0].lost = true;
    svc.recoverEngine();
    readies[0].resolve();
    await flush();
    const s = svc.svc.get().engine;
    expect(s.state === 'ready' && s.bundle.basic).toBe(true);
    expect(s.state === 'ready' && s.bundle.tracker).toBe(null);
  });

  it('a failed reload ends in error (no 基本模式 offer) and closes the kept tracker', async () => {
    const { svc } = await setup();
    engines[0].lost = true;
    svc.recoverEngine();
    readies[0].reject(new Error('lut 404'));
    await flush();
    expect(svc.svc.get().engine).toMatchObject({ state: 'error', canBasic: false });
    expect(made[0].close).toHaveBeenCalled();
    expect(engines[1].dispose).toHaveBeenCalled();
  });

  it('is a no-op while a build is in flight', async () => {
    const { svc } = await setup();
    engines[0].lost = true;
    prefs.current = { ...prefs.current, delegate: 'CPU' };
    const r = svc.restartTracker(); // tracker rebuild in flight
    svc.recoverEngine();
    expect(engines).toHaveLength(1);
    expect(engines[0].dispose).not.toHaveBeenCalled();
    await r;
  });

  it('ensureEngine during the reload joins the recovery: no second tracker', async () => {
    const { svc, first } = await setup();
    engines[0].lost = true;
    svc.recoverEngine();
    const joined = svc.ensureEngine(); // Camera / Editor mount while the engine reloads
    readies[0].resolve();
    const bundle = await joined;
    await flush();
    expect(made).toHaveLength(1);
    expect(bundle.tracker).toBe(first.tracker);
    expect(bundle.engine).toBe(engines[1]);
    expect(unclosed()).toEqual([first.tracker]);
    const s = svc.svc.get().engine;
    expect(s.state === 'ready' && s.bundle).toBe(bundle);
  });

  it('a delegate change during the reload rebuilds the kept tracker on the new engine once it is ready', async () => {
    const { svc, first } = await setup();
    engines[0].lost = true;
    svc.recoverEngine();
    prefs.current = { ...prefs.current, delegate: 'CPU' };
    const r = svc.restartTracker(); // joins the recovery, which keeps the old-delegate tracker
    readies[0].resolve();
    await r;
    await flush();
    expect(made).toHaveLength(2);
    expect(opts[1].delegate).toBe('CPU');
    expect(first.tracker?.close).toHaveBeenCalled();
    expect(unclosed()).toEqual([made[1]]);
    const s = svc.svc.get().engine;
    expect(s.state === 'ready' && s.bundle.engine).toBe(engines[1]);
    expect(s.state === 'ready' && s.bundle.tracker).toBe(made[1]);
  });

  it('a restart joining a build that already honoured the pref does not build again', async () => {
    const { svc } = await setup();
    prefs.current = { ...prefs.current, delegate: 'CPU' };
    const r1 = svc.restartTracker();
    const r2 = svc.restartTracker(); // joins r1's build, which is already for 'CPU'
    await Promise.all([r1, r2]);
    await flush();
    expect(made).toHaveLength(2);
    expect(unclosed()).toEqual([made[1]]);
  });

  it('tracker health changes during the reload are kept', async () => {
    const { svc } = await setup();
    const onState = opts[0].onStateChange!;
    onState('lost'); // GPU-process reset: the tracker's own context went too
    expect(svc.svc.get().tracker).toBe('lost');
    engines[0].lost = true;
    svc.recoverEngine();
    onState('ok'); // its replacement finished while the engine reloads
    readies[0].resolve();
    await flush();
    expect(svc.svc.get().engine.state).toBe('ready');
    expect(svc.svc.get().tracker).toBe('ok');

    // and the reverse: ok → lost during a second reload stays lost
    engines[1].lost = true;
    svc.recoverEngine();
    onState('lost');
    readies[1].resolve();
    await flush();
    expect(svc.svc.get().engine.state).toBe('ready');
    expect(svc.svc.get().tracker).toBe('lost');
  });
});

describe('services: 美體 body tracker', () => {
  let prefs: { current: Prefs };
  beforeEach(() => {
    prefs = { current: { ...PREFS } };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function setup() {
    const { svc, deps } = await load(prefs);
    deps.createEngine = (() => fakeEngine(Promise.resolve())) as unknown as Deps['createEngine'];
    const order: string[] = [];
    const faceGate = deferred<void>();
    deps.createTracker = (async () => {
      order.push('face:start');
      await faceGate.promise;
      order.push('face:done');
      return { delegate: 'GPU', close: vi.fn() } as unknown as Tracker;
    }) as unknown as Deps['createTracker'];
    const modelGate = deferred<Uint8Array>();
    const loadPoseModel = vi.fn((variant: string, onProgress?: (p: EngineAssetsProgress) => void) => {
      order.push(`pose-model:${variant}`);
      onProgress?.({ loaded: 50, total: 100, phase: 'model' });
      return modelGate.promise;
    });
    deps.loadPoseModel = loadPoseModel as unknown as Deps['loadPoseModel'];
    const created: BodyTrackerOptions[] = [];
    const createBodyTracker = vi.fn(async (o: BodyTrackerOptions) => {
      order.push('pose-tracker');
      created.push(o);
      return { variant: o.variant, delegate: o.delegate ?? 'CPU', detect: vi.fn(), detectVideo: vi.fn(), close: vi.fn() } as unknown as BodyTracker;
    });
    deps.createBodyTracker = createBodyTracker as unknown as Deps['createBodyTracker'];
    return { svc, deps, order, faceGate, modelGate, loadPoseModel, createBodyTracker, created };
  }

  it('starts only after the face tracker build settled (never alongside it), full + CPU + IMAGE', async () => {
    const t = await setup();
    const engineP = t.svc.ensureEngine();
    await flush();
    const bodyP = t.svc.ensureBodyTracker();
    await flush();
    expect(t.order).toEqual(['face:start']); // waiting for the face tracker
    expect(t.svc.svc.get().body).toEqual({ state: 'loading', step: 'tracker', progress: null });
    t.faceGate.resolve();
    await engineP;
    await flush();
    expect(t.order).toEqual(['face:start', 'face:done', 'pose-model:full']);
    expect(t.svc.svc.get().body).toEqual({ state: 'loading', step: 'model', progress: 0.5 });
    t.modelGate.resolve(new Uint8Array(8));
    const tracker = await bodyP;
    expect(t.order.at(-1)).toBe('pose-tracker');
    expect(t.created[0]).toMatchObject({ variant: 'full', delegate: 'CPU', runningMode: 'IMAGE', wasmBase: t.deps.wasmBase });
    expect(t.created[0].modelBuffer).toHaveLength(8);
    expect(t.svc.svc.get().body).toEqual({ state: 'ready' });
    expect(tracker.variant).toBe('full');
  });

  it('once per session: concurrent and later calls share one model load and one tracker', async () => {
    const t = await setup();
    t.faceGate.resolve();
    await t.svc.ensureEngine();
    const seen: number[] = [];
    const a = t.svc.ensureBodyTracker((p) => seen.push(p.loaded));
    const b = t.svc.ensureBodyTracker();
    t.modelGate.resolve(new Uint8Array(4));
    expect(await a).toBe(await b);
    expect(await t.svc.ensureBodyTracker()).toBe(await a);
    expect(t.loadPoseModel).toHaveBeenCalledTimes(1);
    expect(t.createBodyTracker).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([50]);
  });

  it('a failed download is a retryable error; the retry starts over', async () => {
    const t = await setup();
    t.faceGate.resolve();
    await t.svc.ensureEngine();
    t.loadPoseModel.mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(t.svc.ensureBodyTracker()).rejects.toThrow('Failed to fetch');
    const st = t.svc.svc.get().body;
    expect(st.state).toBe('error');
    expect(st.state === 'error' && st.hint).toBe('網路連線不穩，請確認網路後重試');
    const retry = t.svc.ensureBodyTracker();
    t.modelGate.resolve(new Uint8Array(4));
    await expect(retry).resolves.toBeTruthy();
    expect(t.loadPoseModel).toHaveBeenCalledTimes(2);
    expect(t.svc.svc.get().body.state).toBe('ready');
  });

  it('a graph that fails to start is retryable too (the downloaded model is fetched from the memo)', async () => {
    const t = await setup();
    t.faceGate.resolve();
    await t.svc.ensureEngine();
    t.modelGate.resolve(new Uint8Array(4));
    t.createBodyTracker.mockImplementationOnce(async () => {
      throw new Error('wasm OOM');
    });
    await expect(t.svc.ensureBodyTracker()).rejects.toThrow('wasm OOM');
    expect(t.svc.svc.get().body.state).toBe('error');
    await expect(t.svc.ensureBodyTracker()).resolves.toBeTruthy();
    expect(t.createBodyTracker).toHaveBeenCalledTimes(2);
    expect(t.svc.svc.get().body.state).toBe('ready');
  });

  it('works without any face tracker (基本模式)', async () => {
    const t = await setup();
    await t.svc.ensureEngine(true);
    const p = t.svc.ensureBodyTracker();
    t.modelGate.resolve(new Uint8Array(4));
    await expect(p).resolves.toBeTruthy();
    expect(t.order).not.toContain('face:start');
  });

  describe('beside a face tracker build that timed out', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    async function timedOut() {
      const t = await setup();
      const e = t.svc.ensureEngine();
      await vi.advanceTimersByTimeAsync(t.svc.TRACKER_BUILD_TIMEOUT_MS);
      await e; // 基本模式 for now, the face build goes on
      t.modelGate.resolve(new Uint8Array(4));
      return t;
    }

    it('creates its graph only once that build landed (the download may overlap)', async () => {
      const t = await timedOut();
      const p = t.svc.ensureBodyTracker();
      await vi.advanceTimersByTimeAsync(1000);
      expect(t.createBodyTracker).not.toHaveBeenCalled();
      t.faceGate.resolve();
      await expect(p).resolves.toBeTruthy();
      expect(t.order).toEqual(['face:start', 'pose-model:full', 'face:done', 'pose-tracker']);
    });

    it('gives up with a retryable hint when that build still runs after the wait', async () => {
      const t = await timedOut();
      const p = t.svc.ensureBodyTracker();
      p.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(t.svc.TRACKER_BUILD_TIMEOUT_MS);
      await expect(p).rejects.toThrow('臉部偵測仍在啟動');
      const st = t.svc.svc.get().body;
      expect(st.state === 'error' && st.hint).toContain('臉部偵測仍在啟動，請稍後重試');
      expect(t.createBodyTracker).not.toHaveBeenCalled();
    });

    it('a face rebuild released by the same landing waits first: never two graphs initialising together', async () => {
      const t = await timedOut();
      const body = t.svc.ensureBodyTracker();
      await vi.advanceTimersByTimeAsync(1000); // downloaded, waiting for the timed-out build
      expect(t.svc.svc.get().body).toEqual({ state: 'loading', step: 'tracker', progress: 1 });
      prefs.current = { ...prefs.current, delegate: 'CPU' };
      const restart = t.svc.restartTracker(); // 設定 › 偵測器: waits for the same build
      t.faceGate.resolve();
      await restart;
      await body;
      expect(t.order).toEqual(['face:start', 'pose-model:full', 'face:done', 'face:start', 'face:done', 'pose-tracker']);
    });
  });
});

describe('services: 瘦臉 person segmenter', () => {
  let prefs: { current: Prefs };
  beforeEach(() => {
    prefs = { current: { ...PREFS } };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function setup() {
    const { svc, deps } = await load(prefs);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    deps.createEngine = (() => fakeEngine(Promise.resolve())) as unknown as Deps['createEngine'];
    const order: string[] = [];
    const faceGate = deferred<void>();
    deps.createTracker = (async () => {
      order.push('face:start');
      await faceGate.promise;
      order.push('face:done');
      return { delegate: 'GPU', close: vi.fn() } as unknown as Tracker;
    }) as unknown as Deps['createTracker'];
    const loadSegmenterModel = vi.fn(async () => {
      order.push('seg-model');
      return new Uint8Array(3);
    });
    deps.loadSegmenterModel = loadSegmenterModel as unknown as Deps['loadSegmenterModel'];
    const made: { dead: boolean; lost: boolean; close: ReturnType<typeof vi.fn> }[] = [];
    const createPersonSegmenter = vi.fn(async (o: { modelBuffer: Uint8Array; wasmBase: string }) => {
      order.push(`seg:${o.modelBuffer.length}:${o.wasmBase}`);
      const s = { dead: false, lost: false, close: vi.fn(), segment: vi.fn(() => null) };
      made.push(s);
      return s;
    });
    deps.createPersonSegmenter = createPersonSegmenter as unknown as Deps['createPersonSegmenter'];
    return { svc, deps, order, faceGate, loadSegmenterModel, createPersonSegmenter, made };
  }

  it('creates its graph after the face tracker build settled (the download may overlap), then one instance for the session', async () => {
    const t = await setup();
    const engineP = t.svc.ensureEngine();
    await flush();
    const a = t.svc.ensureFaceSegmenter();
    const b = t.svc.ensureFaceSegmenter();
    await flush();
    expect(t.order).toEqual(['face:start', 'seg-model']);
    t.faceGate.resolve();
    await engineP;
    const sa = await a;
    expect(sa).not.toBeNull();
    expect(await b).toBe(sa);
    expect(await t.svc.ensureFaceSegmenter()).toBe(sa);
    expect(t.order).toEqual(['face:start', 'seg-model', 'face:done', `seg:3:${t.deps.wasmBase}`]);
    expect(t.createPersonSegmenter).toHaveBeenCalledTimes(1);
  });

  it('the 美體 tracker never initialises alongside its graph creation: a body build started meanwhile waits for it', async () => {
    const t = await setup();
    t.faceGate.resolve();
    await t.svc.ensureEngine();
    const createGate = deferred<void>();
    const create = t.createPersonSegmenter.getMockImplementation()!;
    t.createPersonSegmenter.mockImplementationOnce(async (o) => {
      t.order.push('seg:create');
      await createGate.promise;
      return create(o);
    });
    const seg = t.svc.ensureFaceSegmenter();
    await flush();
    expect(t.order).toContain('seg:create');
    const loadPoseModel = vi.fn(async () => {
      t.order.push('pose-model');
      return new Uint8Array(2);
    });
    t.deps.loadPoseModel = loadPoseModel as unknown as Deps['loadPoseModel'];
    t.deps.createBodyTracker = (async () => ({ close: vi.fn() })) as unknown as Deps['createBodyTracker'];
    const body = t.svc.ensureBodyTracker();
    await flush();
    expect(loadPoseModel).not.toHaveBeenCalled();
    createGate.resolve();
    await seg;
    await body;
    expect(t.order.indexOf('pose-model')).toBeGreaterThan(t.order.findIndex((o) => o.startsWith('seg:3:')));
  });

  describe('beside a face tracker build that timed out', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('creates its graph only once that build landed', async () => {
      const t = await setup();
      const e = t.svc.ensureEngine();
      await vi.advanceTimersByTimeAsync(t.svc.TRACKER_BUILD_TIMEOUT_MS);
      await e;
      const seg = t.svc.ensureFaceSegmenter();
      await vi.advanceTimersByTimeAsync(1000);
      expect(t.createPersonSegmenter).not.toHaveBeenCalled();
      t.faceGate.resolve();
      expect(await seg).not.toBeNull();
      expect(t.order).toEqual(['face:start', 'seg-model', 'face:done', `seg:3:${t.deps.wasmBase}`]);
    });

    it('still running after the wait: null (the unlimited 瘦臉) without marking it broken, and the next call creates it', async () => {
      const t = await setup();
      const e = t.svc.ensureEngine();
      await vi.advanceTimersByTimeAsync(t.svc.TRACKER_BUILD_TIMEOUT_MS);
      await e;
      const seg = t.svc.ensureFaceSegmenter();
      await vi.advanceTimersByTimeAsync(t.svc.TRACKER_BUILD_TIMEOUT_MS);
      expect(await seg).toBeNull();
      expect(t.createPersonSegmenter).not.toHaveBeenCalled();
      t.faceGate.resolve();
      await flush();
      expect(await t.svc.ensureFaceSegmenter()).not.toBeNull();
      expect(t.createPersonSegmenter).toHaveBeenCalledTimes(1);
    });
  });

  it("a stalled segmenter download never holds the 美體 tracker (it is not a graph build)", async () => {
    const t = await setup();
    t.faceGate.resolve();
    await t.svc.ensureEngine();
    const segGate = deferred<Uint8Array<ArrayBuffer>>();
    t.loadSegmenterModel.mockImplementationOnce(() => segGate.promise); // lie-fi: never settles in this test
    void t.svc.ensureFaceSegmenter();
    await flush();
    t.deps.loadPoseModel = (async () => new Uint8Array(2)) as unknown as Deps['loadPoseModel'];
    t.deps.createBodyTracker = (async () => ({ close: vi.fn() })) as unknown as Deps['createBodyTracker'];
    await t.svc.ensureBodyTracker();
    expect(t.svc.svc.get().body.state).toBe('ready');
    expect(t.createPersonSegmenter).not.toHaveBeenCalled();
  });

  it('a download that lands while a 美體 build is in flight creates the graph only after that build settled', async () => {
    const t = await setup();
    t.faceGate.resolve();
    await t.svc.ensureEngine();
    const segGate = deferred<Uint8Array<ArrayBuffer>>();
    t.loadSegmenterModel.mockImplementationOnce(() => segGate.promise);
    const seg = t.svc.ensureFaceSegmenter();
    await flush();
    const bodyGate = deferred<void>();
    t.deps.loadPoseModel = (async () => new Uint8Array(2)) as unknown as Deps['loadPoseModel'];
    t.deps.createBodyTracker = (async () => {
      t.order.push('pose-tracker:start');
      await bodyGate.promise;
      t.order.push('pose-tracker:done');
      return { close: vi.fn() };
    }) as unknown as Deps['createBodyTracker'];
    const body = t.svc.ensureBodyTracker();
    await flush();
    expect(t.order).toContain('pose-tracker:start');
    segGate.resolve(new Uint8Array(3));
    await flush();
    expect(t.createPersonSegmenter).not.toHaveBeenCalled();
    bodyGate.resolve();
    await body;
    expect(await seg).not.toBeNull();
    expect(t.order.findIndex((o) => o.startsWith('seg:3:'))).toBeGreaterThan(t.order.indexOf('pose-tracker:done'));
  });

  it('never rejects: a failed download gives null and the next call retries it', async () => {
    const t = await setup();
    t.faceGate.resolve();
    await t.svc.ensureEngine();
    t.loadSegmenterModel.mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await t.svc.ensureFaceSegmenter()).toBeNull();
    expect(await t.svc.ensureFaceSegmenter()).not.toBeNull();
    expect(t.loadSegmenterModel).toHaveBeenCalledTimes(2);
    expect(console.error).not.toHaveBeenCalled(); // an expected degradation, not an error
  });

  it('a graph that fails to start is not retried this session (heap / OOM), nor is a segmenter that died', async () => {
    const t = await setup();
    t.faceGate.resolve();
    await t.svc.ensureEngine();
    t.createPersonSegmenter.mockImplementationOnce(async () => {
      throw new Error('wasm OOM');
    });
    expect(await t.svc.ensureFaceSegmenter()).toBeNull();
    expect(await t.svc.ensureFaceSegmenter()).toBeNull();
    expect(t.createPersonSegmenter).toHaveBeenCalledTimes(1);

    const u = await setup();
    u.faceGate.resolve();
    await u.svc.ensureEngine();
    const s = await u.svc.ensureFaceSegmenter();
    expect(s).not.toBeNull();
    u.made[0].dead = true; // a segment() threw (not a lost context): broken at once
    expect(await u.svc.ensureFaceSegmenter()).toBeNull();
    expect(u.made[0].close).toHaveBeenCalledTimes(1);
    expect(u.createPersonSegmenter).toHaveBeenCalledTimes(1);
    expect(await u.svc.ensureFaceSegmenter()).toBeNull();
    expect(u.createPersonSegmenter).toHaveBeenCalledTimes(1);
  });

  it('a segmenter that lost its WebGL context is rebuilt once per session; a second loss leaves it broken', async () => {
    const t = await setup();
    t.faceGate.resolve();
    await t.svc.ensureEngine();
    const first = await t.svc.ensureFaceSegmenter();
    expect(first).not.toBeNull();
    Object.assign(t.made[0], { dead: true, lost: true }); // iOS took the context on backgrounding
    const second = await t.svc.ensureFaceSegmenter();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(t.made[0].close).toHaveBeenCalledTimes(1);
    expect(t.createPersonSegmenter).toHaveBeenCalledTimes(2);
    expect(await t.svc.ensureFaceSegmenter()).toBe(second);

    Object.assign(t.made[1], { dead: true, lost: true }); // and again
    expect(await t.svc.ensureFaceSegmenter()).toBeNull();
    expect(t.made[1].close).toHaveBeenCalledTimes(1);
    expect(await t.svc.ensureFaceSegmenter()).toBeNull();
    expect(t.createPersonSegmenter).toHaveBeenCalledTimes(2);
  });
  it('a loss seen only by polling (no event, no segment() throw) is found by the next ensure: rebuilt once, then broken', async () => {
    const t = await setup();
    t.faceGate.resolve();
    await t.svc.ensureEngine();
    // like createPersonSegmenter: dead / lost are getters over gl.isContextLost(), polled on every read, and the
    // cause is decided when the instance dies (close() never turns a live one "lost")
    /** per instance: take its WebGL context away (WEBGL_lose_context), and how often its getters polled it */
    const lose: (() => void)[] = [];
    const reads: number[] = [];
    t.createPersonSegmenter.mockImplementation(async () => {
      let flag = false;
      const gl = { isContextLost: () => flag };
      const i = lose.length;
      lose.push(() => {
        flag = true;
      });
      reads.push(0);
      let closed = false;
      let lost = false;
      const poll = () => {
        reads[i]++;
        if (!closed && gl.isContextLost()) lost = true;
        return lost;
      };
      const close = vi.fn(() => {
        closed = true;
      });
      const sg = {
        get dead() {
          return poll() || closed;
        },
        get lost() {
          return poll();
        },
        close,
        segment: vi.fn(() => null),
      };
      t.made.push(sg as unknown as (typeof t.made)[number]);
      return sg as unknown as Awaited<ReturnType<typeof t.createPersonSegmenter>>;
    });

    const first = await t.svc.ensureFaceSegmenter();
    expect(first).not.toBeNull();
    expect(first!.dead).toBe(false); // not preset: the flag is flipped only after the first ensure
    const polled = reads[0];
    expect(await t.svc.ensureFaceSegmenter()).toBe(first); // still alive: the same instance, polled, not rebuilt
    expect(reads[0]).toBeGreaterThan(polled);

    lose[0](); // iOS took the context while backgrounded: no webglcontextlost event, no segment() call since
    const second = await t.svc.ensureFaceSegmenter();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(t.made[0].close).toHaveBeenCalledTimes(1);
    expect(t.createPersonSegmenter).toHaveBeenCalledTimes(2);
    expect(await t.svc.ensureFaceSegmenter()).toBe(second);

    lose[1](); // and again: the single recreate is used up
    expect(await t.svc.ensureFaceSegmenter()).toBeNull();
    expect(t.made[1].close).toHaveBeenCalledTimes(1);
    expect(await t.svc.ensureFaceSegmenter()).toBeNull();
    expect(t.createPersonSegmenter).toHaveBeenCalledTimes(2);
  });
});
