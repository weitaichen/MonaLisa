import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPreset, defaultParams, PARAM_DEFS, setFilter, setParam, setShade } from '../engine/params';
import { splitLegacy } from '../edit/legacy';
import { neutralLook, neutralPerson } from '../edit/state';
import type { Prefs } from '../types';
import {
  clearExportCap,
  clearExportGuard,
  consumeExportGuardAtLaunch,
  DEFAULT_PREFS,
  EXPORT_CAP_KEY,
  EXPORT_DEBUG_KEY,
  EXPORT_GUARD_KEY,
  exportCapped,
  hasSavedSettings,
  loadLook,
  loadMakeupPartsSeen,
  loadParams,
  loadPrefs,
  LOOK_KEY,
  PARAMS_KEY,
  PERSONS_HINT_KEY,
  PREFS_KEY,
  readExportDebug,
  readExportGuard,
  sanitizePrefs,
  saveLook,
  saveMakeupPartsSeen,
  saveParams,
  savePrefs,
  SEEN_MAKEUP_PARTS_KEY,
  takePersonsHint,
  VERSION_KEY,
  writeExportGuard,
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

// 0.3's camera params key: no app path calls loadParams or saveParams since 0.4 (the camera reads loadLook, which
// migrates the key, and without any saved look starts at 原圖); kept for the legacy format, these tests and the t6 harness
describe('loadParams / saveParams (legacy meiyan.params.v1)', () => {
  it('nothing stored → the 自然 defaults (sanitizeParams of nothing: 0.3’s first launch)', () => {
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
    expect(Object.keys(stored).sort()).toEqual(['blushShade', 'bodyProtect', 'filterId', 'heightBand', 'lipShade', 'presetAmount', 'presetId', 'values']);
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
      exportFormat: 'png',
      exportSize: 'standard',
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

describe('camera look meiyan.look.v1 (RM §3.7, C3)', () => {
  it('first load without it migrates meiyan.params.v1 and leaves that key alone', () => {
    const p = setParam(applyPreset('glow', 1), 'skin.whiten', 0.9);
    store.setItem(PARAMS_KEY, JSON.stringify(p));
    const look = loadLook();
    expect(look).toEqual(splitLegacy(p));
    expect(JSON.parse(store.getItem(LOOK_KEY)!)).toEqual(look);
    expect(JSON.parse(store.getItem(PARAMS_KEY)!)).toEqual(p);
    // the next launch reads the migrated look back unchanged
    expect(loadLook()).toEqual(look);
  });
  it('round-trips and sanitizes', () => {
    const look = splitLegacy(applyPreset('refined', 0.4));
    saveLook(look);
    expect(loadLook()).toEqual(look);
    store.setItem(LOOK_KEY, JSON.stringify({ photo: { filterId: 'nope' }, person: { values: { 'skin.smooth': 7 } } }));
    const s = loadLook();
    expect(s.photo.filterId).toBe('none');
    expect(s.person.values['skin.smooth']).toBe(1);
  });
  it('a fresh install gets the 原圖 look (2026-10-18); hasSavedSettings sees the new key', () => {
    expect(loadLook()).toEqual(neutralLook());
    store.clear();
    expect(hasSavedSettings()).toBe(false);
    store.setItem(LOOK_KEY, '{}');
    expect(hasSavedSettings()).toBe(true);
  });
  it('a fresh install writes nothing: the next announceUpdate must not take it for a returning user', () => {
    expect(loadLook()).toEqual(neutralLook());
    expect(store.map.size).toBe(0);
    expect(hasSavedSettings()).toBe(false);
  });
  it('an upgrader who never changed the camera (0.3.0 / 0.4.0 ran here, no saved look) starts at 原圖 too, and nothing is written (2026-10-18: 全部都原圖)', () => {
    for (const seen of ['0.3.0', '0.4.0']) {
      store.clear();
      // what 0.3 / 0.4.0 leave behind for a camera used at its default 自然: the version and maybe the settings, no look
      store.setItem(VERSION_KEY, JSON.stringify(seen));
      store.setItem(PREFS_KEY, JSON.stringify({ ...DEFAULT_PREFS, exportFormat: 'png' }));
      const before = new Map(store.map);
      expect(loadLook(), seen).toEqual(neutralLook());
      expect(store.map, seen).toEqual(before);
      expect(store.getItem(LOOK_KEY), seen).toBeNull();
      // still a returning user for announceUpdate (已更新至 v0.5)
      expect(hasSavedSettings(), seen).toBe(true);
    }
    // the version alone (prefs never saved) reads the same
    store.clear();
    store.setItem(VERSION_KEY, JSON.stringify('0.4.0'));
    expect(loadLook()).toEqual(neutralLook());
    expect(store.getItem(LOOK_KEY)).toBeNull();
  });
  it('a stored look keeps what it holds; a field it lacks (or junk) is 原圖, never 自然', () => {
    const glow = splitLegacy(applyPreset('glow', 1));
    saveLook(glow);
    expect(loadLook()).toEqual(glow);
    for (const raw of ['{}', 'null', '{"photo":7,"person":"x"}']) {
      store.setItem(LOOK_KEY, raw);
      const l = loadLook();
      expect(l.photo.values, raw).toEqual(neutralLook().photo.values);
      expect(l.person, raw).toEqual(neutralPerson());
    }
    store.setItem(LOOK_KEY, JSON.stringify({ photo: { values: { 'skin.whiten': 0.4 } }, person: { values: { 'skin.smooth': 0.7 } } }));
    expect(loadLook().photo.values['skin.whiten']).toBe(0.4);
    expect(loadLook().photo.values['skin.sharpen']).toBe(0);
    expect(loadLook().person.values['skin.smooth']).toBe(0.7);
    expect(loadLook().person.values['shape.faceSlim']).toBe(0);
  });
});

describe('first group photo hint (S §1.1 item 11)', () => {
  it('is true exactly once per install and survives a failing storage as false', () => {
    expect(takePersonsHint()).toBe(true);
    expect(store.getItem(PERSONS_HINT_KEY)).not.toBeNull();
    expect(takePersonsHint()).toBe(false);
    // storage that cannot keep the flag would repeat the hint on every photo: never shown there
    stubThrowingGetter();
    expect(takePersonsHint()).toBe(false);
  });
});

describe('camera look: 調節 and 質感 (step-2 spec §5)', () => {
  it('a migrated meiyan.params.v1 opens with neutral 調節 and no look', () => {
    store.setItem(PARAMS_KEY, JSON.stringify(applyPreset('glow', 1)));
    const look = loadLook();
    const values = look.photo.values as Record<string, number>;
    for (const d of PARAM_DEFS.filter((x) => x.group === 'adjust')) expect(values[d.id], d.id).toBe(d.bidirectional ? 0.5 : 0);
    expect(look.photo.look).toBeNull();
  });

  it('a meiyan.look.v1 written by a step-1 build (no look, no adjust keys) or holding junk opens neutral', () => {
    const raw = JSON.parse(JSON.stringify(loadLook())) as { photo: { values: Record<string, unknown>; look?: unknown } };
    for (const k of Object.keys(raw.photo.values)) if (k.startsWith('adjust.')) delete raw.photo.values[k];
    delete raw.photo.look;
    store.setItem(LOOK_KEY, JSON.stringify(raw));
    expect(loadLook().photo.look).toBeNull();
    expect(loadLook().photo.values['adjust.vignette']).toBe(0);
    raw.photo.look = { id: 'ccd', amount: 'x' };
    raw.photo.values['adjust.exposure'] = Number.POSITIVE_INFINITY;
    store.setItem(LOOK_KEY, JSON.stringify(raw));
    expect(loadLook().photo.look).toBeNull();
    expect(loadLook().photo.values['adjust.exposure']).toBe(0.5);
  });

  it('round-trips 調節 values and the look', () => {
    const l = loadLook();
    const styled = { ...l, photo: { ...l.photo, values: { ...l.photo.values, 'adjust.fade': 0.3 }, look: { id: 'blue' as const, amount: 0.6 } } };
    store.setItem(LOOK_KEY, JSON.stringify(styled));
    expect(loadLook().photo.look).toEqual({ id: 'blue', amount: 0.6 });
    expect(loadLook().photo.values['adjust.fade']).toBe(0.3);
  });
});

describe('export prefs and keys (step 3)', () => {
  it('default to JPEG at full resolution; invalid values fall back to the defaults', () => {
    expect(DEFAULT_PREFS).toMatchObject({ exportFormat: 'jpeg', exportSize: 'full' });
    expect(sanitizePrefs({ exportFormat: 'png', exportSize: 'standard' })).toMatchObject({ exportFormat: 'png', exportSize: 'standard' });
    expect(sanitizePrefs({ exportFormat: 'heic', exportSize: 4096 })).toMatchObject({ exportFormat: 'jpeg', exportSize: 'full' });
  });

  it('the breadcrumb is written, read with a shape check, and cleared', () => {
    writeExportGuard({ at: 5, w: 4096, h: 3072, format: 'png' });
    expect(EXPORT_GUARD_KEY).toBe('meiyan.exportGuard.v1');
    expect(readExportGuard()).toEqual({ at: 5, w: 4096, h: 3072, format: 'png' });
    clearExportGuard();
    expect(readExportGuard()).toBeNull();
    store.setItem(EXPORT_GUARD_KEY, '{"at":"x"}');
    expect(readExportGuard()).toBeNull();
  });

  it('at launch a breadcrumb sets the 2048 cap once and is removed; a malformed one is removed without a cap', () => {
    writeExportGuard({ at: 1, w: 4000, h: 3000, format: 'jpeg' });
    expect(consumeExportGuardAtLaunch()).toBe(true);
    expect(store.getItem(EXPORT_GUARD_KEY)).toBeNull();
    expect(store.getItem(EXPORT_CAP_KEY)).toBe('2048');
    expect(exportCapped()).toBe(true);
    expect(consumeExportGuardAtLaunch()).toBe(false);
    clearExportCap();
    expect(exportCapped()).toBe(false);
    store.setItem(EXPORT_GUARD_KEY, 'not json');
    expect(consumeExportGuardAtLaunch()).toBe(false);
    expect(store.getItem(EXPORT_GUARD_KEY)).toBeNull();
    expect(exportCapped()).toBe(false);
  });

  it('the test knob keeps only valid fields', () => {
    expect(readExportDebug()).toEqual({});
    store.setItem(EXPORT_DEBUG_KEY, JSON.stringify({ tile: 256, slowMs: 4500, failAt: 'tile' }));
    expect(readExportDebug()).toEqual({ tile: 256, slowMs: 4500, failAt: 'tile' });
    store.setItem(EXPORT_DEBUG_KEY, JSON.stringify({ tile: 300, slowMs: -1, failAt: 'boom' }));
    expect(readExportDebug()).toEqual({});
  });

  it('every key access survives a throwing storage', () => {
    const boom = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom });
    expect(() => writeExportGuard({ at: 1, w: 1, h: 1, format: 'jpeg' })).not.toThrow();
    expect(consumeExportGuardAtLaunch()).toBe(false);
    expect(exportCapped()).toBe(false);
    expect(readExportDebug()).toEqual({});
    expect(() => clearExportCap()).not.toThrow();
  });
});

describe('美妝 part-list seen flag (face-detail spec §2.3)', () => {
  it('is false until saved, then true, under its own new key', () => {
    expect(SEEN_MAKEUP_PARTS_KEY).toBe('meiyan.seen.makeupParts.v1');
    expect(loadMakeupPartsSeen()).toBe(false);
    saveMakeupPartsSeen();
    expect(store.getItem(SEEN_MAKEUP_PARTS_KEY)).toBe('true');
    expect(loadMakeupPartsSeen()).toBe(true);
  });
  it('blocked storage reads as not seen and never throws', () => {
    stubThrowingGetter();
    expect(loadMakeupPartsSeen()).toBe(false);
    expect(() => saveMakeupPartsSeen()).not.toThrow();
  });
});
