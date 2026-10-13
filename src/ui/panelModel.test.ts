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
import type { BeautyParams, EditState, ParamId, RegionStatus, Selection } from '../types';
import { lensFor, NO_BODY_NOTE, NO_FACE_NOTE, P0_INFO, type PersonInfo } from '../edit/lens';
import { editFromLegacy, legacyProjection } from '../edit/legacy';
import { assignPersons, personFromPreset, withPersons } from '../edit/state';
import { heightBandStretch } from '../body/bands';
import { bandEdges, bandToDisplay, defaultStretch, displayToBand, dragEdge, keyStep, MIN_GAP, moveEdge } from './components/HeightBandOverlay';
import { hasIcon } from './icons';
import {
  activate,
  bandOrSuggested,
  bandTouchToast,
  BANDS_NOTE,
  BODY_ERROR_NOTE,
  BODY_NO_MASK_REASON,
  BODY_NONE_NOTE,
  BODY_UNSUPPORTED_NOTE,
  bodyNote,
  bodyNoteFor,
  CAMERA_BODY,
  DEFAULT_BAND,
  INITIAL_SELECTION,
  itemsFor,
  legsAnchorNote,
  partHasValue,
  personNote,
  photoScoped,
  photoTouchToast,
  showsHeightBand,
  sliderEmptyText,
  sliderFor,
  tabHasValue,
  TABS,
  tapToast,
  type BodyContext,
  type PanelSelection,
} from './panelModel';

const sel = (over: Partial<PanelSelection>): PanelSelection => ({ ...INITIAL_SELECTION, ...over });
const byKey = (items: ReturnType<typeof itemsFor>, key: string) => {
  const it = items.find((i) => i.key === key);
  if (!it) throw new Error(`no item ${key}`);
  return it;
};
const lensOfEdit = (e: EditState) => lensFor(e, { kind: 'person', id: 'p0' }, P0_INFO, 'p0');
const lensOf = (p: BeautyParams) => lensOfEdit(editFromLegacy(p));
const proj = (e: EditState) => legacyProjection(e, 'p0');

describe('itemsFor', () => {
  it('skin / shape strips start with ⊘ 原圖 then every param of the group', () => {
    for (const tab of ['skin', 'shape'] as const) {
      const items = itemsFor(lensOf(defaultParams()), sel({ tab }));
      expect(items[0]).toMatchObject({ key: 'reset', label: '原圖' });
      expect(items.slice(1).map((i) => i.key)).toEqual(paramsInGroup(tab).map((d) => d.id));
    }
  });
  it('has-value dots follow hasValue (bidirectional neutral at 0.5)', () => {
    const items = itemsFor(lensOf(defaultParams()), sel({ tab: 'shape' }));
    expect(byKey(items, 'shape.eyeEnlarge').hasValue).toBe(true);
    expect(byKey(items, 'shape.chin').hasValue).toBe(false);
    expect(byKey(items, 'shape.faceNarrow').hasValue).toBe(false);
  });
  it('preset strip shows 自訂 only for custom params', () => {
    const p = defaultParams();
    expect(itemsFor(lensOf(p), sel({ tab: 'preset' })).map((i) => i.label)).toEqual(['原圖', '自然', '精緻', '氣色']);
    const items = itemsFor(lensOf({ ...p, presetId: 'custom' }), sel({ tab: 'preset' }));
    expect(items.at(-1)).toMatchObject({ label: '自訂', selected: true });
  });
  it('filter strip: 無 first, thumbnails for LUTs, selected = current filter', () => {
    const items = itemsFor(lensOf({ ...defaultParams(), filterId: 'warm' }), sel({ tab: 'filter' }));
    expect(items.map((i) => i.key)).toEqual(FILTERS.map((f) => f.id));
    expect(items[0].visual).toEqual({ kind: 'icon', icon: 'none' });
    expect(byKey(items, 'warm')).toMatchObject({ selected: true, visual: { kind: 'thumb', src: '/luts/filters/warm_thumb.png' } });
  });
  it('makeup strip: 無, 原色, then shades; 無 is the selected item while the part is off', () => {
    const items = itemsFor(lensOf(defaultParams()), sel({ tab: 'makeup', makeupPart: 'lip' }));
    expect(items.map((i) => i.key)).toEqual(['reset', 'orig', ...LIP_SHADES.map((s) => s.id)]);
    expect(items.filter((i) => i.selected).map((i) => i.key)).toEqual(['reset']);
  });
  it('makeup strip: after picking a shade exactly that shade is selected, not 無', () => {
    const s = sel({ tab: 'makeup', makeupPart: 'lip' });
    const l = lensOf(defaultParams());
    const shade = LIP_SHADES[0].id;
    const r = activate(byKey(itemsFor(l, s), shade), l, s);
    expect(r.changed).toBe(true);
    expect(itemsFor(lensOfEdit(r.edit), s).filter((i) => i.selected).map((i) => i.key)).toEqual([shade]);
  });
});

