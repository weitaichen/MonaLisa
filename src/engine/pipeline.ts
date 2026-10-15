// Pass order, skip rules and buffer management (RB §2.2, spec §5):
//   [P0 mask → RGBA8 ¼-res M (R 磨皮, G 紅潤 per face)] → [P1 makeup → A] → [P2 reshape → B (+ mask M → N)]
//   → P3 meanH → C → P4 meanV → D
//   → P5 composite + present (canvas, or the free one of A/B for capture).
// Face passes (T2) are constructed lazily the first time a frame actually needs them.
// 美體: the body field is an RG16F texture sampled as the outermost backward map of P2 (no extra FBO,
// one resample), so P2 also runs for a body-only frame and the skin mask follows via maskWarp.
// 瘦臉 background limit: an R16F person-distance grid (FaceProtect) bounds the face contour warps in P2 (photo editor
// only; the reshape pass uploads it as an array layer on version change, like the body field).
// v0.4 (S §4): every listed face (≤ MAX_RENDER_FACES) through mask, makeup and the face-table reshape, capped by its
// neighbours and the obstacles; one face is v0.3's frame.
// P5 has two programs (step 2): the base composite and the 調節 one (質感 LUT + 調節 stages), compiled on first need.
import { FACE_TABLE_CARRIER, HEAL_RING_SAMPLES } from '../config/limits';
import { IDENTITY_MAT3 } from '../geometry/view';
import type { BodyField, Face, FaceProtect, LiquifyField, PhotoParams } from '../types';
import type { AdjustUniforms } from './adjustMath';
import { createCompositePrograms, uploadAdjust } from './compositePrograms';
import {
  bindTarget,
  bindTexture,
  createFramebuffer,
  createProgram,
  createTexture,
  deleteFramebuffer,
  deleteTexture,
  drawFullscreen,
  type Framebuffer,
  type GL,
  type Program,
  resizeFramebuffer,
  setUnpackState,
  type Texture,
} from './gl/gl';
import { attenuate, capsFor, faceDrawn, WHOLE, type TableFace } from './passes/faceCap';
import { createHealPass, type HealPass } from './passes/heal';
import { createMakeupPass, makeupActive, type MakeupPass, type MakeupUniforms } from './passes/makeup';
import type { MakeupGeometry } from './passes/makeupProc';
import { createMaskPass, type MaskPass } from './passes/mask';
import { createLandmarkOverlay, type LandmarkOverlay } from './passes/overlay';
import { createReshapePass, reshapeActive, type ReshapePass, type ReshapeUniforms, type ReshapeView } from './passes/reshape';
import { createRetouchPass, createToneFieldPass, type FieldFbName, type RetouchPass, type ToneFieldPass, type ToneFieldTextures } from './passes/toneField';
import { IDENTITY_WIN, Q_CLEAR, R_CLEAR } from './passes/toneGeometry';
import { createToneMaskPass, type ToneMaskPass } from './passes/toneMask';
import { COMPOSITE_UNITS } from './shaders/composite';
import { MEAN_FS, MEAN_VS } from './shaders/mean';
import { PRESENT_FS, PRESENT_VS } from './shaders/present';
import type { ToneJob } from './toneJob';
import {
  maskBufferSize,
  meanBufferSize,
  meanStep,
  needsMean,
  presentScale,
  sharpenTexel,
  type Size,
  type SkinUniforms,
} from './uniforms';

export interface StaticLuts {
  gray: Texture;
  origin: Texture;
  skin: Texture;
  light: Texture;
}

export interface FrameFace {
  face: Face;
  /** 0..1 (live easing; 1 in the editor) */
  weight: number;
  /** × weight, not yet yaw-attenuated (tableFaces attenuates, like ReshapePass.draw did) */
  reshape: ReshapeUniforms;
  /** × weight */
  makeup: MakeupUniforms;
  /** this face's 磨皮 / 紅潤 relative to the frame maxima (skinMaxima) */
  kS: number;
  kR: number;
  /** 瘦臉 background limit (person distance); null = unlimited contour warps */
  protect: FaceProtect | null;
  /** oval-bbox centre (UV): the caps */
  centre: [number, number];
  /** camera: the track's presence easer for its neighbours' caps; 1 otherwise */
  presence: number;
}

