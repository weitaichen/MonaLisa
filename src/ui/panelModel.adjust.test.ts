// 調節 tab and 一鍵 › 質感 (step-2 spec §2.1–2.2, §3.4, §8.1 panelModel list).
import { describe, expect, it } from 'vitest';
import { lensFor } from '../edit/lens';
import { adjustItemActive, adjustValuesNeutral } from '../engine/adjustMath';
import { defaultPhoto, naturalPerson, neutralPerson } from '../edit/state';
import { paramsInGroup } from '../engine/params';
import type { AdjustId, EditState, PhotoParams } from '../types';
import {
  activate,
  adjustItems,
  adjustSlider,
  adjustTabHasValue,
  INITIAL_SELECTION,
  itemsFor,
  leadChip,
  lookActivation,
  lookFailedNotice,
  lookItems,
  lookSlider,
  partButtons,
  personNote,
  photoScoped,
  photoTabLabel,
  photoTouchToast,
  PRESET_PARTS,
  selectPart,
  sliderEmptyText,
  sliderFor,
  tabHasValue,
  TABS,
  tapToast,
  type PanelSelection,
} from './panelModel';

const sel = (over: Partial<PanelSelection>): PanelSelection => ({ ...INITIAL_SELECTION, ...over });
const ONE_WAY = ['adjust.fade', 'adjust.grain', 'adjust.vignette'];
const neutral = (id: AdjustId) => (ONE_WAY.includes(id) ? 0 : 0.5);
const values = (over: Partial<Record<AdjustId, number>> = {}) => (id: AdjustId) => over[id] ?? neutral(id);
const ADJUST_KEYS = paramsInGroup('adjust').map((d) => d.id);

describe('調節 tab (step-2 spec §2.1)', () => {
  it('sits after 美妝 in the editor and the camera: 一鍵 · 美膚 · 美型 · 美體 · 濾鏡 · 美妝 · 調節', () => {
    expect(TABS.map((t) => t.label)).toEqual(['一鍵', '美膚', '美型', '美體', '濾鏡', '美妝', '調節']);
    expect(TABS.at(-1)!.id).toBe('adjust');
  });

  it('strip: ⊘ 原圖 then the 12 items, dividers before 色溫 and 褪色, 亮度 selected first', () => {
    const items = adjustItems(values(), sel({ tab: 'adjust' }));
    expect(items.map((i) => i.key)).toEqual(['reset', ...ADJUST_KEYS]);
    expect(items[0]).toMatchObject({ label: '原圖', action: { type: 'reset' } });
    expect(items.filter((i) => i.divider === 'before').map((i) => i.key)).toEqual(['adjust.temperature', 'adjust.fade']);
    expect(INITIAL_SELECTION.adjust).toBe('adjust.brightness');
    expect(items.filter((i) => i.selected).map((i) => i.key)).toEqual(['adjust.brightness']);
    expect(adjustItems(values(), sel({ tab: 'adjust', adjust: 'adjust.vignette' })).find((i) => i.selected)!.label).toBe('暗角');
  });

  it('item dots show only the user values that are not neutral', () => {
    const items = adjustItems(values({ 'adjust.exposure': 0.7, 'adjust.grain': 0.3 }), sel({ tab: 'adjust' }));
    expect(items.filter((i) => i.hasValue).map((i) => i.key)).toEqual(['adjust.exposure', 'adjust.grain']);
  });

  it('slider: ±50 or 0–100, double tap → neutral, no default dot; colour tracks only for 色溫 and 色調', () => {
    const b = adjustSlider(values({ 'adjust.temperature': 0.62 }), sel({ tab: 'adjust', adjust: 'adjust.temperature' }));
    expect(b).toMatchObject({ key: 'adjust.temperature', label: '色溫', bidirectional: true, value: 0.62, defaultValue: 0.5, hideDefault: true, track: 'temperature' });
    expect(adjustSlider(values(), sel({ tab: 'adjust', adjust: 'adjust.tint' })).track).toBe('tint');
    const g = adjustSlider(values(), sel({ tab: 'adjust', adjust: 'adjust.grain' }));
    expect(g).toMatchObject({ label: '顆粒', bidirectional: false, defaultValue: 0, hideDefault: true });
    expect(g.track).toBeUndefined();
  });

  it('tab dot: any of the 12 user values not neutral', () => {
    expect(adjustTabHasValue(values())).toBe(false);
    expect(adjustTabHasValue(values({ 'adjust.shadows': 0.4 }))).toBe(true);
  });
});

