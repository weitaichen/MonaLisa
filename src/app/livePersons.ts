// The camera session (camera per-person spec §5.1, §7.4–§7.6): the persons the live camera has seen, their params, the
// selection, 全部套用 and the away pool. Identity is geometry and time only (U5); every ambiguity is a new person at 原圖
// (A2). Pure: no DOM, no clock of its own (every time is the caller's, on the live loop's clock).
import { LIVE_IDLE_MAX_MS, MAX_LIVE_FACES, REID_AMBIGUITY, REID_DIST, REID_GRACE_MS, REID_SIZE } from '../config/limits';
import { isNeutralPerson, neutralPerson } from '../edit/state';
import type { Facing, PersonParams, Rect } from '../types';

/** a camera person, per session, counting up from 1 (debug id `c{n}`) */
export type LivePersonId = number;

/**
 * §7.4's distance of a new box `next` from a person last seen at `prev` (unmirrored video UV; `aspect` = frame width /
 * height): the centre distance in frame-height units, or null when it is farther than REID_DIST × prev's width or the
 * widths differ by more than × REID_SIZE
 */
export function reidDistance(prev: Rect, next: Rect, aspect: number): number | null {
  if (!(prev.w > 0 && next.w > 0)) return null;
  const d = Math.hypot((next.x + next.w / 2 - (prev.x + prev.w / 2)) * aspect, next.y + next.h / 2 - (prev.y + prev.h / 2));
  if (!(d <= REID_DIST * prev.w * aspect)) return null;
  if (Math.max(next.w / prev.w, prev.w / next.w) > REID_SIZE) return null;
  return d;
}

/** the nearest candidate; null when there is none or another is within × REID_AMBIGUITY of it (two at 0 included, A2) */
export function nearestUnambiguous<T>(cands: readonly { item: T; d: number }[]): T | null {
  let best = -1;
  for (let i = 0; i < cands.length; i++) if (best < 0 || cands[i].d < cands[best].d) best = i;
  if (best < 0) return null;
  const limit = REID_AMBIGUITY * cands[best].d;
  for (let i = 0; i < cands.length; i++) if (i !== best && cands[i].d <= limit) return null;
  return cands[best].item;
}

/** what FaceTracks needs of the session: persons for its tracks, the A7 pick in, the weights' and the marker's inputs out */
export interface TrackPersons {
  /** a new track's person: an away person re-identified (§7.4), else a new one at 原圖 */
  claim(box: Rect, aspect: number, now: number): LivePersonId;
  /** a dropped track's person, with its last shown box and time: to the away pool when edited or remembered (§7.6) */
  release(id: LivePersonId, box: Rect, now: number): void;
  /** the persons of the shown tracks (found or held) and the A7 auto pick, every step */
  sync(inView: readonly LivePersonId[], auto: LivePersonId | null): void;
  edited(id: LivePersonId): boolean;
  params(id: LivePersonId): PersonParams | null;
  target(): LivePersonId | null;
  all(): boolean;
}

interface AwayEntry {
  id: LivePersonId;
  /** the track's last shown box (unmirrored video UV) and its time on the session clock */
  box: Rect;
  lastSeen: number;
}

export class LivePersons implements TrackPersons {
  /** every person the session knows (in view, held or away) → params; null = never edited (原圖) */
  private readonly known = new Map<LivePersonId, PersonParams | null>();
  /** away persons (edited, or the remembered selection), at most MAX_LIVE_FACES, in release order */
  private pool: AwayEntry[] = [];
  private nextId = 1;
  /** the pinned selection; null = 'auto' */
  private pinned: LivePersonId | null = null;
  /** a pinned person who left: claimed again before a tap, an edit or the pool clearing, they are pinned again (§7.6) */
  private returnTo: LivePersonId | null = null;
  private shown: readonly LivePersonId[] = [];
  private autoPick: LivePersonId | null = null;
  private allOn = false;
  /** 全部套用's lead: the target when it was turned on (§7.6); it does not move while on */
  private lead: LivePersonId | null = null;
  /** 全部套用's params, given to every face entering the view; null = 原圖 */
  private shared: PersonParams | null = null;
  private amb: PersonParams = neutralPerson();
  /** false after clear() until the next resume: releases from a loop that is stopping are dropped (Review Focus #1) */
  private open = true;
  private facing: Facing | null = null;
  private pausedAt: number | null = null;
  private v = 0;

  /** moves on every change (the UI store reads it) */
  get version(): number {
    return this.v;
  }

  /** 基本模式's all-skin person (§3.6); 原圖 otherwise */
  get ambient(): PersonParams {
    return this.amb;
  }

  setAmbient(p: PersonParams): void {
    this.amb = p;
    this.v++;
  }

  params(id: LivePersonId): PersonParams | null {
    return this.known.get(id) ?? null;
  }

  edited(id: LivePersonId): boolean {
    return this.params(id) !== null;
  }

  /** `p` to each listed person the session knows (in view, held or away); neutral `p` → never edited again (§3.3) */
  write(ids: readonly LivePersonId[], p: PersonParams): void {
    this.put(ids, isNeutralPerson(p) ? null : p);
    this.v++;
  }

  claim(box: Rect, aspect: number, now: number): LivePersonId {
    const cands: { item: AwayEntry; d: number }[] = [];
    for (const e of this.pool) {
      if (now - e.lastSeen > REID_GRACE_MS) continue;
      const d = reidDistance(e.box, box, aspect);
      if (d !== null) cands.push({ item: e, d });
    }
    const hit = nearestUnambiguous(cands);
    this.v++;
    if (hit) {
      this.pool = this.pool.filter((e) => e !== hit);
      if (hit.id === this.returnTo) {
        this.pinned = hit.id;
        this.returnTo = null;
      }
      return hit.id;
    }
    const id = this.nextId++;
    this.known.set(id, null);
    return id;
  }

