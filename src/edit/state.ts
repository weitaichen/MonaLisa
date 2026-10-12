// The v0.4 edit of one photo (RM §3.2–3.4): an immutable EditState with a photo layer and a person layer. Every change
// returns a new object and shares what it did not change, so UndoStack keeps states by reference ({clone: false}).
import { applyPreset, PARAM_DEFS } from '../engine/params';
import { stableKey } from '../store/undo';
import type { CameraLook, EditState, PersonId, PersonParamId, PersonParams, PhotoParamId, PhotoParams, PresetId } from '../types';

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

/** the person part of preset `id` at 程度 `amount`, every 美體 item neutral */
export function personFromPreset(id: PresetId, amount: number): PersonParams {
  const p = applyPreset(id, amount);
  const values = {} as Record<PersonParamId, number>;
  for (const k of PERSON_IDS) values[k] = p.values[k];
  return { values, shades: { lip: p.lipShade, blush: p.blushShade }, preset: { id, amount: p.presetAmount } };
}

/** 原圖: every value neutral (the template of persons the camera did not beautify) */
export function neutralPerson(): PersonParams {
  return personFromPreset('original', 1);
}

/** 自然 100: what 重置 gives every person */
export function naturalPerson(): PersonParams {
  return personFromPreset('natural', 1);
}

/** the 自然 photo part, everything else neutral or identity (重置, RM §3.4) */
export function defaultPhoto(): PhotoParams {
  const p = applyPreset('natural', 1);
  const values = {} as Record<PhotoParamId, number>;
  for (const k of PHOTO_IDS) values[k] = p.values[k];
  return { values, filterId: p.filterId, presetLink: { id: 'natural', amount: 1 }, bodyProtect: true, heightBand: null, legsAnchor: null };
}

/** The output de-dupe and undo key (RM §3.4; step 6 replaces stroke points by stroke ids here). */
export function editKey(edit: EditState): string {
  return stableKey(edit);
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
