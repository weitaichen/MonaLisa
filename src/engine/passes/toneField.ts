// P0c tone field and P0d retouch (skin-cleanup spec §4.3–4.4). The field is built at working resolution into ⅛-res and
// smaller RGBA8 targets — D8 (8 × 8 box) → T8 → D8 = Mn8 (σ_mid/8), L (box of Mn8·q, q) → Lt → L (σ_low/f_L), Δ8 — and the
// retouch writes base0 + Δ8, then 白牙 and 亮眼, at full resolution (one tile through uWin). Shaders: ../shaders/tone.ts.
// Original work.
import { bindTarget, bindTexture, createProgram, createTexture, deleteTexture, drawFullscreen, FULLSCREEN_VS, type Framebuffer, type GL, type Texture } from '../gl/gl';
import { fieldSizes, gaussWeights, MAX_BLUR_RADIUS, MAX_MOUTHS, RETOUCH_FS, sigmaMid, TONE_BLUR_FS, TONE_DOWN8_FS, TONE_FIELD_FS, TONE_LBOX_FS } from '../shaders/tone';
import type { Size } from '../uniforms';
import type { MouthGuards, Win } from './toneGeometry';

export type FieldFbName = 'D8' | 'T8' | 'L' | 'Lt' | 'Delta8';
export interface ToneFieldTextures {
  /** D8's texture, holding Mn8 after the two blur passes */
  mn8: Texture;
  /** null when only Mn8 was built (亮眼 alone) */
  delta8: Texture | null;
}
export interface ToneFieldPass {
  /** D8 → Mn8 from `base0` (`size` = its working size); with `fieldOn` also L → Δ8 from Q and R */
  build(base0: Texture, size: Size, q: Texture, r: Texture, sigmaLowPx: number, fieldOn: boolean, fb: (name: FieldFbName, size: Size) => Framebuffer): ToneFieldTextures;
  dispose(): void;
}
export interface RetouchPass {
  /** `mouths`: 白牙's lip guard (none listed: 白牙 does nothing) */
  draw(base0: Texture, dst: Framebuffer, delta8: Texture | null, mn8: Texture | null, r: Texture, win: Win, fieldOn: boolean, mouths: MouthGuards): void;
  dispose(): void;
}

export function createToneFieldPass(gl: GL): ToneFieldPass {
  const down = createProgram(gl, FULLSCREEN_VS, TONE_DOWN8_FS, 'toneDown8');
  const blur = createProgram(gl, FULLSCREEN_VS, TONE_BLUR_FS, 'toneBlur');
  const lbox = createProgram(gl, FULLSCREEN_VS, TONE_LBOX_FS, 'toneLBox');
  const field = createProgram(gl, FULLSCREEN_VS, TONE_FIELD_FS, 'toneField');
  down.use();
  gl.uniform1i(down.u('uSrc'), 0);
  blur.use();
  gl.uniform1i(blur.u('uSrc'), 0);
  lbox.use();
  gl.uniform1i(lbox.u('uMn8'), 0);
  gl.uniform1i(lbox.u('uQ'), 1);
  field.use();
  gl.uniform1i(field.u('uMn8'), 0);
  gl.uniform1i(field.u('uL'), 1);
  gl.uniform1i(field.u('uQ'), 2);
  gl.uniform1i(field.u('uR'), 3);
  const weights = new Float32Array(MAX_BLUR_RADIUS + 1);

  function blurInto(src: Texture, dst: Framebuffer, sigma: number, dx: number, dy: number): void {
    const w = gaussWeights(sigma);
    weights.fill(0);
    weights.set(w);
    blur.use();
    gl.uniform1fv(blur.u('uW'), weights);
    gl.uniform1i(blur.u('uR'), w.length - 1);
    gl.uniform2i(blur.u('uDir'), dx, dy);
    bindTexture(gl, 0, src);
    bindTarget(gl, dst);
    drawFullscreen(gl);
    // the next pass writes `src`: leave it unbound so no draw ever reads its own target
    bindTexture(gl, 0, null);
  }

  return {
    build(base0, size, q, r, sigmaLowPx, fieldOn, fb) {
      gl.disable(gl.BLEND);
      const s = fieldSizes(size.width, size.height, sigmaLowPx);
      const d8 = fb('D8', { width: s.d8.w, height: s.d8.h });
      const t8 = fb('T8', { width: s.d8.w, height: s.d8.h });
      down.use();
      gl.uniform2f(down.u('uSrcSize'), size.width, size.height);
      bindTexture(gl, 0, base0);
      bindTarget(gl, d8);
      drawFullscreen(gl);
      bindTexture(gl, 0, null);
      const sm = sigmaMid(Math.min(size.width, size.height)) / 8;
      blurInto(d8.tex, t8, sm, 1, 0);
      blurInto(t8.tex, d8, sm, 0, 1);
      if (!fieldOn) return { mn8: d8.tex, delta8: null };
      const l = fb('L', { width: s.l.w, height: s.l.h });
      const lt = fb('Lt', { width: s.l.w, height: s.l.h });
      lbox.use();
      gl.uniform1i(lbox.u('uK'), s.fL / 8);
      bindTexture(gl, 0, d8.tex);
      bindTexture(gl, 1, q);
      bindTarget(gl, l);
      drawFullscreen(gl);
      bindTexture(gl, 0, null);
      bindTexture(gl, 1, null);
      const sl = sigmaLowPx / s.fL;
      blurInto(l.tex, lt, sl, 1, 0);
      blurInto(lt.tex, l, sl, 0, 1);
      const dl = fb('Delta8', { width: s.d8.w, height: s.d8.h });
      field.use();
      bindTexture(gl, 0, d8.tex);
      bindTexture(gl, 1, l.tex);
      bindTexture(gl, 2, q);
      bindTexture(gl, 3, r);
      bindTarget(gl, dl);
      drawFullscreen(gl);
      for (let u = 0; u < 4; u++) bindTexture(gl, u, null);
      return { mn8: d8.tex, delta8: dl.tex };
    },
    dispose() {
      down.dispose();
      blur.dispose();
      lbox.dispose();
      field.dispose();
    },
  };
}

