// The editor's fold safety net for summed face warps (S §4.4 last bullet): on a slider commit with ≥ 2 capped faces,
// the CPU port of the reshape pass checks min det J on a 65 × 65 grid over each capped face's influence box. Below the
// bound (MIN_DET; the caps make that impossible in every swept layout, so this should never act) a per-face strength
// scale λ_f is bisected in 6 steps, as buildBodyField does (field.ts:148-160), and multiplies that face's warp strengths
// in the table (RenderFace.warpScale) until the next change. The cap shape is never changed for this.
// It runs on the commit path, before the commit renders (a later check would show a folded frame first), so it is kept
// cheap (S §6.1): the caps keep the supports disjoint, so inside face f's cap disc the summed map is f's own map bit for
// bit. Each face is checked on its own map, with its chain run only inside its disc (the identity outside it) and each
// grid point mapped once (mapMinDet). λ_f then depends only on that face's table entry and limit, so createWarpGuard
// memoizes it per face: a commit re-checks only the faces whose warp changed.
import { MIN_DET } from '../body/field';
import { attenuate, boxCentre, capsFor, faceDrawn, influenceBox, ovalBox, WHOLE, type TableFace } from '../engine/passes/faceCap';
import { reshapeActive, reshapeUniforms, type ReshapeUniforms } from '../engine/passes/reshape';
import { mapMinDet, reshapeMapMulti, type UvMap } from '../engine/passes/reshapeCpu';
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

/**
 * Capped face `t` alone with its strengths × k. Its displacement is exactly 0 where cap − |tcB − c|_iso ≤ 0 (the
 * budget is 0 there, reshapeCpu.ts budgetScale), and every other face's is 0 inside its disc (each cap is at most half
 * the distance to every neighbour, capsFor), so inside the disc this is the summed map bit for bit, and outside it the
 * identity: the chain is not run there.
 */
function ownMap(t: TableFace, k: number, aspect: number, protects: readonly FaceProtect[]): UvMap {
  const m = reshapeMapMulti([k === 1 ? t : { ...t, u: scaled(t.u, k) }], aspect, { protects });
  const [cx, cy] = t.centre;
  return (x, y) => (t.cap - Math.hypot(x - cx, (y - cy) / aspect) > 0 ? m(x, y) : [x, y]);
}

/** λ_f of one capped, drawn face: 1, or the bisected scale that meets the bound on its own map */
function faceLambda(t: TableFace, protects: readonly FaceProtect[], aspect: number, opts: GuardOpts): number {
  const minDet = opts.minDet ?? MIN_DET;
  const n = opts.grid ?? 65;
  const steps = opts.steps ?? 6;
  // a cap of 0 (coincident centres) has no influence: nothing to check
  if (!(t.cap > 0)) return 1;
  const box = influenceBox(t, aspect);
  if (box[0] > box[2] || box[1] > box[3]) return 1;
  const ok = (k: number) => mapMinDet(ownMap(t, k, aspect, protects), box, n) >= minDet;
  if (ok(1)) return 1;
  let lo = 0;
  let hi = 1;
  for (let s = 0; s < steps; s++) {
    const m = (lo + hi) / 2;
    if (ok(m)) lo = m;
    else hi = m;
  }
  return lo;
}

/** λ per table face; `lambdaOf` is asked for each capped, drawn face when there are ≥ 2 of them */
function guardCheck({ base }: GuardTable, lambdaOf: (t: TableFace) => number): number[] {
  const lambda = base.map(() => 1);
  const capped = base.flatMap((t, i) => (t.cap >= 0 && faceDrawn(t.u) ? [i] : []));
  if (capped.length < 2) return lambda;
  for (const i of capped) lambda[i] = lambdaOf(base[i]);
  return lambda;
}

/** λ_f per frame face (1 = untouched) */
export function warpGuard(frame: StillFrame, aspect: number, opts: GuardOpts = {}): number[] {
  const table = guardTable(frame, aspect);
  return guardCheck(table, (t) => faceLambda(t, table.protects, aspect, opts));
}

const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
/** everything faceLambda reads of one face but its limit (compared by identity and version: its layer index can move) */
const sameFace = (a: TableFace, b: TableFace) =>
  a.face === b.face &&
  a.cap === b.cap &&
  a.centre[0] === b.centre[0] &&
  a.centre[1] === b.centre[1] &&
  sameRect(a.window, b.window) &&
  (Object.keys(a.u) as (keyof ReshapeUniforms)[]).every((k) => a.u[k] === b.u[k]);

interface FaceMemo {
  t: TableFace;
  protect: FaceProtect | null;
  version: number;
  lambda: number;
}

/**
 * warpGuard memoized per face on everything its check reads (S §6.1): the face's table entry (the face, the
 * yaw-attenuated reshape uniforms × weight × warpScale, the cap and centre, the limit window), its limit (identity and
 * version), the aspect and the options. A commit that touches only photo, makeup, skin or 美體 values (a filter tile, a
 * shade, a preset with the same shape values, 背景保護, ↶/↷ between such states) maps nothing, and one that changes one
 * person's shape values maps only that person's face.
 */
export function createWarpGuard(): (frame: StillFrame, aspect: number, opts?: GuardOpts) => number[] {
  let last: { aspect: number; opts: GuardOpts; faces: FaceMemo[] } | null = null;
  return (frame, aspect, opts = {}) => {
    const table = guardTable(frame, aspect);
    const same =
      last !== null && last.aspect === aspect && last.opts.minDet === opts.minDet && last.opts.grid === opts.grid && last.opts.steps === opts.steps;
    const prev = same ? last!.faces : [];
    const faces: FaceMemo[] = [];
    const lambda = guardCheck(table, (t) => {
      const protect = t.layer >= 0 ? table.protects[t.layer] : null;
      const version = protect?.version ?? 0;
      const memo = prev.find((m) => m.protect === protect && m.version === version && sameFace(m.t, t)) ?? {
        t,
        protect,
        version,
        lambda: faceLambda(t, table.protects, aspect, opts),
      };
      faces.push(memo);
      return memo.lambda;
    });
    // a commit that checks no face (fewer than 2 capped) keeps the memo for the next one
    if (faces.length || !same) last = { aspect, opts: { ...opts }, faces };
    return lambda;
  };
}
