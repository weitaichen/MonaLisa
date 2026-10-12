// One lens for every edit (RM §3.3): all panel reads and writes go through it, so the routing between the photo and
// the person layer, and between one person and 全部, lives in one place. The editor and the camera both use it.
import { applyPreset, cleanBand, displayValue, FILTERS, hasValue, MAKEUP_PICK_DEFAULT, neutralValue, paramDef, paramsInGroup } from '../engine/params';
import type {
  EditState,
  HeightBand,
  ParamGroup,
  ParamId,
  PersonId,
  PersonParams,
  PhotoParams,
  PresetId,
  PresetRef,
  RegionStatus,
  Selection,
  ShadePart,
} from '../types';
import { personOf, PRESET_PERSON_IDS, PRESET_PHOTO_IDS, resetAll, withPersons, withPhoto } from './state';

export const NO_FACE_NOTE = '這位人物未偵測到臉部，臉部效果不適用';
export const NO_BODY_NOTE = '這位人物未偵測到身體，僅能使用增高、長腿';
export const NO_FACE_PHOTO_NOTE = '未偵測到臉部，臉型與美妝不會套用';

export interface PersonInfo {
  id: PersonId;
  face: boolean;
  body: boolean;
}
export interface LensOptions {
  /** paramAvailability of a body item for that person's measure (absent → available) */
  available?(person: PersonId, id: ParamId): boolean;
}
export interface Lens {
  readonly edit: EditState;
  readonly sel: Selection;
  readonly persons: readonly PersonInfo[];
  readonly primary: PersonId;
  readonly noFace: boolean;
  /** person ids a person item writes; [] for photo items and refusals */
  targets(id: ParamId): PersonId[];
  /** the persons presets, shades and 無 write */
  faceTargets(): PersonId[];
  get(id: ParamId): { value: number; mixed: boolean };
  set(id: ParamId, v: number): EditState;
  applies(id: ParamId): RegionStatus;
  shade(part: ShadePart): { shade: string | null; on: boolean; mixed: boolean };
  preset(): { ref: PresetRef | 'custom' | null; mixed: boolean };
  setShade(part: ShadePart, shade: string | null): EditState;
  clearMakeup(part: ShadePart): EditState;
  applyPreset(id: PresetId, amount: number): EditState;
  setPresetAmount(amount: number): EditState;
  setFilter(filterId: string): EditState;
  setBodyProtect(on: boolean): EditState;
  setHeightBand(band: HeightBand | null): EditState;
  resetGroup(group: ParamGroup): EditState;
  groupNeutral(group: ParamGroup): boolean;
  groupHasValue(group: ParamGroup): boolean;
  reset(): EditState;
}

/** before any detection the implicit person edits everything, as v0.3 did (S §3.3 item 2) */
export const P0_INFO: readonly PersonInfo[] = [{ id: 'p0', face: true, body: true }];
/** the camera's one person: a face, never a body (美體 is photo-only) */
export const LIVE_PERSONS: readonly PersonInfo[] = [{ id: 'live', face: true, body: false }];

type PV = keyof PersonParams['values'];
type PhV = keyof PhotoParams['values'];
const OK: RegionStatus = { ok: true, reason: null };
const no = (reason: string): RegionStatus => ({ ok: false, reason });
const clamp01 = (v: number) => (Number.isNaN(v) ? 0 : Math.min(1, Math.max(0, v)));
/** the no-face exception: these act on all skin through the primary (RM §3.3) */
const ALL_SKIN: ReadonlySet<ParamId> = new Set<ParamId>(['skin.smooth', 'skin.rosy']);
/** editing these breaks the photo's preset link (RM §3.4) */
const LINK_BREAKERS: ReadonlySet<ParamId> = new Set<ParamId>(['skin.whiten', 'skin.sharpen', 'filter.amount']);
const makeupKey = (part: ShadePart): PV => (part === 'lip' ? 'makeup.lip' : 'makeup.blush');
/** presets match by id: 程度 differences do not make 全部 "mixed" for the strip (S §2.4) */
const sameRef = (a: PresetRef | 'custom', b: PresetRef | 'custom') => (a === 'custom' ? b === 'custom' : b !== 'custom' && a.id === b.id);