export function createRetouchPass(gl: GL): RetouchPass {
  const prog = createProgram(gl, FULLSCREEN_VS, RETOUCH_FS, 'retouch');
  prog.use();
  gl.uniform1i(prog.u('uBase'), 0);
  gl.uniform1i(prog.u('uDelta'), 1);
  gl.uniform1i(prog.u('uMn8'), 2);
  gl.uniform1i(prog.u('uR'), 3);
  // stand-in for a frame without a field (白牙 only, or a tile whose field was not prepared): bound but never read,
  // since uFieldOn and uMnOn are 0 then
  const zero = createTexture(gl, 1, 1);
  gl.bindTexture(gl.TEXTURE_2D, zero.tex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]));
  gl.bindTexture(gl.TEXTURE_2D, null);
  const ring = new Float32Array(MAX_MOUTHS * 16);
  const mouthW = new Float32Array(MAX_MOUTHS);
  return {
    draw(base0, dst, delta8, mn8, r, win, fieldOn, mouths) {
      gl.disable(gl.BLEND);
      prog.use();
      bindTexture(gl, 0, base0);
      bindTexture(gl, 1, delta8 ?? zero);
      bindTexture(gl, 2, mn8 ?? zero);
      bindTexture(gl, 3, r);
      gl.uniform4f(prog.u('uWin'), win[0], win[1], win[2], win[3]);
      gl.uniform1f(prog.u('uFieldOn'), fieldOn && delta8 ? 1 : 0);
      gl.uniform1f(prog.u('uMnOn'), mn8 ? 1 : 0);
      const n = Math.min(MAX_MOUTHS, mouths.mouths.length);
      ring.fill(0);
      mouthW.fill(0);
      for (let f = 0; f < n; f++) {
        const m = mouths.mouths[f];
        for (let i = 0; i < 8; i++) ring.set(m.ring[i], (f * 8 + i) * 2);
        mouthW[f] = m.mouthW;
      }
      gl.uniform1i(prog.u('uMouths'), n);
      gl.uniform2fv(prog.u('uMouth'), ring);
      gl.uniform1fv(prog.u('uMouthW'), mouthW);
      gl.uniform1f(prog.u('uAspect'), mouths.aspect);
      bindTarget(gl, dst);
      drawFullscreen(gl);
      for (let u = 0; u < 4; u++) bindTexture(gl, u, null);
    },
    dispose() {
      prog.dispose();
      deleteTexture(gl, zero);
    },
  };
}
