// RATCHET for background straightness (reports/美體修圖 背景扭曲 抑制技術.md, stages 0 and 1): every scene × slider below
// must stay at least as good as the numbers recorded in the tables. When an improvement lands, tighten the tables:
//   STRAIGHTNESS_PRINT=1 npx vitest run src/body/straightness.test.ts --silent=false
// prints the measured tables in this file's format, ready to paste over BODY / DOOR / FACE / WALL.
// All px are at a 4032 px long edge (straightness.ts).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BeautyParams, BodyDetection, Face, ParamId } from '../types';
import { defaultParams, setBodyProtect, setHeightBand, setParam } from '../engine/params';
import { reshapeUniforms } from '../engine/passes/reshape';
import { reshapeMapCpu } from '../engine/passes/reshapeCpu';
import { adapt } from '../tracking/adapter111';
import { buildBodyField, fieldMinJacobian, MIN_DET } from './field';
import { loadPoseFixture } from './fixtures.node';
import { measureBody } from './measure';
import { portraitScene, sampleFaceScene, sampleWallScene } from './faceScenes.node';
import { analysisGrid, bodyMetrics, draftJumpPx, faceMetrics, fieldMap, maskInside, REF_EDGE, segmentBend, type Analysis } from './straightness';
import { syntheticFigure, syntheticPortrait } from './synthetic';

// ───────────────────────── the ratchet tables (tighten these) ─────────────────────────

/** worse-than-table allowances */
const TOL = {
  /** px @ 4032 */
  bend: 1,
  /** percentage points of stretch (1/σ_min − 1) */
  stretch: 1,
  /**
   * relative growth of the ring extent (a wider but gentler ring, e.g. a membrane relaxation, is a deliberate
   * trade: re-record ringPx for it rather than raising this)
   */
  ring: 0.05,
  minDet: 0.01,
  /** px @ 4032, draft (128) vs commit (256) */
  draftJump: 1,
  /** % of the face width */
  face: 0.5,
};

// [bendV, bendH, bendD45, bendD30, stretchMax %, stretchP99 %, gapStretch %, ringPx, minDet, minDet128, draftJumpPx]
type BodyRow = [number, number, number, number, number, number, number, number, number, number, number];
const BODY_COLS = ['bendV', 'bendH', 'bendD45', 'bendD30', 'stretchMax', 'stretchP99', 'gapStretch', 'ringPx', 'minDet', 'minDet128', 'draftJump'] as const;

