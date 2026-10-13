// BeautyPanel logic (spec §7.3), kept pure so it can be unit-tested without a DOM.
import { BLUSH_SHADES, FILTERS, hasValue, LIP_SHADES, MAKEUP_PICK_DEFAULT, neutralValue, paramDef, paramsInGroup, PRESETS } from '../engine/params';
import { lookDef, LOOKS, lookThumbUrl } from '../engine/looks';
import { NO_BODY_NOTE, NO_FACE_NOTE, type Lens } from '../edit/lens';
import { adjustIsNeutral, personOf } from '../edit/state';
import type { CropLock } from '../geometry/view';
import type { AdjustId, EditState, HeightBand, LookId, ParamDef, ParamId, PersonId, PersonParamId, PhotoParams, PresetId, RegionStatus } from '../types';
import type { CropAction } from './cropPanel';

export type TabId = 'preset' | 'skin' | 'shape' | 'body' | 'filter' | 'makeup' | 'adjust' | 'crop';
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
  { id: 'adjust', label: '調節' },
];

/** the photo editor's tabs: the shared 7 plus 裁切 (C §2.1; the camera has none, C §2.4) */
export const EDITOR_TABS: readonly { id: TabId; label: string }[] = [...TABS, { id: 'crop', label: '裁切' }];

export const MAKEUP_PARTS: readonly { id: MakeupPart; label: string }[] = [
  { id: 'lip', label: '口紅' },
  { id: 'blush', label: '腮紅' },
];

/** 一鍵's parts (step-2 spec §2.2): the beauty presets (person-level) and the 質感 looks (photo-level) */
export type PresetPart = 'beauty' | 'look';
export const PRESET_PARTS: readonly { id: PresetPart; label: string; icon: string }[] = [
  { id: 'beauty', label: '美顏', icon: 'presetGlow' },
  { id: 'look', label: '質感', icon: 'look' },
];

export interface PanelSelection {
  tab: TabId;
  skin: ParamId;
  shape: ParamId;
  body: BodySel;
  makeupPart: MakeupPart;
  adjust: AdjustId;
  presetPart: PresetPart;
  /** the 裁切 ratio lock (UI state: derived from the crop on entering the tab and after ↶ ↷, S §2.1) */
  crop: CropLock;
}

export const INITIAL_SELECTION: PanelSelection = {
  tab: 'skin',
  skin: 'skin.smooth',
  shape: 'shape.eyeEnlarge',
  body: 'body.legs',
  makeupPart: 'lip',
  adjust: 'adjust.brightness',
  presetPart: 'beauty',
  crop: 'free',
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
  /** body persons in the photo */
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
  /** the person 長腿 is measured on (Editor: legsAnchor, else the primary with a body) */
  legsAnchor?: PersonId | null;
}

export const BODY_UNSUPPORTED_NOTE = '美體目前僅支援照片編輯';
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
      return null;
  }
}

export const PHOTO_BADGE = '整張';
export const PHOTO_SCOPE = '整張照片';
export const MIXED = '各人不同';
export const BANDS_NOTE = '增高、長腿會拉伸整排畫面，套用於整張照片';
export const legsAnchorNote = (n: number): string => `長腿以人物 ${n} 的腿長為準，套用於整張照片`;

/** ≥ 2 persons: the person / photo distinction shows (labels, badges, notes, strip) */
export const multiPerson = (lens: Lens): boolean => lens.persons.length >= 2;
/** a person's number: position in the cache's display order + 1, never derived from the id (S §2.1) */
export const personNumber = (lens: Lens, id: PersonId): number => lens.persons.findIndex((p) => p.id === id) + 1;
/** slider identity: a person switch must reset the drag state and the double-tap timer (S §2.4) */
export const selKey = (lens: Lens): string => (lens.sel.kind === 'all' ? 'all' : lens.sel.id);

export interface PersonNote {
  text: string;
  /** the whole strip is off (美型, 美妝); else an info line above usable items (一鍵, 美膚) */
  dim: boolean;
}

/**
 * S §2.4: a body-only person on a face tab. 美體 has bodyNoteFor; 濾鏡 / 調節 / 裁切 are photo-level; 全部 has no person note.
 * A photo without a face has none either: the all-skin exception wins on 美膚 / 一鍵, and 美型 / 美妝 show the
 * Editor's photo-level faceNote.
 */
