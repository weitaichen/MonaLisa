// 瘦臉 background limit (reports/美體修圖 背景扭曲 抑制技術.md stage 1 ②) on the real GPU, run by tests/e2e/faceProtect.spec.ts
// on the dev server (this page imports src/ directly):
//  - pin: RESHAPE_FS with a FaceProtect on an identity coordinate texture vs the CPU port (reshapeCpu.ts), like
//    reshape.ts does for the unlimited warps; plus exact identity of the eye / nose / mouth pixels and of a neutral-
//    contour frame (the other face warps at max) with and without the limit;
//  - engine: the synthetic cheek-against-a-wall portrait through createEngine → renderToImageData with and without
//    the limit: how far the wall beside the cheek moves, and that nothing else changes.
import landmarks from '../../fixtures/landmarks_sample_face.json';
import pose from '../../fixtures/sample_face.pose.json';
import { syntheticPortrait } from '../../../src/body/synthetic';
import { createEngine } from '../../../src/engine/index';
import { createReshapePass, reshapeUniforms } from '../../../src/engine/passes/reshape';
import { reshapeMapCpu } from '../../../src/engine/passes/reshapeCpu';
import { applyPreset, setParam } from '../../../src/engine/params';
import { adapt } from '../../../src/tracking/adapter111';
import { buildFaceProtect } from '../../../src/tracking/faceProtect';
import type { Framebuffer, Texture } from '../../../src/engine/gl/gl';
import type { BeautyParams, BodyField, Face, FaceProtect, ParamId, PersonMask } from '../../../src/types';

export interface ProtectPin {
  name: string;
  n: number;
  moved: number;
  maxErrPx: number;
  /** output pixels the limit changed (GPU, with vs without) */
  limited: number;
  /** eye / nose / mouth pixels whose GPU source UV differs with the limit (must be 0) */
  featureDiff: number;
  featurePx: number;
}

export interface ProtectEngine {
  /** mean |Δ| (0..255) of the wall 0.2–0.38 FW from the cheeks (inside the reach), contour max vs neutral: unlimited / limited */
  wallMadFree: number;
  wallMadLimited: number;
  /** max |Δ| of the wall 0.38–0.45 FW from the cheeks, past PROTECT_REACH (contour max vs neutral) */
  farMaxFree: number;
  farMaxLimited: number;
  /** max |Δ| over the whole frame between limited and unlimited renders at neutral contour (must be 0) */
  neutralMaxDiff: number;
  glErrors: number[];
  passes: string[];
}

declare global {
  interface Window {
    runFaceProtectPin?: () => { pins: ProtectPin[]; neutralDiff: number; neutralPx: number };
    runFaceProtectEngine?: () => Promise<ProtectEngine>;
  }
}

const CONTOUR: ParamId[] = ['shape.faceSlim', 'shape.faceV', 'shape.faceNarrow'];
const at = (ids: ParamId[], base = applyPreset('original', 1)): BeautyParams => ids.reduce((p, k) => setParam(p, k, 1), base);