// measured 2026-10-08, stage 1 (per-part 背景保護 + the background relaxation, relax.ts, with the frame border fixed
// to the original field: synth 小頭 near the top edge then gives p99 29 → 25.8 % and draftJump 3.6 → 3.2 px for
// bendV 10.9 → 11.3 px (stage 0: 15.4))
// prettier-ignore
const BODY: Record<string, Record<string, BodyRow>> = {
  synth: {
    'waist': [26.7, 0, 19.6, 13.8, 10.3, 8.5, 9.7, 178.5, 0.85, 0.85, 1.5],
    'slim': [33.6, 4.1, 31, 21.8, 39.5, 31.9, 39.5, 247.1, 0.72, 0.74, 2.8],
    'slim+waist': [45.2, 4.1, 37.7, 26.7, 57.1, 34, 39.4, 259.8, 0.63, 0.7, 2.9],
    'slim+waist_noprotect': [45.2, 4.1, 37.8, 26.7, 54.9, 32, 37.3, 343.6, 0.64, 0.71, 2.9],
    'legSlim': [27.7, 0.6, 26.9, 19.5, 47.2, 39.6, 43.3, 224.4, 0.68, 0.71, 2],
    'arms': [26.1, 8.7, 24.3, 20.6, 46.2, 34, 8.4, 215.4, 0.67, 0.73, 1.8],
    'shoulder': [0, 7, 5.7, 7.2, 7.4, 4.9, 0, 172.9, 0.84, 0.86, 1.4],
    'head': [11.3, 29.1, 23.2, 28.6, 39.9, 25.8, 0, 273.4, 0.66, 0.67, 3.2],
    'legs': [0, 10.3, 27.1, 20.3, 18, 13.7, 11.8, 1084.2, 0.85, 0.86, 4],
    'height_band': [0, 6.3, 35.6, 25.7, 24.2, 17.3, 15, 1079.7, 0.81, 0.82, 5],
    'all_max': [46.1, 46.9, 49.1, 45.5, 105.6, 39.7, 41, 1084.2, 0.48, 0.41, 6.4],
  },
  synth_armsdown: {
    'waist': [9.7, 0, 7.7, 5.4, 17.9, 13.1, 0, 183.7, 0.85, 0.85, 0.5],
    'slim': [26.6, 0.9, 23.4, 16.4, 42.7, 32.9, 0, 241.9, 0.7, 0.73, 2.3],
    'slim+waist': [33.6, 0.9, 28.9, 20.8, 56.5, 43.9, 0, 246.4, 0.64, 0.68, 2.2],
    'slim+waist_noprotect': [33.4, 0.9, 28.8, 20.7, 56.5, 40.6, 0, 345, 0.64, 0.68, 1.2],
    'legSlim': [29.7, 0.6, 26.6, 19, 51.6, 41.7, 0, 224, 0.66, 0.63, 3],
    'arms': [26.6, 1.9, 20.8, 15.4, 46.3, 35.2, 0, 197.2, 0.64, 0.74, 1.6],
    'shoulder': [0, 7, 5.7, 7.2, 7.4, 4.9, 0, 172.9, 0.84, 0.86, 1.4],
    'head': [11.6, 29.1, 23.4, 28.6, 39.9, 25.8, 0, 273.4, 0.66, 0.67, 3.2],
    'legs': [0, 25.6, 35.7, 30.4, 56.1, 16.2, 11.8, 1084.2, 0.58, 0.59, 2.1],
    'height_band': [0, 32.9, 48.6, 42, 79.1, 22.4, 15, 1079.7, 0.47, 0.49, 1.7],
    'all_max': [39.2, 46.9, 46.4, 45.3, 75.6, 44, 11.8, 1084.2, 0.42, 0.39, 6.4],
  },
  pose_fullbody: {
    'waist': [40.9, 2.3, 32.7, 23.3, 45.8, 30.7, 12.9, 272.1, 0.73, 0.76, 2.2],
    'slim': [40.8, 5.3, 30.7, 22.7, 52.7, 34.5, 29.4, 269.5, 0.55, 0.66, 3.1],
    'slim+waist': [78.2, 7.8, 55.6, 41.6, 72.3, 51, 27.5, 311.2, 0.5, 0.53, 3.6],
    'slim+waist_noprotect': [77.9, 7.7, 55.6, 41.5, 72.3, 47, 27.6, 444.1, 0.5, 0.53, 4],
    'legSlim': [13.3, 1.5, 13, 9.8, 26.6, 21.1, 26.6, 206.1, 0.79, 0.8, 1.2],
    'arms': [25, 10.6, 25, 21.5, 42.1, 33.5, 19.4, 221.2, 0.57, 0.7, 3],
    'shoulder': [1.1, 19.9, 15.5, 18.5, 23.5, 13.5, 0, 247.2, 0.69, 0.69, 2],
    'head': [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0],
    'legs': [0, 16.2, 28, 20.5, 40, 16.5, 11.9, 1040.8, 0.71, 0.78, 2.2],
    'height_band': [0, 9.4, 34.6, 25.4, 30.6, 17, 15, 1040.8, 0.77, 0.81, 2.4],
    'all_max': [74.6, 19.9, 63.4, 41.1, 108.9, 34.1, 49, 1040.8, 0.44, 0.48, 4.7],
  },
  pose_fullbody_edge: {
    'waist': [42.2, 2.5, 29.1, 21.3, 44.5, 33.2, 12.5, 266.5, 0.7, 0.75, 2.6],
    'slim': [40.5, 5.3, 31.2, 23.1, 51.3, 35.7, 29.1, 269.5, 0.55, 0.64, 3.6],
    'slim+waist': [73.8, 6.9, 49.8, 37.3, 97, 53.1, 25.6, 304.4, 0.49, 0.54, 4.1],
    'slim+waist_noprotect': [73.6, 7, 49.8, 37.4, 98.4, 51.9, 25.6, 412.2, 0.5, 0.53, 4.1],
    'legSlim': [13.3, 1.5, 11.9, 9.3, 26.6, 21.1, 26.6, 206.1, 0.79, 0.8, 1.4],
    'arms': [23.4, 10, 24, 20.8, 40.3, 31.7, 19.6, 215.1, 0.57, 0.66, 1.7],
    'shoulder': [1.2, 20, 16.6, 19.4, 30.9, 15.9, 0, 252.7, 0.66, 0.66, 4.1],
    'head': [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0],
    'legs': [0, 15.6, 29.8, 29.7, 63, 12.9, 11.9, 1546.7, 0.61, 0.74, 5.3],
    'height_band': [0, 11.4, 38, 27, 52.4, 15.4, 15, 1546.7, 0.66, 0.76, 3.9],
    'all_max': [80.9, 19.4, 65.8, 42.3, 116.3, 41.8, 57.8, 1546.7, 0.5, 0.48, 10.6],
  },
  fullbody_yoga: {
    'waist': [21.7, 0.8, 16.4, 12.1, 33.6, 23.5, 0, 177.2, 0.74, 0.8, 1.6],
    'slim': [27.7, 7.7, 24.3, 21.4, 146.8, 30.4, 16.5, 181.5, 0.61, 0.63, 7.7],
    'slim+waist': [38.1, 7.7, 27.2, 21.6, 146.8, 33.7, 16.5, 185.9, 0.61, 0.63, 7.7],
    'slim+waist_noprotect': [38.1, 7.7, 27.1, 21.7, 146.8, 29.6, 16.5, 304.2, 0.61, 0.63, 7.8],
    'legSlim': [9.5, 11.4, 15.1, 13.6, 28.6, 18.9, 4.3, 160.6, 0.63, 0.7, 2],
    'arms': [0.8, 5.8, 5.3, 6.3, 18.1, 11.2, 15.9, 112, 0.7, 0.88, 2.4],
    'shoulder': [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0],
    'head': [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0],
    'legs': [0, 0, 24.6, 29.4, 11.8, 11.8, 11.8, 1319.4, 0.89, 0.89, 0.1],
    'height_band': [0, 0, 53.7, 39.5, 15, 15, 15, 1319.4, 0.87, 0.87, 0.1],
    'all_max': [29, 13.8, 35.4, 34.9, 63.3, 23.8, 19.1, 1319.4, 0.59, 0.59, 7.2],
  },
};

