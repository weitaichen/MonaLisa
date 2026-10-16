// 左右分開 (face-detail spec §3.4). Split values are stored landmark-sided: PersonParams.values drives the GPUPixel-left
// half of a split item (pts111 0–15, 52–57, 72–74: MediaPipe's RIGHT_*), PersonParams.right the GPUPixel-right half;
// the midline p16 takes the mean. Labels are screen-sided: 左 is the half whose eye shows on the left of the screen.
import { SPLIT_IDS } from '../engine/params';
import type { CameraLook, Face, Facing, PersonParams, SplitParamId } from '../types';

/** an on-screen side */
export type Side = 'L' | 'R';
/** a stored half: 'values' = GPUPixel-left, 'right' = GPUPixel-right */
export type Slot = 'values' | 'right';

export function isSplitId(id: string): id is SplitParamId {
  return (SPLIT_IDS as readonly string[]).includes(id);
}

/** the stored half an on-screen side edits; `screenSwap` = the GPUPixel-left half shows on the screen's right */
export function slotFor(screenSwap: boolean, side: Side): Slot {
  return (side === 'L') === !screenSwap ? 'values' : 'right';
}

export function readSide(p: PersonParams, id: SplitParamId, slot: Slot): number {
  if (slot === 'values' || p.right === null) return p.values[id];
  return p.right[id] ?? p.values[id];
}

/** While `right` is null both halves are `values`: a side write never creates `right` (S5 §3.4). */
export function writeSide(p: PersonParams, id: SplitParamId, v: number, slot: Slot): PersonParams {
  if (slot === 'values' || p.right === null) return { ...p, values: { ...p.values, [id]: v } };
  return { ...p, right: { ...p.right, [id]: v } };
}

/** 左右分開 on: `right` copies the six values, so nothing moves (S5 §2.2). */
export function splitOn(p: PersonParams): PersonParams {
  if (p.right !== null) return p;
  const right: Partial<Record<SplitParamId, number>> = {};
  for (const id of SPLIT_IDS) right[id] = p.values[id];
  return { ...p, right };
}

/** 左右分開 off: both halves take the value of `slot` (the side the slider was showing); right = null. */
export function splitOff(p: PersonParams, slot: Slot): PersonParams {
  if (p.right === null) return p;
  const values = { ...p.values };
  for (const id of SPLIT_IDS) values[id] = readSide(p, id, slot);
  return { ...p, values, right: null };
}

/**
 * A mirrored image puts each cheek on the other GPUPixel half (adapter111.ts:3-4), so a shot saved mirrored hands its
 * split values over swapped (S5 §3.4). Swaps exactly the six split ids; an involution on a complete `right`.
 */
export function mirrorSides(p: PersonParams): PersonParams {
  if (p.right === null) return p;
  const values = { ...p.values };
  const right: Partial<Record<SplitParamId, number>> = {};
  for (const id of SPLIT_IDS) {
    right[id] = p.values[id];
    values[id] = p.right[id] ?? p.values[id];
  }
  return { ...p, values, right };
}

/** untrusted `right`: only split ids with finite numbers, clamped to 0..1; nothing left → null (S5 §3.5) */
export function sanitizeRight(raw: unknown): PersonParams['right'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Partial<Record<SplitParamId, number>> = {};
  let n = 0;
  for (const id of SPLIT_IDS) {
    const v = (raw as Record<string, unknown>)[id];
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[id] = Math.min(1, Math.max(0, v));
      n++;
    }
  }
  return n > 0 ? out : null;
}

/** true when the GPUPixel-left eye (p74) shows left of the GPUPixel-right eye (p77) after `toScreen` (S5 §3.4) */
export function screenLeftIsGpLeft(face: Face, toScreen: (p: [number, number]) => [number, number]): boolean {
  const P = face.pts111;
  return toScreen([P[74 * 2], P[74 * 2 + 1]])[0] < toScreen([P[77 * 2], P[77 * 2 + 1]])[0];
}

/** Shot → 編輯 (S5 §3.4): a shot saved mirrored puts each cheek on the other GPUPixel half; swap the split values. */
export function handOverLook(look: CameraLook, mirrored: boolean): CameraLook {
  if (!mirrored) return look;
  const person = mirrorSides(look.person);
  return person === look.person ? look : { ...look, person };
}

/** how far (× the eye distance) the eyes must cross before the camera's 左／右 swap: a face held sideways never flickers */
const SIDE_HYSTERESIS = 0.2;

/**
 * The camera's tracked face on the unmirrored frame: its GPUPixel-left eye (p74) shows left of its right eye (p77),
 * screenLeftIsGpLeft with the identity. `prev` (the last answer) holds until the eyes cross by more than SIDE_HYSTERESIS ×
 * their distance, so a face rolled near ±90° keeps its labels; without one the sign decides (a tie reads as upright).
 * A degenerate face (both eyes on one point) keeps `prev`, else reads as upright.
 */
export function gpLeftOnLeft(face: Face, prev: boolean | null): boolean {
  const P = face.pts111;
  const dx = P[77 * 2] - P[74 * 2];
  const dy = P[77 * 2 + 1] - P[74 * 2 + 1];
  const d = Math.hypot(dx, dy);
  if (!(d > 0)) return prev ?? true;
  const m = prev === null ? 0 : SIDE_HYSTERESIS * d;
  return (prev ?? true) ? dx >= -m : dx > m;
}

/**
 * The camera's 左／右 mapping (S5 §3.4): !screenLeftIsGpLeft through the preview, whose toScreen is x → 1 − x for the
 * mirrored front camera (live.ts:160) and the identity for the back one. `unmirrored`: gpLeftOnLeft of the tracked face
 * (LiveStats.gpLeftOnLeft); null (no face yet) assumes an upright face, whose GPUPixel-left half (the subject's right) is
 * on the frame's left, so the front camera swaps and the back one does not.
 */
export function cameraScreenSwap(facing: Facing, unmirrored: boolean | null = null): boolean {
  const left = unmirrored ?? true;
  return !(facing === 'user' ? !left : left);
}
