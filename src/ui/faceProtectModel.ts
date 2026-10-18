// Editor bookkeeping of the 瘦臉 background limit (reports/美體修圖 背景扭曲 抑制技術.md stage 1 ②), kept free of
// Preact so it can be unit-tested.
// When the limit applies: only once it is *requested* for this photo, i.e. the user dragged or committed a contour
// slider (瘦臉 / V臉 / 窄臉 / 下巴 / 額頭, CONTOUR_IDS) in this editor, or the photo is a reopened history entry saved
// with the request (HistoryEntry.faceProtect). Preset, default, 重置 and undo / redo values never request it (the
// 自然 preset already has 瘦臉 / V臉 on). Until then the warp is today's unlimited one whatever mask is at
// hand: neither a model download nor a 美體 detection landing changes what is shown by itself.
// The request is sticky for the photo (undo / 重置 do not withdraw it: once built the limit has no effect at neutral
// contour values), within an editor and across reopens (record()). Once requested, the person mask that bounds the
// face contour warps is:
//   1. the cached 美體 detection's PersonMask when there is one and it covers this face (no model at all; in a group
//      photo 美體 may have picked another person than the face tracker: that mask is not this face's, see
//      maskCoversFace);
//   2. else the selfie segmenter's, run once per photo when a contour warp is drawn (asked once more after a lost
//      WebGL context: a rebuilt instance survives it), or the mask a reopened entry saved from that run
//      (HistoryEntry.faceMask, no model);
//   3. else (segmenter unavailable or failing, nobody found) nothing: today's unlimited contour warps.
// What a history write records (record()): the request, plus the segmenter mask the limit was built from, so a reopen
// rebuilds the same limit before the first frame: the entry shows and exports what was saved. The request is recorded
// also while the limit cannot act yet (contour sliders neutral, no face found yet or 基本模式, a segmentation in
// flight): an edit made then must not drop it, or a later reopen would draw the same params unlimited. Only a limit
// that settled as impossible for this photo (none built, and the segmenter unavailable, failing or finding nobody)
// records "unlimited", which is what that output was. Every params write carries the record (paramsPatch). The limit
// is built per face (a re-detected face gets a new one) and kept once built. The live camera never uses it.
// With several faces (F1, S §4.7) every face has its own limit, keyed by its id: built only for a face whose person
// draws a contour warp, from its paired pose mask when that covers it, else from the selfie mask clipped to its cell;
// every other face, obstacle and body person counts as infinitely far. At most one limit is built per call (one per
// animation frame, deps.schedule); the request stays photo-level.
import { legacyProjection } from '../edit/legacy';
import { sanitizeParams } from '../engine/params';
import { reshapeUniforms } from '../engine/passes/reshape';
import { stableKey } from '../store/undo';
import type { ProtectRegions } from '../tracking/faceProtect';
import type { BeautyParams, EditState, Face, FaceProtect, ParamId, PersonId, PersonMask } from '../types';

/** the contour sliders (the only warps the limit acts on) and their reshape uniforms */
const CONTOUR = {
  'shape.faceSlim': 'faceSlim',
  'shape.faceV': 'faceV',
  'shape.faceNarrow': 'faceNarrow',
  'shape.chin': 'chin',
  'shape.forehead': 'forehead',
} as const satisfies Partial<Record<ParamId, keyof ReturnType<typeof reshapeUniforms>>>;

/** 瘦臉 / V臉 / 窄臉 / 下巴 / 額頭: a user edit of one of these may start the segmenter */
export const CONTOUR_IDS: readonly ParamId[] = Object.keys(CONTOUR) as (keyof typeof CONTOUR)[];

/** a slider binding (SliderBinding.key) that moves a contour slider from `before` to `after` */
export function isContourEdit(key: string, before: number, after: number): boolean {
  return (CONTOUR_IDS as readonly string[]).includes(key) && before !== after;
}

/** a contour warp is drawn with these person values */
export function contourActiveValues(values: Readonly<Record<string, number>>): boolean {
  const u = reshapeUniforms(values as Record<ParamId, number>, 1);
  return Object.values(CONTOUR).some((k) => u[k] !== 0);
}

/** samples per axis over the face oval's bounding box (maskCoversFace) */
const COVER_GRID = 16;

/**
 * Whether `mask` is this face's person: at least `minFrac` of the face oval's interior has person confidence ≥ 0.5.
 * (The 美體 pose picks the largest / most central person, the face tracker its own first face: in a group photo they
 * can differ, and another person's mask would cut this face's limit down to the bare oval.)
 */
