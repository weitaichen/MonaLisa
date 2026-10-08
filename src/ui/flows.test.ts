// flows.ts openInEditor: the import decode size follows the effective tier (RB §4: 1440 on tier L).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Prefs, Tier } from '../types';

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

describe('openInEditor of a history entry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('hands the saved 瘦臉 limit (flag + segmenter mask) to the editor, so the reopen draws what was saved', async () => {
    const { flows, app } = await load('auto', 'H');
    const faceMask = { width: 2, height: 2, data: new Uint8Array([0, 255, 255, 0]) };
    await flows.openInEditor(new Blob([]), { historyId: 'e1', faceProtect: true, faceMask, returnTo: 'home' });
    const screen = app.get().screen;
    expect(screen.name).toBe('editor');
    if (screen.name !== 'editor') return;
    expect(screen.source.faceProtect).toBe(true);
    expect(screen.source.faceMask).toBe(faceMask);
  });

  it('an entry saved unlimited carries neither', async () => {
    const { flows, app } = await load('auto', 'H');
    await flows.openInEditor(new Blob([]), { historyId: 'e2', faceProtect: undefined, returnTo: 'home' });
    const screen = app.get().screen;
    if (screen.name !== 'editor') throw new Error('not the editor');
    expect('faceProtect' in screen.source).toBe(false);
    expect('faceMask' in screen.source).toBe(false);
  });
});
