// BeautyPanel logic (spec §7.3), kept pure so it can be unit-tested without a DOM.
import { BLUSH_SHADES, FILTERS, hasValue, LIP_SHADES, MAKEUP_PICK_DEFAULT, paramDef, paramsInGroup, PRESETS } from '../engine/params';
import type { Lens } from '../edit/lens';
import type { EditState, HeightBand, ParamId, PresetId, RegionStatus } from '../types';

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
export function bandOrSuggested(edit: EditState, body: BodyContext | undefined): HeightBand {
  if (edit.photo.heightBand) return edit.photo.heightBand;
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

function gated(item: PanelItem, gate: RegionStatus): PanelItem {
  return gate.ok ? item : { ...item, selected: false, disabled: true, reason: gate.reason };
}

function bandActive(edit: EditState): boolean {
  return !!edit.photo.heightBand && edit.photo.heightBand.amount > 0.01;
}

/** ⊘ 原圖 · 增高 · the 10 sliders (PixPretty order) · 背景保護. 增高 sits next to 長腿: both lengthen the legs. */
function bodyItems(lens: Lens, sel: PanelSelection, body: BodyContext | undefined): PanelItem[] {
  const edit = lens.edit;
  const height: PanelItem = {
    key: 'height',
    label: '增高',
    visual: { kind: 'icon', icon: 'height' },
    selected: sel.body === 'height',
    hasValue: bandActive(edit),
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
          hasValue: hasValue(d, lens.get(d.id).value),
          action: { type: 'param', id: d.id },
          ...ENABLED,
        },
        bodyGate(body, d.id),
      ),
  );
  const protect: PanelItem = {
    key: 'protect',
    label: '背景保護',
    visual: { kind: 'icon', icon: edit.photo.bodyProtect ? 'protect' : 'protectOff' },
    selected: false,
    hasValue: false,
    action: { type: 'protect' },
    pressed: edit.photo.bodyProtect,
    ...ENABLED,
  };
  return [gated(RESET_ITEM(), bodyGate(body, 'reset')), gated(height, bodyGate(body, 'height')), ...sliders, gated(protect, bodyGate(body, 'protect'))];
}

/** the preset the 一鍵 strip highlights: the targets' common preset; for a body-only person, the photo's link */
function shownPreset(lens: Lens): PresetId | 'custom' | null {
  const { ref, mixed } = lens.preset();
  if (ref === null) return lens.edit.photo.presetLink?.id ?? null;
  if (mixed) return null;
  return ref === 'custom' ? 'custom' : ref.id;
}

export function itemsFor(lens: Lens, sel: PanelSelection, body?: BodyContext): PanelItem[] {
  const edit = lens.edit;
  switch (sel.tab) {
    case 'preset': {
      const cur = shownPreset(lens);
      const items: PanelItem[] = PRESETS.map((p) => ({
        key: p.id,
        label: p.label,
        visual: { kind: 'icon', icon: PRESET_ICON[p.id] },
        selected: cur === p.id,
        hasValue: false,
        action: { type: 'preset', id: p.id },
        ...ENABLED,
      }));
      if (cur === 'custom') {
        items.push({ key: 'custom', label: '自訂', visual: { kind: 'icon', icon: 'custom' }, selected: true, hasValue: false, action: { type: 'custom' }, ...ENABLED });
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
            hasValue: hasValue(d, lens.get(d.id).value),
            action: { type: 'param', id: d.id },
            ...ENABLED,
          }),
        ),
      ];
    case 'body':
      return bodyItems(lens, sel, body);
    case 'filter':
      return FILTERS.map((f) => ({
        key: f.id,
        label: f.label,
        visual: f.id === 'none' ? { kind: 'icon', icon: 'none' } : { kind: 'thumb', src: `/luts/filters/${f.id}_thumb.png` },
        selected: edit.photo.filterId === f.id,
        hasValue: false,
        action: { type: 'filter', id: f.id },
        ...ENABLED,
      }));
    case 'makeup': {
      const part = sel.makeupPart;
      const s = lens.shade(part);
      const on = s.on && !s.mixed;
      const shades = part === 'lip' ? LIP_SHADES : BLUSH_SHADES;
      return [
        // exactly one item is selected in every unmixed state: 無 (off) · 原色 (on, no shade) · a shade
        { ...RESET_ITEM('無'), selected: !s.on && !s.mixed },
        { key: 'orig', label: '原色', visual: { kind: 'swatch', color: null }, selected: on && s.shade === null, hasValue: false, action: { type: 'shade', part, shade: null }, ...ENABLED },
        ...shades.map(
          (x): PanelItem => ({
            key: x.id,
            label: x.label,
            visual: { kind: 'swatch', color: x.color },
            selected: on && s.shade === x.id,
            hasValue: false,
            action: { type: 'shade', part, shade: x.id },
            ...ENABLED,
          }),
        ),
      ];
    }
  }
}

