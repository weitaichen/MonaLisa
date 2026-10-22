import { describe, expect, it } from 'vitest';
import { LIVE_IDLE_MAX_MS, MAX_LIVE_FACES } from '../config/limits';
import { naturalPerson, neutralPerson, personFromPreset } from '../edit/state';
import type { Rect } from '../types';
import { LivePersons } from './livePersons';

const ASPECT = 16 / 9;
/** a face box centred at (cx, 0.5), `w` wide (unmirrored video UV) */
const at = (cx: number, w = 0.1): Rect => ({ x: cx - w / 2, y: 0.35, w, h: 0.3 });
const natural = naturalPerson();
const refined = personFromPreset('refined', 1);
function session(): LivePersons {
  const s = new LivePersons();
  s.resume(0, 'user');
  return s;
}
/** a person seen at `cx`, edited, gone at `t` */
function away(s: LivePersons, cx: number, t: number, w = 0.1): number {
  const id = s.claim(at(cx, w), ASPECT, t);
  s.write([id], natural);
  s.release(id, at(cx, w), t);
  return id;
}

describe('LivePersons: claim and release (§7.4, K7)', () => {
  it('ids count up from 1; an unedited person who leaves is forgotten', () => {
    const s = session();
    expect(s.claim(at(0.3), ASPECT, 0)).toBe(1);
    expect(s.claim(at(0.6), ASPECT, 0)).toBe(2);
    s.release(1, at(0.3), 100);
    expect(s.claim(at(0.3), ASPECT, 200)).toBe(3);
    expect(s.params(3)).toBeNull();
  });
  it.each([
    ['3999 ms, 1.49 widths away, same size', 0.3 + 0.149, 0.1, 3999, true],
    ['4001 ms', 0.3, 0.1, 4001, false],
    ['1.51 widths away', 0.3 + 0.151, 0.1, 1000, false],
    ['×1.49 wider', 0.3, 0.149, 1000, true],
    ['×1.51 wider', 0.3, 0.151, 1000, false],
    ['×1.51 narrower', 0.3, 0.1 / 1.51, 1000, false],
  ])('re-identification gates: %s', (_, cx, w, t, same) => {
    const s = session();
    const id = away(s, 0.3, 0);
    const got = s.claim(at(cx, w), ASPECT, t);
    expect(got === id).toBe(same);
    expect(s.edited(got)).toBe(same);
  });
  it('two candidates about as near: 1.24 × the best → nobody (a new person at 原圖); 1.26 × → the nearer', () => {
    for (const [ratio, claimed] of [[1.24, false], [1.26, true]] as const) {
      const s = session();
      const a = away(s, 0.3, 0);
      away(s, 0.5, 0);
      const d = 0.2 / (1 + ratio); // a at d, the other at ratio × d
      const got = s.claim(at(0.3 + d), ASPECT, 1000);
      expect(got === a).toBe(claimed);
      expect(s.edited(got)).toBe(claimed);
    }
  });
  it(`the away pool holds MAX_LIVE_FACES persons, the oldest evicted`, () => {
    const s = session();
    const xs = Array.from({ length: MAX_LIVE_FACES + 1 }, (_, i) => 0.05 + i * 0.08);
    const ids = xs.map((x, i) => away(s, x, i * 10, 0.02));
    expect(s.claim(at(xs[0], 0.02), ASPECT, 500)).not.toBe(ids[0]);
    expect(s.claim(at(xs[1], 0.02), ASPECT, 500)).toBe(ids[1]);
  });
  it('a person written back to 原圖 (values neutral, preset custom) is never edited again (§3.3)', () => {
    const s = session();
    const id = s.claim(at(0.3), ASPECT, 0);
    s.write([id], natural);
    expect(s.edited(id)).toBe(true);
    s.write([id], { ...neutralPerson(), preset: 'custom' });
    expect([s.edited(id), s.params(id)]).toEqual([false, null]);
  });
});

describe('LivePersons: the session clock (§7.5, K8)', () => {
  it('pause / resume shifts the away pool by the paused span', () => {
    const s = session();
    const id = away(s, 0.3, 0);
    s.pause(500);
    s.resume(30_500, 'user');
    expect(s.claim(at(0.3), ASPECT, 30_500 + 3400)).toBe(id); // 500 + 3400 ms of live time ≤ 4000
  });
  it('more than LIVE_IDLE_MAX_MS without a live frame forgets everyone away and the remembered selection', () => {
    const s = session();
    const id = away(s, 0.3, 0);
    const p = s.claim(at(0.7), ASPECT, 0);
    s.pin(p);
    s.release(p, at(0.7), 0);
    s.pause(0);
    s.resume(LIVE_IDLE_MAX_MS + 1, 'user');
    expect(s.claim(at(0.3), ASPECT, LIVE_IDLE_MAX_MS + 2)).not.toBe(id);
    expect(s.claim(at(0.7), ASPECT, LIVE_IDLE_MAX_MS + 2)).not.toBe(p);
    expect(s.selection()).toBe('auto');
  });
  it('another facing ends the session; releases after clear() are dropped until the next resume', () => {
    const s = session();
    away(s, 0.3, 0);
    s.resume(10, 'environment');
    const a = s.claim(at(0.3), ASPECT, 20);
    expect(s.edited(a)).toBe(false);
    s.write([a], natural);
    s.clear();
    s.release(a, at(0.3), 30); // the old loop stopping after ✕ or a flip
    s.resume(40, 'environment');
    const b = s.claim(at(0.3), ASPECT, 50);
    expect([b, s.edited(b)]).toEqual([1, false]);
  });
});

