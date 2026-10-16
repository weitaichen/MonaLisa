// The v0.4 edit of one photo (RM §3.2–3.4): an immutable EditState with a photo layer and a person layer. Every change
// returns a new object and shares what it did not change, so UndoStack keeps states by reference ({clone: false}).
import { isLookId } from '../engine/looks';
import { adjustValuesNeutral } from '../engine/adjustMath';
import { applyPreset, FILTERS, neutralValue, PARAM_DEFS, paramsInGroup, PRESETS, sanitizeBand, SHADE_PARTS, SHADES as SHADE_DEFS } from '../engine/params';
import { clampStraighten, cropConstrain, cropValid, flipView, IDENTITY_GEOMETRY, isIdentity, rotateLeft } from '../geometry/view';
import { stableKey } from '../store/undo';
import { sanitizeStrokes } from './liquify';
import { sanitizeRight } from './sides';
import { remapSpotOwners, sanitizeSpots } from './spots';
import type {
  AdjustId,
  CameraLook,
  EditState,
  Geometry,
  LookId,
  PersonId,
  PersonParamId,
  PersonParams,
  PhotoParamId,
  PhotoParams,
  PresetId,
  PresetRef,
  ShadePart,
  Size,
  Stroke,
} from '../types';

export const P0: PersonId = 'p0';
export const LIVE: PersonId = 'live';
/** every id a person may carry (S §5.4) */
export const PERSON_ID = /^(f[0-5]|b[0-3]|p0|live)$/;
export const PHOTO_IDS: readonly PhotoParamId[] = PARAM_DEFS.filter((d) => d.scope === 'photo').map((d) => d.id as PhotoParamId);
export const PERSON_IDS: readonly PersonParamId[] = PARAM_DEFS.filter((d) => d.scope === 'person').map((d) => d.id as PersonParamId);
/** a beauty preset's person part: every person-level face item (RM §3.4); 美體 is never in a preset */
export const PRESET_PERSON_IDS: readonly PersonParamId[] = PERSON_IDS.filter((id) => !id.startsWith('body.'));
/** a beauty preset's photo part (besides filterId) */
export const PRESET_PHOTO_IDS: readonly PhotoParamId[] = ['skin.whiten', 'skin.sharpen', 'filter.amount'];

/** every 美妝 part at 原色 (眼線: 黑), the shades of a person nobody has picked a colour for */
export function emptyShades(): Record<ShadePart, string | null> {
  return { lip: null, blush: null, brow: null, eyeshadow: null, liner: null, lens: null };
}

/** the person part of preset `id` at 程度 `amount`, every 美體 item neutral */
export function personFromPreset(id: PresetId, amount: number): PersonParams {
  const p = applyPreset(id, amount);
  const values = {} as Record<PersonParamId, number>;
  for (const k of PERSON_IDS) values[k] = p.values[k];
  return { values, right: null, shades: { ...emptyShades(), lip: p.lipShade, blush: p.blushShade }, preset: { id, amount: p.presetAmount } };
}

/** 原圖: every value neutral (the template of persons the camera did not beautify) */
export function neutralPerson(): PersonParams {
  return personFromPreset('original', 1);
}

/** 自然 100: what 重置 gives every person */
export function naturalPerson(): PersonParams {
  return personFromPreset('natural', 1);
}

/** the 自然 photo part, everything else neutral or identity, the geometry included (重置, RM §3.4, C §12 #23) */
export function defaultPhoto(): PhotoParams {
  const p = applyPreset('natural', 1);
  const values = {} as Record<PhotoParamId, number>;
  for (const k of PHOTO_IDS) values[k] = p.values[k];
  return { values, filterId: p.filterId, look: null, presetLink: { id: 'natural', amount: 1 }, bodyProtect: true, heightBand: null, legsAnchor: null, geometry: IDENTITY_GEOMETRY, spots: [], strokes: [] };
}

/** the undo / output de-dupe key: stableKey with every stroke reduced to its id (C §3.4) */
export function editKey(edit: EditState): string {
  return stableKey({ ...edit, photo: { ...edit.photo, strokes: edit.photo.strokes.map((s) => s.id) } });
}

