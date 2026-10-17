// Camera face tracks (S §3.4 T4): de-duplicate, match, hold, smooth (MediaPipe's smoother, bypassed at one face),
// select (auto = the largest with the A7 hysteresis, or a pinned track) and ease each face's beautify weight, its
// presence (the neighbours' caps, A3) and the any-face weight (the global skin, A2). Pure: no DOM, no GL.
import { LOST_HOLD_MS, MAX_LIVE_FACES } from '../config/limits';
import { boxIoU } from '../detect/faces';
import { ovalBox } from '../engine/passes/faceCap';
import { adapt } from '../tracking/adapter111';
import type { Face, Landmarks478, Rect } from '../types';
import { FaceWeightEaser } from './liveCore';
import { LandmarkSmoother } from './oneEuro';

export type TrackId = number;
export type CameraSelection = 'auto' | TrackId;

export interface LiveTrackView {
  id: TrackId;
  /** the shown (smoothed) face's oval box, unmirrored video UV */
  box: Rect;
  /** the last raw detection's box: the hand-over seed (C2) */
  rawBox: Rect;
  face: Face;
  /** beautify weight 0..1 */
  weight: number;
  /** presence 0..1: scales this face's part in its neighbours' caps (A3) */
  presence: number;
  /** the face beautified without 全部套用 (the pinned one, else the auto pick) */
  beautified: boolean;
  /** found by the last detection (false while held) */
  present: boolean;
}

interface Track {
  id: TrackId;
  filter: LandmarkSmoother | null;
  shown: Face;
  box: Rect;
  rawBox: Rect;
  present: boolean;
  lastSeen: number;
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
const area = (b: Rect) => b.w * b.h;
const centre = (b: Rect): [number, number] => [b.x + b.w / 2, b.y + b.h / 2];
const finiteBox = (b: Rect) => b.w > 0 && b.h > 0 && Number.isFinite(b.x + b.y + b.w + b.h);

export class FaceTracks {
  private list: Track[] = [];
  private nextId = 1;
  private sel: CameraSelection = 'auto';
  private autoId: TrackId | null = null;
  private challenger: { id: TrackId; since: number } | null = null;
  private readonly any = new FaceWeightEaser();
  private readonly max: number;
  private readonly hold: number;
  /** a no-answer stretch began here: the hold clock is paused until the next answer (S §3.4 T4, A5) */
  private noAnswerSince: number | null = null;

  constructor(opts: { maxFaces?: number; holdMs?: number } = {}) {
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
    // match: greedy by IoU ≥ 0.3, then the nearest centre within half a box width
    const free = new Set(this.list);
    const used = new Set<Det>();
    const pairs: [Track, Det][] = [];
    const cand = this.list
      .flatMap((t) => unique.map((d) => ({ t, d, iou: boxIoU(t.box, d.box) })))
      .filter((c) => c.iou >= 0.3)
      .sort((a, b) => b.iou - a.iou);
    for (const c of cand) {
      if (!free.has(c.t) || used.has(c.d)) continue;
      free.delete(c.t);
      used.add(c.d);
      pairs.push([c.t, c.d]);
    }
    for (const t of [...free]) {
      const [tx, ty] = centre(t.box);
      let best: Det | null = null;
      let bestD = 0.5 * t.box.w;
      for (const d of unique) {
        if (used.has(d)) continue;
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
    // one track, one face: the same track wherever the face went (after no answer, a [] gap or a brisk pan), as v0.3
    // followed lms[0] (S §1.2 item 1); a new track would leave the held one the target, and the only face unbeautified
    if (this.list.length === 1 && unique.length === 1 && pairs.length === 0) {
      const t = this.list[0];
      free.delete(t);
      used.add(unique[0]);
      pairs.push([t, unique[0]]);
    }
    for (const [t, d] of pairs) this.feed(t, d, tsMs, w, h);
    for (const t of free) t.present = false;
    // unmatched detections start tracks, largest first, while there is room; ids count up per session
    for (const d of unique) {
      if (used.has(d) || this.list.length >= this.max) continue;
      const t: Track = {
        id: this.nextId++,
        filter: this.max > 1 ? new LandmarkSmoother() : null,
        shown: d.face,
        box: d.box,
        rawBox: d.box,
        present: true,
        lastSeen: tsMs,
        easer: new FaceWeightEaser(),
        presence: new FaceWeightEaser(),
      };
      this.feed(t, d, tsMs, w, h);
      this.list.push(t);
    }
    this.list = this.list.filter((t) => t.present || tsMs - t.lastSeen <= this.hold);
    if (this.sel !== 'auto' && !this.list.some((t) => t.id === this.sel)) this.sel = 'auto';
    if (this.autoId !== null && !this.list.some((t) => t.id === this.autoId)) this.autoId = null;
  }

  private feed(t: Track, d: Det, tsMs: number, w: number, h: number): void {
    t.rawBox = d.box;
    t.present = true;
    t.lastSeen = tsMs;
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

  /** every frame (tracks hold between detections): the A7 auto pick, then the easers */
  step(dtMs: number, all: boolean, nowMs: number): void {
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
    const target = this.sel === 'auto' ? this.autoId : this.sel;
    for (const t of this.list) {
      t.easer.update(t.present && (all || t.id === target), dtMs);
      t.presence.update(t.present, dtMs);
    }
    this.any.update(present.length > 0, dtMs);
  }

  views(): LiveTrackView[] {
    const target = this.sel === 'auto' ? this.autoId : this.sel;
    return this.list.map((t) => ({
      id: t.id,
      box: t.box,
      rawBox: t.rawBox,
      face: t.shown,
      weight: t.easer.value,
      presence: t.presence.value,
      beautified: t.id === target,
      present: t.present,
    }));
  }

  /** "any face present", eased: 1 − it is the global skin's weight (A2); one face: today's single easer */
  get anyFace(): number {
    return this.any.value;
  }

  beautified(): LiveTrackView | null {
    return this.views().find((v) => v.beautified) ?? null;
  }

  select(id: TrackId): void {
    if (this.list.some((t) => t.id === id)) this.sel = id;
  }

  selection(): CameraSelection {
    return this.sel;
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

  /** resetSession / pause: no tracks, auto; 全部套用 is not ours to touch */
  reset(): void {
    this.list = [];
    this.sel = 'auto';
    this.autoId = null;
    this.challenger = null;
    this.noAnswerSince = null;
    this.any.reset(0);
  }
}

export type TapAction = { kind: 'collapse' } | { kind: 'select'; id: TrackId; allOff: boolean };

/** S §2.5: what a camera tap does */
export function cameraTapAction(hit: TrackId | null, shownTracks: number, selection: CameraSelection, allOn: boolean): TapAction {
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
