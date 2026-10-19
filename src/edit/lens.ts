// One lens for every edit (RM §3.3): all panel reads and writes go through it, so the routing between the photo and
// the person layer, and between one person and 全部, lives in one place. The editor and the camera both use it.
import { applyPreset, cleanBand, displayValue, FILTERS, hasValue, isShadePart, MAKEUP_PARAM, MAKEUP_PICK_DEFAULT, neutralValue, paramDef, paramsInGroup, SHADES } from '../engine/params';
import type {
  EditState,
  HeightBand,
  LookId,
  MakeupPart,
  ParamDef,
  ParamGroup,
  ParamId,
  PersonId,
  PersonParamId,
  PersonParams,
  PhotoParams,
  PresetId,
  PresetRef,
  RegionStatus,
  Selection,
  ShadePart,
  SplitParamId,
} from '../types';
import { isSplitId, type Side, slotFor, splitOff, splitOn } from './sides';
import { emptyShades, personOf, PRESET_PERSON_IDS, PRESET_PHOTO_IDS, resetAdjust, resetAll, setLook as setPhotoLook, withPersons, withPhoto } from './state';
import { TONE_COPY } from './toneCopy';

export const NO_FACE_NOTE = '這位人物未偵測到臉部，臉部效果不適用';
export const NO_BODY_NOTE = '這位人物未偵測到身體，僅能使用增高、長腿';
export const NO_FACE_PHOTO_NOTE = '未偵測到臉部，臉型與美妝不會套用';
/** the camera with a working tracker and no face shown: person items are off, photo items stay (camera per-person spec §3.6, K11) */
export const CAMERA_NO_FACE_NOTE = '未偵測到臉部，對準人臉後即可調整';

export interface PersonInfo {
  id: PersonId;
  face: boolean;
  body: boolean;
  /** face-detail spec §3.4: the person's GPUPixel-left half shows on the right of the screen (翻轉, camera mirror) */
  screenSwap?: boolean;
}
/**
 * The camera's faces as the panel sees them (camera per-person spec §3.2, §3.6). The camera lens is one person, 'live',
 * holding the target's params; this says how many faces are shown, so the ≥ 2-persons rules follow the faces in view.
 */
export interface CameraLensInfo {
  /** faces shown (found, or held after a miss) */
  shown: number;
  /** 全部套用 is on: person items write everyone in view, and ⊘ also resets the tab's photo items */
  all: boolean;
  /** a working tracker shows no face: person items write nothing and say CAMERA_NO_FACE_NOTE */
  noFace: boolean;
  /** the camera person the sliders edit (slider identity: a target change resets the drag state); null for none */
  target: number | null;
}
export interface LensOptions {
  /** paramAvailability of a body item for that person's measure (absent → available) */
  available?(person: PersonId, id: ParamId): boolean;
  /** the camera's faces (absent in the editor) */
  camera?: CameraLensInfo;
}
export interface Lens {
  readonly edit: EditState;
  readonly sel: Selection;
  readonly persons: readonly PersonInfo[];
  readonly primary: PersonId;
  readonly noFace: boolean;
  /** the person / photo distinction shows: ≥ 2 persons, or in the camera ≥ 2 faces shown (camera per-person spec §3.2) */
  readonly multi: boolean;
  /** LensOptions.camera; null in the editor */
  readonly camera: CameraLensInfo | null;
  /** why person items write nothing (the camera with no face shown, §3.6); null when they may */
  readonly personOff: string | null;
  /** person ids a person item writes; [] for photo items and refusals */
  targets(id: ParamId): PersonId[];
  /** the persons presets, shades and 無 write */
  faceTargets(): PersonId[];
  /** `side` (on-screen) applies to split items of persons with 左右分開 on; otherwise ignored */
  get(id: ParamId, side?: Side): { value: number; mixed: boolean };
  set(id: ParamId, v: number, side?: Side): EditState;
  /** 左右分開 state of the reference person (faceTargets()[0]: the selected person; under 全部 the primary, else the first face person) */
  split(): boolean;
  /** on: right copies the six values; off: both sides take `activeSide`'s value. Every face target, one EditState. */
  setSplit(on: boolean, activeSide: Side): EditState;
  /** 自然 on a part without shades: `v` on every target whose value is ≤ 0.01 */
  ensureOn(id: ParamId, v: number): EditState;
  applies(id: ParamId): RegionStatus;
  shade(part: ShadePart): { shade: string | null; on: boolean; mixed: boolean };
  preset(): { ref: PresetRef | 'custom' | null; mixed: boolean };
  setShade(part: ShadePart, shade: string | null): EditState;
  /** 無 for one part (any of the ten): value 0 and, for a shade part, shade null on every face target; `edit` when all are off */
  clearMakeup(part: MakeupPart): EditState;
  applyPreset(id: PresetId, amount: number): EditState;
  setPresetAmount(amount: number): EditState;
  setFilter(filterId: string): EditState;
  setBodyProtect(on: boolean): EditState;
  setHeightBand(band: HeightBand | null): EditState;
  /** 一鍵 › 質感 of the photo (step-2 spec §3.4) */
  look(): PhotoParams['look'];
  /** pick a look (amount clamped) or 無 (null); a photo item, whatever the selection */
  setLook(id: LookId | null, amount: number): EditState;
  resetGroup(group: ParamGroup): EditState;
  groupNeutral(group: ParamGroup): boolean;
  groupHasValue(group: ParamGroup): boolean;
  reset(): EditState;
}