export interface FrameJob {
  /** uploaded source (any size; sampled by UV) */
  src: Texture;
  /** processing size */
  size: Size;
  /** live tier L: half-resolution mean buffers */
  halfMean: boolean;
  /** ≤ MAX_RENDER_FACES, in table order */
  faces: FrameFace[];
  /** box centres of faces that get no effects but bound the caps */
  obstacles: readonly (readonly [number, number])[];
  /** skin-mask clear (gS, gR) */
  maskClear: [number, number];
  /** 美體 backward displacement field (UV units); null = none. Not scaled by a face weight or yaw. */
  body: BodyField | null;
  /** 推臉筆 backward field (O UV units), the outermost map of P2; null = no strokes. Not scaled by any weight. */
  liquify: LiquifyField | null;
  photo: PhotoParams;
  skin: SkinUniforms;
  /** null until the GPUPixel LUTs are uploaded (whitening is skipped meanwhile) */
  luts: StaticLuts | null;
  filterLut: Texture | null;
  /** 調節 + 質感 uniforms of this frame (adjustUniforms); `on` picks the 調節 program */
  adjust: AdjustUniforms;
  /** the resident 質感 LUT (unit 8), or null: none, or still loading (then the look is not drawn at all) */
  lookLut: Texture | null;
  matchGpupixel: boolean;
  /** 'canvas' presents (flip Y); 'fbo' renders top-row-first into a free buffer for readPixels */
  target: 'canvas' | 'fbo';
  mirror: boolean;
  /** O-normalized rect the uploaded src covers, (x, y, w, h); [0,0,1,1] for the preview */
  win: [number, number, number, number];
  /** V-normalized rect the V buffers cover; [0,0,1,1] for the preview */
  tile: [number, number, number, number];
  /** V → O, column-major mat3; IDENTITY_MAT3 (the same object) at identity geometry */
  geo: Float32Array;
  geoIdentity: boolean;
  /** win ≠ tile: P2 resamples the window into the buffer */
  windowed: boolean;
  /** the working bitmap's width / height: every face warp's iso metric, the same for the preview, a tile and the export */
  oAspect: number;
  /** pixel size of the O-space buffers (src, M at ¼, A): the window, or `size` at identity without a window */
  srcSize: Size;
  /** the O short edge in output pixels (k = fullShortEdge / 720) */
  fullShortEdge: number;
  /** step 4: the 膚質 passes of this frame, null = none (toneJob.ts) */
  tone: ToneJob | null;
  /** step 5: procedural makeup geometry of every listed face (O-space), null when no procedural item is drawable */
  procMakeup: MakeupGeometry | null;
}

export interface FrameResult {
  passes: string[];
  /** the capture framebuffer when target = 'fbo' */
  output: Framebuffer | null;
  /** the tone field was rebuilt by this frame */
  toneBuilt: boolean;
}

export interface PassPlanInput {
  /** some listed face has weight > 0 */
  anyFace: boolean;
  /** the skin-mask clear (gS, gR) of skinMaxima: the global skin's weight relative to the frame maxima */
  maskClear: readonly [number, number];
  matchGpupixel: boolean;
  skin: SkinUniforms;
  makeupActive: boolean;
  makeupReady: boolean;
  reshapeActive: boolean;
  /** a valid body field will be applied */
  bodyOn: boolean;
  /** a valid 推臉筆 field will be applied */
  liquifyOn: boolean;
  /** the frame needs the 調節 program (FrameJob.adjust.on) */
  adjustOn: boolean;
  /** step 3: false → P2 runs (default true) */
  geoIdentity?: boolean;
  /** step 3: true → P2 runs (default false) */
  windowed?: boolean;
  /** step 5: a procedural makeup item has geometry this frame */
  procActive: boolean;
  /** step 5: PMAKEUP is compiled (lazily, on the first procedural frame) */
  procReady: boolean;
}

export interface PassPlan {
  mask: boolean;
  makeup: boolean;
  reshape: boolean;
  mean: boolean;
  /** P5 draws with the 調節 program (when it compiled; else the base program) */
  adjust: boolean;
}

/**
 * Skip rules (pure). Without a mask pass the composite binds the white texture (mask = 1, uMaskOn = 0), so the mask
 * pass may only be skipped when its result would be 1 wherever the composite reads it: no face with weight > 0 and the
 * clear at 1 in every channel in use (磨皮 S > 0, 紅潤 R > 0). A camera frame whose listed faces all have weight 0 while a
 * face is present (the beautified track lost beside another face, held for LOST_HOLD_MS) has the global skin at weight
 * 0: its clear is 0, and the white texture would smooth every face and all skin at full strength (A2).
 */