describe('activate', () => {
  it('tapping the already-selected makeup 無 is a no-op', () => {
    const l = lensOf(defaultParams());
    const s = sel({ tab: 'makeup', makeupPart: 'lip' });
    const r = activate(itemsFor(l, s)[0], l, s);
    expect(r.changed).toBe(false);
    expect(r.edit).toBe(l.edit);
  });
  it('preset tap applies the preset and keeps 程度 between presets', () => {
    const p = applyPreset('natural', 0.6);
    const s = sel({ tab: 'preset' });
    const r = activate(byKey(itemsFor(lensOf(p), s), 'refined'), lensOf(p), s);
    expect(r.changed).toBe(true);
    expect(proj(r.edit).presetId).toBe('refined');
    expect(proj(r.edit).presetAmount).toBeCloseTo(0.6);
  });
  it('tapping the already-selected preset is a no-op', () => {
    const l = lensOf(defaultParams());
    const s = sel({ tab: 'preset' });
    const r = activate(byKey(itemsFor(l, s), 'natural'), l, s);
    expect(r.changed).toBe(false);
    expect(r.edit).toBe(l.edit);
  });
  it('⊘ resets the group to neutral and marks custom', () => {
    const p = defaultParams();
    const s = sel({ tab: 'skin' });
    const r = activate(itemsFor(lensOf(p), s)[0], lensOf(p), s);
    for (const d of paramsInGroup('skin')) expect(proj(r.edit).values[d.id]).toBe(0);
    expect(proj(r.edit).values['shape.eyeEnlarge']).toBe(p.values['shape.eyeEnlarge']);
    expect(proj(r.edit).presetId).toBe('custom');
  });
  it('makeup ⊘ clears only the current part', () => {
    const p = applyPreset('glow');
    const s = sel({ tab: 'makeup', makeupPart: 'lip' });
    const r = activate(itemsFor(lensOf(p), s)[0], lensOf(p), s);
    expect(proj(r.edit).values['makeup.lip']).toBe(0);
    expect(proj(r.edit).lipShade).toBeNull();
    expect(proj(r.edit).values['makeup.blush']).toBe(p.values['makeup.blush']);
    expect(proj(r.edit).blushShade).toBe(p.blushShade);
  });
  it('param tap only changes the selection', () => {
    const l = lensOf(defaultParams());
    const s = sel({ tab: 'shape' });
    const r = activate(byKey(itemsFor(l, s), 'shape.chin'), l, s);
    expect(r.edit).toBe(l.edit);
    expect(r.sel.shape).toBe('shape.chin');
  });
  it('picking a shade from 0 applies the pick default intensity', () => {
    const p = defaultParams();
    const s = sel({ tab: 'makeup', makeupPart: 'blush' });
    const r = activate(byKey(itemsFor(lensOf(p), s), 'peach'), lensOf(p), s);
    expect(proj(r.edit).blushShade).toBe('peach');
    expect(proj(r.edit).values['makeup.blush']).toBe(MAKEUP_PICK_DEFAULT.blush);
    expect(byKey(itemsFor(lensOfEdit(r.edit), s), 'peach').selected).toBe(true);
  });
  it('filter pick sets the filter default amount', () => {
    const p = defaultParams();
    const s = sel({ tab: 'filter' });
    const r = activate(byKey(itemsFor(lensOf(p), s), 'mono'), lensOf(p), s);
    expect(proj(r.edit).filterId).toBe('mono');
    expect(proj(r.edit).values['filter.amount']).toBe(1);
  });
});

describe('sliderFor', () => {
  it('程度 for presets, none for 原圖 / 自訂', () => {
    expect(sliderFor(lensOf(applyPreset('glow', 0.7)), sel({ tab: 'preset' }))).toMatchObject({ label: '程度', value: 0.7, defaultValue: 1 });
    expect(sliderFor(lensOf(applyPreset('original')), sel({ tab: 'preset' }))).toBeNull();
    expect(sliderFor(lensOf({ ...defaultParams(), presetId: 'custom' }), sel({ tab: 'preset' }))).toBeNull();
  });
  it('param slider writes through setParam (→ custom) and knows bidirectionality', () => {
    const p = defaultParams();
    const b = sliderFor(lensOf(p), sel({ tab: 'shape', shape: 'shape.chin' }))!;
    expect(b).toMatchObject({ label: '下巴', bidirectional: true, value: 0.5, defaultValue: 0.5 });
    const next = proj(b.apply(lensOf(p), 0.7));
    expect(next.values['shape.chin']).toBe(0.7);
    expect(next.presetId).toBe('custom');
  });
  it('filter slider only with a filter; makeup slider always present', () => {
    expect(sliderFor(lensOf(defaultParams()), sel({ tab: 'filter' }))).toBeNull();
    expect(sliderFor(lensOf({ ...defaultParams(), filterId: 'soft' }), sel({ tab: 'filter' }))).toMatchObject({ label: '濾鏡強度', defaultValue: 0.5 });
    expect(sliderFor(lensOf(defaultParams()), sel({ tab: 'makeup', makeupPart: 'lip' }))).toMatchObject({ label: '口紅', value: 0 });
  });
  it('preset 程度 slider scales distance from neutral', () => {
    const p = applyPreset('refined', 1);
    const b = sliderFor(lensOf(p), sel({ tab: 'preset' }))!;
    const half = proj(b.apply(lensOf(p), 0.5));
    expect(half.values['skin.smooth']).toBeCloseTo(0.35);
    expect(half.values['shape.chin']).toBeCloseTo(0.45);
  });
});

