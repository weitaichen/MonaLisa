import { describe, expect, it } from 'vitest';
import {
  applyPreset,
  defaultParams,
  FILTERS,
  LIP_SHADES,
  MAKEUP_PICK_DEFAULT,
  paramsInGroup,
  setHeightBand,
  setParam,
} from '../engine/params';
import type { ParamId, RegionStatus } from '../types';
import { heightBandStretch } from '../body/bands';
import { bandEdges, bandToDisplay, defaultStretch, displayToBand, dragEdge, keyStep, MIN_GAP, moveEdge } from './components/HeightBandOverlay';
import { hasIcon } from './icons';
import {
  activate,
  bandOrSuggested,
  BODY_ERROR_NOTE,
  BODY_MULTI_NOTE,
  BODY_NO_MASK_REASON,
  BODY_NONE_NOTE,
  BODY_UNSUPPORTED_NOTE,
  bodyNote,
  CAMERA_BODY,
  DEFAULT_BAND,
  INITIAL_SELECTION,
  itemsFor,
  showsHeightBand,
  sliderFor,
  tabHasValue,
  TABS,
  type BodyContext,
  type PanelSelection,
} from './panelModel';

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

// ───────────── 美體 ─────────────

const LEGS_REASON = '拍攝全身照可使用長腿／瘦腿';
const ready = (over: Partial<BodyContext> = {}): BodyContext => ({
  status: 'ready',
  people: 1,
  availability: (id: ParamId): RegionStatus =>
    id === 'body.legs' || id === 'body.legSlim' ? { ok: false, reason: LEGS_REASON } : { ok: true, reason: null },
  ...over,
});
const bodySel = (body: PanelSelection['body'] = 'body.legs') => sel({ tab: 'body', body });

