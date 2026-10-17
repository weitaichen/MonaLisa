// 推臉筆 bar (push-brush spec §2.2): replaces the slider row while the brush is the selected strip item.
// 推／恢復 and the size are remembered by the editor for the app session; neither is an undo step.
import { useEffect, useState } from 'preact/hooks';
import type { BrushKind, BrushSize } from '../../types';
// 全部清除 → 確定清除？ stays armed this long: step 4's constant, shared with the 祛痘 clear (the 重置 pattern in Editor.tsx)
import { CLEAR_CONFIRM_MS } from '../panelModel';
import { haptic } from '../platform';
import { Segmented } from './Controls';

export const BRUSH_KINDS: readonly { value: BrushKind; label: string }[] = [
  { value: 'push', label: '推' },
  { value: 'restore', label: '恢復' },
];
export const BRUSH_SIZES: readonly { value: BrushSize; label: string }[] = [
  { value: 's', label: '小' },
  { value: 'm', label: '中' },
  { value: 'l', label: '大' },
];

interface Props {
  kind: BrushKind;
  size: BrushSize;
  /** stroke records of the photo (全部清除 is disabled at 0) */
  strokes: number;
  /** a stroke is being drawn */
  busy: boolean;
  onKind(k: BrushKind): void;
  onSize(s: BrushSize): void;
  /** the second tap: one undo step */
  onClear(): void;
}

export function BrushBar({ kind, size, strokes, busy, onKind, onSize, onClear }: Props) {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const t = window.setTimeout(() => setConfirm(false), CLEAR_CONFIRM_MS);
    return () => clearTimeout(t);
  }, [confirm]);
  useEffect(() => {
    if (strokes === 0) setConfirm(false);
  }, [strokes]);
  const tapClear = () => {
    haptic();
    if (!confirm) {
      setConfirm(true);
      return;
    }
    setConfirm(false);
    onClear();
  };
  return (
    <div class="slider-row brush-bar" role="group" aria-label="推臉筆">
      <Segmented label="筆刷模式" value={kind} options={BRUSH_KINDS} onChange={onKind} />
      <Segmented label="筆刷大小" value={size} options={BRUSH_SIZES} onChange={onSize} />
      <button type="button" class={`brush-clear${confirm ? ' confirm' : ''}`} disabled={strokes === 0 || busy} onClick={tapClear}>
        {confirm ? '確定清除？' : '全部清除'}
      </button>
    </div>
  );
}
