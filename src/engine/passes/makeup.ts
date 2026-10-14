/*
 * GPUPixel
 *
 * Created by PixPark on 2021/6/24.
 * Copyright © 2021 PixPark. All rights reserved.
 */
// Derived from GPUPixel src/filter/face_makeup_filter.cc, lipstick_filter.cc, blusher_filter.cc
// (GLES variant, pixpark/gpupixel@ef552bf, Apache-2.0); modified: GLSL ES 3.00; VAO/VBO/Uint16 IBO;
// lipstick and blusher merged into one mesh draw (multiply commutes, so the result equals the two
// sequential GPUPixel filters); base sampled by gl_FragCoord from the source texture; optional
// shade tint through single-channel masks (RB §2.5); v0.4: one mesh per face, each reading the source, fragments
// without makeup discarded so a later face never erases an earlier face's lip or blush (S §4.3). Step 5: the procedural
// layers of makeupProc.ts (original work, not GPUPixel) are drawn after every face's mesh.
import type { Face, PersonParams } from '../../types';
import { shadeColor } from '../params';
import {
  COPY_FS,
  FULLSCREEN_VS,
  bindTarget,
  bindTexture,
  createProgram,
  deleteTexture,
  drawFullscreen,
  hexToRgb,
  loadImageTexture,
} from '../gl/gl';
import type { Framebuffer, GL, Program, Texture } from '../gl/gl';
import { BLUSH_BOUNDS, FACE_INDICES, LIP_BOUNDS, templateUvs } from './faceMesh';
import { createProcMakeupPass, type MakeupGeometry, type MakeupLayer, type ProcMakeupPass } from './makeupProc';