describe('LivePersons: the grace waits while another path is in use (合照模式 toggled, K22, §3.13)', () => {
  /** an edited person last found by the `seenBy` path at `seen`, released at `seen` while the session is on `path` */
  function awayOn(s: LivePersons, seenBy: 'solo' | 'group', seen: number): number {
    const id = s.claim(at(0.3), ASPECT, seen);
    s.write([id], natural);
    s.release(id, at(0.3), seen, seenBy);
    return id;
  }
  it.each([
    ['3999 ms after the path returns', 3999, true],
    ['4001 ms after it', 4001, false],
  ])('a person the path in use cannot see (dropped after a toggle) comes back on their path: %s', (_, after, same) => {
    const s = session();
    s.setPath('group', 0);
    s.setPath('solo', 500); // 合照模式 turned off; the far face was last found by the group path at 500
    const id = awayOn(s, 'group', 500);
    s.setPath('group', 30_000); // turned on again 29.5 s later
    const got = s.claim(at(0.3), ASPECT, 30_000 + after);
    expect(got === id).toBe(same);
    expect(s.edited(got)).toBe(same);
  });
  it('a person who left on their path keeps the grace they had left across a toggle away and back', () => {
    for (const [after, same] of [[1999, true], [2001, false]] as const) {
      const s = session();
      s.setPath('group', 0);
      const id = awayOn(s, 'group', 1000); // left at 1000 with 合照模式 on
      s.setPath('solo', 3000); // 2000 ms of the grace spent
      s.setPath('group', 20_000);
      expect(s.claim(at(0.3), ASPECT, 20_000 + after) === id).toBe(same);
    }
  });
  it('the time on the other path counts only on their own path; a double toggle before they are found again spends none of it', () => {
    const s = session();
    s.setPath('group', 0);
    s.setPath('solo', 100);
    const id = awayOn(s, 'group', 100);
    s.setPath('group', 10_000);
    s.setPath('solo', 11_000); // 1000 ms on their path, not found (the tiles had not reached them)
    s.setPath('group', 40_000);
    expect(s.claim(at(0.3), ASPECT, 40_000 + 2900)).toBe(id); // 1000 + 2900 ≤ 4000
  });
  it('the path that cannot see them re-identifies them as usual: within REID_GRACE_MS of their last sighting', () => {
    for (const [t, same] of [[3999, true], [4001, false]] as const) {
      const s = session();
      s.setPath('group', 0);
      s.setPath('solo', 0);
      const id = awayOn(s, 'group', 0);
      expect(s.claim(at(0.3), ASPECT, t) === id).toBe(same);
    }
  });
  it('at most LIVE_IDLE_MAX_MS after their last sighting: a later return is a new person at 原圖', () => {
    const s = session();
    s.setPath('group', 0);
    s.setPath('solo', 0);
    const id = awayOn(s, 'group', 0);
    s.setPath('group', LIVE_IDLE_MAX_MS);
    const got = s.claim(at(0.3), ASPECT, LIVE_IDLE_MAX_MS + 1);
    expect([got === id, s.edited(got)]).toEqual([false, false]);
  });
  it('a pinned person the path in use cannot see is pinned again when their path finds them (returnTo)', () => {
    const s = session();
    s.setPath('group', 0);
    const id = s.claim(at(0.3), ASPECT, 0);
    s.pin(id);
    s.setPath('solo', 100);
    s.release(id, at(0.3), 100, 'group');
    expect(s.selection()).toBe('auto');
    s.setPath('group', 20_000);
    expect(s.claim(at(0.3), ASPECT, 21_000)).toBe(id);
    expect(s.selection()).toBe(id);
  });
  it('a pause stops the grace on their path as before (the paused span shifts it)', () => {
    const s = session();
    s.setPath('group', 0);
    const id = awayOn(s, 'group', 0);
    s.pause(500);
    s.resume(30_500, 'user');
    expect(s.claim(at(0.3), ASPECT, 30_500 + 3400)).toBe(id); // 500 + 3400 ms of live time ≤ 4000
  });
  it('a release without a path, or before the loop names one, runs the grace as before', () => {
    const s = session();
    const a = awayOn(s, 'group', 0); // no path named yet
    s.setPath('solo', 0);
    expect(s.claim(at(0.3), ASPECT, 4001)).not.toBe(a);
    const b = s.claim(at(0.6), ASPECT, 5000);
    s.write([b], natural);
    s.release(b, at(0.6), 5000);
    s.setPath('group', 6000);
    expect(s.claim(at(0.6), ASPECT, 9001)).not.toBe(b);
  });
  it('clear() forgets the path', () => {
    const s = session();
    s.setPath('solo', 0);
    s.clear();
    s.resume(10, 'user');
    const a = awayOn(s, 'group', 10); // the next loop has not named its path yet: the grace runs
    s.setPath('group', 20_000);
    expect(s.claim(at(0.3), ASPECT, 21_000)).not.toBe(a);
  });
});

