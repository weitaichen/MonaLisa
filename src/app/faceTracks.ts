// Camera face tracks (S §3.4 T4; camera per-person spec §5.2, §7): de-duplicate, match against each track's predicted
// box (velocity, the size gate), continue a held track through the re-identification gates, hold, smooth (MediaPipe's
// smoother, bypassed at one face), and give each track a camera person: `take` when it starts (the re-identification
// decided over the held tracks and the away pool together, §7.4), `release` (with the path that last found it, K22) when
// it is dropped or reset. The A7 auto pick goes to the session (`sync`), which owns the
// selection; each face's weight eases toward "present and its person edited", its presence (the neighbours' caps, A3)
// and the any-face weight (the global skin, A2) as before. On the group path (§6.6) a detection is one view's call (at
// the shutter, every view's answer on the captured frame as one call, `detectViews`): it decides who each face is by the
// same rules over the same candidates whichever view answers (§7.1 I1–I3), feeds, misses and starts what its scope
// says, leaves a face whose owner it cannot see to a view that can, and every other track is no event for it. On both
// paths a call makes every decision first, from what it has read, then feeds, misses and takes, and releases last (I4,
// round-3 review E3). Pure: no DOM, no GL.
import { LOST_HOLD_MS, MAX_LIVE_FACES, REID_GRACE_MS, TRACK_SIZE_JUMP } from '../config/limits';
import { boxIoU, sameHead } from '../detect/faces';
import { ovalBox } from '../engine/passes/faceCap';
import { adapt } from '../tracking/adapter111';
import type { Face, Landmarks478, Rect } from '../types';
import { FaceWeightEaser } from './liveCore';
import { type LivePath, type LivePersonId, nearestUnambiguous, type PendingRelease, reidDistance, type TrackPersons } from './livePersons';
import type { DetectScope } from './liveViews';
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
  /** found by the last detection (false while held, and while stale) */
  present: boolean;
  /**
   * found, then unseen since a no-answer (A5, round-1 review C9): neither found nor known missing until a call that can
   * see it answers (a held track stays held through a no-answer, round-3 review E5; on the group path only a view that
   * could miss it makes it unseen, round-4 review F3, and a shutter view's no-answer makes nobody unseen, §6.6
   * Capture); the hand-over takes it as not known missing (round-2 review D7), its box the last answer's (`stale`, E5)
   */
  stale: boolean;
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
  /**
   * found, then unseen since a no-answer (A5): no call that can match or miss it has answered since, so it is neither
   * held nor found (it eases out, and is not dropped or evicted); on the solo path the next answer sees every track. A
   * track held at the no-answer stays held: known missing, its hold paused (round-3 review E5). On the group path a
   * view's no-answer is no event for a track it could not miss (round-4 review F3)
   */
  stale: boolean;
  /** the hold's clock: the last refresh, moved on by a no-answer stretch (A5) */
  lastSeen: number;
  /**
   * a no-answer that could miss this track began here: its hold's clock (`lastSeen`) is paused until the next answer
   * (S §3.4 T4, A5); null when none. Per track (round-5 review G4): one view's no-answer pauses only what it could miss
   */
  pausedSince: number | null;
  /** the last refresh as it happened */
  seen: number;
  /** box-centre velocity, UV per ms: an EMA (τ VELOCITY_TAU_MS) of the raw boxes' Δcentre / Δt (§7.2) */
  vx: number;
  vy: number;
  view: string;
  /** the path whose call last refreshed it (a scoped call: the group path); its person is released with it (K22) */
  path: LivePath;
  easer: FaceWeightEaser;
  presence: FaceWeightEaser;
}

interface Det {
  lm: Landmarks478;
  face: Face;
  box: Rect;
  /** the scope of the view that found it (undefined: the solo path's whole frame): what the call may do with it */
  src?: DetectScope;
}

/** one view's answer on the shutter's frame (FaceTracks.detectViews): its faces in stream UV and that view's scope */
export interface ViewAnswer {
  lms: readonly Landmarks478[];
  scope: DetectScope;
}

/** a candidate owner of a face (§7.3 item 4): a track, or an away person */
type Cand = { item: Track | LivePersonId; d: number };

