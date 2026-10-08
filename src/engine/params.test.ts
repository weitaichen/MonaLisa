import { describe, expect, it } from 'vitest';
import type { BeautyParams, ParamGroup, ParamId, PresetId } from '../types';
import {
  applyPreset,
  BLUSH_SHADES,
  defaultParams,
  displayValue,
  FILTERS,
  fromDisplay,
  hasValue,
  LIP_SHADES,
  MAKEUP_PICK_DEFAULT,
  neutralValue,
  PARAM_DEFS,
  paramDef,
  paramsInGroup,
  presetDef,
  PRESETS,
  resetGroup,
  sanitizeParams,
  setBodyProtect,
  setFilter,
  setHeightBand,
  setParam,
  setPresetAmount,
  setShade,
  shadeColor,
  signed,
} from './params';

const PRESET_IDS: PresetId[] = ['original', 'natural', 'refined', 'glow'];
const GROUPS: ParamGroup[] = ['skin', 'shape', 'body', 'filter', 'makeup'];
const BIDIRECTIONAL: ParamId[] = ['shape.chin', 'shape.forehead', 'shape.mouthSize', 'shape.eyeDistance', 'body.hip'];

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

describe('PARAM_DEFS schema (RB §5)', () => {
  it('has the 26 params (16 face/colour + 10 美體), unique ids, valid groups', () => {
    expect(PARAM_DEFS).toHaveLength(26);
    expect(new Set(PARAM_DEFS.map((d) => d.id)).size).toBe(26);
    for (const d of PARAM_DEFS) {
      expect(GROUPS).toContain(d.group);
      expect(d.id.startsWith(`${d.group}.`)).toBe(true);
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.icon.length).toBeGreaterThan(0);
      expect(d.default).toBeGreaterThanOrEqual(0);
      expect(d.default).toBeLessThanOrEqual(1);
    }
  });

  it('bidirectional params are exactly chin / forehead / mouth / eye distance / 美臀, neutral 0.5', () => {
    expect(PARAM_DEFS.filter((d) => d.bidirectional).map((d) => d.id).sort()).toEqual([...BIDIRECTIONAL].sort());
    for (const d of PARAM_DEFS) {
      expect(neutralValue(d)).toBe(d.bidirectional ? 0.5 : 0);
      if (d.bidirectional) expect(d.default).toBe(0.5);
    }
  });

  it('defaults match the RB §5 table', () => {
    const expected: Record<ParamId, number> = {
      'skin.smooth': 0.55,
      'skin.whiten': 0.25,
      'skin.rosy': 0.25,
      'skin.sharpen': 0.2,
      'shape.eyeEnlarge': 0.2,
      'shape.eyeDistance': 0.5,
      'shape.faceSlim': 0.15,
      'shape.faceV': 0.1,
      'shape.faceNarrow': 0,
      'shape.chin': 0.5,
      'shape.forehead': 0.5,
      'shape.noseSlim': 0.1,
      'shape.mouthSize': 0.5,
      // 美體: neutral by default (never part of a preset)
      'body.legs': 0,
      'body.slim': 0,
      'body.waist': 0,
      'body.whr': 0,
      'body.hip': 0.5,
      'body.legSlim': 0,
      'body.arms': 0,
      'body.shoulder': 0,
      'body.neck': 0,
      'body.head': 0,
      'filter.amount': 0.5,
      'makeup.lip': 0,
      'makeup.blush': 0,
    };
    for (const d of PARAM_DEFS) expect(d.default).toBe(expected[d.id]);
  });

  it('paramDef / paramsInGroup', () => {
    expect(paramDef('skin.smooth').label).toBe('磨皮');
    expect(() => paramDef('nope' as ParamId)).toThrow();
    expect(paramsInGroup('skin').map((d) => d.id)).toEqual(['skin.smooth', 'skin.whiten', 'skin.rosy', 'skin.sharpen']);
    expect(paramsInGroup('filter').map((d) => d.id)).toEqual(['filter.amount']);
    expect(paramsInGroup('makeup').map((d) => d.id)).toEqual(['makeup.lip', 'makeup.blush']);
    expect(paramsInGroup('body').map((d) => d.id)).toEqual([
      'body.legs', 'body.slim', 'body.waist', 'body.whr', 'body.hip',
      'body.legSlim', 'body.arms', 'body.shoulder', 'body.neck', 'body.head',
    ]);
    expect(GROUPS.flatMap((g) => paramsInGroup(g)).length).toBe(PARAM_DEFS.length);
  });
});

