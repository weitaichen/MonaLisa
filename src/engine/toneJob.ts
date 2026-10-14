// Frame inputs of the 膚質 passes (skin-cleanup spec §4.1, §4.3): which of P0b / P0c / P0d run, their region draw lists,
// and the tone-field cache key. Pure.
import type { Face, ParamId, Spot } from '../types';
import { faceFrame, fieldActive, toneActive, toneDrawsQ, toneDrawsR, toneValuesOf, type ToneCap, type ToneDraw } from './passes/toneGeometry';
import { sigmaLow } from './shaders/tone';
import type { Size } from './uniforms';

export interface ToneJobFace {
  face: Face;
  weight: number;
  values: Readonly<Partial<Record<ParamId, number>>>;
  cap: ToneCap | null;
}
export interface ToneJob {
  /** P0b runs when non-empty */
  spots: readonly Spot[];
  drawsR: readonly ToneDraw[];
  drawsQ: readonly ToneDraw[];
  /** 勻膚, 膚色, 黑眼圈 or 法令紋 on some face: L and Δ8 are built */
  fieldOn: boolean;
  /** the field runs at all (fieldOn, or 亮眼, which needs Mn8 only) */
  mn8On: boolean;
  /** P0d runs (any tone item on) */
  retouchOn: boolean;
  /** the field's identity: working image, size, spots, every face's field inputs, σ_low */
  key: string;
  /** working-resolution size the field is built at (the preview source, or RenderInput.toneSource) */
  work: Size;
  sigmaLowPx: number;
}

const ids = new WeakMap<object, number>();
let nextId = 1;
/** a stable number per object: the engine re-uploads `source` every frame, so the key uses the object (S §4.3) */
export function objectId(o: object): number {
  let id = ids.get(o);
  if (id === undefined) {
    id = nextId++;
    ids.set(o, id);
  }
  return id;
}

export function spotsKey(spots: readonly Spot[]): string {
  return spots.map((s) => `${s.x},${s.y},${s.r},${s.dx},${s.dy}`).join(';');
}

/** null when nothing of step 4 runs: the frame is then exactly step 3's */
export function buildToneJob(i: { faces: readonly ToneJobFace[]; spots: readonly Spot[]; aspect: number; work: Size; sourceId: number }): ToneJob | null {
  const faces = i.faces.map((f) => ({ ...f, tone: toneValuesOf(f.values) }));
  const live = faces.filter((f) => f.weight > 0);
  const active = live.filter((f) => toneActive(f.tone));
  if (!i.spots.length && !active.length) return null;
  const fieldOn = active.some((f) => fieldActive(f.tone));
  const mn8On = fieldOn || active.some((f) => f.tone.eyeBright > 0);
  const retouchOn = active.length > 0;
  const fwPx = (face: Face) => faceFrame(face, i.aspect).fw * i.work.width;
  const fwMax = Math.max(0, ...active.filter((f) => fieldActive(f.tone)).map((f) => fwPx(f.face)));
  const sigmaLowPx = fieldOn ? sigmaLow(fwMax, Math.min(i.work.width, i.work.height)) : 0;
  const inputs = live.map((f) => ({ face: f.face, values: f.tone, weight: f.weight, cap: f.cap }));
  // the cap sets 膚色's ring width w_T (warmRingWidth), so it is a field input like the values
  const capKey = (c: ToneCap | null) => (c && c.r >= 0 ? `${c.c[0].toFixed(5)},${c.c[1].toFixed(5)},${c.r.toFixed(5)}` : '-');
  const facesKey = faces
    .map((f, k) =>
      [k, f.weight, fwPx(f.face).toFixed(3), f.tone.even, f.tone.warmth, f.tone.darkCircle, f.tone.nasolabial, f.tone.eyeBright > 0 ? 1 : 0, capKey(f.cap)].join(':'),
    )
    .join('|');
  return {
    spots: i.spots,
    drawsR: retouchOn ? toneDrawsR(inputs, i.aspect) : [],
    drawsQ: fieldOn ? toneDrawsQ(inputs, i.aspect) : [],
    fieldOn,
    mn8On,
    retouchOn,
    key: `${i.sourceId}@${i.work.width}x${i.work.height}#${spotsKey(i.spots)}#${facesKey}#${sigmaLowPx.toFixed(4)}`,
    work: i.work,
    sigmaLowPx,
  };
}
