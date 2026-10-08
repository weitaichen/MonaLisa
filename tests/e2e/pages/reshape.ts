// Pins the CPU port (src/engine/passes/reshapeCpu.ts) to the real RESHAPE_FS: the reshape pass samples an identity
// coordinate texture (RGBA32F, LINEAR: each texel holds its own UV), so every output pixel holds the source UV the
// shader sampled there, and the port's map at the same pixel centre must agree. Run by tests/e2e/reshape.spec.ts on
// the dev server (this page imports src/ directly).
import landmarks from '../../fixtures/landmarks_sample_face.json';
import { createReshapePass, reshapeUniforms } from '../../../src/engine/passes/reshape';
import { reshapeMapCpu } from '../../../src/engine/passes/reshapeCpu';
import { applyPreset, setParam } from '../../../src/engine/params';
import { adapt } from '../../../src/tracking/adapter111';
import type { BodyField, ParamId } from '../../../src/types';
import type { Framebuffer, Texture } from '../../../src/engine/gl/gl';

export interface PinCase {
  name: string;
  /** output pixels compared (their CPU source UV lies where the identity texture is exact) */
  n: number;
  /** compared pixels the warp moved by more than 1 px (the comparison is not vacuous) */
  moved: number;
  /** max |GPU − CPU| over the compared pixels, in output px */
  maxErrPx: number;
  /** a few sample points: [u, v, gpu u, gpu v, cpu u, cpu v] */
  samples: number[][];
}

declare global {
  interface Window {
    runReshapePin?: () => PinCase[];
  }
}

/** identity texture size: texel centres hold (i + 0.5) / N, exact in float32 */
const N = 256;

window.runReshapePin = () => {
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('no webgl2');
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float missing');
  if (!gl.getExtension('OES_texture_float_linear')) throw new Error('OES_texture_float_linear missing');

  const tex = (w: number, h: number, internal: number, format: number, data: Float32Array | null): Texture => {
    const t = gl.createTexture();
    if (!t) throw new Error('createTexture failed');
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, gl.FLOAT, data);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.LINEAR);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
    return { tex: t, width: w, height: h };
  };
  const id = new Float32Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) id.set([(x + 0.5) / N, (y + 0.5) / N, 0, 1], (y * N + x) * 4); // row 0 = image top
  const src = tex(N, N, gl.RGBA32F, gl.RGBA, id);

  const { width: W, height: H } = landmarks;
  const aspect = W / H;
  // same aspect as the 1000×1500 photo
  const ow = 200;
  const oh = 300;
  const out = tex(ow, oh, gl.RGBA32F, gl.RGBA, null);
  const fbo = gl.createFramebuffer();
  if (!fbo) throw new Error('createFramebuffer failed');
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out.tex, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('RGBA32F framebuffer incomplete');
  const dst: Framebuffer = { fbo, tex: out, internalFormat: gl.RGBA32F, width: ow, height: oh };

  // a smooth body field, uploaded RG16F from FLOAT data like the engine (pipeline.ts); the half-float rounding of
  // these values is < 1e-5 UV, far below the tolerance
  const bw = 24;
  const bh = 36;
  const bd = new Float32Array(bw * bh * 2);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      bd[(y * bw + x) * 2] = 0.012 * Math.sin((x / bw) * 6) * Math.cos((y / bh) * 4);
      bd[(y * bw + x) * 2 + 1] = 0.008 * Math.cos((x / bw) * 5);
    }
  const bodyTex = tex(bw, bh, gl.RG16F, gl.RG, bd);
  const bodyField: BodyField = { width: bw, height: bh, data: bd, version: 1 };

  const face = adapt({ points: new Float32Array(landmarks.points) }, W, H);
  const at = (ids: ParamId[]) => ids.reduce((p, k) => setParam(p, k, 1), applyPreset('original', 1)).values;
  const contour: ParamId[] = ['shape.faceSlim', 'shape.faceV', 'shape.faceNarrow'];
  const cases: { name: string; ids: ParamId[]; body: boolean }[] = [
    { name: 'contour (slim + V + narrow)', ids: contour, body: false },
    {
      name: 'every face warp',
      ids: [...contour, 'shape.chin', 'shape.forehead', 'shape.noseSlim', 'shape.mouthSize', 'shape.eyeDistance', 'shape.eyeEnlarge'],
      body: false,
    },
    { name: 'body field + contour', ids: contour, body: true },
  ];

  const pass = createReshapePass(gl);
  const px = new Float32Array(ow * oh * 4);
  const res: PinCase[] = [];
  const lo = 0.5 / N;
  const hi = 1 - 0.5 / N;
  for (const c of cases) {
    const u = reshapeUniforms(at(c.ids), 1);
    pass.draw(src, dst, face, u, aspect, c.body ? bodyTex : null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.readPixels(0, 0, ow, oh, gl.RGBA, gl.FLOAT, px); // FBO row 0 = vUv.y 0 = image top
    const map = reshapeMapCpu(face, u, aspect, c.body ? bodyField : null);
    let n = 0;
    let moved = 0;
    let maxErr = 0;
    const samples: number[][] = [];
    for (let y = 0; y < oh; y++)
      for (let x = 0; x < ow; x++) {
        const uu = (x + 0.5) / ow;
        const vv = (y + 0.5) / oh;
        const s = map(uu, vv);
        if (s[0] < lo || s[1] < lo || s[0] > hi || s[1] > hi) continue; // clamped by the texture edge
        const gu = px[(y * ow + x) * 4];
        const gv = px[(y * ow + x) * 4 + 1];
        n++;
        if (Math.hypot((s[0] - uu) * ow, (s[1] - vv) * oh) > 1) moved++;
        maxErr = Math.max(maxErr, Math.hypot((gu - s[0]) * ow, (gv - s[1]) * oh));
        if (x % 50 === 25 && y % 60 === 30) samples.push([uu, vv, gu, gv, s[0], s[1]]);
      }
    res.push({ name: c.name, n, moved, maxErrPx: maxErr, samples });
  }
  pass.dispose();
  return res;
};