describe('FILTERS / shades', () => {
  it('filters: none + 8 LUTs with sane default amounts', () => {
    expect(FILTERS.map((f) => f.id)).toEqual(['none', 'natural', 'soft', 'milktea', 'warm', 'cool', 'japanese', 'film', 'mono']);
    for (const f of FILTERS) {
      expect(f.defaultAmount).toBeGreaterThanOrEqual(0);
      expect(f.defaultAmount).toBeLessThanOrEqual(1);
    }
  });

  it('shades are #RRGGBB with unique ids per part (spec §7.4 colours)', () => {
    for (const list of [LIP_SHADES, BLUSH_SHADES]) {
      expect(new Set(list.map((s) => s.id)).size).toBe(list.length);
      for (const s of list) expect(s.color).toMatch(/^#[0-9A-F]{6}$/);
    }
    expect(LIP_SHADES.map((s) => s.color)).toEqual(['#F06A5B', '#C9767A', '#D8456B', '#D21F3C', '#F08A4B']);
    expect(BLUSH_SHADES.map((s) => s.color)).toEqual(['#FF9E8A', '#FF8FB1', '#FFB07A', '#E77A93']);
  });

  it('shadeColor resolves per part; null / unknown → null', () => {
    expect(shadeColor('lip', 'coral')).toBe('#F06A5B');
    expect(shadeColor('blush', 'peach')).toBe('#FF9E8A');
    // "rose" exists in both lists with different colours
    expect(shadeColor('lip', 'rose')).toBe('#D8456B');
    expect(shadeColor('blush', 'rose')).toBe('#E77A93');
    expect(shadeColor('lip', null)).toBeNull();
    expect(shadeColor('lip', 'peach')).toBeNull();
    expect(shadeColor('blush', 'nope')).toBeNull();
  });
});

describe('presets', () => {
  it('there are 原圖 / 自然 / 精緻 / 氣色 with complete value sets in [0,1]', () => {
    expect(PRESETS.map((p) => [p.id, p.label])).toEqual([
      ['original', '原圖'],
      ['natural', '自然'],
      ['refined', '精緻'],
      ['glow', '氣色'],
    ]);
    for (const p of PRESETS) {
      for (const d of PARAM_DEFS) {
        expect(p.values[d.id]).toBeGreaterThanOrEqual(0);
        expect(p.values[d.id]).toBeLessThanOrEqual(1);
      }
      expect(Object.keys(p.values).sort()).toEqual(PARAM_DEFS.map((d) => d.id).sort());
      expect(FILTERS.some((f) => f.id === p.filterId)).toBe(true);
    }
    expect(() => presetDef('nope' as PresetId)).toThrow();
  });

  it('原圖 is neutral everywhere, no filter, no makeup shades', () => {
    const p = presetDef('original');
    for (const d of PARAM_DEFS) expect(p.values[d.id]).toBe(neutralValue(d));
    expect([p.filterId, p.lipShade, p.blushShade]).toEqual(['none', null, null]);
  });

  it('自然 = the defaults column (first launch)', () => {
    const p = presetDef('natural');
    for (const d of PARAM_DEFS) expect(p.values[d.id]).toBe(d.default);
    expect(defaultParams()).toEqual(applyPreset('natural', 1));
    expect(defaultParams().presetId).toBe('natural');
    expect(defaultParams().presetAmount).toBe(1);
  });

  it('精緻 / 氣色 carry the RB §5 table values', () => {
    const r = presetDef('refined');
    expect(r.values['skin.smooth']).toBe(0.7);
    expect(r.values['shape.chin']).toBe(0.4);
    expect(r.values['shape.mouthSize']).toBe(0.45);
    expect(r.values['shape.eyeDistance']).toBe(0.5);
    expect(r.filterId).toBe('soft');
    expect(r.values['filter.amount']).toBe(0.4);
    const g = presetDef('glow');
    expect(g.values['skin.rosy']).toBe(0.45);
    expect([g.filterId, g.lipShade, g.blushShade]).toEqual(['warm', 'bean', 'peach']);
    expect([g.values['makeup.lip'], g.values['makeup.blush']]).toEqual([0.3, 0.3]);
    // glow's shades exist
    expect(shadeColor('lip', g.lipShade)).not.toBeNull();
    expect(shadeColor('blush', g.blushShade)).not.toBeNull();
  });
});

describe('applyPreset (程度 scaling)', () => {
  it.each(PRESET_IDS)('%s at amount 1 = preset values', (id) => {
    const def = presetDef(id);
    const p = applyPreset(id, 1);
    expect(p.values).toEqual(def.values);
    expect(p).toMatchObject({
      filterId: def.filterId,
      lipShade: def.lipShade,
      blushShade: def.blushShade,
      presetId: id,
      presetAmount: 1,
    });
  });

  it('defaults to amount 1', () => {
    expect(applyPreset('refined')).toEqual(applyPreset('refined', 1));
  });

  it.each(PRESET_IDS)('%s at amount 0 = all neutral', (id) => {
    const p = applyPreset(id, 0);
    for (const d of PARAM_DEFS) expect(p.values[d.id]).toBe(neutralValue(d));
    expect(p.presetAmount).toBe(0);
    expect(p.presetId).toBe(id);
  });

  it('scales each param’s distance from neutral linearly (one-way and bidirectional)', () => {
    for (const id of PRESET_IDS) {
      const def = presetDef(id);
      for (const a of [0.25, 0.5, 0.8]) {
        const p = applyPreset(id, a);
        for (const d of PARAM_DEFS) {
          const n = neutralValue(d);
          expect(p.values[d.id]).toBeCloseTo(n + (def.values[d.id] - n) * a, 12);
        }
      }
    }
    // concrete examples: refined chin 0.4 (−20) at 50% → 0.45 (−10); smooth 0.7 → 0.35
    const half = applyPreset('refined', 0.5);
    expect(half.values['shape.chin']).toBeCloseTo(0.45, 12);
    expect(half.values['skin.smooth']).toBeCloseTo(0.35, 12);
    expect(half.values['shape.eyeDistance']).toBe(0.5);
  });

  it('is monotone in amount for every param', () => {
    for (const id of PRESET_IDS) {
      const def = presetDef(id);
      let prev = applyPreset(id, 0);
      for (let i = 1; i <= 20; i++) {
        const cur = applyPreset(id, i / 20);
        for (const d of PARAM_DEFS) {
          const dir = Math.sign(def.values[d.id] - neutralValue(d));
          expect((cur.values[d.id] - prev.values[d.id]) * dir).toBeGreaterThanOrEqual(-1e-12);
        }
        prev = cur;
      }
    }
  });

  it('keeps the preset’s filter / shades at any amount (amount only scales values)', () => {
    const p = applyPreset('glow', 0.3);
    expect([p.filterId, p.lipShade, p.blushShade]).toEqual(['warm', 'bean', 'peach']);
    expect(p.values['filter.amount']).toBeCloseTo(0.12, 12);
  });

  it.each([
    [2, 1],
    [-1, 0],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 1],
    [Number.NEGATIVE_INFINITY, 0],
  ])('clamps amount %s → %s', (amount, expected) => {
    const p = applyPreset('refined', amount);
    expect(p.presetAmount).toBe(expected);
    for (const d of PARAM_DEFS) {
      expect(p.values[d.id]).toBeGreaterThanOrEqual(0);
      expect(p.values[d.id]).toBeLessThanOrEqual(1);
    }
  });

  it('returns fresh objects (mutating one does not leak into the preset table)', () => {
    const p = applyPreset('natural');
    p.values['skin.smooth'] = 0.99;
    expect(presetDef('natural').values['skin.smooth']).toBe(0.55);
    expect(applyPreset('natural').values['skin.smooth']).toBe(0.55);
  });
});