/** stage 0 (before any improvement): the yardstick of the stage-1 acceptance below */
// prettier-ignore
const STAGE0_BODY: Record<string, Record<string, BodyRow>> = {
  synth: {
    'waist': [27.7, 0, 19.9, 13.9, 19, 17.6, 19, 99.2, 0.84, 0.85, 7.2],
    'slim': [33.6, 4.3, 31.1, 21.8, 62.5, 51.7, 62.5, 172.3, 0.62, 0.63, 3.2],
    'slim+waist': [46, 4.3, 38.6, 27.7, 66.6, 59.4, 64.4, 210.4, 0.6, 0.6, 1.5],
    'slim+waist_noprotect': [46.1, 4.3, 38.8, 27.9, 67.8, 61.4, 67.8, 280.7, 0.6, 0.61, 1.4],
    'legSlim': [28.6, 0.7, 27, 19.6, 77.4, 77, 76.8, 103, 0.56, 0.61, 1.9],
    'arms': [26.1, 9, 24.9, 21.2, 100.6, 99.1, 15.7, 68.5, 0.5, 0.53, 2],
    'shoulder': [0, 8.8, 6.8, 8.5, 10.1, 9, 0, 78.2, 0.84, 0.86, 2.8],
    'head': [15.4, 30.5, 26.4, 30.4, 69.3, 58.4, 0, 176.7, 0.63, 0.67, 9.6],
    'legs': [0, 12.3, 27.4, 20.3, 35.3, 15.7, 15, 1084.2, 0.74, 0.78, 10.4],
    'height_band': [0, 9, 35.8, 25.7, 43.2, 17.7, 18.8, 1079.7, 0.7, 0.73, 12.8],
    'all_max': [47.6, 45.6, 51.6, 46.6, 155.1, 72.7, 74.6, 1084.2, 0.39, 0.41, 4],
  },
  synth_armsdown: {
    'waist': [9.2, 0, 7.8, 5.5, 23, 22.9, 0, 71.7, 0.82, 0.84, 1.7],
    'slim': [27.3, 0.9, 23.5, 16.5, 60.8, 55.5, 0, 143.4, 0.62, 0.67, 3.5],
    'slim+waist': [33.8, 0.9, 29.3, 21.1, 100.4, 93.7, 0, 156.8, 0.5, 0.52, 2.9],
    'slim+waist_noprotect': [33.7, 0.9, 29.3, 21.1, 94.5, 85.4, 0, 228.5, 0.52, 0.53, 1.3],
    'legSlim': [30.8, 0.7, 26.9, 19.2, 77.4, 73, 0, 103, 0.56, 0.61, 1.6],
    'arms': [26.6, 2, 21.2, 15.7, 102.7, 101.8, 0, 68.2, 0.49, 0.53, 2],
    'shoulder': [0, 8.8, 6.8, 8.5, 10.1, 9, 0, 78.2, 0.84, 0.86, 2.8],
    'head': [13.8, 30.5, 26.6, 30.4, 69.3, 58.4, 0, 176.7, 0.63, 0.67, 9.6],
    'legs': [0, 31.8, 39.1, 34.7, 71.1, 16.8, 11.8, 1084.2, 0.58, 0.59, 6.6],
    'height_band': [0, 41.5, 53.2, 48.1, 106.1, 24.1, 15, 1079.7, 0.47, 0.49, 4.4],
    'all_max': [38.6, 45.6, 46.4, 46.5, 167, 69.7, 11.8, 1084.2, 0.37, 0.39, 4],
  },
  pose_fullbody: {
    'waist': [41, 2.3, 32.7, 23.3, 41.7, 37.5, 14.2, 214.4, 0.71, 0.76, 3.1],
    'slim': [41.5, 5.3, 31, 22.9, 84.4, 50.5, 29.4, 197.1, 0.53, 0.57, 6.2],
    'slim+waist': [78.5, 7.8, 55.6, 41.9, 88.4, 60.9, 27.6, 300.5, 0.5, 0.53, 1.8],
    'slim+waist_noprotect': [78.4, 7.7, 55.6, 41.9, 88.4, 60.8, 27.6, 315.8, 0.5, 0.53, 1.8],
    'legSlim': [14.5, 1.6, 13.2, 9.9, 40.6, 35.7, 29.5, 90.7, 0.71, 0.79, 3.3],
    'arms': [25.8, 11, 25.5, 22.2, 105.3, 101.9, 19.4, 86.2, 0.48, 0.52, 2.3],
    'shoulder': [1.4, 26.2, 20.4, 24, 34.5, 29.7, 0, 142.9, 0.69, 0.69, 6],
    'head': [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0],
    'legs': [0, 19.6, 27.6, 20.5, 75.6, 15.4, 11.9, 1040.8, 0.57, 0.67, 7.5],
    'height_band': [0, 12.4, 34.4, 25.4, 58.1, 15, 15, 1040.8, 0.63, 0.71, 8.7],
    'all_max': [75.7, 26, 63.6, 41.3, 114.8, 52.6, 49, 1040.8, 0.44, 0.48, 2.1],
  },
  // the shifted pose_fullbody (scenes()) measured on the stage-0 field.ts of 3527803
  pose_fullbody_edge: {
    'waist': [42.2, 2.5, 29, 21.3, 43.2, 35.8, 14, 213, 0.7, 0.74, 2.7],
    'slim': [41.2, 5.4, 31.4, 23.2, 97.7, 53.6, 29.1, 197, 0.49, 0.5, 7.1],
    'slim+waist': [74.2, 7.2, 49.6, 36.7, 104.6, 65.4, 25.6, 288, 0.47, 0.49, 4.2],
    'slim+waist_noprotect': [74.1, 7.2, 49.6, 36.7, 104.6, 69.1, 25.6, 306.2, 0.47, 0.49, 4.2],
    'legSlim': [14.5, 1.5, 12.5, 9.6, 40.5, 35.6, 29.5, 92.2, 0.71, 0.79, 3.7],
    'arms': [24.2, 10.4, 24.4, 21.2, 104, 100.8, 19.6, 85.1, 0.49, 0.52, 1.9],
    'shoulder': [1.6, 26.2, 21.3, 24.8, 39, 33.4, 0, 152.6, 0.66, 0.66, 4.5],
    'head': [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0],
    'legs': [0, 16.9, 29.8, 30.4, 63.8, 11.9, 11.9, 1546.7, 0.61, 0.74, 5.3],
    'height_band': [0, 12.3, 38, 27, 52.7, 15, 15, 1546.7, 0.66, 0.76, 4],
    'all_max': [82, 25, 65.9, 42.6, 148.4, 58.2, 57.8, 1546.7, 0.43, 0.44, 4.3],
  },
  fullbody_yoga: {
    'waist': [22.1, 0.8, 16.4, 12.1, 43.4, 41.1, 0, 114.2, 0.7, 0.76, 3.4],
    'slim': [28.9, 8, 24.7, 20.3, 156.2, 79, 23.6, 143.4, 0.55, 0.56, 3.7],
    'slim+waist': [38.1, 8, 27.5, 20.7, 156.1, 77.5, 23.6, 147.8, 0.55, 0.56, 3.7],
    'slim+waist_noprotect': [38.1, 8, 27.3, 20.6, 156.1, 76.6, 23.6, 188.6, 0.55, 0.56, 3.7],
    'legSlim': [9.9, 11.9, 15.1, 14.3, 64.3, 62.2, 0, 60.9, 0.59, 0.63, 1.9],
    'arms': [0.9, 5.8, 5.8, 6.9, 72.9, 70.3, 34.5, 40.3, 0.58, 0.74, 2.3],
    'shoulder': [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0],
    'head': [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0],
    'legs': [0, 0, 24.6, 29.4, 11.8, 11.8, 11.8, 1319.4, 0.89, 0.89, 0.1],
    'height_band': [0, 0, 53.7, 39.5, 15, 15, 15, 1319.4, 0.87, 0.87, 0.1],
    'all_max': [29, 14.4, 36, 35.2, 104.1, 43.2, 33.2, 1319.4, 0.5, 0.51, 3.6],
  },
};

