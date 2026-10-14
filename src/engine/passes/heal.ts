// P0b 祛痘 heal (skin-cleanup spec §4.5): copy src → dst, the robust ring pass into RING (N × spots), then one instanced
// quad per spot blended premultiplied (ONE, ONE_MINUS_SRC_ALPHA) in list order; every quad reads the unhealed src.
// Shaders: ../shaders/heal.ts. Original work.
import type { Spot } from '../../types';
import { bindTarget, bindTexture, COPY_FS, createProgram, drawFullscreen, FULLSCREEN_VS, type Framebuffer, type GL, type Program, type Texture } from '../gl/gl';
import { HEAL_FS, HEAL_RING_FS, HEAL_RING_VS, HEAL_VS } from '../shaders/heal';
import type { Size } from '../uniforms';
import type { Win } from './toneGeometry';

/** per instance: x, y, r, fill (1 = no donor), dx, dy */
export function packSpots(spots: readonly Spot[]): Float32Array {
  const out = new Float32Array(spots.length * 6);
  spots.forEach((s, i) => out.set([s.x, s.y, s.r, s.dx === 0 && s.dy === 0 ? 1 : 0, s.dx, s.dy], i * 6));
  return out;
}

export interface HealPass {
  /** `ring` must be HEAL_RING_SAMPLES × spots.length; `win` is the O rectangle `src` covers, `srcSize` its pixel size */
  draw(src: Texture, dst: Framebuffer, ring: Framebuffer, spots: readonly Spot[], win: Win, srcSize: Size): void;
  dispose(): void;
}

export function createHealPass(gl: GL): HealPass {
  const copy = createProgram(gl, FULLSCREEN_VS, COPY_FS, 'healCopy');
  const ringProg = createProgram(gl, HEAL_RING_VS, HEAL_RING_FS, 'healRing');
  const quadProg = createProgram(gl, HEAL_VS, HEAL_FS, 'healQuads');
  copy.use();
  gl.uniform1i(copy.u('uSrc'), 0);
  ringProg.use();
  gl.uniform1i(ringProg.u('uSrc'), 0);
  quadProg.use();
  gl.uniform1i(quadProg.u('uSrc'), 0);
  gl.uniform1i(quadProg.u('uRing'), 1);
  const corners = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const inst = gl.createBuffer();
  let instBytes = 0;
  const vaoFor = (p: Program): WebGLVertexArrayObject | null => {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const aCorner = gl.getAttribLocation(p.program, 'aCorner');
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.enableVertexAttribArray(aCorner);
    gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, 8, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, inst);
    const aSpot = gl.getAttribLocation(p.program, 'aSpot');
    gl.enableVertexAttribArray(aSpot);
    gl.vertexAttribPointer(aSpot, 4, gl.FLOAT, false, 24, 0);
    gl.vertexAttribDivisor(aSpot, 1);
    const aDonor = gl.getAttribLocation(p.program, 'aDonor');
    gl.enableVertexAttribArray(aDonor);
    gl.vertexAttribPointer(aDonor, 2, gl.FLOAT, false, 24, 16);
    gl.vertexAttribDivisor(aDonor, 1);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return vao;
  };
  const ringVao = vaoFor(ringProg);
  const quadVao = vaoFor(quadProg);

  return {
    draw(src, dst, ring, spots, win, srcSize) {
      gl.disable(gl.BLEND);
      copy.use();
      bindTexture(gl, 0, src);
      bindTarget(gl, dst);
      drawFullscreen(gl);
      if (!spots.length) {
        bindTexture(gl, 0, null);
        return;
      }
      const data = packSpots(spots);
      gl.bindBuffer(gl.ARRAY_BUFFER, inst);
      if (data.byteLength > instBytes) {
        instBytes = data.byteLength;
        gl.bufferData(gl.ARRAY_BUFFER, instBytes, gl.DYNAMIC_DRAW);
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      // RING (k, s)
      ringProg.use();
      gl.uniform4f(ringProg.u('uWin'), win[0], win[1], win[2], win[3]);
      gl.uniform2f(ringProg.u('uSrcPx'), srcSize.width, srcSize.height);
      gl.uniform1f(ringProg.u('uRows'), spots.length);
      bindTarget(gl, ring);
      gl.bindVertexArray(ringVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, spots.length);
      // spot quads over the copy
      quadProg.use();
      gl.uniform4f(quadProg.u('uWin'), win[0], win[1], win[2], win[3]);
      gl.uniform2f(quadProg.u('uSrcPx'), srcSize.width, srcSize.height);
      bindTexture(gl, 1, ring.tex);
      bindTarget(gl, dst);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(quadVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, spots.length);
      gl.disable(gl.BLEND);
      // back to the default factors: the MAX / MIN passes ignore them, but no later pass inherits premultiplied blending
      gl.blendFunc(gl.ONE, gl.ZERO);
      gl.bindVertexArray(null);
      bindTexture(gl, 0, null);
      bindTexture(gl, 1, null);
    },
    dispose() {
      copy.dispose();
      ringProg.dispose();
      quadProg.dispose();
      gl.deleteVertexArray(ringVao);
      gl.deleteVertexArray(quadVao);
      gl.deleteBuffer(corners);
      gl.deleteBuffer(inst);
    },
  };
}