describe('setPresetAmount', () => {
  it('re-applies the active preset at the new amount', () => {
    const p = applyPreset('glow', 1);
    expect(setPresetAmount(p, 0.4)).toEqual(applyPreset('glow', 0.4));
  });

  it('is a no-op (same object) for custom params', () => {
    const p = setParam(defaultParams(), 'skin.smooth', 0.3);
    expect(setPresetAmount(p, 0.1)).toBe(p);
  });
});

describe('setParam', () => {
  it('sets one value, switches to 自訂 (custom), leaves the rest', () => {
    const base = deepFreeze(applyPreset('refined', 0.7));
    const p = setParam(base, 'shape.chin', 0.9);
    expect(p.values['shape.chin']).toBe(0.9);
    expect(p.presetId).toBe('custom');
    for (const d of PARAM_DEFS) if (d.id !== 'shape.chin') expect(p.values[d.id]).toBe(base.values[d.id]);
    expect([p.filterId, p.lipShade, p.blushShade, p.presetAmount]).toEqual([
      base.filterId,
      base.lipShade,
      base.blushShade,
      base.presetAmount,
    ]);
  });

  it('switches to custom even when the value does not change', () => {
    const base = defaultParams();
    expect(setParam(base, 'skin.smooth', base.values['skin.smooth']).presetId).toBe('custom');
  });

  it.each([
    [1.5, 1],
    [-0.2, 0],
    [Number.NaN, 0],
    [Number.NEGATIVE_INFINITY, 0],
  ])('clamps %s → %s', (v, expected) => {
    expect(setParam(defaultParams(), 'skin.whiten', v).values['skin.whiten']).toBe(expected);
  });

  it('does not mutate its input (frozen input works)', () => {
    const base = deepFreeze(defaultParams());
    expect(() => setParam(base, 'skin.smooth', 0.1)).not.toThrow();
    expect(base.values['skin.smooth']).toBe(0.55);
  });
});

