// 調節 params (v0.4 step-2 spec §3.1): 12 photo-level, live items, neutral by default, outside every preset.
import { describe, expect, it } from 'vitest';
import type { AdjustId, ParamId, PhotoParamId } from '../types';
import { neutralValue, PARAM_DEFS, paramDef, paramsInGroup, PRESETS } from './params';

const ADJUST: AdjustId[] = [
  'adjust.brightness',
  'adjust.exposure',
  'adjust.contrast',
  'adjust.highlights',
  'adjust.shadows',
  'adjust.temperature',
  'adjust.tint',
  'adjust.saturation',
  'adjust.vibrance',
  'adjust.fade',
  'adjust.grain',
  'adjust.vignette',
];
const ONE_WAY: AdjustId[] = ['adjust.fade', 'adjust.grain', 'adjust.vignette'];

describe('調節 params (step-2 spec §3.1)', () => {
  it('are the 12 items of the strip, in strip order, with their labels and icons', () => {
    const defs = paramsInGroup('adjust');
    expect(defs.map((d) => d.id)).toEqual(ADJUST);
    expect(defs.map((d) => d.label)).toEqual(['亮度', '曝光', '對比', '高光', '陰影', '色溫', '色調', '飽和', '鮮艷度', '褪色', '顆粒', '暗角']);
    expect(defs.map((d) => d.icon)).toEqual([
      'brightness', 'exposure', 'contrast', 'highlights', 'shadows', 'temperature',
      'tint', 'saturation', 'vibrance', 'fade', 'grain', 'vignette',
    ]);
  });

  it('are photo-level, live, neutral by default; only 褪色 / 顆粒 / 暗角 are one-way', () => {
    for (const id of ADJUST) {
      const d = paramDef(id);
      expect(d).toMatchObject({ group: 'adjust', scope: 'photo', live: true });
      expect(d.bidirectional).toBe(!ONE_WAY.includes(id));
      expect(d.default).toBe(neutralValue(d));
    }
  });

  it('sit outside every beauty preset (C §3.4): each preset holds the neutral value', () => {
    for (const p of PRESETS) for (const id of ADJUST) expect(p.values[id], `${p.id} ${id}`).toBe(neutralValue(paramDef(id)));
  });

  it('PhotoParamId covers adjust.* (type-level check, compiled by npm run typecheck)', () => {
    const ids: PhotoParamId[] = ADJUST;
    const all: ParamId[] = ids;
    expect(all).toHaveLength(12);
    expect(PARAM_DEFS.filter((d) => d.group === 'adjust')).toHaveLength(12);
  });
});
