// The editor's fold safety net for summed face warps (S §4.4 last bullet): on a slider commit with ≥ 2 capped faces,
// the CPU port of the reshape pass checks min det J on a 65 × 65 grid over each capped face's influence box. Below the
// bound (MIN_DET; the caps make that impossible in every swept layout, so this should never act) a per-face strength
// scale λ_f is bisected in 6 steps, as buildBodyField does (field.ts:148-160), and multiplies that face's warp strengths
// in the table (RenderFace.warpScale) until the next change. The cap shape is never changed for this. createWarpGuard
// memoizes it on the table, so a commit that changes no face warp skips the CPU map.
import { MIN_DET } from '../body/field';
import { attenuate, boxCentre, capsFor, faceDrawn, influenceBox, ovalBox, WHOLE, type TableFace } from '../engine/passes/faceCap';
import { reshapeActive, reshapeUniforms, type ReshapeUniforms } from '../engine/passes/reshape';
import { mapMinDet, reshapeMapMulti } from '../engine/passes/reshapeCpu';
import type { FaceProtect, Rect, StillFrame } from '../types';

const scaled = (u: ReshapeUniforms, k: number): ReshapeUniforms => {
  const o = { ...u };
  for (const key of Object.keys(o) as (keyof ReshapeUniforms)[]) o[key] *= k;
  return o;
};

/** the table the check reads, built exactly as the engine's job() + tableFaces build it */
interface GuardTable {
  base: TableFace[];
  protects: FaceProtect[];
}

function guardTable(frame: StillFrame, aspect: number): GuardTable {
  const centres = frame.faces.map((f) => boxCentre(ovalBox(f.face)));
  const caps = capsFor(centres, frame.obstacles ?? [], aspect, frame.faces.map((f) => f.presence ?? 1));
  const protects: FaceProtect[] = [];
  const base: TableFace[] = frame.faces.map((f, i) => {
    const w = Number.isFinite(f.weight) ? Math.min(1, Math.max(0, f.weight)) : 0;
    const raw = scaled(reshapeUniforms(f.person.values, w, f.person.right), Math.min(1, Math.max(0, f.warpScale ?? 1)));
    const u = w > 0 && reshapeActive(raw) ? attenuate(raw, f.face.yaw) : scaled(raw, 0);
    let layer = -1;
    if (f.protect && faceDrawn(u)) {
      layer = protects.length;
      protects.push(f.protect);
    }
    return { face: f.face, u, layer, window: f.protect?.window ?? WHOLE, centre: centres[i], cap: caps[i] };
  });
  return { base, protects };
}

interface GuardOpts {
  minDet?: number;
  grid?: number;
  steps?: number;
}

function guardCheck({ base, protects }: GuardTable, aspect: number, opts: GuardOpts): number[] {
  const minDet = opts.minDet ?? MIN_DET;
  const n = opts.grid ?? 65;
  const steps = opts.steps ?? 6;
  const lambda = base.map(() => 1);
  const capped = base.flatMap((t, i) => (t.cap >= 0 && faceDrawn(t.u) ? [i] : []));
  if (capped.length < 2) return lambda;
  const table = () => base.map((t, i) => (lambda[i] === 1 ? t : { ...t, u: scaled(t.u, lambda[i]) }));
  for (const i of capped) {
    const box = influenceBox(base[i], aspect);
    if (box[0] > box[2] || box[1] > box[3]) continue;
    const ok = () => mapMinDet(reshapeMapMulti(table(), aspect, { protects }), box, n) >= minDet;
    if (ok()) continue;
    let lo = 0;
    let hi = 1;
    for (let s = 0; s < steps; s++) {
      const m = (lo + hi) / 2;
      lambda[i] = m;
      if (ok()) lo = m;
      else hi = m;
    }
    lambda[i] = lo;
  }
  return lambda;
}

/** λ_f per frame face (1 = untouched) */
export function warpGuard(frame: StillFrame, aspect: number, opts: GuardOpts = {}): number[] {
  return guardCheck(guardTable(frame, aspect), aspect, opts);
}

const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
const sameEntry = (a: TableFace, b: TableFace) =>
  a.face === b.face &&
  a.layer === b.layer &&
  a.cap === b.cap &&
  a.centre[0] === b.centre[0] &&
  a.centre[1] === b.centre[1] &&
  sameRect(a.window, b.window) &&
  (Object.keys(a.u) as (keyof ReshapeUniforms)[]).every((k) => a.u[k] === b.u[k]);

/**
 * warpGuard memoized on everything its check reads (S §6.1 commit budget): per face its table entry (the face, the
 * yaw-attenuated reshape uniforms × weight × warpScale, the cap and centre, the limit layer and window), the limits
 * drawn (identity and version), the aspect and the options. A commit that touches only photo, makeup, skin or 美體
 * values (a filter tile, a shade, a preset with the same shape values, 背景保護, ↶/↷ between such states) leaves all of
 * it unchanged and gets the previous λ at the cost of building the table (no CPU map).
 */
export function createWarpGuard(): (frame: StillFrame, aspect: number, opts?: GuardOpts) => number[] {
  let last: { table: GuardTable; versions: number[]; aspect: number; opts: GuardOpts; lambda: number[] } | null = null;
  return (frame, aspect, opts = {}) => {
    const table = guardTable(frame, aspect);
    const hit =
      last !== null &&
      last.aspect === aspect &&
      last.opts.minDet === opts.minDet &&
      last.opts.grid === opts.grid &&
      last.opts.steps === opts.steps &&
      last.table.base.length === table.base.length &&
      last.table.base.every((t, i) => sameEntry(t, table.base[i])) &&
      last.table.protects.length === table.protects.length &&
      last.table.protects.every((p, i) => p === table.protects[i] && last!.versions[i] === p.version);
    if (hit) return [...last!.lambda];
    const lambda = guardCheck(table, aspect, opts);
    last = { table, versions: table.protects.map((p) => p.version), aspect, opts: { ...opts }, lambda: [...lambda] };
    return lambda;
  };
}
