// B2 engine harness (served by vite on :5402, driven by run.mjs). window.runB2() exercises the 美體
// path of the real engine in headless Chromium and returns checks + PNGs:
//   1. face chain bit-identical to the pre-body engine (baseline/) when no body field is given
//   2. zero field = bit-exact identity (the shader path runs: passes include 'body')
//   3. a constant field shifts by exactly that many UV (square + portrait + landscape)
//   4. body + face together = face result resampled through the body map (order + maskWarp)
//   5. preview (display canvas) = export; live tier render applies the field too
//   6. field uploads only on version / size change; context loss → restore re-uploads
//   7. showcase renders on the full-body fixture (synthetic fields; B1 builds the real ones)
import landmarks from '../../fixtures/landmarks_sample_face.json';
import { createEngine } from '../../../src/engine/index';
import { applyPreset, setParam, setShade, setFilter } from '../../../src/engine/params';
import { reshapeGeometry, reshapeUniforms } from '../../../src/engine/passes/reshape';
import { adapt } from '../../../src/tracking/adapter111';
import type { BeautyParams, BodyField, Engine, Face, ParamId, RenderInput } from '../../../src/types';
import { createEngine as createBaselineEngine } from './baseline/index';

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}
export interface B2Result {
  renderer: string;
  checks: Check[];
  shots: Record<string, string>;
  errors: string[];
  timings: Record<string, number>;
}
declare global {
  interface Window {
    runB2?: () => Promise<B2Result>;
  }
}

const checks: Check[] = [];
const shots: Record<string, string> = {};
const timings: Record<string, number> = {};
const check = (name: string, ok: boolean, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
};

// ── pixels ──

function toPng(img: ImageData): string {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

function grabCanvas(src: HTMLCanvasElement): ImageData {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height);
}

interface Diff {
  max: number;
  count: number;
  mad: number;
}
/** out(x, y) vs ref(x + dx, y + dy) over the rect where both exist, shrunk by `margin` */
function diff(out: ImageData, ref: ImageData, dx = 0, dy = 0, margin = 0, rect?: [number, number, number, number]): Diff {
  const W = out.width;
  const H = out.height;
  let [x0, y0, x1, y1] = rect ?? [0, 0, W, H];
  x0 = Math.max(x0, margin, -dx + margin);
  y0 = Math.max(y0, margin, -dy + margin);
  x1 = Math.min(x1, W - margin, ref.width - dx - margin);
  y1 = Math.min(y1, H - margin, ref.height - dy - margin);
  let max = 0;
  let count = 0;
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      const j = ((y + dy) * ref.width + x + dx) * 4;
      let px = 0;
      for (let k = 0; k < 3; k++) {
        const d = Math.abs(out.data[i + k] - ref.data[j + k]);
        sum += d;
        if (d > px) px = d;
      }
      n += 3;
      if (px > 0) count++;
      if (px > max) max = px;
    }
  }
  return { max, count, mad: n ? sum / n : NaN };
}
const fmt = (d: Diff) => `max=${d.max} differing=${d.count} MAD=${d.mad.toFixed(4)}`;

// ── sources ──

