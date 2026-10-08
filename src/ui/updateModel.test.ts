import { describe, expect, it } from 'vitest';
import {
  bannerPlace,
  bannerTitle,
  CHECK_EVERY_MS,
  compareVersions,
  CHECK_GAP_MS,
  dismiss,
  gotVersion,
  initialUpdate,
  needRefresh,
  shouldCheck,
  startApply,
  updatedNotice,
  type UpdateState,
} from './updateModel';

const available = (patch: Partial<UpdateState> = {}): UpdateState => ({ ...needRefresh(initialUpdate()), ...patch });

describe('update state', () => {
  it('starts idle and shows nothing', () => {
    const s = initialUpdate();
    expect(s).toEqual({ phase: 'idle', next: null, dismissed: false });
    expect(bannerPlace(s, 'home', null)).toBeNull();
  });

  it('onNeedRefresh offers the update, idempotently', () => {
    const s = needRefresh(initialUpdate());
    expect(s.phase).toBe('available');
    expect(needRefresh(s)).toBe(s); // 'installed' + 'waiting' both report the same worker
  });

  it('a waiting worker found while applying does not undo the apply', () => {
    const applying = startApply(available());
    expect(needRefresh(applying)).toBe(applying);
  });

  it('records the deployed version, unless it is unknown or the running one', () => {
    const s = available();
    expect(gotVersion(s, '0.2.1', '0.2.0').next).toBe('0.2.1');
    expect(gotVersion(s, '0.2.0', '0.2.0').next).toBeNull();
    expect(gotVersion(s, null, '0.2.0').next).toBeNull();
    expect(gotVersion(s, 'garbage', '0.2.0').next).toBeNull();
    expect(gotVersion(s, null, '0.2.0')).toBe(s); // no change → same object (no re-render)
  });

  it('稍後 hides it for the session; a second onNeedRefresh does not bring it back', () => {
    const d = dismiss(available({ next: '0.2.1' }));
    expect(d.dismissed).toBe(true);
    expect(bannerPlace(d, 'home', null)).toBeNull();
    expect(bannerPlace(needRefresh(d), 'home', null)).toBeNull();
    expect(bannerPlace(gotVersion(d, '0.2.2', '0.2.0'), 'home', null)).toBeNull();
  });

  it('稍後 / 更新 do nothing when nothing is offered', () => {
    const idle = initialUpdate();
    expect(dismiss(idle)).toBe(idle);
    expect(startApply(idle)).toBe(idle);
    const d = dismiss(available());
    expect(startApply(d)).toBe(d);
  });

  it('更新 moves to applying once; the banner stays (buttons disabled) until the reload', () => {
    const a = startApply(available({ next: '0.2.1' }));
    expect(a.phase).toBe('applying');
    expect(startApply(a)).toBe(a);
    expect(dismiss(a)).toBe(a);
    expect(bannerPlace(a, 'home', null)).toBe('home');
    expect(bannerTitle(a)).toBe('正在更新…');
  });
});

describe('banner placement', () => {
  const s = available();

  it('shows on 首頁 and in 設定 only', () => {
    expect(bannerPlace(s, 'home', null)).toBe('home');
    expect(bannerPlace(s, 'home', 'settings')).toBe('settings');
    expect(bannerPlace(s, 'home', 'credits')).toBeNull();
  });

  it('never during a capture, the review or an edit', () => {
    for (const screen of ['camera', 'review', 'editor'] as const) {
      expect(bannerPlace(s, screen, null), screen).toBeNull();
      expect(bannerPlace(s, screen, 'settings'), screen).toBeNull();
    }
  });

  it('an update found in the editor shows once back on 首頁', () => {
    // detected while editing: the state is 'available', the place is null…
    expect(bannerPlace(s, 'editor', null)).toBeNull();
    // …and the same state shows on 首頁
    expect(bannerPlace(s, 'home', null)).toBe('home');
  });
});

describe('banner text', () => {
  it('names the new version when known', () => {
    expect(bannerTitle(available({ next: '0.2.1' }))).toBe('有新版本 v0.2.1');
    expect(bannerTitle(available({ next: '0.3.0' }))).toBe('有新版本 v0.3');
    expect(bannerTitle(available())).toBe('有新版本');
  });
});

describe('update checks', () => {
  it('checks when online, nothing installing, and the last check is old enough', () => {
    expect(shouldCheck(1_000, null, true, false)).toBe(true);
    expect(shouldCheck(1_000 + CHECK_GAP_MS, 1_000, true, false)).toBe(true);
    expect(shouldCheck(1_000 + CHECK_GAP_MS - 1, 1_000, true, false)).toBe(false);
    expect(shouldCheck(1_000 + CHECK_EVERY_MS, 1_000, true, false)).toBe(true);
  });

  it('never when offline or while a worker is installing', () => {
    expect(shouldCheck(1e9, null, false, false)).toBe(false);
    expect(shouldCheck(1e9, null, true, true)).toBe(false);
  });
});

describe('已更新至 notice (first launch of a new version)', () => {
  it('compares x.y.z numerically', () => {
    expect(compareVersions('0.2.0', '0.1.0')).toBeGreaterThan(0);
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('0.2.0', '0.2.1')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('after an update recorded by the previous version', () => {
    expect(updatedNotice('0.2.0', '0.2.1', false)).toBe('已更新至 v0.2.1');
    expect(updatedNotice('0.2.1', '0.3.0', true)).toBe('已更新至 v0.3');
  });

  it('from 0.1 (no version recorded) to 0.2: only a returning user gets it', () => {
    expect(updatedNotice(undefined, '0.2.0', true)).toBe('已更新至 v0.2');
    expect(updatedNotice(undefined, '0.2.0', false)).toBeNull(); // fresh install
    expect(updatedNotice('garbage', '0.2.0', true)).toBe('已更新至 v0.2');
    expect(updatedNotice({ v: 1 }, '0.2.0', false)).toBeNull();
  });

  it('nothing for the same version or a rollback', () => {
    expect(updatedNotice('0.2.0', '0.2.0', true)).toBeNull();
    expect(updatedNotice('0.3.0', '0.2.0', true)).toBeNull();
  });
});