describe('一鍵 › 美顏／質感 (step-2 spec §2.2)', () => {
  it('part buttons 美顏 · 質感, 美顏 first; only 質感 shows a dot, while a look is set', () => {
    expect(PRESET_PARTS.map((p) => p.label)).toEqual(['美顏', '質感']);
    expect(INITIAL_SELECTION.presetPart).toBe('beauty');
    const parts = partButtons(sel({ tab: 'preset' }), { look: { id: 'ccd', amount: 0.8 } })!;
    expect(parts.map((p) => [p.label, p.active, p.hasValue])).toEqual([
      ['美顏', true, false],
      ['質感', false, true],
    ]);
    expect(selectPart(sel({ tab: 'preset' }), 'look').presetPart).toBe('look');
    expect(partButtons(sel({ tab: 'makeup' }), { look: null })).toBeNull();
    expect(partButtons(sel({ tab: 'adjust' }), { look: null })).toBeNull();
    // 美妝 has no part buttons (its parts are strip items, makeupAction 'part'): a stray selectPart changes nothing
    expect(selectPart(sel({ tab: 'makeup' }), 'lip')).toEqual(sel({ tab: 'makeup' }));
  });

  it('質感 strip: 無 · 膠片 · CCD · 直閃 · 藍調 · 電影感, exactly one selected, thumbnails over the look icon', () => {
    const none = lookItems(null);
    expect(none.map((i) => i.label)).toEqual(['無', '膠片', 'CCD', '直閃', '藍調', '電影感']);
    expect(none.filter((i) => i.selected).map((i) => i.label)).toEqual(['無']);
    const film = lookItems({ id: 'film', amount: 0.5 });
    expect(film.filter((i) => i.selected).map((i) => i.label)).toEqual(['膠片']);
    expect(film[1].visual).toEqual({ kind: 'thumb', src: '/luts/looks/look_film_thumb.png', fallback: 'look' });
    expect(none[0].action).toEqual({ type: 'look', id: null });
  });

  it('activation: from 無 → 0.8; hopping keeps 程度; the selected look is a no-op unless its LUT failed (retry); 無 clears', () => {
    const never = () => false;
    expect(lookActivation('film', null, never)).toEqual({ kind: 'set', id: 'film', amount: 0.8 });
    expect(lookActivation('ccd', { id: 'film', amount: 0.55 }, never)).toEqual({ kind: 'set', id: 'ccd', amount: 0.55 });
    expect(lookActivation('film', { id: 'film', amount: 0.55 }, never)).toEqual({ kind: 'none' });
    expect(lookActivation('film', { id: 'film', amount: 0.55 }, (id) => id === 'film')).toEqual({ kind: 'retry', id: 'film' });
    expect(lookActivation(null, { id: 'film', amount: 0.55 }, never)).toEqual({ kind: 'set', id: null, amount: 0.55 });
    expect(lookActivation(null, null, never)).toEqual({ kind: 'none' });
  });

  it('程度 slider: the look amount, default dot at 80, keyed by look; none while 無', () => {
    expect(lookSlider(null)).toBeNull();
    expect(lookSlider({ id: 'blue', amount: 0.3 })).toMatchObject({ key: 'look.blue', label: '程度', bidirectional: false, value: 0.3, defaultValue: 0.8 });
  });
});

describe('photo-level label, lead chip and notices', () => {
  it('調節 and 一鍵 › 質感 are photo-level tabs; 美顏 is not', () => {
    expect(photoTabLabel(sel({ tab: 'adjust' }))).toBe('調節');
    expect(photoTabLabel(sel({ tab: 'preset', presetPart: 'look' }))).toBe('質感');
    expect(photoTabLabel(sel({ tab: 'preset', presetPart: 'beauty' }))).toBeNull();
    expect(photoTabLabel(sel({ tab: 'filter' }))).toBeNull();
  });

  it('the 調節 lead chip shows 「質感：{label}」 only with a look, and opens 一鍵 › 質感', () => {
    expect(leadChip(sel({ tab: 'adjust' }), null)).toBeNull();
    expect(leadChip(sel({ tab: 'filter' }), { id: 'film', amount: 0.8 })).toBeNull();
    const chip = leadChip(sel({ tab: 'adjust' }), { id: 'cinema', amount: 0.8 })!;
    expect(chip.label).toBe('質感：電影感');
    expect(chip.target).toMatchObject({ tab: 'preset', presetPart: 'look' });
  });

  it('LUT failure copy', () => {
    expect(lookFailedNotice('ccd')).toBe('無法載入「CCD」質感，請稍後再試');
  });
});