describe('setFilter', () => {
  it('picking a LUT sets its default amount and switches to custom', () => {
    const p = setFilter(deepFreeze(defaultParams()), 'mono');
    expect(p.filterId).toBe('mono');
    expect(p.values['filter.amount']).toBe(1);
    expect(p.presetId).toBe('custom');
    for (const f of FILTERS.filter((x) => x.id !== 'none')) {
      expect(setFilter(defaultParams(), f.id).values['filter.amount']).toBe(f.defaultAmount);
    }
  });

  it('picking 無 keeps the current amount', () => {
    const p = setParam(setFilter(defaultParams(), 'film'), 'filter.amount', 0.33);
    const none = setFilter(p, 'none');
    expect(none.filterId).toBe('none');
    expect(none.values['filter.amount']).toBe(0.33);
  });

  it('unknown filter id → none', () => {
    const p = setFilter(setFilter(defaultParams(), 'warm'), 'does-not-exist');
    expect(p.filterId).toBe('none');
  });
});

describe('setShade', () => {
  it('picking a shade from 0 applies the pick default intensity', () => {
    const p = setShade(deepFreeze(defaultParams()), 'lip', 'red');
    expect(p.lipShade).toBe('red');
    expect(p.values['makeup.lip']).toBe(MAKEUP_PICK_DEFAULT.lip);
    expect(p.presetId).toBe('custom');
    const b = setShade(defaultParams(), 'blush', 'pink');
    expect(b.blushShade).toBe('pink');
    expect(b.values['makeup.blush']).toBe(MAKEUP_PICK_DEFAULT.blush);
    expect(MAKEUP_PICK_DEFAULT).toEqual({ lip: 0.5, blush: 0.4 });
  });

  it('keeps a non-zero intensity when switching shades', () => {
    const p = setShade(setParam(defaultParams(), 'makeup.lip', 0.7), 'lip', 'coral');
    expect(p.values['makeup.lip']).toBe(0.7);
  });

  it('原色 (null shade) is a pick too', () => {
    const p = setShade(defaultParams(), 'blush', null);
    expect(p.blushShade).toBeNull();
    expect(p.values['makeup.blush']).toBe(MAKEUP_PICK_DEFAULT.blush);
  });

  it('touches only its own part', () => {
    const base = applyPreset('glow');
    const p = setShade(base, 'lip', 'orange');
    expect(p.blushShade).toBe(base.blushShade);
    expect(p.values['makeup.blush']).toBe(base.values['makeup.blush']);
  });
});

