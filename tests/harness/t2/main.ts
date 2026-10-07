// T2 harness: exercises the face passes directly with gl.ts helpers on tests/fixtures/sample_face.png
// and the recorded MediaPipe landmarks (via the real adapter), reports numeric checks and renders
// PNGs for visual inspection. Driven by tests/harness/t2/run.mjs (Playwright, headless Chromium).
import type { Face, ParamId } from '../../../src/types';
import { BLUSH_SHADES, LIP_SHADES, applyPreset } from '../../../src/engine/params';
import {
  COPY_FS,
  FULLSCREEN_VS,
  bindTarget,
  bindTexture,
  createFramebuffer,
  createProgram,
  createTexture,
  drawFullscreen,
  hexToRgb,
  uploadSource,
} from '../../../src/engine/gl/gl';
import type { Framebuffer, GL, Texture } from '../../../src/engine/gl/gl';
import {
  createReshapePass,
  reshapeActive,
  reshapeGeometry,
  reshapeUniforms,
  yawAttenuation,
} from '../../../src/engine/passes/reshape';
import type { ReshapeUniforms } from '../../../src/engine/passes/reshape';
import { createMakeupPass, makeupUniforms } from '../../../src/engine/passes/makeup';
import type { MakeupUniforms } from '../../../src/engine/passes/makeup';
import { createMaskPass } from '../../../src/engine/passes/mask';
import { maskBufferSize } from '../../../src/engine/uniforms';
import { createLandmarkOverlay } from '../../../src/engine/passes/overlay';
import { FACE_INDICES, FACE_TEMPLATE } from '../../../src/engine/passes/faceMesh';
import { adapt } from '../../../src/tracking/adapter111';
import { minJacobian, warpRef } from './warpRef';

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
type V2 = [number, number];

declare global {
  interface Window {
    __t2?: { done: boolean; error?: string; checks: Check[]; metrics: Record<string, unknown>; images: Record<string, string> };
  }
}

const checks: Check[] = [];
const metrics: Record<string, unknown> = {};
const images: Record<string, string> = {};
const logEl = document.getElementById('log')!;
const log = (s: string) => {
  logEl.textContent += s + '\n';
};
function check(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
  log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
}
const fmt = (n: number, d = 4) => n.toFixed(d);