/** deterministic RGB noise (every pixel distinct-ish, so a 1 px misregistration is caught) */
function noiseCanvas(w: number, h: number, seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  let s = seed >>> 0;
  for (let i = 0; i < img.data.length; i += 4) {
    s = (s * 1664525 + 1013904223) >>> 0;
    img.data[i] = s >>> 24;
    img.data[i + 1] = (s >>> 16) & 255;
    img.data[i + 2] = (s >>> 8) & 255;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

async function loadBitmap(url: string): Promise<ImageBitmap> {
  const blob = await (await fetch(url)).blob();
  return createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}

function scaledCanvas(bmp: ImageBitmap, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  return c;
}

// ── fields ──

let version = 1;
function makeField(w: number, h: number, fn: (u: number, v: number) => [number, number]): BodyField {
  const data = new Float32Array(w * h * 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [dx, dy] = fn((x + 0.5) / w, (y + 0.5) / h);
      data[(y * w + x) * 2] = dx;
      data[(y * w + x) * 2 + 1] = dy;
    }
  }
  return { width: w, height: h, data, version: version++ };
}
const constField = (dx: number, dy: number) => makeField(192, 256, () => [dx, dy]);

/** BR §長腿 legBand: backward source y for output y (C¹, monotonic); y grows downward */
function legBand(y: number, h: number, b: number, S: number): number {
  const tau = Math.min(1, Math.max(0, (y - (h - b)) / (2 * b)));
  const I = tau ** 3 - 0.5 * tau ** 4;
  return y + (1 / S - 1) * (2 * b * I + Math.max(0, y - (h + b)));
}

/**
 * BR capsule field on a vertical bone at x = cx between y0..y1 (iso units = UV x): backward map
 * v_src = v·(1 + k·a(t)·φ(r)), φ = (1 − r²)², r = |v|/R, a(t) a raised-cosine bump peaking at tPeak.
 */
function capsuleDx(u: number, v: number, aspect: number, o: { cx: number; y0: number; y1: number; R: number; k: number; tPeak: number; sigma: number }): number {
  const L = (o.y1 - o.y0) / aspect; // iso length
  const t = (v / aspect - o.y0 / aspect) / L;
  if (t < 0 || t > 1) return 0;
  const vv = u - o.cx;
  const r = Math.abs(vv) / o.R;
  if (r >= 1) return 0;
  const a = Math.exp(-0.5 * ((t - o.tPeak) / o.sigma) ** 2) * Math.min(1, t / 0.15, (1 - t) / 0.15);
  const phi = (1 - r * r) ** 2;
  return vv * o.k * a * phi;
}

// ── engines ──

interface Rig {
  canvas: HTMLCanvasElement;
  engine: Engine;
  gl: WebGL2RenderingContext;
}
function rig(make: typeof createEngine): Rig {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 16;
  document.body.appendChild(canvas);
  const engine = make(canvas, { mirror: false });
  return { canvas, engine, gl: canvas.getContext('webgl2') as WebGL2RenderingContext };
}

/** RG uploads (texImage2D / texSubImage2D with format RG) across every context of the page */
let rgUploads = 0;
function instrumentUploads(): void {
  const proto = WebGL2RenderingContext.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const name of ['texImage2D', 'texSubImage2D']) {
    const orig = proto[name];
    proto[name] = function (this: WebGL2RenderingContext, ...args: unknown[]) {
      if (args.length >= 9 && args[6] === this.RG) rgUploads++;
      return orig.apply(this, args);
    };
  }
}

