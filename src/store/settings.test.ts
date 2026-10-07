import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPreset, defaultParams, PARAM_DEFS, setFilter, setParam, setShade } from '../engine/params';
import type { Prefs } from '../types';
import {
  DEFAULT_PREFS,
  loadParams,
  loadPrefs,
  PARAMS_KEY,
  PREFS_KEY,
  sanitizePrefs,
  saveParams,
  savePrefs,
} from './settings';

/** Minimal Map-backed Storage. */
class MemoryStorage implements Storage {
  readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
}

let store: MemoryStorage;

beforeEach(() => {
  store = new MemoryStorage();
  vi.stubGlobal('localStorage', store);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Make `globalThis.localStorage` a getter that throws, like Safari with site data blocked. */
function stubThrowingGetter(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
  });
}

describe('loadParams / saveParams', () => {
  it('first launch (nothing stored) → 自然 defaults', () => {
    expect(loadParams()).toEqual(defaultParams());
  });

  it('round-trips params under meiyan.params.v1', () => {
    let p = applyPreset('glow', 0.6);
    p = setParam(p, 'shape.chin', 0.81);
    p = setFilter(p, 'film');
    p = setShade(p, 'lip', 'rose');
    saveParams(p);
    expect([...store.map.keys()]).toEqual([PARAMS_KEY]);
    expect(PARAMS_KEY).toBe('meiyan.params.v1');
    expect(loadParams()).toEqual(p);
  });

  it('round-trips every preset at several amounts', () => {
    for (const id of ['original', 'natural', 'refined', 'glow'] as const) {
      for (const a of [0, 0.33, 1]) {
        const p = applyPreset(id, a);
        saveParams(p);
        expect(loadParams()).toEqual(p);
      }
    }
  });

  it('stores only known fields', () => {
    const p = { ...defaultParams(), extra: 'junk', values: { ...defaultParams().values, 'bogus.param': 3 } };
    saveParams(p);
    const stored = JSON.parse(store.getItem(PARAMS_KEY)!) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(['blushShade', 'filterId', 'lipShade', 'presetAmount', 'presetId', 'values']);
    expect(Object.keys(stored.values as object).sort()).toEqual(PARAM_DEFS.map((d) => d.id).sort());
  });

  it.each([
    ['corrupt JSON', '{"values": {'],
    ['empty string', ''],
    ['null', 'null'],
    ['number', '42'],
    ['string', '"hello"'],
    ['array', '[1,2,3]'],
    ['boolean', 'true'],
    ['undefined text', 'undefined'],
  ])('%s → defaults', (_name, text) => {
    store.setItem(PARAMS_KEY, text);
    expect(loadParams()).toEqual(defaultParams());
  });

  it('partial / invalid stored params are merged over defaults and clamped', () => {
    store.setItem(
      PARAMS_KEY,
      JSON.stringify({
        values: { 'skin.smooth': 0.9, 'skin.whiten': 7, 'skin.rosy': -1, 'skin.sharpen': 'x', 'shape.chin': null },
        filterId: 'no-such-filter',
        lipShade: 'rose',
        blushShade: 42,
        presetId: 'hacked',
        presetAmount: 3,
      }),
    );
    const d = defaultParams();
    const p = loadParams();
    expect(p.values['skin.smooth']).toBe(0.9);
    expect(p.values['skin.whiten']).toBe(1);
    expect(p.values['skin.rosy']).toBe(0);
    expect(p.values['skin.sharpen']).toBe(d.values['skin.sharpen']);
    expect(p.values['shape.chin']).toBe(d.values['shape.chin']);
    expect(p.filterId).toBe('none');
    expect(p.lipShade).toBe('rose');
    expect(p.blushShade).toBeNull();
    // the values no longer match the 自然 preset, so the stored preset id cannot stand
    expect(p.presetId).toBe('custom');
    expect(p.presetAmount).toBe(1);
  });

  it('getItem throwing → defaults, no throw', () => {
    vi.spyOn(store, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(loadParams()).toEqual(defaultParams());
  });

  it('setItem throwing (quota) → swallowed', () => {
    vi.spyOn(store, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(() => saveParams(defaultParams())).not.toThrow();
    expect(store.map.size).toBe(0);
  });

  it('localStorage getter throwing → defaults, saves are no-ops', () => {
    stubThrowingGetter();
    expect(() => saveParams(applyPreset('refined'))).not.toThrow();
    expect(loadParams()).toEqual(defaultParams());
  });

  it('localStorage missing → defaults, saves are no-ops', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => saveParams(applyPreset('refined'))).not.toThrow();
    expect(loadParams()).toEqual(defaultParams());
  });

  it('a later save overwrites the earlier one', () => {
    saveParams(applyPreset('refined'));
    saveParams(applyPreset('glow', 0.5));
    expect(loadParams()).toEqual(applyPreset('glow', 0.5));
  });

  it('returns a fresh object each call', () => {
    saveParams(applyPreset('refined'));
    const a = loadParams();
    a.values['skin.smooth'] = 0;
    expect(loadParams().values['skin.smooth']).toBe(applyPreset('refined').values['skin.smooth']);
  });
});

