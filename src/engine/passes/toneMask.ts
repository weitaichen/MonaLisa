// P0 region targets R and Q of the 膚質 tools (skin-cleanup spec §4.2): toneGeometry's triangle lists drawn into a ¼-res
// RGBA8 target, each with its own blend equation (MAX / MIN) and colour mask. R is cleared to 0, Q to (0, 0, ZERO, 0).
// Original work.
import { bindTarget, createProgram, type Framebuffer, type GL, type Program } from '../gl/gl';
import type { Rgba, ToneDraw, Win } from './toneGeometry';

const TONE_MASK_VS = /* glsl */ `#version 300 es
in vec2 aPos;      // O-normalized uv
in float aVal;
uniform vec4 uWin; // O rect the target covers
out float vVal;
void main() {
  vVal = aVal;
  vec2 q = (aPos - uWin.xy) / uWin.zw;
  gl_Position = vec4(q * 2.0 - 1.0, 0.0, 1.0);
}`;

const TONE_MASK_FS = /* glsl */ `#version 300 es
precision highp float;
in float vVal;
uniform vec4 uOff;
uniform vec4 uStr;
out vec4 outColor;
void main() { outColor = uOff + uStr * smoothstep(0.0, 1.0, vVal); }`;

export interface ToneMaskPass {
  /** clear `dst` to `clear`, then every draw in ascending phase (then list order), mapped through `win` */
  draw(dst: Framebuffer, draws: readonly ToneDraw[], win: Win, clear: Rgba): void;
  dispose(): void;
}

export function createToneMaskPass(gl: GL): ToneMaskPass {
  const prog: Program = createProgram(gl, TONE_MASK_VS, TONE_MASK_FS, 'toneMask');
  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
  let bytes = 0;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  const aPos = gl.getAttribLocation(prog.program, 'aPos');
  const aVal = gl.getAttribLocation(prog.program, 'aVal');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 12, 0);
  gl.enableVertexAttribArray(aVal);
  gl.vertexAttribPointer(aVal, 1, gl.FLOAT, false, 12, 8);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  return {
    draw(dst, draws, win, clear) {
      bindTarget(gl, dst);
      gl.colorMask(true, true, true, true);
      gl.clearColor(clear[0], clear[1], clear[2], clear[3]);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.clearColor(0, 0, 0, 0);
      if (!draws.length) return;
      const order = draws.map((d, i) => ({ d, i })).sort((a, b) => a.d.phase - b.d.phase || a.i - b.i);
      prog.use();
      gl.uniform4f(prog.u('uWin'), win[0], win[1], win[2], win[3]);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      for (const { d } of order) {
        if (!d.verts.length) continue;
        if (d.verts.byteLength > bytes) {
          bytes = d.verts.byteLength;
          gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.DYNAMIC_DRAW);
        }
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, d.verts);
        gl.blendEquation(d.blend === 'max' ? gl.MAX : gl.MIN);
        gl.colorMask(d.mask[0], d.mask[1], d.mask[2], d.mask[3]);
        gl.uniform4f(prog.u('uOff'), d.off[0], d.off[1], d.off[2], d.off[3]);
        gl.uniform4f(prog.u('uStr'), d.str[0], d.str[1], d.str[2], d.str[3]);
        gl.drawArrays(gl.TRIANGLES, 0, d.verts.length / 3);
      }
      gl.colorMask(true, true, true, true);
      gl.blendEquation(gl.FUNC_ADD);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    },
    dispose() {
      prog.dispose();
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(buf);
    },
  };
}