/** synthetic doorClose (scene `synth`): bend of the door lines 0.25 / 0.5 / 1 / 2 W outside the waist (max of L, R) */
// prettier-ignore
const DOOR: Record<string, [number, number, number, number]> = {
  'waist': [14.8, 23.9, 10.1, 2.1],
  'slim': [7.5, 16.8, 14.1, 9.1],
  'slim+waist': [16.6, 39.3, 22.4, 9.5],
  'arms': [0.5, 1.5, 25.7, 4.5],
};
// prettier-ignore
const STAGE0_DOOR: Record<string, [number, number, number, number]> = {
  'waist': [15.6, 24.2, 10.7, 0.8],
  'slim': [7.9, 16.3, 23, 9.6],
  'slim+waist': [16.7, 39.6, 28, 10.6],
  'arms': [0, 0.8, 25.9, 4.4],
};

// 瘦臉: [nearOval %FW, ovalReach %FW, bgMax %FW, bgReach %FW, bendV %FW] on sample_face, plus, on the synthetic
// cheek-wall portrait, the wall lines' bends (px @ 4032) 0.02 / 0.05 / 0.1 / 0.2 / 0.4 FW outside the cheek and the
// mouth / jaw horizontals
type FaceRow = [number, number, number, number, number];
const FACE_COLS = ['nearOval', 'ovalReach', 'bgMax', 'bgReach', 'bendV'] as const;
// prettier-ignore
const FACE: Record<string, FaceRow> = {
  'faceSlim': [14.2, 60, 2.9, 13, 0.72],
  'faceV': [10.3, 52, 0.5, 9, 0.1],
  'faceNarrow': [10.1, 48, 3.8, 16, 1.01],
  'slim+V+narrow': [22.5, 60, 6, 16, 1.65],
};
// prettier-ignore
const WALL: Record<string, [number, number, number, number, number, number, number]> = {
  'faceSlim': [89.5, 88.1, 77.8, 60.4, 22.7, 40.2, 47.4],
  'faceV': [73.6, 68.7, 57.7, 30.2, 3.1, 6.7, 8.2],
  'faceNarrow': [66.4, 80, 73.9, 64.2, 28.6, 6.7, 8.1],
  'slim+V+narrow': [162.3, 159.1, 147.4, 126.9, 51.1, 37.9, 47.2],
};

// 瘦臉 with the background limit (FaceProtect: the editor's path whenever a person mask exists), same columns, on
// sample_face, on sample_wall (sample_face's face against a wall, faceScenes.node.ts) and on the portrait's wall lines.
// measured 2026-10-08 (sample_face: the hair is person, the wall is never reached, so the limit changes nothing)
// prettier-ignore
const FACE_LIMITED: Record<string, Record<string, FaceRow>> = {
  sample_face: {
    'faceSlim': [14.2, 60, 2.9, 13, 0.72],
    'faceV': [10.3, 52, 0.5, 9, 0.1],
    'faceNarrow': [10.1, 48, 3.8, 16, 1.01],
    'slim+V+narrow': [22.5, 60, 6, 16, 1.65],
  },
  sample_wall: {
    'faceSlim': [12, 58, 11.3, 33, 8.97],
    'faceV': [10.1, 47, 10.1, 32, 6.59],
    'faceNarrow': [10, 43, 9.9, 33, 6.41],
    'slim+V+narrow': [13.2, 58, 12.5, 33, 13.28],
  },
};
// prettier-ignore
const WALL_LIMITED: Record<string, [number, number, number, number, number, number, number]> = {
  'faceSlim': [92.1, 92.5, 83.2, 64.1, 0, 47.1, 54.5],
  'faceV': [74.5, 70.7, 61.1, 30.8, 0, 7.6, 9.1],
  'faceNarrow': [66.7, 80.4, 74.5, 65.8, 0, 7.5, 8.9],
  'slim+V+narrow': [170.3, 165.2, 143.7, 104.3, 0, 50, 59.1],
};
/**
 * Where the limited warp measures worse than the unlimited one by more than the column's tolerance (checked on the
 * measured values; key `<scene> <case> <column>`). All have one cause (report: 臉頰旁的直線彎曲仍受同樣的 Δ⊥ 限制): the
 * limit shortens how far the cheek's displacement reaches, not how large it is at the cheek, so the same Δ⊥ becomes a
 * tighter bump over a shorter run, and a line's straight fit absorbs less of it.
 */
const SHORTER_RUN = 'the same Δ⊥ over a shorter run';
const FACE_LIMIT_MISSES: Record<string, string> = {
  'sample_wall faceV bendV': `6.23 → 6.59 % FW: the far jaw against the wall keeps its V臉; ${SHORTER_RUN}`,
  'sample_wall faceNarrow bendV': `6.08 → 6.41 % FW: as faceV`,
  'portrait faceSlim wall+0.02FW': `89.5 → 92.1 px: ${SHORTER_RUN}`,
  'portrait faceSlim wall+0.05FW': `88.1 → 92.5 px: ${SHORTER_RUN}`,
  'portrait faceSlim wall+0.1FW': `77.8 → 83.2 px: ${SHORTER_RUN} (along the line the reach shrinks most where it nears the jaw)`,
  'portrait faceSlim wall+0.2FW': `60.4 → 64.1 px: as 0.1 FW`,
  'portrait faceSlim wall-h mouth': `40.2 → 47.1 px: the horizontal crosses the cheek; ${SHORTER_RUN}`,
  'portrait faceSlim wall-h jaw': `47.4 → 54.5 px: as mouth`,
  'portrait faceV wall+0.05FW': `68.7 → 70.7 px: ${SHORTER_RUN}`,
  'portrait faceV wall+0.1FW': `57.7 → 61.1 px: as faceSlim`,
  'portrait faceNarrow wall+0.2FW': `64.2 → 65.8 px: as faceSlim`,
  'portrait slim+V+narrow wall+0.02FW': `162.3 → 170.3 px: ${SHORTER_RUN} (the 0.1 / 0.2 / 0.4 FW lines gain: 147 → 144, 127 → 104, 51 → 0)`,
  'portrait slim+V+narrow wall+0.05FW': `159.1 → 165.2 px: as 0.02 FW`,
  'portrait slim+V+narrow wall-h mouth': `37.9 → 50 px: as faceSlim`,
  'portrait slim+V+narrow wall-h jaw': `47.2 → 59.1 px: as faceSlim`,
};

