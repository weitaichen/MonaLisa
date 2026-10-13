// Parameter schema, presets, filters and shades (spec §7.4, RB §5). Pure data + pure functions.
import type { BeautyParams, FilterDef, HeightBand, ParamDef, ParamGroup, ParamId, PresetDef, PresetId, ShadeDef } from '../types';

export const PARAM_DEFS: readonly ParamDef[] = [
  // 美膚 — 美白 / 銳化 are photo-level (the GPUPixel chain is not masked, composite.ts); 磨皮 / 紅潤 per person
  { id: 'skin.smooth', label: '磨皮', group: 'skin', bidirectional: false, default: 0.55, icon: 'smooth', scope: 'person', live: true },
  { id: 'skin.whiten', label: '美白', group: 'skin', bidirectional: false, default: 0.25, icon: 'whiten', scope: 'photo', live: true },
  { id: 'skin.rosy', label: '紅潤', group: 'skin', bidirectional: false, default: 0.25, icon: 'rosy', scope: 'person', live: true },
  { id: 'skin.sharpen', label: '銳化', group: 'skin', bidirectional: false, default: 0.2, icon: 'sharpen', scope: 'photo', live: true },
  // 美型
  { id: 'shape.eyeEnlarge', label: '大眼', group: 'shape', bidirectional: false, default: 0.2, icon: 'eye', scope: 'person', live: true },
  { id: 'shape.faceSlim', label: '瘦臉', group: 'shape', bidirectional: false, default: 0.15, icon: 'faceSlim', scope: 'person', live: true },
  { id: 'shape.faceV', label: 'V臉', group: 'shape', bidirectional: false, default: 0.1, icon: 'faceV', scope: 'person', live: true },
  { id: 'shape.faceNarrow', label: '窄臉', group: 'shape', bidirectional: false, default: 0, icon: 'faceNarrow', scope: 'person', live: true },
  { id: 'shape.chin', label: '下巴', group: 'shape', bidirectional: true, default: 0.5, icon: 'chin', scope: 'person', live: true },
  { id: 'shape.forehead', label: '額頭', group: 'shape', bidirectional: true, default: 0.5, icon: 'forehead', scope: 'person', live: true },
  { id: 'shape.noseSlim', label: '瘦鼻', group: 'shape', bidirectional: false, default: 0.1, icon: 'nose', scope: 'person', live: true },
  { id: 'shape.mouthSize', label: '嘴型', group: 'shape', bidirectional: true, default: 0.5, icon: 'mouth', scope: 'person', live: true },
  { id: 'shape.eyeDistance', label: '眼距', group: 'shape', bidirectional: true, default: 0.5, icon: 'eyeDistance', scope: 'person', live: true },
  // 美體 — all neutral by default and never part of a preset (body research report §參數). 長腿 is a row band, so
  // photo-level; the local items are per person. Editor only (live: false).
  // Order follows the recommended adjustment sequence: length first, then body/limbs, shoulders/neck last.
  { id: 'body.legs', label: '長腿', group: 'body', bidirectional: false, default: 0, icon: 'legs', scope: 'photo', live: false },
  { id: 'body.slim', label: '瘦身', group: 'body', bidirectional: false, default: 0, icon: 'bodySlim', scope: 'person', live: false },
  { id: 'body.waist', label: '細腰', group: 'body', bidirectional: false, default: 0, icon: 'waist', scope: 'person', live: false },
  { id: 'body.whr', label: '腰臀比', group: 'body', bidirectional: false, default: 0, icon: 'whr', scope: 'person', live: false },
  { id: 'body.hip', label: '美臀', group: 'body', bidirectional: true, default: 0.5, icon: 'hip', scope: 'person', live: false },
  { id: 'body.legSlim', label: '瘦腿', group: 'body', bidirectional: false, default: 0, icon: 'legSlim', scope: 'person', live: false },
  { id: 'body.arms', label: '瘦手臂', group: 'body', bidirectional: false, default: 0, icon: 'arms', scope: 'person', live: false },
  { id: 'body.shoulder', label: '直角肩', group: 'body', bidirectional: false, default: 0, icon: 'shoulder', scope: 'person', live: false },
  { id: 'body.neck', label: '天鵝頸', group: 'body', bidirectional: false, default: 0, icon: 'neck', scope: 'person', live: false },
  { id: 'body.head', label: '小頭', group: 'body', bidirectional: false, default: 0, icon: 'head', scope: 'person', live: false },
  // 濾鏡
  { id: 'filter.amount', label: '濾鏡強度', group: 'filter', bidirectional: false, default: 0.5, icon: 'filter', scope: 'photo', live: true },
  // 美妝
  { id: 'makeup.lip', label: '口紅', group: 'makeup', bidirectional: false, default: 0, icon: 'lip', scope: 'person', live: true },
  { id: 'makeup.blush', label: '腮紅', group: 'makeup', bidirectional: false, default: 0, icon: 'blush', scope: 'person', live: true },
  // 調節 — photo-level and live; neutral by default and never part of a beauty preset (step-2 spec §3.1)
  { id: 'adjust.brightness', label: '亮度', group: 'adjust', bidirectional: true, default: 0.5, icon: 'brightness', scope: 'photo', live: true },
  { id: 'adjust.exposure', label: '曝光', group: 'adjust', bidirectional: true, default: 0.5, icon: 'exposure', scope: 'photo', live: true },
  { id: 'adjust.contrast', label: '對比', group: 'adjust', bidirectional: true, default: 0.5, icon: 'contrast', scope: 'photo', live: true },
  { id: 'adjust.highlights', label: '高光', group: 'adjust', bidirectional: true, default: 0.5, icon: 'highlights', scope: 'photo', live: true },
  { id: 'adjust.shadows', label: '陰影', group: 'adjust', bidirectional: true, default: 0.5, icon: 'shadows', scope: 'photo', live: true },
  { id: 'adjust.temperature', label: '色溫', group: 'adjust', bidirectional: true, default: 0.5, icon: 'temperature', scope: 'photo', live: true },
  { id: 'adjust.tint', label: '色調', group: 'adjust', bidirectional: true, default: 0.5, icon: 'tint', scope: 'photo', live: true },
  { id: 'adjust.saturation', label: '飽和', group: 'adjust', bidirectional: true, default: 0.5, icon: 'saturation', scope: 'photo', live: true },
  { id: 'adjust.vibrance', label: '鮮艷度', group: 'adjust', bidirectional: true, default: 0.5, icon: 'vibrance', scope: 'photo', live: true },
  { id: 'adjust.fade', label: '褪色', group: 'adjust', bidirectional: false, default: 0, icon: 'fade', scope: 'photo', live: true },
  { id: 'adjust.grain', label: '顆粒', group: 'adjust', bidirectional: false, default: 0, icon: 'grain', scope: 'photo', live: true },
  { id: 'adjust.vignette', label: '暗角', group: 'adjust', bidirectional: false, default: 0, icon: 'vignette', scope: 'photo', live: true },
];

