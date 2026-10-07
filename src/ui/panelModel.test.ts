import { describe, expect, it } from 'vitest';
import { applyPreset, defaultParams, FILTERS, LIP_SHADES, MAKEUP_PICK_DEFAULT, paramsInGroup } from '../engine/params';
import { activate, INITIAL_SELECTION, itemsFor, sliderFor, tabHasValue, type PanelSelection } from './panelModel';

const sel = (over: Partial<PanelSelection>): PanelSelection => ({ ...INITIAL_SELECTION, ...over });
const byKey = (items: ReturnType<typeof itemsFor>, key: string) => {
  const it = items.find((i) => i.key === key);
  if (!it) throw new Error(`no item ${key}`);
  return it;
};

describe('itemsFor', () => {
  it('skin / shape strips start with ⊘ 原圖 then every param of the group', () => {
    for (const tab of ['skin', 'shape'] as const) {
      const items = itemsFor(defaultParams(), sel({ tab }));
      expect(items[0]).toMatchObject({ key: 'reset', label: '原圖' });
      expect(items.slice(1).map((i) => i.key)).toEqual(paramsInGroup(tab).map((d) => d.id));
    }
  });
  it('has-value dots follow hasValue (bidirectional neutral at 0.5)', () => {
    const items = itemsFor(defaultParams(), sel({ tab: 'shape' }));
    expect(byKey(items, 'shape.eyeEnlarge').hasValue).toBe(true);
    expect(byKey(items, 'shape.chin').hasValue).toBe(false);
    expect(byKey(items, 'shape.faceNarrow').hasValue).toBe(false);
  });
  it('preset strip shows 自訂 only for custom params', () => {
    const p = defaultParams();
    expect(itemsFor(p, sel({ tab: 'preset' })).map((i) => i.label)).toEqual(['原圖', '自然', '精緻', '氣色']);
    const items = itemsFor({ ...p, presetId: 'custom' }, sel({ tab: 'preset' }));
    expect(items.at(-1)).toMatchObject({ label: '自訂', selected: true });
  });
  it('filter strip: 無 first, thumbnails for LUTs, selected = current filter', () => {
    const items = itemsFor({ ...defaultParams(), filterId: 'warm' }, sel({ tab: 'filter' }));
    expect(items.map((i) => i.key)).toEqual(FILTERS.map((f) => f.id));
    expect(items[0].visual).toEqual({ kind: 'icon', icon: 'none' });
    expect(byKey(items, 'warm')).toMatchObject({ selected: true, visual: { kind: 'thumb', src: '/luts/filters/warm_thumb.png' } });
  });
  it('makeup strip: 無, 原色, then shades; 無 is the selected item while the part is off', () => {
    const items = itemsFor(defaultParams(), sel({ tab: 'makeup', makeupPart: 'lip' }));
    expect(items.map((i) => i.key)).toEqual(['reset', 'orig', ...LIP_SHADES.map((s) => s.id)]);
    expect(items.filter((i) => i.selected).map((i) => i.key)).toEqual(['reset']);
  });
  it('makeup strip: after picking a shade exactly that shade is selected, not 無', () => {
    const s = sel({ tab: 'makeup', makeupPart: 'lip' });
    const p0 = defaultParams();
    const shade = LIP_SHADES[0].id;
    const r = activate(byKey(itemsFor(p0, s), shade), p0, s);
    expect(r.changed).toBe(true);
    expect(itemsFor(r.params, s).filter((i) => i.selected).map((i) => i.key)).toEqual([shade]);
  });
});

