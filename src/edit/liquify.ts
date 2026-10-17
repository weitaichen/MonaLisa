// 推臉筆 (push-brush spec §3–§5): strokes → an O-space backward displacement field, on the CPU.
import { fieldMinJacobianRect } from '../body/field';
import { fieldSize } from '../body/geom';
import {
  GUARD_STEPS,
  LIQUIFY_LONG_EDGE,
  LIQUIFY_MIN_DET,
  LIQUIFY_SLICE_MS,
  LIQUIFY_SYNC_WORK,
  LIQUIFY_WORK_CAP,
  MAX_STROKE_POINTS,
  MAX_STROKES,
  PATCH_BUDGET,
  PATCH_TILE,
  PINCH_GRACE_MS,
  PUSH_GAIN,
  R_MAX,
  RESTORE_GAIN,
  SNAP,
  STAMP_SPACING,
} from '../config/limits';
import type { BrushKind, LiquifyField, LiquifyFrame, Rect, Stroke } from '../types';

// ───────────────────────── frame, grid, units ─────────────────────────

/** The liquify grid of a frame (§3.1): texel (i, j) is centred at ((i + 0.5)/w, (j + 0.5)/h) in O UV. */
export interface LiquifyGrid {
  w: number;
  h: number;
  /** S units per O-UV unit on x and y: S = (x·W/S₀, y·H/S₀) */
  ax: number;
  ay: number;
  /** texels per S unit, min(w, h) */
  F: number;
}

export function liquifyGrid(frame: LiquifyFrame): LiquifyGrid {
  const W = Math.max(1, frame.width);
  const H = Math.max(1, frame.height);
  const [w, h] = fieldSize(W / H, LIQUIFY_LONG_EDGE);
  const s0 = Math.min(W, H);
  return { w, h, ax: W / s0, ay: H / s0, F: Math.min(w, h) };
}

/** smallest brush radius in S units: 4 texels (§3.3) */
export function rMin(frame: LiquifyFrame): number {
  return 4 / liquifyGrid(frame).F;
}

export function clampRadius(r: number, frame: LiquifyFrame): number {
  return Math.min(R_MAX, Math.max(rMin(frame), r));
}

/**
 * The brush radius (S units) from two O points BRUSH_PX[size] apart on screen (§3.3: evaluated at stroke start with the
 * current zoom and geometry), clamped to [rMin, R_MAX]. ringScale = radius / unclamped: the ring grows on screen by it
 * when a deep zoom clamps the radius to rMin (§2.3).
 */
export function brushRadius(o0: { x: number; y: number }, o1: { x: number; y: number }, frame: LiquifyFrame): { radius: number; ringScale: number } {
  const g = liquifyGrid(frame);
  const raw = Math.hypot((o1.x - o0.x) * g.ax, (o1.y - o0.y) * g.ay);
  const radius = clampRadius(raw, frame);
  return { radius, ringScale: raw > 0 ? radius / raw : 1 };
}

const clampO = (v: number) => Math.min(2, Math.max(-1, v));

// ───────────────────────── stamp box and base work ─────────────────────────

interface Box {
  i0: number;
  i1: number;
  j0: number;
  j1: number;
}

/** texels whose centre may lie within R of (cx, cy) (S units), clipped to the grid; null = none */
function stampBox(g: LiquifyGrid, cx: number, cy: number, R: number): Box | null {
  const i0 = Math.max(0, Math.ceil(((cx - R) / g.ax) * g.w - 0.5));
  const i1 = Math.min(g.w - 1, Math.floor(((cx + R) / g.ax) * g.w - 0.5));
  const j0 = Math.max(0, Math.ceil(((cy - R) / g.ay) * g.h - 0.5));
  const j1 = Math.min(g.h - 1, Math.floor(((cy + R) / g.ay) * g.h - 0.5));
  return i0 > i1 || j0 > j1 ? null : { i0, i1, j0, j1 };
}

const boxArea = (b: Box | null) => (b ? (b.i1 - b.i0 + 1) * (b.j1 - b.j0 + 1) : 0);

/** centre of stamp i (1 ≤ i < n) of a record, in S units: push at p[i−1], restore at p[i] */
function stampCentre(rec: Stroke, i: number, g: LiquifyGrid): [number, number] {
  const k = rec.kind === 'push' ? i - 1 : i;
  return [rec.points[k * 2] * g.ax, rec.points[k * 2 + 1] * g.ay];
}