describe('美體 params stay outside presets', () => {
  it('applyPreset carries body values, 背景保護 and the 增高 band over from keep', () => {
    let p = setParam(applyPreset('natural'), 'body.waist', 0.6);
    p = setHeightBand(setBodyProtect(p, false), { top: 0.5, bottom: 0.8, amount: 0.4 });
    expect(p.presetId).toBe('natural'); // body edits keep the preset
    const q = applyPreset('refined', 0.7, p);
    expect(q.values['body.waist']).toBe(0.6);
    expect(q.bodyProtect).toBe(false);
    expect(q.heightBand).toEqual({ top: 0.5, bottom: 0.8, amount: 0.4 });
    expect(applyPreset('refined').values['body.waist']).toBe(0);
    expect(setPresetAmount(q, 0.3).values['body.waist']).toBe(0.6);
  });

  it('sanitizeParams keeps a preset id when only body values differ, and validates the band', () => {
    const p = setParam(applyPreset('glow', 0.8), 'body.legs', 0.5);
    expect(sanitizeParams(JSON.parse(JSON.stringify(p))).presetId).toBe('glow');
    expect(sanitizeParams({ ...p, heightBand: { top: 0.9, bottom: 0.2, amount: 2 } }).heightBand).toEqual({ top: 0.2, bottom: 0.9, amount: 1 });
    expect(sanitizeParams({ ...p, heightBand: { top: 0.5, bottom: 0.51, amount: 1 } }).heightBand).toBeNull();
    expect(sanitizeParams({ ...p, heightBand: 'x' }).heightBand).toBeNull();
    expect(sanitizeParams({ ...p, bodyProtect: 'no' }).bodyProtect).toBe(true);
  });

  it('resetGroup(body) also clears the 增高 band but keeps 背景保護', () => {
    const p = setHeightBand(setBodyProtect(setParam(defaultParams(), 'body.slim', 0.5), false), { top: 0.4, bottom: 0.9, amount: 1 });
    const r = resetGroup(p, 'body');
    expect(r.values['body.slim']).toBe(0);
    expect(r.heightBand).toBeNull();
    expect(r.bodyProtect).toBe(false);
  });
});

describe('resetGroup (⊘ 原圖 item)', () => {
  it.each(GROUPS)('%s → that group neutral, others untouched, custom (body keeps the preset)', (group) => {
    const base = deepFreeze(applyPreset('glow'));
    const p = resetGroup(base, group);
    for (const d of PARAM_DEFS) {
      expect(p.values[d.id]).toBe(d.group === group ? neutralValue(d) : base.values[d.id]);
    }
    // 美體 is outside every preset, so resetting it must not drop the active one
    expect(p.presetId).toBe(group === 'body' ? 'glow' : 'custom');
    expect(p.filterId).toBe(group === 'filter' ? 'none' : base.filterId);
    expect(p.lipShade).toBe(group === 'makeup' ? null : base.lipShade);
    expect(p.blushShade).toBe(group === 'makeup' ? null : base.blushShade);
  });

  it('shape reset puts bidirectional params back to 0.5', () => {
    const p = resetGroup(applyPreset('refined'), 'shape');
    for (const id of BIDIRECTIONAL) expect(p.values[id]).toBe(0.5);
    expect(p.values['shape.faceSlim']).toBe(0);
  });

  it('resetting every group equals 原圖 values', () => {
    let p: BeautyParams = applyPreset('glow');
    for (const g of GROUPS) p = resetGroup(p, g);
    expect(p.values).toEqual(presetDef('original').values);
    expect([p.filterId, p.lipShade, p.blushShade]).toEqual(['none', null, null]);
  });
});

describe('hasValue (dot badge)', () => {
  const smooth = paramDef('skin.smooth');
  const chin = paramDef('shape.chin');
  it('one-way: v > 0.01', () => {
    expect(hasValue(smooth, 0)).toBe(false);
    expect(hasValue(smooth, 0.01)).toBe(false);
    expect(hasValue(smooth, 0.011)).toBe(true);
    expect(hasValue(smooth, 1)).toBe(true);
  });
  it('bidirectional: |v − 0.5| > 0.01', () => {
    expect(hasValue(chin, 0.5)).toBe(false);
    expect(hasValue(chin, 0.505)).toBe(false);
    expect(hasValue(chin, 0.495)).toBe(false);
    expect(hasValue(chin, 0.52)).toBe(true);
    expect(hasValue(chin, 0.48)).toBe(true);
    expect(hasValue(chin, 0)).toBe(true);
  });
  it('defaults have no badge on 0 / neutral params', () => {
    for (const d of PARAM_DEFS) expect(hasValue(d, neutralValue(d))).toBe(false);
  });
});