export interface ActivateResult {
  edit: EditState;
  sel: PanelSelection;
  /** false when nothing changed (no undo entry, no haptic) */
  changed: boolean;
  /** text to show as a toast (a disabled item's reason, or what a toggle just did) */
  notice?: string;
}

export function activate(item: PanelItem, lens: Lens, sel: PanelSelection): ActivateResult {
  const a = item.action;
  const edit = lens.edit;
  const done = (next: EditState = edit, nextSel = sel, notice?: string): ActivateResult => ({
    edit: next,
    sel: nextSel,
    changed: next !== edit || nextSel !== sel,
    ...(notice ? { notice } : {}),
  });
  if (item.disabled) return done(edit, sel, item.reason ?? undefined);
  switch (a.type) {
    case 'custom':
      return done();
    case 'preset': {
      const { ref, mixed } = lens.preset();
      const linked = edit.photo.presetLink?.id === a.id;
      // a no-op only when every target already has it (RM §3.3) and the photo part is it too (v0.3: presetId ===)
      if (linked && (ref === null || (ref !== 'custom' && !mixed && ref.id === a.id))) return done();
      // keep the user's 程度 when hopping between presets (not into or out of 原圖); 美體 is outside presets
      const amount = ref !== null && ref !== 'custom' && !mixed && ref.id !== 'original' && a.id !== 'original' && edit.photo.presetLink?.id === ref.id ? ref.amount : 1;
      return done(lens.applyPreset(a.id, amount));
    }
    case 'reset':
      if (sel.tab === 'makeup') {
        const s = lens.shade(sel.makeupPart);
        // already off everywhere: tapping the selected 無 is a no-op (no haptic, no undo step, no flip to 自訂)
        if (!s.on && s.shade === null && !s.mixed) return done();
        return done(lens.clearMakeup(sel.makeupPart));
      }
      // body reset keeps the preset, so an already-neutral body would be an empty undo step
      if (sel.tab === 'body') return lens.groupNeutral('body') ? done() : done(lens.resetGroup('body'));
      if (sel.tab === 'skin' || sel.tab === 'shape' || sel.tab === 'filter') return done(lens.resetGroup(sel.tab));
      return done();
    case 'param':
      if (sel.tab === 'body') return done(edit, sel.body === a.id ? sel : { ...sel, body: a.id });
      return done(edit, sel.tab === 'shape' ? { ...sel, shape: a.id } : { ...sel, skin: a.id });
    case 'height':
      return done(edit, sel.body === 'height' ? sel : { ...sel, body: 'height' });
    case 'protect': {
      const on = !edit.photo.bodyProtect;
      // the measured trade (src/body/straightness.test.ts BODY, slim+waist vs slim+waist_noprotect): on keeps the
      // background deformation in a narrower ring beside the person; off spreads it wider and gentler. Line bend
      // is about the same either way, so neither notice promises straight lines or a smoother outline
      return done(lens.setBodyProtect(on), sel, on ? '背景保護已開啟：背景變形範圍較小' : '背景保護已關閉：背景變形範圍較大但較平緩');
    }
    case 'filter':
      if (edit.photo.filterId === a.id) return done();
      return done(lens.setFilter(a.id));
    case 'shade': {
      const s = lens.shade(a.part);
      if (s.on && !s.mixed && s.shade === a.shade) return done();
      return done(lens.setShade(a.part, a.shade));
    }
  }
}