export function planPasses(i: PassPlanInput): PassPlan {
  const faceOn = i.anyFace;
  const mean = needsMean(i.skin);
  const clearBelowWhite = (i.skin.smooth > 0 && i.maskClear[0] < 1) || (i.skin.rosy > 0 && i.maskClear[1] < 1);
  return {
    mask: (faceOn || clearBelowWhite) && !i.matchGpupixel && mean,
    // step 5 (S5 §3.6): 口紅 / 腮紅 need the GPUPixel textures, the procedural parts the PMAKEUP program; either runs P1
    makeup: faceOn && ((i.makeupActive && i.makeupReady) || (i.procActive && i.procReady)),
    // step 3 (S §4.3): a geometry or a window always runs P2, the V ← O resample
    // step 6 (push-brush spec §4.4): a strokes-only frame runs P2, and so maskWarp
    reshape: (faceOn && i.reshapeActive) || i.bodyOn || i.liquifyOn || i.geoIdentity === false || i.windowed === true,
    mean,
    adjust: i.adjustOn,
  };
}

/**
 * run()'s plan of a frame job (pure): the faces with weight > 0 drive the face passes, the clear keeps the mask on;
 * `proc` (step 5): the frame has procedural makeup geometry, and PMAKEUP compiled; `liquifyOn` (step 6): a 推臉筆 field
 * is applied
 */
export function planFrame(
  job: { faces: readonly Pick<FrameFace, 'weight' | 'makeup' | 'reshape'>[] } & Pick<FrameJob, 'maskClear' | 'matchGpupixel' | 'skin'> & {
    adjust: { on: boolean };
  } & Partial<Pick<FrameJob, 'geoIdentity' | 'windowed'>>,
  makeupReady: boolean,
  bodyOn: boolean,
  proc: { active: boolean; ready: boolean } = { active: false, ready: false },
  liquifyOn = false,
): PassPlan {
  const live = job.faces.filter((f) => f.weight > 0);
  return planPasses({
    anyFace: live.length > 0,
    maskClear: job.maskClear,
    matchGpupixel: job.matchGpupixel,
    skin: job.skin,
    makeupActive: live.some((f) => makeupActive(f.makeup)),
    makeupReady,
    reshapeActive: live.some((f) => reshapeActive(f.reshape)),
    bodyOn,
    liquifyOn,
    adjustOn: job.adjust.on,
    geoIdentity: job.geoIdentity,
    windowed: job.windowed,
    procActive: proc.active,
    procReady: proc.ready,
  });
}

const ZERO_U: ReshapeUniforms = { faceSlim: 0, faceV: 0, faceNarrow: 0, chin: 0, forehead: 0, noseSlim: 0, mouthSize: 0, eyeDistance: 0, eyeEnlarge: 0, faceSlimR: 0, faceVR: 0, faceNarrowR: 0, eyeEnlargeR: 0, jawline: 0, jawlineR: 0, temple: 0, templeR: 0, hairline: 0, noseWing: 0, noseBridge: 0, mouthHeight: 0 };

/** The face table of a frame (S §4.1): caps over every listed face and obstacle; a layer per drawn face with a limit. */
export function tableFaces(job: Pick<FrameJob, 'faces' | 'obstacles'>, aspect: number): { faces: TableFace[]; protects: FaceProtect[] } {
  const caps = capsFor(job.faces.map((f) => f.centre), job.obstacles, aspect, job.faces.map((f) => f.presence));
  const protects: FaceProtect[] = [];
  const faces = job.faces.map((f, i): TableFace => {
    // as v0.3: a face warps only with weight and an active warp; its limit only matters with a contour warp drawn
    const u = f.weight > 0 && reshapeActive(f.reshape) ? attenuate(f.reshape, f.face.yaw) : ZERO_U;
    let layer = -1;
    if (faceDrawn(u) && f.protect && faceProtectValid(f.protect)) {
      layer = protects.length;
      protects.push(f.protect);
    }
    return { face: f.face, u, layer, window: f.protect?.window ?? WHOLE, centre: f.centre, cap: caps[i] };
  });
  return { faces, protects };
}

