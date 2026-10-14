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
  SHADES,
} from '../engine/params';
import type { BeautyParams, EditState, ParamId, PersonParams, RegionStatus, Selection } from '../types';
import { lensFor, NO_BODY_NOTE, NO_FACE_NOTE, P0_INFO, type PersonInfo } from '../edit/lens';
import { editFromLegacy, legacyProjection } from '../edit/legacy';
import { assignPersons, defaultPhoto, emptyShades, naturalPerson, neutralPerson, personFromPreset, withPersons } from '../edit/state';
import { TONE_COPY } from '../edit/toneCopy';
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
  clearArmKey,
  clearLabel,
  clearTap,
  CLEAR_CONFIRM_MS,
  decorateShapeItems,
  DEFAULT_BAND,
  EDITOR_TABS,
  effectiveShade,
  faceAnswer,
  INITIAL_SELECTION,
  itemsFor,
  legsAnchorNote,
  MAKEUP_PARTS,
  makeupAction,
  makeupLeadItem,
  makeupNote,
  makeupPartItems,
  makeupShadeItems,
  partHasValue,
  personNote,
  photoScoped,
  photoTouchToast,
  rememberable,
  selectTab,
  showsHeightBand,
  showsSpotMode,
  skinNote,
  skinToolGate,
  sliderEmptyText,
  shapeHasValue,
  sliderFor,
  SPLIT_BADGE,
  SPLIT_ON_NOTICE,
  splitJointNotice,
  splitToggle,
  spotItem,
  spotsOnTab,
  spotTapInside,
  tabHasValue,
  TABS,
  tapToast,
  toneItems,
  WARM_ENDS,
  withSides,
  type BodyContext,
  type PanelItem,
  type PanelSelection,
  type SkinPanelContext,
  type SliderBinding,
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
      expect(items.slice(1).map((i) => i.key)).toEqual([...paramsInGroup(tab).map((d) => d.id), ...(tab === 'shape' ? ['split'] : [])]);
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
  it('裁切 is photo-level with ≥ 2 persons: the chips dim, and a body-only person gets no person note (S §2.1)', () => {
    expect(photoScoped(sel({ tab: 'crop' }), one('f1'))).toBe(true);
    expect(personNote('crop', one('b1'))).toBeNull();
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

describe('裁切 tab (v0.4 step 3)', () => {
  it('裁切 is the 8th editor tab; the shared (camera) tab list keeps 7; its selection starts at 自由', () => {
    expect(EDITOR_TABS.map((t) => t.label).at(-1)).toBe('裁切');
    expect(EDITOR_TABS).toHaveLength(8);
    expect(EDITOR_TABS.slice(0, -1)).toEqual(TABS);
    expect(TABS.some((t) => t.id === 'crop')).toBe(false);
    expect(INITIAL_SELECTION.crop).toBe('free');
  });

  it('裁切 is photo-level: the person strip dims with 整張照片, no person note (S §2.1, C §2.2)', () => {
    const l = lensOf(defaultParams());
    expect(photoScoped(sel({ tab: 'crop' }), l)).toBe(true);
    expect(personNote('crop', l)).toBeNull();
  });
});

describe('step 4: 膚質 items (skin-cleanup spec §2.1, §2.2, §3.6)', () => {
  const persons = [
    { id: 'f0', face: true, body: false },
    { id: 'b0', face: false, body: true },
  ];
  const edit = (values: Record<string, number> = {}) => ({
    v: 2 as const,
    photo: { ...defaultPhoto(), spots: [] },
    persons: { f0: { ...neutralPerson(), values: { ...neutralPerson().values, ...values } }, b0: neutralPerson() },
    template: neutralPerson(),
    primaryInit: null,
  });
  const lens = (values: Record<string, number> = {}, who = 'f0') => lensFor(edit(values), { kind: 'person', id: who }, persons, 'f0');
  const skin = (answer: SkinPanelContext['answer'] = 'faces', extra: Partial<SkinPanelContext> = {}): SkinPanelContext => ({
    answer,
    mouthClosed: false,
    eyesClosed: false,
    spots: { inScope: 0, total: 0, onePerson: false },
    ...extra,
  });
  const sel = (s: string) => ({ ...INITIAL_SELECTION, tab: 'skin' as const, skin: s as never });

  it('six tone items in strip order, 勻膚 opening the divider, each with its own icon', () => {
    const items = toneItems(lens(), sel('skin.smooth'), skin());
    expect(items.map((i) => i.label)).toEqual(['勻膚', '膚色', '黑眼圈', '法令紋', '白牙', '亮眼']);
    expect(items.map((i) => i.divider)).toEqual(['before', undefined, undefined, undefined, undefined, undefined]);
    for (const it of items) if (it.visual.kind === 'icon') expect(hasIcon(it.visual.icon), it.visual.icon).toBe(true);
    expect(items.every((i) => !i.disabled)).toBe(true);
  });

  it('the item dot follows the selected person’s value (the 美膚 tab dot: tabHasValue, under 祛痘 below)', () => {
    expect(toneItems(lens({ 'tone.warmth': 0.62 }), sel('skin.smooth'), skin()).find((i) => i.label === '膚色')!.hasValue).toBe(true);
    expect(toneItems(lens(), sel('skin.smooth'), skin()).some((i) => i.hasValue)).toBe(false);
  });

  it('disables the six with the photo-level reasons; a face-less person gets the lens reason', () => {
    const reasons = (s: SkinPanelContext, who = 'f0') => [...new Set(toneItems(lens({}, who), sel('skin.smooth'), s).map((i) => i.reason))];
    expect(reasons(skin('noFace'))).toEqual([TONE_COPY.noFace]);
    expect(reasons(skin('basic'))).toEqual([TONE_COPY.basic]);
    expect(reasons(skin('recovering'))).toEqual([TONE_COPY.recovering]);
    expect(reasons(skin('paused'))).toEqual([TONE_COPY.paused]);
    expect(reasons(skin('failed'))).toEqual([TONE_COPY.failed]);
    expect(reasons(skin(), 'b0')).toEqual(['這位人物未偵測到臉部，臉部效果不適用']);
    expect(skinToolGate('spot', skin('noFace')).ok).toBe(true);
    expect(skinToolGate('spot', skin('basic')).ok).toBe(true);
    expect(skinToolGate('spot', skin('paused'))).toEqual({ ok: false, reason: TONE_COPY.paused });
  });

  it('notes: 白牙 on a closed mouth, 亮眼 on closed eyes, a disabled selection explains itself', () => {
    expect(skinNote(lens(), sel('tone.teeth'), skin('faces', { mouthClosed: true }))?.text).toBe(TONE_COPY.mouthClosed);
    expect(skinNote(lens(), sel('tone.eyeBright'), skin('faces', { eyesClosed: true }))?.text).toBe(TONE_COPY.eyesClosed);
    expect(skinNote(lens(), sel('tone.teeth'), skin())).toBeNull();
    expect(skinNote(lens(), sel('tone.even'), skin('basic'))?.text).toBe(TONE_COPY.basic);
    expect(skinNote(lens(), sel('skin.smooth'), skin('basic'))).toBeNull();
    expect(skinNote(lens(), sel('tone.even'), undefined)).toBeNull();
  });

  it('膚色 carries the end captions 冷 / 暖', () => {
    expect(WARM_ENDS).toEqual(['冷', '暖']);
  });

  it('faceAnswer follows the editor’s note order: faces, 基本模式, no face, then the tracker state', () => {
    const a = (hasFaces: boolean, basic: boolean, unsure: boolean, tracker: 'ok' | 'lost' | 'failed') => faceAnswer({ hasFaces, basic, unsure, tracker });
    expect(a(true, true, true, 'lost')).toBe('faces');
    expect(a(false, true, false, 'ok')).toBe('basic');
    expect(a(false, false, false, 'ok')).toBe('noFace');
    expect(a(false, false, true, 'lost')).toBe('recovering');
    expect(a(false, false, true, 'failed')).toBe('paused');
    expect(a(false, false, true, 'ok')).toBe('failed');
  });

  it('the editor strip (with a skin context) appends the six and 祛痘 after the 美膚 group; the camera (none) gets neither them nor the divider', () => {
    const editor = itemsFor(lens(), sel('skin.smooth'), undefined, skin());
    expect(editor.map((i) => i.key)).toEqual(['reset', ...paramsInGroup('skin').map((d) => d.id), ...paramsInGroup('tone').map((d) => d.id), 'spot']);
    const camera = itemsFor(lens(), sel('skin.smooth'));
    expect(camera.map((i) => i.key)).toEqual(['reset', ...paramsInGroup('skin').map((d) => d.id)]);
    expect(camera.some((i) => i.divider)).toBe(false);
  });

  it('a tone slider needs the skin context and an open gate; only 膚色 carries the ends', () => {
    expect(sliderFor(lens(), sel('tone.warmth'), undefined, skin())).toMatchObject({ param: 'tone.warmth', bidirectional: true, ends: ['冷', '暖'] });
    expect(sliderFor(lens(), sel('tone.even'), undefined, skin())).toMatchObject({ param: 'tone.even' });
    expect(sliderFor(lens(), sel('tone.even'), undefined, skin())?.ends).toBeUndefined();
    expect(sliderFor(lens(), sel('tone.even'))).toBeNull();
    expect(sliderFor(lens(), sel('tone.even'), undefined, skin('noFace'))).toBeNull();
    expect(sliderFor(lens({}, 'b0'), sel('tone.even'), undefined, skin())).toBeNull();
    // the 美膚 group itself is not gated by the skin context
    expect(sliderFor(lens(), sel('skin.smooth'), undefined, skin('noFace'))).not.toBeNull();
  });
});

describe('step 4: 祛痘 (skin-cleanup spec §2.3)', () => {
  const skin = (inScope = 0, total = 0, onePerson = false, answer: SkinPanelContext['answer'] = 'faces'): SkinPanelContext => ({
    answer,
    mouthClosed: false,
    eyesClosed: false,
    spots: { inScope, total, onePerson },
  });
  const sel = (s: string) => ({ ...INITIAL_SELECTION, tab: 'skin' as const, skin: s as never });

  it('祛痘 closes the strip, selects the mode, shows its dot only when the 清除 scope holds spots', () => {
    const it0 = spotItem(sel('skin.smooth'), skin());
    expect([it0.key, it0.label, it0.action, it0.selected, it0.hasValue]).toEqual(['spot', '祛痘', { type: 'spot' }, false, false]);
    expect(it0.visual.kind === 'icon' && hasIcon(it0.visual.icon)).toBe(true);
    expect(spotItem(sel('spot'), skin(2, 5)).hasValue).toBe(true);
    expect(spotItem(sel('spot'), skin(0, 5, true)).hasValue).toBe(false);
    expect(spotItem(sel('spot'), skin(0, 0, false, 'noFace')).disabled).toBe(false);
    expect(spotItem(sel('spot'), skin(0, 0, false, 'recovering')).reason).toBe(TONE_COPY.recovering);
    expect(showsSpotMode(sel('spot'))).toBe(true);
    expect(showsSpotMode({ ...sel('spot'), tab: 'shape' })).toBe(false);
  });

  it('lastSel never keeps the 祛痘 mode', () => {
    expect(rememberable(sel('spot')).skin).toBe('skin.smooth');
    expect(rememberable(sel('tone.even')).skin).toBe('tone.even');
  });

  it('another tab leaves 祛痘 for good: back on 美膚 the strip is on 磨皮, not in the tap mode (S §2.3)', () => {
    const away = selectTab(sel('spot'), 'shape');
    expect(away.tab).toBe('shape');
    expect(showsSpotMode(away)).toBe(false);
    const back = selectTab(away, 'skin');
    expect(back).toMatchObject({ tab: 'skin', skin: 'skin.smooth' });
    expect(showsSpotMode(back)).toBe(false);
    // a tone choice survives the round trip; the same tab is no change
    expect(selectTab(selectTab(sel('tone.even'), 'body'), 'skin').skin).toBe('tone.even');
    const s = sel('spot');
    expect(selectTab(s, 'skin')).toBe(s);
  });

  it('the 清除 label follows the scope; a second tap within 3 s clears, one tap left for 3 s does not', () => {
    expect(clearLabel(3, false, false)).toBe('全部清除（3）');
    expect(clearLabel(0, true, false)).toBe('清除此人（0）');
    expect(clearLabel(3, true, true)).toBe('確定清除？');
    const t1 = clearTap(0, 1000, 3);
    expect(t1).toEqual({ confirmUntil: 1000 + CLEAR_CONFIRM_MS, clear: false });
    expect(clearTap(t1.confirmUntil, 1000 + CLEAR_CONFIRM_MS - 1, 3)).toEqual({ confirmUntil: 0, clear: true });
    expect(clearTap(t1.confirmUntil, 1000 + CLEAR_CONFIRM_MS + 1, 3)).toEqual({ confirmUntil: 1000 + 2 * CLEAR_CONFIRM_MS + 1, clear: false });
    expect(clearTap(0, 1000, 0)).toEqual({ confirmUntil: 0, clear: false });
  });

  it('the armed clear disarms when the scope or the counts change (Review Focus 3)', () => {
    const k = clearArmKey('all', 3, 3);
    expect(clearArmKey('all', 2, 2)).not.toBe(k); // ↶ removed a spot
    expect(clearArmKey('f1', 3, 3)).not.toBe(k); // another chip
    expect(clearArmKey('all', 3, 4)).not.toBe(k); // a new spot elsewhere
    expect(clearArmKey('all', 3, 3)).toBe(k);
  });

  it('the 美膚 tab dot lights for spots alone', () => {
    expect(spotsOnTab(skin(0, 3))).toBe(true);
    expect(spotsOnTab(skin(0, 0))).toBe(false);
    expect(spotsOnTab(undefined)).toBe(false);
  });

  /** one face person, every value neutral (no 美白 / 銳化 either), plus `values` */
  const lensOf = (values: Record<string, number> = {}) =>
    lensFor(
      {
        v: 2 as const,
        photo: { ...defaultPhoto(), values: { ...defaultPhoto().values, 'skin.whiten': 0, 'skin.sharpen': 0 }, spots: [] },
        persons: { f0: { ...neutralPerson(), values: { ...neutralPerson().values, ...values } } },
        template: neutralPerson(),
        primaryInit: null,
      },
      { kind: 'person', id: 'f0' },
      [{ id: 'f0', face: true, body: false }],
      'f0',
    );

  it('activating 祛痘 only selects the mode, like 增高: no edit, no undo step (S §3.6)', () => {
    const lens = lensOf();
    const r = activate(spotItem(sel('skin.smooth'), skin()), lens, sel('skin.smooth'));
    expect(r.sel.skin).toBe('spot');
    expect(r.edit).toBe(lens.edit);
    expect(activate(spotItem(sel('spot'), skin()), lens, sel('spot')).changed).toBe(false);
  });

  it('a param tile leaves the 祛痘 mode; in it the slider row is SpotControls (no binding) and the chips stay live', () => {
    const lens = lensOf();
    const items = itemsFor(lens, sel('spot'), undefined, skin());
    expect(activate(byKey(items, 'tone.even'), lens, sel('spot')).sel.skin).toBe('tone.even');
    expect(sliderFor(lens, sel('spot'), undefined, skin())).toBeNull();
    expect(photoScoped(sel('spot'), lens)).toBe(false);
  });

  it('tabHasValue(美膚): spots alone, or a tone value alone, light the tab; a neutral photo does not (S §2.1)', () => {
    expect(tabHasValue(lensOf(), 'skin', undefined, skin(0, 0))).toBe(false);
    expect(tabHasValue(lensOf(), 'skin', undefined, skin(0, 2))).toBe(true);
    expect(tabHasValue(lensOf({ 'tone.nasolabial': 0.4 }), 'skin', undefined, skin(0, 0))).toBe(true);
  });

  it('a tap outside the photo (letterbox) is ignored', () => {
    expect(spotTapInside([0.5, 0.5])).toBe(true);
    expect(spotTapInside([-0.01, 0.5])).toBe(false);
    expect(spotTapInside([0.5, 1.02])).toBe(false);
  });
});

describe('step-5 icons (face-detail spec §3.1)', () => {
  it('every new item and strip control has an icon', () => {
    for (const k of [
      'jawline', 'temple', 'hairline', 'noseWing', 'noseBridge', 'mouthHeight', 'brow', 'eyeshadow', 'liner', 'lashes',
      'aegyo', 'contour', 'highlight', 'lens', 'split', 'parts', 'makeupOff',
    ])
      expect(hasIcon(k), k).toBe(true);
  });
});

const E5 = (f0: PersonParams = naturalPerson()): EditState => ({ v: 2, photo: defaultPhoto(), persons: { f0 }, template: neutralPerson(), primaryInit: null });
const L5 = (e: EditState, swap = false) => lensFor(e, { kind: 'person', id: 'f0' }, [{ id: 'f0', face: true, body: false, screenSwap: swap }], 'f0');
const shapeDefs = (): PanelItem[] =>
  paramsInGroup('shape').map((d) => ({
    key: d.id,
    label: d.label,
    visual: { kind: 'icon', icon: d.icon },
    selected: false,
    hasValue: false,
    action: { type: 'param', id: d.id },
    disabled: false,
    reason: null,
  }));
const splitOnEdit = () => L5(E5()).setSplit(true, 'L');

describe('美型 strip (face-detail spec §2.1)', () => {
  it('has dividers at the five group starts and 左右分開 last', () => {
    const items = decorateShapeItems(shapeDefs(), L5(E5()));
    expect(items.map((i) => i.key)).toEqual([...paramsInGroup('shape').map((d) => d.id), 'split']);
    expect(items.filter((i) => i.divider === 'before').map((i) => i.key)).toEqual([
      'shape.faceSlim', 'shape.noseSlim', 'shape.mouthSize', 'shape.eyeDistance', 'split',
    ]);
  });

  it('左右分開 is a switch; the 左右 badge marks the six split items only while it is on', () => {
    const off = decorateShapeItems(shapeDefs(), L5(E5()));
    expect(off.at(-1)).toMatchObject({ key: 'split', label: '左右分開', pressed: false, action: { type: 'split' }, visual: { kind: 'icon', icon: 'split' } });
    expect(off.filter((i) => i.badge)).toHaveLength(0);
    const on = decorateShapeItems(shapeDefs(), L5(splitOnEdit()));
    expect(on.at(-1)?.pressed).toBe(true);
    expect(on.filter((i) => i.badge === SPLIT_BADGE).map((i) => i.key)).toEqual([
      'shape.eyeEnlarge', 'shape.faceSlim', 'shape.faceV', 'shape.faceNarrow', 'shape.jawline', 'shape.temple',
    ]);
  });

  it('item and tab dots see either side', () => {
    const e = L5(splitOnEdit()).set('shape.jawline', 0.5, 'R');
    const items = decorateShapeItems(shapeDefs(), L5(e));
    expect(items.find((i) => i.key === 'shape.jawline')?.hasValue).toBe(true);
    expect(shapeHasValue(L5(e))).toBe(true);
    const neutral = { ...neutralPerson(), right: null };
    expect(shapeHasValue(L5(E5(neutral)))).toBe(false);
  });
});

describe('左右分開 interaction (face-detail spec §2.2)', () => {
  it('turning it on copies the values, selects 左 and explains the screen sides; off keeps the active side', () => {
    const s = { ...INITIAL_SELECTION, tab: 'shape' as const, side: 'R' as const };
    const on = splitToggle(L5(E5()), s);
    expect(on.sel.side).toBe('L');
    expect(on.sel.shape).toBe(s.shape); // the switch never changes the selected slider item (S5 §2.1)
    expect(on.notice).toBe('已開啟左右分開：左、右以螢幕上看到的方向為準');
    expect(on.edit.persons.f0.right).not.toBeNull();
    const edited = L5(on.edit).set('shape.faceSlim', 0.9, 'R');
    const off = splitToggle(L5(edited), { ...s, side: 'R' });
    expect(off.notice).toBe('已關閉左右分開：左右臉改回相同');
    expect(off.edit.persons.f0.right).toBeNull();
    expect(off.edit.persons.f0.values['shape.faceSlim']).toBe(0.9);
    expect(off.sel.side).toBe('R');
  });

  it('the side binding: active chip, other-side caption value, a key per side, a write to that side only', () => {
    const e = L5(splitOnEdit()).set('shape.faceSlim', 0.3, 'R');
    const base: SliderBinding = {
      key: 'f0:shape.faceSlim',
      param: 'shape.faceSlim',
      label: '瘦臉',
      bidirectional: false,
      value: 0.15,
      mixed: false,
      defaultValue: 0.15,
      apply: (l, v) => l.set('shape.faceSlim', v),
    };
    const s = { ...INITIAL_SELECTION, tab: 'shape' as const, side: 'L' as const };
    const b = withSides(base, L5(e), s, 'shape.faceSlim');
    expect(b.sides?.active).toBe('L');
    expect(b.sides?.other).toBe(0.3);
    expect(b.value).toBe(naturalPerson().values['shape.faceSlim']);
    expect(b.key).toBe('f0:shape.faceSlim:L');
    expect(b.mixed).toBe(false);
    expect(b.sides?.select('R')).toEqual({ ...s, side: 'R' });
    expect(b.sides?.select('L')).toBe(s);
    const w = b.apply(L5(e), 0.8).persons.f0;
    expect([w.values['shape.faceSlim'], w.right?.['shape.faceSlim']]).toEqual([0.8, 0.3]);
    // a non-split item, or 左右分開 off: the binding is returned unchanged
    expect(withSides(base, L5(E5()), s, 'shape.faceSlim')).toBe(base);
    expect(withSides({ ...base, key: 'f0:shape.chin', param: 'shape.chin' }, L5(e), s, 'shape.chin').sides).toBeUndefined();
  });

  it('a non-split item while 左右分開 is on gets 「{label}左右一起調整」', () => {
    const s = { ...INITIAL_SELECTION, tab: 'shape' as const };
    const chin = shapeDefs().find((i) => i.key === 'shape.chin')!;
    const slim = shapeDefs().find((i) => i.key === 'shape.faceSlim')!;
    expect(splitJointNotice(chin, L5(splitOnEdit()), s)).toBe('下巴左右一起調整');
    expect(splitJointNotice(slim, L5(splitOnEdit()), s)).toBeNull();
    expect(splitJointNotice(chin, L5(E5()), s)).toBeNull();
  });
});

describe('美型 wiring: itemsFor, sliderFor, tabHasValue, activate (face-detail spec §2.1–2.2)', () => {
  const s = { ...INITIAL_SELECTION, tab: 'shape' as const, shape: 'shape.faceSlim' as const, side: 'R' as const };

  it('the 美型 strip keeps ⊘ 原圖 first, badges the split items and ends with the pressed switch', () => {
    const items = itemsFor(L5(splitOnEdit()), s);
    expect(items[0]).toMatchObject({ key: 'reset', label: '原圖' });
    expect(items.at(-1)).toMatchObject({ key: 'split', pressed: true });
    expect(byKey(items, 'shape.faceSlim')).toMatchObject({ badge: SPLIT_BADGE, divider: 'before', selected: true });
    expect(itemsFor(L5(splitOnEdit()), { ...s, tab: 'skin' }).some((i) => i.key === 'split')).toBe(false);
  });

  it('the 美型 slider edits the chosen side while 左右分開 is on', () => {
    const e = L5(splitOnEdit()).set('shape.faceSlim', 0.4, 'R');
    const b = sliderFor(L5(e), s)!;
    expect(b.key).toBe('shape.faceSlim:R');
    expect(b.value).toBe(0.4);
    expect(b.sides).toMatchObject({ active: 'R', other: naturalPerson().values['shape.faceSlim'] });
    expect(sliderFor(L5(E5()), s)!.sides).toBeUndefined();
  });

  it('the 美型 tab dot sees a value on the right side only', () => {
    const split = L5(E5(neutralPerson())).setSplit(true, 'L');
    expect(tabHasValue(L5(split), 'shape')).toBe(false);
    expect(tabHasValue(L5(L5(split).set('shape.jawline', 0.5, 'R')), 'shape')).toBe(true);
  });

  it('tapping 左右分開 is one edit with its notice, and never changes the selected item', () => {
    const r = activate(byKey(itemsFor(L5(E5()), s), 'split'), L5(E5()), s);
    expect(r).toMatchObject({ changed: true, notice: SPLIT_ON_NOTICE });
    expect(r.sel).toEqual({ ...s, side: 'L' });
    expect(r.edit.persons.f0.right).not.toBeNull();
  });
});

describe('左右分開 without a face target', () => {
  it('a body-only person: the tap changes nothing and claims nothing', () => {
    const e: EditState = { ...E5(), persons: { f0: naturalPerson(), b1: naturalPerson() } };
    const infos: PersonInfo[] = [{ id: 'f0', face: true, body: false }, { id: 'b1', face: false, body: true }];
    const l = lensFor(e, { kind: 'person', id: 'b1' }, infos, 'f0');
    const s = { ...INITIAL_SELECTION, tab: 'shape' as const, side: 'R' as const };
    const r = activate(byKey(itemsFor(l, s), 'split'), l, s);
    expect(r.changed).toBe(false);
    expect(r.notice).toBeUndefined();
    expect(r.edit).toBe(e);
  });

  it('a photo with no face: the tap on the dimmed switch changes nothing and claims nothing, like ⊘', () => {
    const e = E5();
    const s = { ...INITIAL_SELECTION, tab: 'shape' as const, side: 'R' as const };
    for (const at of [{ kind: 'person', id: 'f0' }, { kind: 'all' }] as const) {
      const lens = (x: EditState) => lensFor(x, at, [{ id: 'f0', face: false, body: false }], 'f0');
      const l = lens(e);
      expect(l.noFace).toBe(true);
      const r = activate(byKey(itemsFor(l, s), 'split'), l, s);
      expect(r.changed, at.kind).toBe(false);
      expect(r.notice, at.kind).toBeUndefined();
      expect(r.edit, at.kind).toBe(e);
      expect(r.sel, at.kind).toBe(s);
      // the 一鍵 link and its 程度 slider survive (the tap must not turn f0's preset into 自訂)
      expect(sliderFor(lens(r.edit), { ...s, tab: 'preset' })?.key, at.kind).toBe('preset.natural');
    }
  });
});

describe('美型 dots under 全部 (face-detail spec §2.1, S1 §2.4 Dots)', () => {
  it('a right-only value of a person other than the shown one lights the item and the tab', () => {
    const f1 = L5(E5(neutralPerson())).setSplit(true, 'L').persons.f0;
    const e: EditState = { ...E5(neutralPerson()), persons: { f0: neutralPerson(), f1: { ...f1, right: { ...f1.right, 'shape.jawline': 0.5 } } } };
    const infos: PersonInfo[] = [{ id: 'f0', face: true, body: false }, { id: 'f1', face: true, body: false }];
    const at = (s: Selection) => lensFor(e, s, infos, 'f0');
    const s = { ...INITIAL_SELECTION, tab: 'shape' as const };
    const dot = (l: ReturnType<typeof at>) => byKey(itemsFor(l, s), 'shape.jawline').hasValue;
    expect(dot(at({ kind: 'all' }))).toBe(true);
    expect(tabHasValue(at({ kind: 'all' }), 'shape')).toBe(true);
    expect(dot(at({ kind: 'person', id: 'f0' }))).toBe(false);
    expect(dot(at({ kind: 'person', id: 'f1' }))).toBe(true);
  });
});

const withMakeup = (values: Record<string, number>, shades: Partial<PersonParams['shades']> = {}): PersonParams => ({
  ...naturalPerson(),
  values: { ...naturalPerson().values, ...values },
  shades: { ...emptyShades(), ...shades },
});
const S14 = (over: Partial<PanelSelection> = {}): PanelSelection => ({ ...INITIAL_SELECTION, tab: 'makeup', ...over });

describe('美妝 level 2: the shades of one part (face-detail spec §2.3)', () => {
  it('keeps 無 · 原色 · shades for the 原色 parts, drops 原色 for 眼線, and has 無 · 自然 for the four parts without shades', () => {
    const lens = L5(E5());
    for (const part of ['lip', 'blush', 'brow', 'eyeshadow', 'lens'] as const)
      expect(makeupShadeItems(lens, part).map((i) => i.key)).toEqual(['reset', 'orig', ...SHADES[part].map((s) => s.id)]);
    expect(makeupShadeItems(lens, 'liner').map((i) => i.key)).toEqual(['reset', ...SHADES.liner.map((s) => s.id)]);
    for (const part of ['lashes', 'aegyo', 'contour', 'highlight'] as const) {
      const items = makeupShadeItems(lens, part);
      expect(items.map((i) => [i.key, i.label])).toEqual([
        ['reset', '無'],
        ['on', '自然'],
      ]);
      expect(items[1].action).toEqual({ type: 'makeupOn', part });
    }
  });

  it('exactly one item is selected; 眼線 on with no shade selects 黑', () => {
    expect(makeupShadeItems(L5(E5()), 'liner').filter((i) => i.selected).map((i) => i.key)).toEqual(['reset']);
    const on = L5(E5(withMakeup({ 'makeup.liner': 0.6 })));
    expect(makeupShadeItems(on, 'liner').filter((i) => i.selected).map((i) => i.key)).toEqual(['black']);
    const lashes = L5(E5(withMakeup({ 'makeup.lashes': 0.55 })));
    expect(makeupShadeItems(lashes, 'lashes').filter((i) => i.selected).map((i) => i.key)).toEqual(['on']);
  });

  it('the lead tile names the active part and opens the part list', () => {
    expect(makeupLeadItem(S14({ makeupPart: 'eyeshadow' }))).toMatchObject({ key: 'lead', label: '眼影', action: { type: 'parts' }, visual: { kind: 'icon', icon: 'eyeshadow' } });
  });
});

describe('美妝 level 1: the part list (face-detail spec §2.3)', () => {
  it('lists 卸妝, then the ten parts in RM order behind a divider; the active part is outlined', () => {
    const items = makeupPartItems(L5(E5()), S14({ makeupPart: 'lens', makeupView: 'parts' }));
    expect(items.map((i) => i.label)).toEqual(['卸妝', '口紅', '腮紅', '眉毛', '眼影', '眼線', '睫毛', '臥蠶', '修容', '高光', '美瞳']);
    expect(items[0]).toMatchObject({ key: 'makeupReset', action: { type: 'makeupReset' }, visual: { kind: 'icon', icon: 'makeupOff' } });
    expect(items[1].divider).toBe('before');
    expect(items.filter((i) => i.selected).map((i) => i.key)).toEqual(['part.lens']);
    expect(MAKEUP_PARTS.map((p) => p.param)).toEqual([
      'makeup.lip', 'makeup.blush', 'makeup.brow', 'makeup.eyeshadow', 'makeup.liner', 'makeup.lashes', 'makeup.aegyo', 'makeup.contour', 'makeup.highlight', 'makeup.lens',
    ]);
  });

  it('dots show the parts that are on; a part on with a shade shows its 10 px swatch (眼線 null → 黑)', () => {
    const lens = L5(E5(withMakeup({ 'makeup.eyeshadow': 0.4, 'makeup.liner': 0.6, 'makeup.contour': 0.4 }, { eyeshadow: 'mauve' })));
    const items = makeupPartItems(lens, S14({ makeupView: 'parts' }));
    const at = (k: string) => items.find((i) => i.key === k)!;
    expect(at('part.eyeshadow')).toMatchObject({ hasValue: true, visual: { kind: 'icon', icon: 'eyeshadow', mini: '#9A7FA6' } });
    expect(at('part.liner').visual).toEqual({ kind: 'icon', icon: 'liner', mini: '#151313' });
    expect(at('part.contour').visual).toEqual({ kind: 'icon', icon: 'contour' });
    expect(at('part.brow').hasValue).toBe(false);
  });
});

describe('美妝 actions (face-detail spec §2.3)', () => {
  it('part / parts change only the selection', () => {
    const lens = L5(E5());
    expect(makeupAction({ type: 'parts' }, lens, S14())).toEqual({ edit: null, sel: S14({ makeupView: 'parts' }) });
    expect(makeupAction({ type: 'part', part: 'aegyo' }, lens, S14({ makeupView: 'parts' }))).toEqual({ edit: null, sel: S14({ makeupPart: 'aegyo' }) });
  });

  it('卸妝 is a no-op when nothing is on, and otherwise clears every part and shade in one step', () => {
    const none = L5(E5());
    expect(makeupAction({ type: 'makeupReset' }, none, S14())?.edit).toBeNull();
    const made = L5(E5(withMakeup({ 'makeup.lip': 0.5, 'makeup.lens': 0.6 }, { lip: 'rose', lens: 'blue' })));
    const out = makeupAction({ type: 'makeupReset' }, made, S14())!.edit!.persons.f0;
    expect(out.shades).toEqual(emptyShades());
    expect([out.values['makeup.lip'], out.values['makeup.lens']]).toEqual([0, 0]);
  });

  it('無 clears the active part only; a no-op when it is already off', () => {
    const lens = L5(E5(withMakeup({ 'makeup.liner': 0.6, 'makeup.brow': 0.4 }, { liner: 'navy' })));
    const out = makeupAction({ type: 'reset' }, lens, S14({ makeupPart: 'liner' }))!.edit!.persons.f0;
    expect([out.values['makeup.liner'], out.shades.liner, out.values['makeup.brow']]).toEqual([0, null, 0.4]);
    expect(makeupAction({ type: 'reset' }, lens, S14({ makeupPart: 'aegyo' }))?.edit).toBeNull();
    expect(makeupAction({ type: 'reset' }, lens, S14({ tab: 'skin' }))).toBeNull();
  });

  it('自然 from 0 applies the pick default; again is a no-op (same EditState)', () => {
    const e = E5();
    const r = makeupAction({ type: 'makeupOn', part: 'lashes' }, L5(e), S14({ makeupPart: 'lashes' }))!;
    expect(r.edit!.persons.f0.values['makeup.lashes']).toBe(MAKEUP_PICK_DEFAULT.lashes);
    const again = makeupAction({ type: 'makeupOn', part: 'lashes' }, L5(r.edit!), S14({ makeupPart: 'lashes' }))!;
    expect(again.edit).toBe(r.edit);
  });

  it('a shade from 0 applies the part pick default; tapping 黑 on a liner that reads as 黑 is not an undo step', () => {
    const r = makeupAction({ type: 'shade', part: 'lens', shade: 'blue' }, L5(E5()), S14({ makeupPart: 'lens' }))!;
    expect(r.edit!.persons.f0.values['makeup.lens']).toBe(MAKEUP_PICK_DEFAULT.lens);
    expect(r.edit!.persons.f0.shades.lens).toBe('blue');
    const liner = L5(E5(withMakeup({ 'makeup.liner': 0.6 })));
    expect(makeupAction({ type: 'shade', part: 'liner', shade: 'black' }, liner, S14({ makeupPart: 'liner' }))?.edit).toBeNull();
    expect(effectiveShade('liner', null)).toBe('black');
    expect(effectiveShade('lens', null)).toBeNull();
  });
});

describe('美妝 under 全部 (RM §3.3, S §2.4 Dots)', () => {
  const infos: PersonInfo[] = [{ id: 'f0', face: true, body: false }, { id: 'f1', face: true, body: false }];
  const all = (f0: PersonParams, f1: PersonParams) => lensFor({ ...E5(f0), persons: { f0, f1 } }, { kind: 'all' }, infos, 'f0');

  it('a shade or 自然 every target has on is selected, and its tap a no-op, whatever the intensities (the slider says 各人不同)', () => {
    const l = all(withMakeup({ 'makeup.lens': 0.3, 'makeup.lashes': 0.3 }, { lens: 'blue' }), withMakeup({ 'makeup.lens': 0.8, 'makeup.lashes': 0.8 }, { lens: 'blue' }));
    expect(makeupShadeItems(l, 'lens').filter((i) => i.selected).map((i) => i.key)).toEqual(['blue']);
    expect(makeupAction({ type: 'shade', part: 'lens', shade: 'blue' }, l, S14({ makeupPart: 'lens' }))?.edit).toBeNull();
    expect(makeupShadeItems(l, 'lashes').filter((i) => i.selected).map((i) => i.key)).toEqual(['on']);
    expect(sliderFor(l, S14({ makeupPart: 'lens' }))?.mixed).toBe(true);
    // one target off: nothing is selected, and 自然 turns that one on
    const half = all(withMakeup({ 'makeup.lashes': 0.55 }), withMakeup({}));
    expect(makeupShadeItems(half, 'lashes').filter((i) => i.selected)).toEqual([]);
    const on = makeupAction({ type: 'makeupOn', part: 'lashes' }, half, S14({ makeupPart: 'lashes' }))!.edit!;
    expect([on.persons.f0.values['makeup.lashes'], on.persons.f1.values['makeup.lashes']]).toEqual([0.55, MAKEUP_PICK_DEFAULT.lashes]);
  });

  it('a part tile dot lights for any face person, not only the shown one', () => {
    const l = all(withMakeup({}), withMakeup({ 'makeup.aegyo': 0.5, 'makeup.brow': 0.4 }));
    const items = makeupPartItems(l, S14({ makeupView: 'parts' }));
    expect(items.filter((i) => i.hasValue).map((i) => i.key)).toEqual(['part.brow', 'part.aegyo']);
  });
});

describe('美妝 strip notes (face-detail spec §2.4)', () => {
  const none = { lensClosed: false, lashesClosed: false, lashesSmall: false, procFailed: false };
  it('closed eyes on 美瞳 / 睫毛, a small face on 睫毛, a compile failure on the eight new parts; only on level 2', () => {
    expect(makeupNote(S14({ makeupPart: 'lens' }), { ...none, lensClosed: true })).toBe('眼睛閉合時不套用美瞳與睫毛');
    expect(makeupNote(S14({ makeupPart: 'lashes' }), { ...none, lashesClosed: true })).toBe('眼睛閉合時不套用美瞳與睫毛');
    expect(makeupNote(S14({ makeupPart: 'eyeshadow' }), { ...none, lensClosed: true, lashesClosed: true })).toBeNull();
    expect(makeupNote(S14({ makeupPart: 'lashes' }), { ...none, lashesSmall: true })).toBe('臉部太小，睫毛不會套用');
    expect(makeupNote(S14({ makeupPart: 'brow' }), { ...none, procFailed: true })).toBe('此裝置無法使用這個妝容');
    expect(makeupNote(S14({ makeupPart: 'lip' }), { ...none, procFailed: true })).toBeNull();
    expect(makeupNote(S14({ makeupPart: 'lens', makeupView: 'parts' }), { ...none, lensClosed: true })).toBeNull();
    expect(makeupNote(S14({ tab: 'shape' }), { ...none, procFailed: true })).toBeNull();
  });
});