export interface SliderBinding {
  /** changes when the slider targets a different value (resets drag state) */
  key: string;
  /** the ParamId the slider writes; null for 程度 and 增高 */
  param: ParamId | null;
  label: string;
  bidirectional: boolean;
  value: number;
  /** the targets disagree under 全部 (the label adds 各人不同, Task 22) */
  mixed: boolean;
  /** recommended-default dot / double-tap target */
  defaultValue: number;
  apply(lens: Lens, v: number): EditState;
}

/** 增高 slider: writes the band amount, creating the band where the overlay shows it when there is none yet. */
function heightBinding(edit: EditState, body: BodyContext | undefined): SliderBinding {
  return {
    key: 'body.height',
    param: null,
    label: '增高',
    bidirectional: false,
    value: edit.photo.heightBand?.amount ?? 0,
    mixed: false,
    defaultValue: 0,
    apply: (l, v) => l.setHeightBand({ ...bandOrSuggested(l.edit, body), amount: v }),
  };
}

function paramBinding(lens: Lens, id: ParamId): SliderBinding {
  const d = paramDef(id);
  const g = lens.get(id);
  return { key: d.id, param: d.id, label: d.label, bidirectional: d.bidirectional, value: g.value, mixed: g.mixed, defaultValue: d.default, apply: (l, v) => l.set(d.id, v) };
}

export function sliderFor(lens: Lens, sel: PanelSelection, body?: BodyContext): SliderBinding | null {
  const edit = lens.edit;
  switch (sel.tab) {
    case 'preset': {
      const { ref, mixed } = lens.preset();
      const link = edit.photo.presetLink;
      const id = ref === null ? (link?.id ?? null) : ref !== 'custom' && !mixed ? ref.id : null;
      if (id === null || id === 'original') return null;
      const value = ref !== null && ref !== 'custom' ? ref.amount : (link?.amount ?? 1);
      return { key: `preset.${id}`, param: null, label: '程度', bidirectional: false, value, mixed: false, defaultValue: 1, apply: (l, v) => l.setPresetAmount(v) };
    }
    case 'skin':
    case 'shape':
      return paramBinding(lens, sel[sel.tab]);
    case 'body':
      if (!bodyGate(body, sel.body).ok) return null;
      return sel.body === 'height' ? heightBinding(edit, body) : paramBinding(lens, sel.body);
    case 'filter': {
      if (edit.photo.filterId === 'none') return null;
      const f = FILTERS.find((x) => x.id === edit.photo.filterId);
      return { ...paramBinding(lens, 'filter.amount'), key: `filter.${edit.photo.filterId}`, label: '濾鏡強度', defaultValue: f?.defaultAmount ?? 0.5 };
    }
    case 'makeup': {
      // always shown: dragging to 0 must not unmount the slider mid-gesture; raising it from 0 applies 原色
      const b = paramBinding(lens, makeupKey(sel.makeupPart));
      return { ...b, label: sel.makeupPart === 'lip' ? '口紅' : '腮紅', defaultValue: MAKEUP_PICK_DEFAULT[sel.makeupPart] };
    }
  }
}

/** Accent dot on a tab when anything in its group differs from neutral (美體: a slider or the 增高 band). */
export function tabHasValue(lens: Lens, tab: TabId, body?: BodyContext): boolean {
  switch (tab) {
    case 'preset':
      return false;
    case 'filter':
      return lens.edit.photo.filterId !== 'none';
    case 'body':
      if (body?.status === 'unsupported') return false;
      return bandActive(lens.edit) || lens.groupHasValue('body');
    case 'skin':
    case 'shape':
    case 'makeup':
      return lens.groupHasValue(tab);
  }
}