/** a person's params, or the template for a person the edit does not list yet */
export function personOf(edit: EditState, id: PersonId): PersonParams {
  return edit.persons[id] ?? edit.template;
}

export function withPhoto(edit: EditState, f: (p: PhotoParams) => PhotoParams): EditState {
  const photo = f(edit.photo);
  return photo === edit.photo ? edit : { ...edit, photo };
}

/** `f` applied to each listed person (a person the edit lacks starts from the template); the others are shared */
export function withPersons(edit: EditState, ids: readonly PersonId[], f: (p: PersonParams, id: PersonId) => PersonParams): EditState {
  if (!ids.length) return edit;
  const persons: Record<PersonId, PersonParams> = { ...edit.persons };
  for (const id of ids) persons[id] = f(personOf(edit, id), id);
  return { ...edit, persons };
}

/** the camera's edit: one person, 'live' (RM §3.7) */
export function cameraEdit(look: CameraLook): EditState {
  return { v: 2, photo: look.photo, persons: { [LIVE]: look.person }, template: look.person, primaryInit: null };
}

export function lookOf(edit: EditState): CameraLook {
  return { photo: edit.photo, person: personOf(edit, LIVE) };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const PRESET_IDS: ReadonlySet<string> = new Set(PRESETS.map((p) => p.id));
const SHADES: Record<ShadePart, ReadonlySet<string>> = Object.fromEntries(
  SHADE_PARTS.map((k): [ShadePart, ReadonlySet<string>] => [k, new Set(SHADE_DEFS[k].map((s) => s.id))]),
) as Record<ShadePart, ReadonlySet<string>>;

/**
 * The persons known now (display order) get their params (S §3.3 item 4): a person the edit has keeps its params; the
 * primary gets p0 (primaryInit plus every edit made meanwhile), else primaryInit, else the template; everyone else the
 * template. p0 stays only when it is the whole list (nobody found). `discardP0`: a camera seed matched no face, so the
 * look must not land on a face the camera did not beautify (S §3.4 C2). primaryInit becomes null.
 */
export function assignPersons(edit: EditState, ids: readonly PersonId[], primary: PersonId, opts: { discardP0?: boolean } = {}): EditState {
  const seed = opts.discardP0 ? edit.template : (edit.persons[P0] ?? edit.primaryInit ?? edit.template);
  const persons: Record<PersonId, PersonParams> = {};
  for (const id of ids) {
    const have = id === P0 ? undefined : edit.persons[id];
    persons[id] = have ?? (id === primary || id === P0 ? seed : edit.template);
  }
  const anchor = edit.photo.legsAnchor;
  const handed = edit.persons[P0] !== undefined && !ids.includes(P0);
  let legsAnchor = anchor;
  if (anchor === P0) legsAnchor = handed ? primary : ids.includes(P0) ? P0 : null;
  else if (anchor !== null && !ids.includes(anchor)) legsAnchor = null;
  const photo = legsAnchor === anchor ? edit.photo : { ...edit.photo, legsAnchor };
  return { ...edit, photo, persons, primaryInit: null };
}

/** old → new person ids (null = drop); persons absent from `map` keep their id; the 長腿 anchor and the spot owners follow (S §5.3, C §5.2) */
export function renamePersons(edit: EditState, map: Readonly<Record<PersonId, PersonId | null>>): EditState {
  const persons: Record<PersonId, PersonParams> = {};
  for (const [id, p] of Object.entries(edit.persons)) {
    const to = id in map ? map[id] : id;
    if (to !== null && !(to in persons)) persons[to] = p;
  }
  const la = edit.photo.legsAnchor;
  const legsAnchor = la === null ? null : la in map ? map[la] : la;
  const spots = remapSpotOwners(edit.photo.spots, (id) => (id in map ? map[id] : id));
  const spotsSame = spots.every((s, i) => s.owner === edit.photo.spots[i].owner);
  if (legsAnchor === la && spotsSame) return { ...edit, persons };
  return { ...edit, persons, photo: { ...edit.photo, legsAnchor, spots: spotsSame ? edit.photo.spots : spots } };
}

/** 重置 (RM §3.4): the 自然 photo part, every person 自然; the template stays. One undo step. */
export function resetAll(edit: EditState): EditState {
  const persons: Record<PersonId, PersonParams> = {};
  for (const id of Object.keys(edit.persons)) persons[id] = naturalPerson();
  return { ...edit, photo: defaultPhoto(), persons };
}

const clampAmount = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** 一鍵 › 質感 (step-2 spec §3.4): null clears it; the amount is clamped to 0..1. Unchanged → the same object. */
export function setLook(edit: EditState, id: LookId | null, amount: number): EditState {
  const cur = edit.photo.look;
  const next = id === null ? null : { id, amount: clampAmount(amount) };
  if (cur === next || (cur && next && cur.id === next.id && cur.amount === next.amount)) return edit;
  return { ...edit, photo: { ...edit.photo, look: next } };
}

/**
 * true when no 調節 item is drawn (the ⊘ no-op check, step-2 spec §2.1): the engine's own rule (adjustValuesNeutral),
 * which the item and tab dots read too (adjustItemActive), so ⊘ makes an undo step exactly when a dot shows
 */
export function adjustIsNeutral(photo: Pick<PhotoParams, 'values'>): boolean {
  return adjustValuesNeutral(photo.values);
}

/** ⊘ 原圖 in 調節: the 12 user values to neutral, the 質感 untouched. Already neutral → the same object. */
export function resetAdjust(edit: EditState): EditState {
  if (adjustIsNeutral(edit.photo)) return edit;
  const values = { ...edit.photo.values };
  for (const d of paramsInGroup('adjust')) values[d.id as AdjustId] = neutralValue(d);
  return { ...edit, photo: { ...edit.photo, values } };
}

/** a geometry change (a 裁切 gesture step or commit): one undo step at commit, like a slider. Unchanged → the same object. */
export function editSetGeometry(edit: EditState, g: Geometry): EditState {
  return g === edit.photo.geometry ? edit : { ...edit, photo: { ...edit.photo, geometry: g } };
}

/** 旋轉: E turns a quarter, so the 增高 band (E rows) is removed in the same state, one undo step (C §3.5) */
export function editRotateLeft(edit: EditState): EditState {
  return { ...edit, photo: { ...edit.photo, geometry: rotateLeft(edit.photo.geometry), heightBand: null } };
}

/** 翻轉: E rows are unchanged, so the band is kept */
export function editFlipView(edit: EditState): EditState {
  return { ...edit, photo: { ...edit.photo, geometry: flipView(edit.photo.geometry) } };
}

/** 還原: the identity geometry; already identity → the same object */
export function editResetGeometry(edit: EditState): EditState {
  return isIdentity(edit.photo.geometry) ? edit : editSetGeometry(edit, IDENTITY_GEOMETRY);
}

/** one 推臉筆 gesture (one undo step): append its records; the records already there are shared, never copied (push-brush spec §5.4) */
export function withStrokes(edit: EditState, recs: readonly Stroke[]): EditState {
  if (!recs.length) return edit;
  return { ...edit, photo: { ...edit.photo, strokes: [...edit.photo.strokes, ...recs] } };
}

/** 全部清除 (one undo step); the same object when there is nothing to clear */
export function clearStrokes(edit: EditState): EditState {
  return edit.photo.strokes.length ? { ...edit, photo: { ...edit.photo, strokes: [] } } : edit;
}

/**
 * An edit computed from the state before a live stroke was committed (a second finger on a strip item while the first
 * one draws, push-brush spec §2.5) keeps the stroke: when `e` still holds exactly the list the commit replaced (`from`,
 * by identity), it gets the committed list `to`. 全部清除 and 重置 make a new list, so they still clear.
 */
export function rebaseStrokes(e: EditState, from: readonly Stroke[], to: readonly Stroke[]): EditState {
  return from !== to && e.photo.strokes === from ? { ...e, photo: { ...e.photo, strokes: to } } : e;
}

/** the person part of `ref` (face items within 1e-6, every shade, 左右分開 off) is what `p` holds (RM §3.4 matching, S5 §3.5) */
export function matchesPersonPreset(p: PersonParams, ref: PresetRef): boolean {
  const q = personFromPreset(ref.id, ref.amount);
  if (p.right !== null) return false;
  if (SHADE_PARTS.some((k) => q.shades[k] !== p.shades[k])) return false;
  return PRESET_PERSON_IDS.every((id) => Math.abs(q.values[id] - p.values[id]) < 1e-6);
}

/** the photo part of `ref` (美白, 銳化, 濾鏡強度, filterId) is what `photo` holds */
export function matchesPhotoLink(photo: PhotoParams, ref: PresetRef): boolean {
  const q = applyPreset(ref.id, ref.amount);
  if (q.filterId !== photo.filterId) return false;
  return PRESET_PHOTO_IDS.every((id) => Math.abs(q.values[id] - photo.values[id]) < 1e-6);
}

function presetRefOf(raw: unknown): PresetRef | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !PRESET_IDS.has(raw.id)) return null;
  if (typeof raw.amount !== 'number' || !Number.isFinite(raw.amount)) return null;
  return { id: raw.id as PresetId, amount: clamp01(raw.amount) };
}