const DEF_BY_ID = new Map(PARAM_DEFS.map((d) => [d.id, d]));

export function paramDef(id: ParamId): ParamDef {
  const d = DEF_BY_ID.get(id);
  if (!d) throw new Error(`unknown param ${id}`);
  return d;
}

export function paramsInGroup(group: ParamGroup): ParamDef[] {
  return PARAM_DEFS.filter((d) => d.group === group);
}

export const FILTERS: readonly FilterDef[] = [
  { id: 'none', label: '無', defaultAmount: 0 },
  { id: 'natural', label: '自然', defaultAmount: 0.6 },
  { id: 'soft', label: '柔光', defaultAmount: 0.5 },
  { id: 'milktea', label: '奶茶', defaultAmount: 0.6 },
  { id: 'warm', label: '暖調', defaultAmount: 0.5 },
  { id: 'cool', label: '冷調', defaultAmount: 0.5 },
  { id: 'japanese', label: '日系', defaultAmount: 0.6 },
  { id: 'film', label: '膠片', defaultAmount: 0.6 },
  { id: 'mono', label: '黑白', defaultAmount: 1 },
];

/** null shade = 原色 (GPUPixel's original texture colour); these are the tinted alternatives. */
export const LIP_SHADES: readonly ShadeDef[] = [
  { id: 'coral', label: '珊瑚', color: '#F06A5B' },
  { id: 'bean', label: '豆沙', color: '#C9767A' },
  { id: 'rose', label: '玫瑰', color: '#D8456B' },
  { id: 'red', label: '正紅', color: '#D21F3C' },
  { id: 'orange', label: '蜜橘', color: '#F08A4B' },
];

export const BLUSH_SHADES: readonly ShadeDef[] = [
  { id: 'peach', label: '蜜桃', color: '#FF9E8A' },
  { id: 'pink', label: '粉紅', color: '#FF8FB1' },
  { id: 'apricot', label: '杏橘', color: '#FFB07A' },
  { id: 'rose', label: '玫瑰', color: '#E77A93' },
];

/** intensity applied when a lip / blush shade is first picked from 0 */
export const MAKEUP_PICK_DEFAULT = { lip: 0.5, blush: 0.4 } as const;

export function neutralValue(def: ParamDef): number {
  return def.bidirectional ? 0.5 : 0;
}

function neutralValues(): Record<ParamId, number> {
  return Object.fromEntries(PARAM_DEFS.map((d) => [d.id, neutralValue(d)])) as Record<ParamId, number>;
}

