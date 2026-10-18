// flows.ts openInEditor: the import decode size follows the effective tier (RB §4: 1440 on tier L).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyPreset, defaultParams, setFilter, setParam } from '../engine/params';
import { splitLegacy } from '../edit/legacy';
import { neutralPerson, neutralPhoto } from '../edit/state';
import type { HistoryEntry, Prefs, Tier } from '../types';

async function load(tier: Prefs['tier'], sessionTier: Tier) {
  vi.resetModules();
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  vi.stubGlobal('document', { createElement: () => ({ className: '', addEventListener: vi.fn() }) });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const { deps } = await import('./deps');
  const { app } = await import('./state');
  const flows = await import('./flows');
  app.set({ prefs: { ...app.get().prefs, tier } });
  const importPhoto = vi.fn(async () => ({ width: 4, height: 3, close: vi.fn() }) as unknown as ImageBitmap);
  deps.importPhoto = importPhoto as unknown as typeof deps.importPhoto;
  deps.autoTierSession = () => sessionTier;
  return { flows, importPhoto, app };
}

describe('openInEditor import size', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const cases: [Prefs['tier'], Tier, number][] = [
    ['auto', 'L', 1440], // the live loop stepped down to L this session
    ['auto', 'M', 2048],
    ['auto', 'H', 2048], // camera not run yet
    ['L', 'H', 1440],
    ['H', 'L', 2048], // a fixed pref wins over the auto session tier
  ];
  it.each(cases)('pref %s with session tier %s decodes at %i', async (tier, sessionTier, edge) => {
    const { flows, importPhoto, app } = await load(tier, sessionTier);
    await flows.openInEditor(new Blob([]), { returnTo: 'home' });
    expect(importPhoto).toHaveBeenCalledWith(expect.anything(), edge);
    expect(app.get().screen.name).toBe('editor');
  });
});

describe('openInEditor of a new photo (2026-10-18: 全部都原圖)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('an import opens at 原圖 for everyone, whatever look the camera holds', async () => {
    const { flows, app } = await load('auto', 'H');
    const styled = splitLegacy(setFilter(setParam(applyPreset('glow', 1), 'skin.whiten', 0.9), 'warm'));
    app.set({ look: { photo: { ...styled.photo, values: { ...styled.photo.values, 'adjust.vignette': 0.6 }, look: { id: 'film', amount: 0.8 } }, person: styled.person } });
    await flows.openInEditor(new Blob([]), { returnTo: 'home' });
    const screen = app.get().screen;
    if (screen.name !== 'editor') throw new Error('not the editor');
    expect(screen.source.edit).toEqual({ v: 2, photo: neutralPhoto(), persons: { p0: neutralPerson() }, template: neutralPerson(), primaryInit: null });
    // the camera keeps its own look
    expect(app.get().look.photo.look).toEqual({ id: 'film', amount: 0.8 });
  });
});

describe('openInEditor of a history entry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const entry = (over: Partial<HistoryEntry>): HistoryEntry => ({
    id: 'e1', createdAt: 1, updatedAt: 1, original: new Blob([]), thumb: new Blob([]), params: defaultParams(), width: 4, height: 3, ...over,
  });

  it('hands the saved 瘦臉 limit (flag + segmenter mask) to the editor, so the reopen draws what was saved', async () => {
    const { flows, app } = await load('auto', 'H');
    const faceMask = { width: 2, height: 2, data: new Uint8Array([0, 255, 255, 0]) };
    await flows.openInEditor(new Blob([]), { entry: entry({ faceProtect: true, faceMask }), returnTo: 'home' });
    const screen = app.get().screen;
    expect(screen.name).toBe('editor');
    if (screen.name !== 'editor') return;
    expect(screen.source.faceProtect).toBe(true);
    expect(screen.source.faceMask).toBe(faceMask);
    expect(screen.source.edit.persons.p0).toBeDefined();
  });

  it('an entry saved unlimited carries neither', async () => {
    const { flows, app } = await load('auto', 'H');
    await flows.openInEditor(new Blob([]), { entry: entry({ id: 'e2' }), returnTo: 'home' });
    const screen = app.get().screen;
    if (screen.name !== 'editor') throw new Error('not the editor');
    expect('faceProtect' in screen.source).toBe(false);
    expect('faceMask' in screen.source).toBe(false);
  });
});

describe('openInEditor source (step 3)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a picked file is decoded with its oriented size and handed over for the keep decision', async () => {
    const { flows, app } = await load('auto', 'H');
    const { deps } = await import('./deps');
    const info = vi.fn(async () => ({ bitmap: { width: 1536, height: 2048, close: vi.fn() } as unknown as ImageBitmap, oriented: { width: 3000, height: 4000 } }));
    deps.importPhotoInfo = info as unknown as typeof deps.importPhotoInfo;
    const file = new File([new Uint8Array(8)], 'p.jpg', { type: 'image/jpeg' });
    await flows.openInEditor(file, { returnTo: 'home', picked: true });
    expect(info).toHaveBeenCalledWith(file, 2048);
    const screen = app.get().screen;
    if (screen.name !== 'editor') throw new Error('not the editor');
    expect(screen.source.picked).toBe(file);
    expect(screen.source.source).toEqual({ blob: null, width: 3000, height: 4000 });
  });

  it('a reopened entry carries its stored source through', async () => {
    const { flows, app } = await load('auto', 'H');
    const blob = new Blob(['s']);
    // step 1's reopen: openInEditor gets the entry itself (Home.tsx openEntry) and runs openState inside
    const entry: HistoryEntry = {
      id: 'e3', createdAt: 1, updatedAt: 1, original: new Blob([]), thumb: new Blob([]), params: defaultParams(), width: 4, height: 3,
      source: blob, sourceWidth: 4032, sourceHeight: 3024,
    };
    await flows.openInEditor(new Blob([]), { entry, returnTo: 'home' });
    const screen = app.get().screen;
    if (screen.name !== 'editor') throw new Error('not the editor');
    expect(screen.source.source).toEqual({ blob, width: 4032, height: 3024 });
    expect(screen.source.picked).toBeUndefined();
  });
});