export function maskCoversFace(face: Face, mask: PersonMask, minFrac = 0.5): boolean {
  const o = face.oval;
  const n = o.length / 2;
  if (n < 3 || mask.width < 1 || mask.height < 1) return false;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    x0 = Math.min(x0, o[i * 2]);
    x1 = Math.max(x1, o[i * 2]);
    y0 = Math.min(y0, o[i * 2 + 1]);
    y1 = Math.max(y1, o[i * 2 + 1]);
  }
  let inside = 0;
  let covered = 0;
  for (let gy = 0; gy < COVER_GRID; gy++) {
    const v = y0 + ((gy + 0.5) / COVER_GRID) * (y1 - y0);
    for (let gx = 0; gx < COVER_GRID; gx++) {
      const u = x0 + ((gx + 0.5) / COVER_GRID) * (x1 - x0);
      let c = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = o[i * 2];
        const yi = o[i * 2 + 1];
        const xj = o[j * 2];
        const yj = o[j * 2 + 1];
        if (yi > v !== yj > v && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) c = !c;
      }
      if (!c) continue;
      inside++;
      if (u < 0 || v < 0 || u >= 1 || v >= 1) continue; // off the photo: not this mask's person
      const mx = Math.min(mask.width - 1, Math.floor(u * mask.width));
      const my = Math.min(mask.height - 1, Math.floor(v * mask.height));
      if (mask.data[my * mask.width + mx] >= 128) covered++;
    }
  }
  return inside > 0 && covered >= minFrac * inside;
}

/**
 * How long an autosave / share-cache encode may wait for a segmentation in flight (from its start), so the limit it
 * brings does not re-arm a second full-resolution export right after the first. Past it the encode runs anyway (a
 * hung segmenter never blocks autosave) and a late limit re-arms once.
 */
export const PROTECT_WAIT_MS = 2500;

export interface FaceProtectDeps {
  /** buildFaceProtect at the photo's size: the mask alone (one face, v0.3's call) or the regions (S §4.7) */
  build(face: Face, mask: PersonMask | ProtectRegions): FaceProtect;
  /** the 美體 mask is this face's person (maskCoversFace) */
  covers(face: Face, mask: PersonMask): boolean;
  /** the shared segmenter (services.ensureFaceSegmenter): null = unavailable */
  segmenter(): Promise<{ segment(): PersonMask | null } | null>;
  /** let a frame paint before the synchronous segmentation */
  pause(): Promise<void>;
  /** a monotonic clock in ms (performance.now) */
  now(): number;
  /** the editor closed: drop late results */
  cancelled(): boolean;
  report(e: unknown, where: string): void;
  /** run fn on the next animation frame (tests: at once) */
  schedule(fn: () => void): void;
}

/** one face's limit request (FaceProtectSource.updateAll) */
export interface ProtectRequest {
  id: string;
  face: Face;
  /** this face's person draws a contour warp */
  contour: boolean;
  /** the paired body's pose mask (null: none) */
  pose: PersonMask | null;
  /** everything but own / clipToCell */
  others: Omit<ProtectRegions, 'own' | 'clipToCell'>;
}

/** a face's built limit and what it was built from */
interface Entry {
  face: Face;
  mask: PersonMask;
  othersKey: string;
  protect: FaceProtect;
}

/** identity of an oval / mask object in the others key (a new detection gives new objects) */
const ids = new WeakMap<object, number>();
let nextId = 0;
const idOf = (o: object) => {
  let v = ids.get(o);
  if (v === undefined) ids.set(o, (v = ++nextId));
  return v;
};
const othersKeyOf = (o: ProtectRequest['others']) => JSON.stringify([o.otherCentres, o.otherOvals.map(idOf), o.otherMasks.map(idOf), o.window]);

type Seg = { phase: 'idle' } | { phase: 'working' } | { phase: 'done'; mask: PersonMask | null } | { phase: 'failed' };

/** what a history write records about the limit (HistoryEntry.faceProtect / faceMask) */
export interface FaceProtectRecord {
  /** the limit is requested for this photo (and not settled as impossible): a reopen requests it again */
  faceProtect: boolean;
  /** the segmenter mask the limit was built from (absent: none, or the 美體 mask, cached with its detection) */
  faceMask?: PersonMask;
}

/**
 * The params write of an existing history entry (an updateEntry patch), and of addEntry. Every params write goes
 * through it, so the v2 fields (RM §5.1: schema, edit, its legacy projection for a rollback to 0.3, paramsKey) and
 * the limit record always ride along together: params and flag never disagree (a write without it would leave a stale
 * flag, or none, beside the new params). The segmenter mask is the same for the whole photo: written only while none
 * is stored yet (`maskStored`); a stored one is kept (updateEntry never removes it).
 */