describe('LivePersons: selection (§7.6, K9) and 全部套用 (§3.4, K10)', () => {
  const three = () => {
    const s = session();
    for (const x of [0.2, 0.5, 0.8]) s.claim(at(x), ASPECT, 0);
    s.sync([1, 2, 3], 1);
    return s;
  };
  it('the auto target until the first edit pins it', () => {
    const s = three();
    expect([s.selection(), s.target()]).toEqual(['auto', 1]);
    s.edit(natural);
    expect([s.selection(), s.params(1)]).toEqual([1, natural]);
    s.sync([1, 2, 3], 2);
    expect(s.target()).toBe(1);
  });
  it('a pinned person who leaves hands the target to auto and gets it back when re-identified (returnTo)', () => {
    const s = three();
    s.pin(2);
    s.release(2, at(0.5), 100);
    s.sync([1, 3], 1);
    expect([s.selection(), s.target()]).toEqual(['auto', 1]);
    expect(s.claim(at(0.5), ASPECT, 1500)).toBe(2);
    s.sync([1, 2, 3], 1);
    expect([s.selection(), s.target()]).toEqual([2, 2]);
  });
  it.each(['a tap', 'an edit', 'the pool clearing'] as const)('%s cancels the return', (how) => {
    const s = three();
    s.pin(2);
    s.release(2, at(0.5), 100);
    s.sync([1, 3], 1);
    let t = 1500;
    if (how === 'a tap') s.pin(3);
    if (how === 'an edit') s.edit(natural); // pins the auto target, 1
    if (how === 'the pool clearing') {
      s.pause(100);
      s.resume((t = 100 + LIVE_IDLE_MAX_MS + 1), 'user');
    }
    const back = s.claim(at(0.5), ASPECT, t + 1);
    s.sync([1, back, 3], 1);
    expect(s.target()).not.toBe(back);
  });
  it("全部套用: on copies the target's params to everyone in view, a face entering gets them, edits write all, off reverts nobody", () => {
    const s = three();
    s.edit(natural); // pins 1
    s.setAll(true);
    expect([s.params(2), s.params(3)]).toEqual([natural, natural]);
    const d = s.claim(at(0.95, 0.04), ASPECT, 10);
    s.sync([1, 2, 3, d], 1);
    expect(s.params(d)).toEqual(natural);
    s.edit(refined);
    expect([1, 2, 3, d].map((i) => s.params(i))).toEqual([refined, refined, refined, refined]);
    s.setAll(false);
    expect([1, 2, 3, d].map((i) => s.params(i))).toEqual([refined, refined, refined, refined]);
    s.edit(natural);
    expect([1, 2, 3, d].map((i) => s.params(i))).toEqual([natural, refined, refined, refined]);
  });
  it('全部套用 on with an untouched target copies 原圖 to everyone in view', () => {
    const s = three();
    s.write([2], natural);
    s.setAll(true);
    expect([1, 2, 3].map((i) => s.edited(i))).toEqual([false, false, false]);
  });
  it('editTargets: 全部套用 → everyone in view; else the target; [] with no face shown', () => {
    const s = three();
    expect(s.editTargets()).toEqual([1]);
    s.setAll(true);
    expect(s.editTargets()).toEqual([1, 2, 3]);
    s.setAll(false);
    s.sync([], null);
    expect(s.editTargets()).toEqual([]);
  });
  it('panelParams: the shared params under 全部套用, else the lead (or the target), 原圖 when untouched', () => {
    const s = three();
    s.write([2], natural);
    expect(s.panelParams()).toEqual(neutralPerson());
    expect(s.panelParams(2)).toEqual(natural);
    s.pin(2);
    s.setAll(true);
    s.edit(refined);
    expect(s.panelParams(1)).toEqual(refined);
  });
  it('clear() forgets everyone, the selection, 全部套用 and the ambient person; ids start again at 1', () => {
    const s = three();
    s.edit(natural);
    s.setAll(true);
    s.setAmbient(natural);
    s.clear();
    s.resume(0, 'user');
    expect([s.all(), s.selection(), s.target(), s.ambient]).toEqual([false, 'auto', null, neutralPerson()]);
    expect(s.claim(at(0.2), ASPECT, 0)).toBe(1);
  });
  it('version moves on every change and not on a sync that changes nothing', () => {
    const s = three();
    const v = s.version;
    s.sync([1, 2, 3], 1);
    expect(s.version).toBe(v);
    s.sync([1, 2, 3], 2);
    expect(s.version).toBeGreaterThan(v);
    const w = s.version;
    s.edit(natural);
    expect(s.version).toBeGreaterThan(w);
  });
});
