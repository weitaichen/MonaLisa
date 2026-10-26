// 合照模式 (camera per-person spec K22): the camera's toggle between the solo path (one VIDEO pass, off, the default)
// and the group path (§6.6, on), and its one-time toasts. Pure: the once-per-install flags are handed in
// (store/settings.ts takeGroupModeOnToast, takeGroupModeHint, takeCameraPersonsHint).
import { MAX_LIVE_FACES } from '../config/limits';
import type { Facing } from '../types';

export const GROUP_MODE_LABEL = '合照模式';
/** the first time the mode is turned on (once per install) */
export const GROUP_MODE_ON_TOAST = '遠處的人也能點選，人多時預覽可能較不順';
/** ≥ 2 faces shown while the mode is off (once per install, never once the mode was turned on) */
export const GROUP_MODE_HINT = '開啟合照模式，遠處的人也能點選';
/** the first time ≥ 2 faces are shown (§3.1, K12) */
const PERSONS_HINT = '點選畫面中的臉，可個別調整';

/** the toggle tapped while `on`: the new mode, and the toast to show (turning it on, the first time only) */
export function toggleGroupMode(on: boolean, takeOnToast: () => boolean): { groupMode: boolean; toast: string | null } {
  const groupMode = !on;
  return { groupMode, toast: groupMode && takeOnToast() ? GROUP_MODE_ON_TOAST : null };
}

/** the 合照模式 hint follows the tap hint by this long (the tap hint's 3200 ms toast and a beat) */
export const HINT_GAP_MS = 3400;

/**
 * A camera visit's first stats tick with ≥ 2 faces shown: its one-time toasts. The tap hint now (its flag taken); then
 * the 合照模式 hint, HINT_GAP_MS later when the tap hint showed, else at once. The 合照模式 hint's flag is asked for only
 * when that hint is due and may show (`skipGroupMode` false: the mode off, the camera still open), so a visit that ends
 * first (the camera cancels `later`'s timer on unmount) or has the mode on keeps it for a later visit
 */
export function showGroupSceneHints(io: {
  takePersons: () => boolean;
  takeGroupMode: () => boolean;
  /** read when the 合照模式 hint is due: true while the mode is on or the camera screen has closed */
  skipGroupMode: () => boolean;
  toast: (text: string) => void;
  later: (run: () => void, ms: number) => void;
}): void {
  const groupHint = () => {
    if (!io.skipGroupMode() && io.takeGroupMode()) io.toast(GROUP_MODE_HINT);
  };
  if (io.takePersons()) {
    io.toast(PERSONS_HINT);
    io.later(groupHint, HINT_GAP_MS);
  } else groupHint();
}

/**
 * The 「合照模式」 chip shows (§3.13): only where there is a group path to pick, so neither in 基本模式 (no tracker) nor
 * with `MAX_LIVE_FACES = 1`, PL2's fallback (§10: the v0.3 camera), where liveRoute runs the solo path whatever the mode
 * says (round-1 review C18: the chip stayed, toggled, saved and toasted, and nothing changed)
 */
export const groupModeAvailable = (basic: boolean, maxLiveFaces: number = MAX_LIVE_FACES): boolean => !basic && maxLiveFaces > 1;

/**
 * A camera start warms the graph its first detection runs, behind the 「正在開啟相機…」 spinner (§6.3): the back
 * camera always (the full-range compile); the front camera with 合照模式 on (its IMAGE graph, not the instance's first
 * VIDEO one). With the mode off, or no group path (`MAX_LIVE_FACES = 1`), the front camera starts as v0.5 did
 */
export const warmsOnStart = (facing: Facing, groupMode: boolean, maxLiveFaces: number = MAX_LIVE_FACES): boolean =>
  facing === 'environment' || (groupMode && maxLiveFaces > 1);
