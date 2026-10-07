// BeautyPanel logic (spec §7.3), kept pure so it can be unit-tested without a DOM.
import {
  BLUSH_SHADES,
  FILTERS,
  hasValue,
  LIP_SHADES,
  MAKEUP_PICK_DEFAULT,
  paramDef,
  paramsInGroup,
  PRESETS,
  resetGroup,
  setFilter,
  setParam,
  setPresetAmount,
  setShade,
  applyPreset,
} from '../engine/params';
import type { BeautyParams, ParamId, PresetId } from '../types';

export type TabId = 'preset' | 'skin' | 'shape' | 'filter' | 'makeup';
export type MakeupPart = 'lip' | 'blush';

export const TABS: readonly { id: TabId; label: string }[] = [
  { id: 'preset', label: '一鍵' },
  { id: 'skin', label: '美膚' },
  { id: 'shape', label: '美型' },
  { id: 'filter', label: '濾鏡' },
  { id: 'makeup', label: '美妝' },
];

export const MAKEUP_PARTS: readonly { id: MakeupPart; label: string }[] = [
  { id: 'lip', label: '口紅' },
  { id: 'blush', label: '腮紅' },
];

export interface PanelSelection {
  tab: TabId;
  skin: ParamId;
  shape: ParamId;
  makeupPart: MakeupPart;
}

export const INITIAL_SELECTION: PanelSelection = {
  tab: 'skin',
  skin: 'skin.smooth',
  shape: 'shape.eyeEnlarge',
  makeupPart: 'lip',
};

export type ItemVisual =
  | { kind: 'icon'; icon: string }
  | { kind: 'thumb'; src: string }
  /** null colour = 原色 (GPUPixel texture) */
  | { kind: 'swatch'; color: string | null };

export type ItemAction =
  | { type: 'reset' }
  | { type: 'preset'; id: PresetId }
  | { type: 'custom' }
  | { type: 'param'; id: ParamId }
  | { type: 'filter'; id: string }
  | { type: 'shade'; part: MakeupPart; shade: string | null };

export interface PanelItem {
  key: string;
  label: string;
  visual: ItemVisual;
  selected: boolean;
  /** 4 px accent dot */
  hasValue: boolean;
  action: ItemAction;
}

const RESET_ITEM = (label = '原圖'): PanelItem => ({
  key: 'reset',
  label,
  visual: { kind: 'icon', icon: 'none' },
  selected: false,
  hasValue: false,
  action: { type: 'reset' },
});

const PRESET_ICON: Record<PresetId, string> = {
  original: 'none',
  natural: 'presetNatural',
  refined: 'presetRefined',
  glow: 'presetGlow',
};

function makeupKey(part: MakeupPart): ParamId {
  return part === 'lip' ? 'makeup.lip' : 'makeup.blush';
}

function shadeOf(params: BeautyParams, part: MakeupPart): string | null {
  return part === 'lip' ? params.lipShade : params.blushShade;
}

export function itemsFor(params: BeautyParams, sel: PanelSelection): PanelItem[] {
  switch (sel.tab) {
    case 'preset': {
      const items: PanelItem[] = PRESETS.map((p) => ({
        key: p.id,
        label: p.label,
        visual: { kind: 'icon', icon: PRESET_ICON[p.id] },
        selected: params.presetId === p.id,
        hasValue: false,
        action: { type: 'preset', id: p.id },
      }));
      if (params.presetId === 'custom') {
        items.push({
          key: 'custom',
          label: '自訂',
          visual: { kind: 'icon', icon: 'custom' },
          selected: true,
          hasValue: false,
          action: { type: 'custom' },
        });
      }
      return items;
    }
    case 'skin':
    case 'shape':
      return [
        RESET_ITEM(),
        ...paramsInGroup(sel.tab).map((d) => ({
          key: d.id,
          label: d.label,
          visual: { kind: 'icon', icon: d.icon } as const,
          selected: sel[sel.tab as 'skin' | 'shape'] === d.id,
          hasValue: hasValue(d, params.values[d.id]),
          action: { type: 'param', id: d.id } as const,
        })),
      ];
    case 'filter':
      return FILTERS.map((f) => ({
        key: f.id,
        label: f.label,
        visual: f.id === 'none' ? { kind: 'icon', icon: 'none' } : { kind: 'thumb', src: `/luts/filters/${f.id}_thumb.png` },
        selected: params.filterId === f.id,
        hasValue: false,
        action: { type: 'filter', id: f.id },
      }));
    case 'makeup': {
      const part = sel.makeupPart;
      const on = params.values[makeupKey(part)] > 0.01;
      const shade = shadeOf(params, part);
      const shades = part === 'lip' ? LIP_SHADES : BLUSH_SHADES;
      return [
        // exactly one item is selected in every state: 無 (off) · 原色 (on, no shade) · a shade
        { ...RESET_ITEM('無'), selected: !on },
        {
          key: 'orig',
          label: '原色',
          visual: { kind: 'swatch', color: null },
          selected: on && shade === null,
          hasValue: false,
          action: { type: 'shade', part, shade: null },
        },
        ...shades.map((s) => ({
          key: s.id,
          label: s.label,
          visual: { kind: 'swatch', color: s.color } as const,
          selected: on && shade === s.id,
          hasValue: false,
          action: { type: 'shade', part, shade: s.id } as const,
        })),
      ];
    }
  }
}

