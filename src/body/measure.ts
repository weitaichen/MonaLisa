// OWNER: body-geometry agent. Pose (+ mask) → body measurements and per-region availability
// (body research report §量測與閘控). Pure TS, no DOM / GL.
//
// All geometry is in Q space (geom.ts): (u·aspect, v), isotropic, in units of the image height. Widths come from
// scanlines across the person mask, never from keypoint distances (BlazePose gives joint centres only, and PCK@0.2
// accepts errors of 20 % of the torso). Keypoint-ratio widths are used only when the mask is missing.
import type { BodyDetection, BodyRegion, Face, ParamId, PersonMask, RegionStatus } from '../types';
import { add, clamp, dist, dot, lerp, median, mid, mul, perp, segDist, smoothstep, sub, unit, type V2 } from './geom';
import { gapAlong, MaskSampler } from './mask';

/** A keypoint is usable when its visibility exceeds this (the JS API exposes no `presence`, BR §偵測). */
export const VIS_MIN = 0.6;
/** ...and it lies inside the frame by this margin (UV), standing in for the missing presence score. */
export const FRAME_MARGIN = 0.02;
/** Torso length (shoulder-mid to hip-mid) must exceed this fraction of the image height. */
export const MIN_TORSO = 0.15;
/** Lower bounds (× torso length) of the shoulder / hip keypoint spans used for width expectations (profile views). */
const SPAN_FLOOR = { shoulder: 0.35, hip: 0.2 } as const;

/** BlazePose 33-point indices used here. */
export const LM = {
  lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14, lWrist: 15, rWrist: 16,
  lPinky: 17, rPinky: 18, lIndex: 19, rIndex: 20,
  lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnkle: 27, rAnkle: 28,
  lHeel: 29, rHeel: 30, lFoot: 31, rFoot: 32,
} as const;

export const REASONS = {
  none: '尚未偵測到人物',
  small: '人物太小，請使用人物較大的照片',
  noFace: '臉部太小、側臉或被遮擋時無法使用小頭／天鵝頸',
  head: '需要拍到臉和肩膀，才能使用小頭／天鵝頸',
  shoulder: '肩膀不在畫面內或被遮擋，無法使用直角肩',
  armsRaised: '手臂抬至肩高或更高時無法使用直角肩',
  arms: '手臂不完整或被遮擋，無法使用瘦手臂',
  torso: '需要拍到肩膀到臀部，才能使用瘦身／細腰／腰臀比／美臀',
  legs: '拍攝全身照可使用長腿／瘦腿',
  whrMask: '無法取得人像輪廓，腰臀比暫不可用',
} as const;

export type LimbKind = 'upperArm' | 'forearm' | 'thigh' | 'calf';

/** One limb segment as a capsule axis a→b with the measured half-width. */
export interface LimbMeasure {
  kind: LimbKind;
  a: V2;
  b: V2;
  /** half-width (median of 5 scanlines across the mask) */
  w: number;
  /**
   * 0 = both sides open; ±1 = the limb touches another part on the other side (no background gap), so only the
   * side along ±n (n = perp(unit(b − a))) is compressed — otherwise the limb would sample the neighbour's texture.
   */
  side: -1 | 0 | 1;
  /** min visibility of the two anchors (gain multiplier) */
  vis: number;
  /**
   * Per-side reach (distance from the axis the field may extend to) at t = LIMB_REACH_T[i], along +n / −n:
   * the silhouette edge plus half the background gap to the next body part, so two neighbours (thighs with a
   * narrow gap, an arm beside the torso) never stack their stretched rings. Infinity = unconstrained.
   */
  reachP: number[];
  reachM: number[];
}

/** Stations of LimbMeasure.reachP / reachM along the bone (t = 0 at a, 1 at b). */
export const LIMB_REACH_T = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];
const FREE = LIMB_REACH_T.map(() => Infinity);

export interface HandMeasure {
  a: V2;
  b: V2;
  w: number;
}