export function personNote(tab: TabId, lens: Lens): PersonNote | null {
  if (!multiPerson(lens) || lens.noFace || lens.sel.kind !== 'person' || tab === 'body' || tab === 'filter' || tab === 'adjust' || tab === 'crop') return null;
  const id = lens.sel.id;
  const me = lens.persons.find((p) => p.id === id);
  if (!me || me.face) return null;
  return { text: NO_FACE_NOTE, dim: tab === 'shape' || tab === 'makeup' };
}

/** S §2.4 美體 note, the first that applies: detection status · the selected person has no body · bands / 長腿 anchor */
export function bodyNoteFor(body: BodyContext | undefined, lens: Lens, sel: PanelSelection): BodyNote | null {
  const status = bodyNote(body);
  if (status || !multiPerson(lens)) return status;
  if (lens.sel.kind === 'person') {
    const id = lens.sel.id;
    const me = lens.persons.find((p) => p.id === id);
    if (me && !me.body) return { text: NO_BODY_NOTE, tone: 'info' };
  }
  if (sel.body === 'height' || sel.body === 'body.legs') {
    const anchor = body?.legsAnchor ?? null;
    const n = anchor ? personNumber(lens, anchor) : 0;
    const bodies = lens.persons.filter((p) => p.body).length;
    if (sel.body === 'body.legs' && n > 0 && bodies >= 2) return { text: legsAnchorNote(n), tone: 'info' };
    return { text: BANDS_NOTE, tone: 'info' };
  }
  return null;
}

/**
 * A11: the chips and boxes dim while the tab or its active item is photo-level as the user sees it (the 整張 badge and
 * 「· 整張照片」 label: photoLike). So in a photo without a face 磨皮 / 紅潤 dim them too: they act on all skin through
 * the primary whoever is selected (S §2.4 美膚), and a chip tap would change nothing they do.
 */
export function photoScoped(sel: PanelSelection, lens: Lens): boolean {
  if (photoTabLabel(sel) !== null) return true;
  if (sel.tab === 'filter') return true;
  // 裁切 turns, flips and crops the whole photo (S §2.1 "Person strip: dimmed, with the caption 「整張照片」")
  if (sel.tab === 'crop') return true;
  if (sel.tab === 'skin') return photoLike(lens, sel.skin);
  if (sel.tab === 'body') return sel.body === 'height' || sel.body === 'body.legs';
  return false;
}

const isPhotoItem = (id: ParamId): boolean => paramDef(id).scope === 'photo';
/** photo-level as the user sees it: the photo scope, plus 磨皮 / 紅潤 in a photo without a face (all skin, RM §3.3) */
const photoLike = (lens: Lens, id: ParamId): boolean => isPhotoItem(id) || (lens.noFace && (id === 'skin.smooth' || id === 'skin.rosy'));
const badged = (lens: Lens, item: PanelItem): PanelItem => (multiPerson(lens) ? { ...item, badge: PHOTO_BADGE } : item);
/** ≥ 2 persons: a person item the selected person (or no 全部 target) can use; else no slider, never one that snaps back */
const usable = (lens: Lens, id: ParamId): boolean => !multiPerson(lens) || lens.applies(id).ok;

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

/**
 * Gate of a 美體 item, shared by its tile and its slider (so an enabled tile always has a slider). ≥ 2 persons with a
 * finished detection: the lens decides per person (its `available` reads each person's measure, S §2.4 "Availability
 * under 全部"); 長腿 is photo-level and keeps the anchor's availability (the context's).
 * The lens only says yes / no: when the target has a body (the selected person, or anyone under 全部), the reason is
 * the context measure's own (拍攝全身照…), never the no-body note; a face-only person keeps NO_BODY_NOTE.
 */
