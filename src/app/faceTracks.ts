// Camera face tracks (S §3.4 T4; camera per-person spec §5.2, §7): de-duplicate, match against each track's predicted
// box (velocity, the size gate), continue a held track through the re-identification gates, hold, smooth (MediaPipe's
// smoother, bypassed at one face), and give each track a camera person: `claim` when it starts, `release` when it is
// dropped or reset. The A7 auto pick goes to the session (`sync`), which owns the selection; each face's weight eases
// toward "present and its person edited", its presence (the neighbours' caps, A3) and the any-face weight (the global
// skin, A2) as before. Pure: no DOM, no GL.
import { LOST_HOLD_MS, MAX_LIVE_FACES, TRACK_SIZE_JUMP } from '../config/limits';
import { boxIoU } from '../detect/faces';
import { ovalBox } from '../engine/passes/faceCap';
import { adapt } from '../tracking/adapter111';
import type { Face, Landmarks478, Rect } from '../types';
import { FaceWeightEaser } from './liveCore';
import { type LivePersonId, nearestUnambiguous, reidDistance, type TrackPersons } from './livePersons';
import { LandmarkSmoother } from './oneEuro';

export type TrackId = number;
/** the camera's selection: auto (the target follows the A7 pick) or a pinned person */
export type CameraSelection = 'auto' | LivePersonId;

export interface LiveTrackView {
  id: TrackId;
  /** the camera person this track shows (kept for the track's life) */
  person: LivePersonId;
  /** the shown (smoothed) face's oval box, unmirrored video UV */
  box: Rect;
  /** the last raw detection's box: the hand-over seed (C2) */
  rawBox: Rect;
  face: Face;
  /** beautify weight 0..1 */
  weight: number;
  /** presence 0..1: scales this face's part in its neighbours' caps (A3) */
  presence: number;
  /** the person's params differ from 原圖 */
  edited: boolean;
  /** the target's track (the person the sliders edit) */
  selected: boolean;
  /** found by the last detection (false while held) */
  present: boolean;
  /** the track's last refresh (ms, the loop's clock) */
  seen: number;
  /** the view that last refreshed it ('video' on the solo path) */
  view: string;
}

interface Track {
  id: TrackId;
  person: LivePersonId;
  filter: LandmarkSmoother | null;
  shown: Face;
  box: Rect;
  rawBox: Rect;
  present: boolean;
  /** the hold's clock: the last refresh, moved on by a no-answer stretch (A5) */
  lastSeen: number;
  /** the last refresh as it happened */
  seen: number;
  /** box-centre velocity, UV per ms: an EMA (τ VELOCITY_TAU_MS) of the raw boxes' Δcentre / Δt (§7.2) */
  vx: number;
  vy: number;
  view: string;
  easer: FaceWeightEaser;
  presence: FaceWeightEaser;
}

interface Det {
  lm: Landmarks478;
  face: Face;
  box: Rect;
}

/** A7: auto switches only to a face ≥ 1.2× larger for 500 ms */
const AUTO_RATIO = 1.2;
const AUTO_HOLD_MS = 500;
/** §7.2: the velocity EMA's time constant */
const VELOCITY_TAU_MS = 200;
const area = (b: Rect) => b.w * b.h;
const centre = (b: Rect): [number, number] => [b.x + b.w / 2, b.y + b.h / 2];
const finiteBox = (b: Rect) => b.w > 0 && b.h > 0 && Number.isFinite(b.x + b.y + b.w + b.h);
/** §7.3 item 3: a face whose width differs from the predicted box by more than × TRACK_SIZE_JUMP is someone else */
const sizeOk = (p: Rect, d: Rect) => Math.max(d.w / p.w, p.w / d.w) <= TRACK_SIZE_JUMP;

export class FaceTracks {
  private list: Track[] = [];
  private nextId = 1;
  /** the A7 auto pick (a track; its person goes to the session) */
  private autoId: TrackId | null = null;
  private challenger: { id: TrackId; since: number } | null = null;
  private readonly any = new FaceWeightEaser();
  private readonly max: number;
  private readonly hold: number;
  /** the last detection's frame width / height (the predicted box's one-width bound and the gates' distances) */
  private aspect = 1;
  /** a no-answer stretch began here: the hold clock is paused until the next answer (S §3.4 T4, A5) */
  private noAnswerSince: number | null = null;

  constructor(
    private readonly persons: TrackPersons,
    opts: { maxFaces?: number; holdMs?: number } = {},
  ) {
    this.max = Math.max(1, opts.maxFaces ?? MAX_LIVE_FACES);
    this.hold = opts.holdMs ?? LOST_HOLD_MS;
  }