/**
 * True while BODY still holds the stage-0 baseline: the measurement must then also reproduce the research report's
 * tables (±5 %), proving the metric is the one the report used. Set to false when the first improvement lands.
 */
const STAGE0 = false;
// reports/美體修圖 背景扭曲 抑制技術.md (synth / pose_fullbody columns), scratch exp.ts: [bendV, bendH, bendD45, stretchMax, ringPx, minDet]
// prettier-ignore
const REPORT: Record<string, [number, number, number, number, number, number]> = {
  'synth/waist': [27.7, 0, 19.9, 19, 99, 0.84], 'pose_fullbody/waist': [41.0, 2.3, 32.7, 42, 214, 0.71],
  'synth/slim': [33.6, 4.3, 31.1, 62.5, 172, 0.62], 'pose_fullbody/slim': [41.5, 5.3, 31.0, 84, 197, 0.53],
  'synth/slim+waist': [46.0, 4.3, 38.6, 66.6, 210, 0.6], 'pose_fullbody/slim+waist': [78.5, 7.8, 55.6, 88.4, 300, 0.5],
  'synth/slim+waist_noprotect': [46.1, 4.3, 38.8, 67.8, 281, 0.6], 'pose_fullbody/slim+waist_noprotect': [78.4, 7.7, 55.6, 88.4, 316, 0.5],
  'synth/legSlim': [28.6, 0.7, 27, 77, 103, 0.56], 'pose_fullbody/legSlim': [14.5, 1.6, 13.2, 41, 91, 0.71],
  'synth/arms': [26.1, 9, 24.9, 101, 68, 0.5], 'pose_fullbody/arms': [25.8, 11, 25.5, 105, 86, 0.48],
  'synth/shoulder': [0, 8.8, 6.8, 10, 78, 0.84], 'pose_fullbody/shoulder': [1.4, 26.2, 20.4, 35, 143, 0.69],
  'synth/head': [15.4, 30.5, 26.4, 69, 177, 0.63],
  'synth/legs': [0, 12.3, 27.4, 35, NaN, 0.74], 'pose_fullbody/legs': [0, 19.6, 27.6, 76, NaN, 0.57],
  'synth/height_band': [0, 9, 35.8, 43, NaN, 0.7], 'pose_fullbody/height_band': [0, 12.4, 34.4, 58, NaN, 0.63],
  'synth/all_max': [47.6, 45.6, 51.6, 155, NaN, 0.39], 'pose_fullbody/all_max': [75.7, 26, 63.6, 115, NaN, 0.44],
};
/** the report's rounding per REPORT column (bends to 0.1 px, stretch / ring to integers, det to 0.01) */
const REPORT_ROUNDING = [0.15, 0.15, 0.15, 0.6, 0.6, 0.005];
// 瘦臉 on sample_face: [within 5 % FW outside the oval, reach beyond the oval] (% FW)
// prettier-ignore
const REPORT_FACE: Record<string, [number, number]> = {
  faceSlim: [14.2, 60], faceV: [10.3, 52], faceNarrow: [10.1, 48], 'slim+V+narrow': [22.5, 60],
};

// ───────────────────────── stage-1 acceptance ─────────────────────────

/**
 * Stage 1 (report §四階段路線 ① ③) against STAGE0_BODY / STAGE0_DOOR, checked on the measured values. Every case
 * except the full-width bands (legs, height_band: no local part to relax): stretch p99 ≤ 0.6× stage 0; a single
 * slider's stretchMax ≤ 70 %; minDet ≥ max(stage 0, 0.45); no bend family (and no door line) worse than stage 0 by
 * more than 1 px; and with 背景保護 on, the ring at most 0.8× the ring with it off (slim+waist). The keys below are the
 * measured misses, each with where the remaining stretch / fold / bend sits; relax.ts never moves a person texel,
 * so stretch that the person's own field carries up to the silhouette stays.
 */
const STAGE1_MISSES: Record<string, string> = {
  'synth/slim p99': '0.62× (31.9 vs 51.7 %): the narrow hand–hip gap keeps its original field',
  'synth_armsdown/all_max p99': '0.63×: beside the hanging arms, where the carried torso ring and the arm rings meet',
  'pose_fullbody/waist p99': '0.82×: the fixture holds both arms against the torso; the torso ring carries them and the arm / forearm–flank corner shears inside the person',
  'pose_fullbody/slim p99': '0.68×: as waist',
  'pose_fullbody/slim+waist p99': '0.84×: as waist',
  'pose_fullbody/slim+waist_noprotect p99': '0.77×: as waist',
  'pose_fullbody/all_max p99': '0.65×: as waist',
  'pose_fullbody_edge/waist p99': '0.93× (33.2 vs 35.8 %): as pose_fullbody/waist',
  'pose_fullbody_edge/slim p99': '0.67×: as pose_fullbody',
  'pose_fullbody_edge/slim+waist p99': '0.81×: as pose_fullbody',
  'pose_fullbody_edge/slim+waist_noprotect p99': '0.75×: as pose_fullbody',
  'pose_fullbody_edge/all_max p99': '0.72×: as pose_fullbody',
  'fullbody_yoga/slim stretchMax': '147 % (stage 0: 156 %): the front thigh is sheared inside the person where the torso ring ends; the background beside it follows',
  'synth_armsdown/all_max minDet': '0.42 (stage 0: 0.37): the worst cell is inside the person (hips, every slider at max)',
  'pose_fullbody/all_max minDet': '0.44 (= stage 0): the worst cell is inside the person',
  'synth/all_max bendH': '+1.3 px: the relaxed ring is wider, so a horizontal just past the old ring bends a little',
  'synth_armsdown/all_max bendH': '+1.3 px: as synth',
  'fullbody_yoga/slim bendD30': '+1.1 px: the relaxed background above the front thigh now follows it (stage 0 left it, at 156 % stretch)',
  'fullbody_yoga/slim+waist_noprotect bendD30': '+1.1 px: as slim',
  'door waist 2W': '+1.3 px: the 2W door line is past the old ring, inside the relaxed one (the 1W line drops 0.6 px, slim+waist 5.6 px)',
};
const SINGLE_SLIDERS = new Set(['waist', 'slim', 'legSlim', 'arms', 'shoulder', 'head']);