describe('tabHasValue', () => {
  it('reflects group state', () => {
    const p = defaultParams();
    expect(tabHasValue(lensOf(p), 'skin')).toBe(true);
    expect(tabHasValue(lensOf(p), 'filter')).toBe(false);
    expect(tabHasValue(lensOf(p), 'makeup')).toBe(false);
    expect(tabHasValue(lensOf(applyPreset('glow')), 'makeup')).toBe(true);
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
  it('sits after 美型: 一鍵 · 美膚 · 美型 · 美體 · 濾鏡 · 美妝 · 調節', () => {
    expect(TABS.map((t) => t.label)).toEqual(['一鍵', '美膚', '美型', '美體', '濾鏡', '美妝', '調節']);
  });
  it('strip: ⊘ 原圖 · 增高 · the 10 sliders in schema order · 背景保護', () => {
    const items = itemsFor(lensOf(defaultParams()), bodySel(), ready());
    expect(items.map((i) => i.key)).toEqual(['reset', 'height', ...paramsInGroup('body').map((d) => d.id), 'protect']);
    expect(items.map((i) => i.label).slice(2, 12)).toEqual(['長腿', '瘦身', '細腰', '腰臀比', '美臀', '瘦腿', '瘦手臂', '直角肩', '天鵝頸', '小頭']);
    expect(byKey(items, 'protect')).toMatchObject({ pressed: true, disabled: false });
  });
  it('every body item has its own icon', () => {
    for (const it of itemsFor(lensOf(defaultParams()), bodySel(), ready())) {
      if (it.visual.kind === 'icon') expect(hasIcon(it.visual.icon), it.visual.icon).toBe(true);
    }
    expect(hasIcon('protectOff')).toBe(true);
  });
  it('gated sliders are disabled with their reason and never selected; the rest stay enabled', () => {
    const items = itemsFor(lensOf(defaultParams()), bodySel('body.legs'), ready());
    expect(byKey(items, 'body.legs')).toMatchObject({ disabled: true, reason: LEGS_REASON, selected: false });
    expect(byKey(items, 'body.waist')).toMatchObject({ disabled: false, reason: null });
    expect(byKey(items, 'height').disabled).toBe(false);
  });
  it('tapping a disabled item only explains why', () => {
    const l = lensOf(defaultParams());
    const s = bodySel('body.waist');
    const r = activate(byKey(itemsFor(l, s, ready()), 'body.legSlim'), l, s);
    expect(r).toMatchObject({ changed: false, notice: LEGS_REASON });
    expect(r.edit).toBe(l.edit);
    expect(r.sel).toBe(s);
  });
  it('while idle / loading / none / error only 原圖 · 增高 · 背景保護 work', () => {
    for (const status of ['idle', 'loading', 'none', 'error'] as const) {
      const items = itemsFor(lensOf(defaultParams()), bodySel(), { ...ready(), status, progress: 0.4 });
      expect(items.filter((i) => !i.disabled).map((i) => i.key), status).toEqual(['reset', 'height', 'protect']);
      expect(items.every((i) => !i.disabled || !!i.reason)).toBe(true);
      expect(sliderFor(lensOf(defaultParams()), bodySel('body.slim'), { ...ready(), status })).toBeNull();
    }
  });
  it('without a context the tab waits (idle) instead of pretending everything is available', () => {
    expect(byKey(itemsFor(lensOf(defaultParams()), bodySel()), 'body.slim').disabled).toBe(true);
    expect(sliderFor(lensOf(defaultParams()), bodySel('body.slim'))).toBeNull();
  });
  it('camera: everything off with the photo-only note, no slider, no tab dot, no band', () => {
    const p = setParam(defaultParams(), 'body.slim', 0.6);
    const items = itemsFor(lensOf(p), bodySel('height'), CAMERA_BODY);
    expect(items.every((i) => i.disabled && i.reason === BODY_UNSUPPORTED_NOTE)).toBe(true);
    expect(sliderFor(lensOf(p), bodySel('height'), CAMERA_BODY)).toBeNull();
    expect(tabHasValue(lensOf(p), 'body', CAMERA_BODY)).toBe(false);
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
    expect(bodyNote(ready({ people: 2 }))).toBeNull();
  });
  it('body slider writes the value and keeps the active preset (美體 is outside presets)', () => {
    const p = defaultParams();
    const b = sliderFor(lensOf(p), bodySel('body.waist'), ready())!;
    expect(b).toMatchObject({ key: 'body.waist', label: '細腰', bidirectional: false, value: 0, defaultValue: 0 });
    const next = proj(b.apply(lensOf(p), 0.6));
    expect(next.values['body.waist']).toBe(0.6);
    expect(next.presetId).toBe('natural');
  });
  it('美臀 is centre-zero', () => {
    const b = sliderFor(lensOf(defaultParams()), bodySel('body.hip'), ready())!;
    expect(b).toMatchObject({ bidirectional: true, value: 0.5, defaultValue: 0.5 });
  });
  it('增高: selecting the tool shows the band; its slider creates the band at the suggested place', () => {
    const p = defaultParams();
    const s = bodySel('body.slim');
    const l = lensOf(p);
    const r = activate(byKey(itemsFor(l, s, ready()), 'height'), l, s);
    expect(r.sel.body).toBe('height');
    expect(r.edit).toBe(l.edit);
    expect(showsHeightBand(r.sel, ready())).toBe(true);
    const ctx = ready({ suggestedBand: { top: 0.5, bottom: 0.9 } });
    const b = sliderFor(lensOf(p), r.sel, ctx)!;
    expect(b).toMatchObject({ key: 'body.height', label: '增高', value: 0 });
    expect(proj(b.apply(lensOf(p), 0.4)).heightBand).toEqual({ top: 0.5, bottom: 0.9, amount: 0.4 });
    // an existing band keeps its position
    const placed = setHeightBand(p, { top: 0.2, bottom: 0.4, amount: 0.1 });
    expect(sliderFor(lensOf(placed), r.sel, ctx)!.value).toBe(0.1);
    expect(proj(sliderFor(lensOf(placed), r.sel, ctx)!.apply(lensOf(placed), 0.7)).heightBand).toEqual({ top: 0.2, bottom: 0.4, amount: 0.7 });
  });
  it('增高 works with no person detected', () => {
    const none: BodyContext = { ...ready(), status: 'none' };
    expect(sliderFor(lensOf(defaultParams()), bodySel('height'), none)).not.toBeNull();
    expect(bandOrSuggested(editFromLegacy(defaultParams()), none)).toEqual({ ...DEFAULT_BAND, amount: 0 });
  });
  it('背景保護 toggles with an explanatory notice', () => {
    const p = defaultParams();
    const s = bodySel();
    const off = activate(byKey(itemsFor(lensOf(p), s, ready()), 'protect'), lensOf(p), s);
    expect(off.changed).toBe(true);
    expect(proj(off.edit).bodyProtect).toBe(false);
    // the measured trade only: a wider, gentler background deformation (no "smoother outline", no straight-line promise)
    expect(off.notice).toBe('背景保護已關閉：背景變形範圍較大但較平緩');
    expect(activate(byKey(itemsFor(lensOfEdit(off.edit), s, ready()), 'protect'), lensOfEdit(off.edit), s).notice).toBe('背景保護已開啟：背景變形範圍較小');
    const item = byKey(itemsFor(lensOfEdit(off.edit), s, ready()), 'protect');
    expect(item).toMatchObject({ pressed: false, visual: { kind: 'icon', icon: 'protectOff' } });
    expect(proj(activate(item, lensOfEdit(off.edit), s).edit).bodyProtect).toBe(true);
  });
  it('背景保護 is off (with the reason) when the detection has no person mask, instead of a silent no-op', () => {
    const p = defaultParams();
    const s = bodySel();
    const noMask = ready({ hasMask: false });
    const item = byKey(itemsFor(lensOf(p), s, noMask), 'protect');
    expect(item).toMatchObject({ disabled: true, reason: BODY_NO_MASK_REASON });
    expect(BODY_NO_MASK_REASON).toBe('無法取得人像輪廓，背景保護暫不可用');
    const r = activate(item, lensOf(p), s);
    expect(r).toMatchObject({ changed: false, notice: BODY_NO_MASK_REASON });
    expect(proj(r.edit).bodyProtect).toBe(p.bodyProtect);
    // the other items are unaffected
    expect(byKey(itemsFor(lensOf(p), s, noMask), 'height').disabled).toBe(false);
    expect(byKey(itemsFor(lensOf(p), s, noMask), 'reset').disabled).toBe(false);
    expect(byKey(itemsFor(lensOf(p), s, noMask), 'body.waist').disabled).toBe(false);
    // a mask, or nothing said about it (assume yes), keeps it on; so do the statuses before a detection exists
    expect(byKey(itemsFor(lensOf(p), s, ready({ hasMask: true })), 'protect').disabled).toBe(false);
    expect(byKey(itemsFor(lensOf(p), s, ready()), 'protect').disabled).toBe(false);
    for (const status of ['idle', 'loading', 'none', 'error'] as const) {
      expect(byKey(itemsFor(lensOf(p), s, { ...noMask, status }), 'protect').disabled, status).toBe(false);
    }
  });
  it('the bands note replaces the multi-person hint (P6, S §2.6)', () => {
    expect(BANDS_NOTE).toBe('增高、長腿會拉伸整排畫面，套用於整張照片');
  });
  it('⊘ resets the body sliders and the band, keeps the preset, and is a no-op when already neutral', () => {
    const p = setHeightBand(setParam(defaultParams(), 'body.hip', 0.8), { top: 0.5, bottom: 0.8, amount: 0.5 });
    const s = bodySel();
    const r = activate(itemsFor(lensOf(p), s, ready())[0], lensOf(p), s);
    expect(proj(r.edit).values['body.hip']).toBe(0.5);
    expect(proj(r.edit).heightBand).toBeNull();
    expect(proj(r.edit).presetId).toBe('natural');
    expect(proj(r.edit).values['skin.smooth']).toBe(p.values['skin.smooth']);
    const again = activate(itemsFor(lensOfEdit(r.edit), s, ready())[0], lensOfEdit(r.edit), s);
    expect(again.changed).toBe(false);
  });
  it('tab dot: a body slider or a band with an amount', () => {
    const p = defaultParams();
    expect(tabHasValue(lensOf(p), 'body')).toBe(false);
    expect(tabHasValue(lensOf(setParam(p, 'body.hip', 0.3)), 'body')).toBe(true);
    expect(tabHasValue(lensOf(setHeightBand(p, { top: 0.4, bottom: 0.8, amount: 0 })), 'body')).toBe(false);
    expect(tabHasValue(lensOf(setHeightBand(p, { top: 0.4, bottom: 0.8, amount: 0.3 })), 'body')).toBe(true);
  });
  it('picking a 一鍵 preset keeps the body edits', () => {
    const p = {
      ...setHeightBand(setParam(defaultParams(), 'body.waist', 0.7), { top: 0.5, bottom: 0.8, amount: 0.5 }),
      bodyProtect: false,
    };
    const s = sel({ tab: 'preset' });
    const r = activate(byKey(itemsFor(lensOf(p), s), 'glow'), lensOf(p), s);
    expect(proj(r.edit).presetId).toBe('glow');
    expect(proj(r.edit).values['body.waist']).toBe(0.7);
    expect(proj(r.edit).heightBand).toEqual({ top: 0.5, bottom: 0.8, amount: 0.5 });
    expect(proj(r.edit).bodyProtect).toBe(false);
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

describe('persons in the panel (S §2.4, A9, A11)', () => {
  // person 1: face + body · person 2: face only · person 3: body only
  const persons: PersonInfo[] = [
    { id: 'f0', face: true, body: true },
    { id: 'f1', face: true, body: false },
    { id: 'b1', face: false, body: true },
  ];
  const base = assignPersons(editFromLegacy(defaultParams()), ['f0', 'f1', 'b1'], 'f0');
  const at = (sel: Selection, e: EditState = base) => lensFor(e, sel, persons, 'f0');
  const one = (id: 'f0' | 'f1' | 'b1') => at({ kind: 'person', id });
  const ALL: Selection = { kind: 'all' };

  it('a body-only person: 磨皮 / 紅潤 disabled per item with the no-face reason; 美白 / 銳化 usable, badged 整張', () => {
    const items = itemsFor(one('b1'), sel({ tab: 'skin' }));
    expect(byKey(items, 'skin.smooth')).toMatchObject({ disabled: true, reason: NO_FACE_NOTE });
    expect(byKey(items, 'skin.rosy')).toMatchObject({ disabled: true, reason: NO_FACE_NOTE });
    expect(byKey(items, 'skin.whiten')).toMatchObject({ disabled: false, badge: '整張' });
    expect(byKey(items, 'skin.sharpen')).toMatchObject({ disabled: false, badge: '整張' });
    expect(personNote('skin', one('b1'))).toEqual({ text: NO_FACE_NOTE, dim: false });
    expect(personNote('preset', one('b1'))).toEqual({ text: NO_FACE_NOTE, dim: false });
    expect(personNote('shape', one('b1'))).toEqual({ text: NO_FACE_NOTE, dim: true });
    expect(personNote('makeup', one('b1'))).toEqual({ text: NO_FACE_NOTE, dim: true });
    expect(personNote('shape', at(ALL))).toBeNull();
    expect(personNote('shape', one('f1'))).toBeNull();
  });
  it('one person: no badges, no person notes, v0.3 labels and keys', () => {
    const l = lensFor(editFromLegacy(defaultParams()), { kind: 'person', id: 'p0' }, P0_INFO, 'p0');
    expect(byKey(itemsFor(l, sel({ tab: 'skin' })), 'skin.whiten').badge).toBeUndefined();
    expect(personNote('shape', l)).toBeNull();
    const b = sliderFor(l, sel({ tab: 'skin', skin: 'skin.whiten' }))!;
    expect(b).toMatchObject({ key: 'skin.whiten', label: '美白' });
    expect(b.aria).toBeUndefined();
  });
  it('美體 note order: status, then the selected person without a body, then the bands / 長腿 anchor note', () => {
    const ctx = { ...ready({ people: 2 }), legsAnchor: 'b1' };
    expect(bodyNoteFor({ ...ctx, status: 'loading' }, one('f1'), bodySel('body.waist'))?.text).toBe('正在偵測人物…');
    expect(bodyNoteFor(ctx, one('f1'), bodySel('body.waist'))?.text).toBe(NO_BODY_NOTE);
    expect(bodyNoteFor(ctx, at(ALL), bodySel('body.waist'))).toBeNull();
    expect(bodyNoteFor(ctx, one('f0'), bodySel('height'))?.text).toBe(BANDS_NOTE);
    expect(bodyNoteFor(ctx, at(ALL), bodySel('body.legs'))?.text).toBe(legsAnchorNote(3));
    expect(legsAnchorNote(3)).toBe('長腿以人物 3 的腿長為準，套用於整張照片');
    expect(bodyNoteFor(ctx, one('f0'), bodySel('body.waist'))).toBeNull();
  });
  it('body items under ≥ 2 persons are gated per person (the lens), 增高 / 長腿 / 背景保護 badged 整張', () => {
    const items = itemsFor(one('f1'), bodySel('body.waist'), ready({ people: 2 }));
    expect(byKey(items, 'body.waist')).toMatchObject({ disabled: true, reason: NO_BODY_NOTE });
    expect(byKey(items, 'height').badge).toBe('整張');
    expect(byKey(items, 'body.legs').badge).toBe('整張');
    expect(byKey(items, 'protect').badge).toBe('整張');
    expect(byKey(itemsFor(at(ALL), bodySel('body.waist'), ready({ people: 2 })), 'body.waist').disabled).toBe(false);
  });
  it('slider identity and labels (S §2.4): key per selection, 人物 n / 全部 / 整張照片, mixed by display value', () => {
    const b = sliderFor(one('f1'), sel({ tab: 'shape', shape: 'shape.eyeEnlarge' }))!;
    expect(b).toMatchObject({ key: 'f1:shape.eyeEnlarge', label: '大眼', aria: '大眼，人物 2' });
    expect(sliderFor(at(ALL), sel({ tab: 'shape', shape: 'shape.eyeEnlarge' }))!.aria).toBe('大眼，全部');
    const w = sliderFor(one('f1'), sel({ tab: 'skin', skin: 'skin.whiten' }))!;
    expect(w).toMatchObject({ label: '美白 · 整張照片', aria: '美白，整張照片' });
    const near = withPersons(withPersons(base, ['f0'], (p) => ({ ...p, values: { ...p.values, 'shape.eyeEnlarge': 0.3451 } })), ['f1'], (p) => ({ ...p, values: { ...p.values, 'shape.eyeEnlarge': 0.3549 } }));
    expect(sliderFor(at(ALL, near), sel({ tab: 'shape', shape: 'shape.eyeEnlarge' }))!.mixed).toBe(false);
    const far = withPersons(near, ['f1'], (p) => ({ ...p, values: { ...p.values, 'shape.eyeEnlarge': 0.4 } }));
    expect(sliderFor(at(ALL, far), sel({ tab: 'shape', shape: 'shape.eyeEnlarge' }))!.mixed).toBe(true);
  });
  it('程度 under 全部 with different presets: no slider, the row says 各人不同', () => {
    // base: f0 holds p0 (自然), f1 and b1 the template (原圖): the face persons already differ
    const same = withPersons(base, ['f1', 'b1'], () => personFromPreset('natural', 1));
    const mixed = withPersons(same, ['f1'], () => personFromPreset('refined', 1));
    expect(sliderFor(at(ALL, mixed), sel({ tab: 'preset' }))).toBeNull();
    expect(sliderEmptyText(at(ALL, mixed), sel({ tab: 'preset' }))).toBe('各人不同');
    expect(sliderEmptyText(at(ALL, same), sel({ tab: 'preset' }))).toBeNull();
    expect(sliderFor(at(ALL, same), sel({ tab: 'preset' }))).toMatchObject({ label: '程度', value: 1 });
  });
  it('no dead slider: an item the selected person cannot use has no slider; photo items keep theirs (Review Focus #2)', () => {
    expect(sliderFor(one('b1'), sel({ tab: 'skin', skin: 'skin.smooth' }))).toBeNull(); // 美膚 opens on 磨皮
    expect(sliderFor(one('b1'), sel({ tab: 'shape', shape: 'shape.eyeEnlarge' }))).toBeNull();
    expect(sliderFor(one('b1'), sel({ tab: 'makeup', makeupPart: 'lip' }))).toBeNull();
    expect(sliderFor(one('f1'), bodySel('body.waist'), ready({ people: 2 }))).toBeNull();
    expect(sliderFor(one('b1'), sel({ tab: 'skin', skin: 'skin.whiten' }))).not.toBeNull();
    expect(sliderFor(one('f1'), bodySel('height'), ready({ people: 2 }))).not.toBeNull();
    expect(sliderFor(at(ALL), sel({ tab: 'skin', skin: 'skin.smooth' }))).not.toBeNull();
  });
  it('no dead item under 全部: a body item available for another person than the shown measure keeps its slider (S §2.4)', () => {
    // the context reads the primary's measure (瘦腿 off there, as in ready()); b1's measure has it
    const ctx = ready({ people: 2 });
    const measured = (s: Selection) => lensFor(base, s, persons, 'f0', { available: (p, id) => p !== 'f0' || id !== 'body.legSlim' });
    const f0: Selection = { kind: 'person', id: 'f0' };
    expect(byKey(itemsFor(measured(ALL), bodySel('body.legSlim'), ctx), 'body.legSlim').disabled).toBe(false);
    expect(sliderFor(measured(ALL), bodySel('body.legSlim'), ctx)).not.toBeNull();
    expect(byKey(itemsFor(measured(f0), bodySel('body.legSlim'), ctx), 'body.legSlim').disabled).toBe(true);
    expect(sliderFor(measured(f0), bodySel('body.legSlim'), ctx)).toBeNull();
  });
  it('a body item no body can use reads the measure reason, not the no-body note (a half-body group shot)', () => {
    // f0 and b1 have bodies, neither full-body: 瘦腿 is off for both; f1 has no body at all
    const ctx = ready({ people: 2 });
    const halfBody = (s: Selection) => lensFor(base, s, persons, 'f0', { available: (_p, id) => id !== 'body.legSlim' });
    const f0: Selection = { kind: 'person', id: 'f0' };
    const f1: Selection = { kind: 'person', id: 'f1' };
    expect(byKey(itemsFor(halfBody(ALL), bodySel('body.waist'), ctx), 'body.legSlim')).toMatchObject({ disabled: true, reason: LEGS_REASON });
    expect(byKey(itemsFor(halfBody(f0), bodySel('body.waist'), ctx), 'body.legSlim')).toMatchObject({ disabled: true, reason: LEGS_REASON });
    expect(byKey(itemsFor(halfBody(f1), bodySel('body.waist'), ctx), 'body.legSlim')).toMatchObject({ disabled: true, reason: NO_BODY_NOTE });
    // the tap toast says the same
    const s = bodySel('body.waist');
    expect(activate(byKey(itemsFor(halfBody(ALL), s, ctx), 'body.legSlim'), halfBody(ALL), s).notice).toBe(LEGS_REASON);
    // the measure allows it but this person's own measure does not: the lens's generic reason stays
    const others = lensFor(base, f0, persons, 'f0', { available: (p, id) => p !== 'f0' || id !== 'body.waist' });
    expect(byKey(itemsFor(others, s, ctx), 'body.waist')).toMatchObject({ disabled: true, reason: '此照片無法使用這個效果' });
  });
  it('a photo without a face (two body persons): 磨皮 / 紅潤 act on all skin and read 「整張照片」 (S §2.4 美膚)', () => {
    const bodies: PersonInfo[] = [
      { id: 'b0', face: false, body: true },
      { id: 'b1', face: false, body: true },
    ];
    const e = assignPersons(editFromLegacy(defaultParams()), ['b0', 'b1'], 'b0');
    const l = lensFor(e, { kind: 'person', id: 'b1' }, bodies, 'b0');
    expect(sliderFor(l, sel({ tab: 'skin', skin: 'skin.smooth' }))).toMatchObject({ label: '磨皮 · 整張照片', aria: '磨皮，整張照片' });
    expect(byKey(itemsFor(l, sel({ tab: 'skin' })), 'skin.rosy')).toMatchObject({ disabled: false, badge: '整張' });
    // no person note: 美膚 / 一鍵 stay usable on all skin; 美型 / 美妝 keep the Editor's photo-level note
    for (const tab of ['skin', 'preset', 'shape', 'makeup'] as const) expect(personNote(tab, l)).toBeNull();
  });
  it('A11: the chips dim on 濾鏡 and while 美白 / 銳化 / 增高 / 長腿 is the active item', () => {
    const l = one('f1');
    expect(photoScoped(sel({ tab: 'filter' }), l)).toBe(true);
    expect(photoScoped(sel({ tab: 'skin', skin: 'skin.whiten' }), l)).toBe(true);
    expect(photoScoped(sel({ tab: 'skin', skin: 'skin.smooth' }), l)).toBe(false);
    expect(photoScoped(bodySel('height'), l)).toBe(true);
    expect(photoScoped(bodySel('body.legs'), l)).toBe(true);
    expect(photoScoped(bodySel('body.waist'), l)).toBe(false);
  });
  it('A11 in a photo without a face: 磨皮 / 紅潤 act on all skin whoever is selected (「整張照片」), so the chips dim there too', () => {
    const bodies: PersonInfo[] = [
      { id: 'b0', face: false, body: true },
      { id: 'b1', face: false, body: true },
    ];
    const l = lensFor(assignPersons(editFromLegacy(defaultParams()), ['b0', 'b1'], 'b0'), { kind: 'person', id: 'b1' }, bodies, 'b0');
    expect(photoScoped(sel({ tab: 'skin', skin: 'skin.smooth' }), l)).toBe(true);
    expect(photoScoped(sel({ tab: 'skin', skin: 'skin.rosy' }), l)).toBe(true);
    // the chips still pick whose local 美體 items move
    expect(photoScoped(bodySel('body.waist'), l)).toBe(false);
  });
  it('the first touch of each photo-level item says so once; person items and one person never', () => {
    const seen = new Set<string>();
    const w = sliderFor(one('f1'), sel({ tab: 'skin', skin: 'skin.whiten' }))!;
    expect(photoTouchToast(w, one('f1'), seen)).toBe('美白套用於整張照片');
    expect(photoTouchToast(w, one('f1'), seen)).toBeNull();
    expect(photoTouchToast(sliderFor(one('f1'), sel({ tab: 'skin', skin: 'skin.smooth' }))!, one('f1'), seen)).toBeNull();
    const h = sliderFor(one('f0'), bodySel('height'), ready({ people: 2 }))!;
    expect(photoTouchToast(h, one('f0'), seen)).toBe('增高套用於整張照片');
    const solo = lensFor(editFromLegacy(defaultParams()), { kind: 'person', id: 'p0' }, P0_INFO, 'p0');
    expect(photoTouchToast(sliderFor(solo, sel({ tab: 'skin', skin: 'skin.whiten' }))!, solo, new Set())).toBeNull();
  });
  it('the first tap of a photo-level tile (a 濾鏡 tile, 背景保護) says so once, before its own notice (S §2.4)', () => {
    const seen = new Set<string>();
    const tap = (l: ReturnType<typeof at>, s: PanelSelection, key: string, ctx?: BodyContext) => {
      const item = byKey(itemsFor(l, s, ctx), key);
      return tapToast(item, l, activate(item, l, s), seen);
    };
    const f = sel({ tab: 'filter' });
    // a no-op tap (the current filter, 無) touches nothing
    expect(tap(one('f1'), f, 'none')).toBeNull();
    expect(tap(one('f1'), f, 'warm')).toBe('濾鏡套用於整張照片');
    // every 濾鏡 tile is the one item 濾鏡; its strength slider is an item of its own
    expect(tap(at(ALL), f, 'cool')).toBeNull();
    const warm = { ...base, photo: { ...base.photo, filterId: 'warm' } };
    const w = at({ kind: 'person', id: 'f1' }, warm);
    expect(photoTouchToast(sliderFor(w, f)!, w, seen)).toBe('濾鏡強度套用於整張照片');
    // 背景保護: the toggle's own notice follows on a second line, then the notice alone
    const b = bodySel('body.waist');
    expect(tap(one('f0'), b, 'protect', ready({ people: 2 }))).toBe('背景保護套用於整張照片\n背景保護已關閉：背景變形範圍較大但較平緩');
    expect(tap(one('f0'), b, 'protect', ready({ people: 2 }))).toBe('背景保護已關閉：背景變形範圍較大但較平緩');
    // a disabled tile only gives its reason; a person tile (磨皮 selects its slider) and one person never say it
    const fresh = new Set<string>();
    const off = byKey(itemsFor(one('f0'), b, ready({ people: 2, hasMask: false })), 'protect');
    expect(tapToast(off, one('f0'), activate(off, one('f0'), b), fresh)).toBe(BODY_NO_MASK_REASON);
    const smooth = byKey(itemsFor(one('f0'), sel({ tab: 'skin' })), 'skin.smooth');
    expect(tapToast(smooth, one('f0'), activate(smooth, one('f0'), sel({ tab: 'skin', skin: 'skin.whiten' })), fresh)).toBeNull();
    const solo = lensFor(editFromLegacy(defaultParams()), { kind: 'person', id: 'p0' }, P0_INFO, 'p0');
    const warmTile = byKey(itemsFor(solo, f), 'warm');
    expect(tapToast(warmTile, solo, activate(warmTile, solo, f), fresh)).toBeNull();
    expect(fresh.size).toBe(0);
    // the camera passes no set: the tile's own notice only
    const p = byKey(itemsFor(one('f0'), b, ready({ people: 2 })), 'protect');
    expect(tapToast(p, one('f0'), activate(p, one('f0'), b))).toBe('背景保護已關閉：背景變形範圍較大但較平緩');
  });
  it('dragging the 增高 band is a first touch of 增高 too, shared with its slider (S §2.4)', () => {
    const seen = new Set<string>();
    expect(bandTouchToast(one('f0'), seen)).toBe('增高套用於整張照片');
    expect(bandTouchToast(one('f0'), seen)).toBeNull();
    expect(photoTouchToast(sliderFor(one('f0'), bodySel('height'), ready({ people: 2 }))!, one('f0'), seen)).toBeNull();
    const solo = lensFor(editFromLegacy(defaultParams()), { kind: 'person', id: 'p0' }, P0_INFO, 'p0');
    expect(bandTouchToast(solo, new Set())).toBeNull();
  });
  it('item dots (S §2.4 Dots): the selected person\'s value; under 全部 any applicable person\'s, not only the shown one', () => {
    const setV = (e: EditState, id: 'f0' | 'f1' | 'b1', k: 'shape.eyeEnlarge' | 'makeup.lip' | 'body.waist', v: number) =>
      withPersons(e, [id], (p) => ({ ...p, values: { ...p.values, [k]: v } }));
    // the primary f0 is shown under 全部; only f1 has 大眼 and 口紅, only b1 has 腰
    let e = setV(setV(base, 'f0', 'shape.eyeEnlarge', 0), 'f1', 'shape.eyeEnlarge', 0.6);
    e = setV(setV(e, 'f0', 'makeup.lip', 0), 'f1', 'makeup.lip', 0.6);
    e = setV(setV(e, 'f0', 'body.waist', 0), 'b1', 'body.waist', 0.6);
    const shape = sel({ tab: 'shape', shape: 'shape.eyeEnlarge' });
    const dot = (s: Selection) => byKey(itemsFor(at(s, e), shape), 'shape.eyeEnlarge').hasValue;
    expect(tabHasValue(at(ALL, e), 'shape')).toBe(true);
    expect(dot(ALL)).toBe(true);
    expect(dot({ kind: 'person', id: 'f0' })).toBe(false);
    expect(dot({ kind: 'person', id: 'f1' })).toBe(true);
    expect(partHasValue(at(ALL, e), 'lip')).toBe(true);
    expect(partHasValue(at({ kind: 'person', id: 'f0' }, e), 'lip')).toBe(false);
    expect(partHasValue(at({ kind: 'person', id: 'f1' }, e), 'lip')).toBe(true);
    const ctx = ready({ people: 2 });
    const waist = (s: Selection) => byKey(itemsFor(at(s, e), bodySel('body.waist'), ctx), 'body.waist').hasValue;
    expect(waist(ALL)).toBe(true);
    expect(waist({ kind: 'person', id: 'f0' })).toBe(false);
    expect(waist({ kind: 'person', id: 'b1' })).toBe(true);
  });
});
