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
  setBodyProtect,
  setFilter,
  setHeightBand,
  setParam,
  setPresetAmount,
  setShade,
  applyPreset,
} from '../engine/params';
import type { BeautyParams, HeightBand, ParamId, PresetId, RegionStatus } from '../types';

export type TabId = 'preset' | 'skin' | 'shape' | 'body' | 'filter' | 'makeup';
export type MakeupPart = 'lip' | 'blush';
/** what the 美體 strip has selected: one of the 10 body sliders, or the manual 增高 tool */
export type BodySel = ParamId | 'height';

export const TABS: readonly { id: TabId; label: string }[] = [
  { id: 'preset', label: '一鍵' },
  { id: 'skin', label: '美膚' },
  { id: 'shape', label: '美型' },
  { id: 'body', label: '美體' },
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
  body: BodySel;
  makeupPart: MakeupPart;
}

export const INITIAL_SELECTION: PanelSelection = {
  tab: 'skin',
  skin: 'skin.smooth',
  shape: 'shape.eyeEnlarge',
  body: 'body.legs',
  makeupPart: 'lip',
};

// ───────────── 美體 context (fed by the screen: Editor detects, Camera is unsupported) ─────────────

export type BodyStatus = 'idle' | 'loading' | 'ready' | 'none' | 'error' | 'unsupported';

export interface BodyContext {
  /**
   * idle: detection not started yet · loading: pose model download (progress) / detection running ·
   * ready: detected (availability decides per slider) · none: no person · error: detection failed ·
   * unsupported: 美體 is not offered here (live camera)
   */
  status: BodyStatus;
  /** model download 0..1 while loading; undefined / ≥ 1 → detecting */
  progress?: number;
  /**
   * per-slider gate (paramAvailability of src/body/measure.ts); only consulted while ready (the other statuses
   * gate every detection-driven slider with this module's own reasons)
   */
  availability(id: ParamId): RegionStatus;
  /** people detected (≥ 2 → hint that only the main person, the large one near the centre, is edited) */
  people: number;
  /**
   * a person mask exists (背景保護 needs it: without one it would silently do nothing, e.g. the CPU pose fallback
   * runs without segmentation masks); undefined → assume yes
   */
  hasMask?: boolean;
  /** retry after status 'error' (shows a 重試 button in the strip note) */
  retry?(): void;
  /** why status 'error' happened, in friendly words (no network, timeout…): shown in the strip note */
  message?: string;
  /** any other button for the note (e.g. the camera's 匯入照片 next to 「美體目前僅支援照片編輯」) */
  action?: { label: string; run(): void };
  /** where a new 增高 band starts (e.g. hip → ankle of the detected person); default DEFAULT_BAND */
  suggestedBand?: { top: number; bottom: number };
}

export const BODY_UNSUPPORTED_NOTE = '美體目前僅支援照片編輯';
/** matches selectPerson (src/tracking/bodyTracker.ts): the person with the largest area × centrality */
export const BODY_MULTI_NOTE = '偵測到多人，僅調整畫面中央的主要人物';
/** 背景保護 while the detection has no person mask */
export const BODY_NO_MASK_REASON = '無法取得人像輪廓，背景保護暫不可用';
export const BODY_NONE_NOTE = '未偵測到人物，仍可使用手動增高';
export const BODY_ERROR_NOTE = '美體偵測失敗，仍可使用手動增高';
/** a detection-driven slider before the detection has finished */
export const BODY_WAIT_REASON = '美體偵測完成後即可調整';

/** the live camera: the 美體 tab exists (same six tabs everywhere) but every item is off */
export const CAMERA_BODY: BodyContext = {
  status: 'unsupported',
  availability: () => ({ ok: false, reason: BODY_UNSUPPORTED_NOTE }),
  people: 0,
};

/** a new 增高 band before the user drags it: roughly the legs of a centred full-body shot */
export const DEFAULT_BAND = { top: 0.52, bottom: 0.86 } as const;

const IDLE_BODY: BodyContext = { status: 'idle', availability: () => ({ ok: true, reason: null }), people: 0 };

/** The strip note for the 美體 tab (null → none), with an optional progress bar (0..1 or indeterminate). */
export interface BodyNote {
  text: string;
  tone: 'info' | 'progress' | 'warn';
  progress?: number | 'indeterminate';
  /** button under the text: 重試 after an error, or the context's own action */
  action?: { label: string; run(): void };
}