/** the stage-1 acceptance misses of one case, as STAGE1_MISSES keys */
function stage1Misses(where: string, name: string, got: BodyRow): string[] {
  const s0 = STAGE0_BODY[where.split('/')[0]]?.[name];
  if (!s0 || name === 'legs' || name === 'height_band') return [];
  const miss: string[] = [];
  if (s0[5] > 0 && got[5] > 0.6 * s0[5] + 0.05) miss.push(`${where} p99`);
  if (SINGLE_SLIDERS.has(name) && got[4] > 70) miss.push(`${where} stretchMax`);
  if (got[8] < Math.min(Math.max(s0[8], 0.45), 1) - 0.005) miss.push(`${where} minDet`);
  for (let k = 0; k < 4; k++) if (got[k] > s0[k] + 1) miss.push(`${where} ${BODY_COLS[k]}`);
  return miss;
}

// ───────────────────────── scenes and cases ─────────────────────────

const ALL: ParamId[] = ['body.legs', 'body.slim', 'body.waist', 'body.whr', 'body.legSlim', 'body.arms', 'body.shoulder', 'body.neck', 'body.head'];
const CASES: Record<string, (p: BeautyParams) => BeautyParams> = {
  waist: (p) => setParam(p, 'body.waist', 1),
  slim: (p) => setParam(p, 'body.slim', 1),
  'slim+waist': (p) => setParam(setParam(p, 'body.waist', 1), 'body.slim', 1),
  'slim+waist_noprotect': (p) => setBodyProtect(setParam(setParam(p, 'body.waist', 1), 'body.slim', 1), false),
  legSlim: (p) => setParam(p, 'body.legSlim', 1),
  arms: (p) => setParam(p, 'body.arms', 1),
  shoulder: (p) => setParam(p, 'body.shoulder', 1),
  head: (p) => setParam(p, 'body.head', 1),
  legs: (p) => setParam(p, 'body.legs', 1),
  height_band: (p) => setHeightBand(p, { top: 0.55, bottom: 0.85, amount: 1 }),
  all_max: (p) => setParam(
    ALL.reduce((q, id) => setParam(q, id, 1), p),
    'body.hip',
    1,
  ),
};
/** full-width bands move the far background by design (no farMovePx = 0 invariant) */
const BANDS = new Set(['legs', 'height_band', 'all_max']);

interface Scene {
  name: string;
  det: BodyDetection;
  face: Face | null;
  an: () => Analysis;
  aspect: number;
}

function scenes(): Scene[] {
  const out: Scene[] = [];
  for (const armsDown of [false, true]) {
    const f = syntheticFigure({ armsDown });
    let an: Analysis | null = null;
    out.push({ name: armsDown ? 'synth_armsdown' : 'synth', det: f.det, face: f.face, an: () => (an ??= analysisGrid(f.inside, f.width, f.height)), aspect: f.width / f.height });
  }
  for (const [name, file] of [
    ['pose_fullbody', 'pose_fullbody.json'],
    ['fullbody_yoga', 'fullbody_yoga.pose.json'],
  ]) {
    const det = loadPoseFixture(file);
    if (!det?.mask) continue;
    // the report's analysis grid: 900 px long edge
    const s = 900 / Math.max(det.width, det.height);
    const AW = Math.round(det.width * s);
    const AH = Math.round(det.height * s);
    let an: Analysis | null = null;
    out.push({ name, det, face: null, an: () => (an ??= analysisGrid(maskInside(det.mask!), AW, AH)), aspect: AW / AH });
    if (name !== 'pose_fullbody') continue;
    // the same person moved towards the left frame edge (the hanging hand runs off the frame, the torso is about
    // 0.1 H from the edge): the relaxed ring must not be carried out to the edge, where keepInFrame (field.ts)
    // squeezes it. Its STAGE0_BODY row is the same shift measured on the stage-0 field.ts (3527803).
    const edge = shiftLeft(det, 0.2);
    let anE: Analysis | null = null;
    out.push({ name: 'pose_fullbody_edge', det: edge, face: null, an: () => (anE ??= analysisGrid(maskInside(edge.mask!), AW, AH)), aspect: AW / AH });
  }
  return out;
}

/**
 * A detection with the person (keypoints and mask) moved left by `dx` (normalized x): what leaves the frame is cut
 * off, the vacated strip on the right is background.
 */
function shiftLeft(det: BodyDetection, dx: number): BodyDetection {
  const points = Float32Array.from(det.pose.points);
  for (let i = 0; i < points.length; i += 4) points[i] -= dx;
  const m = det.mask!;
  const sx = Math.round(dx * m.width);
  const data = new Uint8Array(m.width * m.height);
  for (let y = 0; y < m.height; y++) for (let x = 0; x + sx < m.width; x++) data[y * m.width + x] = m.data[y * m.width + x + sx];
  return { ...det, pose: { points }, mask: { width: m.width, height: m.height, data } };
}

const PRINT = !!process.env.STRAIGHTNESS_PRINT;
const printed: string[] = [];
const fmt = (xs: readonly number[]) => `[${xs.map((x) => +x.toFixed(2)).join(', ')}]`;

// ───────────────────────── body ─────────────────────────