export function lensFor(edit: EditState, sel: Selection, persons: readonly PersonInfo[], primary: PersonId, opts: LensOptions = {}): Lens {
  const info = new Map(persons.map((p) => [p.id, p]));
  const noFace = !persons.some((p) => p.face);
  /** primary first: "the first applicable person" under 全部 */
  const order = [primary, ...persons.map((p) => p.id).filter((id) => id !== primary)].filter((id) => info.has(id));
  const selected = sel.kind === 'person' ? (info.get(sel.id) ?? null) : null;
  const isBody = (id: ParamId) => paramDef(id).group === 'body';
  const isPhoto = (id: ParamId) => paramDef(id).scope === 'photo';
  const applicable = (p: PersonInfo, id: ParamId) => (isBody(id) ? p.body && (opts.available?.(p.id, id) ?? true) : p.face);
  /** ⊘ also resets the tab's photo items only under 全部 or with fewer than 2 persons (RM §2.1, r2) */
  const photoToo = sel.kind === 'all' || persons.length < 2;

  function targets(id: ParamId): PersonId[] {
    if (isPhoto(id)) return [];
    if (!isBody(id) && noFace) return ALL_SKIN.has(id) ? [primary] : [];
    if (sel.kind === 'person') return selected && applicable(selected, id) ? [selected.id] : [];
    return order.filter((pid) => applicable(info.get(pid)!, id));
  }
  function faceTargets(): PersonId[] {
    if (noFace) return [primary];
    if (sel.kind === 'person') return selected?.face ? [selected.id] : [];
    return order.filter((pid) => info.get(pid)!.face);
  }
  const shownOf = (t: readonly PersonId[]) => t[0] ?? (sel.kind === 'person' ? sel.id : primary);
  const person = (pid: PersonId) => personOf(edit, pid);

  const withPresetPart = (p: PersonParams, id: PresetId, amount: number): PersonParams => {
    const q = applyPreset(id, amount);
    const values = { ...p.values };
    for (const k of PRESET_PERSON_IDS) values[k] = q.values[k];
    return { values, shades: { lip: q.lipShade, blush: q.blushShade }, preset: { id, amount: q.presetAmount } };
  };
  const withPhotoPart = (ph: PhotoParams, id: PresetId, amount: number): PhotoParams => {
    const q = applyPreset(id, amount);
    const values = { ...ph.values };
    for (const k of PRESET_PHOTO_IDS) values[k] = q.values[k];
    return { ...ph, values, filterId: q.filterId, presetLink: { id, amount: q.presetAmount } };
  };

  const lens: Lens = {
    edit,
    sel,
    persons,
    primary,
    noFace,
    targets,
    faceTargets,
    get(id) {
      if (isPhoto(id)) return { value: edit.photo.values[id as PhV], mixed: false };
      const t = targets(id);
      const value = person(shownOf(t)).values[id as PV];
      const def = paramDef(id);
      const mixed = t.some((pid) => displayValue(def, person(pid).values[id as PV]) !== displayValue(def, value));
      return { value, mixed };
    },
    set(id, v) {
      const val = clamp01(v);
      if (isPhoto(id)) {
        return withPhoto(edit, (ph) => {
          const next: PhotoParams = { ...ph, values: { ...ph.values, [id]: val } };
          if (LINK_BREAKERS.has(id)) next.presetLink = null;
          if (id === 'body.legs') next.legsAnchor = selected?.body ? selected.id : null;
          return next;
        });
      }
      return withPersons(edit, targets(id), (p) => ({ ...p, values: { ...p.values, [id]: val }, preset: isBody(id) ? p.preset : 'custom' }));
    },
    applies(id) {
      if (isPhoto(id) || targets(id).length) return OK;
      if (!isBody(id) && noFace) return no(NO_FACE_PHOTO_NOTE);
      if (selected && isBody(id) && selected.body) return no('此照片無法使用這個效果');
      return no(isBody(id) ? NO_BODY_NOTE : NO_FACE_NOTE);
    },
    shade(part) {
      const key = makeupKey(part);
      const t = faceTargets();
      const p = person(shownOf(t));
      const on = p.values[key] > 0.01;
      const shade = p.shades[part];
      const mixed = t.some((pid) => {
        const q = person(pid);
        return q.values[key] > 0.01 !== on || q.shades[part] !== shade;
      });
      return { shade, on, mixed };
    },
    preset() {
      const t = faceTargets();
      if (!t.length) return { ref: null, mixed: false };
      const refs = t.map((pid) => person(pid).preset);
      return { ref: refs[0], mixed: refs.some((r) => !sameRef(refs[0], r)) };
    },
    setShade(part, shade) {
      const key = makeupKey(part);
      return withPersons(edit, faceTargets(), (p) => ({
        ...p,
        shades: { ...p.shades, [part]: shade },
        values: { ...p.values, [key]: p.values[key] > 0.01 ? p.values[key] : MAKEUP_PICK_DEFAULT[part] },
        preset: 'custom',
      }));
    },
    clearMakeup(part) {
      const key = makeupKey(part);
      return withPersons(edit, faceTargets(), (p) => ({ ...p, shades: { ...p.shades, [part]: null }, values: { ...p.values, [key]: 0 }, preset: 'custom' }));
    },
    applyPreset(id, amount) {
      const a = clamp01(amount);
      return withPhoto(
        withPersons(edit, faceTargets(), (p) => withPresetPart(p, id, a)),
        (ph) => withPhotoPart(ph, id, a),
      );
    },
    setPresetAmount(amount) {
      const { ref, mixed } = lens.preset();
      const a = clamp01(amount);
      const link = edit.photo.presetLink;
      // a body-only person: 程度 scales only the photo part (S §2.4 一鍵)
      if (ref === null) return link ? withPhoto(edit, (ph) => withPhotoPart(ph, link.id, a)) : edit;
      if (ref === 'custom' || mixed) return edit;
      const e = withPersons(edit, faceTargets(), (p) => withPresetPart(p, ref.id, a));
      return link?.id === ref.id ? withPhoto(e, (ph) => withPhotoPart(ph, ref.id, a)) : e;
    },
    setFilter(filterId) {
      const f = FILTERS.find((x) => x.id === filterId) ?? FILTERS[0];
      return withPhoto(edit, (ph) => ({
        ...ph,
        filterId: f.id,
        values: { ...ph.values, 'filter.amount': f.id === 'none' ? ph.values['filter.amount'] : f.defaultAmount },
        presetLink: null,
      }));
    },
    setBodyProtect(on) {
      return withPhoto(edit, (ph) => (ph.bodyProtect === on ? ph : { ...ph, bodyProtect: on }));
    },
    setHeightBand(band) {
      return withPhoto(edit, (ph) => ({ ...ph, heightBand: band ? cleanBand(band) : null }));
    },
    resetGroup(group) {
      const defs = paramsInGroup(group);
      const personIds = defs.filter((d) => d.scope === 'person').map((d) => d.id);
      const who = [...new Set(personIds.flatMap((id) => targets(id)))];
      let e = withPersons(edit, who, (p) => {
        const values = { ...p.values };
        for (const id of personIds) values[id as PV] = neutralValue(paramDef(id));
        return { ...p, values, preset: group === 'body' ? p.preset : 'custom' };
      });
      if (group === 'makeup') e = withPersons(e, faceTargets(), (p) => ({ ...p, shades: { lip: null, blush: null } }));
      const photoIds = defs.filter((d) => d.scope === 'photo').map((d) => d.id);
      if ((photoToo || group === 'filter') && (photoIds.length || group === 'body')) {
        e = withPhoto(e, (ph) => {
          const values = { ...ph.values };
          for (const id of photoIds) values[id as PhV] = neutralValue(paramDef(id));
          const next: PhotoParams = { ...ph, values };
          if (photoIds.some((id) => LINK_BREAKERS.has(id))) next.presetLink = null;
          if (group === 'filter') next.filterId = 'none';
          if (group === 'body') {
            next.heightBand = null;
            next.legsAnchor = null;
          }
          return next;
        });
      }
      return e;
    },
    groupNeutral(group) {
      for (const d of paramsInGroup(group)) {
        if (d.scope === 'photo') {
          if (photoToo && hasValue(d, edit.photo.values[d.id as PhV])) return false;
        } else if (targets(d.id).some((pid) => hasValue(d, person(pid).values[d.id as PV]))) return false;
      }
      return !(group === 'body' && photoToo && edit.photo.heightBand !== null);
    },
    groupHasValue(group) {
      return paramsInGroup(group).some((d) => {
        if (d.scope === 'photo') return hasValue(d, edit.photo.values[d.id as PhV]);
        const t = targets(d.id);
        return (t.length ? t : [shownOf(t)]).some((pid) => hasValue(d, person(pid).values[d.id as PV]));
      });
    },
    reset() {
      return resetAll(edit);
    },
  };
  return lens;
}