/** Untrusted person → valid: values clamped, a missing field from `fallback`, shades validated, preset kept only if matching. */
export function sanitizePerson(raw: unknown, fallback: PersonParams): PersonParams {
  const r = isRecord(raw) ? raw : {};
  const rv = isRecord(r.values) ? r.values : {};
  const values = {} as Record<PersonParamId, number>;
  for (const id of PERSON_IDS) {
    const v = rv[id];
    values[id] = typeof v === 'number' && Number.isFinite(v) ? clamp01(v) : fallback.values[id];
  }
  const rs = isRecord(r.shades) ? r.shades : null;
  const shade = (part: ShadePart): string | null => {
    if (!rs || !(part in rs)) return fallback.shades[part];
    const s = rs[part];
    return typeof s === 'string' && SHADES[part].has(s) ? s : null;
  };
  const shades = Object.fromEntries(SHADE_PARTS.map((k) => [k, shade(k)])) as Record<ShadePart, string | null>;
  const right = sanitizeRight(r.right);
  const ref = presetRefOf('preset' in r ? r.preset : fallback.preset);
  const preset = ref && matchesPersonPreset({ values, right, shades, preset: ref }, ref) ? ref : 'custom';
  return { values, right, shades, preset };
}

/** A stored 質感 → a valid look (amount clamped) or null. */
export function sanitizePhotoLook(raw: unknown): PhotoParams['look'] {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { id?: unknown; amount?: unknown };
  if (!isLookId(r.id) || typeof r.amount !== 'number' || !Number.isFinite(r.amount)) return null;
  return { id: r.id, amount: clampAmount(r.amount) };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Stored geometry → a valid one (step-3 spec §5): without the O size (the camera look) identity; a mistyped or
 * non-finite field → that field's identity; `straighten` clamped to ±45 and rounded to 0.1; a crop off the valid region
 * by ≤ 1e-4 (float noise) → cropConstrain; farther → the whole geometry identity.
 */
export function sanitizeGeometry(raw: unknown, oSize?: Size | null): Geometry {
  if (!oSize || !(oSize.width > 0 && oSize.height > 0) || !isRecord(raw)) return IDENTITY_GEOMETRY;
  const c = isRecord(raw.crop) ? raw.crop : null;
  const crop = c && finite(c.x) && finite(c.y) && finite(c.w) && finite(c.h) && c.w > 0 && c.h > 0 ? { x: c.x, y: c.y, w: c.w, h: c.h } : { ...IDENTITY_GEOMETRY.crop };
  const q = raw.quarter;
  const g: Geometry = {
    flipH: raw.flipH === true,
    quarter: q === 1 || q === 2 || q === 3 ? q : 0,
    straighten: clampStraighten(finite(raw.straighten) ? raw.straighten : 0),
    crop,
  };
  if (cropValid(g, oSize)) return isIdentity(g) ? IDENTITY_GEOMETRY : g;
  if (cropValid(g, oSize, 1e-4)) return cropConstrain(g, oSize);
  return IDENTITY_GEOMETRY;
}

/**
 * Untrusted photo layer → valid; `persons` (when known) bounds the 長腿 anchor; a link survives only while it matches.
 * `oSize` (the entry's O size) validates the geometry and is the 推臉筆 frame; without it the geometry is identity (S D13)
 * and there are no strokes (push-brush spec §5.2).
 */
export function sanitizePhoto(raw: unknown, persons: ReadonlySet<PersonId> | null = null, oSize?: Size | null): PhotoParams {
  const base = defaultPhoto();
  const r = isRecord(raw) ? raw : {};
  const rv = isRecord(r.values) ? r.values : {};
  const values = { ...base.values };
  for (const id of PHOTO_IDS) {
    const v = rv[id];
    if (typeof v === 'number' && Number.isFinite(v)) values[id] = clamp01(v);
  }
  const la = r.legsAnchor;
  const photo: PhotoParams = {
    values,
    filterId: FILTERS.some((f) => f.id === r.filterId) ? (r.filterId as string) : 'none',
    look: sanitizePhotoLook(r.look),
    presetLink: presetRefOf(r.presetLink),
    bodyProtect: typeof r.bodyProtect === 'boolean' ? r.bodyProtect : true,
    heightBand: sanitizeBand(r.heightBand),
    legsAnchor: typeof la === 'string' && PERSON_ID.test(la) && (!persons || persons.has(la)) ? la : null,
    geometry: sanitizeGeometry(r.geometry, oSize),
    spots: sanitizeSpots(r.spots, persons, !!oSize),
    strokes: sanitizeStrokes(r.strokes, oSize ?? null),
  };
  if (photo.presetLink && !matchesPhotoLink(photo, photo.presetLink)) photo.presetLink = null;
  return photo;
}

/** a stored v2 edit worth sanitizing (otherwise the entry opens as v1, from `params`) */
export function isEditStateRecord(raw: unknown): boolean {
  return isRecord(raw) && raw.v === 2 && isRecord(raw.photo) && isRecord(raw.persons);
}

/**
 * Untrusted edit → valid EditState (RM §3.4): values clamped to 0..1, filter / shade / preset ids validated, a preset
 * id kept only while the values match it. `personIds` (the detection cache's persons) drops persons not in it and
 * adds missing ones from the template; null (no cache, or one dropped for a rematch) keeps every valid person.
 * `oSize` is the O size the geometry is validated against (HistoryEntry.width/height); without it (the camera look) the
 * geometry is identity (step-3 spec D13), and it is the frame the strokes are sanitized on: without it they are all
 * dropped (push-brush spec §5.2).
 */
export function sanitizeEditState(raw: unknown, personIds: readonly PersonId[] | null, oSize?: Size): EditState {
  const r = isRecord(raw) ? raw : {};
  const template = sanitizePerson(r.template, neutralPerson());
  const primaryInit = r.primaryInit === undefined || r.primaryInit === null ? null : sanitizePerson(r.primaryInit, template);
  const persons: Record<PersonId, PersonParams> = {};
  const rp = isRecord(r.persons) ? r.persons : {};
  for (const [id, p] of Object.entries(rp)) {
    if (!PERSON_ID.test(id) || (personIds && !personIds.includes(id))) continue;
    persons[id] = sanitizePerson(p, template);
  }
  if (personIds) {
    for (const id of personIds) if (!persons[id]) persons[id] = id === P0 ? (primaryInit ?? template) : template;
  } else if (!Object.keys(persons).length) persons[P0] = primaryInit ?? template;
  return { v: 2, photo: sanitizePhoto(r.photo, new Set(Object.keys(persons)), oSize), persons, template, primaryInit };
}