export interface Pipeline {
  run(job: FrameJob): FrameResult;
  /**
   * renderOriginal: draw `src` to the canvas with flip Y (+ mirror), sampled through `geo` (V → O, step 3; default
   * IDENTITY_MAT3). Canvas must already be sized.
   */
  drawSource(src: Texture, mirror: boolean, geo?: Float32Array): void;
  /** Debug overlay on the canvas (after present); `aspect` = the image's W/H, for the eye frames (step 5) */
  drawOverlay(face: Face, mirror: boolean, aspect: number): void;
  /**
   * Create the makeup pass now and settle when its textures (GPUPixel and lashes.png) are uploaded (never rejects: a
   * failed load is logged and only its own parts stay disabled). Lets still renders wait for makeup instead of
   * silently drawing without it on the first frame.
   */
  preloadMakeup(): Promise<void>;
  /** step 5: PMAKEUP failed to compile on this context (its eight parts are off) */
  procMakeupFailed(): boolean;
  /** the 調節 program failed to compile on this context */
  readonly adjustFailed: boolean;
  /** every FBO to 1 × 1 (after a tiled export, S §4.4); the next frame re-allocates at its own size */
  releaseBuffers(): void;
  /** step 4 (tiles): the cached tone field is the one for `key` */
  toneFieldReady(key: string): boolean;
  /**
   * step 4 (tiles, skin-cleanup spec §4.6): build the tone field of `tj` from `src`, the working image (RenderInput.toneSource)
   * uploaded at tj.work — heal into A at that size when there are spots, then R, Q and P0c — so the tile's frame finds it.
   */
  prepareToneField(tj: ToneJob, src: Texture): void;
  /** `lost` = context already lost: drop references without issuing GL calls. */
  dispose(lost?: boolean): void;
}

type FbName = 'A' | 'B' | 'C' | 'D' | 'M' | 'N' | 'R' | 'Q' | 'RING' | FieldFbName;
/** what releaseBuffers shrinks: everything but the cached tone field (S §4.3: freed only on dispose or context loss) */
const RELEASED: readonly FbName[] = ['A', 'B', 'C', 'D', 'M', 'N', 'R', 'Q', 'RING'];

/** sanity cap (fields are ≈256 long edge); keeps texImage2D within every device's MAX_TEXTURE_SIZE */
export const MAX_BODY_FIELD_EDGE = 2048;

/** true when `f` can be uploaded: positive integer size and enough RG floats. */
export function bodyFieldValid(f: BodyField): boolean {
  return (
    Number.isInteger(f.width) &&
    Number.isInteger(f.height) &&
    f.width > 0 &&
    f.height > 0 &&
    f.width <= MAX_BODY_FIELD_EDGE &&
    f.height <= MAX_BODY_FIELD_EDGE &&
    f.data instanceof Float32Array &&
    f.data.length >= f.width * f.height * 2
  );
}

/** What the body texture currently holds; a field is re-uploaded only when one of these changes. */
export interface BodyUploadKey {
  field: BodyField;
  data: Float32Array;
  version: number;
  width: number;
  height: number;
  /** false when the data held a non-finite value (nothing was uploaded) */
  usable: boolean;
}

/** true when `p` can be uploaded: positive integer size within the cap and enough floats. */
export function faceProtectValid(p: FaceProtect): boolean {
  return (
    Number.isInteger(p.width) &&
    Number.isInteger(p.height) &&
    p.width > 0 &&
    p.height > 0 &&
    p.width <= MAX_BODY_FIELD_EDGE &&
    p.height <= MAX_BODY_FIELD_EDGE &&
    p.data instanceof Float32Array &&
    p.data.length >= p.width * p.height
  );
}

/** What the protect texture currently holds; re-uploaded only when one of these changes. */
export interface ProtectUploadKey {
  protect: FaceProtect;
  data: Float32Array;
  version: number;
  width: number;
  height: number;
  /** false when the data held a non-finite value (nothing was uploaded) */
  usable: boolean;
}

export function protectUploadNeeded(prev: ProtectUploadKey | null, p: FaceProtect): boolean {
  return (
    !prev ||
    prev.protect !== p ||
    prev.data !== p.data ||
    prev.version !== p.version ||
    prev.width !== p.width ||
    prev.height !== p.height
  );
}

export function bodyUploadNeeded(prev: BodyUploadKey | null, f: BodyField): boolean {
  return (
    !prev ||
    prev.field !== f ||
    prev.data !== f.data ||
    prev.version !== f.version ||
    prev.width !== f.width ||
    prev.height !== f.height
  );
}

/**
 * Which full-size buffer a pass writes (skin-cleanup spec §4.1): its preferred one, unless that is its input. Heal and
 * makeup prefer A, retouch and reshape prefer B, so a frame never adds a third full-size buffer.
 */
export function pickFull(prefer: 'A' | 'B', input: 'A' | 'B' | null): 'A' | 'B' {
  return input === prefer ? (prefer === 'A' ? 'B' : 'A') : prefer;
}

