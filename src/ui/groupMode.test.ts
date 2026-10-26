import { describe, expect, it, vi } from 'vitest';
import { GROUP_MODE_HINT, GROUP_MODE_LABEL, GROUP_MODE_ON_TOAST, groupModeAvailable, HINT_GAP_MS, showGroupSceneHints, toggleGroupMode, warmsOnStart } from './groupMode';

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

  /** a camera visit's first ≥ 2-face tick, on fakes: the flags (true = due, taken on the first ask), the mode, the screen */
  function scene(o: { persons: boolean; group: boolean; groupMode?: boolean }) {
    const due = { persons: o.persons, group: o.group };
    const state = { groupMode: o.groupMode ?? false, onCamera: true };
    const toasts: string[] = [];
    const pending: { run: () => void; ms: number }[] = [];
    const takeGroupMode = vi.fn(() => {
      const d = due.group;
      due.group = false;
      return d;
    });
    showGroupSceneHints({
      takePersons: () => {
        const d = due.persons;
        due.persons = false;
        return d;
      },
      takeGroupMode,
      skipGroupMode: () => state.groupMode || !state.onCamera,
      toast: (t) => toasts.push(t),
      later: (run, ms) => pending.push({ run, ms }),
    });
    return { state, toasts, pending, takeGroupMode, due };
  }

  it('≥ 2 faces shown with the mode off: the tap hint now, the 合照模式 hint HINT_GAP_MS later, its flag taken only then', () => {
    const s = scene({ persons: true, group: true });
    expect(s.toasts).toEqual(['點選畫面中的臉，可個別調整']);
    expect(s.pending.map((p) => p.ms)).toEqual([HINT_GAP_MS]);
    expect(s.takeGroupMode).not.toHaveBeenCalled();
    s.pending[0].run();
    expect(s.toasts).toEqual(['點選畫面中的臉，可個別調整', GROUP_MODE_HINT]);
    expect(s.due.group).toBe(false);
  });

  it('the 合照模式 hint at once when the tap hint was shown on an earlier visit', () => {
    const s = scene({ persons: false, group: true });
    expect(s.toasts).toEqual([GROUP_MODE_HINT]);
    expect(s.pending).toEqual([]);
  });

  it('a visit that closes the camera before the 合照模式 hint is due keeps its flag for a later visit', () => {
    const s = scene({ persons: true, group: true });
    s.state.onCamera = false;
    s.pending[0].run();
    expect(s.takeGroupMode).not.toHaveBeenCalled();
    expect(s.toasts).toEqual(['點選畫面中的臉，可個別調整']);
    // the camera's unmount cancels the timer instead: the flag is never asked for either way
    const t = scene({ persons: true, group: true });
    expect(t.takeGroupMode).not.toHaveBeenCalled();
    expect(t.due.group).toBe(true);
  });

  it('with the mode on (or turned on before the hint is due) the 合照模式 hint is never asked for (its flag is kept for later)', () => {
    const on = scene({ persons: true, group: true, groupMode: true });
    on.pending[0].run();
    expect(on.toasts).toEqual(['點選畫面中的臉，可個別調整']);
    expect(on.takeGroupMode).not.toHaveBeenCalled();
    const turned = scene({ persons: true, group: true });
    turned.state.groupMode = true;
    turned.pending[0].run();
    expect(turned.takeGroupMode).not.toHaveBeenCalled();
    expect(scene({ persons: false, group: true, groupMode: true }).toasts).toEqual([]);
  });

  it('both flags taken: nothing more, ever', () => {
    const s = scene({ persons: false, group: false });
    expect(s.toasts).toEqual([]);
    expect(s.takeGroupMode).toHaveBeenCalledTimes(1);
  });

  it('a camera start warms its first graph behind the spinner on the back camera, and on the front camera only with the mode on (its IMAGE graph); the solo selfie start is v0.5’s', () => {
    expect([warmsOnStart('environment', false), warmsOnStart('environment', true)]).toEqual([true, true]);
    expect([warmsOnStart('user', false), warmsOnStart('user', true)]).toEqual([false, true]);
  });

  it('round-1 review C18: the chip shows only where there is a group path to pick (not 基本模式, not MAX_LIVE_FACES = 1, PL2’s fallback)', () => {
    expect([groupModeAvailable(false), groupModeAvailable(true)]).toEqual([true, false]);
    expect([groupModeAvailable(false, 1), groupModeAvailable(false, 2)]).toEqual([false, true]);
    // with the fallback a remembered 合照模式 is no mode: the front camera starts as v0.5 (liveRoute's solo path)
    expect([warmsOnStart('user', true, 1), warmsOnStart('environment', true, 1)]).toEqual([false, true]);
  });
});