/** base work of a record (§3.6): the texel count of every stamp's clipped box */
export function strokeWork(rec: Stroke, frame: LiquifyFrame): number {
  const g = liquifyGrid(frame);
  const n = rec.points.length / 2;
  let sum = 0;
  for (let i = 1; i < n; i++) {
    const [cx, cy] = stampCentre(rec, i, g);
    sum += boxArea(stampBox(g, cx, cy, rec.radius));
  }
  return sum;
}

// ───────────────────────── stroke building (§3.4) ─────────────────────────

export class StrokeBuilder {
  private readonly g: LiquifyGrid;
  private readonly step: number;
  /** emitted points, O UV, Float32-rounded */
  private readonly pts: number[] = [];
  /** last raw point and last emitted point, S units */
  private rx: number;
  private ry: number;
  private lx: number;
  private ly: number;
  private stopped = false;
  readonly kind: BrushKind;
  readonly radius: number;

  constructor(kind: BrushKind, radius: number, frame: LiquifyFrame, start: { x: number; y: number }) {
    this.kind = kind;
    this.radius = radius;
    this.g = liquifyGrid(frame);
    this.step = radius * STAMP_SPACING;
    const x = Math.fround(clampO(start.x));
    const y = Math.fround(clampO(start.y));
    this.pts.push(x, y);
    this.rx = this.lx = x * this.g.ax;
    this.ry = this.ly = y * this.g.ay;
  }

  /** points emitted so far */
  get count(): number {
    return this.pts.length / 2;
  }

  /** point i, O UV */
  point(i: number): { x: number; y: number } {
    return { x: this.pts[i * 2], y: this.pts[i * 2 + 1] };
  }

  private emit(sx: number, sy: number): void {
    const x = Math.fround(sx / this.g.ax);
    const y = Math.fround(sy / this.g.ay);
    this.pts.push(x, y);
    this.lx = x * this.g.ax;
    this.ly = y * this.g.ay;
  }

  /** feed a raw O-frame pointer point (clamped to [−1, 2]²); returns how many resampled points it emitted */
  add(o: { x: number; y: number }): number {
    if (this.stopped) return 0;
    const bx = clampO(o.x) * this.g.ax;
    const by = clampO(o.y) * this.g.ay;
    const ax = this.rx;
    const ay = this.ry;
    const dx = bx - ax;
    const dy = by - ay;
    const dd = dx * dx + dy * dy;
    let out = 0;
    if (dd > 0) {
      const h2 = this.step * this.step;
      let t0 = 0;
      for (;;) {
        // first t ≥ t0 where the raw segment leaves the circle of radius `step` about the last emitted point
        const fx = ax + t0 * dx - this.lx;
        const fy = ay + t0 * dy - this.ly;
        const fd = fx * dx + fy * dy;
        const disc = fd * fd - dd * (fx * fx + fy * fy - h2);
        if (disc < 0) break;
        const t = t0 + (-fd + Math.sqrt(disc)) / dd;
        if (!(t <= 1)) break;
        this.emit(ax + t * dx, ay + t * dy);
        out++;
        t0 = t;
      }
    }
    this.rx = bx;
    this.ry = by;
    return out;
  }

  /** stop accepting input (a cap was hit); `keep` = how many points to keep */
  stop(keep: number): void {
    this.stopped = true;
    this.pts.length = Math.min(this.pts.length, keep * 2);
  }

  /** finger up: emit the final point when the remainder is ≥ radius/8; returns 1 when it did */
  finishPoint(): number {
    if (this.stopped) return 0;
    this.stopped = true;
    const dx = this.rx - this.lx;
    const dy = this.ry - this.ly;
    if (dx * dx + dy * dy < (this.step / 2) * (this.step / 2)) return 0;
    this.emit(this.rx, this.ry);
    return 1;
  }

  /** the records (≤ MAX_STROKE_POINTS points each; a continuation repeats its predecessor's last point) */
  records(newId: () => string, strength: number): Stroke[] {
    const n = this.count;
    const out: Stroke[] = [];
    for (let s = 0; s < n - 1; s += MAX_STROKE_POINTS - 1) {
      const e = Math.min(n, s + MAX_STROKE_POINTS);
      out.push({ id: newId(), kind: this.kind, radius: this.radius, strength, points: Float32Array.from(this.pts.slice(s * 2, e * 2)) });
    }
    return out;
  }

  /** finish() of the spec: final point + records */
  finish(newId: () => string): Stroke[] {
    this.finishPoint();
    return this.records(newId, this.kind === 'push' ? PUSH_GAIN : RESTORE_GAIN);
  }
}

// ───────────────────────── stamp operators (§4.2, §4.3) ─────────────────────────

