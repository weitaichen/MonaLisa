// v1 (BeautyParams, the 0.3 storage shape) ↔ v2 (EditState), RM §3.2 / §5. BeautyParams stays the shape of history v1
// records and meiyan.params.v1, and of the legacy projection 0.4 keeps writing so a rollback to 0.3 still opens 0.4
// entries with the primary person's look. New code never takes BeautyParams.
import { neutralValue, paramsInGroup } from '../engine/params';
import { IDENTITY_GEOMETRY } from '../geometry/view';
import type { BeautyParams, EditState, HeightBand, ParamId, PersonId, PersonParamId, PersonParams, PhotoParamId, PhotoParams } from '../types';
import { emptyShades, matchesPersonPreset, matchesPhotoLink, neutralPerson, P0, PERSON_IDS, PHOTO_IDS } from './state';

export function splitLegacy(p: BeautyParams): { photo: PhotoParams; person: PersonParams } {
  const ref = p.presetId === 'custom' ? null : { id: p.presetId, amount: p.presetAmount };
  const photoValues = {} as Record<PhotoParamId, number>;
  for (const id of PHOTO_IDS) photoValues[id] = p.values[id];
  const personValues = {} as Record<PersonParamId, number>;
  for (const id of PERSON_IDS) personValues[id] = p.values[id];
  return {
    photo: { values: photoValues, filterId: p.filterId, look: null, presetLink: ref, bodyProtect: p.bodyProtect, heightBand: p.heightBand, legsAnchor: null, geometry: IDENTITY_GEOMETRY, spots: [] },
    person: { values: personValues, right: null, shades: { ...emptyShades(), lip: p.lipShade, blush: p.blushShade }, preset: ref ?? 'custom' },
  };
}

/** the 0.3 view carries no 膚質 edit (skin-cleanup spec §5 rollback): the six tone.* values, neutral */
const TONE_NEUTRAL = Object.fromEntries(paramsInGroup('tone').map((d) => [d.id, neutralValue(d)]));

/**
 * The 0.3 view of an edit: the photo plus one person (`primary`, else primaryInit, else the template). presetId stands
 * only while the person's preset and the photo's preset link agree; otherwise 'custom' with 程度 1 (dead data in 0.3).
 */
export function legacyProjection(edit: EditState, primary: PersonId): BeautyParams {
  const person = edit.persons[primary] ?? edit.primaryInit ?? edit.template;
  const ref = person.preset;
  const link = edit.photo.presetLink;
  const linked = ref !== 'custom' && link !== null && link.id === ref.id && link.amount === ref.amount;
  return {
    values: { ...edit.photo.values, ...person.values, ...TONE_NEUTRAL } as Record<ParamId, number>,
    filterId: edit.photo.filterId,
    lipShade: person.shades.lip,
    blushShade: person.shades.blush,
    presetId: linked ? ref.id : 'custom',
    presetAmount: linked ? ref.amount : 1,
    bodyProtect: edit.photo.bodyProtect,
    heightBand: edit.photo.heightBand,
  };
}

/** One implicit person `p0` carrying `p`; v1 entries also keep it as primaryInit (RM §5.2). */
export function editFromLegacy(p: BeautyParams, opts: { primaryInit?: boolean } = {}): EditState {
  const { photo, person } = splitLegacy(p);
  return { v: 2, photo, persons: { [P0]: person }, template: neutralPerson(), primaryInit: opts.primaryInit ? person : null };
}

/** two 增高 bands are the same band (null = none) */
const sameBand = (a: HeightBand | null, b: HeightBand | null) => a === b || (!!a && !!b && a.top === b.top && a.bottom === b.bottom && a.amount === b.amount);

/**
 * A v2 edit that 0.3 edited after a rollback (S §5.3): 0.3's `params` win for the photo and for `primary` (the person
 * they were projected from) in what 0.3 can write: the values of `stored` (the param ids the stored record holds a
 * value for: normalizeEntry's legacyEdited), the filter, the preset and its link, 背景保護, the 增高 band and the lip /
 * blush shades. Everything else stays as the v2 edit has it, since 0.3 can neither show nor change it: the values it did
 * not store (調節, 膚質, any param a later build adds; sanitizeParams fills those with defaults), 質感, the geometry, the
 * spots, the 長腿 anchor and every other person. A preset or link the merged values no longer match becomes 'custom' /
 * null. 0.3 draws the band in O rows and 0.4 keeps it in E rows (C §3.5), which differ under a quarter turn: a band
 * 0.3 changed there is dropped, as 旋轉 drops it.
 */
export function mergeLegacy(edit: EditState, p: BeautyParams, primary: PersonId, stored: readonly ParamId[]): EditState {
  const has = new Set<ParamId>(stored);
  const split = splitLegacy(p);
  const photoValues = { ...edit.photo.values };
  for (const id of PHOTO_IDS) if (has.has(id)) photoValues[id] = split.photo.values[id];
  const band = split.photo.heightBand;
  const photo: PhotoParams = {
    ...edit.photo,
    values: photoValues,
    filterId: split.photo.filterId,
    presetLink: split.photo.presetLink,
    bodyProtect: split.photo.bodyProtect,
    heightBand: edit.photo.geometry.quarter !== 0 && !sameBand(band, edit.photo.heightBand) ? null : band,
  };
  if (photo.presetLink && !matchesPhotoLink(photo, photo.presetLink)) photo.presetLink = null;
  const was = edit.persons[primary] ?? edit.primaryInit ?? edit.template;
  const values = { ...was.values };
  for (const id of PERSON_IDS) if (has.has(id)) values[id] = split.person.values[id];
  // only the two shades 0.3 writes; the step-5 shades and `right` (via ...was) stay as the v2 edit has them
  const shades = { ...was.shades, lip: split.person.shades.lip, blush: split.person.shades.blush };
  const person: PersonParams = { ...was, values, shades, preset: split.person.preset };
  if (person.preset !== 'custom' && !matchesPersonPreset(person, person.preset)) person.preset = 'custom';
  return { ...edit, photo, persons: { ...edit.persons, [primary]: person } };
}