export function paramsPatch(
  edit: EditState,
  primary: PersonId,
  limit: FaceProtectRecord,
  maskStored: boolean,
  thumb?: Blob,
): { schema: 2; edit: EditState; params: BeautyParams; paramsKey: string; thumb?: Blob; faceProtect: boolean; faceMask?: PersonMask } {
  const params = sanitizeParams(legacyProjection(edit, primary));
  return {
    schema: 2,
    edit,
    params,
    paramsKey: stableKey(params),
    ...(thumb ? { thumb } : {}),
    faceProtect: limit.faceProtect,
    ...(limit.faceMask && !maskStored ? { faceMask: limit.faceMask } : {}),
  };
}

export class FaceProtectSource {
  /** per face id: its limit, kept once built */
  private entries = new Map<string, Entry>();
  private seg: Seg = { phase: 'idle' };
  private segStarted = 0;
  /** per face id, covers() of the last (face, 美體 mask) pair: a few hundred samples, but update runs on every params change */
  private bodyOk = new Map<string, { face: Face; mask: PersonMask; ok: boolean }>();
  /** a deps.schedule callback is pending (the builds left over by the last updateAll) */
  private scheduled = false;
  /** the limit is requested for this photo (sticky: see the header) */
  private asked: boolean;

  /**
   * `changed` runs when an asynchronous segmentation settled: call update() again. `savedMask`: the segmenter mask a
   * reopened entry saved (HistoryEntry.faceMask): this photo's segmentation is done already. `requested`: the reopened
   * entry was saved with the request (HistoryEntry.faceProtect).
   */
  constructor(
    private readonly deps: FaceProtectDeps,
    private readonly changed: () => void,
    savedMask: PersonMask | null = null,
    requested = false,
  ) {
    if (savedMask) this.seg = { phase: 'done', mask: savedMask };
    this.asked = requested;
  }

  /** a user contour edit: the limit is requested for this photo from now on (sticky) */
  request(): void {
    this.asked = true;
  }

  /** the limit is requested for this photo */
  get requested(): boolean {
    return this.asked;
  }

  /** where the segmenter stands (tests, debugging) */
  get segPhase(): Seg['phase'] {
    return this.seg.phase;
  }

  /**
   * How much longer an export of what is on screen should wait for a limit still being computed: 0 when no
   * segmentation is in flight or it has had PROTECT_WAIT_MS already. (Saving on a tap never waits: it exports
   * what the screen shows.)
   */
  outputHoldMs(): number {
    if (this.seg.phase !== 'working') return 0;
    return Math.max(0, this.segStarted + PROTECT_WAIT_MS - this.deps.now());
  }

  /**
   * Bring every face's limit up to date (F1) and return the limits to draw, by face id (absent = unlimited).
   * `requested`: the limit was asked for (see the header: a user contour edit in this editor, or a reopened entry
   * saved with it); sticky: once true it stays requested for the photo (request()). A limit is built only for a face
   * whose person draws a contour warp and kept once built; the own region is the paired pose mask when it covers the
   * face, else the selfie mask (clipped to the face's cell when other faces exist). Starts the segmenter when it is the
   * only source left, a contour warp is drawn and the limit was requested. At most ONE build per call: the rest follow
   * on deps.schedule (one per animation frame, `changed` asks for the next call), and a face whose limit is pending
   * keeps its previous one meanwhile (or none).
   */
  updateAll(requests: readonly ProtectRequest[], requested: boolean): ReadonlyMap<string, FaceProtect> {
    if (requested) this.asked = true;
    const out = new Map<string, FaceProtect>();
    // not asked for: today's unlimited warp, also when a 美體 mask is at hand (its landing changes nothing shown)
    if (!this.asked && !this.entries.size) return out;
    let built = false;
    let pending = false;
    for (const q of requests) {
      const have = this.entries.get(q.id);
      // another person's 美體 mask is no mask for this face: fall through to the segmenter (or stay unlimited)
      const pose = q.pose && this.ownBodyMask(q.id, q.face, q.pose) ? q.pose : null;
      const mask = pose ?? (this.seg.phase === 'done' ? this.seg.mask : null);
      if (!mask) {
        // no mask (yet): the segmenter, once per photo
        if (q.contour && this.seg.phase === 'idle') this.startSegmenter();
        if (have && have.face === q.face) out.set(q.id, have.protect);
        continue;
      }
      const key = othersKeyOf(q.others);
      if (have && have.face === q.face && have.mask === mask && have.othersKey === key) {
        out.set(q.id, have.protect);
        continue;
      }
      // a limit exists only once a contour warp asked for one (building costs a few ms, nothing else)
      if (!q.contour && !have) continue;
      if (built) {
        pending = true;
        if (have && have.face === q.face) out.set(q.id, have.protect);
        continue;
      }
      built = true;
      try {
        // one face alone (no others, no window): v0.3's call exactly; else the regions form
        const o = q.others;
        const alone = !o.otherCentres.length && !o.otherOvals.length && !o.otherMasks.length && !o.window;
        const protect = alone ? this.deps.build(q.face, mask) : this.deps.build(q.face, { ...o, own: mask, clipToCell: !pose && o.otherCentres.length > 0 });
        this.entries.set(q.id, { face: q.face, mask, othersKey: key, protect });
        out.set(q.id, protect);
      } catch (e) {
        this.deps.report(e, 'buildFaceProtect');
        this.entries.delete(q.id);
      }
    }
    if (pending && !this.scheduled) {
      this.scheduled = true;
      this.deps.schedule(() => {
        this.scheduled = false;
        if (!this.deps.cancelled()) this.changed();
      });
    }
    return out;
  }

