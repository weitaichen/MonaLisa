// 合照模式 (camera per-person spec K22): the camera's toggle between the solo path (one VIDEO pass, off, the default)
// and the group path (§6.6, on), and its one-time toasts. Pure: the once-per-install flags are handed in
// (store/settings.ts takeGroupModeOnToast, takeGroupModeHint, takeCameraPersonsHint).
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

/**
 * A camera visit's first stats tick with ≥ 2 faces shown: the one-time toasts it asks for, in the order they show (the
 * camera shows the second after the first). The tap hint first; then, with the mode off, the 合照模式 hint (its flag is
 * not asked for while the mode is on, so it stays for a later visit that has the mode off)
 */
export function groupSceneHints(groupMode: boolean, take: { persons: () => boolean; groupMode: () => boolean }): string[] {
  const out: string[] = [];
  if (take.persons()) out.push(PERSONS_HINT);
  if (!groupMode && take.groupMode()) out.push(GROUP_MODE_HINT);
  return out;
}

/**
 * A camera start warms the graph its first detection runs, behind the 「正在開啟相機…」 spinner (§6.3): the back
 * camera always (the full-range compile); the front camera with 合照模式 on (its IMAGE graph, not the instance's first
 * VIDEO one). With the mode off the front camera starts as v0.5 did
 */
export const warmsOnStart = (facing: Facing, groupMode: boolean): boolean => facing === 'environment' || groupMode;