function bodyItemGate(lens: Lens, body: BodyContext | undefined, item: BodySel): RegionStatus {
  if (!(multiPerson(lens) && body?.status === 'ready' && item !== 'height' && item !== 'body.legs')) return bodyGate(body, item);
  const g = lens.applies(item);
  if (g.ok) return g;
  const sel = lens.sel;
  const hasBody = sel.kind === 'person' ? (lens.persons.find((p) => p.id === sel.id)?.body ?? false) : lens.persons.some((p) => p.body);
  if (hasBody) {
    const c = bodyGate(body, item);
    if (!c.ok) return c;
  }
  return g;
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
  | { kind: 'thumb'; src: string; /** icon under the image (shown when it fails to load); default 'filter' */ fallback?: string }
  /** null colour = 原色 (GPUPixel texture) */
  | { kind: 'swatch'; color: string | null }
  /** 裁切: a rectangle of the ratio's pixel aspect (width / height); null = 自由 (the dashed `free` icon) */
  | { kind: 'ratio'; aspect: number | null };

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
  | { type: 'protect' }
  /** 一鍵 › 質感: pick a look, or 無 (null) */
  | { type: 'look'; id: LookId | null }
  /** 裁切: a ratio, 旋轉, 翻轉 or 還原 (BeautyPanel hands it to the Editor through cropActivate, never to activate) */
  | { type: 'crop'; crop: CropAction };

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
  /** short tile badge: 「整張」 on photo-level items with ≥ 2 persons (A9; step 5 adds 「左右」) */
  badge?: string;
  /** a strip divider is drawn before this item (調節: light │ colour │ effects) */
  divider?: 'before';
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

/**
 * Item dot (S §2.4 Dots): with a person selected, that person's value (or the photo's); under 全部, any applicable
 * person's, not only the one the slider shows (lens.get reads the primary, or the first applicable person).
 */
function itemDot(lens: Lens, d: ParamDef): boolean {
  if (d.scope === 'photo' || lens.sel.kind !== 'all') return hasValue(d, lens.get(d.id).value);
  const t = lens.targets(d.id);
  return t.length ? t.some((pid) => hasValue(d, personOf(lens.edit, pid).values[d.id as PersonParamId])) : hasValue(d, lens.get(d.id).value);
}

/** The 美妝 part chip's dot (口紅 / 腮紅): the selected person's, or under 全部 any face person's (S §2.4 Dots). */
export function partHasValue(lens: Lens, part: MakeupPart): boolean {
  if (lens.sel.kind !== 'all') return lens.shade(part).on;
  const key = makeupKey(part) as PersonParamId;
  return lens.faceTargets().some((pid) => personOf(lens.edit, pid).values[key] > 0.01);
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
  const sliders = paramsInGroup('body').map((d): PanelItem => {
    const item = gated(
      {
        key: d.id,
        label: d.label,
        visual: { kind: 'icon', icon: d.icon },
        selected: sel.body === d.id,
        hasValue: itemDot(lens, d),
        action: { type: 'param', id: d.id },
        ...ENABLED,
      },
      bodyItemGate(lens, body, d.id),
    );
    return isPhotoItem(d.id) ? badged(lens, item) : item;
  });
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
  return [
    gated(RESET_ITEM(), bodyGate(body, 'reset')),
    gated(badged(lens, height), bodyGate(body, 'height')),
    ...sliders,
    gated(badged(lens, protect), bodyGate(body, 'protect')),
  ];
}

// ───────────── 調節 and 質感 (v0.4 step 2) ─────────────

/** the 調節 strip splits light │ colour │ effects: dividers before 色溫 and 褪色 (step-2 spec §2.1) */
const ADJUST_DIVIDERS: ReadonlySet<string> = new Set(['adjust.temperature', 'adjust.fade']);

/** ⊘ 原圖 · 亮度 … 暗角; `value` reads the user's stored value (lens.get(id).value) */
export function adjustItems(value: (id: AdjustId) => number, sel: PanelSelection): PanelItem[] {
  return [
    RESET_ITEM(),
    ...paramsInGroup('adjust').map(
      (d): PanelItem => ({
        key: d.id,
        label: d.label,
        visual: { kind: 'icon', icon: d.icon },
        selected: sel.adjust === d.id,
        hasValue: hasValue(d, value(d.id as AdjustId)),
        action: { type: 'param', id: d.id },
        ...(ADJUST_DIVIDERS.has(d.id) ? { divider: 'before' as const } : {}),
        ...ENABLED,
      }),
    ),
  ];
}

/** 無 · 膠片 · CCD · 直閃 · 藍調 · 電影感: exactly one selected (無 while no look), thumbnails over the look icon */
export function lookItems(look: PhotoParams['look']): PanelItem[] {
  return [
    { ...RESET_ITEM('無'), key: 'look.none', selected: look === null, action: { type: 'look', id: null } },
    ...LOOKS.map(
      (l): PanelItem => ({
        key: `look.${l.id}`,
        label: l.label,
        visual: { kind: 'thumb', src: lookThumbUrl(l.id), fallback: 'look' },
        selected: look?.id === l.id,
        hasValue: false,
        action: { type: 'look', id: l.id },
        ...ENABLED,
      }),
    ),
  ];
}

/** 調節 slider: −50…+50 or 0–100, double tap → neutral, no default dot, coloured tracks for 色溫 / 色調 */
export function adjustSlider(value: (id: AdjustId) => number, sel: PanelSelection): SliderBinding {
  const id = sel.adjust;
  const d = paramDef(id);
  return {
    key: id,
    param: id,
    label: d.label,
    bidirectional: d.bidirectional,
    value: value(id),
    mixed: false,
    defaultValue: neutralValue(d),
    hideDefault: true,
    ...(id === 'adjust.temperature' ? { track: 'temperature' as const } : id === 'adjust.tint' ? { track: 'tint' as const } : {}),
    apply: (lens, v) => lens.set(id, v),
  };
}

/** 質感 程度 (0–100, default dot at the look's defaultAmount); keyed by look so a hop resets the drag; none while 無 */
export function lookSlider(look: PhotoParams['look']): SliderBinding | null {
  if (!look) return null;
  const id = look.id;
  return {
    key: `look.${id}`,
    param: null,
    label: '程度',
    bidirectional: false,
    value: look.amount,
    mixed: false,
    defaultValue: lookDef(id)?.defaultAmount ?? 0.8,
    apply: (lens, v) => lens.setLook(id, v),
  };
}

export type LookActivation = { kind: 'none' } | { kind: 'retry'; id: LookId } | { kind: 'set'; id: LookId | null; amount: number };

/**
 * A tap in 一鍵 › 質感 (step-2 spec §2.2): from 無 a look starts at its default 程度; hopping keeps the 程度; the
 * selected look is a no-op unless its LUT failed (then the tap only retries the load); 無 clears.
 */
export function lookActivation(target: LookId | null, look: PhotoParams['look'], failed: (id: LookId) => boolean): LookActivation {
  if (target === null) return look === null ? { kind: 'none' } : { kind: 'set', id: null, amount: look.amount };
  if (look?.id === target) return failed(target) ? { kind: 'retry', id: target } : { kind: 'none' };
  return { kind: 'set', id: target, amount: look ? look.amount : (lookDef(target)?.defaultAmount ?? 0.8) };
}

/** 調節 tab dot: any of the 12 user values is not neutral */
export function adjustTabHasValue(value: (id: AdjustId) => number): boolean {
  return paramsInGroup('adjust').some((d) => hasValue(d, value(d.id as AdjustId)));
}

export interface PartButton {
  id: string;
  label: string;
  icon: string;
  active: boolean;
  hasValue: boolean;
}

/** The part row that leads the strip: 美妝's 口紅／腮紅 and 一鍵's 美顏／質感 (step-2 spec §2.2); null on other tabs. */
export function partButtons(sel: PanelSelection, state: { makeupOn(part: MakeupPart): boolean; look: PhotoParams['look'] }): PartButton[] | null {
  if (sel.tab === 'makeup')
    return MAKEUP_PARTS.map((p) => ({ id: p.id, label: p.label, icon: p.id, active: sel.makeupPart === p.id, hasValue: state.makeupOn(p.id) }));
  if (sel.tab === 'preset')
    return PRESET_PARTS.map((p) => ({ id: p.id, label: p.label, icon: p.icon, active: sel.presetPart === p.id, hasValue: p.id === 'look' && state.look !== null }));
  return null;
}

export function selectPart(sel: PanelSelection, id: string): PanelSelection {
  if (sel.tab === 'makeup') return { ...sel, makeupPart: id as MakeupPart };
  if (sel.tab === 'preset') return { ...sel, presetPart: id as PresetPart };
  return sel;
}

/** 調節's lead chip 「質感：{label}」 while a look is set; tapping it opens 一鍵 › 質感 (step-2 spec §2.1) */
export function leadChip(sel: PanelSelection, look: PhotoParams['look']): { label: string; target: PanelSelection } | null {
  if (sel.tab !== 'adjust' || !look) return null;
  const def = lookDef(look.id);
  return def ? { label: `質感：${def.label}`, target: { ...sel, tab: 'preset', presetPart: 'look' } } : null;
}

/**
 * Tabs whose every item acts on the whole photo (調節, 一鍵 › 質感; step-2 spec §2.1–2.2): the person strip dims with
 * 「整張照片」 (photoScoped), the face boxes hide (Editor), no per-person strip note (BeautyPanel). null → step 1's rules.
 */
export function photoTabLabel(sel: PanelSelection): '調節' | '質感' | null {
  if (sel.tab === 'adjust') return '調節';
  if (sel.tab === 'preset' && sel.presetPart === 'look') return '質感';
  return null;
}

/** shown once per look per session when its LUT cannot load (hooks.ts requestLut) */
export function lookFailedNotice(id: string): string {
  return `無法載入「${lookDef(id)?.label ?? id}」質感，請稍後再試`;
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
      if (sel.presetPart === 'look') return lookItems(lens.look());
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
        ...paramsInGroup(sel.tab).map((d): PanelItem => {
          const item: PanelItem = {
            key: d.id,
            label: d.label,
            visual: { kind: 'icon', icon: d.icon },
            selected: sel[sel.tab as 'skin' | 'shape'] === d.id,
            hasValue: itemDot(lens, d),
            action: { type: 'param', id: d.id },
            ...ENABLED,
          };
          const it = photoLike(lens, d.id) ? badged(lens, item) : item;
          // 美膚 gates per item (美白 / 銳化 stay usable for a body-only person); 美型 keeps the whole-strip dimming of
          // personNote, as v0.3 did for a photo without a face
          return multiPerson(lens) && sel.tab === 'skin' ? gated(it, lens.applies(d.id)) : it;
        }),
      ];
    case 'body':
      return bodyItems(lens, sel, body);
    case 'filter':
      return FILTERS.map((f) =>
        badged(lens, {
          key: f.id,
          label: f.label,
          visual: f.id === 'none' ? { kind: 'icon', icon: 'none' } : { kind: 'thumb', src: `/luts/filters/${f.id}_thumb.png` },
          selected: edit.photo.filterId === f.id,
          hasValue: false,
          action: { type: 'filter', id: f.id },
          ...ENABLED,
        }),
      );
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
    case 'adjust':
      return adjustItems((id) => lens.get(id).value, sel);
    case 'crop':
      // BeautyPanel draws cropItems (they need the geometry and the O size, which the lens does not carry)
      return [];
  }
}

