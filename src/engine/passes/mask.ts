// P0 face mask (new, not GPUPixel): R8, 1 inside FACE_OVAL with a feathered outer ring, eye and
// mouth holes punched with MIN blending, then mix(1, mask, faceWeight) (RB §2.5, plan T2).
import type { Face } from '../../types';
import { bindTarget, createProgram } from '../gl/gl';
import type { Framebuffer, GL, Program } from '../gl/gl';

export interface MaskPass {
  /** Clear `dst` (R8, typically ¼ processing res) and draw the feathered face mask (1 inside, 0 outside). */
  draw(dst: Framebuffer, face: Face, faceWeight: number): void;
  /**
   * Fill `dst` with `value`. The pipeline does not call this: with no face / mask disabled it skips the mask pass
   * and binds the white texture instead (planPasses). Used by the T2 harness to check the clear path.
   */
  fill(dst: Framebuffer, value: number): void;
  dispose(): void;
}

/** Feather widths. Ring = fraction of face width (p0–p32); holes = fraction of eye / mouth width. */
export const MASK_FEATHER = {
  ring: 0.08,
  // Holes stay tight so the under-eye area and the skin around the lips are still smoothed.
  eyePad: 0.08,
  eyeFeather: 0.25,
  mouthPad: 0.02,
  mouthFeather: 0.15,
} as const;

const EYE_L = [52, 53, 54, 55, 56, 57] as const;
const EYE_R = [58, 59, 60, 61, 62, 63] as const;
const MOUTH = [84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95] as const;

const MASK_VS = /* glsl */ `#version 300 es
in vec2 aPos;   // UV, top-left origin
in float aVal;  // 1 = mask on, 0 = off
out float vVal;
void main() {
  vVal = aVal;
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
}`;

const MASK_FS = /* glsl */ `#version 300 es
precision highp float;
in float vVal;
uniform float uWeight;
out vec4 outColor;
void main() {
  float m = smoothstep(0.0, 1.0, vVal);
  outColor = vec4(1.0 - uWeight + uWeight * m, 0.0, 0.0, 1.0);
}`;

type V2 = [number, number];

/**
 * Triangle list (x, y, value) for the mask. `aspect` = W/H; offsets are isotropic.
 * Returns [vertices, baseVertexCount]: the first `baseVertexCount` vertices are the oval + ring,
 * the rest are the holes (drawn with MIN blending).
 */
