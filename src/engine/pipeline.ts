// Pass order, skip rules and buffer management (RB §2.2, spec §5):
//   [P0 mask → R8 ¼-res M] → [P1 makeup → A] → [P2 reshape → B (+ mask M → N)] → P3 meanH → C → P4 meanV → D
//   → P5 composite + present (canvas, or the free one of A/B for capture).
// Face passes (T2) are constructed lazily the first time a frame actually needs them.
// 美體: the body field is an RG16F texture sampled as the outermost backward map of P2 (no extra FBO,
// one resample), so P2 also runs for a body-only frame and the skin mask follows via maskWarp.
// 瘦臉 background limit: an R16F person-distance texture (FaceProtect) bounds the face contour warps in P2 (photo editor
// only; uploaded on version change like the body field).
import type { BeautyParams, BodyField, Face, FaceProtect } from '../types';
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
  hexToRgb,
  type Program,
  resizeFramebuffer,
  setUnpackState,
  type Texture,
} from './gl/gl';
import { createMakeupPass, makeupActive, makeupUniforms, type MakeupPass } from './passes/makeup';
import { createMaskPass, type MaskPass } from './passes/mask';
import { createLandmarkOverlay, type LandmarkOverlay } from './passes/overlay';
import { createReshapePass, reshapeActive, reshapeUniforms, type ReshapePass } from './passes/reshape';
import { COMPOSITE_FS, COMPOSITE_UNITS } from './shaders/composite';
import { MEAN_FS, MEAN_VS } from './shaders/mean';
import { PRESENT_FS, PRESENT_VS } from './shaders/present';
import {
  maskBufferSize,
  meanBufferSize,
  meanStep,
  needsMean,
  presentScale,
  sharpenTexel,
  ROSY_TINT,
  type Size,
  type SkinUniforms,
} from './uniforms';

export interface StaticLuts {
  gray: Texture;
  origin: Texture;
  skin: Texture;
  light: Texture;
}

export interface FrameJob {
  /** uploaded source (any size; sampled by UV) */
  src: Texture;
  /** processing size */
  size: Size;
  /** live tier L: half-resolution mean buffers */
  halfMean: boolean;
  face: Face | null;
  faceWeight: number;
  /** 美體 backward displacement field (UV units); null = none. Not scaled by faceWeight or yaw. */
  body: BodyField | null;
  /** 瘦臉 background limit (person distance); null = unlimited contour warps */
  faceProtect: FaceProtect | null;
  params: BeautyParams;
  skin: SkinUniforms;
  /** null until the GPUPixel LUTs are uploaded (whitening is skipped meanwhile) */
  luts: StaticLuts | null;
  filterLut: Texture | null;
  matchGpupixel: boolean;
  /** 'canvas' presents (flip Y); 'fbo' renders top-row-first into a free buffer for readPixels */
  target: 'canvas' | 'fbo';
  mirror: boolean;
}

export interface FrameResult {
  passes: string[];
  /** the capture framebuffer when target = 'fbo' */
  output: Framebuffer | null;
}

export interface PassPlanInput {
  hasFace: boolean;
  faceWeight: number;
  matchGpupixel: boolean;
  skin: SkinUniforms;
  makeupActive: boolean;
  makeupReady: boolean;
  reshapeActive: boolean;
  /** a valid body field will be applied */
  bodyOn: boolean;
}

export interface PassPlan {
  mask: boolean;
  makeup: boolean;
  reshape: boolean;
  mean: boolean;
}

/** Skip rules (pure). Without a mask pass the composite binds the white texture (mask = 1, uMaskOn = 0). */
export function planPasses(i: PassPlanInput): PassPlan {
  const faceOn = i.hasFace && i.faceWeight > 0;
  const mean = needsMean(i.skin);
  return {
    mask: faceOn && !i.matchGpupixel && mean,
    makeup: faceOn && i.makeupActive && i.makeupReady,
    reshape: (faceOn && i.reshapeActive) || i.bodyOn,
    mean,
  };
}

export interface Pipeline {
  run(job: FrameJob): FrameResult;
  /** renderOriginal: draw `src` to the canvas with flip Y (+ mirror). Canvas must already be sized. */
  drawSource(src: Texture, mirror: boolean): void;
  /** Debug overlay on the canvas (after present). */
  drawOverlay(face: Face, mirror: boolean): void;
  /**
   * Create the makeup pass now and settle when its textures are uploaded (never rejects: a failed
   * load is logged and makeup stays disabled). Lets still renders wait for makeup instead of
   * silently drawing without it on the first frame.
   */
  preloadMakeup(): Promise<void>;
  /** `lost` = context already lost: drop references without issuing GL calls. */
  dispose(lost?: boolean): void;
}

type FbName = 'A' | 'B' | 'C' | 'D' | 'M' | 'N';

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