/** Torso frame S (shoulder mid) → H (hip mid) with the mask half-width profile along it. */
export interface TrunkMeasure {
  s: V2;
  h: V2;
  len: number;
  /** unit axis S → H (down the body) */
  u: V2;
  /** perp(u) */
  n: V2;
  /** half-width profile (mean of the sides): half[i] at t = T0 + i·DT (t = 0 at S, 1 at H) */
  half: Float32Array;
  /** per-side torso half-width along +n / −n (scanlines stop at arms and hands lying against the torso) */
  halfP: Float32Array;
  halfM: Float32Array;
  /** per-side reach of the field from the axis: ρ·W, or less where a background gap to another part is narrow */
  reachP: Float32Array;
  reachM: Float32Array;
  waistT: number;
  waistW: number;
  hipT: number;
  hipW: number;
  /** median half-width over t ∈ [0.2, 1] */
  torsoW: number;
  vis: number;
}

export interface ShoulderMeasure {
  /** top-of-shoulder contour points above 11 and 12 */
  tops: V2[];
  /** contour drop from the neck side to the shoulder top (how sloped the shoulders are) */
  drop: number;
  /** half the shoulder keypoint distance */
  half: number;
  /** unit "up" of the torso */
  up: V2;
  vis: number;
  /**
   * Per shoulder (same order as tops): 1 for a hanging upper arm, fading to 0 as it rises past ~55°. 直角肩 reshapes
   * the neck → shoulder slope; with the arm raised the "slope" is the arm itself and a lift would only grow a hump.
   */
  hang: number[];
  /**
   * Per shoulder: the top-of-shoulder contour was actually found (the upward scanline left the person within half
   * the shoulder span) and it lies below the chin. False when hair or the face covers the shoulder, or the
   * shoulder is only clipped by the frame edge (close-up portraits): a lift there would land on the face.
   */
  found: boolean[];
}

export interface HeadMeasure {
  /** menton (chin bottom) and forehead top from the face landmarks */
  chin: V2;
  top: V2;
  faceH: number;
  /** unit chin → forehead */
  up: V2;
  /** signed distance of the shoulder line below the chin along `up` (negative) */
  shoulderEta: number;
  vis: number;
}

export interface LegsMeasure {
  /** UV y of the hip line, the knees, the lower ankle and the lowest foot point */
  hipY: number;
  kneeY: number;
  /** 長腿 stretches down to here only: the feet / shoes below are moved, never stretched */
  ankleY: number;
  feetY: number;
  vis: number;
}

/**
 * Measured geometry of the edited person, in ISO pixel-free space as the field builder needs it.
 * `regions` is the UI contract; the remaining fields are owned by src/body and may grow.
 */
export interface BodyMeasure {
  regions: Record<BodyRegion, RegionStatus>;
  /**
   * people detected in the photo (≥ 2 → UI hint 「偵測到多人，僅調整畫面中央的主要人物」; the edited person is the
   * largest landmark bbox discounted by its distance from the image centre, bodyTracker.ts selectPerson)
   */
  people: number;
  /** source aspect W/H the measure was taken at */
  aspect: number;
  /** the person mask (for 背景保護); null → widths came from keypoint ratios */
  mask: PersonMask | null;
  facing: 'front' | 'back' | 'side';
  /** torso length (or 1.5 × shoulder distance without hips), fraction of the image height */
  scale: number;
  trunk: TrunkMeasure | null;
  limbs: LimbMeasure[];
  hands: HandMeasure[];
  shoulders: ShoulderMeasure | null;
  head: HeadMeasure | null;
  legs: LegsMeasure | null;
}

/** Trunk profile sampling: t from T0 (above the shoulder line) to T0 + (N−1)·DT (below the hips). */
export const TRUNK_T0 = -0.1;
export const TRUNK_DT = 0.025;
/** torso capsule radius / half-width (the field's R = ρ·W, also used here to cap the measured reach) */
export const TRUNK_RHO = 2.0;
/** widest trunk ring (× the local half-width), used when an arm beside the torso is carried along */
export const TRUNK_REACH_MAX = 3.0;
export const TRUNK_N = 77; // → t = 1.8 (past every bump, 美臀's thigh tail included: K must reach 0 before the profile ends)

const OK: RegionStatus = { ok: true, reason: null };
const no = (reason: string): RegionStatus => ({ ok: false, reason });

interface Kp {
  q: V2;
  vis: number;
  ok: boolean;
  inFrame: boolean;
}

