import { describe, expect, it } from 'vitest';
import { BRUSH_PX } from '../config/limits';
import { BRUSH_KINDS, BRUSH_SIZES } from './components/BrushBar';
import { BRUSH_HINT_MS, hintText } from './components/BrushHint';
import { ringLook } from './components/BrushOverlay';
import { hasIcon } from './icons';
import { CLEAR_CONFIRM_MS } from './panelModel';

describe('brush UI (push-brush spec §2.2–§2.4)', () => {
  it('segments and copy', () => {
    expect(BRUSH_KINDS.map((o) => o.label)).toEqual(['推', '恢復']);
    expect(BRUSH_SIZES.map((o) => o.label)).toEqual(['小', '中', '大']);
    expect(BRUSH_SIZES.map((o) => BRUSH_PX[o.value])).toEqual([16, 28, 44]);
    expect(hintText('push')).toBe('單指推動，雙指縮放');
    expect(hintText('restore')).toBe('單指塗抹恢復，雙指縮放');
    expect(CLEAR_CONFIRM_MS).toBe(3000);
    expect(BRUSH_HINT_MS).toBe(2800); // 2.5 s shown + 300 ms fade
  });

  it('the ring: 推 accent, 恢復 dashed white, dim while the brush resists or a cap is hit', () => {
    expect(ringLook('push', 'ok')).toBe('push');
    expect(ringLook('restore', 'ok')).toBe('restore');
    expect(ringLook('push', 'resisting')).toBe('dim');
    expect(ringLook('restore', 'capped')).toBe('dim');
  });

  it('has its own brush icon', () => {
    expect(hasIcon('brush')).toBe(true);
  });
});