/** the shade a part draws with: 眼線 null reads as its first shade, 黑 (S5 §2.3); every other part as stored */
export function effectiveShade(part: ShadePart, shade: string | null): string | null {
  return part === 'liner' ? (shade ?? SHADES.liner[0].id) : shade;
}

/** before any detection the implicit person edits everything, as v0.3 did (S §3.3 item 2) */
export const P0_INFO: readonly PersonInfo[] = [{ id: 'p0', face: true, body: true }];
/** the camera's one person: a face, never a body (美體 is photo-only) */
export const LIVE_PERSONS: readonly PersonInfo[] = [{ id: 'live', face: true, body: false }];

/** step 1's lens; `withFaceDetail` adds the 左右分開 / 自然 operations */
type BaseLens = Omit<Lens, 'split' | 'setSplit' | 'ensureOn'>;
type PV = keyof PersonParams['values'];
type PhV = keyof PhotoParams['values'];
const OK: RegionStatus = { ok: true, reason: null };
const no = (reason: string): RegionStatus => ({ ok: false, reason });
const clamp01 = (v: number) => (Number.isNaN(v) ? 0 : Math.min(1, Math.max(0, v)));
/** the no-face exception: these act on all skin through the primary (RM §3.3) */
const ALL_SKIN: ReadonlySet<ParamId> = new Set<ParamId>(['skin.smooth', 'skin.rosy']);
/** editing these breaks the photo's preset link (RM §3.4) */
const LINK_BREAKERS: ReadonlySet<ParamId> = new Set<ParamId>(['skin.whiten', 'skin.sharpen', 'filter.amount']);
/** presets match by id: 程度 differences do not make 全部 "mixed" for the strip (S §2.4) */
const sameRef = (a: PresetRef | 'custom', b: PresetRef | 'custom') => (a === 'custom' ? b === 'custom' : b !== 'custom' && a.id === b.id);
/** the defs a strip's ⊘, its no-op check and its dot cover: 美膚 also covers the six 膚質 items (skin-cleanup spec §2.1) */
function stripDefs(group: ParamGroup): ParamDef[] {
  return group === 'skin' ? [...paramsInGroup('skin'), ...paramsInGroup('tone')] : paramsInGroup(group);
}

