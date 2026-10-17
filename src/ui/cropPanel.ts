// The 裁切 strip and the 拉直 slider (S §2.1): pure, like panelModel. Ratio taps, 旋轉, 翻轉 and 還原 return a new
// EditState (one undo step each); the highlighted ratio lock is UI state.
import { editFlipView, editResetGeometry, editRotateLeft, editSetGeometry } from '../edit/state';
import { applyRatio, isIdentity, lockAspect, setStraighten, transposeLock, type CropLock } from '../geometry/view';
import type { EditState, Geometry, Size } from '../types';
import type { PanelItem, SliderScale, SliderView } from './panelModel';

export type CropAction = { type: 'ratio'; lock: CropLock } | { type: 'rotate' } | { type: 'flip' } | { type: 'geoReset' };

export const RATIO_ITEMS: readonly { lock: CropLock; label: string }[] = [
  { lock: 'free', label: '自由' },
  { lock: 'original', label: '原比例' },
  { lock: '1:1', label: '1:1' },
  { lock: '3:4', label: '3:4' },
  { lock: '4:3', label: '4:3' },
  { lock: '9:16', label: '9:16' },
  { lock: '16:9', label: '16:9' },
];

export const ROTATE_BAND_TOAST = '旋轉後已移除增高';

const item = (key: string, label: string, visual: PanelItem['visual'], crop: CropAction, extra: Partial<PanelItem> = {}): PanelItem => ({
  key,
  label,
  visual,
  selected: false,
  hasValue: false,
  action: { type: 'crop', crop },
  disabled: false,
  reason: null,
  ...extra,
});

/** 自由 · 原比例 · 1:1 · 3:4 · 4:3 · 9:16 · 16:9 │ 旋轉 · 翻轉 · 還原 (還原 dimmed at identity) */
export function cropItems(g: Geometry, lock: CropLock, oSize: Size): PanelItem[] {
  const identity = isIdentity(g);
  return [
    ...RATIO_ITEMS.map((r) =>
      item(`ratio.${r.lock}`, r.label, { kind: 'ratio', aspect: lockAspect(r.lock, g, oSize) }, { type: 'ratio', lock: r.lock }, { selected: lock === r.lock }),
    ),
    item('rotate', '旋轉', { kind: 'icon', icon: 'rotateLeft' }, { type: 'rotate' }, { divider: 'before' }),
    item('flip', '翻轉', { kind: 'icon', icon: 'flipH' }, { type: 'flip' }),
    item('geoReset', '還原', { kind: 'icon', icon: 'reset' }, { type: 'geoReset' }, { disabled: identity }),
  ];
}

export interface CropResult {
  edit: EditState;
  lock: CropLock;
  /** an undo step to record */
  changed: boolean;
  toast: string | null;
}

export function cropActivate(edit: EditState, a: CropAction, lock: CropLock, oSize: Size): CropResult {
  const g = edit.photo.geometry;
  switch (a.type) {
    case 'ratio': {
      // 自由 unlocks the aspect and leaves the crop as it is
      if (a.lock === 'free') return { edit, lock: 'free', changed: false, toast: null };
      const next = applyRatio(g, a.lock, oSize);
      return { edit: editSetGeometry(edit, next), lock: a.lock, changed: next !== g, toast: null };
    }
    case 'rotate':
      return { edit: editRotateLeft(edit), lock: transposeLock(lock), changed: true, toast: edit.photo.heightBand ? ROTATE_BAND_TOAST : null };
    case 'flip':
      return { edit: editFlipView(edit), lock, changed: true, toast: null };
    case 'geoReset': {
      if (isIdentity(g)) return { edit, lock, changed: false, toast: null };
      // turning a 旋轉 back removes the 增高 band like 旋轉 itself (editResetGeometry), with its toast
      const next = editResetGeometry(edit);
      const removed = edit.photo.heightBand !== null && next.photo.heightBand === null;
      return { edit: next, lock: 'free', changed: true, toast: removed ? ROTATE_BAND_TOAST : null };
    }
  }
}

export const STRAIGHTEN_SCALE: SliderScale = { min: -45, max: 45, step: 0.1, snap: 0.5, suffix: '°' };

/** 拉直: bidirectional, 0.5 = 0°, double tap → 0° */
export function straightenView(g: Geometry): SliderView {
  return { key: 'crop.straighten', label: '拉直', bidirectional: true, value: (g.straighten + 45) / 90, defaultValue: 0.5, scale: STRAIGHTEN_SCALE };
}

/** one 拉直 drag: every step from the geometry at the gesture's start (setStraighten), so returning restores it */
export class StraightenGesture {
  private start: Geometry | null = null;

  step(current: Geometry, v: number, oSize: Size, commit: boolean): Geometry {
    const start = this.start ?? current;
    this.start = commit ? null : start;
    return setStraighten(start, -45 + 90 * v, oSize);
  }

  /** the 裁切 tab closed, or the gesture was abandoned */
  reset(): void {
    this.start = null;
  }
}