export interface ActivateResult {
  edit: EditState;
  sel: PanelSelection;
  /** false when nothing changed (no undo entry, no haptic) */
  changed: boolean;
  /** text to show as a toast (a disabled item's reason, or what a toggle just did) */
  notice?: string;
  /** the tapped look is selected but its LUT failed: the screen retries the load (no edit, no undo step) */
  retryLook?: LookId;
}

/** what activate needs to know beyond the edit (step 2): whether a look's LUT failed (a re-tap then retries it) */
export interface ActivateContext {
  lookFailed?: (id: LookId) => boolean;
}

export function activate(item: PanelItem, lens: Lens, sel: PanelSelection, ctx: ActivateContext = {}): ActivateResult {
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
    case 'crop':
      // BeautyPanel sends 裁切 items to the Editor (cropActivate), never here
      return done();
    case 'look': {
      const r = lookActivation(a.id, lens.look(), (id) => ctx.lookFailed?.(id) ?? false);
      if (r.kind === 'retry') return { ...done(edit), retryLook: r.id };
      if (r.kind === 'none') return done(edit);
      return done(lens.setLook(r.id, r.amount));
    }
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
      if (sel.tab === 'adjust') return adjustIsNeutral(edit.photo) ? done(edit) : done(lens.resetGroup('adjust'));
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
      if (sel.tab === 'adjust') return done(edit, sel.adjust === a.id ? sel : { ...sel, adjust: a.id as AdjustId });
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

/** a slider's display scale (default: 0–100, or −50…+50 with snap ±3) */
export interface SliderScale {
  min: number;
  max: number;
  step: number;
  /** bidirectional: snap to the centre within ± this many display units */
  snap: number;
  suffix: string;
}

/** what the slider row shows; SliderBinding adds how a value writes the edit */
export interface SliderView {
  /** changes when the slider targets a different value (resets drag state) */
  key: string;
  label: string;
  /** aria-label (S §2.4): 「{label}，人物 {n}」 / 「{label}，全部」 / 「{label}，整張照片」; absent → label */
  aria?: string;
  bidirectional: boolean;
  value: number;
  /** the targets disagree under 全部 (the label adds 各人不同) */
  mixed?: boolean;
  /** recommended-default dot / double-tap target */
  defaultValue: number;
  /** 色溫 / 色調: a coloured track (CSS .track-temperature / .track-tint) */
  track?: 'temperature' | 'tint';
  /** no recommended-default dot (調節: neutral is the default) */
  hideDefault?: boolean;
  /** absent → 0–100 / −50…+50 (拉直: −45.0°…+45.0°) */
  scale?: SliderScale;
}

export interface SliderBinding extends SliderView {
  /** the ParamId the slider writes; null for 程度 and 增高 */
  param: ParamId | null;
  /** the targets disagree under 全部 (the label adds 各人不同, Task 22) */
  mixed: boolean;
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

/** ≥ 2 persons: the key carries the selection, photo items read 「· 整張照片」, aria names the target (S §2.4, A9) */
function decorate(b: SliderBinding, lens: Lens, photo: boolean): SliderBinding {
  if (!multiPerson(lens)) return b;
  const who = photo ? PHOTO_SCOPE : lens.sel.kind === 'all' ? '全部' : `人物 ${personNumber(lens, lens.sel.id)}`;
  return { ...b, key: `${selKey(lens)}:${b.key}`, label: photo ? `${b.label} · ${PHOTO_SCOPE}` : b.label, aria: `${b.label}，${who}` };
}

export function sliderFor(lens: Lens, sel: PanelSelection, body?: BodyContext): SliderBinding | null {
  const edit = lens.edit;
  switch (sel.tab) {
    case 'preset': {
      if (sel.presetPart === 'look') {
        const b = lookSlider(lens.look());
        return b && decorate(b, lens, true);
      }
      const { ref, mixed } = lens.preset();
      const link = edit.photo.presetLink;
      const id = ref === null ? (link?.id ?? null) : ref !== 'custom' && !mixed ? ref.id : null;
      if (id === null || id === 'original') return null;
      const value = ref !== null && ref !== 'custom' ? ref.amount : (link?.amount ?? 1);
      const b: SliderBinding = { key: `preset.${id}`, param: null, label: '程度', bidirectional: false, value, mixed: false, defaultValue: 1, apply: (l, v) => l.setPresetAmount(v) };
      return decorate(b, lens, false);
    }
    case 'skin':
    case 'shape': {
      const id = sel[sel.tab];
      if (!usable(lens, id)) return null;
      return decorate(paramBinding(lens, id), lens, photoLike(lens, id));
    }
    case 'body':
      // the tile's own gate: an item the selected person cannot use has no slider, an enabled one always has one
      if (!bodyItemGate(lens, body, sel.body).ok) return null;
      if (sel.body === 'height') return decorate(heightBinding(edit, body), lens, true);
      return decorate(paramBinding(lens, sel.body), lens, isPhotoItem(sel.body));
    case 'filter': {
      if (edit.photo.filterId === 'none') return null;
      const f = FILTERS.find((x) => x.id === edit.photo.filterId);
      return decorate({ ...paramBinding(lens, 'filter.amount'), key: `filter.${edit.photo.filterId}`, label: '濾鏡強度', defaultValue: f?.defaultAmount ?? 0.5 }, lens, true);
    }
    case 'makeup': {
      // always shown (one person, or a face person): dragging to 0 must not unmount the slider mid-gesture; raising it
      // from 0 applies 原色. A body-only person has no slider (no dead slider, Review Focus #2)
      const key = makeupKey(sel.makeupPart);
      if (!usable(lens, key)) return null;
      const b = paramBinding(lens, key);
      return decorate({ ...b, label: sel.makeupPart === 'lip' ? '口紅' : '腮紅', defaultValue: MAKEUP_PICK_DEFAULT[sel.makeupPart] }, lens, false);
    }
    case 'adjust':
      return decorate(adjustSlider((id) => lens.get(id).value, sel), lens, true);
    case 'crop':
      // 拉直 is bound by the Editor (straightenView: it writes the geometry, not a param)
      return null;
  }
}

/** the slider row's text when there is no slider: 程度 under 全部 with different presets (S §2.4) */
export function sliderEmptyText(lens: Lens, sel: PanelSelection): string | null {
  return sel.tab === 'preset' && sel.presetPart !== 'look' && lens.sel.kind === 'all' && lens.preset().mixed ? MIXED : null;
}

/**
 * 「{label}套用於整張照片」 on the first touch of each photo-level item in this editor (≥ 2 persons, S §2.4), whatever
 * input touched it; `id` keys `seen` (a ParamId, or 'height' / 'filter' / 'protect')
 */
function firstPhotoTouch(lens: Lens, seen: Set<string>, id: string, label: string): string | null {
  if (!multiPerson(lens) || seen.has(id)) return null;
  seen.add(id);
  return `${label}套用於整張照片`;
}

/** the first touch through a slider: a photo-level param, or 增高 */
export function photoTouchToast(b: SliderBinding, lens: Lens, seen: Set<string>): string | null {
  // 調節 and 質感: one first touch per tab, not per item (step-2 spec §2.1–2.2)
  if (b.param?.startsWith('adjust.')) return firstPhotoTouch(lens, seen, 'adjust', '調節');
  if (b.param === null && /(^|:)look\./.test(b.key)) return firstPhotoTouch(lens, seen, 'look', '質感');
  const id = b.param ?? (b.key.endsWith('body.height') ? 'height' : null);
  if (id === null || (id !== 'height' && !photoLike(lens, id))) return null;
  return firstPhotoTouch(lens, seen, id, id === 'height' ? '增高' : paramDef(id).label);
}

/** the first touch through the 增高 band overlay (its lines): the same item as the 增高 slider */
export function bandTouchToast(lens: Lens, seen: Set<string>): string | null {
  return firstPhotoTouch(lens, seen, 'height', '增高');
}

/** tiles whose tap writes a photo-level item (S §1.1 item 5): every 濾鏡 tile is the one item 濾鏡 */
const TILE_ITEMS: Partial<Record<ItemAction['type'], string>> = { filter: '濾鏡', protect: '背景保護', look: '質感' };

/**
 * The toast of a tile tap: the first touch of a photo-level item, when the tap changed it (a 濾鏡 tile, 背景保護), then
 * the tile's own notice (a disabled tile's reason, what 背景保護 now does) on a second line. No `seen` (the camera):
 * the notice only.
 */
export function tapToast(item: PanelItem, lens: Lens, r: ActivateResult, seen?: Set<string>): string | null {
  const label = TILE_ITEMS[item.action.type];
  const first = seen && label && r.edit !== lens.edit ? firstPhotoTouch(lens, seen, item.action.type, label) : null;
  if (first && r.notice) return `${first}\n${r.notice}`;
  return first ?? r.notice ?? null;
}

/** Accent dot on a tab when anything in its group differs from neutral (美體: a slider or the 增高 band). */
export function tabHasValue(lens: Lens, tab: TabId, body?: BodyContext): boolean {
  switch (tab) {
    case 'preset':
      return lens.look() !== null;
    case 'adjust':
      return adjustTabHasValue((id) => lens.get(id).value);
    case 'filter':
      return lens.edit.photo.filterId !== 'none';
    case 'body':
      if (body?.status === 'unsupported') return false;
      return bandActive(lens.edit) || lens.groupHasValue('body');
    case 'skin':
    case 'shape':
    case 'makeup':
      return lens.groupHasValue(tab);
    case 'crop':
      // BeautyPanel dots 裁切 from the geometry (not in the lens)
      return false;
  }
}
