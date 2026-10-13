// 祛痘 spots (skin-cleanup spec §2.3, §3.3, §5): the photo-level list, edited immutably, and its sanitizer. Pure.
// Task 13 adds the tap planning (radius, regions, snap, donor) to this module.
import { SPOT_CAP } from '../config/limits';
import type { EditState, PersonId, Selection, Spot } from '../types';

/** what 清除 removes: one person's spots (清除此人) or every spot (全部清除) */
export type ClearScope = PersonId | 'all';

/** Appends `spot`; at SPOT_CAP the state is returned unchanged (the caller shows 祛痘點已達上限). */
export function addSpot(edit: EditState, spot: Spot): EditState {
  if (edit.photo.spots.length >= SPOT_CAP) return edit;
  return { ...edit, photo: { ...edit.photo, spots: [...edit.photo.spots, spot] } };
}

/** Removes the spots of `scope`; a clear that removes nothing returns `edit` itself (no undo step). */
export function clearSpots(edit: EditState, scope: ClearScope): EditState {
  const kept = scope === 'all' ? [] : edit.photo.spots.filter((s) => s.owner !== scope);
  if (kept.length === edit.photo.spots.length) return edit;
  return { ...edit, photo: { ...edit.photo, spots: kept } };
}

export function spotsInScope(edit: EditState, scope: ClearScope): number {
  return scope === 'all' ? edit.photo.spots.length : edit.photo.spots.filter((s) => s.owner === scope).length;
}

/** 清除此人 with one person of a group photo selected; 全部清除 otherwise (fewer than 2 persons, or 全部). */
export function clearScope(sel: Selection, selectablePersons: number): ClearScope {
  return sel.kind === 'person' && selectablePersons >= 2 ? sel.id : 'all';
}

/** Owners after a person rename (C §5.2 rematch); positions never change, they are in O. */
export function remapSpotOwners(spots: readonly Spot[], rename: (id: PersonId) => PersonId | null): Spot[] {
  return spots.map((s) => (s.owner === null ? s : { ...s, owner: rename(s.owner) }));
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * One stored spot, validated (§5): non-finite → dropped; centre outside [−0.01, 1.01] → dropped, else clamped to [0, 1];
 * r clamped to [0.0005, 0.04]; a donor farther than 0.2 → fill mode; an owner not in `personIds` → null
 * (`personIds` null = the detection cache was dropped: owners are kept for the rematch).
 */
export function sanitizeSpot(raw: unknown, personIds: ReadonlySet<PersonId> | null): Spot | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (!finite(s.x) || !finite(s.y) || !finite(s.r) || !finite(s.dx) || !finite(s.dy)) return null;
  if (s.x < -0.01 || s.x > 1.01 || s.y < -0.01 || s.y > 1.01) return null;
  const far = Math.hypot(s.dx, s.dy) > 0.2;
  const owner = typeof s.owner === 'string' && (personIds === null || personIds.has(s.owner)) ? s.owner : null;
  return {
    x: Math.min(1, Math.max(0, s.x)),
    y: Math.min(1, Math.max(0, s.y)),
    r: Math.min(0.04, Math.max(0.0005, s.r)),
    dx: far ? 0 : s.dx,
    dy: far ? 0 : s.dy,
    owner,
  };
}

/** The stored list: the first SPOT_CAP valid spots; none at all without an O size (the camera look, C §3.2). */
export function sanitizeSpots(raw: unknown, personIds: ReadonlySet<PersonId> | null, hasOSize: boolean): Spot[] {
  if (!hasOSize || !Array.isArray(raw)) return [];
  const out: Spot[] = [];
  for (const r of raw) {
    if (out.length >= SPOT_CAP) break;
    const s = sanitizeSpot(r, personIds);
    if (s) out.push(s);
  }
  return out;
}