describe('displayValue / fromDisplay', () => {
  const oneWay = PARAM_DEFS.filter((d) => !d.bidirectional);
  const bi = PARAM_DEFS.filter((d) => d.bidirectional);

  it('ranges: one-way 0…100, bidirectional −50…+50', () => {
    for (const d of oneWay) {
      expect(displayValue(d, 0)).toBe(0);
      expect(displayValue(d, 1)).toBe(100);
      expect(displayValue(d, 0.55)).toBe(55);
    }
    for (const d of bi) {
      expect(displayValue(d, 0)).toBe(-50);
      expect(displayValue(d, 0.5)).toBe(0);
      expect(displayValue(d, 1)).toBe(50);
      expect(displayValue(d, 0.4)).toBe(-10);
    }
  });

  it('display → value → display is the identity for every integer step', () => {
    for (const d of oneWay) for (let n = 0; n <= 100; n++) expect(displayValue(d, fromDisplay(d, n))).toBe(n);
    for (const d of bi) for (let n = -50; n <= 50; n++) expect(displayValue(d, fromDisplay(d, n)) + 0).toBe(n);
  });

  it('value → display → value is within half a step (0.005)', () => {
    for (const d of PARAM_DEFS) {
      for (let i = 0; i <= 1000; i++) {
        const v = i / 1000;
        expect(Math.abs(fromDisplay(d, displayValue(d, v)) - v)).toBeLessThanOrEqual(0.005 + 1e-12);
      }
    }
  });

  it('fromDisplay clamps out-of-range input', () => {
    const smooth = paramDef('skin.smooth');
    const chin = paramDef('shape.chin');
    expect(fromDisplay(smooth, 150)).toBe(1);
    expect(fromDisplay(smooth, -5)).toBe(0);
    expect(fromDisplay(chin, 80)).toBe(1);
    expect(fromDisplay(chin, -80)).toBe(0);
    expect(fromDisplay(chin, 0)).toBe(0.5);
    expect(fromDisplay(smooth, Number.NaN)).toBe(0);
  });

  it('presets display as the RB §5 numbers', () => {
    const r = applyPreset('refined');
    expect(displayValue(paramDef('shape.chin'), r.values['shape.chin'])).toBe(-10);
    expect(displayValue(paramDef('shape.mouthSize'), r.values['shape.mouthSize'])).toBe(-5);
    expect(displayValue(paramDef('skin.smooth'), r.values['skin.smooth'])).toBe(70);
  });
});

describe('signed', () => {
  it('maps 0 / 0.5 / 1 → −1 / 0 / 1', () => {
    expect(signed(0)).toBe(-1);
    expect(signed(0.5)).toBe(0);
    expect(signed(1)).toBe(1);
    expect(signed(0.75)).toBe(0.5);
  });
});

