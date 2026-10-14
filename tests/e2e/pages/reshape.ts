// Pins the CPU port (src/engine/passes/reshapeCpu.ts) to the real RESHAPE_FS: the reshape pass samples an identity
// coordinate texture (RGBA32F, LINEAR: each texel holds its own UV), so every output pixel holds the source UV the
// shader sampled there, and the port's map at the same pixel centre must agree. Run by tests/e2e/reshape.spec.ts on
// the dev server (this page imports src/ directly).
import landmarks from '../../fixtures/landmarks_sample_face.json';
import { createReshapePass, reshapeUniforms, type ReshapeView } from '../../../src/engine/passes/reshape';
import { reshapeMapCpu, reshapeMapMulti, withView, type UvMap } from '../../../src/engine/passes/reshapeCpu';
import { attenuate, boxCentre, ovalBox, WHOLE, type TableFace } from '../../../src/engine/passes/faceCap';
import { applyPreset, setParam } from '../../../src/engine/params';
import { adapt } from '../../../src/tracking/adapter111';
import { glMat3, IDENTITY_GEOMETRY, setStraighten, vToO } from '../../../src/geometry/view';
import { buildFaceProtect, protectWindow } from '../../../src/tracking/faceProtect';
import type { BodyField, Face, FaceProtect, ParamId } from '../../../src/types';
import type { Framebuffer, GL, Texture } from '../../../src/engine/gl/gl';

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
    runReshapePinView?: () => PinCase[];
    runReshapePinMulti?: (carrier: 'texture' | 'ubo') => PinCase[];
    runProtectPinMulti?: (carrier: 'texture' | 'ubo') => PinCase[];
  }
}

/** identity texture size: texel centres hold (i + 0.5) / N, exact in float32 */
const N = 256;
// same aspect as the 1000×1500 photo
const OW = 200;
const OH = 300;

function context(): GL {
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('no webgl2');
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float missing');
  if (!gl.getExtension('OES_texture_float_linear')) throw new Error('OES_texture_float_linear missing');
  return gl;
}

const floatTex = (gl: GL, w: number, h: number, internal: number, format: number, data: Float32Array | null): Texture => {
  const t = gl.createTexture();
  if (!t) throw new Error('createTexture failed');
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, gl.FLOAT, data);
  for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.LINEAR);
  for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
  return { tex: t, width: w, height: h };
};

/** the identity source, an RGBA32F OW×OH target, and the per-case readback + comparison with a CPU map */
function rig(gl: GL) {
  const id = new Float32Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) id.set([(x + 0.5) / N, (y + 0.5) / N, 0, 1], (y * N + x) * 4); // row 0 = image top
  const src = floatTex(gl, N, N, gl.RGBA32F, gl.RGBA, id);
  const out = floatTex(gl, OW, OH, gl.RGBA32F, gl.RGBA, null);
  const fbo = gl.createFramebuffer();
  if (!fbo) throw new Error('createFramebuffer failed');
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out.tex, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('RGBA32F framebuffer incomplete');
  const dst: Framebuffer = { fbo, tex: out, internalFormat: gl.RGBA32F, width: OW, height: OH };
  const px = new Float32Array(OW * OH * 4);
  const lo = 0.5 / N;
  const hi = 1 - 0.5 / N;
  /** read what the pass just drew into dst and compare it with `map` at every pixel centre */
  const compare = (name: string, map: UvMap): PinCase => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.readPixels(0, 0, OW, OH, gl.RGBA, gl.FLOAT, px); // FBO row 0 = vUv.y 0 = image top
    let n = 0;
    let moved = 0;
    let maxErr = 0;
    const samples: number[][] = [];
    for (let y = 0; y < OH; y++)
      for (let x = 0; x < OW; x++) {
        const uu = (x + 0.5) / OW;
        const vv = (y + 0.5) / OH;
        const s = map(uu, vv);
        if (s[0] < lo || s[1] < lo || s[0] > hi || s[1] > hi) continue; // clamped by the texture edge
        const gu = px[(y * OW + x) * 4];
        const gv = px[(y * OW + x) * 4 + 1];
        n++;
        if (Math.hypot((s[0] - uu) * OW, (s[1] - vv) * OH) > 1) moved++;
        maxErr = Math.max(maxErr, Math.hypot((gu - s[0]) * OW, (gv - s[1]) * OH));
        if (x % 50 === 25 && y % 60 === 30) samples.push([uu, vv, gu, gv, s[0], s[1]]);
      }
    return { name, n, moved, maxErrPx: maxErr, samples };
  };
  const dispose = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(out.tex);
    gl.deleteTexture(src.tex);
  };
  return { src, dst, compare, dispose };
}