export function bodyNote(body: BodyContext | undefined): BodyNote | null {
  const b = body ?? IDLE_BODY;
  switch (b.status) {
    case 'unsupported':
      return { text: BODY_UNSUPPORTED_NOTE, tone: 'info', action: b.action };
    case 'idle':
      return { text: '準備偵測人物…', tone: 'progress', progress: 'indeterminate' };
    case 'loading': {
      const p = b.progress;
      if (p !== undefined && Number.isFinite(p) && p < 1) {
        const v = Math.min(1, Math.max(0, p));
        return { text: `下載美體模型 ${Math.floor(v * 100)}%`, tone: 'progress', progress: v };
      }
      return { text: '正在偵測人物…', tone: 'progress', progress: 'indeterminate' };
    }
    case 'none':
      return { text: BODY_NONE_NOTE, tone: 'warn' };
    case 'error': {
      const text = b.message ? `美體偵測失敗（${b.message}），仍可使用手動增高` : BODY_ERROR_NOTE;
      return { text, tone: 'warn', action: b.retry ? { label: '重試', run: b.retry } : b.action };
    }
    case 'ready':
      return b.people >= 2 ? { text: BODY_MULTI_NOTE, tone: 'info' } : null;
  }
}

/**
 * Gate of one 美體 item. 增高 / 背景保護 / 原圖 need no detection, so only 'unsupported' turns them off, plus
 * 背景保護 once a finished detection turns out to have no person mask (it would be a silent no-op).
 */
function bodyGate(body: BodyContext | undefined, item: BodySel | 'protect' | 'reset'): RegionStatus {
  const b = body ?? IDLE_BODY;
  if (b.status === 'unsupported') return { ok: false, reason: BODY_UNSUPPORTED_NOTE };
  if (item === 'protect' && b.status === 'ready' && b.hasMask === false) return { ok: false, reason: BODY_NO_MASK_REASON };
  if (item === 'height' || item === 'protect' || item === 'reset') return { ok: true, reason: null };
  switch (b.status) {
    case 'idle':
    case 'loading':
      return { ok: false, reason: BODY_WAIT_REASON };
    case 'none':
      return { ok: false, reason: BODY_NONE_NOTE };
    case 'error':
      // the cause (b.message) is in the strip note; the per-item toast stays short
      return { ok: false, reason: BODY_ERROR_NOTE };
    case 'ready': {
      const r = b.availability(item);
      return r.ok ? { ok: true, reason: null } : { ok: false, reason: r.reason ?? '此照片無法使用這個效果' };
    }
  }
}

/** The 增高 band overlay is up while the 增高 tool is the selected 美體 item (and 美體 is offered at all). */
export function showsHeightBand(sel: PanelSelection, body: BodyContext | undefined): boolean {
  return sel.tab === 'body' && sel.body === 'height' && (body ?? IDLE_BODY).status !== 'unsupported';
}

/** The band the overlay shows: the stored one, else where a new one would start (amount 0). */
export function bandOrSuggested(params: BeautyParams, body: BodyContext | undefined): HeightBand {
  if (params.heightBand) return params.heightBand;
  const s = body?.suggestedBand ?? DEFAULT_BAND;
  return { top: s.top, bottom: s.bottom, amount: 0 };
}

// ───────────── items ─────────────

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
  | { type: 'shade'; part: MakeupPart; shade: string | null }
  /** 美體: select the manual 增高 tool (the screen shows HeightBandOverlay) */
  | { type: 'height' }
  /** 美體: toggle 背景保護 */
  | { type: 'protect' };

export interface PanelItem {
  key: string;
  label: string;
  visual: ItemVisual;
  selected: boolean;
  /** 4 px accent dot */
  hasValue: boolean;
  action: ItemAction;
  /** dimmed; tapping shows `reason` instead of acting */
  disabled: boolean;
  /** 繁體中文 reason shown when a disabled item is tapped */
  reason: string | null;
  /** on/off items (背景保護): current state; undefined for everything else */
  pressed?: boolean;
}

const ENABLED = { disabled: false, reason: null } as const;