function baseLensFor(edit: EditState, sel: Selection, persons: readonly PersonInfo[], primary: PersonId, opts: LensOptions = {}): BaseLens {
  const info = new Map(persons.map((p) => [p.id, p]));
  const noFace = !persons.some((p) => p.face);
  /** primary first: "the first applicable person" under 全部 */
  const order = [primary, ...persons.map((p) => p.id).filter((id) => id !== primary)].filter((id) => info.has(id));
  const selected = sel.kind === 'person' ? (info.get(sel.id) ?? null) : null;
  const isBody = (id: ParamId) => paramDef(id).group === 'body';
  const isPhoto = (id: ParamId) => paramDef(id).scope === 'photo';
  const applicable = (p: PersonInfo, id: ParamId) => (isBody(id) ? p.body && (opts.available?.(p.id, id) ?? true) : p.face);
  const camera = opts.camera ?? null;
  const multi = camera ? camera.shown >= 2 : persons.length >= 2;
  /**
   * ⊘ also resets the tab's photo items only under 全部 or with fewer than 2 persons (RM §2.1, r2); in the camera
   * under 全部套用 or with fewer than 2 faces shown (camera per-person spec §3.2)
   */
  const photoToo = sel.kind === 'all' || !!camera?.all || !multi;
  /** the camera with no face shown: every person item and face target is off (§3.6); lens.noFace stays false, so no all-skin 磨皮 */
  const personOff = camera?.noFace ? CAMERA_NO_FACE_NOTE : null;

  function targets(id: ParamId): PersonId[] {
    if (isPhoto(id) || personOff) return [];
    if (!isBody(id) && noFace) return ALL_SKIN.has(id) ? [primary] : [];
    if (sel.kind === 'person') return selected && applicable(selected, id) ? [selected.id] : [];
    return order.filter((pid) => applicable(info.get(pid)!, id));
  }
  function faceTargets(): PersonId[] {
    if (personOff) return [];
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
    return { values, right: null, shades: { ...emptyShades(), lip: q.lipShade, blush: q.blushShade }, preset: { id, amount: q.presetAmount } };
  };
  const withPhotoPart = (ph: PhotoParams, id: PresetId, amount: number): PhotoParams => {
    const q = applyPreset(id, amount);
    const values = { ...ph.values };
    for (const k of PRESET_PHOTO_IDS) values[k] = q.values[k];
    return { ...ph, values, filterId: q.filterId, presetLink: { id, amount: q.presetAmount } };
  };

  const lens: BaseLens = {
    edit,
    sel,
    persons,
    primary,
    noFace,
    multi,
    camera,
    personOff,
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
      if (isPhoto(id)) return OK;
      if (personOff) return no(personOff);
      if (targets(id).length) return OK;
      if (!isBody(id) && noFace) return no(paramDef(id).group === 'tone' ? TONE_COPY.noFace : NO_FACE_PHOTO_NOTE);
      if (selected && isBody(id) && selected.body) return no('此照片無法使用這個效果');
      return no(isBody(id) ? NO_BODY_NOTE : NO_FACE_NOTE);
    },
    shade(part) {
      const key = MAKEUP_PARAM[part] as PV;
      const t = faceTargets();
      const p = person(shownOf(t));
      const on = p.values[key] > 0.01;
      const shade = p.shades[part];
      // effective shades: 眼線 null and 黑 draw the same, so they are not 各人不同 (and 黑 is no empty undo step)
      const eff = effectiveShade(part, shade);
      const mixed = t.some((pid) => {
        const q = person(pid);
        return q.values[key] > 0.01 !== on || effectiveShade(part, q.shades[part]) !== eff;
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
      const key = MAKEUP_PARAM[part] as PV;
      return withPersons(edit, faceTargets(), (p) => ({
        ...p,
        shades: { ...p.shades, [part]: shade },
        values: { ...p.values, [key]: p.values[key] > 0.01 ? p.values[key] : MAKEUP_PICK_DEFAULT[part] },
        preset: 'custom',
      }));
    },
    clearMakeup(part) {
      const key = MAKEUP_PARAM[part] as PV;
      const shaded = isShadePart(part) ? part : null;
      const t = faceTargets();
      const off = (q: PersonParams) => q.values[key] === 0 && (shaded === null || q.shades[shaded] === null);
      if (t.every((pid) => off(person(pid)))) return edit;
      return withPersons(edit, t, (p) => ({
        ...p,
        values: { ...p.values, [key]: 0 },
        shades: shaded === null ? p.shades : { ...p.shades, [shaded]: null },
        preset: 'custom',
      }));
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
    look() {
      return edit.photo.look;
    },
    setLook(id, amount) {
      return setPhotoLook(edit, id, amount);
    },
    resetGroup(group) {
      // 調節 is photo-level as a whole tab: ⊘ resets it under any selection (step-2 spec §3.4)
      if (group === 'adjust') return resetAdjust(edit);
      const defs = stripDefs(group);
      const personIds = defs.filter((d) => d.scope === 'person').map((d) => d.id);
      const who = [...new Set(personIds.flatMap((id) => targets(id)))];
      let e = withPersons(edit, who, (p) => {
        const values = { ...p.values };
        for (const id of personIds) values[id as PV] = neutralValue(paramDef(id));
        return { ...p, values, preset: group === 'body' ? p.preset : 'custom' };
      });
      if (group === 'makeup') e = withPersons(e, faceTargets(), (p) => ({ ...p, shades: emptyShades() }));
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
      for (const d of stripDefs(group)) {
        if (d.scope === 'photo') {
          if (photoToo && hasValue(d, edit.photo.values[d.id as PhV])) return false;
        } else if (targets(d.id).some((pid) => hasValue(d, person(pid).values[d.id as PV]))) return false;
      }
      return !(group === 'body' && photoToo && edit.photo.heightBand !== null);
    },
    groupHasValue(group) {
      return stripDefs(group).some((d) => {
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

/** swaps the two halves of one split item (an involution once `right` holds the id) */
function swapHalves(p: PersonParams, id: SplitParamId): PersonParams {
  return { ...p, values: { ...p.values, [id]: p.right?.[id] ?? p.values[id] }, right: { ...p.right, [id]: p.values[id] } };
}

/**
 * The EditState in which every split person's `side` half sits in `values`, so step 1's routing (selection, 全部,
 * applies, mixed by display value) reads and writes the requested side. `swapped` lists the persons to swap back.
 */
function sideView(edit: EditState, id: SplitParamId, side: Side, persons: readonly PersonInfo[]): { view: EditState; swapped: PersonId[] } {
  const swapped: PersonId[] = [];
  let next: Record<PersonId, PersonParams> | null = null;
  for (const info of persons) {
    // a listed person without an entry yet is the template (personOf): its split side is the template's (step-5 review)
    const p = personOf(edit, info.id);
    if (p.right === null || slotFor(!!info.screenSwap, side) === 'values') continue;
    next ??= { ...edit.persons };
    next[info.id] = swapHalves(p, id);
    swapped.push(info.id);
  }
  return { view: next ? { ...edit, persons: next } : edit, swapped };
}

/** step 1's lens plus the step-5 operations; step 1's own `faceTargets()` (primary first under 全部) picks every target */
function withFaceDetail(base: BaseLens, opts: LensOptions): Lens {
  const { edit, sel, persons, primary } = base;
  const infoOf = new Map(persons.map((p) => [p.id, p]));
  const swapOf = (pid: PersonId) => !!infoOf.get(pid)?.screenSwap;
  /** `fn` on each face target; a changed person becomes 自訂 (a person-level face edit, RM §3.4). Unchanged → `e` itself. */
  const mapTargets = (e: EditState, fn: (p: PersonParams, pid: PersonId) => PersonParams): EditState => {
    let next: Record<PersonId, PersonParams> | null = null;
    for (const pid of base.faceTargets()) {
      const p = personOf(e, pid);
      const q = fn(p, pid);
      if (q === p) continue;
      next ??= { ...e.persons };
      next[pid] = { ...q, preset: 'custom' };
    }
    return next ? { ...e, persons: next } : e;
  };
  const sideOf = (id: ParamId, side: Side | undefined): Side | null => (side !== undefined && isSplitId(id) ? side : null);
  return {
    ...base,
    get(id, side) {
      const s = sideOf(id, side);
      if (!s) return base.get(id);
      const { view, swapped } = sideView(edit, id as SplitParamId, s, persons);
      return swapped.length ? baseLensFor(view, sel, persons, primary, opts).get(id) : base.get(id);
    },
    set(id, v, side) {
      const s = sideOf(id, side);
      if (!s) return base.set(id, v);
      const { view, swapped } = sideView(edit, id as SplitParamId, s, persons);
      if (!swapped.length) return base.set(id, v);
      const out = baseLensFor(view, sel, persons, primary, opts).set(id, v);
      if (out === view) return edit;
      const back = { ...out.persons };
      // a person step 1's routing did not write gets its own object back (or, a template person, no entry again); a
      // written one swaps its halves back
      for (const pid of swapped) {
        if (back[pid] !== view.persons[pid]) back[pid] = swapHalves(back[pid], id as SplitParamId);
        else if (pid in edit.persons) back[pid] = edit.persons[pid];
        else delete back[pid];
      }
      return { ...out, persons: back };
    },
    split() {
      const ref = base.faceTargets()[0] ?? (sel.kind === 'person' ? sel.id : primary);
      return (personOf(edit, ref).right ?? null) !== null;
    },
    setSplit(on, activeSide) {
      return mapTargets(edit, (p, pid) => (on ? splitOn(p) : splitOff(p, slotFor(swapOf(pid), activeSide))));
    },
    ensureOn(id, v) {
      const key = id as PersonParamId;
      return mapTargets(edit, (p) => (p.values[key] > 0.01 ? p : { ...p, values: { ...p.values, [key]: v } }));
    },
    resetGroup(group) {
      // step 1's resetGroup('makeup') already sets every face target's six shades to null
      const out = base.resetGroup(group);
      return group === 'shape' ? mapTargets(out, (p) => (p.right === null ? p : { ...p, right: null })) : out;
    },
  };
}

export function lensFor(edit: EditState, sel: Selection, persons: readonly PersonInfo[], primary: PersonId, opts: LensOptions = {}): Lens {
  return withFaceDetail(baseLensFor(edit, sel, persons, primary, opts), opts);
}