/** bilinear, clamp-to-edge read of `d` (RG) at O UV (u, v): fieldAt's arithmetic (src/body/cpuWarp.ts) */
function readField(d: Float32Array, w: number, h: number, u: number, v: number, out: Float64Array): void {
  const x = Math.max(0, Math.min(w - 1, u * w - 0.5));
  const y = Math.max(0, Math.min(h - 1, v * h - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  for (let c = 0; c < 2; c++) {
    const a = d[(y0 * w + x0) * 2 + c] * (1 - fx) + d[(y0 * w + x1) * 2 + c] * fx;
    const b = d[(y1 * w + x0) * 2 + c] * (1 - fx) + d[(y1 * w + x1) * 2 + c] * fx;
    out[c] = a * (1 - fy) + b * fy;
  }
}

interface StampResult {
  /** base work × (1 + bisection steps) */
  work: number;
  /** λ the stamp was applied with (0 = skipped by the guard) */
  lambda: number;
  /** any texel value changed */
  changed: boolean;
}

/** Shared scratch for the stamp operators (one stamp at a time). */
class Scratch {
  out = new Float32Array(0);
  backup = new Float32Array(0);
  tmp = new Float64Array(2);
  ensure(n: number): void {
    if (this.out.length < n) {
      this.out = new Float32Array(n);
      this.backup = new Float32Array(n);
    }
  }
  release(): void {
    this.out = new Float32Array(0);
    this.backup = new Float32Array(0);
  }
}

/** Copy the box of `d` to/from `buf` (row-major box order). */
function copyBox(d: Float32Array, w: number, b: Box, buf: Float32Array, toBuf: boolean): void {
  const bw = b.i1 - b.i0 + 1;
  for (let j = b.j0; j <= b.j1; j++) {
    const row = (j * w + b.i0) * 2;
    const at = (j - b.j0) * bw * 2;
    if (toBuf) buf.set(d.subarray(row, row + bw * 2), at);
    else d.set(buf.subarray(at, at + bw * 2), row);
  }
}

/**
 * Apply one stamp with gain g·λ into `f` (§4.2): push composes L' = toUV(B) + L(X + B) with B = −g·w·Δ, restore scales
 * L' = (1 − k·w)·L with the SNAP. Reads only pre-stamp values (computed into the scratch, then copied back).
 */
function applyStamp(
  f: LiquifyField,
  g: LiquifyGrid,
  b: Box,
  kind: BrushKind,
  cx: number,
  cy: number,
  ddx: number,
  ddy: number,
  R: number,
  gain: number,
  s: Scratch,
): void {
  const { width: w, height: h, data } = f;
  const R2 = R * R;
  const bw = b.i1 - b.i0 + 1;
  const out = s.out;
  const tmp = s.tmp;
  const snap2 = SNAP * SNAP;
  for (let j = b.j0; j <= b.j1; j++) {
    const v = (j + 0.5) / h;
    const ey = v * g.ay - cy;
    for (let i = b.i0; i <= b.i1; i++) {
      const u = (i + 0.5) / w;
      const ex = u * g.ax - cx;
      const d2 = ex * ex + ey * ey;
      const k = (j * w + i) * 2;
      const o = ((j - b.j0) * bw + (i - b.i0)) * 2;
      if (d2 >= R2) {
        out[o] = data[k];
        out[o + 1] = data[k + 1];
        continue;
      }
      const q = 1 - d2 / R2;
      const wt = q * q * q;
      if (kind === 'push') {
        const bu = (-gain * wt * ddx) / g.ax;
        const bv = (-gain * wt * ddy) / g.ay;
        readField(data, w, h, u + bu, v + bv, tmp);
        out[o] = bu + tmp[0];
        out[o + 1] = bv + tmp[1];
      } else {
        const m = 1 - gain * wt;
        const nx = m * data[k];
        const ny = m * data[k + 1];
        if (nx * nx + ny * ny < snap2) {
          out[o] = 0;
          out[o + 1] = 0;
        } else {
          out[o] = nx;
          out[o + 1] = ny;
        }
      }
    }
  }
  copyBox(data, w, b, out, false);
}

/** One guarded stamp (§4.3): apply, check the box + 1 texel, bisect λ on a failure. */
function guardedStamp(
  f: LiquifyField,
  g: LiquifyGrid,
  rec: Stroke,
  i: number,
  s: Scratch,
  beforeWrite: (b: Box) => void,
): StampResult {
  const [cx, cy] = stampCentre(rec, i, g);
  const b = stampBox(g, cx, cy, rec.radius);
  if (!b) return { work: 0, lambda: 1, changed: false };
  const area = boxArea(b);
  const P = rec.points;
  const ddx = rec.kind === 'push' ? (P[i * 2] - P[(i - 1) * 2]) * g.ax : 0;
  const ddy = rec.kind === 'push' ? (P[i * 2 + 1] - P[(i - 1) * 2 + 1]) * g.ay : 0;
  beforeWrite(b);
  s.ensure(area * 2);
  copyBox(f.data, f.width, b, s.backup, true);
  const ok = () => fieldMinJacobianRect(f, b.i0 - 1, b.j0 - 1, b.i1 + 1, b.j1 + 1) >= LIQUIFY_MIN_DET;
  const run = (lambda: number) => applyStamp(f, g, b, rec.kind, cx, cy, ddx, ddy, rec.radius, rec.strength * lambda, s);
  run(1);
  let lambda = 1;
  let steps = 0;
  if (!ok()) {
    let lo = 0;
    let hi = 1;
    for (; steps < GUARD_STEPS; steps++) {
      copyBox(f.data, f.width, b, s.backup, false);
      const m = (lo + hi) / 2;
      run(m);
      if (ok()) lo = m;
      else hi = m;
    }
    copyBox(f.data, f.width, b, s.backup, false);
    if (lo > 0) run(lo);
    lambda = lo;
  }
  let changed = false;
  const bw = b.i1 - b.i0 + 1;
  for (let j = b.j0; j <= b.j1 && !changed; j++) {
    const row = (j * f.width + b.i0) * 2;
    const at = (j - b.j0) * bw * 2;
    for (let k = 0; k < bw * 2; k++) {
      if (f.data[row + k] !== s.backup[at + k]) {
        changed = true;
        break;
      }
    }
  }
  return { work: area * (1 + steps), lambda, changed };
}

// ───────────────────────── the model (§3.5) ─────────────────────────

interface Group {
  /** tile index → its values before the group's first write; null = evicted (an undo of it rebuilds) */
  patch: Map<number, Float32Array> | null;
  /** bytes held by `patch` */
  bytes: number;
  /** clock time a live gesture began; -1 once committed, and for replayed records */
  liveSince: number;
}

interface AppliedRec {
  rec: Stroke;
  /** actual work (§3.6) */
  work: number;
  /** the patch group: one per committed gesture, one per replayed record */
  group: Group;
}

export interface LiveStroke {
  /** feed a raw O-frame pointer point; true when the field changed */
  add(o: { x: number; y: number }): boolean;
  /** ring colour (§2.3): resisting = the last stamp was skipped by the guard; capped = a cap refused a stamp */
  readonly state: 'ok' | 'resisting' | 'capped';
  /** a stamp of this gesture changed a texel (a gesture without one is a tap: it may fit the view) */
  readonly stamped: boolean;
  /** finger up: the records under fresh ids; [] for a no-op gesture */
  commit(newId: () => string): Stroke[];
  /** restore the gesture's tiles (second finger within the grace) */
  cancel(): void;
}

export interface LiquifyModelOptions {
  /** ms clock (default performance.now) */
  now?: () => number;
  /** runs `cb` on a later animation frame and returns a canceller (default requestAnimationFrame) */
  schedule?: (cb: () => void) => () => void;
  /** a chunked rebuild finished: `field` now matches the last sync target */
  onSettled?: () => void;
  /** test hooks; defaults from src/config/limits.ts */
  patchBudget?: number;
  syncWork?: number;
  sliceMs?: number;
  workCap?: number;
}

interface Job {
  target: readonly Stroke[];
  /** the buffer being filled; swapped into the field when the job finishes */
  buf: LiquifyField;
  applied: AppliedRec[];
  groups: Group[];
  rec: number;
  stamp: number;
  cancel: (() => void) | null;
}

let versionCounter = 0;

const sameIds = (a: readonly { id: string }[], b: readonly { id: string }[]) =>
  a.length === b.length && a.every((r, i) => r.id === b[i].id);
const isPrefix = (p: readonly { id: string }[], of: readonly { id: string }[]) =>
  p.length <= of.length && p.every((r, i) => r.id === of[i].id);
const recsOf = (a: readonly AppliedRec[]) => a.map((x) => x.rec);

const defaultSchedule = (cb: () => void): (() => void) => {
  const id = requestAnimationFrame(cb);
  return () => cancelAnimationFrame(id);
};

export class LiquifyModel {
  private readonly frame: LiquifyFrame;
  private readonly g: LiquifyGrid;
  private readonly now: () => number;
  private readonly schedule: (cb: () => void) => () => void;
  private readonly onSettled: () => void;
  private readonly patchBudget: number;
  private readonly syncWork: number;
  private readonly sliceMs: number;
  private readonly workCap: number;
  private readonly scratch = new Scratch();
  private _field: LiquifyField | null = null;
  private applied: AppliedRec[] = [];
  private groups: Group[] = [];
  private job: Job | null = null;
  private live: Group | null = null;

  constructor(frame: LiquifyFrame, opts: LiquifyModelOptions = {}) {
    this.frame = { width: frame.width, height: frame.height };
    this.g = liquifyGrid(this.frame);
    this.now = opts.now ?? (() => performance.now());
    this.schedule = opts.schedule ?? defaultSchedule;
    this.onSettled = opts.onSettled ?? (() => undefined);
    this.patchBudget = opts.patchBudget ?? PATCH_BUDGET;
    this.syncWork = opts.syncWork ?? LIQUIFY_SYNC_WORK;
    this.sliceMs = opts.sliceMs ?? LIQUIFY_SLICE_MS;
    this.workCap = opts.workCap ?? LIQUIFY_WORK_CAP;
  }

  /** the field for the records applied so far; null = no strokes (nothing allocated) */
  get field(): LiquifyField | null {
    return this._field;
  }

  /** a rebuild is running in slices: `field` still shows the previous strokes */
  get pending(): boolean {
    return this.job !== null;
  }

  /** actual work of the applied records (§3.6) */
  get work(): number {
    let s = 0;
    for (const a of this.applied) s += a.work;
    return s;
  }

  /** records applied to the field, in replay order */
  get count(): number {
    return this.applied.length;
  }

  /** the records applied to the field, in replay order (shared with EditState, never copied) */
  get records(): Stroke[] {
    return recsOf(this.applied);
  }

  /** bytes held by the undo patch ring */
  get patchBytes(): number {
    let n = 0;
    for (const g of this.allGroups()) n += g.bytes;
    return n;
  }

  private allGroups(): Group[] {
    return this.job ? [...this.groups, ...this.job.groups] : this.groups;
  }

  private ensureField(): LiquifyField {
    this._field ??= {
      width: this.g.w,
      height: this.g.h,
      data: new Float32Array(this.g.w * this.g.h * 2),
      version: ++versionCounter,
    };
    return this._field;
  }

  private free(): void {
    this.job?.cancel?.();
    this.job = null;
    this._field = null;
    this.applied = [];
    this.groups = [];
    this.live = null;
    this.scratch.release();
  }

  // ── patches (copy-on-write tiles) ──

  private tileBox(t: number): Box {
    const tw = Math.ceil(this.g.w / PATCH_TILE);
    const tx = t % tw;
    const ty = Math.floor(t / tw);
    return {
      i0: tx * PATCH_TILE,
      i1: Math.min(this.g.w, (tx + 1) * PATCH_TILE) - 1,
      j0: ty * PATCH_TILE,
      j1: Math.min(this.g.h, (ty + 1) * PATCH_TILE) - 1,
    };
  }

  /** save every tile of `b` that `group` has not saved yet, then keep the ring within its budget */
  private patchBox(group: Group, data: Float32Array, b: Box): void {
    if (!group.patch) return;
    const tw = Math.ceil(this.g.w / PATCH_TILE);
    let added = false;
    for (let ty = Math.floor(b.j0 / PATCH_TILE); ty <= Math.floor(b.j1 / PATCH_TILE); ty++) {
      for (let tx = Math.floor(b.i0 / PATCH_TILE); tx <= Math.floor(b.i1 / PATCH_TILE); tx++) {
        const t = ty * tw + tx;
        if (group.patch.has(t)) continue;
        const tb = this.tileBox(t);
        const buf = new Float32Array(boxArea(tb) * 2);
        copyBox(data, this.g.w, tb, buf, true);
        group.patch.set(t, buf);
        group.bytes += buf.byteLength;
        added = true;
      }
    }
    if (added) this.enforceBudget();
  }

  /** evict the oldest groups' patches until the ring fits; a live gesture is exempt during its cancel grace */
  private enforceBudget(): void {
    const all = this.allGroups();
    let total = 0;
    for (const g of all) total += g.bytes;
    for (const g of all) {
      if (total <= this.patchBudget) return;
      if (!g.patch) continue;
      if (g.liveSince >= 0 && this.now() - g.liveSince <= PINCH_GRACE_MS) continue;
      total -= g.bytes;
      g.patch = null;
      g.bytes = 0;
    }
  }

  private revertGroup(group: Group, data: Float32Array): void {
    for (const [t, buf] of group.patch!) copyBox(data, this.g.w, this.tileBox(t), buf, false);
  }

  // ── replay ──

  /** stamps of `rec` from index `from` into `buf` while `more()` (at least one); returns the next stamp index */
  private replay(buf: LiquifyField, rec: Stroke, from: number, group: Group, more: () => boolean, spend: (w: number) => void): number {
    const n = rec.points.length / 2;
    let i = from;
    for (; i < n; i++) {
      if (i > from && !more()) break;
      spend(guardedStamp(buf, this.g, rec, i, this.scratch, (b) => this.patchBox(group, buf.data, b)).work);
    }
    return i;
  }

  /**
   * Fill a staging buffer with `target`, starting from the applied prefix `keep` (0 = from zero): synchronously while
   * the work stays within syncWork, then in sliceMs slices. The displayed field is untouched until the swap.
   */
  private runJob(target: readonly Stroke[], keep: number): { changed: boolean; pending: boolean } {
    this.job?.cancel?.();
    this.job = null;
    if (keep === 0) {
      // a rebuild from zero: every old patch describes a buffer that is about to be replaced
      for (const g of this.groups) {
        g.patch = null;
        g.bytes = 0;
      }
      this.groups = [];
    }
    const cur = this._field;
    const data = keep > 0 && cur ? cur.data.slice() : new Float32Array(this.g.w * this.g.h * 2);
    const buf: LiquifyField = { width: this.g.w, height: this.g.h, data, version: 0 };
    const job: Job = { target, buf, applied: this.applied.slice(0, keep), groups: [], rec: keep, stamp: 1, cancel: null };
    this.job = job;
    let spent = 0;
    if (this.advance(job, () => spent <= this.syncWork, (w) => (spent += w))) return { changed: true, pending: false };
    const slice = () => {
      job.cancel = null;
      if (this.job !== job) return;
      const t0 = this.now();
      if (this.advance(job, () => this.now() - t0 < this.sliceMs, () => undefined)) this.onSettled();
      else job.cancel = this.schedule(slice);
    };
    job.cancel = this.schedule(slice);
    return { changed: true, pending: true };
  }

  /** advance a job while `more()`; true once it finished (the field then holds its buffer) */
  private advance(job: Job, more: () => boolean, spend: (w: number) => void): boolean {
    while (job.rec < job.target.length) {
      const rec = job.target[job.rec];
      let entry = job.applied[job.rec];
      if (!entry) {
        const group: Group = { patch: new Map(), bytes: 0, liveSince: -1 };
        job.groups.push(group);
        entry = { rec, work: 0, group };
        job.applied.push(entry);
      }
      const e = entry;
      const next = this.replay(job.buf, rec, job.stamp, e.group, more, (w) => {
        e.work += w;
        spend(w);
      });
      if (next < rec.points.length / 2) {
        job.stamp = next;
        return false;
      }
      job.rec++;
      job.stamp = 1;
      if (job.rec < job.target.length && !more()) return false;
    }
    // the swap: the field object keeps its identity (the session holds it), its buffer and version change
    if (this._field) {
      this._field.data = job.buf.data;
      this._field.version = ++versionCounter;
    } else this._field = { ...job.buf, version: ++versionCounter };
    this.applied = job.applied;
    this.groups = [...this.groups, ...job.groups];
    this.job = null;
    this.enforceBudget();
    return true;
  }

  /**
   * Bring the field to exactly these strokes (§3.5): equal → nothing; an extension → apply the extra records; a prefix
   * whose removed gestures still hold their patches → copy them back; anything else → rebuild. [] frees everything.
   * Ignored during a live stroke (the editor re-syncs when the stroke ends).
   */
  sync(target: readonly Stroke[]): { changed: boolean; pending: boolean } {
    if (this.live) return { changed: false, pending: false };
    if (target.length === 0) {
      const had = this._field !== null;
      this.free();
      return { changed: had, pending: false };
    }
    const applied = recsOf(this.applied);
    if (this.job) {
      if (sameIds(target, this.job.target)) return { changed: false, pending: true };
      return this.runJob(target, isPrefix(applied, target) ? applied.length : 0);
    }
    if (sameIds(target, applied)) return { changed: false, pending: false };
    if (isPrefix(applied, target)) return this.runJob(target, applied.length);
    if (isPrefix(target, applied) && this.revertTo(target.length)) return { changed: true, pending: false };
    return this.runJob(target, 0);
  }

  /** copy the removed groups' patches back, newest first; false when a boundary or a patch is missing */
  private revertTo(keep: number): boolean {
    const removed = this.applied.slice(keep);
    if (keep > 0 && this.applied[keep - 1].group === removed[0].group) return false;
    const gs: Group[] = [];
    for (const a of removed) if (gs[gs.length - 1] !== a.group) gs.push(a.group);
    if (gs.some((g) => !g.patch)) return false;
    const f = this._field!;
    for (let k = gs.length - 1; k >= 0; k--) this.revertGroup(gs[k], f.data);
    this.groups = this.groups.filter((g) => !gs.includes(g));
    this.applied = this.applied.slice(0, keep);
    f.version = ++versionCounter;
    return true;
  }

  /** start a gesture; null when a cap is already reached or a rebuild is pending */
  begin(kind: BrushKind, radius: number, start: { x: number; y: number }): LiveStroke | null {
    if (this.live || this.job) return null;
    if (this.applied.length >= MAX_STROKES || this.work >= this.workCap) return null;
    const f = this.ensureField();
    const g = this.g;
    const R = clampRadius(radius, this.frame);
    const strength = kind === 'push' ? PUSH_GAIN : RESTORE_GAIN;
    const builder = new StrokeBuilder(kind, R, this.frame, start);
    const group: Group = { patch: new Map(), bytes: 0, liveSince: this.now() };
    this.groups.push(group);
    this.live = group;
    const appliedCount = this.applied.length;
    const appliedWork = this.work;
    /** actual work of the stamp at point n */
    const works: number[] = [];
    let gestureWork = 0;
    let state: LiveStroke['state'] = 'ok';
    let stamped = false;
    let ended = false;
    const end = () => {
      ended = true;
      this.live = null;
      group.liveSince = -1;
    };
    /** the stamp at point n ≥ 1; false when it would cross a cap (§3.6) */
    const stampAt = (n: number): boolean => {
      const p0 = builder.point(n - 1);
      const p1 = builder.point(n);
      const two: Stroke = { id: '', kind, radius: R, strength, points: Float32Array.of(p0.x, p0.y, p1.x, p1.y) };
      const [cx, cy] = stampCentre(two, 1, g);
      const base = boxArea(stampBox(g, cx, cy, R));
      const records = appliedCount + Math.ceil(n / (MAX_STROKE_POINTS - 1));
      if (records > MAX_STROKES || appliedWork + gestureWork + base > this.workCap) return false;
      const r = guardedStamp(f, g, two, 1, this.scratch, (b) => this.patchBox(group, f.data, b));
      works[n] = r.work;
      gestureWork += r.work;
      if (r.changed) {
        stamped = true;
        f.version = ++versionCounter;
      }
      state = r.lambda === 0 ? 'resisting' : 'ok';
      return true;
    };
    const feed = (count: number): boolean => {
      let changed = false;
      for (let n = builder.count - count; n < builder.count; n++) {
        if (!stampAt(n)) {
          builder.stop(n);
          state = 'capped';
          break;
        }
        changed = true;
      }
      return changed;
    };
    const dropGroup = () => {
      this.groups = this.groups.filter((x) => x !== group);
    };
    return {
      add: (o) => (ended || state === 'capped' ? false : feed(builder.add(o))),
      get state() {
        return state;
      },
      get stamped() {
        return stamped;
      },
      commit: (newId) => {
        if (ended) return [];
        if (state !== 'capped') feed(builder.finishPoint());
        end();
        if (!stamped) {
          dropGroup();
          if (this.applied.length === 0) this.free();
          return [];
        }
        const recs = builder.records(newId, strength);
        recs.forEach((rec, r) => {
          const s0 = r * (MAX_STROKE_POINTS - 1);
          let w = 0;
          for (let n = s0 + 1; n < s0 + rec.points.length / 2; n++) w += works[n] ?? 0;
          this.applied.push({ rec, work: w, group });
        });
        this.enforceBudget();
        return recs;
      },
      cancel: () => {
        if (ended) return;
        end();
        dropGroup();
        if (this.applied.length === 0) {
          this.free();
          return;
        }
        if (group.patch) {
          this.revertGroup(group, f.data);
          f.version = ++versionCounter;
        } else this.runJob(recsOf(this.applied), 0);
      },
    };
  }

  /**
   * The largest |L| over the texels covering an O rect, as a length in long-edge units: sqrt((dx·W)² + (dy·H)²) / max(W, H)
   * for the frame's W × H. Multiplied by the long edge of any decode of this frame it is a pixel length (step 3's planner
   * does exactly that with TileBounds.liquifyMaxDisp).
   */
  private maxAbsIn(r: Rect): number {
    const f = this._field!;
    const { w, h } = this.g;
    const long = Math.max(this.frame.width, this.frame.height);
    const kx = this.frame.width / long;
    const ky = this.frame.height / long;
    const i0 = Math.max(0, Math.floor(r.x * w - 0.5));
    const i1 = Math.min(w - 1, Math.ceil((r.x + r.w) * w - 0.5));
    const j0 = Math.max(0, Math.floor(r.y * h - 0.5));
    const j1 = Math.min(h - 1, Math.ceil((r.y + r.h) * h - 0.5));
    let m2 = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = (j * w + i) * 2;
        const dx = f.data[k] * kx;
        const dy = f.data[k + 1] * ky;
        m2 = Math.max(m2, dx * dx + dy * dy);
      }
    }
    return Math.sqrt(m2);
  }

  /**
   * An upper bound of |L| over an O rect in long-edge units (see maxAbsIn): the largest covering texel plus one texel
   * (§4.4). This is TileBounds.liquifyMaxDisp: the planner multiplies it by the decode's long edge.
   */
  maxDisp(r: Rect): number {
    if (!this._field) return 0;
    const long = Math.max(this.frame.width, this.frame.height);
    return this.maxAbsIn(r) + Math.max(this.frame.width / long / this.g.w, this.frame.height / long / this.g.h);
  }

  /** the largest |L| over the whole frame, long-edge units (debug: __meiyan.liquify.maxDisp); 0 without strokes */
  get maxAbs(): number {
    return this._field ? this.maxAbsIn({ x: 0, y: 0, w: 1, h: 1 }) : 0;
  }

  /** finish a pending rebuild now (an export or a history flush needs the committed strokes) */
  settle(): void {
    const job = this.job;
    if (!job) return;
    job.cancel?.();
    job.cancel = null;
    this.advance(job, () => true, () => undefined);
  }

  /** o + L(o), bilinear: a tap on the output → the auto-warped image (§4.5) */
  backward(o: { x: number; y: number }): { x: number; y: number } {
    const f = this._field;
    if (!f) return { x: o.x, y: o.y };
    const t = new Float64Array(2);
    readField(f.data, f.width, f.height, o.x, o.y, t);
    return { x: o.x + t[0], y: o.y + t[1] };
  }

  /** a copy of the field for an export asked for now (like the Editor's snapshotField) */
  snapshot(): LiquifyField | null {
    const f = this._field;
    return f ? { ...f, data: f.data.slice() } : null;
  }

  dispose(): void {
    this.free();
  }
}