export function createPipeline(gl: GL): Pipeline {
  const meanProg = createProgram(gl, MEAN_VS, MEAN_FS, 'mean');
  const comp = createCompositePrograms(gl);
  const presentProg = createProgram(gl, PRESENT_VS, PRESENT_FS, 'present');
  const programs: Program[] = [meanProg, presentProg];

  meanProg.use();
  gl.uniform1i(meanProg.u('uSrc'), 0);
  presentProg.use();
  gl.uniform1i(presentProg.u('uSrc'), 0);
  gl.uniformMatrix3fv(presentProg.u('uGeo'), false, IDENTITY_MAT3);

  // 1×1 white stand-in for samplers the current frame does not use (avoids unbound-unit sampling).
  const white = createTexture(gl, 1, 1);
  gl.bindTexture(gl.TEXTURE_2D, white.tex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));

  const fbs: Partial<Record<FbName, Framebuffer>> = {};
  function fb(name: FbName, size: Size, internalFormat: number = gl.RGBA8): Framebuffer {
    let f = fbs[name];
    if (!f) {
      f = createFramebuffer(gl, size.width, size.height, internalFormat);
      fbs[name] = f;
    } else {
      resizeFramebuffer(gl, f, size.width, size.height);
    }
    return f;
  }
  const fullName = (f: Framebuffer | null): 'A' | 'B' | null => (f !== null && f === fbs.A ? 'A' : f !== null && f === fbs.B ? 'B' : null);
  /** the full-size buffer a pass writes (pickFull), sized for that pass */
  function full(prefer: 'A' | 'B', input: Framebuffer | null, size: Size): Framebuffer {
    return fb(pickFull(prefer, fullName(input)), size);
  }

  let mask: MaskPass | null = null;
  let makeup: MakeupPass | null = null;
  let makeupReady = false;
  let reshape: ReshapePass | null = null;
  let overlay: LandmarkOverlay | null = null;
  let bodyTex: Texture | null = null;
  let bodyKey: BodyUploadKey | null = null;
  let bodyWarned = false;
  let liqTex: Texture | null = null;
  let liqKey: BodyUploadKey | null = null;
  let liqWarned = false;
  let heal: HealPass | null = null;
  let toneMask: ToneMaskPass | null = null;
  let toneField: ToneFieldPass | null = null;
  let retouch: RetouchPass | null = null;
  /** the key of the field the D8 / Delta8 targets hold (S §4.3 cache), and its textures */
  let toneKey: string | null = null;
  let toneTex: ToneFieldTextures | null = null;
  let toneWarned = false;

  /** P0c at working resolution from `base0`, with R already drawn into `rTex`; Q is drawn here */
  function buildToneField(tj: ToneJob, base0: Texture, rTex: Texture): ToneFieldTextures {
    toneMask ??= createToneMaskPass(gl);
    toneField ??= createToneFieldPass(gl);
    const q = fb('Q', maskBufferSize(tj.work));
    toneMask.draw(q, tj.drawsQ, IDENTITY_WIN, Q_CLEAR);
    toneTex = toneField.build(base0, tj.work, q.tex, rTex, tj.sigmaLowPx, tj.fieldOn, (name, size) => fb(name, size), tj.folds);
    toneKey = tj.key;
    return toneTex;
  }

  /** The field's texture (uploaded only on version / size / buffer change), or null when unusable. */
  function bodyTexture(f: BodyField | null): Texture | null {
    if (!f) return null;
    if (!bodyFieldValid(f)) {
      if (!bodyWarned) console.warn('[engine] ignoring malformed body field', { width: f.width, height: f.height });
      bodyWarned = true;
      return null;
    }
    if (!bodyUploadNeeded(bodyKey, f)) return bodyKey?.usable ? bodyTex : null;
    const n = f.width * f.height * 2;
    const data = f.data.length === n ? f.data : f.data.subarray(0, n);
    const usable = data.every(Number.isFinite);
    bodyKey = { field: f, data: f.data, version: f.version, width: f.width, height: f.height, usable };
    if (!usable) {
      // A NaN would turn the sample coordinate into garbage across the whole image.
      console.warn('[engine] ignoring body field with non-finite values');
      return null;
    }
    bodyTex ??= createTexture(gl, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, bodyTex.tex);
    setUnpackState(gl);
    if (bodyTex.width === f.width && bodyTex.height === f.height) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, f.width, f.height, gl.RG, gl.FLOAT, data);
    } else {
      // RG16F from FLOAT data: core WebGL2, filterable (LINEAR) without extensions.
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, f.width, f.height, 0, gl.RG, gl.FLOAT, data);
      bodyTex.width = f.width;
      bodyTex.height = f.height;
    }
    return bodyTex;
  }

  /**
   * The 推臉筆 field's texture: bodyTexture's upload rule without its finite scan (the model's stamps are bounded, so
   * the field is finite by construction, push-brush spec §3.5; the scan would cost about 400 k calls per drawn frame).
   * The texture is deleted when the strokes become empty (null field).
   */
  function liquifyTexture(f: LiquifyField | null): Texture | null {
    if (!f) {
      if (liqTex) deleteTexture(gl, liqTex);
      liqTex = null;
      liqKey = null;
      return null;
    }
    if (!bodyFieldValid(f)) {
      if (!liqWarned) console.warn('[engine] ignoring malformed liquify field', { width: f.width, height: f.height });
      liqWarned = true;
      return null;
    }
    if (!bodyUploadNeeded(liqKey, f)) return liqTex;
    const n = f.width * f.height * 2;
    const data = f.data.length === n ? f.data : f.data.subarray(0, n);
    liqKey = { field: f, data: f.data, version: f.version, width: f.width, height: f.height, usable: true };
    liqTex ??= createTexture(gl, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, liqTex.tex);
    setUnpackState(gl);
    if (liqTex.width === f.width && liqTex.height === f.height) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, f.width, f.height, gl.RG, gl.FLOAT, data);
    } else {
      // RG16F from FLOAT data: core WebGL2, filterable (LINEAR) without extensions
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, f.width, f.height, 0, gl.RG, gl.FLOAT, data);
      liqTex.width = f.width;
      liqTex.height = f.height;
    }
    return liqTex;
  }

  function getMakeup(): MakeupPass {
    if (!makeup) {
      const m = createMakeupPass(gl);
      makeup = m;
      // never rejects: each texture set logs its own failure and only disables its own parts
      void m.ready.then(() => {
        if (makeup === m) makeupReady = m.meshReady;
      });
    }
    return makeup;
  }

  function resetState(): void {
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
  }
  resetState();

  function runMean(src: Texture, job: FrameJob): Texture {
    const ms = meanBufferSize(job.size, job.halfMean);
    const c = fb('C', ms);
    const d = fb('D', ms);
    meanProg.use();
    bindTarget(gl, c);
    bindTexture(gl, 0, src);
    gl.uniform2fv(meanProg.u('uStep'), meanStep(job.size, 'h', job.fullShortEdge));
    drawFullscreen(gl);
    bindTarget(gl, d);
    bindTexture(gl, 0, c.tex);
    gl.uniform2fv(meanProg.u('uStep'), meanStep(job.size, 'v', job.fullShortEdge));
    drawFullscreen(gl);
    return d.tex;
  }

  return {
    run(job) {
      const passes: string[] = [];
      let toneBuilt = false;
      resetState();
      const live = job.faces.filter((f) => f.weight > 0);
      const meshes = live.filter((f) => makeupActive(f.makeup)).map((f) => ({ face: f.face, u: f.makeup }));
      const proc = job.procMakeup;
      if (meshes.length || proc) getMakeup();
      // PMAKEUP compiles on the first frame with a procedural item; a failure leaves 口紅 / 腮紅 and the warps alone
      const procReady = proc !== null && makeup !== null && makeup.ensureProc();
      const body = bodyTexture(job.body);
      const liq = liquifyTexture(job.liquify);
      const plan = planFrame(job, makeupReady, body !== null, { active: proc !== null, ready: procReady }, liq !== null);

      let maskTex: Texture | null = null;
      if (plan.mask) {
        mask ??= createMaskPass(gl);
        // RGBA8 (fb's default), still 8-bit unorm per channel: the 磨皮 channel quantizes exactly like v0.3's R8. In O
        // (step 3): ¼ of the window; the feathers use oAspect once a geometry or a window is in play, else v0.3's
        const m = fb('M', maskBufferSize(job.srcSize));
        mask.drawFaces(m, job.faces.map((f) => ({ face: f.face, weight: f.weight, k: [f.kS, f.kR] as const })), job.maskClear, {
          win: job.win,
          aspect: job.geoIdentity && !job.windowed ? undefined : job.oAspect,
        });
        maskTex = m.tex;
        passes.push('mask');
      }

      let base: Texture = job.src;
      let baseFb: Framebuffer | null = null;
      const tj = job.tone;

      // ── step 4: P0b heal in O (skin-cleanup spec §4.5); base0 of P0c / P0d is its output ──
      if (tj && tj.spots.length > 0) {
        heal ??= createHealPass(gl);
        const a = full('A', baseFb, job.srcSize);
        const ring = fb('RING', { width: HEAL_RING_SAMPLES, height: tj.spots.length });
        heal.draw(job.src, a, ring, tj.spots, job.win, job.srcSize);
        base = a.tex;
        baseFb = a;
        passes.push('heal');
      }

      // ── step 4: P0c tone field (cached) and P0d retouch, in O before P1 (skin-cleanup spec §4.1) ──
      if (tj && tj.retouchOn) {
        // a tile (its src covers only a window of O) never builds the field: it reuses the preview's, or the one renderTile
        // built from RenderInput.toneSource (prepareToneField) before the tile's own passes
        const tile = job.win[0] !== 0 || job.win[1] !== 0 || job.win[2] !== 1 || job.win[3] !== 1;
        toneMask ??= createToneMaskPass(gl);
        const r = fb('R', maskBufferSize(job.srcSize));
        toneMask.draw(r, tj.drawsR, job.win, R_CLEAR);
        let field: ToneFieldTextures | null = null;
        if (tj.mn8On) {
          if (toneKey === tj.key && toneTex) field = toneTex;
          else if (!tile) {
            field = buildToneField(tj, base, r.tex);
            toneBuilt = true;
          } else if (!toneWarned) {
            toneWarned = true;
            console.warn('[engine] a tile asked for a tone field that was not prepared; drawing it without the field');
          }
          if (field) passes.push('toneField');
        }
        retouch ??= createRetouchPass(gl);
        const b = full('B', baseFb, job.srcSize);
        retouch.draw(base, b, field?.delta8 ?? null, field?.mn8 ?? null, r.tex, job.win, tj.fieldOn && !!field?.delta8, tj.mouths);
        base = b.tex;
        baseFb = b;
        passes.push('retouch');
      }

      if (plan.makeup && makeup) {
        // in O (step 3): the window's size
        const a = full('A', baseFb, job.srcSize);
        // step 5 (S5 §4.6): every face's GPUPixel mesh, then ≤ 9 procedural strips over every face at once
        const layers = makeup.drawFaces(base, a, meshes, procReady ? proc : null, job.win);
        base = a.tex;
        baseFb = a;
        passes.push('makeup', ...layers.map((l) => `mk.${l}`));
      }
      if (plan.reshape) {
        reshape ??= createReshapePass(gl, { carrier: FACE_TABLE_CARRIER });
        // the working bitmap's aspect (step 3, S §4.1): at identity without a window it is job.size's, as before
        const aspect = job.oAspect;
        const view: ReshapeView = { geo: job.geo, tile: job.tile, win: job.win };
        // every listed face with its cap; a face without weight or an active warp gets zero deltas (EMPTY_BOX), so a
        // body-only frame draws no face chain; its limit is a layer only with a warp drawn (no upload otherwise)
        const t = tableFaces(job, aspect);
        const b = full('B', baseFb, job.size);
        reshape.drawFaces(base, b, t.faces, { aspect, body, protects: t.protects, view, liquify: liq });
        base = b.tex;
        baseFb = b;
        passes.push('reshape');
        if (body) passes.push('body');
        if (liq) passes.push('liquify');
        if (maskTex) {
          // The mask is built from the detected landmarks but gates the warped image: push it through the same
          // backward map (every face, its cap, the body field), or 瘦臉/V臉/細腰 leave background inside the mask where
          // the contour moved in. Same program and table, the image's aspect (not the rounded ¼-res buffer's); all
          // channels pass through.
          const n = fb('N', maskBufferSize(job.size));
          reshape.drawFaces(maskTex, n, t.faces, { aspect, body, protects: t.protects, view, liquify: liq });
          maskTex = n.tex;
          passes.push('maskWarp');
        }
      }
      resetState();

      let meanTex: Texture = white;
      if (plan.mean) {
        meanTex = runMean(base, job);
        passes.push('meanH', 'meanV');
      }

      let output: Framebuffer | null = null;
      if (job.target === 'fbo') {
        // Reuse whichever full-size buffer is not the composite input (A is re-sized from srcSize to size after P2 read it).
        output = baseFb !== null && baseFb === fbs.A ? fb('B', job.size) : fb('A', job.size);
        bindTarget(gl, output);
      } else {
        bindTarget(gl, null);
      }

      const luts = job.luts;
      const whiten = luts ? job.skin.whiten : 0;
      const filterAmt = job.filterLut ? job.skin.filterAmount : 0;
      const prog = comp.pick(plan.adjust);
      const drawsAdjust = prog !== comp.base;
      prog.use();
      bindTexture(gl, COMPOSITE_UNITS.src, base);
      bindTexture(gl, COMPOSITE_UNITS.mean, meanTex);
      bindTexture(gl, COMPOSITE_UNITS.mask, maskTex ?? white);
      bindTexture(gl, COMPOSITE_UNITS.gray, luts ? luts.gray : white);
      bindTexture(gl, COMPOSITE_UNITS.origin, luts ? luts.origin : white);
      bindTexture(gl, COMPOSITE_UNITS.skin, luts ? luts.skin : white);
      bindTexture(gl, COMPOSITE_UNITS.light, luts ? luts.light : white);
      bindTexture(gl, COMPOSITE_UNITS.filter, filterAmt > 0 && job.filterLut ? job.filterLut : white);
      if (drawsAdjust) bindTexture(gl, COMPOSITE_UNITS.look, job.lookLut ?? white);
      gl.uniform2fv(prog.u('uTexel'), sharpenTexel(job.size, job.fullShortEdge));
      gl.uniform1f(prog.u('uSmooth'), plan.mean ? job.skin.smooth : 0);
      gl.uniform1f(prog.u('uSharpen'), job.skin.sharpen);
      gl.uniform1f(prog.u('uWhiten'), whiten);
      gl.uniform1f(prog.u('uRosy'), plan.mean ? job.skin.rosy : 0);
      gl.uniform1f(prog.u('uFilterAmt'), filterAmt);
      gl.uniform1f(prog.u('uMaskOn'), maskTex ? 1 : 0);
      gl.uniform2fv(prog.u('uOut'), presentScale(job.target === 'canvas', job.mirror));
      if (drawsAdjust) uploadAdjust(gl, prog, job.adjust, job.lookLut !== null);
      drawFullscreen(gl);
      passes.push('composite');
      if (drawsAdjust) passes.push('adjust');

      // Leave no FBO texture bound on a unit, so later passes never form a feedback loop by accident.
      for (let unit = 0; unit < 9; unit++) bindTexture(gl, unit, null);
      return { passes, output, toneBuilt };
    },

    get adjustFailed() {
      return comp.adjustFailed;
    },

    drawSource(src, mirror, geo = IDENTITY_MAT3) {
      resetState();
      bindTarget(gl, null);
      presentProg.use();
      bindTexture(gl, 0, src);
      gl.uniform2fv(presentProg.u('uOut'), presentScale(true, mirror));
      gl.uniformMatrix3fv(presentProg.u('uGeo'), false, geo);
      drawFullscreen(gl);
      bindTexture(gl, 0, null);
    },

    preloadMakeup() {
      return getMakeup().ready;
    },

    procMakeupFailed() {
      return makeup?.procStatus() === 'failed';
    },

    releaseBuffers() {
      // every FBO to 1 × 1: the next frame re-allocates at its own size (S §4.4, after a tiled export); the tone field's
      // targets keep the cached field (skin-cleanup spec §4.3), and R / Q are redrawn by the frame that reads them
      for (const k of RELEASED) {
        const f = fbs[k];
        if (f) resizeFramebuffer(gl, f, 1, 1);
      }
    },

    toneFieldReady(key) {
      return toneKey === key && toneTex !== null;
    },

    prepareToneField(tj, src) {
      if (!tj.mn8On || (toneKey === tj.key && toneTex)) return;
      resetState();
      // base0 at working resolution: P0b over the whole working image when there are spots (the field holds the heal)
      let base0: Texture = src;
      if (tj.spots.length > 0) {
        heal ??= createHealPass(gl);
        const a = fb('A', tj.work);
        heal.draw(src, a, fb('RING', { width: HEAL_RING_SAMPLES, height: tj.spots.length }), tj.spots, IDENTITY_WIN, tj.work);
        base0 = a.tex;
      }
      toneMask ??= createToneMaskPass(gl);
      const r = fb('R', maskBufferSize(tj.work));
      toneMask.draw(r, tj.drawsR, IDENTITY_WIN, R_CLEAR);
      buildToneField(tj, base0, r.tex);
      resetState();
    },

    drawOverlay(face, mirror, aspect) {
      overlay ??= createLandmarkOverlay(gl);
      bindTarget(gl, null);
      overlay.draw(face, mirror, aspect);
    },

    dispose(lost = false) {
      if (!lost) {
        for (const p of programs) p.dispose();
        comp.dispose();
        deleteTexture(gl, white);
        for (const f of Object.values(fbs)) deleteFramebuffer(gl, f);
        mask?.dispose();
        makeup?.dispose();
        reshape?.dispose();
        overlay?.dispose();
        deleteTexture(gl, bodyTex);
        deleteTexture(gl, liqTex);
        heal?.dispose();
        toneMask?.dispose();
        toneField?.dispose();
        retouch?.dispose();
      }
      mask = makeup = reshape = overlay = null;
      bodyTex = null;
      bodyKey = null;
      liqTex = null;
      liqKey = null;
      makeupReady = false;
      // the field's textures die with the FBOs: the next frame on a restored context rebuilds it (Review Focus 1)
      heal = null;
      toneMask = toneField = retouch = null;
      toneKey = null;
      toneTex = null;
      for (const k of Object.keys(fbs) as FbName[]) delete fbs[k];
    },
  };
}