/** Measure the body from one detection (and the face, for head / neck anchors when available). */
export function measureBody(det: BodyDetection, face: Face | null): BodyMeasure {
  const aspect = det.width > 0 && det.height > 0 ? det.width / det.height : 1;
  const P = det.pose.points;
  const kp: Kp[] = [];
  for (let i = 0; i < 33; i++) {
    const x = P[i * 4];
    const y = P[i * 4 + 1];
    const vis = P[i * 4 + 3];
    const inFrame = x >= FRAME_MARGIN && x <= 1 - FRAME_MARGIN && y >= FRAME_MARGIN && y <= 1 - FRAME_MARGIN;
    const finite = Number.isFinite(x) && Number.isFinite(y);
    kp.push({ q: [x * aspect, y], vis: Number.isFinite(vis) ? vis : 0, ok: finite && inFrame && vis > VIS_MIN, inFrame: finite && inFrame });
  }
  const all = (...ids: number[]) => ids.every((i) => kp[i].ok);
  const minVis = (...ids: number[]) => Math.min(...ids.map((i) => kp[i].vis));
  const Q = (i: number) => kp[i].q;

  const mask = det.mask && det.mask.width > 0 && det.mask.height > 0 ? det.mask : null;
  const ms = mask ? new MaskSampler(mask, aspect) : null;

  const shouldersOk = all(LM.lShoulder, LM.rShoulder);
  const torsoAnchors = shouldersOk && all(LM.lHip, LM.rHip);
  const sd = dist(Q(LM.lShoulder), Q(LM.rShoulder));
  const S = mid(Q(LM.lShoulder), Q(LM.rShoulder));
  const H = mid(Q(LM.lHip), Q(LM.rHip));
  const scale = torsoAnchors ? dist(S, H) : shouldersOk ? 1.5 * sd : 0;
  const scaleOk = scale > MIN_TORSO;
  const hd = dist(Q(LM.lHip), Q(LM.rHip));
  // The shoulder / hip spans foreshorten to ≈ 0 in a profile view while the mask still shows the full chest-to-back
  // depth. They only set the keypoint expectation of the widths (the scan distance, the sanity clamp, the no-mask
  // fallback), so floor them with the view-independent torso length; the floors sit below frontal ratios (≈ 0.4–0.8
  // and 0.2–0.45 L), leaving frontal measurements unchanged. Raw sd stays in use for the shoulders and `facing`.
  const sdM = Math.max(sd, SPAN_FLOOR.shoulder * scale);
  const hdM = Math.max(hd, SPAN_FLOOR.hip * scale);

  // ── arms (measured first: the torso scanlines must stop at them) ──
  const limbs: LimbMeasure[] = [];
  const hands: HandMeasure[] = [];
  const armSides: [number, number, number, number, number][] = [
    [LM.lShoulder, LM.lElbow, LM.lWrist, LM.lPinky, LM.lIndex],
    [LM.rShoulder, LM.rElbow, LM.rWrist, LM.rPinky, LM.rIndex],
  ];
  let armsOk = false;
  for (const [sh, el, wr, pk, ix] of armSides) {
    if (!all(sh, el, wr)) continue;
    armsOk = true;
    const upper = measureLimb(ms, 'upperArm', Q(sh), Q(el), 0.135 * sdM, minVis(sh, el));
    const fore = measureLimb(ms, 'forearm', Q(el), Q(wr), 0.1 * sdM, minVis(el, wr));
    limbs.push(upper, fore);
    hands.push(handOf(kp, wr, pk, ix, Q(el), fore.w));
  }

  // ── trunk ──
  let trunk: TrunkMeasure | null = null;
  if (torsoAnchors && scale > 1e-6) {
    trunk = measureTrunk(ms, S, H, sdM, hdM, limbs, hands, minVis(LM.lShoulder, LM.rShoulder, LM.lHip, LM.rHip));
  }

  // ── legs ──
  const legIds = [LM.lHip, LM.rHip, LM.lKnee, LM.rKnee, LM.lAnkle, LM.rAnkle];
  const feetIds = [LM.lAnkle, LM.rAnkle, LM.lHeel, LM.rHeel, LM.lFoot, LM.rFoot];
  const feetInFrame = feetIds.every((i) => kp[i].inFrame);
  const legsAnchors = all(...legIds) && feetInFrame;
  let legs: LegsMeasure | null = null;
  if (all(LM.lHip, LM.lKnee, LM.lAnkle)) {
    limbs.push(measureLimb(ms, 'thigh', Q(LM.lHip), Q(LM.lKnee), 0.47 * hdM, minVis(LM.lHip, LM.lKnee)));
    limbs.push(measureLimb(ms, 'calf', Q(LM.lKnee), Q(LM.lAnkle), 0.32 * hdM, minVis(LM.lKnee, LM.lAnkle)));
  }
  if (all(LM.rHip, LM.rKnee, LM.rAnkle)) {
    limbs.push(measureLimb(ms, 'thigh', Q(LM.rHip), Q(LM.rKnee), 0.47 * hdM, minVis(LM.rHip, LM.rKnee)));
    limbs.push(measureLimb(ms, 'calf', Q(LM.rKnee), Q(LM.rAnkle), 0.32 * hdM, minVis(LM.rKnee, LM.rAnkle)));
  }
  if (legsAnchors) {
    legs = {
      hipY: (Q(LM.lHip)[1] + Q(LM.rHip)[1]) / 2,
      kneeY: (Q(LM.lKnee)[1] + Q(LM.rKnee)[1]) / 2,
      ankleY: Math.max(Q(LM.lAnkle)[1], Q(LM.rAnkle)[1]),
      feetY: Math.max(...feetIds.map((i) => Q(i)[1])),
      vis: minVis(...legIds),
    };
  }

  // ── shoulders ──
  const up: V2 = trunk ? mul(trunk.u, -1) : shoulderUp(Q(LM.lShoulder), Q(LM.rShoulder));
  const shoulders = shouldersOk ? measureShoulders(ms, Q(LM.lShoulder), Q(LM.rShoulder), up, minVis(LM.lShoulder, LM.rShoulder)) : null;
  if (shoulders) {
    const down = mul(up, -1);
    shoulders.hang = [[LM.lShoulder, LM.lElbow], [LM.rShoulder, LM.rElbow]].map(([sh, el]) =>
      kp[el].ok ? smoothstep(0.25, 0.6, dot(unit(sub(Q(el), Q(sh))), down)) : 1,
    );
  }

  // ── head (needs the face: BlazePose has no chin / crown) ──
  let head: HeadMeasure | null = null;
  if (face && shouldersOk) {
    const top: V2 = [face.ext[0] * aspect, face.ext[1]];
    const chin: V2 = [face.ext[8] * aspect, face.ext[9]];
    const faceH = dist(top, chin);
    if (faceH > 1e-4) {
      const hu = unit(sub(top, chin));
      head = { chin, top, faceH, up: hu, shoulderEta: Math.min(-0.2 * faceH, dot(sub(S, chin), hu)), vis: minVis(LM.lShoulder, LM.rShoulder) };
    }
  }
  if (shoulders && head) {
    // a shoulder "top" at or above the chin is hair / face, not a shoulder contour
    shoulders.found = shoulders.found.map((f, i) => f && dot(sub(shoulders.tops[i], head!.chin), head!.up) < -0.1 * head!.faceH);
  }

  const dx = Q(LM.lShoulder)[0] - Q(LM.rShoulder)[0]; // person's left shoulder is on the image right when facing us
  const facing: BodyMeasure['facing'] = Math.abs(dx) < 0.25 * Math.max(scale, 1e-6) ? 'side' : dx > 0 ? 'front' : 'back';

  const small = no(REASONS.small);
  const regions: Record<BodyRegion, RegionStatus> = {
    head: !face ? no(REASONS.noFace) : !head ? no(REASONS.head) : OK,
    shoulder: !shouldersOk || !shoulders?.found.some(Boolean) ? no(REASONS.shoulder) : !scaleOk ? small : OK,
    arms: !armsOk ? no(REASONS.arms) : !scaleOk ? small : OK,
    torso: !torsoAnchors ? no(REASONS.torso) : !scaleOk ? small : OK,
    legs: !legsAnchors || !torsoAnchors ? no(REASONS.legs) : !scaleOk ? small : OK,
  };
  if (!regions.legs.ok) legs = null;

  return {
    regions,
    people: Math.max(1, det.people | 0),
    aspect,
    mask,
    facing,
    scale,
    trunk: regions.torso.ok ? trunk : null,
    limbs: limbs.filter((l) => ((l.kind === 'thigh' || l.kind === 'calf') ? regions.legs.ok : regions.arms.ok)),
    hands,
    shoulders: regions.shoulder.ok ? shoulders : null,
    head,
    legs,
  };
}

