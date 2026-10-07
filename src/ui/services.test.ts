// services.ts engine/tracker lifecycle: retry after a failed engine, one tracker build at a time,
// and delegate toggles that land while a build is in flight.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Engine, Prefs, Tracker, TrackerOptions } from '../types';

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