/**
 * a face a call left to another view (§7.1 I3), one per event (round-3 review E1): where it is, when it was first left,
 * the views that left it and the tracks whose own view's answer it waits for, each since when
 */
interface LeftFace {
  box: Rect;
  at: number;
  views: Set<string>;
  waits: Map<Track, number>;
}

/** A7: auto switches only to a face ≥ 1.2× larger for 500 ms */
const AUTO_RATIO = 1.2;
const AUTO_HOLD_MS = 500;
/** §7.2: the velocity EMA's time constant */
const VELOCITY_TAU_MS = 200;
const area = (b: Rect) => b.w * b.h;
const centre = (b: Rect): [number, number] => [b.x + b.w / 2, b.y + b.h / 2];
const finiteBox = (b: Rect) => b.w > 0 && b.h > 0 && Number.isFinite(b.x + b.y + b.w + b.h);
/** float slack of a mapped view's edge (UV) */
const EDGE_EPS = 1e-9;
/** §6.6: the box lies inside the view whole (a face cut by the view's edge starts no track) */
const insideView = (v: Rect, b: Rect) =>
  b.x >= v.x - EDGE_EPS && b.y >= v.y - EDGE_EPS && b.x + b.w <= v.x + v.w + EDGE_EPS && b.y + b.h <= v.y + v.h + EDGE_EPS;
/** §7.3 item 3: a face whose width differs from the predicted box by more than × TRACK_SIZE_JUMP is someone else */
const sizeOk = (p: Rect, d: Rect) => Math.max(d.w / p.w, p.w / d.w) <= TRACK_SIZE_JUMP;
/** the path of a detection: a scoped call is one of the group path's views, an unscoped one the solo path's (§6.6) */
const pathOf = (scope: DetectScope | undefined): LivePath => (scope ? 'group' : 'solo');
const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/**
 * §6.6 Capture: several views' finds on one frame, one per face. Two finds of different views are one face only when
 * they are one head: their boxes overlap by IoU ≥ 0.3 (§7.3 item 2's same-face rule) and their landmarks say so
 * (`sameHead`, the rule measured on the photo's two detectors' meshes of one head, cut by the frame's edges included,
 * faces.ts), and no two of a face's finds match different tracks (`track`: a find's best track by §7.3 item 2's IoU
 * rule). Linked greedily by IoU, with at most one find of each view in a face (two finds of one view are two faces, as
 * that view's detector saw them). Each face is its best find: one its own view holds whole (`whole`; a find a view's
 * edge cuts is the face of a view that holds it whole, §6.6) before a cut one, then the larger. The order is the finds'
 * own. (Round-6 review H2, Codex #2: by box IoU alone, two people one partly behind the other, each found by a
 * different view of the cycle only, were one face, so the other's track went held and 編輯 dropped their edits)
 */