describe('loadPrefs / savePrefs', () => {
  it('first launch → defaults (a copy, not the shared constant)', () => {
    const p = loadPrefs();
    expect(p).toEqual(DEFAULT_PREFS);
    expect(p).not.toBe(DEFAULT_PREFS);
    p.mirrorOnSave = false;
    expect(DEFAULT_PREFS.mirrorOnSave).toBe(true);
    expect(loadPrefs().mirrorOnSave).toBe(true);
  });

  it('round-trips every field under meiyan.prefs.v1', () => {
    const p: Prefs = {
      mirrorOnSave: false,
      tier: 'L',
      matchGpupixel: true,
      showLandmarks: true,
      delegate: 'CPU',
      installHintDismissed: true,
    };
    savePrefs(p);
    expect([...store.map.keys()]).toEqual([PREFS_KEY]);
    expect(PREFS_KEY).toBe('meiyan.prefs.v1');
    expect(loadPrefs()).toEqual(p);
  });

  it.each(['auto', 'H', 'M', 'L'] as const)('accepts tier %s', (tier) => {
    savePrefs({ ...DEFAULT_PREFS, tier });
    expect(loadPrefs().tier).toBe(tier);
  });

  it('params and prefs live under separate keys and do not clobber each other', () => {
    savePrefs({ ...DEFAULT_PREFS, tier: 'M' });
    saveParams(applyPreset('glow'));
    expect(loadPrefs().tier).toBe('M');
    expect(loadParams()).toEqual(applyPreset('glow'));
  });

  it('merges a partial object over defaults (e.g. older version without a field)', () => {
    store.setItem(PREFS_KEY, JSON.stringify({ tier: 'H', showLandmarks: true }));
    expect(loadPrefs()).toEqual({ ...DEFAULT_PREFS, tier: 'H', showLandmarks: true });
  });

  it('drops wrongly-typed fields individually', () => {
    store.setItem(
      PREFS_KEY,
      JSON.stringify({
        mirrorOnSave: 'false', // string, not boolean
        tier: 'X',
        matchGpupixel: 1,
        showLandmarks: true,
        delegate: 'GPU', // not a selectable pref value
        installHintDismissed: null,
      }),
    );
    expect(loadPrefs()).toEqual({ ...DEFAULT_PREFS, showLandmarks: true });
  });

  it('drops unknown keys', () => {
    store.setItem(PREFS_KEY, JSON.stringify({ ...DEFAULT_PREFS, tier: 'M', evil: true }));
    const p = loadPrefs();
    expect(Object.keys(p).sort()).toEqual(Object.keys(DEFAULT_PREFS).sort());
    expect(p.tier).toBe('M');
  });

  it('does not let a "__proto__" key pollute the result', () => {
    store.setItem(PREFS_KEY, '{"__proto__": {"tier": "L", "polluted": true}, "delegate": "CPU"}');
    const p = loadPrefs() as Prefs & { polluted?: boolean };
    expect(p.tier).toBe('auto');
    expect(p.polluted).toBeUndefined();
    expect(p.delegate).toBe('CPU');
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it.each([
    ['corrupt JSON', '{tier: H}'],
    ['empty string', ''],
    ['null', 'null'],
    ['array', '["H"]'],
    ['number', '0'],
    ['string', '"L"'],
  ])('%s → defaults', (_name, text) => {
    store.setItem(PREFS_KEY, text);
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('savePrefs writes only known, valid fields', () => {
    savePrefs({ ...DEFAULT_PREFS, tier: 'bogus' as Prefs['tier'], extra: 1 } as Prefs);
    const stored = JSON.parse(store.getItem(PREFS_KEY)!) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(Object.keys(DEFAULT_PREFS).sort());
    expect(stored.tier).toBe('auto');
  });

  it('storage failures never throw', () => {
    vi.spyOn(store, 'getItem').mockImplementation(() => {
      throw new Error('boom');
    });
    vi.spyOn(store, 'setItem').mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() => savePrefs({ ...DEFAULT_PREFS, tier: 'H' })).not.toThrow();
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('localStorage getter throwing → defaults', () => {
    stubThrowingGetter();
    expect(() => savePrefs({ ...DEFAULT_PREFS, tier: 'H' })).not.toThrow();
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });
});

describe('sanitizePrefs', () => {
  it.each([undefined, null, 0, 'x', true, [], [DEFAULT_PREFS]])('%j → defaults', (raw) => {
    expect(sanitizePrefs(raw)).toEqual(DEFAULT_PREFS);
  });

  it('is idempotent on valid prefs', () => {
    const p: Prefs = { ...DEFAULT_PREFS, tier: 'M', delegate: 'CPU', mirrorOnSave: false };
    expect(sanitizePrefs(sanitizePrefs(p))).toEqual(p);
  });
});