describe('activate', () => {
  it('tapping the already-selected makeup 無 is a no-op', () => {
    const p = defaultParams();
    const s = sel({ tab: 'makeup', makeupPart: 'lip' });
    const r = activate(itemsFor(p, s)[0], p, s);
    expect(r.changed).toBe(false);
    expect(r.params).toBe(p);
  });
  it('preset tap applies the preset and keeps 程度 between presets', () => {
    const p = applyPreset('natural', 0.6);
    const s = sel({ tab: 'preset' });
    const r = activate(byKey(itemsFor(p, s), 'refined'), p, s);
    expect(r.changed).toBe(true);
    expect(r.params.presetId).toBe('refined');
    expect(r.params.presetAmount).toBeCloseTo(0.6);
  });
  it('tapping the already-selected preset is a no-op', () => {
    const p = defaultParams();
    const s = sel({ tab: 'preset' });
    const r = activate(byKey(itemsFor(p, s), 'natural'), p, s);
    expect(r.changed).toBe(false);
    expect(r.params).toBe(p);
  });
  it('⊘ resets the group to neutral and marks custom', () => {
    const p = defaultParams();
    const s = sel({ tab: 'skin' });
    const r = activate(itemsFor(p, s)[0], p, s);
    for (const d of paramsInGroup('skin')) expect(r.params.values[d.id]).toBe(0);
    expect(r.params.values['shape.eyeEnlarge']).toBe(p.values['shape.eyeEnlarge']);
    expect(r.params.presetId).toBe('custom');
  });
  it('makeup ⊘ clears only the current part', () => {
    const p = applyPreset('glow');
    const s = sel({ tab: 'makeup', makeupPart: 'lip' });
    const r = activate(itemsFor(p, s)[0], p, s);
    expect(r.params.values['makeup.lip']).toBe(0);
    expect(r.params.lipShade).toBeNull();
    expect(r.params.values['makeup.blush']).toBe(p.values['makeup.blush']);
    expect(r.params.blushShade).toBe(p.blushShade);
  });
  it('param tap only changes the selection', () => {
    const p = defaultParams();
    const s = sel({ tab: 'shape' });
    const r = activate(byKey(itemsFor(p, s), 'shape.chin'), p, s);
    expect(r.params).toBe(p);
    expect(r.sel.shape).toBe('shape.chin');
  });
  it('picking a shade from 0 applies the pick default intensity', () => {
    const p = defaultParams();
    const s = sel({ tab: 'makeup', makeupPart: 'blush' });
    const r = activate(byKey(itemsFor(p, s), 'peach'), p, s);
    expect(r.params.blushShade).toBe('peach');
    expect(r.params.values['makeup.blush']).toBe(MAKEUP_PICK_DEFAULT.blush);
    expect(byKey(itemsFor(r.params, s), 'peach').selected).toBe(true);
  });
  it('filter pick sets the filter default amount', () => {
    const p = defaultParams();
    const s = sel({ tab: 'filter' });
    const r = activate(byKey(itemsFor(p, s), 'mono'), p, s);
    expect(r.params.filterId).toBe('mono');
    expect(r.params.values['filter.amount']).toBe(1);
  });
});

describe('sliderFor', () => {
  it('程度 for presets, none for 原圖 / 自訂', () => {
    expect(sliderFor(applyPreset('glow', 0.7), sel({ tab: 'preset' }))).toMatchObject({ label: '程度', value: 0.7, defaultValue: 1 });
    expect(sliderFor(applyPreset('original'), sel({ tab: 'preset' }))).toBeNull();
    expect(sliderFor({ ...defaultParams(), presetId: 'custom' }, sel({ tab: 'preset' }))).toBeNull();
  });
  it('param slider writes through setParam (→ custom) and knows bidirectionality', () => {
    const p = defaultParams();
    const b = sliderFor(p, sel({ tab: 'shape', shape: 'shape.chin' }))!;
    expect(b).toMatchObject({ label: '下巴', bidirectional: true, value: 0.5, defaultValue: 0.5 });
    const next = b.apply(p, 0.7);
    expect(next.values['shape.chin']).toBe(0.7);
    expect(next.presetId).toBe('custom');
  });
  it('filter slider only with a filter; makeup slider always present', () => {
    expect(sliderFor(defaultParams(), sel({ tab: 'filter' }))).toBeNull();
    expect(sliderFor({ ...defaultParams(), filterId: 'soft' }, sel({ tab: 'filter' }))).toMatchObject({ label: '濾鏡強度', defaultValue: 0.5 });
    expect(sliderFor(defaultParams(), sel({ tab: 'makeup', makeupPart: 'lip' }))).toMatchObject({ label: '口紅', value: 0 });
  });
  it('preset 程度 slider scales distance from neutral', () => {
    const p = applyPreset('refined', 1);
    const b = sliderFor(p, sel({ tab: 'preset' }))!;
    const half = b.apply(p, 0.5);
    expect(half.values['skin.smooth']).toBeCloseTo(0.35);
    expect(half.values['shape.chin']).toBeCloseTo(0.45);
  });
});

describe('tabHasValue', () => {
  it('reflects group state', () => {
    const p = defaultParams();
    expect(tabHasValue(p, 'skin')).toBe(true);
    expect(tabHasValue(p, 'filter')).toBe(false);
    expect(tabHasValue(p, 'makeup')).toBe(false);
    expect(tabHasValue(applyPreset('glow'), 'makeup')).toBe(true);
  });
});