describe('step-1 panel functions dispatch to 調節 and 質感', () => {
  const editOf = (photo: Partial<PhotoParams> = {}): EditState => ({
    v: 2,
    photo: { ...defaultPhoto(), ...photo },
    persons: { p0: naturalPerson() },
    template: neutralPerson(),
    primaryInit: null,
  });
  const lensOf = (e: EditState) => lensFor(e, { kind: 'person', id: 'p0' }, [{ id: 'p0', face: true, body: false }], 'p0');
  const actCtx = (failed: boolean) => ({ lookFailed: () => failed });

  it('itemsFor / sliderFor / tabHasValue route the new tab and part', () => {
    const l = lensOf(editOf({ values: { ...defaultPhoto().values, 'adjust.grain': 0.4 } }));
    expect(itemsFor(l, sel({ tab: 'adjust' })).map((i) => i.key)).toEqual(['reset', ...ADJUST_KEYS]);
    expect(sliderFor(l, sel({ tab: 'adjust', adjust: 'adjust.grain' }))).toMatchObject({ label: '顆粒', value: 0.4 });
    expect(tabHasValue(l, 'adjust')).toBe(true);
    expect(tabHasValue(l, 'preset')).toBe(false);
    const withLook = lensOf(editOf({ look: { id: 'film', amount: 0.8 } }));
    expect(tabHasValue(withLook, 'preset')).toBe(true);
    expect(itemsFor(withLook, sel({ tab: 'preset', presetPart: 'look' })).find((i) => i.selected)!.label).toBe('膠片');
    expect(itemsFor(withLook, sel({ tab: 'preset', presetPart: 'beauty' })).map((i) => i.label)).toContain('自然');
    expect(sliderFor(withLook, sel({ tab: 'preset', presetPart: 'look' }))).toMatchObject({ key: 'look.film', label: '程度', value: 0.8 });
  });

  it('activate: look picks, the failed-look retry and 無', () => {
    const s = sel({ tab: 'preset', presetPart: 'look' });
    const tap = (e: EditState, label: string, failed = false) => {
      const item = itemsFor(lensOf(e), s).find((i) => i.label === label)!;
      return activate(item, lensOf(e), s, actCtx(failed));
    };
    const e0 = editOf();
    const r1 = tap(e0, '膠片');
    expect(r1.changed).toBe(true);
    expect(r1.edit.photo.look).toEqual({ id: 'film', amount: 0.8 });
    const e1 = lensOf(r1.edit).setLook('film', 0.6);
    expect(tap(e1, 'CCD').edit.photo.look).toEqual({ id: 'ccd', amount: 0.6 });
    expect(tap(e1, '膠片').changed).toBe(false);
    const retry = tap(e1, '膠片', true);
    expect(retry.changed).toBe(false);
    expect(retry.retryLook).toBe('film');
    expect(tap(e1, '無').edit.photo.look).toBeNull();
    expect(tap(e0, '無').changed).toBe(false);
  });

  it('activate: ⊘ in 調節 resets the 12 values and keeps the look; a no-op when neutral; tapping an item selects it', () => {
    const s = sel({ tab: 'adjust' });
    const dirty = editOf({ values: { ...defaultPhoto().values, 'adjust.fade': 0.5 }, look: { id: 'blue', amount: 0.7 } });
    const items = itemsFor(lensOf(dirty), s);
    const r = activate(items[0], lensOf(dirty), s, actCtx(false));
    expect(r.changed).toBe(true);
    expect(r.edit.photo.values['adjust.fade']).toBe(0);
    expect(r.edit.photo.look).toEqual({ id: 'blue', amount: 0.7 });
    expect(activate(items[0], lensOf(r.edit), s, actCtx(false)).changed).toBe(false);
    const grain = items.find((i) => i.key === 'adjust.grain')!;
    const r2 = activate(grain, lensOf(dirty), s, actCtx(false));
    expect(r2.sel.adjust).toBe('adjust.grain');
  });

  it('display ±1 (v = 0.01 / 0.51 / 0.49) is drawn, dotted and reset by ⊘: the three rules agree (step-2 review)', () => {
    const s = sel({ tab: 'adjust' });
    for (const [id, v] of [
      ['adjust.grain', 0.01],
      ['adjust.vignette', 0.01],
      ['adjust.fade', 0.01],
      ['adjust.exposure', 0.51],
      ['adjust.exposure', 0.49],
      ['adjust.temperature', 0.49],
    ] as [AdjustId, number][]) {
      const e = editOf({ values: { ...defaultPhoto().values, [id]: v } });
      const label = `${id} = ${v}`;
      // the engine draws it (its own neutral rule) …
      expect(adjustValuesNeutral(e.photo.values), label).toBe(false);
      expect(adjustItemActive(id, v), label).toBe(true);
      // … so the item and the tab show a dot …
      const items = itemsFor(lensOf(e), s);
      expect(items.filter((i) => i.hasValue).map((i) => i.key), label).toEqual([id]);
      expect(tabHasValue(lensOf(e), 'adjust'), label).toBe(true);
      // … and ⊘ is the undo step that clears it
      const r = activate(items[0], lensOf(e), s, actCtx(false));
      expect(r.changed, label).toBe(true);
      expect(adjustValuesNeutral(r.edit.photo.values), label).toBe(true);
    }
    // a stored value the engine treats as neutral (far below one display step) has no dot and ⊘ is no undo step
    const tiny = editOf({ values: { ...defaultPhoto().values, 'adjust.grain': 0.00005, 'adjust.exposure': 0.50002 } });
    expect(adjustValuesNeutral(tiny.photo.values)).toBe(true);
    expect(itemsFor(lensOf(tiny), s).some((i) => i.hasValue)).toBe(false);
    expect(tabHasValue(lensOf(tiny), 'adjust')).toBe(false);
    expect(activate(itemsFor(lensOf(tiny), s)[0], lensOf(tiny), s, actCtx(false)).changed).toBe(false);
  });

  it('≥ 2 persons: 調節 and 一鍵 › 質感 dim the chips, show no person note, and say 「調節／質感套用於整張照片」 once each', () => {
    const persons = [
      { id: 'f0', face: true, body: false },
      { id: 'b0', face: false, body: true },
    ];
    const two = (e: EditState) => lensFor(e, { kind: 'person', id: 'b0' }, persons, 'f0');
    const adj = sel({ tab: 'adjust', adjust: 'adjust.grain' });
    const look = sel({ tab: 'preset', presetPart: 'look' });
    const l = two(editOf());
    expect(photoScoped(adj, l)).toBe(true);
    expect(photoScoped(look, l)).toBe(true);
    expect(photoScoped(sel({ tab: 'preset' }), l)).toBe(false);
    expect(personNote('adjust', l)).toBeNull();
    // 美顏 keeps step 1's note for a body-only person; BeautyPanel skips it on 一鍵 › 質感 (Task 13)
    expect(personNote('preset', l)).not.toBeNull();
    const seen = new Set<string>();
    const grain = sliderFor(l, adj)!;
    expect(grain).toMatchObject({ key: 'b0:adjust.grain', label: '顆粒 · 整張照片', aria: '顆粒，整張照片' });
    expect(photoTouchToast(grain, l, seen)).toBe('調節套用於整張照片');
    expect(photoTouchToast(sliderFor(l, sel({ tab: 'adjust', adjust: 'adjust.fade' }))!, l, seen)).toBeNull();
    const film = itemsFor(l, look).find((i) => i.label === '膠片')!;
    const r = activate(film, l, look, actCtx(false));
    expect(tapToast(film, l, r, seen)).toBe('質感套用於整張照片');
    const l2 = two(r.edit);
    const amount = sliderFor(l2, look)!;
    expect(amount).toMatchObject({ key: 'b0:look.film', aria: '程度，整張照片' });
    expect(photoTouchToast(amount, l2, seen)).toBeNull();
    // 全部 with different presets: 「各人不同」 under 美顏 only, never under 質感
    const mixed: EditState = { ...editOf(), persons: { f0: naturalPerson(), f1: { ...naturalPerson(), preset: 'custom' } } };
    const all = lensFor(mixed, { kind: 'all' }, [{ id: 'f0', face: true, body: false }, { id: 'f1', face: true, body: false }], 'f0');
    expect(sliderEmptyText(all, sel({ tab: 'preset' }))).toBe('各人不同');
    expect(sliderEmptyText(all, look)).toBeNull();
  });
});
