// 祛痘 mode controls (skin-cleanup spec §2.3): 大小 小｜中｜大 and the 清除 button, in the slider row's place and height.
import type { SpotSize } from '../../types';
import { TONE_COPY } from '../../edit/toneCopy';
import { Segmented } from './Controls';

const SIZES: readonly { value: SpotSize; label: string }[] = [
  { value: 'S', label: '小' },
  { value: 'M', label: '中' },
  { value: 'L', label: '大' },
];

export function SpotControls({
  size,
  onSize,
  label,
  disabled,
  confirming,
  onClear,
}: {
  size: SpotSize;
  onSize(s: SpotSize): void;
  label: string;
  disabled: boolean;
  confirming: boolean;
  onClear(): void;
}) {
  return (
    <div class="slider-row spot-controls">
      <span class="slider-label">{TONE_COPY.spotSize}</span>
      <Segmented value={size} options={SIZES} onChange={onSize} label={TONE_COPY.spotSize} />
      <button type="button" class={`spot-clear${confirming ? ' confirm' : ''}`} disabled={disabled} onClick={onClear}>
        {label}
      </button>
    </div>
  );
}