const RESET_ITEM = (label = '原圖'): PanelItem => ({
  key: 'reset',
  label,
  visual: { kind: 'icon', icon: 'none' },
  selected: false,
  hasValue: false,
  action: { type: 'reset' },
  ...ENABLED,
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

function gated(item: PanelItem, gate: RegionStatus): PanelItem {
  return gate.ok ? item : { ...item, selected: false, disabled: true, reason: gate.reason };
}

function bandActive(params: BeautyParams): boolean {
  return !!params.heightBand && params.heightBand.amount > 0.01;
}

/** ⊘ 原圖 · 增高 · the 10 sliders (PixPretty order) · 背景保護. 增高 sits next to 長腿: both lengthen the legs. */
function bodyItems(params: BeautyParams, sel: PanelSelection, body: BodyContext | undefined): PanelItem[] {
  const height: PanelItem = {
    key: 'height',
    label: '增高',
    visual: { kind: 'icon', icon: 'height' },
    selected: sel.body === 'height',
    hasValue: bandActive(params),
    action: { type: 'height' },
    ...ENABLED,
  };
  const sliders = paramsInGroup('body').map(
    (d): PanelItem =>
      gated(
        {
          key: d.id,
          label: d.label,
          visual: { kind: 'icon', icon: d.icon },
          selected: sel.body === d.id,
          hasValue: hasValue(d, params.values[d.id]),
          action: { type: 'param', id: d.id },
          ...ENABLED,
        },
        bodyGate(body, d.id),
      ),
  );
  const protect: PanelItem = {
    key: 'protect',
    label: '背景保護',
    visual: { kind: 'icon', icon: params.bodyProtect ? 'protect' : 'protectOff' },
    selected: false,
    hasValue: false,
    action: { type: 'protect' },
    pressed: params.bodyProtect,
    ...ENABLED,
  };
  return [
    gated(RESET_ITEM(), bodyGate(body, 'reset')),
    gated(height, bodyGate(body, 'height')),
    ...sliders,
    gated(protect, bodyGate(body, 'protect')),
  ];
}

export function itemsFor(params: BeautyParams, sel: PanelSelection, body?: BodyContext): PanelItem[] {
  switch (sel.tab) {
    case 'preset': {
      const items: PanelItem[] = PRESETS.map((p) => ({
        key: p.id,
        label: p.label,
        visual: { kind: 'icon', icon: PRESET_ICON[p.id] },
        selected: params.presetId === p.id,
        hasValue: false,
        action: { type: 'preset', id: p.id },
        ...ENABLED,
      }));
      if (params.presetId === 'custom') {
        items.push({
          key: 'custom',
          label: '自訂',
          visual: { kind: 'icon', icon: 'custom' },
          selected: true,
          hasValue: false,
          action: { type: 'custom' },
          ...ENABLED,
        });
      }
      return items;
    }
    case 'skin':
    case 'shape':
      return [
        RESET_ITEM(),
        ...paramsInGroup(sel.tab).map(
          (d): PanelItem => ({
            key: d.id,
            label: d.label,
            visual: { kind: 'icon', icon: d.icon },
            selected: sel[sel.tab as 'skin' | 'shape'] === d.id,
            hasValue: hasValue(d, params.values[d.id]),
            action: { type: 'param', id: d.id },
            ...ENABLED,
          }),
        ),
      ];
    case 'body':
      return bodyItems(params, sel, body);
    case 'filter':
      return FILTERS.map((f) => ({
        key: f.id,
        label: f.label,
        visual: f.id === 'none' ? { kind: 'icon', icon: 'none' } : { kind: 'thumb', src: `/luts/filters/${f.id}_thumb.png` },
        selected: params.filterId === f.id,
        hasValue: false,
        action: { type: 'filter', id: f.id },
        ...ENABLED,
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
          ...ENABLED,
        },
        ...shades.map(
          (s): PanelItem => ({
            key: s.id,
            label: s.label,
            visual: { kind: 'swatch', color: s.color },
            selected: on && shade === s.id,
            hasValue: false,
            action: { type: 'shade', part, shade: s.id },
            ...ENABLED,
          }),
        ),
      ];
    }
  }
}

export interface ActivateResult {
  params: BeautyParams;
  sel: PanelSelection;
  /** false when nothing changed (no undo entry, no haptic) */
  changed: boolean;
  /** text to show as a toast (a disabled item's reason, or what a toggle just did) */
  notice?: string;
}

function bodyIsNeutral(params: BeautyParams): boolean {
  return params.heightBand === null && paramsInGroup('body').every((d) => !hasValue(d, params.values[d.id]));
}

export function activate(item: PanelItem, params: BeautyParams, sel: PanelSelection): ActivateResult {
  const a = item.action;
  const done = (next: BeautyParams, nextSel = sel, notice?: string): ActivateResult => ({
    params: next,
    sel: nextSel,
    changed: next !== params || nextSel !== sel,
    ...(notice ? { notice } : {}),
  });
  if (item.disabled) return done(params, sel, item.reason ?? undefined);
  switch (a.type) {
    case 'custom':
      return done(params);
    case 'preset': {
      if (params.presetId === a.id) return done(params);
      // keep the user's 程度 when hopping between presets; 美體 is not part of any preset, so it is kept too
      const keep = params.presetId !== 'custom' && params.presetId !== 'original' && a.id !== 'original';
      return done(applyPreset(a.id, keep ? params.presetAmount : 1, params));
    }
    case 'reset':
      if (sel.tab === 'makeup') {
        const key = makeupKey(sel.makeupPart);
        // already off: tapping the selected 無 is a no-op (no haptic, no undo step, no flip to 自訂)
        if (params.values[key] <= 0.01 && shadeOf(params, sel.makeupPart) === null) return done(params);
        const cleared = setParam(params, key, 0);
        return done(sel.makeupPart === 'lip' ? { ...cleared, lipShade: null } : { ...cleared, blushShade: null });
      }
      // body reset keeps the preset, so an already-neutral body would be an empty undo step
      if (sel.tab === 'body') return bodyIsNeutral(params) ? done(params) : done(resetGroup(params, 'body'));
      if (sel.tab === 'skin' || sel.tab === 'shape' || sel.tab === 'filter') return done(resetGroup(params, sel.tab));
      return done(params);
    case 'param':
      if (sel.tab === 'body') return done(params, sel.body === a.id ? sel : { ...sel, body: a.id });
      return done(params, sel.tab === 'shape' ? { ...sel, shape: a.id } : { ...sel, skin: a.id });
    case 'height':
      return done(params, sel.body === 'height' ? sel : { ...sel, body: 'height' });
    case 'protect': {
      const on = !params.bodyProtect;
      // the measured trade (src/body/straightness.test.ts BODY, slim+waist vs slim+waist_noprotect): on keeps the
      // background deformation in a narrower ring beside the person; off spreads it wider and gentler. Line bend
      // is about the same either way, so neither notice promises straight lines or a smoother outline
      return done(
        setBodyProtect(params, on),
        sel,
        on ? '背景保護已開啟：背景變形範圍較小' : '背景保護已關閉：背景變形範圍較大但較平緩',
      );
    }
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

/** 增高 slider: writes the band amount, creating the band where the overlay shows it when there is none yet. */
function heightBinding(params: BeautyParams, body: BodyContext | undefined): SliderBinding {
  return {
    key: 'body.height',
    label: '增高',
    bidirectional: false,
    value: params.heightBand?.amount ?? 0,
    defaultValue: 0,
    apply: (p, v) => setHeightBand(p, { ...bandOrSuggested(p, body), amount: v }),
  };
}

export function sliderFor(params: BeautyParams, sel: PanelSelection, body?: BodyContext): SliderBinding | null {
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
    case 'body': {
      if (!bodyGate(body, sel.body).ok) return null;
      if (sel.body === 'height') return heightBinding(params, body);
      const d = paramDef(sel.body);
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

/** Accent dot on a tab when anything in its group differs from neutral (美體: a slider or the 增高 band). */
export function tabHasValue(params: BeautyParams, tab: TabId, body?: BodyContext): boolean {
  switch (tab) {
    case 'preset':
      return false;
    case 'filter':
      return params.filterId !== 'none';
    case 'body':
      if (body?.status === 'unsupported') return false;
      return bandActive(params) || paramsInGroup('body').some((d) => hasValue(d, params.values[d.id]));
    case 'skin':
    case 'shape':
    case 'makeup':
      return paramsInGroup(tab).some((d) => hasValue(d, params.values[d.id]));
  }
}