function shoulderUp(l: V2, r: V2): V2 {
  const n = perp(unit(sub(l, r)));
  return n[1] < 0 ? n : mul(n, -1);
}

/**
 * Half-width of a limb from 5 scanlines (t = 0.3…0.7) along its normal. A side whose scanline runs much longer
 * than the other (or never leaves the person) touches a neighbour: only the open side is compressed then.
 */
function measureLimb(ms: MaskSampler | null, kind: LimbKind, a0: V2, b0: V2, wFallback: number, vis: number): LimbMeasure {
  const fallback: LimbMeasure = { kind, a: a0, b: b0, w: wFallback, side: 0, vis, reachP: FREE, reachM: FREE };
  if (!ms || wFallback <= 0) return fallback;
  const u = unit(sub(b0, a0));
  const n = perp(u);
  const L = dist(a0, b0);
  const maxD = 3 * wFallback;
  const halves: number[] = [];
  const offs: number[] = [];
  const openPlus: number[] = [];
  const openMinus: number[] = [];
  let embedded = 0;
  for (const t of [0.3, 0.4, 0.5, 0.6, 0.7]) {
    const p = add(a0, mul(u, t * L));
    const dp = ms.march(p, n, maxD);
    const dm = ms.march(p, mul(n, -1), maxD);
    if (!dp || !dm) continue;
    const plusLong = dp.hit === 'max' || dp.dist > 1.8 * dm.dist;
    const minusLong = dm.hit === 'max' || dm.dist > 1.8 * dp.dist;
    if (plusLong && minusLong) embedded++;
    else if (plusLong) openMinus.push(dm.dist);
    else if (minusLong) openPlus.push(dp.dist);
    else {
      halves.push((dp.dist + dm.dist) / 2);
      offs.push((dp.dist - dm.dist) / 2);
    }
  }
  const lo = 0.5 * wFallback;
  const hi = 2 * wFallback;
  const best = Math.max(halves.length, openPlus.length, openMinus.length, embedded);
  if (best === 0 || best === embedded) return fallback;
  let a = a0;
  let b = b0;
  let w: number;
  let side: -1 | 0 | 1 = 0;
  if (best === halves.length) {
    w = clamp(median(halves), lo, hi);
    const off = clamp(median(offs), -0.3 * w, 0.3 * w);
    a = add(a0, mul(n, off));
    b = add(b0, mul(n, off));
  } else if (best === openPlus.length) {
    w = clamp(median(openPlus), lo, hi);
    side = 1;
  } else {
    w = clamp(median(openMinus), lo, hi);
    side = -1;
  }
  const reach = [n, mul(n, -1)].map((d) =>
    LIMB_REACH_T.map((t) => {
      const p = add(a, mul(u, t * L));
      const h = ms.march(p, d, maxD);
      if (!h) return Infinity; // axis outside the silhouette here (joint ends): no constraint from the mask
      // never left the person: this side touches a neighbour (thighs at the crotch) → keep the edge in place
      return h.hit === 'edge' ? h.dist + 0.5 * gapAlong(ms, add(p, mul(d, h.dist)), d, 2 * maxD) : w;
    }),
  );
  return { kind, a, b, w, side, vis, reachP: reach[0], reachM: reach[1] };
}