// ───────────────────────── ids, sanitize ─────────────────────────

/** 8 base-36 characters from `rand` (crypto.getRandomValues), redrawn on a collision with `taken` */
export function makeStrokeId(taken: ReadonlySet<string>, rand: (a: Uint8Array) => Uint8Array = (a) => crypto.getRandomValues(a)): string {
  for (;;) {
    const bytes = rand(new Uint8Array(8));
    let id = '';
    for (const b of bytes) id += (b % 36).toString(36);
    if (!taken.has(id)) return id;
  }
}

/** §5.2: drop malformed records and everything from the first over-cap record on; null frame drops all */
export function sanitizeStrokes(raw: unknown, frame: LiquifyFrame | null): Stroke[] {
  if (!frame || !Array.isArray(raw)) return [];
  const out: Stroke[] = [];
  const ids = new Set<string>();
  let work = 0;
  for (const r of raw as unknown[]) {
    if (!r || typeof r !== 'object') continue;
    const s = r as Record<string, unknown>;
    if (s.kind !== 'push' && s.kind !== 'restore') continue;
    if (typeof s.id !== 'string' || s.id.length < 1 || s.id.length > 64 || ids.has(s.id)) continue;
    let pts: Float32Array;
    if (s.points instanceof Float32Array) pts = s.points;
    else if (Array.isArray(s.points) && s.points.every((v) => typeof v === 'number')) pts = Float32Array.from(s.points as number[]);
    else continue;
    const n = pts.length / 2;
    if (pts.length % 2 !== 0 || n < 2 || n > MAX_STROKE_POINTS) continue;
    if (!pts.every((v) => Number.isFinite(v) && v >= -1 && v <= 2)) continue;
    if (typeof s.radius !== 'number' || !Number.isFinite(s.radius)) continue;
    if (typeof s.strength !== 'number' || !Number.isFinite(s.strength)) continue;
    const rec: Stroke = { id: s.id, kind: s.kind, radius: clampRadius(s.radius, frame), strength: Math.min(1, Math.max(0, s.strength)), points: pts };
    work += strokeWork(rec, frame);
    if (out.length + 1 > MAX_STROKES || work > LIQUIFY_WORK_CAP) break;
    ids.add(rec.id);
    out.push(rec);
  }
  return out;
}
