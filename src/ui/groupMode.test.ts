import { describe, expect, it, vi } from 'vitest';
import { GROUP_MODE_HINT, GROUP_MODE_LABEL, GROUP_MODE_ON_TOAST, groupSceneHints, toggleGroupMode, warmsOnStart } from './groupMode';

describe('合照模式 (camera per-person spec K22): the toggle and its one-time toasts', () => {
  it('the copy', () => {
    expect(GROUP_MODE_LABEL).toBe('合照模式');
    expect(GROUP_MODE_ON_TOAST).toBe('遠處的人也能點選，人多時預覽可能較不順');
    expect(GROUP_MODE_HINT).toBe('開啟合照模式，遠處的人也能點選');
  });

  it('a tap flips the mode; turning it on shows the toast the first time only; turning it off shows none', () => {
    let due = true;
    const take = vi.fn(() => {
      const d = due;
      due = false;
      return d;
    });
    expect(toggleGroupMode(false, take)).toEqual({ groupMode: true, toast: GROUP_MODE_ON_TOAST });
    expect(toggleGroupMode(true, take)).toEqual({ groupMode: false, toast: null });
    expect(take).toHaveBeenCalledTimes(1);
    expect(toggleGroupMode(false, take)).toEqual({ groupMode: true, toast: null });
  });

  it('≥ 2 faces shown with the mode off: the tap hint first (its own once-per-install flag), then the 合照模式 hint', () => {
    const persons = vi.fn(() => true);
    const group = vi.fn(() => true);
    expect(groupSceneHints(false, { persons, groupMode: group })).toEqual(['點選畫面中的臉，可個別調整', GROUP_MODE_HINT]);
    // both taken: nothing more, ever (the flags answer false from now on)
    persons.mockReturnValue(false);
    group.mockReturnValue(false);
    expect(groupSceneHints(false, { persons, groupMode: group })).toEqual([]);
  });

  it('the 合照模式 hint alone once the tap hint was shown on an earlier visit', () => {
    expect(groupSceneHints(false, { persons: () => false, groupMode: () => true })).toEqual([GROUP_MODE_HINT]);
  });

  it('with the mode on the 合照模式 hint is never asked for (its flag is kept for later)', () => {
    const group = vi.fn(() => true);
    expect(groupSceneHints(true, { persons: () => true, groupMode: group })).toEqual(['點選畫面中的臉，可個別調整']);
    expect(groupSceneHints(true, { persons: () => false, groupMode: group })).toEqual([]);
    expect(group).not.toHaveBeenCalled();
  });

  it('a camera start warms its first graph behind the spinner on the back camera, and on the front camera only with the mode on (its IMAGE graph); the solo selfie start is v0.5’s', () => {
    expect([warmsOnStart('environment', false), warmsOnStart('environment', true)]).toEqual([true, true]);
    expect([warmsOnStart('user', false), warmsOnStart('user', true)]).toEqual([false, true]);
  });
});