function onePerFace(all: readonly Det[], whole: (d: Det) => boolean, track: (d: Det) => Track | null, w: number, h: number): Det[] {
  const group = new Map<Det, Det[]>(all.map((d) => [d, [d]]));
  const links: { a: Det; b: Det; iou: number }[] = [];
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const [a, b] = [all[i], all[j]];
      if (a.src === b.src) continue;
      const iou = boxIoU(a.box, b.box);
      if (iou >= 0.3 && sameHead({ box: a.box, lm: a.lm.points }, { box: b.box, lm: b.lm.points }, w, h)) links.push({ a, b, iou });
    }
  links.sort((x, y) => y.iou - x.iou);
  const tracksOf = (g: readonly Det[]) => new Set(g.map(track).filter((t) => t !== null));
  for (const { a, b } of links) {
    const ga = group.get(a)!;
    const gb = group.get(b)!;
    if (ga === gb || ga.some((x) => gb.some((y) => x.src === y.src))) continue;
    const g = [...ga, ...gb];
    if (tracksOf(g).size > 1) continue;
    for (const d of g) group.set(d, g);
  }
  const better = (d: Det, p: Det) => (whole(d) !== whole(p) ? whole(d) : area(d.box) > area(p.box));
  return [...new Set(group.values())].map((g) => g.reduce((p, d) => (better(d, p) ? d : p)));
}

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
  /** faces a call left to another view (§7.1 I3), each until its answer is used (round-3 review E1) */
  private left: LeftFace[] = [];
  /** each group-path view's rect as last called: a view that comes back with another rect is a new layout (E1) */
  private readonly leftViews = new Map<string, Rect>();

  constructor(
    private readonly persons: TrackPersons,
    opts: { maxFaces?: number; holdMs?: number } = {},
  ) {
    this.max = Math.max(1, opts.maxFaces ?? MAX_LIVE_FACES);
    this.hold = opts.holdMs ?? LOST_HOLD_MS;
  }

  /**
   * a detecting frame. null = no answer: tracks and selection held, each track it leaves unseen eases out (A5; without
   * a scope, every track found); [] = no face. `scope`
   * (the group path, §6.6): one view's call in stream UV. The rules pair faces and tracks over every track (§7.1 I2);
   * a pair feeds its track when the view holds the track's predicted box or the face's own box (C5), else it is
   * accounted for; a track it leaves unmatched is missed only when it can miss it (every other track is no event: not
   * missed, not aged); a face whose owner turns on a track the view cannot see is left to that track's own view (I3,
   * `DetectScope.defers`); and a face starts a track only where the scope says (a view that holds it once clipped to the
   * crop: a tile, inside it whole but for the crop's own edge; the whole view, in the crop: C6, round-2 review D9).
   * Without it the call is the solo path's whole frame ('video'), which sees every track. A no-answer with a scope is
   * that view's (round-4 review F3): it is no event for a track the view cannot miss.
   */
  detect(lms: readonly Landmarks478[] | null, tsMs: number, w: number, h: number, scope?: DetectScope): void {
    if (lms === null) this.unanswered(tsMs, scope);
    else this.decide([{ lms, src: scope }], tsMs, w, h, scope);
  }

  /**
   * K13 on the group path (§6.6 Capture): the answers of the shutter's views on the captured frame (`answers`: the views
   * that answered) as one call, in their union (`scope`, `shutterScope`). The decision is `detect`'s, over every face
   * the answers hold: a face any view found is found (it feeds or starts as its own view's scope says); a track is
   * missed only when a view that answered could miss it and no answer found its face; a view with no answer is not in
   * `answers` and is no event (it neither misses, ages, pauses nor marks unseen); everyone is re-identified once, over
   * the union, the away persons included. A face two views found is one face, its best find, and two people two faces
   * however their boxes overlap (`onePerFace`: one head by its landmarks, round-6 review H2, Codex #2). Round-5
   * review G2, Codex P2: one call per view, a later tile that missed a face an earlier tile had fed on the captured frame
   * marked it missing (an edited person handed over held, a never-edited one dropped). No answer at all: nothing happens.
   */
  detectViews(answers: readonly ViewAnswer[], tsMs: number, w: number, h: number, scope: DetectScope): void {
    if (answers.length > 0) this.decide(answers.map((a) => ({ lms: a.lms, src: a.scope })), tsMs, w, h, scope);
  }

  /**
   * A no-answer (A5): a track found before it is unseen now (C9); one a call had missed stays held, known missing
   * (round-3 review E5: marked unseen too, a person who had left went to 編輯 as found, a never-edited one as a
   * blocker); and the hold of each is paused until the next answer, whichever call's. With a scope it is that view's
   * (§6.6): it says nothing of a track its answer could not have missed and pauses no hold but theirs (round-4 review
   * F3; round-5 review G4: every track's hold was paused, so one view that kept failing stretched the holds and the
   * velocities of faces it cannot see)
   */
  private unanswered(tsMs: number, scope?: DetectScope): void {
    for (const t of this.list) {
      if (scope && !scope.missable(this.predict(t, tsMs))) continue;
      t.pausedSince ??= tsMs;
      if (!t.present) continue;
      t.present = false;
      t.stale = true;
    }
  }

  /** an answered call (detect, detectViews): `sources`, each answer's faces with the scope of the view that found them */
  private decide(sources: readonly { lms: readonly Landmarks478[]; src?: DetectScope }[], tsMs: number, w: number, h: number, scope?: DetectScope): void {
    // "lastSeen does not age" while the tracker cannot answer for a track (a context loss, the rebuild throttle, its
    // view's no-answer): the hold resumes where it stopped, so a face missed on the first frames back is still held and
    // a pinned selection survives
    for (const t of this.list) {
      if (t.pausedSince === null) continue;
      t.lastSeen += Math.max(0, tsMs - t.pausedSince);
      t.pausedSince = null;
    }
    const aspect = w / h;
    this.aspect = aspect;
    const all: Det[] = [];
    for (const { lms, src } of sources)
      for (const lm of lms) {
        const face = adapt(lm, w, h);
        const box = ovalBox(face);
        if (finiteBox(box)) all.push({ lm, face, box, src });
      }
    /** the face's own view holds it whole once clipped to the crop (the solo path's whole frame: always) */
    const whole = (d: Det) => !d.src || d.src.matchable(d.box);
    const pred = new Map<Track, Rect>(this.list.map((t) => [t, this.predict(t, tsMs)]));
    /** the track a find matches best by §7.3 item 2's IoU rule (IoU ≥ 0.3 against its predicted box, the size gate); null: none */
    const bestTrack = (d: Det): Track | null => {
      let best: Track | null = null;
      let bestIoU = 0;
      for (const [t, p] of pred) {
        const iou = boxIoU(p, d.box);
        if (iou >= 0.3 && iou > bestIoU && sizeOk(p, d.box)) [best, bestIoU] = [t, iou];
      }
      return best;
    };
    // the shutter's views (detectViews): one face, one find, so no second find of a face another view found (a copy an
    // overlapping tile's edge cuts, or that sees part of it) takes a track or a person beside it (I1); two people are
    // two faces, however their boxes overlap (round-6 review H2, Codex #2). One view's finds are kept as they came
    const dets = sources.length < 2 ? all : onePerFace(all, whole, bestTrack, w, h);
    // two ROIs converged on one face (IoU > 0.6, T3's rule): keep the one matching a track, else the larger
    const onTrack = (b: Rect) => this.list.some((t) => boxIoU(t.box, b) >= 0.3);
    dets.sort((a, b) => area(b.box) - area(a.box));
    const unique: Det[] = [];
    for (const d of dets) {
      const j = unique.findIndex((u) => boxIoU(u.box, d.box) > 0.6);
      if (j < 0) unique.push(d);
      else if (!onTrack(unique[j].box) && onTrack(d.box)) unique[j] = d;
    }
    // §7.1 (round-2 review D1, D2, D5): what the call knows of each track. It sees a track whose predicted box its view
    // can match or miss (the solo path's whole frame sees every track); a held track is known missing whichever view
    // answers; any other, found elsewhere or unseen since a no-answer (stale, C9), is unknown to it: the call cannot
    // tell whether that person is still where they were found (`pred`: each track's predicted box, above)
    const held = (t: Track) => !t.present && !t.stale;
    const misses = (t: Track) => !scope || scope.missable(pred.get(t)!);
    const unknown = (t: Track) => !!scope && !held(t) && !scope.matchable(pred.get(t)!) && !scope.missable(pred.get(t)!);
    /** the call may feed the pair: the face's view holds the track's predicted box or the face whole, each clipped to the crop */
    const feeds = (t: Track, d: Det) => !d.src || d.src.matchable(pred.get(t)!) || whole(d);
    const free = new Set(this.list);
    const used = new Set<Det>();
    const pairs: [Track, Det][] = [];
    // §7.3 items 2–3 over every track, whichever view answers (I2): the rules match against the predicted boxes and
    // refuse a pair across the size gate; the call's scope says only what it does with a pair (fed, below; else, a face
    // its view's edge cuts, accounted for and no event). Greedy by IoU ≥ 0.3
    const cand = [...free]
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
    // MAX_LIVE_FACES = 1 (v0.3's camera, one person): one track, one face, wherever the face went (S §1.2 item 1)
    if (this.max === 1 && this.list.length === 1 && unique.length === 1 && pairs.length === 0 && free.has(this.list[0])) {
      const t = this.list[0];
      free.delete(t);
      used.add(unique[0]);
      pairs.push([t, unique[0]]);
    }
    // §7.3 item 6 (I3, I4; round-2 review D1, round-3 review E3): a track known missing longer than the hold (held, or
    // missed by this call) leaves the call's tracks before anyone is re-identified, whichever view answers: it is not
    // continued, and its person is weighed as the away person their release makes them (`pending`), so they are a
    // candidate on the very call their face comes back. It is released only once the call has taken everyone it decided
    // (below, I4): a release into a full away pool evicts the pool's oldest entry, who may be someone this call decided
    // (E3: released first, an edited track's hold running out as the pool's oldest person came back evicted her). A
    // track found elsewhere or stale is not missing (C9)
    const expired = [...free].filter((t) => (held(t) || misses(t)) && tsMs - t.lastSeen > this.hold);
    for (const t of expired) free.delete(t);
    const pending: PendingRelease[] = expired.map((t) => ({ id: t.person, box: t.box, now: t.lastSeen, path: t.path }));
    // §7.3 item 4, §7.4: a face's candidate owners, the same set whichever view answers (I3): every track still free (the
    // ones known missing are within the hold now) and every away person in grace, through the gates, less only what a
    // face this call decided took (I1: a track continued, a person claimed). A face the call leaves takes nobody: its
    // candidates stay every other face's (round-3 review E2: leaving B's face took P, coming back beside B, out of her
    // own face's set, which then got a neighbour's settings or 原圖)
    const claimed = new Set<LivePersonId>();
    const owners = (d: Det): Cand[] => {
      const out: Cand[] = [];
      for (const t of free) {
        const r = reidDistance(pred.get(t)!, d.box, aspect);
        if (r !== null) out.push({ item: t, d: r });
      }
      for (const a of this.persons.awayCandidates(d.box, aspect, tsMs, pending)) if (!claimed.has(a.id)) out.push({ item: a.id, d: a.d });
      return out;
    };
    const tracksOf = (cands: readonly { item: Track | LivePersonId }[]): Track[] =>
      cands.flatMap((c) => (typeof c.item === 'number' ? [] : [c.item]));
    // I3: a face whose owner turns on tracks the call cannot see is left to the own view of one of them that sees every
    // candidate track not held (DetectScope.defers): the face is no event for the call, and its candidate tracks are
    // neither missed nor evicted by it (`reserved`). One entry per such event, until its answer (round-3 review E1: an
    // entry outlived its answer, so the same face moving again within REID_GRACE_MS was placed here and got a second
    // person, or a neighbour's): a call that decides a face at its place ends it; once that view has answered for the
    // tracks it waits on, the next call that meets the face places it here (no face waits on a view for ever), and the
    // next call of a view that left it ends it whether or not it meets the face (one met there later is a new event, left
    // again). A layout change and the solo path end every entry
    if (scope) {
      const rect = this.leftViews.get(scope.name);
      if (rect && !sameRect(rect, scope.view)) {
        this.left = [];
        this.leftViews.clear();
      }
      this.leftViews.set(scope.name, scope.view);
    } else {
      this.left = [];
      this.leftViews.clear();
    }
    this.left = this.left.filter((e) => tsMs - e.at <= REID_GRACE_MS);
    const answered = (e: LeftFace) => [...e.waits].every(([t, since]) => t.seen > since || !this.list.includes(t));
    const lastCall = new Set(this.left.filter((e) => e.views.has(scope?.name ?? '') && answered(e)));
    const spent = new Set<LeftFace>();
    const releft = new Set<LeftFace>();
    const reserved = new Set<Track>();
    /** the faces this call left: their candidates, and the tracks they wait on */
    const leftHere: { items: ReadonlySet<Track | LivePersonId>; waits: readonly Track[] }[] = [];
    const leave = (d: Det, waits: readonly Track[], cands: readonly { item: Track | LivePersonId }[]): boolean => {
      const preds = [...new Set([...tracksOf(cands), ...waits])].filter((t) => !held(t)).map((t) => pred.get(t)!);
      if (!scope?.defers?.(preds, d.box)) return false;
      const e = this.left.find((x) => boxIoU(x.box, d.box) >= 0.3);
      if (e && waits.every((t) => e.waits.has(t)) && answered(e)) {
        spent.add(e);
        return false;
      }
      if (e) {
        e.box = d.box;
        e.views.add(scope.name);
        for (const t of waits) if (!e.waits.has(t)) e.waits.set(t, tsMs);
        releft.add(e);
      } else this.left.push({ box: d.box, at: tsMs, views: new Set([scope.name]), waits: new Map(waits.map((t) => [t, tsMs])) });
      used.add(d);
      for (const t of tracksOf(cands)) reserved.add(t);
      leftHere.push({ items: new Set(cands.map((c) => c.item)), waits });
      return true;
    };
    // I1, I2: a pair whose track the call cannot see feeds it only when nobody else could own the face; else the face is
    // left (round-2 review D2: a neighbour on a tile's edge took the face of an edited person moving toward them), and
    // its track, which the face no longer took, is a candidate owner of every other face again, as every candidate of a
    // face left is (E2; round-6 review Codex #1: left out of `free`, a smaller face beside it, about as near it as a
    // neighbour, was given the neighbour's person). A pair whose face the view's edge cuts feeds nobody and accounts for
    // both, so that neighbour takes no other face
    for (const p of [...pairs]) {
      const [t, d] = p;
      if (!unknown(t) || !whole(d)) continue;
      const others = owners(d);
      if (others.length === 0 || !leave(d, [t, ...tracksOf(others).filter(unknown)], [{ item: t }, ...others])) continue;
      pairs.splice(pairs.indexOf(p), 1);
      free.add(t);
    }
    // §7.3 item 4 and §7.4, one decision over every candidate (A2): a face still unmatched, largest first, is weighed
    // against its candidate owners; the nearest is taken unless another is about as near. A track is continued; an away
    // person is claimed when the face starts its track (below); a tie, or no candidate, is a new person at 原圖. When the
    // answer would differ with the tracks the call cannot see left out, the face is left (round-2 review D5: a track found
    // elsewhere whose face moved into this view got a second person, then lost the face to it); a view that cannot leave
    // it cannot tell who the face is: a new person at 原圖, never someone the decision over every candidate did not pick
    // (A2; round-3 review E1: taking the tracks it cannot see to be where they were found, it continued a blinking
    // neighbour onto the face, a swap). When it would differ with the candidates of a face this call left out, it waits
    // for the same answer, when it can be left (E2); else it is decided over all its candidates
    /** the face may start a track: its view holds it (DetectScope.startable) */
    const starts = (d: Det) => !d.src || (d.src.startable ? d.src.startable(d.box) : insideView(d.src.view, d.box));
    const reid = new Map<Det, LivePersonId | null>();
    for (const d of unique.filter((x) => !used.has(x)).sort((a, b) => area(b.box) - area(a.box))) {
      const cands = owners(d);
      const all = nearestUnambiguous(cands);
      let hit = all;
      const blind = tracksOf(cands).filter(unknown);
      if (blind.length > 0 && nearestUnambiguous(cands.filter((c) => typeof c.item === 'number' || !blind.includes(c.item))) !== all) {
        if (leave(d, blind, cands)) continue;
        hit = null;
      }
      const rivals = leftHere.filter((l) => cands.some((c) => l.items.has(c.item)));
      const rest = cands.filter((c) => !rivals.some((l) => l.items.has(c.item)));
      if (rivals.length > 0 && nearestUnambiguous(rest) !== all && leave(d, rivals.flatMap((l) => l.waits), cands)) continue;
      if (hit === null || typeof hit === 'number') {
        // the away person decided is the face's whether or not this view can start it (I1): claimed for the call, out
        // of every later face's candidates, and taken only where the face starts. Round-4 review F1's away case: left
        // in the set when the view's edge cut the face, an edited person back past the hold gave her settings to a
        // smaller newcomer of the same call, and her own face then started as someone new at 原圖
        if (hit !== null) claimed.add(hit);
        if (!starts(d)) continue;
        reid.set(d, hit);
        continue;
      }
      // the track decided is the face's whether or not this view can feed it (I1): it leaves `free` and pairs, and a pair
      // whose face the view's edge cuts beside a track the view cannot match feeds nobody and accounts for both, as an
      // IoU pair does (below). Round-4 review F1, Codex P1: left free, a smaller face of the same call continued it (an
      // edited person's settings on a newcomer, her own face then someone new), or a newcomer evicted it at the cap
      used.add(d);
      free.delete(hit);
      pairs.push([hit, d]);
    }
    /** the view a face refreshes or starts its track from (debug `view`) */
    const viewOf = (d: Det) => d.src?.name ?? 'video';
    const paired = new Set<Track>();
    /** the faces this call fed to a track or started one with */
    const placed: Det[] = [];
    for (const [t, d] of pairs) {
      paired.add(t);
      if (!feeds(t, d)) continue;
      this.feed(t, d, tsMs, w, h, viewOf(d), pathOf(scope));
      placed.push(d);
    }
    // a track left unmatched is missed; on the group path only by a call whose view can miss it (§6.6), and never when
    // its face, or a face it may own, was accounted for or left. After a no-answer, only a call that feeds or misses a
    // track says it is held (stale, C9)
    const leaving = new Set(expired);
    for (const t of this.list) {
      if (leaving.has(t) || paired.has(t) || reserved.has(t) || !misses(t)) continue;
      t.present = false;
      t.stale = false;
    }
    // §7.3 item 5 (I4; round-2 review D4, round-3 review E3, E6): unmatched faces start tracks, largest first, each with
    // the person decided above. When full, each start evicts the held track seen longest ago (its person released), and
    // only a track the call knows to be held and leaves alone: not stale, nor one whose face, or a face it may own, the
    // call paired, accounted for or left (E6: a held track whose cut face this call accounted for was evicted for a
    // newcomer, then could not restart while in view). On the group path a face cut by a tile's edge inside the crop
    // starts nothing there: an overlapping tile holds it whole; one the crop's own edge cuts, which no other view holds
    // whole, starts in the views at that edge, the whole view and the edge tile (§6.6, C6, round-2 review D9)
    const evictable = this.list
      .filter((t) => held(t) && !leaving.has(t) && !paired.has(t) && !reserved.has(t))
      .sort((a, b) => a.lastSeen - b.lastSeen);
    const starting: Det[] = [];
    const evicted: Track[] = [];
    let size = this.list.length - expired.length;
    for (const d of unique.filter((x) => !used.has(x) && starts(x)).sort((a, b) => area(b.box) - area(a.box))) {
      if (size < this.max) size++;
      else {
        const t = evictable.shift();
        if (!t) break;
        evicted.push(t);
      }
      starting.push(d);
    }
    // I4 by construction: every decision of the call is made above. Now it takes every person it decided, and only then
    // makes its releases, the tracks past their hold and the evicted ones (round-1 review C21's bench: two groups of ten
    // taking turns lost about a third of the returns to 原圖 while a release came first; D4: a larger newcomer's
    // eviction did it to a returner decided for a smaller face; E3: the hold drop did it). A person decided whose track is
    // past its hold goes on to the new track unreleased, as releasing and taking them would
    const handed = new Set<Track>();
    const persons = starting.map((d) => {
      const id = reid.get(d) ?? null;
      const from = id === null ? undefined : expired.find((t) => t.person === id);
      if (!from) return this.persons.take(id);
      handed.add(from);
      return from.person;
    });
    for (const t of expired) {
      if (handed.has(t)) this.list = this.list.filter((x) => x !== t);
      else this.drop(t);
    }
    for (const t of evicted) this.drop(t);
    starting.forEach((d, i) => {
      const t: Track = {
        id: this.nextId++,
        person: persons[i],
        filter: this.max > 1 ? new LandmarkSmoother() : null,
        shown: d.face,
        box: d.box,
        rawBox: d.box,
        present: true,
        stale: false,
        lastSeen: tsMs,
        pausedSince: null,
        seen: tsMs,
        vx: 0,
        vy: 0,
        view: viewOf(d),
        path: pathOf(scope),
        easer: new FaceWeightEaser(),
        presence: new FaceWeightEaser(),
      };
      this.feed(t, d, tsMs, w, h, t.view, t.path);
      this.list.push(t);
      placed.push(d);
    });
    this.left = this.left.filter(
      (e) => !spent.has(e) && !(lastCall.has(e) && !releft.has(e)) && !placed.some((d) => boxIoU(e.box, d.box) >= 0.3),
    );
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
    this.persons.release(t.person, t.box, t.lastSeen, t.path);
  }

  private feed(t: Track, d: Det, tsMs: number, w: number, h: number, view: string, path: LivePath): void {
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
    t.stale = false;
    t.lastSeen = tsMs;
    t.seen = tsMs;
    t.view = view;
    t.path = path;
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
      stale: t.stale,
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
    for (const t of gone) this.persons.release(t.person, t.box, t.lastSeen, t.path);
    this.autoId = null;
    this.challenger = null;
    this.left = [];
    this.leftViews.clear();
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
