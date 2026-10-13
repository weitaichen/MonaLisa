// The two P5 composite programs (v0.4 step-2 spec §4.1): the base program (the step-1 text, built with the pipeline)
// and the 調節 program (+ 質感 LUT, unit 8), compiled the first time a frame needs it. A compile or link failure of the
// 調節 program is logged once and the base program keeps drawing (no 調節, no 質感) until the context is rebuilt.
import type { AdjustUniforms } from './adjustMath';
import { createProgram, type GL, hexToRgb, type Program } from './gl/gl';
import { COMPOSITE_FS, COMPOSITE_UNITS, compositeFs } from './shaders/composite';
import { PRESENT_VS } from './shaders/present';
import { ROSY_TINT } from './uniforms';

export interface CompositePrograms {
  readonly base: Program;
  /** the program for this frame: the 調節 program when `adjust` is true and it compiled, else the base */
  pick(adjust: boolean): Program;
  /** the 調節 program failed to compile or link on this context (never retried here) */
  readonly adjustFailed: boolean;
  dispose(): void;
}

/** sampler units and the constant 紅潤 tint, shared by both programs */
function initComposite(gl: GL, p: Program, look: boolean): void {
  p.use();
  gl.uniform1i(p.u('uSrc'), COMPOSITE_UNITS.src);
  gl.uniform1i(p.u('uMean'), COMPOSITE_UNITS.mean);
  gl.uniform1i(p.u('uMask'), COMPOSITE_UNITS.mask);
  gl.uniform1i(p.u('uLookupGray'), COMPOSITE_UNITS.gray);
  gl.uniform1i(p.u('uLookupOrigin'), COMPOSITE_UNITS.origin);
  gl.uniform1i(p.u('uLookupSkin'), COMPOSITE_UNITS.skin);
  gl.uniform1i(p.u('uLookupLight'), COMPOSITE_UNITS.light);
  gl.uniform1i(p.u('uFilterLut'), COMPOSITE_UNITS.filter);
  if (look) gl.uniform1i(p.u('uLookLut'), COMPOSITE_UNITS.look);
  gl.uniform3fv(p.u('uRosyTint'), hexToRgb(ROSY_TINT));
}

export function createCompositePrograms(gl: GL): CompositePrograms {
  const base = createProgram(gl, PRESENT_VS, COMPOSITE_FS, 'composite');
  initComposite(gl, base, false);
  let adjust: Program | null = null;
  let failed = false;
  return {
    base,
    pick(want) {
      if (!want) return base;
      if (!adjust && !failed) {
        try {
          const p = createProgram(gl, PRESENT_VS, compositeFs({ adjust: true }), 'composite-adjust');
          initComposite(gl, p, true);
          adjust = p;
        } catch (err) {
          failed = true;
          console.error('[engine] the 調節 program failed to compile; drawing without 調節 and 質感', err);
        }
      }
      return adjust ?? base;
    },
    get adjustFailed() {
      return failed;
    },
    dispose() {
      base.dispose();
      adjust?.dispose();
    },
  };
}

/** One frame's 調節 uniforms into the 調節 program (already in use). `lookResident` false → no LUT mix. */
export function uploadAdjust(gl: GL, p: Program, a: AdjustUniforms, lookResident: boolean): void {
  gl.uniform1f(p.u('uLookAmt'), lookResident ? a.lookAmt : 0);
  gl.uniform1f(p.u('uAdjustOn'), a.adjustOn ? 1 : 0);
  gl.uniform4fv(p.u('uExp'), a.exp);
  gl.uniform1f(p.u('uCurveOn'), a.curveOn ? 1 : 0);
  gl.uniform2fv(p.u('uCurve'), new Float32Array(a.curve));
  gl.uniform1f(p.u('uWbOn'), a.wbOn ? 1 : 0);
  gl.uniform3fv(p.u('uWb'), a.wb);
  gl.uniform4fv(p.u('uSat'), a.sat);
  gl.uniform4fv(p.u('uSkinA'), a.skinA);
  gl.uniform4fv(p.u('uSkinB'), a.skinB);
  gl.uniform2fv(p.u('uTaper'), a.taper);
  gl.uniform3fv(p.u('uFade'), a.fade);
  gl.uniform4fv(p.u('uVig'), a.vig);
  gl.uniform1f(p.u('uVAspect'), a.vAspect);
  gl.uniform4fv(p.u('uVMap'), a.vMap);
  gl.uniform4fv(p.u('uGrain'), a.grain);
  gl.uniform2fv(p.u('uGrainScale'), a.grainScale);
  gl.uniform1ui(p.u('uSeedMix'), a.seedMix);
}