describe('美體 tab', () => {
  it('sits after 美型: 一鍵 · 美膚 · 美型 · 美體 · 濾鏡 · 美妝', () => {
    expect(TABS.map((t) => t.label)).toEqual(['一鍵', '美膚', '美型', '美體', '濾鏡', '美妝']);
  });
  it('strip: ⊘ 原圖 · 增高 · the 10 sliders in schema order · 背景保護', () => {
    const items = itemsFor(defaultParams(), bodySel(), ready());
    expect(items.map((i) => i.key)).toEqual(['reset', 'height', ...paramsInGroup('body').map((d) => d.id), 'protect']);
    expect(items.map((i) => i.label).slice(2, 12)).toEqual(['長腿', '瘦身', '細腰', '腰臀比', '美臀', '瘦腿', '瘦手臂', '直角肩', '天鵝頸', '小頭']);
    expect(byKey(items, 'protect')).toMatchObject({ pressed: true, disabled: false });
  });
  it('every body item has its own icon', () => {
    for (const it of itemsFor(defaultParams(), bodySel(), ready())) {
      if (it.visual.kind === 'icon') expect(hasIcon(it.visual.icon), it.visual.icon).toBe(true);
    }
    expect(hasIcon('protectOff')).toBe(true);
  });
  it('gated sliders are disabled with their reason and never selected; the rest stay enabled', () => {
    const items = itemsFor(defaultParams(), bodySel('body.legs'), ready());
    expect(byKey(items, 'body.legs')).toMatchObject({ disabled: true, reason: LEGS_REASON, selected: false });
    expect(byKey(items, 'body.waist')).toMatchObject({ disabled: false, reason: null });
    expect(byKey(items, 'height').disabled).toBe(false);
  });
  it('tapping a disabled item only explains why', () => {
    const p = defaultParams();
    const s = bodySel('body.waist');
    const r = activate(byKey(itemsFor(p, s, ready()), 'body.legSlim'), p, s);
    expect(r).toMatchObject({ changed: false, notice: LEGS_REASON });
    expect(r.params).toBe(p);
    expect(r.sel).toBe(s);
  });
  it('while idle / loading / none / error only 原圖 · 增高 · 背景保護 work', () => {
    for (const status of ['idle', 'loading', 'none', 'error'] as const) {
      const items = itemsFor(defaultParams(), bodySel(), { ...ready(), status, progress: 0.4 });
      expect(items.filter((i) => !i.disabled).map((i) => i.key), status).toEqual(['reset', 'height', 'protect']);
      expect(items.every((i) => !i.disabled || !!i.reason)).toBe(true);
      expect(sliderFor(defaultParams(), bodySel('body.slim'), { ...ready(), status })).toBeNull();
    }
  });
  it('without a context the tab waits (idle) instead of pretending everything is available', () => {
    expect(byKey(itemsFor(defaultParams(), bodySel()), 'body.slim').disabled).toBe(true);
    expect(sliderFor(defaultParams(), bodySel('body.slim'))).toBeNull();
  });
  it('camera: everything off with the photo-only note, no slider, no tab dot, no band', () => {
    const p = setParam(defaultParams(), 'body.slim', 0.6);
    const items = itemsFor(p, bodySel('height'), CAMERA_BODY);
    expect(items.every((i) => i.disabled && i.reason === BODY_UNSUPPORTED_NOTE)).toBe(true);
    expect(sliderFor(p, bodySel('height'), CAMERA_BODY)).toBeNull();
    expect(tabHasValue(p, 'body', CAMERA_BODY)).toBe(false);
    expect(showsHeightBand(bodySel('height'), CAMERA_BODY)).toBe(false);
    expect(bodyNote(CAMERA_BODY)?.text).toBe('美體目前僅支援照片編輯');
  });
  it('notes: download progress, detecting, none, error with retry, ≥ 2 people', () => {
    expect(bodyNote({ ...ready(), status: 'loading', progress: 0.427 })).toMatchObject({ text: '下載美體模型 42%', progress: 0.427 });
    expect(bodyNote({ ...ready(), status: 'loading', progress: 1 })).toMatchObject({ text: '正在偵測人物…', progress: 'indeterminate' });
    expect(bodyNote({ ...ready(), status: 'loading' })?.progress).toBe('indeterminate');
    expect(bodyNote({ ...ready(), status: 'none' })?.text).toBe(BODY_NONE_NOTE);
    const retry = () => undefined;
    expect(bodyNote({ ...ready(), status: 'error', retry })?.action).toMatchObject({ label: '重試', run: retry });
    expect(bodyNote({ ...ready(), status: 'error', retry })?.text).toBe(BODY_ERROR_NOTE);
    expect(bodyNote({ ...ready(), status: 'error', retry, message: '下載逾時，請確認網路後重試' })?.text).toBe(
      '美體偵測失敗（下載逾時，請確認網路後重試），仍可使用手動增高',
    );
    const run = () => undefined;
    expect(bodyNote({ ...CAMERA_BODY, action: { label: '匯入照片', run } })?.action?.run).toBe(run);
    expect(bodyNote(ready())).toBeNull();
    expect(bodyNote(ready({ people: 2 }))?.text).toBe(BODY_MULTI_NOTE);
  });
  it('body slider writes the value and keeps the active preset (美體 is outside presets)', () => {
    const p = defaultParams();
    const b = sliderFor(p, bodySel('body.waist'), ready())!;
    expect(b).toMatchObject({ key: 'body.waist', label: '細腰', bidirectional: false, value: 0, defaultValue: 0 });
    const next = b.apply(p, 0.6);
    expect(next.values['body.waist']).toBe(0.6);
    expect(next.presetId).toBe('natural');
  });
  it('美臀 is centre-zero', () => {
    const b = sliderFor(defaultParams(), bodySel('body.hip'), ready())!;
    expect(b).toMatchObject({ bidirectional: true, value: 0.5, defaultValue: 0.5 });
  });
  it('增高: selecting the tool shows the band; its slider creates the band at the suggested place', () => {
    const p = defaultParams();
    const s = bodySel('body.slim');
    const r = activate(byKey(itemsFor(p, s, ready()), 'height'), p, s);
    expect(r.sel.body).toBe('height');
    expect(r.params).toBe(p);
    expect(showsHeightBand(r.sel, ready())).toBe(true);
    const ctx = ready({ suggestedBand: { top: 0.5, bottom: 0.9 } });
    const b = sliderFor(p, r.sel, ctx)!;
    expect(b).toMatchObject({ key: 'body.height', label: '增高', value: 0 });
    expect(b.apply(p, 0.4).heightBand).toEqual({ top: 0.5, bottom: 0.9, amount: 0.4 });
    // an existing band keeps its position
    const placed = setHeightBand(p, { top: 0.2, bottom: 0.4, amount: 0.1 });
    expect(sliderFor(placed, r.sel, ctx)!.value).toBe(0.1);
    expect(sliderFor(placed, r.sel, ctx)!.apply(placed, 0.7).heightBand).toEqual({ top: 0.2, bottom: 0.4, amount: 0.7 });
  });
  it('增高 works with no person detected', () => {
    const none: BodyContext = { ...ready(), status: 'none' };
    expect(sliderFor(defaultParams(), bodySel('height'), none)).not.toBeNull();
    expect(bandOrSuggested(defaultParams(), none)).toEqual({ ...DEFAULT_BAND, amount: 0 });
  });
  it('背景保護 toggles with an explanatory notice', () => {
    const p = defaultParams();
    const s = bodySel();
    const off = activate(byKey(itemsFor(p, s, ready()), 'protect'), p, s);
    expect(off.changed).toBe(true);
    expect(off.params.bodyProtect).toBe(false);
    // the measured trade only: a wider, gentler background deformation (no "smoother outline", no straight-line promise)
    expect(off.notice).toBe('背景保護已關閉：背景變形範圍較大但較平緩');
    expect(activate(byKey(itemsFor(off.params, s, ready()), 'protect'), off.params, s).notice).toBe('背景保護已開啟：背景變形範圍較小');
    const item = byKey(itemsFor(off.params, s, ready()), 'protect');
    expect(item).toMatchObject({ pressed: false, visual: { kind: 'icon', icon: 'protectOff' } });
    expect(activate(item, off.params, s).params.bodyProtect).toBe(true);
  });
  it('背景保護 is off (with the reason) when the detection has no person mask, instead of a silent no-op', () => {
    const p = defaultParams();
    const s = bodySel();
    const noMask = ready({ hasMask: false });
    const item = byKey(itemsFor(p, s, noMask), 'protect');
    expect(item).toMatchObject({ disabled: true, reason: BODY_NO_MASK_REASON });
    expect(BODY_NO_MASK_REASON).toBe('無法取得人像輪廓，背景保護暫不可用');
    const r = activate(item, p, s);
    expect(r).toMatchObject({ changed: false, notice: BODY_NO_MASK_REASON });
    expect(r.params.bodyProtect).toBe(p.bodyProtect);
    // the other items are unaffected
    expect(byKey(itemsFor(p, s, noMask), 'height').disabled).toBe(false);
    expect(byKey(itemsFor(p, s, noMask), 'reset').disabled).toBe(false);
    expect(byKey(itemsFor(p, s, noMask), 'body.waist').disabled).toBe(false);
    // a mask, or nothing said about it (assume yes), keeps it on; so do the statuses before a detection exists
    expect(byKey(itemsFor(p, s, ready({ hasMask: true })), 'protect').disabled).toBe(false);
    expect(byKey(itemsFor(p, s, ready()), 'protect').disabled).toBe(false);
    for (const status of ['idle', 'loading', 'none', 'error'] as const) {
      expect(byKey(itemsFor(p, s, { ...noMask, status }), 'protect').disabled, status).toBe(false);
    }
  });
  it('≥ 2 people: the hint names the main (centred) person, as selectPerson picks it', () => {
    expect(BODY_MULTI_NOTE).toBe('偵測到多人，僅調整畫面中央的主要人物');
  });
  it('⊘ resets the body sliders and the band, keeps the preset, and is a no-op when already neutral', () => {
    const p = setHeightBand(setParam(defaultParams(), 'body.hip', 0.8), { top: 0.5, bottom: 0.8, amount: 0.5 });
    const s = bodySel();
    const r = activate(itemsFor(p, s, ready())[0], p, s);
    expect(r.params.values['body.hip']).toBe(0.5);
    expect(r.params.heightBand).toBeNull();
    expect(r.params.presetId).toBe('natural');
    expect(r.params.values['skin.smooth']).toBe(p.values['skin.smooth']);
    const again = activate(itemsFor(r.params, s, ready())[0], r.params, s);
    expect(again.changed).toBe(false);
  });
  it('tab dot: a body slider or a band with an amount', () => {
    const p = defaultParams();
    expect(tabHasValue(p, 'body')).toBe(false);
    expect(tabHasValue(setParam(p, 'body.hip', 0.3), 'body')).toBe(true);
    expect(tabHasValue(setHeightBand(p, { top: 0.4, bottom: 0.8, amount: 0 }), 'body')).toBe(false);
    expect(tabHasValue(setHeightBand(p, { top: 0.4, bottom: 0.8, amount: 0.3 }), 'body')).toBe(true);
  });
  it('picking a 一鍵 preset keeps the body edits', () => {
    const p = {
      ...setHeightBand(setParam(defaultParams(), 'body.waist', 0.7), { top: 0.5, bottom: 0.8, amount: 0.5 }),
      bodyProtect: false,
    };
    const s = sel({ tab: 'preset' });
    const r = activate(byKey(itemsFor(p, s), 'glow'), p, s);
    expect(r.params.presetId).toBe('glow');
    expect(r.params.values['body.waist']).toBe(0.7);
    expect(r.params.heightBand).toEqual({ top: 0.5, bottom: 0.8, amount: 0.5 });
    expect(r.params.bodyProtect).toBe(false);
  });
});