type V2 = [number, number];
function inPoly(poly: V2[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
/** eyes, nose, mouth outlines (GPUPixel 111 indices) */
function features(face: Face): V2[][] {
  const P = face.pts111;
  const poly = (ids: number[]) => ids.map((i): V2 => [P[i * 2], P[i * 2 + 1]]);
  return [
    poly([52, 72, 53, 54, 55, 56, 73, 57]),
    poly([58, 59, 75, 60, 61, 62, 76, 63]),
    poly([43, 78, 80, 82, 47, 48, 49, 50, 51, 83, 81, 79]),
    poly([84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95]),
  ];
}

function portraitScene() {
  const pr = syntheticPortrait();
  const mw = 192;
  const mh = 256;
  const data = new Uint8Array(mw * mh);
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) data[y * mw + x] = Math.round(255 * pr.inside((x + 0.5) / mw, (y + 0.5) / mh));
  const mask: PersonMask = { width: mw, height: mh, data };
  return { pr, mask, protect: buildFaceProtect(pr.face, mask, pr.width, pr.height) };
}

function sampleFaceScene() {
  const { width: W, height: H } = landmarks;
  const face = adapt({ points: new Float32Array(landmarks.points) }, W, H);
  const bin = atob(pose.mask.data);
  const data = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  const mask: PersonMask = { width: pose.mask.width, height: pose.mask.height, data };
  return { face, W, H, protect: buildFaceProtect(face, mask, W, H) };
}

window.runFaceProtectPin = () => {
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
  const N = 256;
  const id = new Float32Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) id.set([(x + 0.5) / N, (y + 0.5) / N, 0, 1], (y * N + x) * 4);
  const src = tex(N, N, gl.RGBA32F, gl.RGBA, id);
  // uploaded like pipeline.ts: R16F from FLOAT data (the port rounds to half floats the same way)
  const protTex = (p: FaceProtect) => tex(p.width, p.height, gl.R16F, gl.RED, p.data);
  const pass = createReshapePass(gl);

  const portrait = portraitScene();
  const sample = sampleFaceScene();
  const bw = 24;
  const bh = 32;
  const bd = new Float32Array(bw * bh * 2);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      bd[(y * bw + x) * 2] = 0.01 * Math.sin((x / bw) * 6) * Math.cos((y / bh) * 4);
      bd[(y * bw + x) * 2 + 1] = 0.006 * Math.cos((x / bw) * 5);
    }
  const body: BodyField = { width: bw, height: bh, data: bd, version: 1 };
  const bodyTex = tex(bw, bh, gl.RG16F, gl.RG, bd);

  const render = (face: Face, ids: ParamId[], aspect: number, ow: number, oh: number, prot: Texture | null, withBody: boolean) => {
    const out = tex(ow, oh, gl.RGBA32F, gl.RGBA, null);
    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error('createFramebuffer failed');
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out.tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('RGBA32F framebuffer incomplete');
    const dst: Framebuffer = { fbo, tex: out, internalFormat: gl.RGBA32F, width: ow, height: oh };
    pass.draw(src, dst, face, reshapeUniforms(at(ids).values, 1), aspect, withBody ? bodyTex : null, prot);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const px = new Float32Array(ow * oh * 4);
    gl.readPixels(0, 0, ow, oh, gl.RGBA, gl.FLOAT, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(out.tex);
    return px;
  };

  const pins: ProtectPin[] = [];
  const lo = 0.5 / N;
  const hi = 1 - 0.5 / N;
  const cases = [
    { name: 'portrait contour + limit', face: portrait.pr.face, protect: portrait.protect, W: 600, H: 800, ow: 240, oh: 320, body: false },
    { name: 'portrait body field + contour + limit', face: portrait.pr.face, protect: portrait.protect, W: 600, H: 800, ow: 240, oh: 320, body: true },
    { name: 'sample_face contour + limit (pose mask)', face: sample.face, protect: sample.protect, W: sample.W, H: sample.H, ow: 200, oh: 300, body: false },
  ];
  for (const c of cases) {
    const aspect = c.W / c.H;
    const pt = protTex(c.protect);
    const gpu = render(c.face, CONTOUR, aspect, c.ow, c.oh, pt, c.body);
    const free = render(c.face, CONTOUR, aspect, c.ow, c.oh, null, c.body);
    const map = reshapeMapCpu(c.face, reshapeUniforms(at(CONTOUR).values, 1), aspect, c.body ? body : null, c.protect);
    const feats = features(c.face);
    let n = 0;
    let moved = 0;
    let maxErr = 0;
    let limited = 0;
    let featureDiff = 0;
    let featurePx = 0;
    for (let y = 0; y < c.oh; y++)
      for (let x = 0; x < c.ow; x++) {
        const uu = (x + 0.5) / c.ow;
        const vv = (y + 0.5) / c.oh;
        const i = (y * c.ow + x) * 4;
        const differs = gpu[i] !== free[i] || gpu[i + 1] !== free[i + 1];
        if (differs) limited++;
        if (!c.body && feats.some((f) => inPoly(f, uu, vv))) {
          featurePx++;
          if (differs) featureDiff++;
        }
        const s = map(uu, vv);
        if (s[0] < lo || s[1] < lo || s[0] > hi || s[1] > hi) continue;
        n++;
        if (Math.hypot((s[0] - uu) * c.ow, (s[1] - vv) * c.oh) > 1) moved++;
        maxErr = Math.max(maxErr, Math.hypot((gpu[i] - s[0]) * c.ow, (gpu[i + 1] - s[1]) * c.oh));
      }
    gl.deleteTexture(pt.tex);
    pins.push({ name: c.name, n, moved, maxErrPx: maxErr, limited, featureDiff, featurePx });
  }

  // neutral contour, every other face warp at max: the limit changes nothing at all
  const others: ParamId[] = ['shape.noseSlim', 'shape.mouthSize', 'shape.eyeDistance', 'shape.eyeEnlarge'];
  const pt = protTex(portrait.protect);
  const a = render(portrait.pr.face, others, 0.75, 240, 320, pt, false);
  const b = render(portrait.pr.face, others, 0.75, 240, 320, null, false);
  let neutralDiff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) neutralDiff++;
  gl.deleteTexture(pt.tex);
  pass.dispose();
  return { pins, neutralDiff, neutralPx: a.length / 4 };
};

