// P0 skin mask (new, not GPUPixel): 1 inside FACE_OVAL with a feathered outer ring, eye and mouth holes punched with
// MIN blending (RB §2.5, plan T2). v0.4 (S §4.2): RGBA8, R = 磨皮 and G = 紅潤 strength, one oval per face at its own
// relative strength over a clear of the global skin; with one face exactly v0.3's mix(1, mask, faceWeight).
import type { Face } from '../../types';
import { bindTarget, createProgram } from '../gl/gl';
import type { Framebuffer, GL, Program } from '../gl/gl';

export interface MaskFace {
  face: Face;
  weight: number;
  /** (kS, kR): this face's 磨皮 / 紅潤 relative to the frame maxima (uniforms.ts skinMaxima) */
  k: readonly [number, number];
}

export interface MaskPass {
  /**
   * Clear `dst` (RGBA8, ¼ res) to `clear` = (gS, gR), then draw every face (S §4.2): all rings with MAX blending, all
   * oval fans with blending off (inside its own oval a face's strength always wins), all eye / mouth holes with MIN.
   * R = 磨皮 strength, G = 紅潤 strength. `view` (step 3): `win` = the O rect `dst` covers (a tile's window), `aspect` =
   * the iso metric of the feathers (the working bitmap's, oAspect); omitted = the whole image at dst's aspect (v0.3).
   */
  drawFaces(
    dst: Framebuffer,
    faces: readonly MaskFace[],
    clear: readonly [number, number],
    view?: { win: readonly [number, number, number, number]; aspect?: number },
  ): void;
  /** one face, v0.3's mask in both channels: 1 − w outside, 1 − w + w·m inside */
  draw(dst: Framebuffer, face: Face, faceWeight: number): void;
  /**
   * Fill both channels of `dst` with `value`. The pipeline does not call this: with no face / mask disabled it skips
   * the mask pass and binds the white texture instead (planPasses). Used by the T2 harness to check the clear path.
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
in vec2 aPos;   // O-space UV, top-left origin
in float aVal;  // 1 = mask on, 0 = off
uniform vec4 uWin; // the O rect the target covers (a tile's window); (0, 0, 1, 1) = the whole image
out float vVal;
void main() {
  vVal = aVal;
  vec2 q = (aPos - uWin.xy) / uWin.zw;
  gl_Position = vec4(q * 2.0 - 1.0, 0.0, 1.0);
}`;

const MASK_FS = /* glsl */ `#version 300 es
precision highp float;
in float vVal;
uniform vec2 uG;   // the clear (gS, gR)
uniform vec2 uWK;  // this face: weight · (kS, kR)
out vec4 outColor;
void main() {
  float m = smoothstep(0.0, 1.0, vVal);
  outColor = vec4(uG + uWK * m, 0.0, 1.0);
}`;

type V2 = [number, number];

/**
 * Triangle list (x, y, value) for the mask, written into `out` from index 0. `aspect` = W/H; offsets are isotropic.
 * Returns [vertexCount, base, fanEnd]: fans [0, fanEnd), ring [fanEnd, base), holes [base, vertexCount) (the holes are
 * drawn with MIN blending; MaskPass.drawFaces draws every face's ring, then every fan, then every hole).
 * `ringIso`: the outer ring's width in iso units (default `MASK_FEATHER.ring · fw`; 膚色 passes w_T, skin-cleanup spec §4.2).
 */
export function buildMaskGeometry(face: Face, aspect: number, out: Float32Array, ringIso?: number): [number, number, number] {
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
  const ring = ringIso ?? MASK_FEATHER.ring * faceW;
  for (let i = 0; i < oval.length; i++) tri(oc, 1, oval[i], 1, oval[(i + 1) % oval.length], 1);
  const fanEnd = n / 3;
  for (let i = 0; i < oval.length; i++) {
    const a = oval[i];
    const b = oval[(i + 1) % oval.length];
    const ao = away(a, oc, ring);
    const bo = away(b, oc, ring);
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
  return [n / 3, base, fanEnd];
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

  const clearTo = (dst: Framebuffer, c: readonly [number, number]) => {
    bindTarget(gl, dst);
    gl.clearColor(c[0], c[1], 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.clearColor(0, 0, 0, 0);
  };
  const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

  const drawFaces: MaskPass['drawFaces'] = (dst, faces, clear, view) => {
    const g: [number, number] = [clamp01(clear[0]), clamp01(clear[1])];
    clearTo(dst, g);
    const list = faces.filter((f) => f.face.oval.length >= 6);
    if (!list.length) return;
    const need = list.reduce((s, f) => s + ((f.face.oval.length / 2) * 3 + (6 + 6 + 12) * 3) * 9, 0);
    if (need > verts.length) verts = new Float32Array(need);
    const segs: { start: number; count: number; base: number; fanEnd: number; wk: [number, number] }[] = [];
    let at = 0;
    const aspect = view?.aspect ?? dst.width / dst.height;
    for (const f of list) {
      const w = clamp01(f.weight);
      const [count, base, fanEnd] = buildMaskGeometry(f.face, aspect, verts.subarray(at * 3));
      segs.push({ start: at, count, base, fanEnd, wk: [w * clamp01(f.k[0]), w * clamp01(f.k[1])] });
      at += count;
    }
    prog.use();
    const win = view?.win ?? [0, 0, 1, 1];
    gl.uniform4f(prog.u('uWin'), win[0], win[1], win[2], win[3]);
    gl.uniform2f(prog.u('uG'), g[0], g[1]);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    if (verts.byteLength > bufBytes) {
      bufBytes = verts.byteLength;
      gl.bufferData(gl.ARRAY_BUFFER, bufBytes, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts, 0, at * 3);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.disable(gl.CULL_FACE);
    const each = (from: (s: (typeof segs)[number]) => number, to: (s: (typeof segs)[number]) => number) => {
      for (const s of segs) {
        gl.uniform2f(prog.u('uWK'), s.wk[0], s.wk[1]);
        gl.drawArrays(gl.TRIANGLES, s.start + from(s), to(s) - from(s));
      }
    };
    // 1. rings take the larger strength where they overlap
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);
    each((s) => s.fanEnd, (s) => s.base);
    // 2. fans overwrite: inside its own oval each face writes its own strength (a neighbour's ring never lifts it)
    gl.disable(gl.BLEND);
    each(() => 0, (s) => s.fanEnd);
    // 3. holes only ever lower the mask
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MIN);
    each((s) => s.base, (s) => s.count);
    gl.blendEquation(gl.FUNC_ADD);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  };

  return {
    drawFaces,
    draw(dst, face, faceWeight) {
      const w = clamp01(faceWeight);
      drawFaces(dst, w > 0 ? [{ face, weight: w, k: [1, 1] }] : [], [1 - w, 1 - w]);
    },
    fill(dst, value) {
      clearTo(dst, [value, value]);
    },
    dispose() {
      prog.dispose();
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(buf);
    },
  };
}