function handOf(kp: Kp[], wr: number, pk: number, ix: number, elbow: V2, foreW: number): HandMeasure {
  const w0 = kp[wr].q;
  const fingers = [pk, ix].filter((i) => kp[i].inFrame && kp[i].vis > 0.3).map((i) => kp[i].q);
  const knuckles: V2 = fingers.length ? mul(fingers.reduce((s, p) => add(s, p), [0, 0] as V2), 1 / fingers.length) : add(w0, mul(sub(w0, elbow), 0.35));
  const handLen = Math.max(dist(w0, knuckles), 2 * foreW);
  const dir = unit(sub(knuckles, w0));
  return { a: w0, b: add(w0, mul(dir, 1.3 * handLen)), w: Math.max(0.9 * handLen, 1.3 * foreW) };
}

function measureTrunk(
  ms: MaskSampler | null,
  S0: V2,
  H0: V2,
  sd: number,
  hd: number,
  limbs: readonly LimbMeasure[],
  hands: readonly HandMeasure[],
  vis: number,
): TrunkMeasure {
  const L = dist(S0, H0);
  const u = unit(sub(H0, S0));
  const n = perp(u);
  // keypoint expectation of the half-width; only a sanity range and the fallback shape
  const kpHalf = (t: number) => lerp(0.5 * sd, Math.max(0.85 * hd, 0.4 * sd), clamp(t, 0, 1));
  const shape = (t: number) => 1 - 0.15 * Math.exp(-(((t - 0.55) / 0.22) ** 2));
  const half = new Float32Array(TRUNK_N);
  const halfP = new Float32Array(TRUNK_N);
  const halfM = new Float32Array(TRUNK_N);
  const reachP = new Float32Array(TRUNK_N).fill(Infinity);
  const reachM = new Float32Array(TRUNK_N).fill(Infinity);
  const tAt = (i: number) => TRUNK_T0 + i * TRUNK_DT;
  const blocked = new Array<boolean>(TRUNK_N).fill(false);

  if (!ms) {
    for (let i = 0; i < TRUNK_N; i++) half[i] = halfP[i] = halfM[i] = kpHalf(tAt(i)) * shape(tAt(i));
  } else {
    const arms = limbs.filter((l) => l.kind === 'upperArm' || l.kind === 'forearm');
    const raw = [new Array<number>(TRUNK_N).fill(NaN), new Array<number>(TRUNK_N).fill(NaN)];
    const reach = [new Array<number>(TRUNK_N).fill(NaN), new Array<number>(TRUNK_N).fill(NaN)];
    for (let i = 0; i < TRUNK_N; i++) {
      const t = tAt(i);
      const p = add(S0, mul(u, t * L));
      const exp = kpHalf(t);
      // stop at an arm or hand lying against the torso (an arm crossing in front of the torso is ignored: the stop
      // only counts once the scanline is past 55 % of the expected half-width)
      const stop = (q: V2, d: number) =>
        d > 0.55 * exp && (arms.some((a) => segDist(q, a.a, a.b) < a.w) || hands.some((h) => segDist(q, h.a, h.b) < 0.6 * h.w));
      const dirs: V2[] = [n, mul(n, -1)];
      const hits = dirs.map((d) => ms.march(p, d, 2.2 * exp, stop));
      if (!hits[0] || !hits[1]) continue;
      // below the hip joints the axis runs into the crotch: a scanline that leaves the person right away measures
      // the gap between the legs, not the hips. Those stations hold the last hip width (fillProfile), so the hip /
      // 美臀 terms carry on smoothly over the thighs instead of collapsing at the crotch.
      if (t > 0.9 && hits.some((h) => h!.hit === 'edge' && h!.dist < 0.35 * exp)) continue;
      // stations whose scanline stopped at an arm or hand lying on the torso: their width is not the waist's
      blocked[i] = hits.some((h) => h!.hit === 'stop');
      for (let k = 0; k < 2; k++) {
        const h = hits[k]!;
        raw[k][i] = h.dist;
        reach[k][i] = trunkReach(ms, p, dirs[k], h, exp);
      }
    }
    const outs = [halfP, halfM];
    const routs = [reachP, reachM];
    for (let k = 0; k < 2; k++) {
      fillProfile(raw[k], (i) => kpHalf(tAt(i)) * shape(tAt(i)));
      const sm = smoothProfile(raw[k]);
      for (let i = 0; i < TRUNK_N; i++) {
        const e = kpHalf(tAt(i));
        outs[k][i] = clamp(sm[i], 0.45 * e, 1.8 * e);
      }
      fillProfile(reach[k], (i) => TRUNK_RHO * outs[k][i]);
      // erode first so smoothing can never carry the reach into a nearby arm
      const eroded = reach[k].map((_, i) => Math.min(...reach[k].slice(Math.max(0, i - 3), Math.min(TRUNK_N, i + 4))));
      // several box passes: the reach changes abruptly where an arm starts or ends, and a step in R would show as a
      // kink in background lines near the gap
      const rs = smoothProfile(smoothProfile(eroded, false), false);
      for (let i = 0; i < TRUNK_N; i++) routs[k][i] = Math.max(rs[i], outs[k][i]);
    }
    for (let i = 0; i < TRUNK_N; i++) half[i] = (halfP[i] + halfM[i]) / 2;
  }

  const idx = (t: number) => Math.round((t - TRUNK_T0) / TRUNK_DT);
  const at = (t: number) => half[idx(t)];
  // waist: narrowest station 0.25–0.75 L above the hip line; a flat profile gets the conventional 0.45 L. Stations
  // where an arm or a hand on the belly cut the scanline short are skipped: that "narrow" reading is the hand, and
  // a waist placed there leaves the visible waist below it untouched (and one flank only).
  const WT0 = 0.25;
  const WT1 = 0.75;
  // (dilated: the median + box passes spread a short reading over the next stations)
  const near = blocked.map((_, i) => blocked.slice(Math.max(0, i - 2), i + 3).some(Boolean));
  let open = 0;
  for (let t = WT0; t <= WT1 + 1e-9; t += TRUNK_DT) if (!near[idx(t)]) open++;
  const usable = (t: number) => open < 3 || !near[idx(t)];
  let waistT = 0.55;
  let waistW = at(0.55);
  const band: number[] = [];
  for (let t = WT0; t <= WT1 + 1e-9; t += TRUNK_DT) if (usable(t)) band.push(at(t));
  const medBand = median(band);
  waistW = Infinity;
  for (let t = WT0; t <= WT1 + 1e-9; t += TRUNK_DT) {
    if (usable(t) && at(t) < waistW - 1e-12) {
      waistW = at(t);
      waistT = t;
    }
  }
  if ((medBand - waistW) / medBand < 0.03) {
    // flat profile: the conventional station, or the usable one nearest to it
    waistT = 0.55;
    for (let t = WT0; t <= WT1 + 1e-9; t += TRUNK_DT) if (usable(t) && (!usable(waistT) || Math.abs(t - 0.55) < Math.abs(waistT - 0.55))) waistT = t;
    waistW = at(waistT);
  }
  // hip line: widest station at or just below the hip joints
  let hipT = 1;
  let hipW = at(1);
  for (let t = 0.95; t <= 1.15 + 1e-9; t += TRUNK_DT) {
    if (at(t) > hipW) {
      hipW = at(t);
      hipT = t;
    }
  }
  const core: number[] = [];
  for (let t = 0.2; t <= 1 + 1e-9; t += TRUNK_DT) core.push(at(t));
  return { s: S0, h: H0, len: L, u, n, half, halfP, halfM, reachP, reachM, waistT, waistW, hipT, hipW, torsoW: median(core), vis };
}