  /**
   * What a history write of an output drawn with `drawn` (the session's limits at export time, by face id) records,
   * photo-level: the request, and the segmenter mask a drawn limit was built from, so a reopen rebuilds it with no
   * model. Requested but not drawn (contour sliders neutral, no face found yet, a segmentation in flight)
   * still records the request: the limit cannot act yet, and an edit made meanwhile must not drop it for later
   * sessions. Only a limit settled as impossible for this photo (none built, and the segmenter unavailable, failing or
   * finding nobody) records "unlimited".
   */
  record(drawn: ReadonlyMap<string, FaceProtect> | null): FaceProtectRecord {
    const list: FaceProtect[] = drawn ? [...drawn.values()] : [];
    const segMask = this.seg.phase === 'done' ? this.seg.mask : null;
    if (list.length) {
      const fromSeg = !!segMask && [...this.entries.values()].some((e) => e.mask === segMask && list.includes(e.protect));
      return fromSeg ? { faceProtect: true, faceMask: segMask } : { faceProtect: true };
    }
    if (!this.asked) return { faceProtect: false };
    const impossible = !this.entries.size && (this.seg.phase === 'failed' || (this.seg.phase === 'done' && !this.seg.mask));
    return { faceProtect: !impossible };
  }

  private ownBodyMask(id: string, face: Face, mask: PersonMask): boolean {
    const c = this.bodyOk.get(id);
    if (c?.face === face && c.mask === mask) return c.ok;
    let ok = false;
    try {
      ok = this.deps.covers(face, mask);
    } catch (e) {
      this.deps.report(e, 'maskCoversFace');
    }
    this.bodyOk.set(id, { face, mask, ok });
    return ok;
  }

  private startSegmenter(): void {
    this.seg = { phase: 'working' };
    this.segStarted = this.deps.now();
    const settle = (s: Seg) => {
      this.seg = s;
      if (!this.deps.cancelled()) this.changed();
    };
    /** this start has retried after a lost context already: a second loss settles 'failed' (never a loop) */
    let retried = false;
    const run = async (): Promise<void> => {
      try {
        const sg = await this.deps.segmenter();
        if (!sg) return settle({ phase: 'failed' });
        await this.deps.pause();
        if (this.deps.cancelled()) return settle({ phase: 'failed' });
        settle({ phase: 'done', mask: sg.segment() });
      } catch (e: unknown) {
        // a lost WebGL context (iOS backgrounding) is an expected degradation, not an error to surface. Nothing is
        // wrong with the module: ask once more for this photo (services.ensureFaceSegmenter rebuilds a lost instance
        // within its per-session budget, or answers null once that is used up)
        if (isContextLost(e)) {
          if (!retried && !this.deps.cancelled()) {
            retried = true;
            console.warn('[meiyan] 瘦臉 background limit: segmenter lost its WebGL context, retrying once', e);
            return run();
          }
          console.warn('[meiyan] 瘦臉 background limit: segmenter lost its WebGL context', e);
        } else this.deps.report(e, 'face segmenter');
        settle({ phase: 'failed' });
      }
    };
    void run();
  }
}

/**
 * src/tracking/segmenter.ts SegmenterContextLostError, matched by name: importing the class would pull
 * @mediapipe/tasks-vision into the editor chunk (deps.ts loads the segmenter module lazily)
 */
function isContextLost(e: unknown): boolean {
  return e instanceof Error && e.name === 'SegmenterContextLostError';
}
