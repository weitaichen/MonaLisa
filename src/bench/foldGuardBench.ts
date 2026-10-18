// Row PC (step-1 spec §6.1, §6.3 PC1): the slider commit's fold safety net (src/edit/warpGuard.ts, S §4.4) as the
// editor runs it on a commit, through createWarpGuard and its per-face memo, with every face's 瘦臉 limit, timed where
// it runs (on the phone's CPU). Pure (no GL, no fixture fetch): bench/multiFace.ts runs it on the fixture face in
// /bench.html, and foldGuardBench.test.ts runs it in Node.
import { MAX_EDIT_FACES } from '../config/limits';
import { defaultPhoto, personFromPreset } from '../edit/state';
import { createWarpGuard } from '../edit/warpGuard';
import { PARAM_DEFS } from '../engine/params';
import { boxCentre, ovalBox } from '../engine/passes/faceCap';
import { faceWidthIso } from '../engine/passes/reshape';
import { buildFaceProtect, protectWindow } from '../tracking/faceProtect';
import type { Face, FaceProtect, PersonMask, PersonParams, StillFrame } from '../types';
import { median, type MultiRow } from './report';
import { placeBenchFace, reshapeBenchLayouts } from './reshapeLayouts';

/** S §6.1: a commit's check within 2 frames */
export const FOLD_BUDGET_MS = 66;

/** the bench frame in pixels: square (the guard runs at aspect 1), at the editor's 2048 long edge */
const FRAME_PX = 2048;
/** a selfie mask over the whole frame, as row F builds with: each face's person then fills its Voronoi cell */
const FULL_MASK: PersonMask = { width: 256, height: 256, data: new Uint8Array(256 * 256).fill(255) };

/** every 美型 item at `v` on 原圖 (the person row R and the fold sweep use, S §4.4) */
function everyShape(v: number): PersonParams {
  const p = personFromPreset('original', 1);
  return { ...p, values: { ...p.values, ...Object.fromEntries(PARAM_DEFS.filter((d) => d.group === 'shape').map((d) => [d.id, v])) } };
}

/**
 * Every face's 瘦臉 limit as the editor has it once a contour slider moved with ≥ 2 faces (faceProtectModel.ts, from
 * editorModel.ts protectRequests): the shared selfie mask clipped to the face's cell, every other face as infinitely
 * far, a PROTECT_WINDOW² window around the face. Every 美型 item at max draws a contour warp on every face, so each one
 * gets its limit. What the check costs does not depend on what the limit holds (reshapeCpu.ts runs protectContour,
 * a hypot, a 4-tap lookup and the budget, on every mapped point of a face with a limit), so a full-frame mask stands in
 * for a photo's.
 */
function limitsOf(faces: readonly Face[]): FaceProtect[] {
  return faces.map((face, i) => {
    const others = faces.filter((_, j) => j !== i);
    return buildFaceProtect(
      face,
      {
        own: FULL_MASK,
        clipToCell: true,
        otherCentres: others.map((g) => boxCentre(ovalBox(g))),
        otherOvals: others.map((g) => g.oval),
        otherMasks: [],
        window: protectWindow(face, FRAME_PX, FRAME_PX),
      },
      FRAME_PX,
      FRAME_PX,
    );
  });
}

function frameOf(faces: readonly Face[], person: (i: number) => PersonParams, protects: readonly (FaceProtect | null)[]): StillFrame {
  return {
    faces: faces.map((face, i) => ({ face, weight: 1, person: person(i), protect: protects[i], warpScale: 1 })),
    obstacles: [],
    globalSkin: null,
    photo: defaultPhoto(),
  };
}

/**
 * PC: row R's 2-row grids at 1.3 FW of 6, 8 and MAX_EDIT_FACES (10) faces on the square bench frame, every 美型 item at
 * max, every face with its 瘦臉 limit (limitsOf), as the editor's commit check runs after a contour drag. `all_ms`: a
 * 全部 commit (every face's warp changed: each one checked); `one_ms`: one person's change (that face checked, the rest
 * from the memo); `all_ms_unlimited`: the same 全部 commit without limits (before any contour drag: a preset or a default
 * look never asks for them). Per variant one warm-up commit, then the median of `runs` commits, alternating the value
 * between 1 and 0.95 so each commit really changes what it says. `lambda_min` 1: the guard did not act in any commit (the
 * caps keep the sum fold-free). The verdict reads `all_ms`, the costlier variant, against the 66 ms budget (PC1).
 */
export function foldGuardRows(base: Face, opts: { runs?: number; now?: () => number } = {}): MultiRow[] {
  const runs = opts.runs ?? 5;
  const now = opts.now ?? (() => performance.now());
  const layouts = reshapeBenchLayouts(faceWidthIso(base, 1));
  const strong = [everyShape(1), everyShape(0.95)];
  const out: MultiRow[] = [];
  for (const n of [...new Set([6, 8, MAX_EDIT_FACES])]) {
    const { centres, k } = layouts[`grid 2×${n / 2} @1.3FW`];
    const faces = centres.map(([x, y]) => placeBenchFace(base, x, y, k));
    let lambdaMin = 1;
    /** the 全部 commits' median, and with `one` the one-person commits' that follow them */
    const measure = (protects: readonly (FaceProtect | null)[], one: boolean) => {
      const guard = createWarpGuard();
      const check = (frame: StillFrame) => {
        lambdaMin = Math.min(lambdaMin, ...guard(frame, 1));
      };
      check(frameOf(faces, () => strong[0], protects));
      const time = (person: (r: number) => (i: number) => PersonParams) => {
        const ms: number[] = [];
        for (let r = 1; r <= runs; r++) {
          const frame = frameOf(faces, person(r), protects);
          const t0 = now();
          check(frame);
          ms.push(now() - t0);
        }
        return Math.round(median(ms) * 10) / 10;
      };
      const allMs = time((r) => () => strong[r % 2]);
      // from the last 全部 state (every face at strong[runs % 2]), face f0 alone alternates
      const rest = strong[runs % 2];
      const oneMs = one ? time((r) => (i) => (i === 0 ? strong[(runs + r) % 2] : rest)) : NaN;
      return { allMs, oneMs };
    };
    const limited = measure(limitsOf(faces), true);
    const unlimited = measure(faces.map(() => null), false);
    out.push({
      row: 'PC',
      config: `${n} faces grid 2×${n / 2} @1.3FW`,
      values: {
        all_ms: limited.allMs,
        one_ms: limited.oneMs,
        all_ms_unlimited: unlimited.allMs,
        lambda_min: lambdaMin,
        budget_ms: FOLD_BUDGET_MS,
        verdict: limited.allMs <= FOLD_BUDGET_MS ? 'ok' : 'OVER',
      },
    });
  }
  return out;
}