/**
 * How far the trunk field may reach on one side of station p (scanline result h). Across open background it is
 * ρ·W. A body part beyond a WIDE background gap (an arm hanging clear of the waist) keeps its half of the gap:
 * the field stops half-way, so the two parts' rings never stretch the same strip. A part lying against the torso
 * (scanline stopped) or beyond a NARROW gap (< W) cannot be separated from it — slimming the torso edge alone
 * would have to magnify a few pixels of gap several times over, and a ring ending inside the arm would widen it.
 * Such a part is moved WITH the torso instead: the ring is widened until the part sits at r ≈ 0.45, where
 * v·φ(v/R) is flat, so the arm translates almost rigidly and the torso + arm silhouette slims as a whole.
 */
function trunkReach(ms: MaskSampler, p: V2, d: V2, h: { dist: number; hit: 'edge' | 'stop' | 'max' }, exp: number): number {
  const W = h.dist;
  if (h.hit === 'max') return TRUNK_RHO * W;
  let near: number; // inner and outer distance of the neighbouring part from the axis
  let far: number;
  if (h.hit === 'edge') {
    const edge = add(p, mul(d, W));
    const gap = gapAlong(ms, edge, d, 2.5 * exp);
    if (gap >= W) return Math.min(TRUNK_RHO * W, W + 0.5 * gap);
    near = W + gap;
    const beyond = ms.march(add(edge, mul(d, gap + ms.texel)), d, 2 * exp);
    far = near + ms.texel + (beyond ? beyond.dist : 0);
  } else {
    near = W;
    const out = ms.march(p, d, 2.2 * exp + W);
    far = out ? Math.max(W, out.dist) : W;
  }
  return clamp((0.5 * (near + far)) / 0.45, TRUNK_RHO * W, TRUNK_REACH_MAX * W);
}

