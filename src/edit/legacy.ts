// v1 (BeautyParams, the 0.3 storage shape) ↔ v2 (EditState), RM §3.2 / §5. BeautyParams stays the shape of history v1
// records and meiyan.params.v1, and of the legacy projection 0.4 keeps writing so a rollback to 0.3 still opens 0.4
// entries with the primary person's look. New code never takes BeautyParams.
import type { BeautyParams, EditState, ParamId, PersonId, PersonParamId, PersonParams, PhotoParamId, PhotoParams } from '../types';
import { neutralPerson, P0, PERSON_IDS, PHOTO_IDS } from './state';

export function splitLegacy(p: BeautyParams): { photo: PhotoParams; person: PersonParams } {
  const ref = p.presetId === 'custom' ? null : { id: p.presetId, amount: p.presetAmount };
  const photoValues = {} as Record<PhotoParamId, number>;
  for (const id of PHOTO_IDS) photoValues[id] = p.values[id];
  const personValues = {} as Record<PersonParamId, number>;
  for (const id of PERSON_IDS) personValues[id] = p.values[id];
  return {
    photo: { values: photoValues, filterId: p.filterId, look: null, presetLink: ref, bodyProtect: p.bodyProtect, heightBand: p.heightBand, legsAnchor: null },
    person: { values: personValues, shades: { lip: p.lipShade, blush: p.blushShade }, preset: ref ?? 'custom' },
  };
}

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
    values: { ...edit.photo.values, ...person.values } as Record<ParamId, number>,
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