describe('sanitizeParams', () => {
  const d = defaultParams();

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['number', 42],
    ['string', 'params'],
    ['boolean', true],
    ['array', [1, 2]],
    ['empty object', {}],
    ['function', () => 1],
  ])('%s → defaults', (_n, raw) => {
    expect(sanitizeParams(raw)).toEqual(d);
  });

  it.each(PRESET_IDS)('round-trips %s (via JSON) unchanged', (id) => {
    for (const a of [0, 0.37, 1]) {
      const p = applyPreset(id, a);
      expect(sanitizeParams(JSON.parse(JSON.stringify(p)))).toEqual(p);
    }
  });

  it('round-trips heavily edited custom params unchanged', () => {
    let p = applyPreset('glow', 0.5);
    p = setParam(p, 'shape.eyeDistance', 0.12);
    p = setFilter(p, 'japanese');
    p = setShade(p, 'lip', null);
    p = setShade(p, 'blush', 'apricot');
    p = resetGroup(p, 'skin');
    expect(sanitizeParams(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it('per-value junk falls back to that param’s default; out-of-range clamps', () => {
    const p = sanitizeParams({
      values: {
        'skin.smooth': 'high',
        'skin.whiten': 5,
        'skin.rosy': -3,
        'skin.sharpen': null,
        'shape.chin': 0.7,
        'shape.forehead': { v: 1 },
        'shape.eyeEnlarge': Number.NaN,
        'shape.faceSlim': Number.POSITIVE_INFINITY,
        'not.a.param': 0.9,
      },
    });
    expect(p.values['skin.smooth']).toBe(d.values['skin.smooth']);
    expect(p.values['skin.whiten']).toBe(1);
    expect(p.values['skin.rosy']).toBe(0);
    expect(p.values['skin.sharpen']).toBe(d.values['skin.sharpen']);
    expect(p.values['shape.chin']).toBe(0.7);
    expect(p.values['shape.forehead']).toBe(d.values['shape.forehead']);
    expect(p.values['shape.eyeEnlarge']).toBe(d.values['shape.eyeEnlarge']);
    expect(p.values['shape.faceSlim']).toBe(d.values['shape.faceSlim']);
    expect(Object.keys(p.values).sort()).toEqual(PARAM_DEFS.map((x) => x.id).sort());
  });

  it.each([['string'], [42], [[0.5]], [null]])('values = %j → default values', (values) => {
    expect(sanitizeParams({ values }).values).toEqual(d.values);
  });

  it('validates filter / shades / preset ids against the tables', () => {
    const p = sanitizeParams({ filterId: 'evil', lipShade: 'peach', blushShade: 'coral', presetId: 'admin' });
    expect(p.filterId).toBe('none');
    expect(p.lipShade).toBeNull(); // peach is a blush shade, not a lip shade
    expect(p.blushShade).toBeNull(); // coral is a lip shade
    expect(p.presetId).toBe('natural');
    const ok = sanitizeParams({ filterId: 'film', lipShade: 'rose', blushShade: 'rose', presetId: 'custom' });
    expect([ok.filterId, ok.lipShade, ok.blushShade, ok.presetId]).toEqual(['film', 'rose', 'rose', 'custom']);
  });

  it('non-string ids are rejected', () => {
    const p = sanitizeParams({ filterId: 1, lipShade: { id: 'red' }, blushShade: true, presetId: ['natural'] });
    expect([p.filterId, p.lipShade, p.blushShade, p.presetId]).toEqual(['none', null, null, 'natural']);
  });

  it.each([
    [0.3, 0.3],
    [7, 1],
    [-1, 0],
    ['0.5', 1],
    [null, 1],
    [undefined, 1],
  ])('presetAmount %j → %s', (presetAmount, expected) => {
    expect(sanitizeParams({ presetAmount }).presetAmount).toBe(expected);
  });

  it('has exactly the BeautyParams keys (unknown keys dropped)', () => {
    const p = sanitizeParams({ ...applyPreset('glow'), evil: 1, constructor: 'x' });
    expect(Object.keys(p).sort()).toEqual(['blushShade', 'bodyProtect', 'filterId', 'heightBand', 'lipShade', 'presetAmount', 'presetId', 'values']);
  });

  it('ignores a "__proto__" key from JSON', () => {
    const raw: unknown = JSON.parse('{"__proto__": {"filterId": "film", "values": {"skin.smooth": 1}}}');
    const p = sanitizeParams(raw);
    expect(p).toEqual(d);
    expect(({} as { filterId?: string }).filterId).toBeUndefined();
  });

  it('returns a fresh object each time', () => {
    const a = sanitizeParams(undefined);
    a.values['skin.smooth'] = 0;
    expect(sanitizeParams(undefined).values['skin.smooth']).toBe(0.55);
  });
});

describe('integration fixes (phase 2)', () => {
  it('sanitizeParams keeps a preset id only while the values still are that preset', () => {
    for (const p of PRESETS) {
      for (const amount of [1, 0.4]) {
        const stored = JSON.parse(JSON.stringify(applyPreset(p.id, amount)));
        expect(sanitizeParams(stored)).toEqual(applyPreset(p.id, amount));
      }
    }
    const edited = JSON.parse(JSON.stringify(applyPreset('refined', 1)));
    edited.values['skin.smooth'] = 0.01;
    expect(sanitizeParams(edited).presetId).toBe('custom');
    const reFiltered = { ...JSON.parse(JSON.stringify(applyPreset('natural', 1))), filterId: 'mono' };
    expect(sanitizeParams(reFiltered).presetId).toBe('custom');
  });

  it('displayValue never returns -0', () => {
    const chin = paramDef('shape.chin');
    expect(Object.is(displayValue(chin, 0.499), 0)).toBe(true);
    expect(Object.is(displayValue(chin, 0.5), 0)).toBe(true);
  });
});