describe('增高 band overlay maths', () => {
  it('display edges are the stretched band: top fixed, bottom grows by 1 + 0.15·amount', () => {
    expect(bandToDisplay({ top: 0.5, bottom: 0.7, amount: 0 })).toEqual({ top: 0.5, bottom: 0.7 });
    const d = bandToDisplay({ top: 0.5, bottom: 0.7, amount: 1 });
    expect(d.top).toBe(0.5);
    expect(d.bottom).toBeCloseTo(0.73);
  });
  it('displayToBand inverts bandToDisplay', () => {
    for (const b of [
      { top: 0.1, bottom: 0.3, amount: 0.25 },
      { top: 0.55, bottom: 0.85, amount: 1 },
    ]) {
      const d = bandToDisplay(b);
      const back = displayToBand(d.top, d.bottom, b.amount);
      expect(back.top).toBeCloseTo(b.top);
      expect(back.bottom).toBeCloseTo(b.bottom);
      expect(back.amount).toBe(b.amount);
    }
  });
  it('a custom stretch (e.g. a capped one from the field builder) is honoured both ways', () => {
    const capped = () => 1.05;
    const d = bandToDisplay({ top: 0.2, bottom: 0.6, amount: 1 }, capped);
    expect(d.bottom).toBeCloseTo(0.62);
    expect(displayToBand(d.top, d.bottom, 1, capped).bottom).toBeCloseTo(0.6);
  });
  it('edges stay inside the frame and never cross', () => {
    const cur = { top: 0.4, bottom: 0.6 };
    expect(moveEdge('top', -0.2, cur)).toEqual({ top: 0, bottom: 0.6 });
    expect(moveEdge('top', 0.9, cur).top).toBeCloseTo(0.6 - MIN_GAP);
    expect(moveEdge('bottom', 1.4, cur)).toEqual({ top: 0.4, bottom: 1 });
    expect(moveEdge('bottom', 0.1, cur).bottom).toBeCloseTo(0.4 + MIN_GAP);
    // the thinnest band survives setHeightBand (which drops < 2 %)
    const thin = displayToBand(0.4, 0.4 + MIN_GAP, 1);
    expect(setHeightBand(defaultParams(), thin).heightBand).not.toBeNull();
  });
  it('a band pushed past the frame bottom: moving only the top line keeps its lower source edge', () => {
    // hips → ankles near the bottom at full 增高: the stretched lower edge lands below the frame (1.052)
    const band = { top: 0.5, bottom: 0.98, amount: 1 };
    const { model, view } = bandEdges(band, heightBandStretch, null);
    expect(model.bottom).toBeCloseTo(1.052);
    expect(view.bottom).toBe(1); // drawn inside the frame
    // ArrowUp on the top line: the lower edge stays where it is seen (source ≈ 0.979, not ≈ 0.934)
    const up = keyStep('top', -0.01, band, heightBandStretch);
    expect(up.top).toBeCloseTo(0.49);
    expect(up.bottom).toBeCloseTo(0.49 + (1.052 - 0.49) / 1.15, 3);
    // dragging the top line: same
    const dragged = dragEdge('top', 0.45, model, band.amount, heightBandStretch);
    expect(dragged.display.bottom).toBeCloseTo(1.052);
    expect(dragged.band.bottom).toBeCloseTo(0.45 + (1.052 - 0.45) / 1.15, 3);
    // the lower line itself still moves inside the frame
    expect(dragEdge('bottom', 0.95, model, band.amount, heightBandStretch).display.bottom).toBe(0.95);
    // ArrowUp on the lower line steps from its real edge (1.052 → 1.042: source ≈ 0.971), not from the frame
    // bottom where it is drawn (which jumped the source edge to ≈ 0.926)
    expect(keyStep('bottom', -0.01, band, heightBandStretch).bottom).toBeCloseTo(0.5 + 0.542 / 1.15, 3);
  });
  it('a band pushed past the frame bottom: moving the lower line moves its real edge, without a jump', () => {
    // hips → ankles low in the frame: S = 1.15, the lower edge is seen at 1.029 and drawn at 1
    const band = { top: 0.5, bottom: 0.96, amount: 1 };
    const { model, view } = bandEdges(band, heightBandStretch, null);
    expect(model.bottom).toBeCloseTo(1.029);
    expect(view.bottom).toBe(1);
    // ArrowDown ("extend down") must not shrink the band (was 0.935)
    const down = keyStep('bottom', 0.01, band, heightBandStretch);
    expect(down.bottom).toBeGreaterThan(0.96);
    expect(down.bottom).toBeCloseTo(0.5 + 0.539 / 1.15, 3);
    expect(down.top).toBe(0.5);
    // ArrowUp: one display step up, ≈ 0.951 (was 0.926)
    const up = keyStep('bottom', -0.01, band, heightBandStretch);
    expect(up.bottom).toBeLessThan(0.96);
    expect(up.bottom).toBeCloseTo(0.5 + 0.519 / 1.15, 3);
    // a small drag either way moves the source edge a little (was a ≈ 0.03 jump on the first move)
    for (const dy of [-0.005, 0.005]) {
      const d = dragEdge('bottom', model.bottom + dy, model, band.amount, heightBandStretch);
      expect(Math.abs(d.band.bottom - 0.96)).toBeLessThan(0.01);
      expect(Math.sign(d.band.bottom - 0.96)).toBe(Math.sign(dy));
    }
    // no move at all: the band comes back unchanged
    expect(dragEdge('bottom', model.bottom, model, band.amount, heightBandStretch).band.bottom).toBeCloseTo(0.96);
    // dragged far below the frame: the source band ends at the image bottom, no further
    const far = dragEdge('bottom', 1.5, model, band.amount, heightBandStretch);
    expect(far.band.bottom).toBeCloseTo(1);
    expect(far.display.bottom).toBeCloseTo(bandToDisplay({ top: 0.5, bottom: 1, amount: 1 }, heightBandStretch).bottom);
    // and ArrowDown there changes nothing
    expect(keyStep('bottom', 0.01, far.band, heightBandStretch).bottom).toBeCloseTo(1);
  });
  it('a band inside the frame: the lower line edits exactly as before', () => {
    const band = { top: 0.3, bottom: 0.8, amount: 1 };
    const { model, view } = bandEdges(band, heightBandStretch, null);
    expect(model).toEqual(view);
    expect(keyStep('bottom', 0.01, band, heightBandStretch).bottom).toBeCloseTo(displayToBand(0.3, view.bottom + 0.01, 1, heightBandStretch).bottom);
    expect(keyStep('bottom', -0.01, band, heightBandStretch).bottom).toBeCloseTo(displayToBand(0.3, view.bottom - 0.01, 1, heightBandStretch).bottom);
    expect(dragEdge('bottom', 0.9, model, 1, heightBandStretch).display.bottom).toBe(0.9);
    // the frame bottom still bounds a band whose source end is reachable inside it at amount 0
    expect(dragEdge('bottom', 1.4, model, 0, defaultStretch).display.bottom).toBe(1);
  });
});
