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