window.runReshapePin = () => {
  const gl = context();
  const r = rig(gl);
  const { width: W, height: H } = landmarks;
  const aspect = W / H;

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
  const bodyTex = floatTex(gl, bw, bh, gl.RG16F, gl.RG, bd);
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
  const res: PinCase[] = [];
  for (const c of cases) {
    const u = reshapeUniforms(at(c.ids), 1);
    pass.draw(r.src, r.dst, face, u, aspect, c.body ? bodyTex : null);
    res.push(r.compare(c.name, reshapeMapCpu(face, u, aspect, c.body ? bodyField : null)));
  }
  pass.dispose();
  gl.deleteTexture(bodyTex.tex);
  r.dispose();
  return res;
};

/**
 * step 3: the face warps drawn through a view (uGeo, uTile, uWin), against withView of the same CPU map; the body field
 * and face of runReshapePin, every contour / chin / nose / eye warp
 */
window.runReshapePinView = () => {
  const gl = context();
  const r = rig(gl);
  const { width: W, height: H } = landmarks;
  const aspect = W / H;
  // runReshapePin's smooth body field (RG16F from FLOAT data, like the engine)
  const bw = 24;
  const bh = 36;
  const bd = new Float32Array(bw * bh * 2);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      bd[(y * bw + x) * 2] = 0.012 * Math.sin((x / bw) * 6) * Math.cos((y / bh) * 4);
      bd[(y * bw + x) * 2 + 1] = 0.008 * Math.cos((x / bw) * 5);
    }
  const bodyTex = floatTex(gl, bw, bh, gl.RG16F, gl.RG, bd);
  const bodyField: BodyField = { width: bw, height: bh, data: bd, version: 1 };
  const face = adapt({ points: new Float32Array(landmarks.points) }, W, H);
  const at = (ids: ParamId[]) => ids.reduce((p, k) => setParam(p, k, 1), applyPreset('original', 1)).values;
  const oSize = { width: W, height: H };
  const flip = { ...IDENTITY_GEOMETRY, flipH: true, quarter: 1 as const };
  const tilted = setStraighten(IDENTITY_GEOMETRY, 12, oSize);
  const views: { name: string; view: ReshapeView }[] = [
    { name: 'quarter 1 + flip', view: { geo: glMat3(vToO(flip, oSize)), tile: [0, 0, 1, 1], win: [0, 0, 1, 1] } },
    { name: 'θ 12° + crop', view: { geo: glMat3(vToO(tilted, oSize)), tile: [0, 0, 1, 1], win: [0, 0, 1, 1] } },
    { name: 'tile in a window', view: { geo: glMat3(vToO(IDENTITY_GEOMETRY, oSize)), tile: [0.25, 0.2, 0.5, 0.5], win: [0.15, 0.1, 0.7, 0.7] } },
  ];
  const ids: ParamId[] = ['shape.faceSlim', 'shape.faceV', 'shape.faceNarrow', 'shape.chin', 'shape.noseSlim', 'shape.eyeEnlarge'];
  const u = reshapeUniforms(at(ids), 1);
  const pass = createReshapePass(gl);
  const res: PinCase[] = [];
  for (const { name, view } of views) {
    // runReshapePin's draw (step 1's one-face signature); the view is the new last argument
    pass.draw(r.src, r.dst, face, u, aspect, bodyTex, null, view);
    res.push(r.compare(name, withView(reshapeMapCpu(face, u, aspect, bodyField), view)));
  }
  pass.dispose();
  gl.deleteTexture(bodyTex.tex);
  r.dispose();
  return res;
};

/** N-face cases through drawFaces on a pass with the given face-table carrier, against reshapeMapMulti */
function pinCases(
  gl: GL,
  cases: readonly { name: string; faces: TableFace[]; protects?: FaceProtect[] }[],
  aspect: number,
  carrier: 'texture' | 'ubo',
): PinCase[] {
  const r = rig(gl);
  const pass = createReshapePass(gl, { carrier });
  const res: PinCase[] = [];
  for (const c of cases) {
    pass.drawFaces(r.src, r.dst, c.faces, { aspect, protects: c.protects });
    res.push(r.compare(c.name, reshapeMapMulti(c.faces, aspect, { protects: c.protects })));
  }
  pass.dispose();
  r.dispose();
  return res;
}

