// The CPU back-map of the frame the editor shows (skin-cleanup spec §3.4 cpuSample): Geo⁻¹ (backMapCpu), then the
// O-space part of P2 — the 推臉筆 field (step 6, outermost), the 美體 field and every listed face's warp chain with
// its cap and limit — built from the frame exactly as the engine's job() and tableFaces() build the face table. Taps
// only: never in a render path.
import { MAX_RENDER_FACES } from '../config/limits';
import type { BodyField, Geometry, LiquifyField, RenderFace, Size } from '../types';
import type { BackMapFrame } from './backMapCpu';
import { boxCentre, ovalBox } from './passes/faceCap';
import { makeupUniformsFor } from './passes/makeup';
import { reshapeUniforms, type ReshapeUniforms } from './passes/reshape';
import { reshapeMapMulti } from './passes/reshapeCpu';
import { tableFaces, type FrameFace } from './pipeline';

export interface BackMapInput {
  faces: readonly RenderFace[];
  obstacles?: readonly (readonly [number, number])[];
  body?: BodyField | null;
  geometry: Geometry;
  /** 推臉筆 field, the outermost O-space map of P2 (push-brush spec §4.1); absent / null = no strokes */
  liquify?: LiquifyField | null;
}

/** λ_f of the editor's fold safety net (RenderFace.warpScale), applied as index.ts's scaleUniforms does */
function scaled(u: ReshapeUniforms, k: number): ReshapeUniforms {
  if (k === 1) return u;
  const o = { ...u };
  for (const key of Object.keys(o) as (keyof ReshapeUniforms)[]) o[key] *= Math.min(1, Math.max(0, k));
  return o;
}

export function backMapFrameOf(input: BackMapInput, oSize: Size): BackMapFrame {
  const aspect = oSize.width / oSize.height;
  const faces: FrameFace[] = input.faces.slice(0, MAX_RENDER_FACES).map((f) => {
    const w = Math.min(1, Math.max(0, Number.isFinite(f.weight) ? f.weight : 0));
    return {
      face: f.face,
      weight: w,
      reshape: scaled(reshapeUniforms(f.person.values, w, f.person.right), f.warpScale ?? 1),
      makeup: makeupUniformsFor(f.person, w),
      kS: 1, // tableFaces reads neither kS nor kR
      kR: 1,
      protect: f.protect,
      centre: boxCentre(ovalBox(f.face)),
      presence: f.presence ?? 1,
    };
  });
  const t = tableFaces({ faces, obstacles: input.obstacles ?? [] }, aspect);
  return { geometry: input.geometry, oSize, oMap: reshapeMapMulti(t.faces, aspect, { body: input.body ?? null, protects: t.protects, liquify: input.liquify ?? null }) };
}