async function run(): Promise<B2Result> {
  const errors: string[] = [];
  instrumentUploads();
  const face1500 = await loadBitmap('/tests/fixtures/sample_face.png');
  const FW = face1500.width;
  const FH = face1500.height;
  const face: Face = adapt({ points: new Float32Array(landmarks.points) }, FW, FH);
  const inp = (source: TexImageSource, w: number, h: number, params: BeautyParams, f: Face | null, body?: BodyField | null, faceWeight = 1): RenderInput => ({
    source,
    width: w,
    height: h,
    face: f,
    faceWeight: f ? faceWeight : 0,
    params,
    ...(body === undefined ? {} : { body }),
  });

  const orig = applyPreset('original', 1);
  const natural = applyPreset('natural', 1);
  const shapeIds: ParamId[] = ['shape.eyeEnlarge', 'shape.faceSlim', 'shape.faceV', 'shape.faceNarrow', 'shape.noseSlim'];
  let allShape = natural;
  for (const id of shapeIds) allShape = setParam(allShape, id, 1);
  for (const id of ['shape.chin', 'shape.forehead', 'shape.mouthSize', 'shape.eyeDistance'] as ParamId[]) allShape = setParam(allShape, id, 0.9);

  // ── 1. face chain bit-identical to the pre-body engine ──
  {
    const base = rig(createBaselineEngine as typeof createEngine);
    const cur = rig(createEngine);
    await Promise.all([base.engine.ready, cur.engine.ready]);
    await Promise.all([base.engine.loadFilter('mono'), cur.engine.loadFilter('mono')]).catch((e: unknown) => errors.push(`mono: ${String(e)}`));
    const yawed: Face = { ...face, yaw: 0.25 };
    const cases: [string, BeautyParams, Face | null, number, boolean][] = [
      ['original', orig, face, 1, false],
      ['natural', natural, face, 1, false],
      ['refined', applyPreset('refined', 1), face, 1, false],
      ['glow', applyPreset('glow', 1), face, 1, false],
      ['allShape', allShape, face, 1, false],
      ['allShape_mirror', allShape, face, 1, true],
      ['allShape_w0.4', allShape, face, 0.4, false],
      ['allShape_yaw0.25', allShape, yawed, 1, false],
      ['lip', setShade(allShape, 'lip', 'rose'), face, 1, false],
      ['mono', setFilter(natural, 'mono'), face, 1, false],
      ['noFace_natural', natural, null, 0, false],
    ];
    let worst = 0;
    const lines: string[] = [];
    for (const [name, params, f, w, mirror] of cases) {
      console.log(`1. ${name} ${Math.round(performance.now())}ms`);
      const i = inp(face1500, FW, FH, params, f, undefined, w);
      // display render first in each engine (records passes and warms makeup), then export
      const pb = base.engine.render(i, { still: true }).passes;
      const pc = cur.engine.render(i, { still: true }).passes;
      const db = grabCanvas(base.canvas);
      const dc = grabCanvas(cur.canvas);
      const eb = base.engine.renderToImageData(i, { mirror });
      const ec = cur.engine.renderToImageData(i, { mirror });
      const de = diff(ec, eb);
      const dd = diff(dc, db);
      worst = Math.max(worst, de.max, dd.max);
      lines.push(`${name}: export ${de.max}/${de.count}, display ${dd.max}/${dd.count}, passes ${pc.join(',')}`);
      if (JSON.stringify(pb) !== JSON.stringify(pc)) check(`1. passes unchanged: ${name}`, false, `${pb} vs ${pc}`);
      if (name === 'allShape') shots['1_allShape'] = toPng(ec);
    }
    // live tier render (processing size below the source) on the display canvas
    for (const tier of ['M', 'L'] as const) {
      base.engine.setTier(tier);
      cur.engine.setTier(tier);
      const i = inp(face1500, FW, FH, allShape, face);
      base.engine.render(i);
      cur.engine.render(i);
      const d = diff(grabCanvas(cur.canvas), grabCanvas(base.canvas));
      worst = Math.max(worst, d.max);
      lines.push(`live ${tier}: ${d.max}/${d.count}`);
    }
    check('1. no body field → output bit-identical to the pre-body engine (11 still cases × export+display, live M/L)', worst === 0, lines.join(' | '));
    check('1. no GL errors (baseline / current)', base.gl.getError() === 0 && cur.gl.getError() === 0);
    base.engine.dispose();
    cur.engine.dispose();
  }

  const { engine, gl, canvas } = rig(createEngine);
  await engine.ready;
  const glOk = (label: string) => {
    const e = gl.getError();
    if (e !== 0) check(`GL error after ${label}`, false, `0x${e.toString(16)}`);
  };

  // ── 2. zero field = bit-exact identity ──
  console.log(`section 2 ${Math.round(performance.now())}ms`);
  {
    const zero = makeField(192, 256, () => [0, 0]);
    const lines: string[] = [];
    let worst = 0;
    let bodyPass = true;
    for (const [name, params, f] of [
      ['original_noFace', orig, null],
      ['natural_noFace', natural, null],
      ['allShape_face', allShape, face],
      ['natural_face', natural, face],
    ] as [string, BeautyParams, Face | null][]) {
      const a = engine.renderToImageData(inp(face1500, FW, FH, params, f), { mirror: false });
      const passes = engine.render(inp(face1500, FW, FH, params, f, zero), { still: true }).passes;
      const b = engine.renderToImageData(inp(face1500, FW, FH, params, f, zero), { mirror: false });
      bodyPass &&= passes.includes('body') && passes.includes('reshape');
      const d = diff(b, a);
      worst = Math.max(worst, d.max);
      lines.push(`${name}: ${fmt(d)} passes=${passes.join(',')}`);
    }
    glOk('zero field');
    check('2. zero field = bit-exact identity (face / no face, skin on / off)', worst === 0, lines.join(' | '));
    check("2. the field path ran ('reshape' + 'body' in RenderStats.passes)", bodyPass);
  }

  // ── 3. constant field shifts by exactly that many UV ──
  console.log(`section 3 ${Math.round(performance.now())}ms`);
  {
    const lines: string[] = [];
    let worst = 0;
    // (w, h, dxUV, dyUV): every value exact in half float and an integer pixel count
    const cases: [number, number, number, number][] = [
      [512, 256, 1 / 64, 1 / 64], // +8 px, +4 px
      [384, 512, -1 / 32, 1 / 64], // −12 px, +8 px (portrait)
      [512, 512, 1 / 128, -1 / 16], // +4 px, −32 px
    ];
    for (const [w, h, du, dv] of cases) {
      const src = noiseCanvas(w, h, w * 7 + h);
      const ref = engine.renderToImageData(inp(src, w, h, orig, null), { mirror: false });
      const out = engine.renderToImageData(inp(src, w, h, orig, null, constField(du, dv)), { mirror: false });
      const sx = Math.round(du * w);
      const sy = Math.round(dv * h);
      const d = diff(out, ref, sx, sy);
      worst = Math.max(worst, d.max);
      lines.push(`${w}x${h} (${sx},${sy}) px: ${fmt(d)}`);
      if (w === 512 && h === 256) {
        // beyond the edge the sample clamps: the last columns repeat the source's last column
        const edge = diff(out, ref, 0, 0, 0, [w - sx, sy, w, h]);
        let clampOk = true;
        for (let y = 0; y < h - sy; y++)
          for (let x = w - sx; x < w; x++) {
            const i = (y * w + x) * 4;
            const j = ((y + sy) * w + (w - 1)) * 4;
            if (out.data[i] !== ref.data[j] || out.data[i + 1] !== ref.data[j + 1]) clampOk = false;
          }
        lines.push(`edge clamp ${clampOk ? 'ok' : 'BAD'} (${edge.count} px differ from unshifted, as expected)`);
        if (!clampOk) worst = 999;
      }
    }
    glOk('constant shift');
    check('3. constant field (du, dv) moves content by exactly (du·W, dv·H) px', worst === 0, lines.join(' | '));
  }

  // ── 4. body + face together ──
  console.log(`section 4 ${Math.round(performance.now())}ms`);
  // Source scaled to 1024×1536 so 1/64 UV = 16 / 24 px and = 4 / 6 texels of the ¼-res skin mask.
  {
    const src = scaledCanvas(face1500, 1024, 1536);
    const W = 1024;
    const H = 1536;
    const faceS = adapt({ points: new Float32Array(landmarks.points) }, W, H);
    const lines: string[] = [];
    let worst = 0;
    for (const [name, params] of [
      ['allShape', setParam(allShape, 'skin.smooth', 0)],
      ['allShape+smooth', allShape],
      ['natural+lip', setShade(natural, 'lip', 'rose')],
    ] as [string, BeautyParams][]) {
      const faceOnly = engine.renderToImageData(inp(src, W, H, params, faceS), { mirror: false });
      const passes = engine.render(inp(src, W, H, params, faceS, constField(1 / 64, -1 / 64)), { still: true }).passes;
      const both = engine.renderToImageData(inp(src, W, H, params, faceS, constField(1 / 64, -1 / 64)), { mirror: false });
      // out(x) = faceOnly(x + d): the body map is applied outside the face chain (and to the mask);
      // the margin excludes border pixels whose blur / sharpen taps clamp differently
      const d = diff(both, faceOnly, 16, -24, 40);
      // Inside the face warps the sample point is face(vUv + d) vs face(vUv') with vUv' rasterised at
      // the shifted pixel: equal up to float rounding, which may flip a handful of 8-bit roundings.
      worst = Math.max(worst, d.max > 1 || d.count > 50 ? 99 : 0);
      lines.push(`${name}: ${fmt(d)} passes=${passes.join(',')}`);
      if (name === 'allShape+smooth') {
        shots['4_faceOnly'] = toPng(faceOnly);
        shots['4_faceAndBody'] = toPng(both);
      }
    }
    check('4. body + face: output = face result moved by the body field (incl. maskWarp, makeup; ≤1 level on ≤50 px float rounding)', worst === 0, lines.join(' | '));

    // A field that is zero over the face and non-zero below: face region identical to face-only,
    // region below identical to the body-only render (no face warp reaches it).
    // skin smoothing / rosy off: no mask or blur, so every output pixel depends only on its own
    // sample (± the 1 px sharpen taps) and the face-gated mask cannot differ between the renders
    const params = setParam(setParam(allShape, 'skin.smooth', 0), 'skin.rosy', 0);
    const ramp = (v: number) => {
      const t = Math.min(1, Math.max(0, (v - 0.55) / 0.2));
      return t * t * (3 - 2 * t);
    };
    const below = makeField(192, 256, (u, v) => [0.03 * ramp(v) * Math.sin(2 * Math.PI * u), 0]);
    const faceOnly = engine.renderToImageData(inp(src, W, H, params, faceS), { mirror: false });
    const bodyOnly = engine.renderToImageData(inp(src, W, H, params, null, below), { mirror: false });
    const both = engine.renderToImageData(inp(src, W, H, params, faceS, below), { mirror: false });
    const top = diff(both, faceOnly, 0, 0, 0, [0, 0, W, Math.floor(0.55 * H) - 8]);
    // below the face warps' influence box (+ the field's max |dy| = 0 and the 1 px sharpen tap)
    const box = reshapeGeometry(faceS, W / H, reshapeUniforms(params.values, 1)).box;
    const yBelow = Math.max(Math.ceil(0.55 * H) + 8, Math.ceil(box[3] * H) + 2);
    const bot = diff(both, bodyOnly, 0, 0, 0, [0, yBelow, W, H]);
    const moved = diff(bodyOnly, faceOnly, 0, 0, 0, [0, yBelow, W, H]);
    check('4. partial field: zero-field rows = face-only, rows below the face box = body-only', top.max === 0 && bot.max === 0 && moved.count > 1000, `top ${fmt(top)} | below y=${yBelow}: ${fmt(bot)} | body moved ${moved.count} px there`);
    glOk('body + face');
  }

  // ── 5. preview = export, live tier ──
  console.log(`section 5 ${Math.round(performance.now())}ms`);
  {
    const src = scaledCanvas(face1500, 1000, 1500);
    const f = makeField(192, 256, (u, v) => [0.02 * Math.sin(3 * u + 2 * v), 0.015 * Math.cos(4 * v)]);
    const i = inp(src, 1000, 1500, allShape, face, f);
    const st = engine.render(i, { still: true });
    const disp = grabCanvas(canvas);
    const exp = engine.renderToImageData(i, { mirror: false });
    const d = diff(disp, exp);
    check('5. still preview (display canvas) = export with a body field', d.max === 0 && st.passes.includes('body'), `${fmt(d)} passes=${st.passes.join(',')}`);
    const expM = engine.renderToImageData(i, { mirror: true });
    let mirrorMax = 0;
    for (let y = 0; y < 1500; y += 7)
      for (let x = 0; x < 1000; x += 3) {
        const a = (y * 1000 + x) * 4;
        const b = (y * 1000 + (999 - x)) * 4;
        mirrorMax = Math.max(mirrorMax, Math.abs(expM.data[a] - exp.data[b]));
      }
    check('5. mirrored export = mirror of the export (field in unmirrored image UV)', mirrorMax === 0, `max=${mirrorMax}`);
    engine.setTier('M');
    const live = engine.render(i);
    const liveImg = grabCanvas(canvas);
    engine.setTier('H');
    // compare against the export downsampled to the live size (nearest): body motion must show up
    const lw = live.width;
    const lh = live.height;
    let sum = 0;
    let n = 0;
    const noBody = engine.renderToImageData(inp(src, 1000, 1500, allShape, face), { mirror: false });
    let sumNoBody = 0;
    for (let y = 0; y < lh; y += 3)
      for (let x = 0; x < lw; x += 3) {
        const sxp = Math.min(999, Math.floor(((x + 0.5) * 1000) / lw));
        const syp = Math.min(1499, Math.floor(((y + 0.5) * 1500) / lh));
        const a = (y * lw + x) * 4;
        const b = (syp * 1000 + sxp) * 4;
        sum += Math.abs(liveImg.data[a + 1] - exp.data[b + 1]);
        sumNoBody += Math.abs(liveImg.data[a + 1] - noBody.data[b + 1]);
        n++;
      }
    check('5. live tier M render applies the same field (closer to the body export than to no-body)', live.passes.includes('body') && sum / n < 0.5 * (sumNoBody / n), `size ${lw}x${lh}; MAD vs body export ${(sum / n).toFixed(2)}, vs no-body ${(sumNoBody / n).toFixed(2)}`);
    glOk('preview/export');
  }

  // ── 6. upload bookkeeping + context loss ──
  console.log(`section 6 ${Math.round(performance.now())}ms`);
  {
    const src = noiseCanvas(512, 256, 99);
    const f = makeField(160, 80, (u, v) => [0.01 * Math.sin(6 * u) * Math.cos(5 * v), 0.012 * Math.sin(7 * v + u)]);
    const i = () => inp(src, 512, 256, orig, null, f);
    const u0 = rgUploads;
    const a = engine.renderToImageData(i(), { mirror: false });
    engine.render(i(), { still: true });
    engine.renderToImageData(i(), { mirror: false });
    const sameCount = rgUploads - u0;
    f.version++;
    engine.renderToImageData(i(), { mirror: false });
    const bumpCount = rgUploads - u0 - sameCount;
    const resized = makeField(80, 40, () => [0, 0]);
    engine.renderToImageData(inp(src, 512, 256, orig, null, resized), { mirror: false });
    const resizeCount = rgUploads - u0 - sameCount - bumpCount;
    check('6. field uploaded once per version (3 frames → 1 upload; version++ → 1; new size → 1)', sameCount === 1 && bumpCount === 1 && resizeCount === 1, `same=${sameCount} bump=${bumpCount} resize=${resizeCount}`);
    engine.renderToImageData(i(), { mirror: false }); // back to f (new object key → upload)

    const lose = gl.getExtension('WEBGL_lose_context');
    if (!lose) {
      check('6. context loss (WEBGL_lose_context)', false, 'extension missing');
    } else {
      const lost = new Promise((r) => canvas.addEventListener('webglcontextlost', r, { once: true }));
      lose.loseContext();
      await lost;
      // Chrome allows restoreContext only once the lost event's dispatch has finished
      await new Promise((r) => setTimeout(r, 0));
      const statsLost = engine.render(i(), { still: true });
      const restored = new Promise((r) => canvas.addEventListener('webglcontextrestored', r, { once: true }));
      lose.restoreContext();
      await Promise.race([restored, new Promise((_, rej) => setTimeout(() => rej(new Error('webglcontextrestored never fired')), 10_000))]);
      await engine.ready;
      const before = rgUploads;
      const st = engine.render(i(), { still: true });
      const b = engine.renderToImageData(i(), { mirror: false });
      const d = diff(b, a);
      check('6. after context loss + restore the same field (same version) is re-uploaded and renders identically', rgUploads - before === 1 && d.max === 0 && st.passes.includes('body') && statsLost.passes.length === 0, `re-uploads=${rgUploads - before} ${fmt(d)} passes=${st.passes.join(',')} lostFrame=${JSON.stringify(statsLost.passes)}`);
      glOk('restore');
    }
  }

  // ── 7. malformed fields are ignored, not fatal ──
  console.log(`section 7 ${Math.round(performance.now())}ms`);
  {
    const src = noiseCanvas(64, 64, 5);
    const ref = engine.renderToImageData(inp(src, 64, 64, orig, null), { mirror: false });
    const nan = makeField(8, 8, () => [NaN, 0]);
    const short: BodyField = { width: 8, height: 8, data: new Float32Array(10), version: 1 };
    const warn = console.warn;
    let warned = 0;
    console.warn = () => void warned++;
    const p1 = engine.render(inp(src, 64, 64, orig, null, nan), { still: true }).passes;
    const o1 = engine.renderToImageData(inp(src, 64, 64, orig, null, nan), { mirror: false });
    const p2 = engine.render(inp(src, 64, 64, orig, null, short), { still: true }).passes;
    console.warn = warn;
    check('7. NaN / short fields are skipped (no body pass, identity, warned)', !p1.includes('body') && !p2.includes('body') && diff(o1, ref).max === 0 && warned >= 2, `passes ${p1} / ${p2}, warnings ${warned}`);
    glOk('malformed');
  }

  // ── 8. showcase on the full-body fixture (synthetic fields; real ones come from src/body) ──
  console.log(`section 8 ${Math.round(performance.now())}ms`);
  try {
    const body = await loadBitmap('/tests/fixtures/fullbody.jpg');
    const W = body.width;
    const H = body.height;
    const aspect = W / H;
    const t0 = performance.now();
    shots['8_original'] = toPng(engine.renderToImageData(inp(body, W, H, orig, null), { mirror: false }));
    // 長腿: legBand below the hip line (y≈0.50), S = 1.12 (feet stay in frame: 0.5 + 0.42/1.12 < 1)
    const legs = makeField(Math.round(256 * aspect), 256, (_u, v) => [0, legBand(v, 0.5, 0.04, 1.12) - v]);
    shots['8_legs'] = toPng(engine.renderToImageData(inp(body, W, H, orig, null, legs), { mirror: false }));
    // 細腰 capsule on the torso axis (no background protection here — that is buildBodyField's mask)
    const waist = makeField(Math.round(256 * aspect), 256, (u, v) => [capsuleDx(u, v, aspect, { cx: 0.5, y0: 0.22, y1: 0.5, R: 0.26, k: 0.25, tPeak: 0.62, sigma: 0.3 }), 0]);
    shots['8_waist'] = toPng(engine.renderToImageData(inp(body, W, H, orig, null, waist), { mirror: false }));
    const both = makeField(Math.round(256 * aspect), 256, (u, v) => [capsuleDx(u, v, aspect, { cx: 0.5, y0: 0.22, y1: 0.5, R: 0.26, k: 0.25, tPeak: 0.62, sigma: 0.3 }), legBand(v, 0.5, 0.04, 1.12) - v]);
    shots['8_legs_waist'] = toPng(engine.renderToImageData(inp(body, W, H, orig, null, both), { mirror: false }));
    timings.showcase4 = performance.now() - t0;
    glOk('showcase');
  } catch (e) {
    errors.push(`showcase: ${String(e)}`);
  }

  check('no GL errors at the end', gl.getError() === 0);
  engine.dispose();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  return { renderer, checks, shots, errors, timings };
}

window.runB2 = async () => {
  try {
    return await run();
  } catch (e) {
    return { renderer: '', checks, shots, errors: [String(e instanceof Error ? e.stack ?? e.message : e)], timings };
  }
};