/** Replace NaN stations by the nearest valid one (or the fallback when none is valid). */
function fillProfile(raw: number[], fallback: (i: number) => number): void {
  const valid = raw.map((v, i) => (Number.isFinite(v) ? i : -1)).filter((i) => i >= 0);
  for (let i = 0; i < raw.length; i++) {
    if (Number.isFinite(raw[i])) continue;
    if (!valid.length) {
      raw[i] = fallback(i);
      continue;
    }
    let best = valid[0];
    for (const j of valid) if (Math.abs(j - i) < Math.abs(best - i)) best = j;
    raw[i] = raw[best];
  }
}

/** Median (default 5 taps: rejects single-station spikes such as a hand) then box-3 passes. */
function smoothProfile(raw: readonly number[], useMedian = true, passes = 2, medianRadius = 2): number[] {
  const n = raw.length;
  const m = useMedian ? raw.map((_, i) => median(raw.slice(Math.max(0, i - medianRadius), Math.min(n, i + medianRadius + 1)))) : [...raw];
  let a = m;
  for (let pass = 0; pass < passes; pass++) {
    a = a.map((_, i) => (a[Math.max(0, i - 1)] + a[i] + a[Math.min(n - 1, i + 1)]) / 3);
  }
  return a;
}

function measureShoulders(ms: MaskSampler | null, l: V2, r: V2, up: V2, vis: number): ShoulderMeasure {
  const half = dist(l, r) / 2;
  const S = mid(l, r);
  const tops: V2[] = [];
  const drops: number[] = [];
  const found: boolean[] = [];
  for (const P of [l, r]) {
    const top = ms?.march(P, up, half);
    const dS = top?.dist ?? 0.25 * half;
    // no mask, or the keypoint itself outside the mask: nothing to contradict the keypoint estimate
    found.push(!top || top.hit === 'edge');
    tops.push(add(P, mul(up, dS)));
    if (!ms) continue;
    // contour height part-way towards the neck, relative to the shoulder top; the lower of two probes avoids
    // climbing the neck itself
    const probes = [0.5, 0.62].map((f) => {
      const N = add(S, mul(sub(P, S), f));
      const m = ms.march(N, up, 1.5 * half);
      return m ? m.dist + dot(sub(N, P), up) : NaN;
    });
    const d = Math.min(...probes.filter(Number.isFinite));
    if (Number.isFinite(d)) drops.push(d - dS);
  }
  const drop = clamp(drops.length ? median(drops) : 0.2 * half, 0.08 * half, 0.45 * half);
  return { tops, drop, half, up, vis, hang: [1, 1], found };
}

