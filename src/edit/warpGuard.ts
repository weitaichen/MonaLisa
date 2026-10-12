// The editor's fold safety net for summed face warps (S §4.4 last bullet): on a slider commit with ≥ 2 capped faces,
// the CPU port of the reshape pass checks min det J on a 65 × 65 grid over each capped face's influence box. Below the
// bound (MIN_DET; the caps make that impossible in every swept layout, so this should never act) a per-face strength
// scale λ_f is bisected in 6 steps, as buildBodyField does (field.ts:148-160), and multiplies that face's warp strengths
// in the table (RenderFace.warpScale) until the next change. The cap shape is never changed for this.
import { MIN_DET } from '../body/field';
import { attenuate, boxCentre, capsFor, faceDrawn, influenceBox, ovalBox, WHOLE, type TableFace } from '../engine/passes/faceCap';
import { reshapeActive, reshapeUniforms, type ReshapeUniforms } from '../engine/passes/reshape';
import { mapMinDet, reshapeMapMulti } from '../engine/passes/reshapeCpu';
import type { FaceProtect, StillFrame } from '../types';

const scaled = (u: ReshapeUniforms, k: number): ReshapeUniforms => {
  const o = { ...u };
  for (const key of Object.keys(o) as (keyof ReshapeUniforms)[]) o[key] *= k;
  return o;
};

/** λ_f per frame face (1 = untouched), the table built exactly as the engine's job() + tableFaces build it */
export function warpGuard(frame: StillFrame, aspect: number, opts: { minDet?: number; grid?: number; steps?: number } = {}): number[] {
  const minDet = opts.minDet ?? MIN_DET;
  const n = opts.grid ?? 65;
  const steps = opts.steps ?? 6;
  const lambda = frame.faces.map(() => 1);
  const centres = frame.faces.map((f) => boxCentre(ovalBox(f.face)));
  const caps = capsFor(centres, frame.obstacles ?? [], aspect, frame.faces.map((f) => f.presence ?? 1));
  const protects: FaceProtect[] = [];
  const base: TableFace[] = frame.faces.map((f, i) => {
    const w = Number.isFinite(f.weight) ? Math.min(1, Math.max(0, f.weight)) : 0;
    const raw = scaled(reshapeUniforms(f.person.values, w), Math.min(1, Math.max(0, f.warpScale ?? 1)));
    const u = w > 0 && reshapeActive(raw) ? attenuate(raw, f.face.yaw) : scaled(raw, 0);
    let layer = -1;
    if (f.protect && faceDrawn(u)) {
      layer = protects.length;
      protects.push(f.protect);
    }
    return { face: f.face, u, layer, window: f.protect?.window ?? WHOLE, centre: centres[i], cap: caps[i] };
  });
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
