// LUT and 調節 failure notices (step-2 spec §2.4, §7): once per look / once per session.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../state', () => ({ toast: vi.fn() }));
vi.mock('../debug', () => ({ reportError: vi.fn(() => 'reported') }));

import type { Engine } from '../../types';
import { toast } from '../state';
import { noteAdjustFailure, requestLut } from './hooks';

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('failure notices', () => {
  it('a failed 質感 LUT is announced once per look per session; a failed 濾鏡 only logged', async () => {
    const engine = { loadLut: vi.fn(() => Promise.reject(new Error('offline'))) } as unknown as Engine;
    requestLut(engine, 'look', 'ccd');
    requestLut(engine, 'look', 'ccd');
    requestLut(engine, 'look', 'film');
    requestLut(engine, 'filter', 'warm');
    await flush();
    expect(vi.mocked(toast).mock.calls.map((c) => c[0])).toEqual(['無法載入「CCD」質感，請稍後再試', '無法載入「膠片」質感，請稍後再試']);
    expect(engine.loadLut).toHaveBeenCalledTimes(4);
  });

  it('requestLut resolves true once the LUT loaded and false when it failed (the editor redraws after a good retry)', async () => {
    const ok = { loadLut: vi.fn(() => Promise.resolve()) } as unknown as Engine;
    const failed = { loadLut: vi.fn(() => Promise.reject(new Error('offline'))) } as unknown as Engine;
    const threw = {
      loadLut: vi.fn(() => {
        throw new Error('no context');
      }),
    } as unknown as Engine;
    await expect(requestLut(ok, 'look', 'flash')).resolves.toBe(true);
    await expect(requestLut(failed, 'look', 'flash')).resolves.toBe(false);
    await expect(requestLut(threw, 'filter', 'warm')).resolves.toBe(false);
  });

  it('「調節效果暫時無法使用」 once per session, only when the engine reports the 調節 program unavailable', () => {
    vi.mocked(toast).mockClear();
    expect(noteAdjustFailure({ adjustUnavailable: false })).toBe(false);
    expect(noteAdjustFailure({ adjustUnavailable: true })).toBe(true);
    expect(noteAdjustFailure({ adjustUnavailable: true })).toBe(false);
    expect(vi.mocked(toast).mock.calls).toEqual([['調節效果暫時無法使用', 3200]]);
  });
});