export function createPipeline(gl: GL): Pipeline {
  const meanProg = createProgram(gl, MEAN_VS, MEAN_FS, 'mean');
  const compProg = createProgram(gl, PRESENT_VS, COMPOSITE_FS, 'composite');
  const presentProg = createProgram(gl, PRESENT_VS, PRESENT_FS, 'present');
  const programs: Program[] = [meanProg, compProg, presentProg];

  meanProg.use();
  gl.uniform1i(meanProg.u('uSrc'), 0);
  presentProg.use();
  gl.uniform1i(presentProg.u('uSrc'), 0);
  compProg.use();
  gl.uniform1i(compProg.u('uSrc'), COMPOSITE_UNITS.src);
  gl.uniform1i(compProg.u('uMean'), COMPOSITE_UNITS.mean);
  gl.uniform1i(compProg.u('uMask'), COMPOSITE_UNITS.mask);
  gl.uniform1i(compProg.u('uLookupGray'), COMPOSITE_UNITS.gray);
  gl.uniform1i(compProg.u('uLookupOrigin'), COMPOSITE_UNITS.origin);
  gl.uniform1i(compProg.u('uLookupSkin'), COMPOSITE_UNITS.skin);
  gl.uniform1i(compProg.u('uLookupLight'), COMPOSITE_UNITS.light);
  gl.uniform1i(compProg.u('uFilterLut'), COMPOSITE_UNITS.filter);
  gl.uniform3fv(compProg.u('uRosyTint'), hexToRgb(ROSY_TINT));

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

  let mask: MaskPass | null = null;
  let makeup: MakeupPass | null = null;
  let makeupReady = false;
  let reshape: ReshapePass | null = null;
  let overlay: LandmarkOverlay | null = null;
  let bodyTex: Texture | null = null;
  let bodyKey: BodyUploadKey | null = null;
  let bodyWarned = false;
  let protTex: Texture | null = null;
  let protKey: ProtectUploadKey | null = null;
  let protWarned = false;

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

  /** The FaceProtect's texture (uploaded only on version / size / buffer change), or null when unusable. */
  function protectTexture(p: FaceProtect | null): Texture | null {
    if (!p) return null;
    if (!faceProtectValid(p)) {
      if (!protWarned) console.warn('[engine] ignoring malformed face protect', { width: p.width, height: p.height });
      protWarned = true;
      return null;
    }
    if (!protectUploadNeeded(protKey, p)) return protKey?.usable ? protTex : null;
    const n = p.width * p.height;
    const data = p.data.length === n ? p.data : p.data.subarray(0, n);
    const usable = data.every(Number.isFinite);
    protKey = { protect: p, data: p.data, version: p.version, width: p.width, height: p.height, usable };
    if (!usable) {
      console.warn('[engine] ignoring face protect with non-finite values');
      return null;
    }
    protTex ??= createTexture(gl, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, protTex.tex);
    setUnpackState(gl);
    if (protTex.width === p.width && protTex.height === p.height) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, p.width, p.height, gl.RED, gl.FLOAT, data);
    } else {
      // R16F from FLOAT data: core WebGL2, filterable (LINEAR) without extensions.
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, p.width, p.height, 0, gl.RED, gl.FLOAT, data);
      protTex.width = p.width;
      protTex.height = p.height;
    }
    return protTex;
  }

  function getMakeup(): MakeupPass {
    if (!makeup) {
      const m = createMakeupPass(gl);
      makeup = m;
      m.ready.then(
        () => {
          if (makeup === m) makeupReady = true;
        },
        (err: unknown) => console.error('[engine] makeup textures failed to load; makeup disabled', err),
      );
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
    gl.uniform2fv(meanProg.u('uStep'), meanStep(job.size, 'h'));
    drawFullscreen(gl);
    bindTarget(gl, d);
    bindTexture(gl, 0, c.tex);
    gl.uniform2fv(meanProg.u('uStep'), meanStep(job.size, 'v'));
    drawFullscreen(gl);
    return d.tex;
  }

  return {
    run(job) {
      const passes: string[] = [];
      resetState();
      const face = job.face;
      const faceOn = face !== null && job.faceWeight > 0;
      // T2's uniform builders are only consulted when a face can actually be drawn.
      const mu = faceOn ? makeupUniforms(job.params, job.faceWeight) : null;
      const ru = faceOn ? reshapeUniforms(job.params.values, job.faceWeight) : null;
      const wantMakeup = mu !== null && makeupActive(mu);
      if (wantMakeup) getMakeup();
      const body = bodyTexture(job.body);
      const plan = planPasses({
        hasFace: face !== null,
        faceWeight: job.faceWeight,
        matchGpupixel: job.matchGpupixel,
        skin: job.skin,
        makeupActive: wantMakeup,
        makeupReady,
        reshapeActive: ru !== null && reshapeActive(ru),
        bodyOn: body !== null,
      });

      let maskTex: Texture | null = null;
      if (plan.mask && face) {
        mask ??= createMaskPass(gl);
        const m = fb('M', maskBufferSize(job.size), gl.R8);
        mask.draw(m, face, job.faceWeight);
        maskTex = m.tex;
        passes.push('mask');
      }

      let base: Texture = job.src;
      let baseFb: Framebuffer | null = null;
      if (plan.makeup && face && mu && makeup) {
        const a = fb('A', job.size);
        makeup.draw(base, a, face, mu);
        base = a.tex;
        baseFb = a;
        passes.push('makeup');
      }
      if (plan.reshape) {
        reshape ??= createReshapePass(gl);
        // Face deltas only when the face plan is on (a body-only frame passes null: empty uBox).
        const faceWarp = faceOn && ru !== null && reshapeActive(ru);
        const rf = faceWarp ? face : null;
        const rru = faceWarp ? ru : null;
        // the limit only matters with a contour warp drawn: no upload otherwise
        const prot = faceWarp ? protectTexture(job.faceProtect) : null;
        const b = fb('B', job.size);
        reshape.draw(base, b, rf, rru, undefined, body, prot);
        base = b.tex;
        baseFb = b;
        passes.push('reshape');
        if (body) passes.push('body');
        if (maskTex) {
          // The mask is built from the detected landmarks but gates the warped image: push it
          // through the same backward map (face and body), or 瘦臉/V臉/細腰 leave background inside
          // the mask where the contour moved in. Same pass, uniforms and yaw attenuation; the
          // image's aspect, not the rounded ¼-res buffer's.
          const n = fb('N', maskBufferSize(job.size), gl.R8);
          reshape.draw(maskTex, n, rf, rru, job.size.width / job.size.height, body, prot);
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
        // Reuse whichever full-size buffer is not the composite input.
        output = baseFb !== null && baseFb === fbs.A ? fb('B', job.size) : fb('A', job.size);
        bindTarget(gl, output);
      } else {
        bindTarget(gl, null);
      }

      const luts = job.luts;
      const whiten = luts ? job.skin.whiten : 0;
      const filterAmt = job.filterLut ? job.skin.filterAmount : 0;
      compProg.use();
      bindTexture(gl, COMPOSITE_UNITS.src, base);
      bindTexture(gl, COMPOSITE_UNITS.mean, meanTex);
      bindTexture(gl, COMPOSITE_UNITS.mask, maskTex ?? white);
      bindTexture(gl, COMPOSITE_UNITS.gray, luts ? luts.gray : white);
      bindTexture(gl, COMPOSITE_UNITS.origin, luts ? luts.origin : white);
      bindTexture(gl, COMPOSITE_UNITS.skin, luts ? luts.skin : white);
      bindTexture(gl, COMPOSITE_UNITS.light, luts ? luts.light : white);
      bindTexture(gl, COMPOSITE_UNITS.filter, filterAmt > 0 && job.filterLut ? job.filterLut : white);
      gl.uniform2fv(compProg.u('uTexel'), sharpenTexel(job.size));
      gl.uniform1f(compProg.u('uSmooth'), plan.mean ? job.skin.smooth : 0);
      gl.uniform1f(compProg.u('uSharpen'), job.skin.sharpen);
      gl.uniform1f(compProg.u('uWhiten'), whiten);
      gl.uniform1f(compProg.u('uRosy'), plan.mean ? job.skin.rosy : 0);
      gl.uniform1f(compProg.u('uFilterAmt'), filterAmt);
      gl.uniform1f(compProg.u('uMaskOn'), maskTex ? 1 : 0);
      gl.uniform2fv(compProg.u('uOut'), presentScale(job.target === 'canvas', job.mirror));
      drawFullscreen(gl);
      passes.push('composite');

      // Leave no FBO texture bound on a unit, so later passes never form a feedback loop by accident.
      for (let unit = 0; unit < 8; unit++) bindTexture(gl, unit, null);
      return { passes, output };
    },

    drawSource(src, mirror) {
      resetState();
      bindTarget(gl, null);
      presentProg.use();
      bindTexture(gl, 0, src);
      gl.uniform2fv(presentProg.u('uOut'), presentScale(true, mirror));
      drawFullscreen(gl);
      bindTexture(gl, 0, null);
    },

    preloadMakeup() {
      return getMakeup().ready.catch(() => {
        // already logged by getMakeup's handler; makeup stays disabled
      });
    },

    drawOverlay(face, mirror) {
      overlay ??= createLandmarkOverlay(gl);
      bindTarget(gl, null);
      overlay.draw(face, mirror);
    },

    dispose(lost = false) {
      if (!lost) {
        for (const p of programs) p.dispose();
        deleteTexture(gl, white);
        for (const f of Object.values(fbs)) deleteFramebuffer(gl, f);
        mask?.dispose();
        makeup?.dispose();
        reshape?.dispose();
        overlay?.dispose();
        deleteTexture(gl, bodyTex);
        deleteTexture(gl, protTex);
      }
      mask = makeup = reshape = overlay = null;
      bodyTex = null;
      bodyKey = null;
      protTex = null;
      protKey = null;
      makeupReady = false;
      for (const k of Object.keys(fbs) as FbName[]) delete fbs[k];
    },
  };
}
