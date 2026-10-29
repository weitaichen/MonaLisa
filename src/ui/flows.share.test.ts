// flows.ts shareFile: the one 儲存 hand-off of Review, the Editor and the clip screen (RB §1 #10). saveFile must run
// inside the tap, and every answer it can give ends the same way wherever 儲存 was tapped: the share sheet's 完成, the
// save dialog, or nothing. The real state is used (the dialog fields are the contract); only toast() is a spy, since
// it starts a timer.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SaveResult } from '../types';
import { deps } from './deps';
import { shareFile } from './flows';
import { app, toast } from './state';

// state.ts → debug.ts keeps window.__meiyan from import on; node has no `window`
vi.hoisted(() => {
  (globalThis as { window?: unknown }).window = globalThis;
});
vi.mock('./state', async (orig) => ({ ...(await orig<typeof import('./state')>()), toast: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks(); // deps.saveFile, URL, console.error
  vi.mocked(toast).mockClear();
  app.set({ saveFallback: null, saveFallbackName: null, saveFallbackKind: 'image' });
  if (window.__meiyan) window.__meiyan.lastError = null;
});

const photo = () => new File(['jpg'], 'meiyan-20261029-120000.jpg', { type: 'image/jpeg' });
const clip = () => new File(['mp4'], 'meiyan-20261029-120000.mp4', { type: 'video/mp4' });

/** the save promise's handlers have run */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** shareFile with saveFile answering `answer`; waits until the answer has been handled; gives the dialog's URL spy */
async function shareWith(file: File, answer: () => Promise<SaveResult>) {
  vi.spyOn(deps, 'saveFile').mockImplementation(answer);
  const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:dialog');
  vi.spyOn(console, 'error').mockImplementation(() => undefined); // reportError logs
  shareFile(file);
  await settle();
  return { createUrl };
}

describe('shareFile', () => {
  it('calls saveFile inside the tap: before shareFile returns, with nothing awaited first', () => {
    const file = photo();
    const save = vi.spyOn(deps, 'saveFile').mockReturnValue(new Promise<SaveResult>(() => undefined));
    shareFile(file);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(file);
  });

  it("says 完成 for 'shared' and opens no dialog", async () => {
    await shareWith(photo(), () => Promise.resolve('shared'));
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('完成');
    expect(app.get().saveFallback).toBeNull();
  });

  it("does nothing for 'cancelled': no toast, no dialog, no error", async () => {
    await shareWith(photo(), () => Promise.resolve('cancelled'));
    expect(toast).not.toHaveBeenCalled();
    expect(app.get().saveFallback).toBeNull();
    expect(window.__meiyan?.lastError).toBeNull();
  });

  it.each([
    ['a photo', photo, 'image'],
    ['a clip', clip, 'video'],
  ] as const)("opens the save dialog on the file for 'fallback': %s", async (_what, make, kind) => {
    const file = make();
    const { createUrl } = await shareWith(file, () => Promise.resolve('fallback'));
    expect(createUrl).toHaveBeenCalledWith(file);
    expect(app.get()).toMatchObject({ saveFallback: 'blob:dialog', saveFallbackName: file.name, saveFallbackKind: kind });
    expect(toast).not.toHaveBeenCalled();
    expect(window.__meiyan?.lastError).toBeNull();
  });

  it.each([
    ['a rejection', () => Promise.reject(new Error('share failed'))],
    [
      'a synchronous throw',
      () => {
        throw new Error('share failed');
      },
    ],
  ])('reports %s, then opens the dialog like a fallback', async (_what, answer) => {
    const file = clip();
    await shareWith(file, answer);
    expect(window.__meiyan?.lastError).toBe('saveFile: share failed');
    expect(app.get()).toMatchObject({ saveFallback: 'blob:dialog', saveFallbackName: file.name, saveFallbackKind: 'video' });
    expect(toast).not.toHaveBeenCalled();
  });
});
