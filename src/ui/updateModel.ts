// 有新版本 prompt — the pure part: state transitions, where (and whether) the banner shows, its text, and
// when to ask the browser to look for a new service worker. No DOM here (unit-tested in node); the wiring to
// registerSW / navigator.serviceWorker lives in update.ts.
import { displayVersion, isVersion } from '../version';
import type { Screen, Sheet } from './state';

export type UpdatePhase =
  /** nothing waiting */
  | 'idle'
  /** a new service worker is installed and waiting for the user's 更新 */
  | 'available'
  /** 更新 tapped: flushing writes, then the waiting worker takes over and the page reloads */
  | 'applying';

export interface UpdateState {
  phase: UpdatePhase;
  /** the waiting version from /version.json; null = unknown (offline, old deploy, same as the running one) */
  next: string | null;
  /** 稍後 tapped: hidden for the rest of this app session (a new launch starts with a fresh state) */
  dismissed: boolean;
}

export const initialUpdate = (): UpdateState => ({ phase: 'idle', next: null, dismissed: false });

/** registerSW's onNeedRefresh (may fire more than once for one worker: 'installed' and 'waiting'). */
export function needRefresh(s: UpdateState): UpdateState {
  return s.phase === 'idle' ? { ...s, phase: 'available' } : s;
}

/** /version.json answered (or failed: v = null). A version equal to the running one says nothing new. */
export function gotVersion(s: UpdateState, v: unknown, current: string): UpdateState {
  const next = isVersion(v) && v !== current ? v : null;
  return next === s.next ? s : { ...s, next };
}

/** 稍後 */
export function dismiss(s: UpdateState): UpdateState {
  return s.phase === 'available' && !s.dismissed ? { ...s, dismissed: true } : s;
}

/** 更新 (ignored unless an update is offered; a second tap while applying is a no-op) */
export function startApply(s: UpdateState): UpdateState {
  return s.phase === 'available' && !s.dismissed ? { ...s, phase: 'applying' } : s;
}

export type BannerPlace = 'home' | 'settings' | null;

/**
 * Where the banner is shown right now. Only on 首頁 and in 設定 (which opens over 首頁): never in the camera,
 * the review or the editor, so an update can not interrupt a capture or an edit; one found there waits until
 * the user is back on 首頁. The 關於與授權 page shows none (its own scroller, and nothing to act on there).
 */
export function bannerPlace(s: UpdateState, screen: Screen['name'], sheet: Sheet): BannerPlace {
  if (s.phase === 'idle' || s.dismissed) return null;
  if (screen !== 'home') return null;
  if (sheet === null) return 'home';
  return sheet === 'settings' ? 'settings' : null;
}

export function bannerTitle(s: UpdateState): string {
  if (s.phase === 'applying') return '正在更新…';
  return s.next ? `有新版本 ${displayVersion(s.next)}` : '有新版本';
}

/** how often an open app asks for a new version, and the least time between two checks */
export const CHECK_EVERY_MS = 30 * 60_000;
export const CHECK_GAP_MS = 60_000;

/**
 * Whether to call registration.update() now: online, nothing already installing, and not within
 * CHECK_GAP_MS of the previous check (returning to the app repeatedly must not hammer sw.js).
 */
export function shouldCheck(now: number, last: number | null, online: boolean, installing: boolean): boolean {
  if (!online || installing) return false;
  return last === null || now - last >= CHECK_GAP_MS;
}

/** a > b → positive, a < b → negative, equal → 0 (both x.y.z) */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/**
 * The one-time 已更新至 … toast on the first launch of a new version. `seen` is the version that last ran here
 * (as stored; undefined when never recorded). Versions before 0.2 did not record one, so an unrecorded version
 * is an update only for a `returning` user (an earlier session's service worker controls this page, or it left
 * settings behind); a fresh install says nothing, and neither does a rollback to an older version.
 */
export function updatedNotice(seen: unknown, current: string, returning: boolean): string | null {
  if (!isVersion(current)) return null;
  const updated = isVersion(seen) ? compareVersions(current, seen) > 0 : returning;
  return updated ? `已更新至 ${displayVersion(current)}` : null;
}