function defaultValues(): Record<ParamId, number> {
  return Object.fromEntries(PARAM_DEFS.map((d) => [d.id, d.default])) as Record<ParamId, number>;
}

function withValues(over: Partial<Record<ParamId, number>>): Record<ParamId, number> {
  return { ...neutralValues(), ...over };
}

export const PRESETS: readonly PresetDef[] = [
  { id: 'original', label: '原圖', values: neutralValues(), filterId: 'none', lipShade: null, blushShade: null },
  { id: 'natural', label: '自然', values: defaultValues(), filterId: 'none', lipShade: null, blushShade: null },
  {
    id: 'refined',
    label: '精緻',
    values: withValues({
      'skin.smooth': 0.7,
      'skin.whiten': 0.3,
      'skin.rosy': 0.3,
      'skin.sharpen': 0.2,
      'shape.eyeEnlarge': 0.4,
      'shape.faceSlim': 0.25,
      'shape.faceV': 0.3,
      'shape.faceNarrow': 0.1,
      'shape.chin': 0.4,
      'shape.forehead': 0.4,
      'shape.noseSlim': 0.3,
      'shape.mouthSize': 0.45,
      'filter.amount': 0.4,
    }),
    filterId: 'soft',
    lipShade: null,
    blushShade: null,
  },
  {
    id: 'glow',
    label: '氣色',
    values: withValues({
      'skin.smooth': 0.55,
      'skin.whiten': 0.25,
      'skin.rosy': 0.45,
      'skin.sharpen': 0.2,
      'shape.eyeEnlarge': 0.2,
      'shape.faceSlim': 0.15,
      'shape.faceV': 0.1,
      'shape.noseSlim': 0.1,
      'filter.amount': 0.4,
      'makeup.lip': 0.3,
      'makeup.blush': 0.3,
    }),
    filterId: 'warm',
    lipShade: 'bean',
    blushShade: 'peach',
  },
];

export function presetDef(id: PresetId): PresetDef {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`unknown preset ${id}`);
  return p;
}

// NaN → 0; ±Infinity clamp to the nearest end like any other out-of-range number
const clamp01 = (v: number) => (Number.isNaN(v) ? 0 : Math.min(1, Math.max(0, v)));

export function isBodyParam(id: ParamId): boolean {
  return paramDef(id).group === 'body';
}

/**
 * Preset values with every param's distance from neutral scaled by `amount` (程度).
 * 美體 is not part of any preset: body values, 背景保護 and the 增高 band are carried over from `keep`
 * (neutral / protect on / no band without it).
 */
export function applyPreset(id: PresetId, amount = 1, keep?: BeautyParams): BeautyParams {
  const p = presetDef(id);
  const a = clamp01(amount);
  const values = {} as Record<ParamId, number>;
  for (const d of PARAM_DEFS) {
    const n = neutralValue(d);
    values[d.id] = d.group === 'body' ? (keep ? keep.values[d.id] : n) : clamp01(n + (p.values[d.id] - n) * a);
  }
  return {
    values,
    filterId: p.filterId,
    lipShade: p.lipShade,
    blushShade: p.blushShade,
    presetId: id,
    presetAmount: a,
    bodyProtect: keep ? keep.bodyProtect : true,
    heightBand: keep ? keep.heightBand : null,
  };
}

export function defaultParams(): BeautyParams {
  return applyPreset('natural', 1);
}

/** 程度 slider: only meaningful while a preset is active; custom params are returned unchanged. */
export function setPresetAmount(params: BeautyParams, amount: number): BeautyParams {
  if (params.presetId === 'custom') return params;
  return applyPreset(params.presetId, amount, params);
}

/** Body params are outside the presets, so editing one keeps the active preset (and its 程度). */
export function setParam(params: BeautyParams, id: ParamId, value: number): BeautyParams {
  return {
    ...params,
    values: { ...params.values, [id]: clamp01(value) },
    presetId: isBodyParam(id) ? params.presetId : 'custom',
  };
}

/** Manual 增高 band; null turns it off. Normalized and clamped; a band thinner than 2% of the height is dropped. */
export function setHeightBand(params: BeautyParams, band: HeightBand | null): BeautyParams {
  return { ...params, heightBand: band ? cleanBand(band) : null };
}

export function setBodyProtect(params: BeautyParams, on: boolean): BeautyParams {
  return { ...params, bodyProtect: on };
}

export function cleanBand(b: HeightBand): HeightBand | null {
  const top = clamp01(Math.min(b.top, b.bottom));
  const bottom = clamp01(Math.max(b.top, b.bottom));
  if (!(bottom - top >= 0.02)) return null;
  return { top, bottom, amount: clamp01(b.amount) };
}

