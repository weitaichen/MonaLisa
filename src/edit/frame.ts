// The still frame of an edit (S §4.1 item 1): every selectable face in cache order at weight 1 with its person's params
// (a face whose person has no entry yet: neutral) and its 瘦臉 limit; the obstacles' centres; all-skin 磨皮／紅潤 from the
// primary person only when the photo has no face. The selection is never an input.
import { boxCentre } from '../engine/passes/faceCap';
import type { BeautyParams, CachedObstacle, EditState, Face, FaceProtect, PersonId, StillFrame } from '../types';
import { splitLegacy } from './legacy';
import { neutralPerson, personOf } from './state';

export interface FrameFaceIn {
  id: string;
  face: Face;
  /** the person linked to this face (DetectionCache.persons), null = none yet */
  person: PersonId | null;
}

export function buildFrame(
  edit: EditState,
  faces: readonly FrameFaceIn[],
  obstacles: readonly CachedObstacle[],
  protects: ReadonlyMap<string, FaceProtect>,
  primary: PersonId,
): StillFrame {
  const skin = personOf(edit, primary).values;
  return {
    faces: faces.map((f) => ({
      face: f.face,
      weight: 1,
      person: f.person && edit.persons[f.person] ? edit.persons[f.person] : neutralPerson(),
      protect: protects.get(f.id) ?? null,
    })),
    obstacles: obstacles.map((o) => boxCentre(o.box)),
    globalSkin: faces.length ? null : { smooth: skin['skin.smooth'], rosy: skin['skin.rosy'], weight: 1 },
    photo: edit.photo,
  };
}

/**
 * One face from v1 params (the camera until Task 25, unit tests, harnesses and e2e pages): the face at `weight`, the
 * global skin of the same person faded to 1 − weight (A2), so a fading camera face is v0.3's mask exactly.
 */
export function legacyFrame(params: BeautyParams, face: Face | null, weight: number, protect: FaceProtect | null = null): StillFrame {
  const { photo, person } = splitLegacy(params);
  const w = Number.isFinite(weight) ? Math.min(1, Math.max(0, weight)) : 0;
  const on = face !== null && w > 0;
  return {
    faces: on ? [{ face, weight: w, person, protect }] : [],
    obstacles: [],
    globalSkin: { smooth: person.values['skin.smooth'], rosy: person.values['skin.rosy'], weight: on ? 1 - w : 1 },
    photo,
  };
}