export interface ActivateResult {
  params: BeautyParams;
  sel: PanelSelection;
  /** false when nothing changed (no undo entry, no haptic) */
  changed: boolean;
}

export function activate(item: PanelItem, params: BeautyParams, sel: PanelSelection): ActivateResult {
  const a = item.action;
  const done = (next: BeautyParams, nextSel = sel): ActivateResult => ({
    params: next,
    sel: nextSel,
    changed: next !== params || nextSel !== sel,
  });
  switch (a.type) {
    case 'custom':
      return done(params);
    case 'preset': {
      if (params.presetId === a.id) return done(params);
      // keep the user's 程度 when hopping between presets
      const keep = params.presetId !== 'custom' && params.presetId !== 'original' && a.id !== 'original';
      return done(applyPreset(a.id, keep ? params.presetAmount : 1));
    }
    case 'reset':
      if (sel.tab === 'makeup') {
        const key = makeupKey(sel.makeupPart);
        // already off: tapping the selected 無 is a no-op (no haptic, no undo step, no flip to 自訂)
        if (params.values[key] <= 0.01 && shadeOf(params, sel.makeupPart) === null) return done(params);
        const cleared = setParam(params, key, 0);
        return done(sel.makeupPart === 'lip' ? { ...cleared, lipShade: null } : { ...cleared, blushShade: null });
      }
      if (sel.tab === 'skin' || sel.tab === 'shape' || sel.tab === 'filter') return done(resetGroup(params, sel.tab));
      return done(params);
    case 'param':
      return done(params, sel.tab === 'shape' ? { ...sel, shape: a.id } : { ...sel, skin: a.id });
    case 'filter':
      if (params.filterId === a.id) return done(params);
      return done(setFilter(params, a.id));
    case 'shade': {
      const on = params.values[makeupKey(a.part)] > 0.01;
      if (on && shadeOf(params, a.part) === a.shade) return done(params);
      return done(setShade(params, a.part, a.shade));
    }
  }
}

export interface SliderBinding {
  /** changes when the slider targets a different value (resets drag state) */
  key: string;
  label: string;
  bidirectional: boolean;
  value: number;
  /** recommended-default dot / double-tap target */
  defaultValue: number;
  apply(params: BeautyParams, v: number): BeautyParams;
}

export function sliderFor(params: BeautyParams, sel: PanelSelection): SliderBinding | null {
  switch (sel.tab) {
    case 'preset': {
      const id = params.presetId;
      if (id === 'custom' || id === 'original') return null;
      return {
        key: `preset.${id}`,
        label: '程度',
        bidirectional: false,
        value: params.presetAmount,
        defaultValue: 1,
        apply: (p, v) => setPresetAmount(p, v),
      };
    }
    case 'skin':
    case 'shape': {
      const d = paramDef(sel[sel.tab]);
      return {
        key: d.id,
        label: d.label,
        bidirectional: d.bidirectional,
        value: params.values[d.id],
        defaultValue: d.default,
        apply: (p, v) => setParam(p, d.id, v),
      };
    }
    case 'filter': {
      if (params.filterId === 'none') return null;
      const f = FILTERS.find((x) => x.id === params.filterId);
      return {
        key: `filter.${params.filterId}`,
        label: '濾鏡強度',
        bidirectional: false,
        value: params.values['filter.amount'],
        defaultValue: f?.defaultAmount ?? 0.5,
        apply: (p, v) => setParam(p, 'filter.amount', v),
      };
    }
    case 'makeup': {
      // always shown: dragging to 0 must not unmount the slider mid-gesture; raising it from 0 applies 原色
      const key = makeupKey(sel.makeupPart);
      return {
        key,
        label: sel.makeupPart === 'lip' ? '口紅' : '腮紅',
        bidirectional: false,
        value: params.values[key],
        defaultValue: MAKEUP_PICK_DEFAULT[sel.makeupPart],
        apply: (p, v) => setParam(p, key, v),
      };
    }
  }
}

/** Accent dot on a tab when anything in its group differs from neutral. */
export function tabHasValue(params: BeautyParams, tab: TabId): boolean {
  switch (tab) {
    case 'preset':
      return false;
    case 'filter':
      return params.filterId !== 'none';
    case 'skin':
    case 'shape':
    case 'makeup':
      return paramsInGroup(tab).some((d) => hasValue(d, params.values[d.id]));
  }
}