export function setFilter(params: BeautyParams, filterId: string): BeautyParams {
  const f = FILTERS.find((x) => x.id === filterId) ?? FILTERS[0];
  return {
    ...params,
    filterId: f.id,
    values: { ...params.values, 'filter.amount': f.id === 'none' ? params.values['filter.amount'] : f.defaultAmount },
    presetId: 'custom',
  };
}

export function setShade(params: BeautyParams, part: 'lip' | 'blush', shade: string | null): BeautyParams {
  const key = part === 'lip' ? 'makeup.lip' : 'makeup.blush';
  const cur = params.values[key];
  return {
    ...params,
    [part === 'lip' ? 'lipShade' : 'blushShade']: shade,
    values: { ...params.values, [key]: cur > 0.01 ? cur : MAKEUP_PICK_DEFAULT[part] },
    presetId: 'custom',
  };
}

/** ⊘ item: reset one group to neutral. */
export function resetGroup(params: BeautyParams, group: ParamGroup): BeautyParams {
  const values = { ...params.values };
  for (const d of paramsInGroup(group)) values[d.id] = neutralValue(d);
  // body is outside the presets, so resetting it keeps the active preset
  const next: BeautyParams = { ...params, values, presetId: group === 'body' ? params.presetId : 'custom' };
  if (group === 'filter') next.filterId = 'none';
  if (group === 'body') next.heightBand = null;
  if (group === 'makeup') {
    next.lipShade = null;
    next.blushShade = null;
  }
  return next;
}

export function hasValue(def: ParamDef, v: number): boolean {
  return def.bidirectional ? Math.abs(v - 0.5) > 0.01 : v > 0.01;
}

/** 0–100 for one-way, −50…+50 for bidirectional. */
export function displayValue(def: ParamDef, v: number): number {
  // + 0 turns -0 (e.g. 0.499 → -0) into 0 so sign checks / Object.is behave
  return (def.bidirectional ? Math.round(v * 100 - 50) : Math.round(v * 100)) + 0;
}

export function fromDisplay(def: ParamDef, n: number): number {
  return clamp01(def.bidirectional ? (n + 50) / 100 : n / 100);
}

/** Shader-space bidirectional value s = (v − 0.5)·2 ∈ [−1, 1]. */
export function signed(v: number): number {
  return (v - 0.5) * 2;
}

export function shadeColor(part: 'lip' | 'blush', shade: string | null): string | null {
  if (!shade) return null;
  return (part === 'lip' ? LIP_SHADES : BLUSH_SHADES).find((s) => s.id === shade)?.color ?? null;
}

/** Validate untrusted (stored) data, filling anything missing/invalid from defaults. */
export function sanitizeParams(raw: unknown): BeautyParams {
  const base = defaultParams();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<BeautyParams>;
  const values = { ...base.values };
  if (r.values && typeof r.values === 'object') {
    for (const d of PARAM_DEFS) {
      const v = (r.values as Record<string, unknown>)[d.id];
      if (typeof v === 'number' && Number.isFinite(v)) values[d.id] = clamp01(v);
    }
  }
  const presetIds = [...PRESETS.map((p) => p.id), 'custom'];
  const out: BeautyParams = {
    values,
    filterId: FILTERS.some((f) => f.id === r.filterId) ? (r.filterId as string) : base.filterId,
    lipShade: LIP_SHADES.some((s) => s.id === r.lipShade) ? (r.lipShade as string) : null,
    blushShade: BLUSH_SHADES.some((s) => s.id === r.blushShade) ? (r.blushShade as string) : null,
    presetId: presetIds.includes(r.presetId as string) ? (r.presetId as BeautyParams['presetId']) : base.presetId,
    presetAmount: typeof r.presetAmount === 'number' ? clamp01(r.presetAmount) : 1,
    bodyProtect: typeof r.bodyProtect === 'boolean' ? r.bodyProtect : true,
    heightBand: sanitizeBand(r.heightBand),
  };
  // A preset id only stands if the values still are that preset; otherwise the 一鍵 tab would
  // highlight a preset whose look differs (and 程度 would silently replace the stored values).
  if (out.presetId !== 'custom' && !matchesPreset(out, out.presetId)) out.presetId = 'custom';
  return out;
}

function matchesPreset(p: BeautyParams, id: PresetId): boolean {
  const ref = applyPreset(id, p.presetAmount, p);
  if (p.filterId !== ref.filterId || p.lipShade !== ref.lipShade || p.blushShade !== ref.blushShade) return false;
  return PARAM_DEFS.every((d) => Math.abs(p.values[d.id] - ref.values[d.id]) < 1e-6);
}

export function sanitizeBand(raw: unknown): HeightBand | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Partial<HeightBand>;
  if (![b.top, b.bottom, b.amount].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  return cleanBand(b as HeightBand);
}