describe('straightness ratchet: 美體 fields', () => {
  for (const sc of scenes()) {
    it(`${sc.name}: every slider stays at least as straight / unstretched as recorded; invariants hold`, () => {
      const m = measureBody(sc.det, sc.face);
      const an = sc.an();
      const lines: string[] = [];
      const rings: Record<string, number> = {};
      const misses: string[] = [];
      for (const [name, set] of Object.entries(CASES)) {
        const p = set(defaultParams());
        const commit = buildBodyField(m, p, sc.aspect);
        const draft = buildBodyField(m, p, sc.aspect, null, 128);
        const r = bodyMetrics(an, commit);
        const minDet128 = draft ? +fieldMinJacobian(draft).toFixed(2) : 1;
        const got: BodyRow = [r.bendV, r.bendH, r.bendD45, r.bendD30, r.stretchMax, r.stretchP99, r.gapStretch, r.ringPx, r.minDet, minDet128, draftJumpPx(an, draft, commit)];
        lines.push(`    '${name}': ${fmt(got)},`);
        const where = `${sc.name}/${name}`;
        rings[name] = r.ringPx;
        misses.push(...stage1Misses(where, name, got));

        // invariants (every returned field, drafts too)
        if (commit) expect(fieldMinJacobian(commit), where).toBeGreaterThanOrEqual(MIN_DET);
        if (draft) expect(fieldMinJacobian(draft), `${where} draft`).toBeGreaterThanOrEqual(MIN_DET);
        expect(r.outsidePx, `${where}: samples outside the frame`).toBe(0);
        if (!BANDS.has(name)) expect(r.farMovePx, `${where}: far background moved`).toBe(0);

        if (STAGE0 && REPORT[where]) {
          const rep = REPORT[where];
          const mine = [r.bendV, r.bendH, r.bendD45, r.stretchMax, r.ringPx, r.minDet];
          rep.forEach((x, k) => {
            if (Number.isNaN(x)) return;
            // ±5 %, with an absolute floor for the report's rounding (integers / one decimal)
            expect(Math.abs(mine[k] - x), `${where} vs report col ${k}: ${mine[k]} vs ${x}`).toBeLessThanOrEqual(Math.max(0.05 * x, REPORT_ROUNDING[k]));
          });
        }

        const base = BODY[sc.name]?.[name];
        if (PRINT || !base) continue;
        BODY_COLS.forEach((col, k) => {
          const msg = `${where} ${col}: ${got[k]} vs recorded ${base[k]}`;
          if (col.startsWith('bend')) expect(got[k], msg).toBeLessThanOrEqual(base[k] + TOL.bend);
          else if (col.endsWith('Stretch') || col.startsWith('stretch')) expect(got[k], msg).toBeLessThanOrEqual(base[k] + TOL.stretch);
          else if (col === 'ringPx') expect(got[k], msg).toBeLessThanOrEqual(base[k] * (1 + TOL.ring) + 0.5);
          else if (col.startsWith('minDet')) expect(got[k], msg).toBeGreaterThanOrEqual(base[k] - TOL.minDet);
          else expect(got[k], msg).toBeLessThanOrEqual(base[k] + TOL.draftJump);
        });
      }
      // stage-1 acceptance: 背景保護 has a measurable effect, and nothing misses beyond the documented cases
      if (rings['slim+waist'] > 0.8 * rings['slim+waist_noprotect']) misses.push(`${sc.name} ring on/off`);
      for (const k of misses) expect(STAGE1_MISSES[k], `stage-1 acceptance: ${k}`).toBeDefined();
      if (PRINT) printed.push(`  ${sc.name}: {\n${lines.join('\n')}\n  },`);
      else expect(Object.keys(BODY[sc.name] ?? {}), `${sc.name}: record every case in BODY`).toEqual(Object.keys(CASES));
    });
  }

  it('synthetic doorClose: per-line bends of the door frames stay as recorded', () => {
    const f = syntheticFigure();
    const an = analysisGrid(f.inside, f.width, f.height);
    const m = measureBody(f.det, f.face);
    const ls = f.lines('doorClose');
    expect(ls).toHaveLength(8);
    const lines: string[] = [];
    for (const name of ['waist', 'slim', 'slim+waist', 'arms']) {
      const map = fieldMap(buildBodyField(m, CASES[name](defaultParams()), f.width / f.height));
      const got = [0.25, 0.5, 1, 2].map((k) =>
        +Math.max(...ls.filter((l) => l.tag.startsWith(`door+${k}W`)).map((l) => segmentBend(an, map, l.a, l.b))).toFixed(1),
      ) as [number, number, number, number];
      lines.push(`  '${name}': ${fmt(got)},`);
      got.forEach((g, k) => {
        const key = `door ${name} ${[0.25, 0.5, 1, 2][k]}W`;
        if (g > STAGE0_DOOR[name][k] + 1) expect(STAGE1_MISSES[key], `stage-1 acceptance: ${key} ${g} vs ${STAGE0_DOOR[name][k]}`).toBeDefined();
      });
      const base = DOOR[name];
      if (PRINT) continue;
      expect(base, `record ${name} in DOOR`).toBeDefined();
      got.forEach((g, k) => expect(g, `doorClose ${name} line ${k}`).toBeLessThanOrEqual(base[k] + TOL.bend));
    }
    if (PRINT) printed.push(`DOOR\n${lines.join('\n')}`);
  });
});

// ───────────────────────── 瘦臉 ─────────────────────────

const FACE_CASES: Record<string, ParamId[]> = {
  faceSlim: ['shape.faceSlim'],
  faceV: ['shape.faceV'],
  faceNarrow: ['shape.faceNarrow'],
  'slim+V+narrow': ['shape.faceSlim', 'shape.faceV', 'shape.faceNarrow'],
};
const faceParams = (ids: ParamId[]) => ids.reduce((p, id) => setParam(p, id, 1), defaultParams()).values;

