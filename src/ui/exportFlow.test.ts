import { describe, expect, it } from 'vitest';
import type { ExportPlan } from '../media/exportPlan';
import { exportOutcome, noSourceNote, pillLabel, planSig, preEncodes, shareNow, shareReady, tapAction } from './exportFlow';

const plan = (over: Partial<ExportPlan> = {}): ExportPlan => ({
  mode: 'working',
  format: 'jpeg',
  quality: 0.95,
  width: 1536,
  height: 2048,
  decode: null,
  fullShortEdge: 1536,
  tile: 0,
  tiles: [],
  fallback: 'notLarger',
  ...over,
});
const file = new File(['x'], 'meiyan-20261012-000000.jpg', { type: 'image/jpeg' });

describe('export flow rules (S §2.3)', () => {
  it('the share cache matches the edit, the field and the output settings (Review Focus 1)', () => {
    const sig = planSig(plan());
    const cache = { key: 'k', field: 3, sig, file };
    expect(shareReady(cache, 'k', 3, sig)).toBe(true);
    expect(shareReady(cache, 'k', 3, planSig(plan({ format: 'png', quality: 1 })))).toBe(false);
    expect(shareReady(cache, 'k', 3, planSig(plan({ mode: 'tiled', width: 3000, height: 4000 })))).toBe(false);
    expect(shareReady(cache, 'k2', 3, sig)).toBe(false);
    expect(shareReady(null, 'k', 3, sig)).toBe(false);
  });

  it('only a working-size JPEG is pre-encoded', () => {
    expect(preEncodes(plan())).toBe(true);
    expect(preEncodes(plan({ format: 'png' }))).toBe(false);
    expect(preEncodes(plan({ mode: 'tiled' }))).toBe(false);
  });

  it('shares at once within 4 s of the tap, else asks for a second tap', () => {
    expect(shareNow(1000, 5000)).toBe(true);
    expect(shareNow(1000, 5001)).toBe(false);
  });

  it('the 分享 tap shares the finished file whatever made it (a fallback included), never a new export (Review Focus 5)', () => {
    expect(tapAction('share', true)).toBe('sharePending');
    expect(tapAction('share', false)).toBe('export'); // an edit dropped the file: export again
    expect(tapAction('save', false)).toBe('export');
    expect(tapAction('preparing', true)).toBe('ignore');
  });

  it('AbortError shows nothing; everything else falls back once', () => {
    expect(exportOutcome(new DOMException('x', 'AbortError'))).toBe('abort');
    expect(exportOutcome(new Error('context lost'))).toBe('fallback');
  });

  it('the "only 2048 kept" note: a working plan without a source although the original was larger', () => {
    const w = { width: 1536, height: 2048 };
    expect(noSourceNote(plan({ fallback: 'noSource' }), { blob: null, width: 3000, height: 4000 }, w)).toBe(true);
    expect(noSourceNote(plan({ fallback: 'noSource' }), { blob: null, width: null, height: null }, w)).toBe(false);
    expect(noSourceNote(plan({ fallback: 'notLarger' }), { blob: null, width: 3000, height: 4000 }, w)).toBe(false);
  });

  it('pill copy', () => {
    expect([pillLabel('save'), pillLabel('preparing'), pillLabel('share')]).toEqual(['儲存', '準備中', '分享']);
  });
});