async function main() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
  }) as GL | null;
  if (!gl) throw new Error('no WebGL2');
  metrics.renderer = gl.getParameter(gl.RENDERER);
  metrics.maxFragUniformVectors = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS);

  // ── source + face ──
  const blob = await (await fetch('/tests/fixtures/sample_face.png')).blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const W = bmp.width;
  const H = bmp.height;
  const aspect = W / H;
  const srcTex = createTexture(gl, 0, 0);
  uploadSource(gl, srcTex, bmp, W, H);

  let face: Face;
  try {
    const j = (await (await fetch('/tests/fixtures/landmarks_sample_face.json')).json()) as {
      points: number[];
      width: number;
      height: number;
    };
    face = adapt({ points: new Float32Array(j.points) }, j.width, j.height);
    metrics.faceSource = 'landmarks_sample_face.json via adapter111';
  } catch (e) {
    face = templateFace(W, H);
    metrics.faceSource = `GPUPixel template (adapter unavailable: ${String(e)})`;
  }
  metrics.yaw = face.yaw;
  metrics.yawAttenuation = yawAttenuation(face.yaw);
  canvas.width = W;
  canvas.height = H;

  const copyProg = createProgram(gl, FULLSCREEN_VS, COPY_FS, 'copy');
  const copy = (src: Texture, dst: Framebuffer) => {
    bindTarget(gl, dst);
    copyProg.use();
    gl.uniform1i(copyProg.u('uSrc'), 0);
    bindTexture(gl, 0, src);
    drawFullscreen(gl);
  };
  const read = (fb: Framebuffer): ImageData => {
    bindTarget(gl, fb);
    const px = new Uint8ClampedArray(fb.width * fb.height * 4);
    gl.readPixels(0, 0, fb.width, fb.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return new ImageData(px, fb.width, fb.height);
  };
  const glErr = () => gl.getError();

  const fbA = createFramebuffer(gl, W, H);
  copy(srcTex, fbA);
  const base = read(fbA);

  const reshape = createReshapePass(gl);
  const makeup = createMakeupPass(gl);
  const mask = createMaskPass(gl);
  const overlay = createLandmarkOverlay(gl);
  await makeup.ready;
  check('passes compile + makeup textures load', glErr() === gl.NO_ERROR, `renderer ${metrics.renderer}`);

  const P = (i: number): V2 => [face.pts111[i * 2], face.pts111[i * 2 + 1]];
  const px = (p: V2): V2 => [p[0] * W, p[1] * H];
  const ovalBox = (): Rect => {
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (let i = 0; i < face.oval.length; i += 2) {
      x0 = Math.min(x0, face.oval[i]);
      x1 = Math.max(x1, face.oval[i]);
      y0 = Math.min(y0, face.oval[i + 1]);
      y1 = Math.max(y1, face.oval[i + 1]);
    }
    const mx = (x1 - x0) * 0.12;
    const my = (y1 - y0) * 0.08;
    return clampRect({ x: (x0 - mx) * W, y: (y0 - my) * H, w: (x1 - x0 + 2 * mx) * W, h: (y1 - y0 + 2 * my) * H }, W, H);
  };
  const faceCrop = ovalBox();
  const around = (c: V2, rw: number, rh: number): Rect =>
    clampRect({ x: c[0] * W - rw / 2, y: c[1] * H - rh / 2, w: rw, h: rh }, W, H);
  const eyesCrop = around([(P(74)[0] + P(77)[0]) / 2, (P(74)[1] + P(77)[1]) / 2], 0.55 * W, 0.16 * H);
  const mouthCrop = around(P(106), 0.32 * W, 0.14 * H);

  const neutral = () => applyPreset('original').values;
  const vals = (over: Partial<Record<ParamId, number>>) => ({ ...neutral(), ...over });
  const zeroR = reshapeUniforms(neutral(), 1);
  const zeroM: MakeupUniforms = { lip: 0, blush: 0, lipColor: null, blushColor: null };

  const renderReshape = (u: ReshapeUniforms, src: Texture = srcTex): ImageData => {
    reshape.draw(src, fbA, face, u);
    return read(fbA);
  };
  const renderMakeup = (u: MakeupUniforms): ImageData => {
    makeup.draw(srcTex, fbA, face, u);
    return read(fbA);
  };

  {
    // Mesh triangles whose orientation differs from the template (fold-overs of the makeup mesh).
    const flips: string[] = [];
    const area = (a: V2, b: V2, c: V2) => (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    const T = (i: number): V2 => [FACE_TEMPLATE[i * 2], FACE_TEMPLATE[i * 2 + 1]];
    for (let k = 0; k < FACE_INDICES.length; k += 3) {
      const [a, b, c] = [FACE_INDICES[k], FACE_INDICES[k + 1], FACE_INDICES[k + 2]];
      const at = area(T(a), T(b), T(c));
      const af = area(px(P(a)), px(P(b)), px(P(c)));
      if (Math.sign(at) !== Math.sign(af) || Math.abs(at) < 1e-9) flips.push(`[${a},${b},${c}]`);
    }
    metrics.meshFlips = flips.join(' ');
  }
  // ── A. identity ──
  {
    const r = renderReshape(zeroR);
    check('reshape zero deltas = identity', maxDiff(r, base) === 0, `max |Δ| ${maxDiff(r, base)}/255`);
    const r2 = renderReshape(reshapeUniforms(applyPreset('refined').values, 0));
    check('reshape faceWeight 0 = identity', maxDiff(r2, base) === 0, `max |Δ| ${maxDiff(r2, base)}/255`);
    const m = renderMakeup(zeroM);
    check('makeup zero intensity = identity (blit)', maxDiff(m, base) === 0, `max |Δ| ${maxDiff(m, base)}/255`);
    // src of a different size than dst: sampled by UV, no error, close to the source
    const fbS = createFramebuffer(gl, 600, 900);
    reshape.draw(srcTex, fbS, face, zeroR);
    makeup.draw(srcTex, fbS, face, makeupUniforms(applyPreset('glow'), 1));
    check('different src/dst sizes render without GL error', glErr() === gl.NO_ERROR, '600×900 dst from 1000×1500 src');
  }

  // ── B. warp map (float coordinate texture) ──
  const floatOk = !!gl.getExtension('EXT_color_buffer_float');
  const linear32 = !!gl.getExtension('OES_texture_float_linear');
  metrics.floatTargets = floatOk;
  metrics.float32Linear = linear32;
  if (floatOk) {
    const ifmt = linear32 ? gl.RGBA32F : gl.RGBA16F;
    const coordTex = createTexture(gl, W, H, { internalFormat: ifmt, format: gl.RGBA, type: linear32 ? gl.FLOAT : gl.HALF_FLOAT });
    const coords = new Float32Array(W * H * 4);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        coords[o] = (x + 0.5) / W;
        coords[o + 1] = (y + 0.5) / H;
        coords[o + 3] = 1;
      }
    gl.bindTexture(gl.TEXTURE_2D, coordTex.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.FLOAT, coords);
    const mapTex = createTexture(gl, W, H, { internalFormat: ifmt, format: gl.RGBA, type: linear32 ? gl.FLOAT : gl.HALF_FLOAT });
    const mapFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, mapFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, mapTex.tex, 0);
    const mapFb: Framebuffer = { fbo: mapFbo, tex: mapTex, internalFormat: ifmt, width: W, height: H };
    const mapBuf = new Float32Array(W * H * 4);
    const gpuMap = (u: ReshapeUniforms) => {
      reshape.draw(coordTex, mapFb, face, u);
      bindTarget(gl, mapFb);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, mapBuf);
      return (p: V2): V2 => {
        const x = Math.min(W - 1, Math.max(0, Math.floor(p[0] * W)));
        const y = Math.min(H - 1, Math.max(0, Math.floor(p[1] * H)));
        const o = (y * W + x) * 4;
        return [mapBuf[o], mapBuf[o + 1]];
      };
    };
    const att = (u: ReshapeUniforms): ReshapeUniforms => {
      const a = yawAttenuation(face.yaw);
      const o = { ...u };
      for (const k of Object.keys(o) as (keyof ReshapeUniforms)[]) o[k] *= a;
      return o;
    };
    const center = (p: V2): V2 => [(Math.floor(p[0] * W) + 0.5) / W, (Math.floor(p[1] * H) + 0.5) / H];
    const isoLen = (a: V2, b: V2) => Math.hypot(a[0] - b[0], (a[1] - b[1]) / aspect);

    // GPU vs JS reference, whole frame, everything on
    const allMax = reshapeUniforms(
      vals({
        'shape.eyeEnlarge': 1, 'shape.faceSlim': 1, 'shape.faceV': 1, 'shape.faceNarrow': 1, 'shape.noseSlim': 1,
        'shape.chin': 1, 'shape.forehead': 1, 'shape.mouthSize': 1, 'shape.eyeDistance': 1,
      }),
      1,
    );
    const allMin = reshapeUniforms(
      vals({
        'shape.eyeEnlarge': 1, 'shape.faceSlim': 1, 'shape.faceV': 1, 'shape.faceNarrow': 1, 'shape.noseSlim': 1,
        'shape.chin': 0, 'shape.forehead': 0, 'shape.mouthSize': 0, 'shape.eyeDistance': 0,
      }),
      1,
    );
    for (const [label, u] of [['allMax', allMax], ['allMin', allMin]] as const) {
      const m = gpuMap(u);
      const ua = att(u);
      const g = reshapeGeometry(face, aspect, ua);
      let maxErr = 0;
      let worst = '';
      for (let y = 0; y < H; y += 3)
        for (let x = 0; x < W; x += 3) {
          const p: V2 = [(x + 0.5) / W, (y + 0.5) / H];
          const r = warpRef(p, face, ua, g, aspect);
          if (r[0] < 0.5 / W || r[0] > 1 - 0.5 / W || r[1] < 0.5 / H || r[1] > 1 - 0.5 / H) continue; // clamped by the sampler
          const q = m(p);
          const e = Math.max(Math.abs(q[0] - r[0]) * W, Math.abs(q[1] - r[1]) * H);
          if (e > maxErr) {
            maxErr = e;
            worst = `at px (${x},${y}) gpu (${fmt(q[0] * W, 2)},${fmt(q[1] * H, 2)}) ref (${fmt(r[0] * W, 2)},${fmt(r[1] * H, 2)})`;
          }
        }
      check(`GPU warp map matches JS reference (${label})`, maxErr < (linear32 ? 0.05 : 1), `max err ${fmt(maxErr, 4)} px ${worst}`);
      // GPU-side Jacobian (1-px forward differences of the read-back map)
      let minDet = Infinity;
      let minAt = '';
      for (let y = Math.max(1, Math.floor(g.box[1] * H)); y < Math.min(H - 1, g.box[3] * H); y++)
        for (let x = Math.max(1, Math.floor(g.box[0] * W)); x < Math.min(W - 1, g.box[2] * W); x++) {
          const o = (y * W + x) * 4;
          const inside = (k: number) => mapBuf[k] > 1 / W && mapBuf[k] < 1 - 1 / W && mapBuf[k + 1] > 1 / H && mapBuf[k + 1] < 1 - 1 / H;
          if (!inside(o) || !inside(o + 4) || !inside(o + W * 4)) continue;
          const jx0 = (mapBuf[o + 4] - mapBuf[o]) * W;
          const jx1 = (mapBuf[o + 5] - mapBuf[o + 1]) * W;
          const jy0 = (mapBuf[o + W * 4] - mapBuf[o]) * H;
          const jy1 = (mapBuf[o + W * 4 + 1] - mapBuf[o + 1]) * H;
          const det = jx0 * jy1 - jy0 * jx1;
          if (det < minDet) {
            minDet = det;
            minAt = `(${x},${y}) J=[${fmt(jx0, 3)} ${fmt(jy0, 3)}; ${fmt(jx1, 3)} ${fmt(jy1, 3)}] map (${fmt(mapBuf[o] * W, 2)},${fmt(mapBuf[o + 1] * H, 2)})`;
          }
        }
      check(`no fold-over on GPU map (${label})`, minDet > 0, `min det J ${fmt(minDet, 3)} at ${minAt}`);
    }

    // JS-reference fold check per param, both extremes
    const ids: ParamId[] = [
      'shape.faceSlim', 'shape.faceV', 'shape.faceNarrow', 'shape.noseSlim', 'shape.eyeEnlarge',
      'shape.chin', 'shape.forehead', 'shape.mouthSize', 'shape.eyeDistance',
    ];
    const foldRows: string[] = [];
    let foldOk = true;
    for (const id of ids) {
      for (const v of id === 'shape.chin' || id === 'shape.forehead' || id === 'shape.mouthSize' || id === 'shape.eyeDistance' ? [0, 1] : [1]) {
        const ua = att(reshapeUniforms(vals({ [id]: v }), 1));
        const g = reshapeGeometry(face, aspect, ua);
        const j = minJacobian(face, ua, g, W, H, 2);
        foldOk &&= j.min > 0;
        foldRows.push(`${id}=${v}: ${fmt(j.min, 3)}`);
      }
    }
    for (const [label, u] of [['allMax', allMax], ['allMin', allMin]] as const) {
      const ua = att(u);
      const j = minJacobian(face, ua, reshapeGeometry(face, aspect, ua), W, H, 2);
      foldOk &&= j.min > 0;
      foldRows.push(`${label}: ${fmt(j.min, 3)}`);
    }
    check('no fold-over (JS reference, every param at its extremes)', foldOk, foldRows.join(', '));

    // Direction checks on the GPU map
    const one = (id: ParamId, v: number) => gpuMap(reshapeUniforms(vals({ [id]: v }), 1));
    {
      const m = one('shape.eyeEnlarge', 1);
      const ua = att(reshapeUniforms(vals({ 'shape.eyeEnlarge': 1 }), 1));
      const g = reshapeGeometry(face, aspect, ua);
      const rows: string[] = [];
      let ok = true;
      for (const [ci, R] of [[74, g.eyeR[0]], [77, g.eyeR[1]]] as const) {
        const c = P(ci);
        for (const f of [0.3, 0.6]) {
          const p = center([c[0] + R * f, c[1]]);
          const ratio = isoLen(m(p), c) / isoLen(p, c);
          ok &&= ratio < 0.97;
          rows.push(`eye${ci} r=${f}R scale ${fmt(1 / ratio, 3)}×`);
        }
        const out = center([c[0] + R * 1.1, c[1]]);
        const d = isoLen(m(out), out) * W;
        ok &&= d < 0.05;
        rows.push(`eye${ci} 1.1R moved ${fmt(d, 3)}px`);
      }
      check('eyeEnlarge magnifies around both eye centres, identity outside R', ok, rows.join('; '));
    }
    {
      const m = one('shape.faceSlim', 1);
      const rows: string[] = [];
      let ok = true;
      // GPUPixel pairs: content at o moves toward t ⇔ the sample at o comes from the far side of o
      for (const [o, t] of [[3, 44], [29, 44], [7, 45], [25, 45], [10, 46], [22, 46], [14, 49], [18, 49], [16, 49]]) {
        const p = center(P(o));
        const s = m(p);
        const tv: V2 = [P(t)[0] - p[0], (P(t)[1] - p[1]) / aspect];
        const along = ((s[0] - p[0]) * tv[0] + ((s[1] - p[1]) / aspect) * tv[1]) / Math.hypot(tv[0], tv[1]);
        ok &&= along < 0;
        rows.push(`p${o}→${t} ${fmt(-along * W, 1)}px`);
      }
      check('faceSlim pulls every contour anchor toward its GPUPixel target', ok, rows.join(', '));
    }
    for (const [id, pts] of [['shape.faceV', [8, 10, 12, 20, 22, 24]], ['shape.faceNarrow', [2, 4, 28, 30]]] as const) {
      const m = one(id, 1);
      const mid = (P(43)[0] + P(16)[0]) / 2;
      const rows: string[] = [];
      let ok = true;
      for (const i of pts) {
        const p = center(P(i));
        const outward = Math.abs(m(p)[0] - mid) - Math.abs(p[0] - mid);
        ok &&= outward > 0;
        rows.push(`p${i} ${fmt(outward * W, 2)}px`);
      }
      check(`${id} pulls its anchors toward the midline`, ok, rows.join(', '));
    }
    {
      const m = one('shape.noseSlim', 1);
      const rows: string[] = [];
      let ok = true;
      for (const [o, t] of [[80, 46], [81, 46], [82, 49], [83, 49]]) {
        const p = center(P(o));
        const d = isoLen(m(p), P(t)) - isoLen(p, P(t));
        ok &&= d > 0;
        rows.push(`p${o} ${fmt(d * W, 2)}px`);
      }
      check('noseSlim pulls the wings toward the tip / subnasale', ok, rows.join(', '));
    }
    {
      const p = center(P(16));
      const up = one('shape.chin', 1)(p)[1] - p[1];
      const dn = one('shape.chin', 0)(p)[1] - p[1];
      check('chin bidirectional (+ longer, − shorter)', up < 0 && dn > 0, `+: sample Δy ${fmt(up * H, 2)}px, −: ${fmt(dn * H, 2)}px`);
    }
    {
      const e0: V2 = [face.ext[0], face.ext[1]];
      const e3: V2 = [face.ext[6], face.ext[7]];
      const p = center([e0[0] * 0.65 + e3[0] * 0.35, e0[1] * 0.65 + e3[1] * 0.35]);
      const tall = one('shape.forehead', 1)(p)[1] - p[1];
      const low = one('shape.forehead', 0)(p)[1] - p[1];
      check('forehead bidirectional (+ content moves up, − down)', tall > 0 && low < 0, `+: sample Δy ${fmt(tall * H, 2)}px, −: ${fmt(low * H, 2)}px`);
    }
    {
      const ua = att(reshapeUniforms(vals({ 'shape.mouthSize': 1 }), 1));
      const R = reshapeGeometry(face, aspect, ua).mouthR;
      const c = P(106);
      const p = center([c[0] + R * 0.4, c[1]]);
      const big = isoLen(one('shape.mouthSize', 1)(p), c) / isoLen(p, c);
      const small = isoLen(one('shape.mouthSize', 0)(p), c) / isoLen(p, c);
      check('mouthSize bidirectional (+ magnify, − shrink)', big < 1 && small > 1, `scale +: ${fmt(1 / big, 3)}×, −: ${fmt(1 / small, 3)}×`);
    }
    {
      const l = center(P(74));
      const r = center(P(77));
      const mw = one('shape.eyeDistance', 1);
      const wl = mw(l)[0] - l[0];
      const wr = mw(r)[0] - r[0];
      const mn = one('shape.eyeDistance', 0);
      const nl = mn(l)[0] - l[0];
      const nr = mn(r)[0] - r[0];
      check(
        'eyeDistance bidirectional (+ apart, − closer)',
        wl > 0 && wr < 0 && nl < 0 && nr > 0,
        `+: L ${fmt(wl * W, 2)} R ${fmt(wr * W, 2)}px; −: L ${fmt(nl * W, 2)} R ${fmt(nr * W, 2)}px (sample Δx)`,
      );
    }
    gl.deleteFramebuffer(mapFbo);
    gl.deleteTexture(mapTex.tex);
    gl.deleteTexture(coordTex.tex);
  } else {
    check('float render targets available for warp-map checks', false, 'EXT_color_buffer_float missing');
  }

  // ── C. reshape visuals ──
  {
    const eye = renderReshape(reshapeUniforms(vals({ 'shape.eyeEnlarge': 1 }), 1));
    saveRow('reshape_eye', [base, eye], ['source', 'eyeEnlarge 100'], eyesCrop, 1.4);
    const one = (id: ParamId, v: number) => renderReshape(reshapeUniforms(vals({ [id]: v }), 1));
    saveRow(
      'reshape_contour',
      [base, one('shape.faceSlim', 1), one('shape.faceV', 1), one('shape.faceNarrow', 1)],
      ['source', 'faceSlim 100', 'faceV 100', 'faceNarrow 100'],
      faceCrop,
      0.6,
    );
    saveRow(
      'reshape_chin_forehead',
      [one('shape.chin', 0), base, one('shape.chin', 1), one('shape.forehead', 0), one('shape.forehead', 1)],
      ['chin −50', 'source', 'chin +50', 'forehead −50', 'forehead +50'],
      faceCrop,
      0.5,
    );
    saveRow(
      'reshape_mouth_nose',
      [one('shape.mouthSize', 0), base, one('shape.mouthSize', 1), one('shape.noseSlim', 1)],
      ['mouth −50', 'source', 'mouth +50', 'noseSlim 100'],
      around([P(46)[0], (P(46)[1] + P(106)[1]) / 2], 0.36 * W, 0.22 * H),
      1,
    );
    saveRow(
      'reshape_eyedistance',
      [one('shape.eyeDistance', 0), base, one('shape.eyeDistance', 1)],
      ['eyeDist −50', 'source', 'eyeDist +50'],
      eyesCrop,
      1,
    );
    const nat = applyPreset('natural');
    const ref = applyPreset('refined');
    saveRow(
      'reshape_presets',
      [base, renderReshape(reshapeUniforms(nat.values, 1)), renderReshape(reshapeUniforms(ref.values, 1))],
      ['source', '自然 (shape only)', '精緻 (shape only)'],
      faceCrop,
      0.7,
    );
    const maxU = reshapeUniforms(
      vals({
        'shape.eyeEnlarge': 1, 'shape.faceSlim': 1, 'shape.faceV': 1, 'shape.faceNarrow': 1, 'shape.noseSlim': 1,
        'shape.chin': 1, 'shape.forehead': 1, 'shape.mouthSize': 1, 'shape.eyeDistance': 1,
      }),
      1,
    );
    const minU = reshapeUniforms(
      vals({
        'shape.eyeEnlarge': 1, 'shape.faceSlim': 1, 'shape.faceV': 1, 'shape.faceNarrow': 1, 'shape.noseSlim': 1,
        'shape.chin': 0, 'shape.forehead': 0, 'shape.mouthSize': 0, 'shape.eyeDistance': 0,
      }),
      1,
    );
    // grid over the face so fold-overs / tearing would be obvious
    const grid = gridOver(base);
    const gridTex = createTexture(gl, W, H);
    gl.bindTexture(gl.TEXTURE_2D, gridTex.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, grid.data);
    saveRow(
      'reshape_grid_max',
      [grid, renderReshape(maxU, gridTex), renderReshape(minU, gridTex)],
      ['grid', 'all max (bi +50)', 'all max (bi −50)'],
      faceCrop,
      0.7,
    );
    saveRow('reshape_all_max', [base, renderReshape(maxU), renderReshape(minU)], ['source', 'all max (bi +50)', 'all max (bi −50)'], faceCrop, 0.7);
    gl.deleteTexture(gridTex.tex);
    check('reshape visuals rendered without GL error', glErr() === gl.NO_ERROR, 'see out/reshape_*.png');
  }

  // ── D. makeup ──
  {
    const meshBox = (): Rect => {
      let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
      for (let i = 0; i < 222; i += 2) {
        x0 = Math.min(x0, face.pts111[i]);
        x1 = Math.max(x1, face.pts111[i]);
        y0 = Math.min(y0, face.pts111[i + 1]);
        y1 = Math.max(y1, face.pts111[i + 1]);
      }
      return { x: Math.floor(x0 * W) - 1, y: Math.floor(y0 * H) - 1, w: Math.ceil((x1 - x0) * W) + 3, h: Math.ceil((y1 - y0) * H) + 3 };
    };
    const box = meshBox();
    const full = renderMakeup({ lip: 1, blush: 1, lipColor: null, blushColor: null });
    const outside = maxDiffOutside(full, base, box);
    const inside = changedCount(full, base, box);
    check('makeup leaves everything outside the mesh bbox untouched', outside === 0 && inside > 1000, `outside max |Δ| ${outside}, changed inside ${inside} px`);
    const lipPoly = [84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95].map((i) => px(P(i)));
    const cheekL = px(P(109));
    const cheekR = px(P(110));
    const rLip = regionRatio(base, full, (x, y) => inPoly(lipPoly, x, y));
    const blushOnly = renderMakeup({ lip: 0, blush: 1, lipColor: null, blushColor: null });
    const cheekRad = 0.06 * W;
    const nearCheek = (x: number, y: number) => Math.hypot(x - cheekL[0], y - cheekL[1]) < cheekRad || Math.hypot(x - cheekR[0], y - cheekR[1]) < cheekRad;
    const rBlush = regionRatio(base, blushOnly, nearCheek);
    const lipOnly = renderMakeup({ lip: 1, blush: 0, lipColor: null, blushColor: null });
    const lipChangedOutsideLips = changedWhere(lipOnly, base, (x, y) => !inPoly(expandPoly(lipPoly, 1.35), x, y));
    // Blush footprint: the band between the lower eyelids and the mouth corners, outside the nose column.
    const eyeLow = Math.min(...[56, 57, 62, 63].map((i) => P(i)[1])) * H;
    const mouthY = Math.max(P(84)[1], P(90)[1]) * H;
    const noseL = P(80)[0] * W;
    const noseR = P(81)[0] * W;
    const blushChangedOutside = changedWhere(
      blushOnly,
      base,
      (x, y) => y < eyeLow || y > mouthY || (x > noseL && x < noseR),
    );
    check(
      'original-colour lip / blush change only lip / cheek regions',
      rLip.strength > 0.15 && rBlush.strength > 0.03 && lipChangedOutsideLips === 0 && blushChangedOutside === 0,
      `lip mean ratio ${rLip.ratio.map((v) => fmt(v, 3))} (strength ${fmt(rLip.strength, 3)}), blush ${rBlush.ratio.map((v) => fmt(v, 3))} (strength ${fmt(rBlush.strength, 3)}); lip px changed outside lips ${lipChangedOutsideLips}, blush outside cheeks ${blushChangedOutside}`,
    );
    {
      // diagnostic: blush-changed pixels (white), outside the expected band (red)
      const d = new ImageData(new Uint8ClampedArray(base.data), W, H);
      for (let yy = 0; yy < H; yy++)
        for (let xx = 0; xx < W; xx++) {
          const o = (yy * W + xx) * 4;
          const ch = Math.max(...[0, 1, 2].map((c) => Math.abs(blushOnly.data[o + c] - base.data[o + c])));
          if (ch <= 1) continue;
          const out = yy + 0.5 < eyeLow || yy + 0.5 > mouthY || (xx + 0.5 > noseL && xx + 0.5 < noseR);
          d.data[o] = 255;
          d.data[o + 1] = out ? 0 : 255;
          d.data[o + 2] = out ? 0 : 255;
        }
      saveImage('makeup_blush_footprint', d, faceCrop, 0.6);
    }
    saveRow('makeup_original', [base, full, lipOnly, blushOnly], ['source', 'lip+blush 100 (原色)', 'lip 100', 'blush 100'], faceCrop, 0.6);

    const lipImgs: ImageData[] = [lipOnly];
    const lipLabels = ['原色 100'];
    const tintRows: string[] = [];
    let tintOk = true;
    for (const s of LIP_SHADES) {
      const img = renderMakeup({ lip: 1, blush: 0, lipColor: hexToRgb(s.color!), blushColor: null });
      lipImgs.push(img);
      lipLabels.push(`${s.label} 100`);
      const r = regionRatio(base, img, (x, y) => inPoly(lipPoly, x, y), true);
      const cos = cosine(r.ratio, hexToRgb(s.color!));
      tintOk &&= cos > 0.97 && maxDiffOutside(img, base, box) === 0;
      tintRows.push(`${s.id}: strongest ratio ${r.ratio.map((v) => fmt(v, 2))} vs shade ${hexToRgb(s.color!).map((v) => fmt(v, 2))} cos ${fmt(cos, 3)}`);
    }
    for (const s of BLUSH_SHADES) {
      const img = renderMakeup({ lip: 0, blush: 1, lipColor: null, blushColor: hexToRgb(s.color!) });
      const r = regionRatio(base, img, nearCheek, true);
      const cos = cosine(r.ratio, hexToRgb(s.color!));
      tintOk &&= cos > 0.97;
      tintRows.push(`blush ${s.id}: ratio ${r.ratio.map((v) => fmt(v, 2))} cos ${fmt(cos, 3)}`);
    }
    check('shade tints multiply toward the shade colour (direction cos > 0.97)', tintOk, tintRows.join('; '));
    saveRow('makeup_lip_shades', lipImgs, lipLabels, mouthCrop, 0.8);
    const half = (part: 'lip' | 'blush') => (s: { color: string | null }) =>
      renderMakeup(part === 'lip' ? { lip: 0.5, blush: 0, lipColor: hexToRgb(s.color!), blushColor: null } : { lip: 0, blush: 0.4, lipColor: null, blushColor: hexToRgb(s.color!) });
    saveRow('makeup_lip_shades_default', [base, ...LIP_SHADES.map(half('lip'))], ['source', ...LIP_SHADES.map((s) => `${s.label} 50`)], mouthCrop, 0.8);
    saveRow('makeup_blush_shades', [base, ...BLUSH_SHADES.map(half('blush'))], ['source', ...BLUSH_SHADES.map((s) => `${s.label} 40`)], faceCrop, 0.45);
    saveRow(
      'makeup_blush_zoom',
      [base, renderMakeup({ lip: 0, blush: 1, lipColor: null, blushColor: null }), renderMakeup({ lip: 0, blush: 0.4, lipColor: null, blushColor: hexToRgb('#FF8FB1') }), renderMakeup({ lip: 0, blush: 1, lipColor: null, blushColor: hexToRgb('#FF8FB1') })],
      ['source', '原色 100', '粉紅 40', '粉紅 100'],
      around(P(109), 0.3 * W, 0.2 * H),
      1.2,
    );
    {
      // diagnostic: mesh wireframe over the strongest tinted blush
      const img = renderMakeup({ lip: 0, blush: 1, lipColor: null, blushColor: hexToRgb('#FF8FB1') });
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const ctx = c.getContext('2d')!;
      ctx.putImageData(img, 0, 0);
      ctx.strokeStyle = 'rgba(0,255,255,0.8)';
      ctx.lineWidth = 1;
      ctx.font = '11px sans-serif';
      for (let k = 0; k < FACE_INDICES.length; k += 3) {
        const [a, b, cc] = [FACE_INDICES[k], FACE_INDICES[k + 1], FACE_INDICES[k + 2]].map((i) => px(P(i)));
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.lineTo(cc[0], cc[1]);
        ctx.closePath();
        ctx.stroke();
      }
      ctx.fillStyle = '#ff0';
      for (let i = 0; i < 111; i++) ctx.fillText(String(i), px(P(i))[0] + 2, px(P(i))[1] - 2);
      const wire = ctx.getImageData(0, 0, W, H);
      saveImage('makeup_mesh_wire', wire, around(P(109), 0.36 * W, 0.26 * H), 2);
    }
    const glow = applyPreset('glow');
    saveRow('makeup_glow', [base, renderMakeup(makeupUniforms(glow, 1))], ['source', '氣色 makeup (豆沙 30 / 蜜桃 30)'], faceCrop, 0.7);
    check('makeup visuals rendered without GL error', glErr() === gl.NO_ERROR, 'see out/makeup_*.png');
  }

  // ── E. mask ──
  {
    const mw = Math.round(W / 4);
    const mh = Math.round(H / 4);
    const mfb = createFramebuffer(gl, mw, mh, gl.R8);
    const at = (img: ImageData, p: V2) => img.data[(Math.min(mh - 1, Math.floor(p[1] * mh)) * mw + Math.min(mw - 1, Math.floor(p[0] * mw))) * 4];
    mask.draw(mfb, face, 1);
    const m = read(mfb);
    const nose = at(m, P(46));
    const cheekL = at(m, P(109));
    const cheekR = at(m, P(110));
    const forehead = at(m, [face.ext[2], face.ext[3]]);
    const corner = at(m, [0.02, 0.02]);
    const below = at(m, [0.5, 0.95]);
    const eyeL = at(m, P(74));
    const eyeR = at(m, P(77));
    const mouthC = at(m, P(106));
    // feather: walk from the left cheek centre outward horizontally
    let ramp = 0;
    const y = P(109)[1];
    for (let x = P(109)[0]; x > 0; x -= 1 / mw) {
      const v = at(m, [x, y]);
      if (v > 8 && v < 247) ramp++;
    }
    const ok =
      nose > 250 && cheekL > 250 && cheekR > 250 && forehead > 250 && corner === 0 && below === 0 &&
      eyeL < 5 && eyeR < 5 && mouthC < 5 && ramp >= 3;
    check(
      'mask ≈1 inside oval, 0 outside, eye/mouth holes, feathered edge',
      ok,
      `nose ${nose} cheeks ${cheekL}/${cheekR} forehead ${forehead} corner ${corner} below-chin ${below} eyes ${eyeL}/${eyeR} mouth ${mouthC}; edge ramp ${ramp} px @¼ res`,
    );
    // eye hole feather
    let eyeRamp = 0;
    for (let x = P(74)[0]; x > P(74)[0] - 0.1; x -= 1 / mw) {
      const v = at(m, [x, P(74)[1]]);
      if (v > 8 && v < 247) eyeRamp++;
    }
    check('eye holes are feathered', eyeRamp >= 2, `${eyeRamp} intermediate px left of the eye centre`);
    {
      // The pipeline pushes the mask through the reshape map (P2 'maskWarp'): at faceSlim 1 the
      // warped mask must equal mask∘warp, and drop where the jaw moved in (the unwarped mask is
      // still 1 there, over background / hair).
      const ms = maskBufferSize({ width: W, height: H });
      const raw = createFramebuffer(gl, ms.width, ms.height, gl.R8);
      const warped = createFramebuffer(gl, ms.width, ms.height, gl.R8);
      mask.draw(raw, face, 1);
      const u = reshapeUniforms(vals({ 'shape.faceSlim': 1 }), 1);
      reshape.draw(raw.tex, warped, face, u, aspect);
      const r0 = read(raw);
      const r1 = read(warped);
      const ua = { ...u };
      for (const k of Object.keys(ua) as (keyof ReshapeUniforms)[]) ua[k] *= yawAttenuation(face.yaw);
      const g = reshapeGeometry(face, aspect, ua);
      let maxErr = 0;
      let strip = 0;
      for (let yy = 0; yy < ms.height; yy++)
        for (let xx = 0; xx < ms.width; xx++) {
          const q = warpRef([(xx + 0.5) / ms.width, (yy + 0.5) / ms.height], face, ua, g, aspect);
          const o = (yy * ms.width + xx) * 4;
          maxErr = Math.max(maxErr, Math.abs(r1.data[o] - bilinearR(r0, q[0], q[1])));
          if (r0.data[o] >= 230 && r1.data[o] <= 128) strip++;
        }
      check(
        'mask follows the reshape map (faceSlim 1)',
        maxErr <= 4 && strip >= 50 && glErr() === gl.NO_ERROR,
        `max |warped − mask∘warpRef| ${fmt(maxErr, 1)}/255; ${strip} ¼-res px (≈${strip * 16} px) of the unwarped mask now outside the slimmed jaw`,
      );
      metrics.maskWarpStripPx = strip * 16;
    }
    saveImage('mask', m, { x: 0, y: 0, w: mw, h: mh }, 2, (d) => {
      for (let i = 0; i < d.length; i += 4) d[i + 1] = d[i + 2] = d[i];
    });
    // mask tinted over the face (full res, bilinear upsample is what P5 does)
    const tinted = new ImageData(new Uint8ClampedArray(base.data), W, H);
    for (let yy = 0; yy < H; yy++)
      for (let xx = 0; xx < W; xx++) {
        const v = bilinearR(m, (xx + 0.5) / W, (yy + 0.5) / H) / 255;
        const o = (yy * W + xx) * 4;
        tinted.data[o] = tinted.data[o] * (0.35 + 0.65 * v);
        tinted.data[o + 1] = tinted.data[o + 1] * (0.35 + 0.65 * v);
        tinted.data[o + 2] = tinted.data[o + 2] * (0.35 + 0.65 * v) + 120 * (1 - v);
      }
    saveImage('mask_overlay', tinted, faceCrop, 0.7);

    mask.draw(mfb, face, 0.5);
    const mh5 = read(mfb);
    const half = [at(mh5, [0.02, 0.02]), at(mh5, P(46)), at(mh5, P(74))];
    check('mask faceWeight 0.5 → mix(1, mask, 0.5)', Math.abs(half[0] - 128) <= 1 && half[1] > 250 && Math.abs(half[2] - 128) <= 3, `corner ${half[0]} nose ${half[1]} eye ${half[2]}`);
    mask.draw(mfb, face, 0);
    const z = read(mfb);
    mask.fill(mfb, 1);
    const f1 = read(mfb);
    mask.fill(mfb, 0);
    const f0 = read(mfb);
    const allR = (img: ImageData, v: number) => {
      for (let i = 0; i < img.data.length; i += 4) if (img.data[i] !== v) return false;
      return true;
    };
    check('mask faceWeight 0 / fill(1) / fill(0)', allR(z, 255) && allR(f1, 255) && allR(f0, 0), 'uniform 255 / 255 / 0');
  }

  // ── F. overlay ──
  {
    const presentFs = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform float uMirror;
out vec4 outColor;
void main() { outColor = texture(uSrc, vec2(mix(vUv.x, 1.0 - vUv.x, uMirror), 1.0 - vUv.y)); }`;
    const present = createProgram(gl, FULLSCREEN_VS, presentFs, 'present');
    const results: string[] = [];
    let ok = true;
    for (const mirror of [false, true]) {
      bindTarget(gl, null, W, H);
      present.use();
      gl.uniform1i(present.u('uSrc'), 0);
      gl.uniform1f(present.u('uMirror'), mirror ? 1 : 0);
      bindTexture(gl, 0, srcTex);
      drawFullscreen(gl);
      overlay.draw(face, mirror);
      const pxs = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pxs);
      for (const i of [46, 74, 0, 32]) {
        const p = P(i);
        const x = Math.floor((mirror ? 1 - p[0] : p[0]) * W);
        const yTop = Math.floor(p[1] * H);
        const o = ((H - 1 - yTop) * W + x) * 4;
        const lime = pxs[o] === 184 && pxs[o + 1] === 240 && pxs[o + 2] === 42;
        ok &&= lime;
        results.push(`${mirror ? 'mirror ' : ''}p${i} rgb(${pxs[o]},${pxs[o + 1]},${pxs[o + 2]})`);
      }
      const e = [face.ext[0], face.ext[1]];
      const ex = Math.floor((mirror ? 1 - e[0] : e[0]) * W);
      const eo = ((H - 1 - Math.floor(e[1] * H)) * W + ex) * 4;
      const magenta = pxs[eo] === 255 && pxs[eo + 2] > 200 && pxs[eo + 1] < 80;
      ok &&= magenta;
      results.push(`${mirror ? 'mirror ' : ''}ext0 rgb(${pxs[eo]},${pxs[eo + 1]},${pxs[eo + 2]})`);
      if (!mirror) {
        const c2 = document.createElement('canvas');
        c2.width = faceCrop.w;
        c2.height = faceCrop.h;
        c2.getContext('2d')!.drawImage(canvas, faceCrop.x, faceCrop.y, faceCrop.w, faceCrop.h, 0, 0, faceCrop.w, faceCrop.h);
        images['overlay'] = c2.toDataURL('image/png');
      }
    }
    check('overlay draws lime 111 pts + magenta ext with present flip / mirror', ok && glErr() === gl.NO_ERROR, results.join(', '));
  }

  // ── G. informational timing (headless GPU, not representative of iPhone) ──
  {
    const fb = createFramebuffer(gl, 1080, 1920);
    const u = reshapeUniforms(applyPreset('refined').values, 1);
    const t = (fn: () => void) => {
      fn();
      gl.finish();
      const t0 = performance.now();
      for (let i = 0; i < 30; i++) fn();
      gl.finish();
      return (performance.now() - t0) / 30;
    };
    metrics.ms_reshape_refined_1080x1920 = t(() => reshape.draw(srcTex, fb, face, u));
    metrics.ms_makeup_glow_1080x1920 = t(() => makeup.draw(srcTex, fb, face, makeupUniforms(applyPreset('glow'), 1)));
    const mfb = createFramebuffer(gl, 270, 480, gl.R8);
    metrics.ms_mask_270x480 = t(() => mask.draw(mfb, face, 1));
    metrics.reshapeActive_natural = reshapeActive(reshapeUniforms(applyPreset('natural').values, 1));
  }

  reshape.dispose();
  makeup.dispose();
  mask.dispose();
  overlay.dispose();
  check('dispose without GL error', glErr() === gl.NO_ERROR, '');
}

// ───────── helpers ─────────

function clampRect(r: Rect, W: number, H: number): Rect {
  const x = Math.max(0, Math.round(r.x));
  const y = Math.max(0, Math.round(r.y));
  return { x, y, w: Math.min(W - x, Math.round(r.w)), h: Math.min(H - y, Math.round(r.h)) };
}

function maxDiff(a: ImageData, b: ImageData): number {
  let m = 0;
  for (let i = 0; i < a.data.length; i++) if ((i & 3) !== 3) m = Math.max(m, Math.abs(a.data[i] - b.data[i]));
  return m;
}

function maxDiffOutside(a: ImageData, b: ImageData, r: Rect): number {
  let m = 0;
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++) {
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) continue;
      const o = (y * a.width + x) * 4;
      for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(a.data[o + c] - b.data[o + c]));
    }
  return m;
}

function changedCount(a: ImageData, b: ImageData, r: Rect): number {
  let n = 0;
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) {
      const o = (y * a.width + x) * 4;
      if (a.data[o] !== b.data[o] || a.data[o + 1] !== b.data[o + 1] || a.data[o + 2] !== b.data[o + 2]) n++;
    }
  return n;
}

function changedWhere(a: ImageData, b: ImageData, pred: (x: number, y: number) => boolean): number {
  let n = 0;
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++) {
      if (!pred(x + 0.5, y + 0.5)) continue;
      const o = (y * a.width + x) * 4;
      if (Math.abs(a.data[o] - b.data[o]) > 1 || Math.abs(a.data[o + 1] - b.data[o + 1]) > 1 || Math.abs(a.data[o + 2] - b.data[o + 2]) > 1) n++;
    }
  return n;
}

/** Mean out/in ratio per channel in a region (optionally over the 15% most-affected pixels). */
function regionRatio(
  inp: ImageData,
  out: ImageData,
  pred: (x: number, y: number) => boolean,
  strongest = false,
): { ratio: [number, number, number]; strength: number } {
  const rows: [number, number, number][] = [];
  for (let y = 0; y < inp.height; y++)
    for (let x = 0; x < inp.width; x++) {
      if (!pred(x + 0.5, y + 0.5)) continue;
      const o = (y * inp.width + x) * 4;
      if (inp.data[o] < 40 || inp.data[o + 1] < 40 || inp.data[o + 2] < 40) continue;
      rows.push([out.data[o] / inp.data[o], out.data[o + 1] / inp.data[o + 1], out.data[o + 2] / inp.data[o + 2]]);
    }
  let use = rows;
  if (strongest) {
    use = [...rows].sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2])).slice(0, Math.max(1, Math.floor(rows.length * 0.15)));
  }
  const s: [number, number, number] = [0, 0, 0];
  for (const r of use) for (let c = 0; c < 3; c++) s[c] += r[c] / use.length;
  return { ratio: s, strength: 1 - (s[0] + s[1] + s[2]) / 3 };
}

function cosine(a: readonly number[], b: readonly number[]): number {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return d / (Math.hypot(a[0], a[1], a[2]) * Math.hypot(b[0], b[1], b[2]));
}

function inPoly(poly: V2[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function expandPoly(poly: V2[], k: number): V2[] {
  const c = poly.reduce((s, p) => [s[0] + p[0] / poly.length, s[1] + p[1] / poly.length] as V2, [0, 0] as V2);
  return poly.map((p) => [c[0] + (p[0] - c[0]) * k, c[1] + (p[1] - c[1]) * k] as V2);
}

function bilinearR(img: ImageData, u: number, v: number): number {
  const x = u * img.width - 0.5;
  const y = v * img.height - 0.5;
  const x0 = Math.max(0, Math.min(img.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(img.height - 1, Math.floor(y)));
  const x1 = Math.min(img.width - 1, x0 + 1);
  const y1 = Math.min(img.height - 1, y0 + 1);
  const fx = Math.min(1, Math.max(0, x - x0));
  const fy = Math.min(1, Math.max(0, y - y0));
  const g = (xx: number, yy: number) => img.data[(yy * img.width + xx) * 4];
  return (g(x0, y0) * (1 - fx) + g(x1, y0) * fx) * (1 - fy) + (g(x0, y1) * (1 - fx) + g(x1, y1) * fx) * fy;
}

function gridOver(img: ImageData): ImageData {
  const out = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  const step = 16;
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      if (x % step !== 0 && y % step !== 0 && (x + 1) % step !== 0 && (y + 1) % step !== 0) continue;
      const o = (y * img.width + x) * 4;
      out.data[o] = 30;
      out.data[o + 1] = 255;
      out.data[o + 2] = 255;
    }
  return out;
}

function saveImage(name: string, img: ImageData, crop: Rect, scale = 1, edit?: (d: Uint8ClampedArray) => void) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const d = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  edit?.(d.data);
  c.getContext('2d')!.putImageData(d, 0, 0);
  const o = document.createElement('canvas');
  o.width = Math.round(crop.w * scale);
  o.height = Math.round(crop.h * scale);
  const ctx = o.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, crop.x, crop.y, crop.w, crop.h, 0, 0, o.width, o.height);
  images[name] = o.toDataURL('image/png');
}

function saveRow(name: string, imgs: ImageData[], labels: string[], crop: Rect, scale = 1) {
  const cw = Math.round(crop.w * scale);
  const ch = Math.round(crop.h * scale);
  const o = document.createElement('canvas');
  o.width = cw * imgs.length + 4 * (imgs.length - 1);
  o.height = ch + 22;
  const ctx = o.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, o.width, o.height);
  ctx.imageSmoothingQuality = 'high';
  imgs.forEach((img, i) => {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d')!.putImageData(img, 0, 0);
    ctx.drawImage(c, crop.x, crop.y, crop.w, crop.h, i * (cw + 4), 22, cw, ch);
    ctx.fillStyle = '#fff';
    ctx.font = '14px sans-serif';
    ctx.fillText(labels[i] ?? '', i * (cw + 4) + 4, 16);
  });
  images[name] = o.toDataURL('image/png');
}

/** Fallback face: GPUPixel template placed on the sample photo by a similarity on the eye centres. */
function templateFace(W: number, H: number): Face {
  const t = (i: number): V2 => [FACE_TEMPLATE[i * 2], FACE_TEMPLATE[i * 2 + 1]];
  const eyeL: V2 = [283, 520];
  const eyeR: V2 = [555, 490];
  const a = t(74);
  const b = t(77);
  const s = Math.hypot(eyeR[0] - eyeL[0], eyeR[1] - eyeL[1]) / Math.hypot(b[0] - a[0], b[1] - a[1]);
  const rot = Math.atan2(eyeR[1] - eyeL[1], eyeR[0] - eyeL[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]);
  const map = (p: V2): V2 => {
    const x = p[0] - a[0];
    const y = p[1] - a[1];
    return [(eyeL[0] + s * (x * Math.cos(rot) - y * Math.sin(rot))) / W, (eyeL[1] + s * (x * Math.sin(rot) + y * Math.cos(rot))) / H];
  };
  const pts111 = new Float32Array(222);
  for (let i = 0; i < 111; i++) pts111.set(map(t(i)), i * 2);
  const oval = new Float32Array(72);
  for (let i = 0; i < 36; i++) {
    const ang = (i / 36) * Math.PI * 2;
    oval.set(map([0.5 + 0.2 * Math.sin(ang), 0.47 - 0.26 * Math.cos(ang)]), i * 2);
  }
  const ext = new Float32Array(16);
  [[0.5, 0.2], [0.5, 0.26], [0.5, 0.34], [0.5, 0.4], [0.5, 0.71], [0.5, 0.68], [0.3, 0.45], [0.7, 0.45]].forEach((p, i) =>
    ext.set(map(p as V2), i * 2),
  );
  return { pts111, ext, oval, yaw: 0 };
}

const state = { done: false, checks, metrics, images } as NonNullable<Window['__t2']>;
window.__t2 = state;
main()
  .catch((e: unknown) => {
    state.error = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
    log('ERROR ' + state.error);
  })
  .finally(() => {
    state.done = true;
    log('done');
  });