describe('straightness ratchet: 瘦臉 (CPU port of the reshape shader)', () => {
  it('sample_face: displacement next to the oval and its reach stay as recorded', () => {
    const lm = JSON.parse(readFileSync(new URL('../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as { width: number; height: number; points: number[] };
    const det = loadPoseFixture('sample_face.pose.json');
    expect(det?.mask).toBeTruthy();
    const face = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
    const lines: string[] = [];
    for (const [name, ids] of Object.entries(FACE_CASES)) {
      const map = reshapeMapCpu(face, reshapeUniforms(faceParams(ids), 1), lm.width / lm.height);
      const r = faceMetrics(face, lm.width, lm.height, map, maskInside(det!.mask!));
      const got: FaceRow = [r.nearOvalPctFW, r.ovalReachPctFW, r.bgMaxPctFW, r.bgReachPctFW, r.bendVPctFW];
      lines.push(`  '${name}': ${fmt(got)},`);
      if (STAGE0) {
        const rep = REPORT_FACE[name];
        expect(Math.abs(got[0] - rep[0]), `${name} near-oval vs report`).toBeLessThanOrEqual(0.05 * rep[0]);
        expect(Math.abs(got[1] - rep[1]), `${name} reach vs report`).toBeLessThanOrEqual(0.05 * rep[1]);
      }
      const base = FACE[name];
      if (PRINT) continue;
      expect(base, `record ${name} in FACE`).toBeDefined();
      // bendV is in % FW too: TOL.bend px @ 4032 converted
      const bendTol = (100 * TOL.bend * (Math.max(lm.width, lm.height) / REF_EDGE)) / r.fwPx;
      got.forEach((g, k) => expect(g, `sample_face ${name} col ${k}`).toBeLessThanOrEqual(base[k] + (k === 4 ? bendTol : TOL.face)));
    }
    if (PRINT) printed.push(`FACE\n${lines.join('\n')}`);
  });

  it('cheek-against-a-wall portrait (no hair): wall lines next to the cheek stay as recorded', () => {
    const pr = syntheticPortrait();
    const an = analysisGrid(pr.inside, pr.width, pr.height);
    const lines: string[] = [];
    for (const [name, ids] of Object.entries(FACE_CASES)) {
      const map = reshapeMapCpu(pr.face, reshapeUniforms(faceParams(ids), 1), pr.width / pr.height);
      const bend = (tag: string) => +Math.max(...pr.lines.filter((l) => l.tag.startsWith(tag)).map((l) => segmentBend(an, map, l.a, l.b))).toFixed(1);
      const got = [...[0.02, 0.05, 0.1, 0.2, 0.4].map((k) => bend(`wall+${k}FW`)), bend('wall-h mouth'), bend('wall-h jaw')] as [number, number, number, number, number, number, number];
      lines.push(`  '${name}': ${fmt(got)},`);
      const base = WALL[name];
      if (PRINT) continue;
      expect(base, `record ${name} in WALL`).toBeDefined();
      got.forEach((g, k) => expect(g, `portrait ${name} line ${k}`).toBeLessThanOrEqual(base[k] + TOL.bend));
    }
    if (PRINT) printed.push(`WALL\n${lines.join('\n')}`);
  });

  for (const scene of [sampleFaceScene, sampleWallScene]) {
    const sc = scene();
    it(`${sc.name} with the background limit (the editor path): stays as recorded, and no worse than unlimited`, () => {
      const aspect = sc.width / sc.height;
      const lines: string[] = [];
      const misses: string[] = [];
      for (const [name, ids] of Object.entries(FACE_CASES)) {
        const u = reshapeUniforms(faceParams(ids), 1);
        const free = faceMetrics(sc.face, sc.width, sc.height, reshapeMapCpu(sc.face, u, aspect), sc.inside);
        const r = faceMetrics(sc.face, sc.width, sc.height, reshapeMapCpu(sc.face, u, aspect, null, sc.protect), sc.inside);
        const row = (m: typeof r): FaceRow => [m.nearOvalPctFW, m.ovalReachPctFW, m.bgMaxPctFW, m.bgReachPctFW, m.bendVPctFW];
        const got = row(r);
        const today = row(free);
        lines.push(`    '${name}': ${fmt(got)},`);
        // bendV is in % FW: TOL.bend px @ 4032 converted
        const bendTol = (100 * TOL.bend * (Math.max(sc.width, sc.height) / REF_EDGE)) / r.fwPx;
        const tol = (k: number) => (k === 4 ? bendTol : TOL.face);
        got.forEach((g, k) => {
          if (g > today[k] + tol(k)) misses.push(`${sc.name} ${name} ${FACE_COLS[k]}|${today[k]} → ${g}`);
        });
        const base = FACE_LIMITED[sc.name]?.[name];
        if (PRINT) continue;
        expect(base, `record ${sc.name} ${name} in FACE_LIMITED`).toBeDefined();
        got.forEach((g, k) => expect(g, `${sc.name} limited ${name} ${FACE_COLS[k]}`).toBeLessThanOrEqual(base[k] + tol(k)));
      }
      if (PRINT) printed.push(`FACE_LIMITED\n  ${sc.name}: {\n${lines.join('\n')}\n  },\n  misses: ${misses.join(', ')}`);
      else for (const m of misses) expect(FACE_LIMIT_MISSES[m.split('|')[0]], `limited worse than unlimited: ${m}`).toBeDefined();
    });
  }

  it('portrait with the background limit (the editor path): the wall lines stay as recorded, and no worse than unlimited', () => {
    const pr = syntheticPortrait();
    const sc = portraitScene();
    const an = analysisGrid(pr.inside, pr.width, pr.height);
    const aspect = pr.width / pr.height;
    const lines: string[] = [];
    const misses: string[] = [];
    const tags = [...[0.02, 0.05, 0.1, 0.2, 0.4].map((k) => `wall+${k}FW`), 'wall-h mouth', 'wall-h jaw'];
    for (const [name, ids] of Object.entries(FACE_CASES)) {
      const u = reshapeUniforms(faceParams(ids), 1);
      const free = reshapeMapCpu(pr.face, u, aspect);
      const lim = reshapeMapCpu(pr.face, u, aspect, null, sc.protect);
      const bend = (map: typeof lim, tag: string) => +Math.max(...pr.lines.filter((l) => l.tag.startsWith(tag)).map((l) => segmentBend(an, map, l.a, l.b))).toFixed(1);
      const got = tags.map((t) => bend(lim, t)) as [number, number, number, number, number, number, number];
      const today = tags.map((t) => bend(free, t));
      lines.push(`  '${name}': ${fmt(got)},`);
      got.forEach((g, k) => {
        if (g > today[k] + TOL.bend) misses.push(`portrait ${name} ${tags[k]}|${today[k]} → ${g}`);
      });
      const base = WALL_LIMITED[name];
      if (PRINT) continue;
      expect(base, `record ${name} in WALL_LIMITED`).toBeDefined();
      got.forEach((g, k) => expect(g, `portrait limited ${name} ${tags[k]}`).toBeLessThanOrEqual(base[k] + TOL.bend));
    }
    if (PRINT) printed.push(`WALL_LIMITED\n${lines.join('\n')}\n  misses: ${misses.join(', ')}`);
    else for (const m of misses) expect(FACE_LIMIT_MISSES[m.split('|')[0]], `limited worse than unlimited: ${m}`).toBeDefined();
  });
});

if (PRINT)
  describe('print', () => {
    it('measured tables', () => {
      console.log(printed.join('\n'));
    });
  });