window.runReshapePinMulti = (carrier) => {
  // same identity-texture method as runReshapePin; faces: the fixture face, a shrunk copy beside it, an obstacle
  const gl = context();
  const { width: W, height: H } = landmarks;
  const aspect = W / H;
  const base = adapt({ points: new Float32Array(landmarks.points) }, W, H);
  const shrink = (f: Face, k: number, dx: number): Face => {
    const b = ovalBox(f);
    const c = [b.x + b.w / 2, b.y + b.h / 2];
    const m = (a: Float32Array) => a.map((v, i) => (i % 2 === 0 ? c[0] + (v - c[0]) * k + dx : c[1] + (v - c[1]) * k));
    return { pts111: m(f.pts111), ext: m(f.ext), oval: m(f.oval), yaw: f.yaw, iris: m(f.iris), lids: m(f.lids) };
  };
  const A = shrink(base, 0.45, -0.24);
  const B = shrink(base, 0.45, 0.24);
  const at = (ids: ParamId[]) => ids.reduce((p, k) => setParam(p, k, 1), applyPreset('original', 1)).values;
  const all: ParamId[] = ['shape.faceSlim', 'shape.faceV', 'shape.faceNarrow', 'shape.chin', 'shape.forehead', 'shape.noseSlim', 'shape.mouthSize', 'shape.eyeDistance', 'shape.eyeEnlarge'];
  const u = reshapeUniforms(at(all), 1);
  const tf = (f: Face, cap: number): TableFace => ({ face: f, u: attenuate(u, f.yaw), layer: -1, window: WHOLE, centre: boxCentre(ovalBox(f)), cap });
  const cA = boxCentre(ovalBox(A));
  const cB = boxCentre(ovalBox(B));
  const capAB = Math.hypot(cA[0] - cB[0], (cA[1] - cB[1]) / aspect) / 2;
  // an obstacle at cA + (0.2, 0), 0.75 FW out (A is 0.265 iso wide): its cap 0.1 is below capAB 0.24, so the obstacle
  // sets it, and the capped warp still moves ~575 px of the 200×300 render (at 0.08 out the disc is 8 px: 66 moved)
  const capObs = Math.hypot(0.2, 0) / 2;
  const cases: { name: string; faces: TableFace[] }[] = [
    { name: `two faces, every warp (${carrier})`, faces: [tf(A, capAB), tf(B, capAB)] },
    { name: `capped pair, one neutral (${carrier})`, faces: [tf(A, capAB), { ...tf(B, capAB), u: reshapeUniforms(applyPreset('original', 1).values, 1) }] },
    { name: `obstacle bounds the cap (${carrier})`, faces: [tf(A, Math.min(capObs, capAB))] },
  ];
  return pinCases(gl, cases, aspect, carrier);
};

window.runProtectPinMulti = (carrier) => {
  // two faces with their 瘦臉 limits in 128² windows, and a small face (0.1 of the fixture's) alone in its window
  const gl = context();
  const { width: W, height: H } = landmarks;
  const aspect = W / H;
  const base = adapt({ points: new Float32Array(landmarks.points) }, W, H);
  const shrink = (f: Face, k: number, dx: number): Face => {
    const b = ovalBox(f);
    const c = [b.x + b.w / 2, b.y + b.h / 2];
    const m = (a: Float32Array) => a.map((v, i) => (i % 2 === 0 ? c[0] + (v - c[0]) * k + dx : c[1] + (v - c[1]) * k));
    return { pts111: m(f.pts111), ext: m(f.ext), oval: m(f.oval), yaw: f.yaw, iris: m(f.iris), lids: m(f.lids) };
  };
  const A = shrink(base, 0.45, -0.24);
  const B = shrink(base, 0.45, 0.24);
  const S = shrink(base, 0.1, 0);
  const contour: ParamId[] = ['shape.faceSlim', 'shape.faceV', 'shape.faceNarrow'];
  const u = reshapeUniforms(contour.reduce((p, k) => setParam(p, k, 1), applyPreset('original', 1)).values, 1);
  const limit = (f: Face, others: Face[]) =>
    buildFaceProtect(
      f,
      { own: null, clipToCell: false, otherCentres: others.map((g) => boxCentre(ovalBox(g))), otherOvals: others.map((g) => g.oval), otherMasks: [], window: protectWindow(f, W, H) },
      W,
      H,
    );
  const pA = limit(A, [B]);
  const pB = limit(B, [A]);
  const pS = limit(S, []);
  const cA = boxCentre(ovalBox(A));
  const cB = boxCentre(ovalBox(B));
  const capAB = Math.hypot(cA[0] - cB[0], (cA[1] - cB[1]) / aspect) / 2;
  const tf = (f: Face, cap: number, layer: number, p: FaceProtect): TableFace => ({
    face: f,
    u: attenuate(u, f.yaw),
    layer,
    window: p.window ?? WHOLE,
    centre: boxCentre(ovalBox(f)),
    cap,
  });
  const cases: { name: string; faces: TableFace[]; protects: FaceProtect[] }[] = [
    { name: `two faces, windowed limits (${carrier})`, faces: [tf(A, capAB, 0, pA), tf(B, capAB, 1, pB)], protects: [pA, pB] },
    { name: `small face in its 128² window (${carrier})`, faces: [tf(S, -1, 0, pS)], protects: [pS] },
  ];
  return pinCases(gl, cases, aspect, carrier);
};