  /** a detecting frame. null = no answer: tracks and selection held, every easer eases out (A5); [] = no face */
  detect(lms: readonly Landmarks478[] | null, tsMs: number, w: number, h: number): void {
    if (lms === null) {
      for (const t of this.list) t.present = false;
      this.noAnswerSince ??= tsMs;
      return;
    }
    if (this.noAnswerSince !== null) {
      // "lastSeen does not age" while the tracker cannot answer (a context loss, the rebuild throttle): the hold resumes
      // where it stopped, so a face missed on the first frames back is still held and a pinned selection survives
      const paused = Math.max(0, tsMs - this.noAnswerSince);
      for (const t of this.list) t.lastSeen += paused;
      this.noAnswerSince = null;
    }
    const aspect = w / h;
    this.aspect = aspect;
    const dets: Det[] = [];
    for (const lm of lms) {
      const face = adapt(lm, w, h);
      const box = ovalBox(face);
      if (finiteBox(box)) dets.push({ lm, face, box });
    }
    // two ROIs converged on one face (IoU > 0.6, T3's rule): keep the one matching a track, else the larger
    const onTrack = (b: Rect) => this.list.some((t) => boxIoU(t.box, b) >= 0.3);
    dets.sort((a, b) => area(b.box) - area(a.box));
    const unique: Det[] = [];
    for (const d of dets) {
      const j = unique.findIndex((u) => boxIoU(u.box, d.box) > 0.6);
      if (j < 0) unique.push(d);
      else if (!onTrack(unique[j].box) && onTrack(d.box)) unique[j] = d;
    }
    // §7.3: every rule matches against the predicted boxes, and refuses a pair across the size gate
    const pred = new Map<Track, Rect>(this.list.map((t) => [t, this.predict(t, tsMs)]));
    const free = new Set(this.list);
    const used = new Set<Det>();
    const pairs: [Track, Det][] = [];
    // greedy by IoU ≥ 0.3
    const cand = this.list
      .flatMap((t) => unique.map((d) => ({ t, d, iou: boxIoU(pred.get(t)!, d.box) })))
      .filter((c) => c.iou >= 0.3 && sizeOk(pred.get(c.t)!, c.d.box))
      .sort((a, b) => b.iou - a.iou);
    for (const c of cand) {
      if (!free.has(c.t) || used.has(c.d)) continue;
      free.delete(c.t);
      used.add(c.d);
      pairs.push([c.t, c.d]);
    }
    // then the nearest centre within half a predicted box width
    for (const t of [...free]) {
      const p = pred.get(t)!;
      const [tx, ty] = centre(p);
      let best: Det | null = null;
      let bestD = 0.5 * p.w;
      for (const d of unique) {
        if (used.has(d) || !sizeOk(p, d.box)) continue;
        const [dx, dy] = centre(d.box);
        const dist = Math.hypot(dx - tx, dy - ty);
        if (dist <= bestD) {
          bestD = dist;
          best = d;
        }
      }
      if (!best) continue;
      free.delete(t);
      used.add(best);
      pairs.push([t, best]);
    }
    // §7.3 item 4, continuation: a detection still unmatched, largest first, continues a track within the hold whose
    // predicted box passes the re-identification gates (§7.4), the nearest unless another is about as near (A2)
    for (const d of unique.filter((x) => !used.has(x)).sort((a, b) => area(b.box) - area(a.box))) {
      const near: { item: Track; d: number }[] = [];
      for (const t of free) {
        if (tsMs - t.lastSeen > this.hold) continue;
        const r = reidDistance(pred.get(t)!, d.box, aspect);
        if (r !== null) near.push({ item: t, d: r });
      }
      const t = nearestUnambiguous(near);
      if (!t) continue;
      free.delete(t);
      used.add(d);
      pairs.push([t, d]);
    }
    // MAX_LIVE_FACES = 1 (v0.3's camera, one person): one track, one face, wherever the face went (S §1.2 item 1)
    if (this.max === 1 && this.list.length === 1 && unique.length === 1 && pairs.length === 0) {
      const t = this.list[0];
      free.delete(t);
      used.add(unique[0]);
      pairs.push([t, unique[0]]);
    }
    for (const [t, d] of pairs) this.feed(t, d, tsMs, w, h);
    for (const t of free) t.present = false;
    // §7.3 item 5: unmatched detections start tracks, largest first, each with the person `claim` gives it; when full,
    // the held track seen longest ago is dropped early (its person released) to make room, and only such a track
    for (const d of unique.filter((x) => !used.has(x)).sort((a, b) => area(b.box) - area(a.box))) {
      if (this.list.length >= this.max) {
        let oldest: Track | null = null;
        for (const t of this.list) if (!t.present && (!oldest || t.lastSeen < oldest.lastSeen)) oldest = t;
        if (!oldest) break;
        this.drop(oldest);
      }
      const t: Track = {
        id: this.nextId++,
        person: this.persons.claim(d.box, aspect, tsMs),
        filter: this.max > 1 ? new LandmarkSmoother() : null,
        shown: d.face,
        box: d.box,
        rawBox: d.box,
        present: true,
        lastSeen: tsMs,
        seen: tsMs,
        vx: 0,
        vy: 0,
        view: 'video',
        easer: new FaceWeightEaser(),
        presence: new FaceWeightEaser(),
      };
      this.feed(t, d, tsMs, w, h);
      this.list.push(t);
    }
    // §7.3 item 6: a track missing longer than the hold is dropped and its person released
    for (const t of this.list.filter((x) => !x.present && tsMs - x.lastSeen > this.hold)) this.drop(t);
    if (this.autoId !== null && !this.list.some((t) => t.id === this.autoId)) this.autoId = null;
  }