export interface MakeupUniforms {
  /** 0..1 intensity × faceWeight */
  lip: number;
  blush: number;
  /** sRGB 0..1 tint, or null = GPUPixel original texture colour (原色) */
  lipColor: [number, number, number] | null;
  blushColor: [number, number, number] | null;
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** one person's makeup uniforms at a face weight (S §4.3) */
export function makeupUniformsFor(person: PersonParams, weight: number): MakeupUniforms {
  const w = clamp01(weight);
  const lipHex = shadeColor('lip', person.shades.lip);
  const blushHex = shadeColor('blush', person.shades.blush);
  return {
    lip: clamp01(person.values['makeup.lip']) * w,
    blush: clamp01(person.values['makeup.blush']) * w,
    lipColor: lipHex ? hexToRgb(lipHex) : null,
    blushColor: blushHex ? hexToRgb(blushHex) : null,
  };
}

export function makeupActive(u: MakeupUniforms): boolean {
  return u.lip > 1e-4 || u.blush > 1e-4;
}

const MESH_VS = /* glsl */ `#version 300 es
in vec2 aPos;      // landmark·2 − 1 (no Y flip: row 0 = image top, gl.ts convention)
in vec2 aUvLip;
in vec2 aUvBlush;
in float aBlushFade;
out vec2 vUvLip;
out vec2 vUvBlush;
out float vBlushFade;
void main() {
  vUvLip = aUvLip;
  vUvBlush = aUvBlush;
  vBlushFade = aBlushFade;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// GPUPixel blend mode 15 (multiply) with an opaque texture reduces to bg·mix(1, tex, intensity).
const MESH_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUvLip;
in vec2 vUvBlush;
in float vBlushFade;
uniform sampler2D uBase;
uniform sampler2D uLip;
uniform sampler2D uLipMask;
uniform sampler2D uBlush;
uniform sampler2D uBlushMask;
uniform vec2 uInvDst;
uniform float uLipI;
uniform float uBlushI;
uniform bool uLipTint;
uniform bool uBlushTint;
uniform vec3 uLipShade;
uniform vec3 uBlushShade;
out vec4 outColor;
void main() {
  vec3 base = texture(uBase, gl_FragCoord.xy * uInvDst).rgb;
  vec3 lipMul = uLipTint ? mix(vec3(1.0), uLipShade, texture(uLipMask, vUvLip).r)
                         : texture(uLip, vUvLip).rgb;
  vec3 blushMul = uBlushTint ? mix(vec3(1.0), uBlushShade, texture(uBlushMask, vUvBlush).r)
                             : texture(uBlush, vUvBlush).rgb;
  vec3 m = mix(vec3(1.0), lipMul, uLipI) * mix(vec3(1.0), blushMul, uBlushI * vBlushFade);
  // a fragment without makeup keeps the copy (= src) bit for bit, so a later face's mesh never erases an earlier
  // face's lip or blush where the later face has none (S §4.3)
  if (all(greaterThanEqual(m, vec3(0.999)))) discard;
  outColor = vec4(base * m, 1.0);
}`;

/**
 * Per-vertex blush weight: 0 on the cheek / nose-side seam (inner lower lid, inner eye corner,
 * nose-bridge side, nose wing, alar base), 1 elsewhere. The blusher texture's inner tail crosses
 * that seam, and on turned faces the triangles beyond it ([56,80,55], [55,80,78] and mirror)
 * collapse to slivers, which squeezes the tail into a hard edge. Fading to 0 on the seam ends the
 * blush softly inside the broad cheek triangles instead (port addition, not GPUPixel).
 */
export const BLUSH_SEAM = [55, 56, 78, 80, 82, 58, 63, 79, 81, 83] as const;

export function blushFade(): Float32Array {
  const w = new Float32Array(111).fill(1);
  for (const i of BLUSH_SEAM) w[i] = 0;
  return w;
}

export interface MakeupPass {
  /** settles once the GPUPixel textures and lashes.png have each loaded or failed (S5 §4.10); never rejects */
  readonly ready: Promise<void>;
  /** the GPUPixel lip / blush textures are uploaded (口紅, 腮紅) */
  readonly meshReady: boolean;
  /** Copy `src` (any size, by UV) into `dst`, then draw makeup on top. `src` must not alias `dst`. */
  draw(src: Texture, dst: Framebuffer, face: Face, u: MakeupUniforms): void;
  /**
   * Copy src into dst, draw every face's GPUPixel mesh (step 1), then the procedural layers of proc over every face at
   * once (S5 §4.6). src must not alias dst. Returns the procedural layers drawn. One mesh per face whose makeup is
   * active, each reading src (S §4.3); `win` (step 3) = the O rect src and dst cover (a tile's window), default the
   * whole image.
   */
  drawFaces(
    src: Texture,
    dst: Framebuffer,
    faces: readonly { face: Face; u: MakeupUniforms }[],
    proc: MakeupGeometry | null,
    win?: readonly [number, number, number, number],
  ): MakeupLayer[];
  /** compile PMAKEUP on first use (lazy: the first frame with a procedural item); false once it failed */
  ensureProc(): boolean;
  procStatus(): 'unknown' | 'ok' | 'failed';
  dispose(): void;
}

interface MakeupTextures {
  lip: Texture;
  lipMask: Texture;
  blush: Texture;
  blushMask: Texture;
}

/** `assetBase` must end with '/'; it holds lip.png, lip_mask.png, blush.png, blush_mask.png. `lashesUrl`: 睫毛 (S5 §4.10). */
export function createMakeupPass(gl: GL, assetBase = '/makeup/gp/', lashesUrl = '/makeup/own/lashes.png'): MakeupPass {
  const copy: Program = createProgram(gl, FULLSCREEN_VS, COPY_FS, 'makeup-copy');
  copy.use();
  gl.uniform1i(copy.u('uSrc'), 0);

  const mesh: Program = createProgram(gl, MESH_VS, MESH_FS, 'makeup-mesh');
  mesh.use();
  gl.uniform1i(mesh.u('uBase'), 0);
  gl.uniform1i(mesh.u('uLip'), 1);
  gl.uniform1i(mesh.u('uLipMask'), 2);
  gl.uniform1i(mesh.u('uBlush'), 3);
  gl.uniform1i(mesh.u('uBlushMask'), 4);

  const vao = gl.createVertexArray();
  const posBuf = gl.createBuffer();
  const uvBuf = gl.createBuffer();
  const ibo = gl.createBuffer();
  const pos = new Float32Array(222);

  gl.bindVertexArray(vao);
  const aPos = gl.getAttribLocation(mesh.program, 'aPos');
  const aUvLip = gl.getAttribLocation(mesh.program, 'aUvLip');
  const aUvBlush = gl.getAttribLocation(mesh.program, 'aUvBlush');
  const aBlushFade = gl.getAttribLocation(mesh.program, 'aBlushFade');

  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, pos.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  // Static attributes in one buffer: lip UVs, blush UVs, blush fade.
  const statics = new Float32Array(222 + 222 + 111);
  statics.set(templateUvs(LIP_BOUNDS), 0);
  statics.set(templateUvs(BLUSH_BOUNDS), 222);
  statics.set(blushFade(), 444);
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
  gl.bufferData(gl.ARRAY_BUFFER, statics, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(aUvLip);
  gl.vertexAttribPointer(aUvLip, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aUvBlush);
  gl.vertexAttribPointer(aUvBlush, 2, gl.FLOAT, false, 0, 222 * 4);
  gl.enableVertexAttribArray(aBlushFade);
  gl.vertexAttribPointer(aBlushFade, 1, gl.FLOAT, false, 0, 444 * 4);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, FACE_INDICES, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  let tex: MakeupTextures | null = null;
  let lashesTex: Texture | null = null;
  let meshReady = false;
  let disposed = false;
  const meshLoad = Promise.all(
    ['lip.png', 'lip_mask.png', 'blush.png', 'blush_mask.png'].map((f) => loadImageTexture(gl, assetBase + f)),
  ).then(
    ([lip, lipMask, blush, blushMask]) => {
      if (disposed) {
        for (const t of [lip, lipMask, blush, blushMask]) deleteTexture(gl, t);
        return;
      }
      tex = { lip, lipMask, blush, blushMask };
      meshReady = true;
    },
    (err: unknown) => console.error('[engine] makeup textures failed to load; 口紅 and 腮紅 disabled', err),
  );
  // a lashes failure disables only 睫毛, as a GPUPixel failure disables only 口紅 / 腮紅 (S5 §4.10)
  const lashLoad = loadImageTexture(gl, lashesUrl, { r8: true, mipmap: true }).then(
    (t) => {
      if (disposed) deleteTexture(gl, t);
      else lashesTex = t;
    },
    (err: unknown) => console.error('[engine] lashes.png failed to load; 睫毛 disabled', err),
  );
  const ready = Promise.all([meshLoad, lashLoad]).then(() => undefined);
  let proc: ProcMakeupPass | null = null;
  let procState: 'unknown' | 'ok' | 'failed' = 'unknown';
  const ensureProc = (): boolean => {
    if (procState === 'unknown') {
      try {
        proc = createProcMakeupPass(gl);
        procState = 'ok';
      } catch (err) {
        procState = 'failed';
        console.error('[engine] PMAKEUP failed to compile; the procedural makeup is disabled', err);
      }
    }
    return procState === 'ok';
  };

  const drawFaces: MakeupPass['drawFaces'] = (src, dst, faces, geom, win = [0, 0, 1, 1]) => {
    bindTarget(gl, dst);
    gl.disable(gl.BLEND);
    copy.use();
    bindTexture(gl, 0, src);
    drawFullscreen(gl);
    let drew = false;
    for (const { face, u } of faces) {
      // no GPUPixel textures (still loading, or failed): no mesh, but the procedural layers below still draw (S5 §4.10)
      if (!tex || !makeupActive(u)) continue;
      drew = true;
      const p = face.pts111;
      // the landmark mapped into the target window on the CPU (S §4.2 P1): at the whole image (p − 0) / 1 = p exactly,
      // so the identity case is bit-identical (a shader round trip aPos·0.5 + 0.5 would round)
      for (let i = 0; i < 222; i += 2) {
        pos[i] = ((p[i] - win[0]) / win[2]) * 2 - 1;
        pos[i + 1] = ((p[i + 1] - win[1]) / win[3]) * 2 - 1;
      }
      mesh.use();
      gl.uniform2f(mesh.u('uInvDst'), 1 / dst.width, 1 / dst.height);
      gl.uniform1f(mesh.u('uLipI'), clamp01(u.lip));
      gl.uniform1f(mesh.u('uBlushI'), clamp01(u.blush));
      gl.uniform1i(mesh.u('uLipTint'), u.lipColor ? 1 : 0);
      gl.uniform1i(mesh.u('uBlushTint'), u.blushColor ? 1 : 0);
      gl.uniform3fv(mesh.u('uLipShade'), u.lipColor ?? [1, 1, 1]);
      gl.uniform3fv(mesh.u('uBlushShade'), u.blushColor ?? [1, 1, 1]);
      bindTexture(gl, 1, tex.lip);
      bindTexture(gl, 2, tex.lipMask);
      bindTexture(gl, 3, tex.blush);
      bindTexture(gl, 4, tex.blushMask);
      bindTexture(gl, 0, src);

      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      // No culling: four template triangles have zero area and flip harmlessly (RB §2.5).
      gl.disable(gl.CULL_FACE);
      gl.drawElements(gl.TRIANGLES, FACE_INDICES.length, gl.UNSIGNED_SHORT, 0);
      gl.bindVertexArray(null);
    }
    if (drew) gl.activeTexture(gl.TEXTURE0);
    if (!proc || !geom || procState !== 'ok') return [];
    return proc.draw(dst, geom, src, lashesTex, win);
  };

  return {
    ready,
    get meshReady() {
      return meshReady;
    },
    draw(src, dst, face, u) {
      drawFaces(src, dst, [{ face, u }], null);
    },
    drawFaces,
    ensureProc,
    procStatus: () => procState,
    dispose() {
      disposed = true;
      copy.dispose();
      mesh.dispose();
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(posBuf);
      gl.deleteBuffer(uvBuf);
      gl.deleteBuffer(ibo);
      if (tex) for (const t of Object.values(tex)) deleteTexture(gl, t);
      tex = null;
      // every procedural object belongs to this pass: a restored context gets a new pass, never these (S5 §7)
      proc?.dispose();
      deleteTexture(gl, lashesTex);
      lashesTex = null;
      proc = null;
    },
  };
}