const REGION_OF: Partial<Record<ParamId, BodyRegion>> = {
  'body.legs': 'legs',
  'body.legSlim': 'legs',
  'body.slim': 'torso',
  'body.waist': 'torso',
  'body.whr': 'torso',
  'body.hip': 'torso',
  'body.arms': 'arms',
  'body.shoulder': 'shoulder',
  'body.neck': 'head',
  'body.head': 'head',
};

/** Region a 美體 slider depends on (undefined for non-body params). */
export function regionOf(id: ParamId): BodyRegion | undefined {
  return REGION_OF[id];
}

/** Availability of one 美體 slider: which region it needs and whether that region is usable. */
export function paramAvailability(m: BodyMeasure | null, id: ParamId): RegionStatus {
  const region = REGION_OF[id];
  if (!region) return OK;
  if (!m) return no(REASONS.none);
  const st = m.regions[region];
  if (!st.ok) return st;
  // 腰臀比 is a ratio of two mask widths; keypoint ratios would only invent it
  if (id === 'body.whr' && !m.mask) return no(REASONS.whrMask);
  if (id === 'body.shoulder' && m.shoulders && Math.max(...m.shoulders.hang.map((h, i) => (m.shoulders!.found[i] ? h : 0))) <= 0) {
    return no(REASONS.armsRaised);
  }
  return OK;
}