  /** §7.2: the track's box moved by its velocity since its last refresh, at most one box width */
  private predict(t: Track, tsMs: number): Rect {
    const dt = Math.max(0, tsMs - t.lastSeen);
    let dx = t.vx * dt;
    let dy = t.vy * dt;
    const len = Math.hypot(dx * this.aspect, dy);
    const max = t.box.w * this.aspect;
    if (len > max) {
      dx *= max / len;
      dy *= max / len;
    }
    return { ...t.box, x: t.box.x + dx, y: t.box.y + dy };
  }

  private drop(t: Track): void {
    this.list = this.list.filter((x) => x !== t);
    this.persons.release(t.person, t.box, t.lastSeen);
  }

  private feed(t: Track, d: Det, tsMs: number, w: number, h: number): void {
    const dt = tsMs - t.lastSeen;
    if (dt > 0) {
      const [px, py] = centre(t.rawBox);
      const [nx, ny] = centre(d.box);
      const a = 1 - Math.exp(-dt / VELOCITY_TAU_MS);
      t.vx += ((nx - px) / dt - t.vx) * a;
      t.vy += ((ny - py) / dt - t.vy) * a;
    }
    t.rawBox = d.box;
    t.present = true;
    t.lastSeen = tsMs;
    t.seen = tsMs;
    if (t.filter) {
      t.shown = adapt({ points: t.filter.apply(d.lm.points, w, h, tsMs) }, w, h);
      const b = ovalBox(t.shown);
      t.box = finiteBox(b) ? b : d.box;
    } else {
      // MAX_LIVE_FACES = 1: MediaPipe smooths at numFaces 1; the shown face is the raw one (v0.3)
      t.shown = d.face;
      t.box = d.box;
    }
  }

  /** every frame (tracks hold between detections): the A7 auto pick to the session, then the easers */
  step(dtMs: number, nowMs: number): void {
    const present = this.list.filter((t) => t.present);
    const largest = present.reduce<Track | null>((a, t) => (!a || area(t.box) > area(a.box) ? t : a), null);
    if (this.autoId === null) {
      this.autoId = largest?.id ?? null;
      this.challenger = null;
    } else if (largest && largest.id !== this.autoId) {
      const cur = this.list.find((t) => t.id === this.autoId)!;
      if (area(largest.box) >= AUTO_RATIO * area(cur.box)) {
        if (this.challenger?.id !== largest.id) this.challenger = { id: largest.id, since: nowMs };
        else if (nowMs - this.challenger.since >= AUTO_HOLD_MS) {
          this.autoId = largest.id;
          this.challenger = null;
        }
      } else this.challenger = null;
    } else this.challenger = null;
    const auto = this.list.find((t) => t.id === this.autoId);
    this.persons.sync(
      this.list.map((t) => t.person),
      auto?.person ?? null,
    );
    for (const t of this.list) {
      // §3.3: only an edited person is drawn; an untouched face stays listed at weight 0 (caps only)
      t.easer.update(t.present && this.persons.edited(t.person), dtMs);
      t.presence.update(t.present, dtMs);
    }
    this.any.update(present.length > 0, dtMs);
  }