export function buildMaskGeometry(face: Face, aspect: number, out: Float32Array): [number, number] {
  let n = 0;
  const push = (p: V2, v: number) => {
    out[n++] = p[0];
    out[n++] = p[1];
    out[n++] = v;
  };
  const tri = (a: V2, av: number, b: V2, bv: number, c: V2, cv: number) => {
    push(a, av);
    push(b, bv);
    push(c, cv);
  };
  const isoDist = (a: V2, b: V2) => Math.hypot(a[0] - b[0], (a[1] - b[1]) / aspect);
  // Point `p` pushed away from centre `c` by `d` (iso units), radially.
  const away = (p: V2, c: V2, d: number): V2 => {
    const dx = p[0] - c[0];
    const dy = (p[1] - c[1]) / aspect;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return p;
    return [p[0] + (dx / len) * d, p[1] + (dy / len) * d * aspect];
  };
  const centroid = (pts: V2[]): V2 => {
    let x = 0;
    let y = 0;
    for (const p of pts) {
      x += p[0];
      y += p[1];
    }
    return [x / pts.length, y / pts.length];
  };
  const P = (i: number): V2 => [face.pts111[i * 2], face.pts111[i * 2 + 1]];

  // Oval fan + outward ring 1 → 0.
  const oval: V2[] = [];
  for (let i = 0; i < face.oval.length; i += 2) oval.push([face.oval[i], face.oval[i + 1]]);
  const oc = centroid(oval);
  const faceW = isoDist(P(0), P(32));
  const ring = MASK_FEATHER.ring * faceW;
  for (let i = 0; i < oval.length; i++) {
    const a = oval[i];
    const b = oval[(i + 1) % oval.length];
    const ao = away(a, oc, ring);
    const bo = away(b, oc, ring);
    tri(oc, 1, a, 1, b, 1);
    tri(a, 1, b, 1, bo, 0);
    tri(a, 1, bo, 0, ao, 0);
  }
  const base = n / 3;

  // Holes: polygon pushed out by `pad` at 0, feathered to 1 over `feather`.
  const hole = (idx: readonly number[], widthOf: [number, number], pad: number, feather: number) => {
    const poly = idx.map(P);
    const c = centroid(poly);
    const w = isoDist(P(widthOf[0]), P(widthOf[1]));
    const inner = poly.map((p) => away(p, c, pad * w));
    const outer = poly.map((p) => away(p, c, (pad + feather) * w));
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length;
      tri(c, 0, inner[i], 0, inner[j], 0);
      tri(inner[i], 0, inner[j], 0, outer[j], 1);
      tri(inner[i], 0, outer[j], 1, outer[i], 1);
    }
  };
  hole(EYE_L, [52, 55], MASK_FEATHER.eyePad, MASK_FEATHER.eyeFeather);
  hole(EYE_R, [58, 61], MASK_FEATHER.eyePad, MASK_FEATHER.eyeFeather);
  hole(MOUTH, [84, 90], MASK_FEATHER.mouthPad, MASK_FEATHER.mouthFeather);
  return [n / 3, base];
}

/** Upper bound of floats written by buildMaskGeometry (36-pt oval, 6+6+12 hole points). */
export const MASK_MAX_FLOATS = (36 * 3 + (6 + 6 + 12) * 3) * 3 * 3;

export function createMaskPass(gl: GL): MaskPass {
  const prog: Program = createProgram(gl, MASK_VS, MASK_FS, 'mask');
  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
  let verts = new Float32Array(MASK_MAX_FLOATS);
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  let bufBytes = verts.byteLength;
  gl.bufferData(gl.ARRAY_BUFFER, bufBytes, gl.DYNAMIC_DRAW);
  const aPos = gl.getAttribLocation(prog.program, 'aPos');
  const aVal = gl.getAttribLocation(prog.program, 'aVal');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 12, 0);
  gl.enableVertexAttribArray(aVal);
  gl.vertexAttribPointer(aVal, 1, gl.FLOAT, false, 12, 8);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  const clearTo = (dst: Framebuffer, v: number) => {
    bindTarget(gl, dst);
    gl.clearColor(v, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.clearColor(0, 0, 0, 0);
  };

  return {
    draw(dst, face, faceWeight) {
      const w = Number.isFinite(faceWeight) ? Math.min(1, Math.max(0, faceWeight)) : 0;
      clearTo(dst, 1 - w);
      if (w <= 0 || face.oval.length < 6) return;
      const need = ((face.oval.length / 2) * 3 + (6 + 6 + 12) * 3) * 9;
      if (need > verts.length) verts = new Float32Array(need);
      const [count, base] = buildMaskGeometry(face, dst.width / dst.height, verts);

      prog.use();
      gl.uniform1f(prog.u('uWeight'), w);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      if (verts.byteLength > bufBytes) {
        bufBytes = verts.byteLength;
        gl.bufferData(gl.ARRAY_BUFFER, bufBytes, gl.DYNAMIC_DRAW);
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts, 0, count * 3);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      gl.drawArrays(gl.TRIANGLES, 0, base);
      // Holes take the minimum so they only ever lower the mask, wherever they overlap.
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.MIN);
      gl.drawArrays(gl.TRIANGLES, base, count - base);
      gl.blendEquation(gl.FUNC_ADD);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
    },
    fill(dst, value) {
      clearTo(dst, value);
    },
    dispose() {
      prog.dispose();
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(buf);
    },
  };
}