window.runFaceProtectEngine = async () => {
  const { pr, protect } = portraitScene();
  const W = pr.width;
  const H = pr.height;
  const img = new ImageData(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = pr.paint((x + 0.5) / W, (y + 0.5) / H);
      img.data.set([Math.round(c[0]), Math.round(c[1]), Math.round(c[2]), 255], (y * W + x) * 4);
    }
  const bitmap = await createImageBitmap(img);
  const canvas = document.createElement('canvas');
  const engine = createEngine(canvas);
  await engine.ready;
  const gl = canvas.getContext('webgl2')!;
  const glErrors: number[] = [];
  const passes: string[] = [];
  const draw = (p: BeautyParams, fp: FaceProtect | null) => {
    const input = { source: bitmap, width: W, height: H, face: pr.face, faceWeight: 1, params: p, faceProtect: fp };
    passes.push(...engine.render(input, { still: true }).passes);
    const out = engine.renderToImageData(input, { mirror: false });
    glErrors.push(gl.getError());
    return out.data;
  };
  const neutral = at([]);
  const max = at(CONTOUR);
  const n0 = draw(neutral, null);
  const n1 = draw(neutral, protect);
  const free = draw(max, null);
  const lim = draw(max, protect);

  const P = pr.face.pts111;
  const fw = Math.hypot((P[0] - P[64]) * W, (P[1] - P[65]) * H);
  const cheekL = [P[7 * 2] * W, P[7 * 2 + 1] * H];
  const cheekR = [P[25 * 2] * W, P[25 * 2 + 1] * H];
  const absd = (a: Uint8ClampedArray, b: Uint8ClampedArray, i: number) =>
    Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
  const madIn = (a: Uint8ClampedArray, b: Uint8ClampedArray, d0: number, d1: number) => {
    let s = 0;
    let n = 0;
    let m = 0;
    for (const [cx, cy, dir] of [
      [cheekL[0], cheekL[1], -1],
      [cheekR[0], cheekR[1], 1],
    ])
      for (let y = Math.round(cy - 0.15 * fw); y <= Math.round(cy + 0.15 * fw); y++)
        for (let x = Math.round(cx + dir * d0 * fw); dir * x <= dir * (cx + dir * d1 * fw); x += dir) {
          if (x < 0 || x >= W || pr.inside((x + 0.5) / W, (y + 0.5) / H) > 0) continue;
          const i = (y * W + x) * 4;
          const d = absd(a, b, i);
          s += (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
          m = Math.max(m, d);
          n++;
        }
    return { mad: s / Math.max(1, n), max: m };
  };
  let neutralMaxDiff = 0;
  for (let i = 0; i < n0.length; i += 4) neutralMaxDiff = Math.max(neutralMaxDiff, absd(n0, n1, i));
  engine.dispose();
  bitmap.close();
  return {
    wallMadFree: madIn(n0, free, 0.2, 0.38).mad,
    wallMadLimited: madIn(n0, lim, 0.2, 0.38).mad,
    farMaxFree: madIn(n0, free, 0.38, 0.45).max,
    farMaxLimited: madIn(n0, lim, 0.38, 0.45).max,
    neutralMaxDiff,
    glErrors,
    passes: [...new Set(passes)],
  };
};