  views(): LiveTrackView[] {
    const target = this.persons.target();
    return this.list.map((t) => ({
      id: t.id,
      person: t.person,
      box: t.box,
      rawBox: t.rawBox,
      face: t.shown,
      weight: t.easer.value,
      presence: t.presence.value,
      edited: this.persons.edited(t.person),
      selected: t.person === target,
      present: t.present,
      seen: t.seen,
      view: t.view,
    }));
  }

  /** §7.2: track `id`'s box predicted at `nowMs`; null when there is no such track */
  predicted(id: TrackId, nowMs: number): Rect | null {
    const t = this.list.find((x) => x.id === id);
    return t ? this.predict(t, nowMs) : null;
  }

  /** "any face present", eased: 1 − it is the global skin's weight (A2); one face: today's single easer */
  get anyFace(): number {
    return this.any.value;
  }

  /** the shown track under (u, v), each box grown to at least minW × minH about its centre; nearest centre wins */
  hitTest(u: number, v: number, minW: number, minH: number): TrackId | null {
    let best: TrackId | null = null;
    let bestD = Infinity;
    for (const t of this.list) {
      const [cx, cy] = centre(t.box);
      const hw = Math.max(t.box.w, minW) / 2;
      const hh = Math.max(t.box.h, minH) / 2;
      if (Math.abs(u - cx) > hw || Math.abs(v - cy) > hh) continue;
      const d = Math.hypot(u - cx, v - cy);
      if (d < bestD) {
        bestD = d;
        best = t.id;
      }
    }
    return best;
  }

  /**
   * resetSession / pause / stop: every track's person is released with its last shown box and time (§7.5: to the away
   * pool when edited, so the next live frame re-identifies them in place), then nobody is in view (no target)
   */
  reset(): void {
    const gone = this.list;
    this.list = [];
    for (const t of gone) this.persons.release(t.person, t.box, t.lastSeen);
    this.autoId = null;
    this.challenger = null;
    this.noAnswerSince = null;
    this.any.reset(0);
    this.persons.sync([], null);
  }
}

export type TapAction = { kind: 'collapse' } | { kind: 'select'; id: LivePersonId; allOff: boolean };

/** S §2.5: what a camera tap does (`hit`: the person under the tap) */
export function cameraTapAction(hit: LivePersonId | null, shownTracks: number, selection: CameraSelection, allOn: boolean): TapAction {
  if (shownTracks < 2) return { kind: 'collapse' };
  if (allOn && hit !== null) return { kind: 'select', id: hit, allOff: true };
  if (hit !== null && selection !== hit) return { kind: 'select', id: hit, allOff: false };
  return { kind: 'collapse' };
}

/** C1: a client point on the cover-fitted canvas → unmirrored video UV, and 44 pt in UV at that scale */
export function coverTapUv(
  x: number,
  y: number,
  rect: { left: number; top: number; width: number; height: number },
  vw: number,
  vh: number,
  mirrored: boolean,
): { u: number; v: number; minW: number; minH: number } {
  const s = Math.max(rect.width / vw, rect.height / vh);
  let u = (x - rect.left - (rect.width - vw * s) / 2) / (vw * s);
  const v = (y - rect.top - (rect.height - vh * s) / 2) / (vh * s);
  if (mirrored) u = 1 - u;
  return { u, v, minW: 44 / (s * vw), minH: 44 / (s * vh) };
}

/** the inverse: unmirrored video UV → px inside the canvas rect (the face marker) */
export function videoToFrame(u: number, v: number, rect: { width: number; height: number }, vw: number, vh: number, mirrored: boolean): [number, number] {
  const s = Math.max(rect.width / vw, rect.height / vh);
  const uu = mirrored ? 1 - u : u;
  return [(rect.width - vw * s) / 2 + uu * vw * s, (rect.height - vh * s) / 2 + v * vh * s];
}

/** The 全部套用 chip (S §2.5): shows once ≥ 2 shown tracks lasted 300 ms, hides after < 2 for 1200 ms, never while on. */
export class ChipGate {
  private visible = false;
  private since: number | null = null;

  update(shownTracks: number, allOn: boolean, nowMs: number): boolean {
    if (allOn) {
      this.visible = true;
      this.since = null;
      return true;
    }
    const want = shownTracks >= 2;
    if (want === this.visible) {
      this.since = null;
      return this.visible;
    }
    this.since ??= nowMs;
    if (nowMs - this.since >= (want ? 300 : 1200)) {
      this.visible = want;
      this.since = null;
    }
    return this.visible;
  }
}
