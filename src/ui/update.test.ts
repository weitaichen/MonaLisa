// update.ts wiring in node, with the browser globals it touches stubbed: 更新 must cover the screen until the
// reload, and the first launch of a new version announces it once.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_VERSION, displayVersion } from '../version';

function memoryStorage(init: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(init));
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
  };
}

async function load(opts: { storage?: Storage | undefined; controlled?: boolean } = {}) {
  vi.resetModules();
  const reload = vi.fn();
  const swListeners: string[] = [];
  // timers are recorded, never run (the 6 s reload fallback must not fire after the test)
  vi.stubGlobal('window', {
    setTimeout: vi.fn(() => 0),
    clearTimeout: vi.fn(),
    setInterval: vi.fn(() => 0),
    addEventListener: vi.fn(),
    location: { reload },
  });
  vi.stubGlobal('document', { addEventListener: vi.fn(), visibilityState: 'visible', createElement: () => ({}) });
  vi.stubGlobal('navigator', {
    onLine: true,
    serviceWorker: {
      controller: opts.controlled ? {} : null,
      addEventListener: (type: string) => swListeners.push(type),
    },
  });
  vi.stubGlobal('localStorage', 'storage' in opts ? opts.storage : memoryStorage());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const update = await import('./update');
  const { app } = await import('./state');
  const { needRefresh } = await import('./updateModel');
  return { update, app, needRefresh, reload, swListeners };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('更新', () => {
  it('covers the screen (no way off 首頁) before handing over to the waiting worker', async () => {
    const { update, app, needRefresh, swListeners } = await load();
    let busyAtHandover: string | null = null;
    update.setUpdateSW(async () => {
      busyAtHandover = app.get().busy;
    });
    update.updates.set(needRefresh);
    await update.applyUpdate();
    expect(update.updates.get().phase).toBe('applying');
    expect(busyAtHandover).toBe('正在更新…');
    expect(app.get().busy).toBe('正在更新…');
    expect(swListeners).toContain('controllerchange');
  });

  it('does nothing (no overlay) when no update is offered', async () => {
    const { update, app } = await load();
    const sw = vi.fn(async () => undefined);
    update.setUpdateSW(sw);
    await update.applyUpdate();
    expect(sw).not.toHaveBeenCalled();
    expect(app.get().busy).toBeNull();
  });
});

describe('announceUpdate', () => {
  const notice = `已更新至 ${displayVersion(APP_VERSION)}`;

  it('fresh install: silent, records the version', async () => {
    const storage = memoryStorage();
    const { update, app } = await load({ storage });
    update.announceUpdate();
    expect(app.get().toast).toBeNull();
    expect(JSON.parse(storage.getItem('meiyan.version.v1') ?? 'null')).toBe(APP_VERSION);
  });

  it('0.1 → this version (nothing recorded, but a controlling worker from an earlier session): once', async () => {
    const storage = memoryStorage();
    const first = await load({ storage, controlled: true });
    first.update.announceUpdate();
    expect(first.app.get().toast?.text).toBe(notice);
    // the next launch is quiet
    const next = await load({ storage, controlled: true });
    next.update.announceUpdate();
    expect(next.app.get().toast).toBeNull();
  });

  it('0.1 user without a service worker (Lockdown Mode) is recognised by saved settings', async () => {
    const { update, app } = await load({ storage: memoryStorage({ 'meiyan.prefs.v1': '{}' }) });
    update.announceUpdate();
    expect(app.get().toast?.text).toBe(notice);
  });

  it('after an update recorded by the previous version', async () => {
    const { update, app } = await load({ storage: memoryStorage({ 'meiyan.version.v1': '"0.0.1"' }) });
    update.announceUpdate();
    expect(app.get().toast?.text).toBe(notice);
  });

  it('no storage: never announces (every launch would look like the first)', async () => {
    const { update, app } = await load({ storage: undefined, controlled: true });
    update.announceUpdate();
    expect(app.get().toast).toBeNull();
  });
});