  release(id: LivePersonId, box: Rect, now: number): void {
    if (!this.open || !this.known.has(id)) return;
    if (this.pinned === id) {
      this.pinned = null;
      this.returnTo = id;
    }
    if (this.shown.includes(id)) this.shown = this.shown.filter((x) => x !== id);
    if (this.autoPick === id) this.autoPick = null;
    if (this.edited(id) || this.returnTo === id) {
      this.pool = this.pool.filter((e) => e.id !== id);
      this.pool.push({ id, box: { ...box }, lastSeen: now });
      while (this.pool.length > MAX_LIVE_FACES) {
        let oldest = 0;
        for (let i = 1; i < this.pool.length; i++) if (this.pool[i].lastSeen < this.pool[oldest].lastSeen) oldest = i;
        const [gone] = this.pool.splice(oldest, 1);
        this.known.delete(gone.id);
        if (this.returnTo === gone.id) this.returnTo = null;
      }
    } else this.known.delete(id);
    this.v++;
  }

  sync(inView: readonly LivePersonId[], auto: LivePersonId | null): void {
    const prev = this.shown;
    const sameList = inView.length === prev.length && inView.every((id, i) => id === prev[i]);
    if (sameList && auto === this.autoPick) return;
    if (!sameList && this.allOn) {
      // a face entering the view under 全部套用 gets the shared params, 原圖 included (§3.4)
      const before = new Set(prev);
      this.put(inView.filter((id) => !before.has(id)), this.shared);
    }
    this.shown = [...inView];
    this.autoPick = auto;
    this.v++;
  }

  inView(): readonly LivePersonId[] {
    return this.shown;
  }

  selection(): 'auto' | LivePersonId {
    return this.pinned ?? 'auto';
  }

  pin(id: LivePersonId): void {
    this.pinned = id;
    this.returnTo = null;
    this.v++;
  }

  /** the person the sliders edit (§3.2): 全部套用's lead while in view, else the pinned person while in view, else the auto pick; null with no face shown */
  target(): LivePersonId | null {
    if (!this.shown.length) return null;
    const first = this.allOn ? this.lead : this.pinned;
    return first !== null && this.shown.includes(first) ? first : this.autoPick;
  }

  all(): boolean {
    return this.allOn;
  }

  /** 全部套用 (§3.4, K10): on copies the target's params (原圖 when untouched) to everyone in view; off reverts nobody */
  setAll(on: boolean): void {
    if (on === this.allOn) return;
    if (on) {
      const lead = this.target();
      this.lead = lead;
      this.shared = lead === null ? null : this.params(lead);
      this.put(this.shown, this.shared);
    } else {
      this.lead = null;
      this.shared = null;
    }
    this.allOn = on;
    this.v++;
  }

  /** the persons an edit writes: everyone in view under 全部套用, else the target, [] with no face shown */
  editTargets(): LivePersonId[] {
    if (this.allOn) return [...this.shown];
    const t = this.target();
    return t === null ? [] : [t];
  }

  /** the params the panel shows: the shared ones under 全部套用, else `lead`'s (a drag's) or the target's; 原圖 when untouched */
  panelParams(lead: LivePersonId | null = null): PersonParams {
    if (this.allOn) return this.shared ?? neutralPerson();
    const id = lead ?? this.target();
    return (id === null ? null : this.params(id)) ?? neutralPerson();
  }

  /** a panel edit: the first one while the selection is auto pins the auto pick (K9); it cancels a pending return (§7.6) */
  edit(p: PersonParams, ids: readonly LivePersonId[] = this.editTargets()): void {
    if (!this.allOn && this.pinned === null && this.autoPick !== null && ids.includes(this.autoPick)) this.pinned = this.autoPick;
    this.returnTo = null;
    if (this.allOn) this.shared = isNeutralPerson(p) ? null : p;
    this.write(ids, p);
  }

  /** the loop pauses or stops: the session clock stops here (§7.5) */
  pause(now: number): void {
    this.pausedAt ??= now;
  }

  /**
   * the next live frame (§7.5): another facing ends the session first; the session opens on `facing`; a pause longer
   * than LIVE_IDLE_MAX_MS forgets everyone away and the remembered selection, a shorter one costs the away pool no grace
   */
  resume(now: number, facing: Facing): void {
    if (this.facing !== null && this.facing !== facing) this.clear();
    const changed = !this.open || this.facing !== facing || this.pausedAt !== null;
    this.open = true;
    this.facing = facing;
    if (this.pausedAt !== null) {
      const span = now - this.pausedAt;
      this.pausedAt = null;
      if (span > LIVE_IDLE_MAX_MS) {
        for (const e of this.pool) this.known.delete(e.id);
        this.pool = [];
        this.returnTo = null;
      } else if (span > 0) for (const e of this.pool) e.lastSeen += span;
    }
    if (changed) this.v++;
  }

  /** a new session (✕, a flip, §3.11): ids from 1, nobody known, auto, 全部套用 off, ambient 原圖; closed until the next resume */
  clear(): void {
    this.known.clear();
    this.pool = [];
    this.nextId = 1;
    this.pinned = null;
    this.returnTo = null;
    this.shown = [];
    this.autoPick = null;
    this.allOn = false;
    this.lead = null;
    this.shared = null;
    this.amb = neutralPerson();
    this.open = false;
    this.facing = null;
    this.pausedAt = null;
    this.v++;
  }

  private put(ids: readonly LivePersonId[], p: PersonParams | null): void {
    for (const id of ids) if (this.known.has(id)) this.known.set(id, p);
  }
}
