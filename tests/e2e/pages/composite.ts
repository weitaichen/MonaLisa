// Composite check (v0.4 step-2 spec §8.3): renders a generated chart and sample_face.png (250×375) through the real
// engine and compares each export with compositeCpu() — the CPU reference of P5's 質感 + 調節 stages — in the page.
// Skin stages are neutral and the 濾鏡 is 無, so the composite reads the source itself; both paths start from the
// same bytes (ImageData → ImageBitmap without colour conversion).
import { ADJUST_IDS, ADJUST_ONE_WAY, adjustUniforms, frameFor } from '../../../src/engine/adjustMath';
import { compositeCpu } from '../../../src/engine/compositeCpu';
import { createEngine } from '../../../src/engine/index';
import { LOOK_IDS, lookDef } from '../../../src/engine/looks';
import { defaultPhoto } from '../../../src/edit/state';
import type { AdjustId, LookId, PhotoParams, RenderInput } from '../../../src/types';

export interface CaseStats {
  passes: string[];
  max: number;
  mean: number;
  p999: number;
}
export interface CompositeCheck {
  renderer: string;
  glError: number;
  cases: Record<string, CaseStats>;
}

declare global {
  interface Window {
    runCompositeCheck?: () => Promise<CompositeCheck>;
  }
}

const SKINS = [
  [241, 194, 167],
  [232, 190, 172],
  [224, 172, 150],
  [200, 150, 130],
  [198, 134, 110],
  [171, 140, 114],
  [141, 85, 60],
];

function hsv(h: number, s: number, v: number): number[] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

/** 256×128: grey ramp, hue sweeps at three saturations, the 7 skin patches, a flat mid-grey block */
function chart(): ImageData {
  const W = 256;
  const H = 128;
  const img = new ImageData(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let c: number[];
      if (y < 24) c = [x / 255, x / 255, x / 255];
      else if (y < 48) c = hsv((x / W) * 360, 1, 0.9);
      else if (y < 72) c = hsv((x / W) * 360, 0.55, 0.75);
      else if (y < 96) c = hsv((x / W) * 360, 0.25, 0.6);
      else if (x < 7 * 24) c = SKINS[Math.floor(x / 24)].map((v) => v / 255);
      else c = [0.5, 0.5, 0.5];
      const i = (y * W + x) * 4;
      img.data[i] = Math.round(c[0] * 255);
      img.data[i + 1] = Math.round(c[1] * 255);
      img.data[i + 2] = Math.round(c[2] * 255);
      img.data[i + 3] = 255;
    }
  return img;
}

/** pixels of a same-origin PNG (opaque, no colour conversion), optionally resized */
async function pixels(url: string, w?: number, h?: number): Promise<ImageData> {
  const bmp = await createImageBitmap(await (await fetch(url)).blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const W = w ?? bmp.width;
  const H = h ?? bmp.height;
  const c = new OffscreenCanvas(W, H);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, W, H);
  bmp.close();
  return ctx.getImageData(0, 0, W, H);
}

/** every skin stage off, no 濾鏡, no look, neutral 調節 */
function neutralPhoto(): PhotoParams {
  const p = defaultPhoto();
  return { ...p, filterId: 'none', presetLink: null, look: null, values: { ...p.values, 'skin.whiten': 0, 'skin.sharpen': 0, 'filter.amount': 0 } };
}

/** max / mean / 99.9th percentile of |a − b| over the RGB channels of every pair */
function diffStats(pairs: [ArrayLike<number>, ArrayLike<number>][]): { max: number; mean: number; p999: number } {
  const hist = new Array<number>(256).fill(0);
  let sum = 0;
  let n = 0;
  let max = 0;
  for (const [a, b] of pairs)
    for (let i = 0; i < a.length; i += 4)
      for (let k = 0; k < 3; k++) {
        const d = Math.abs(a[i + k] - b[i + k]);
        hist[d]++;
        sum += d;
        n++;
        if (d > max) max = d;
      }
  let acc = 0;
  let p999 = 0;
  for (let d = 0; d < 256; d++) {
    acc += hist[d];
    if (acc >= n * 0.999) {
      p999 = d;
      break;
    }
  }
  return { max, mean: sum / n, p999 };
}

interface Case {
  values?: Partial<Record<AdjustId, number>>;
  look?: { id: LookId; amount: number };
}

window.runCompositeCheck = async () => {
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const engine = createEngine(canvas, { mirror: false });
  await engine.ready;
  for (const id of LOOK_IDS) await engine.loadLut('look', id);
  const gl = canvas.getContext('webgl2') as WebGL2RenderingContext;
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER));

  const luts: Record<string, Uint8ClampedArray> = {};
  for (const id of LOOK_IDS) luts[id] = (await pixels(`/luts/looks/look_${id}.png`)).data;
  const sources = [chart(), await pixels('/tests/fixtures/sample_face.png', 250, 375)];
  const bitmaps = await Promise.all(sources.map((s) => createImageBitmap(s, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })));

  const cases: Record<string, Case> = { neutral: {} };
  for (const id of ADJUST_IDS) {
    cases[`${id}+`] = { values: { [id]: 1 } };
    if (!ADJUST_ONE_WAY.has(id)) cases[`${id}-`] = { values: { [id]: 0 } };
  }
  for (const id of LOOK_IDS) cases[`look:${id}`] = { look: { id, amount: 1 } };
  cases.all = {
    values: Object.fromEntries(ADJUST_IDS.map((id) => [id, ADJUST_ONE_WAY.has(id) ? 0.6 : 0.8])) as Partial<Record<AdjustId, number>>,
    look: { id: 'cinema', amount: 0.8 },
  };
  // one display unit off neutral (below the slider's ±3 snap): drawn by the 調節 program, compared with the base render
  cases['jump:brightness'] = { values: { 'adjust.brightness': 0.51 } };
  cases['jump:exposure'] = { values: { 'adjust.exposure': 0.51 } };

  const neutralGpu: Uint8ClampedArray[] = [];
  const out: Record<string, CaseStats> = {};
  for (const [name, c] of Object.entries(cases)) {
    const pairs: [ArrayLike<number>, ArrayLike<number>][] = [];
    let passes: string[] = [];
    sources.forEach((src, s) => {
      const base = neutralPhoto();
      const photo: PhotoParams = { ...base, values: { ...base.values, ...c.values }, look: c.look ?? null };
      const input: RenderInput = { source: bitmaps[s], width: src.width, height: src.height, faces: [], globalSkin: null, photo };
      passes = engine.render(input, { still: true }).passes;
      const gpu = engine.renderToImageData(input, { mirror: false }).data;
      if (name === 'neutral') neutralGpu[s] = gpu;
      if (name.startsWith('jump:')) {
        pairs.push([gpu, neutralGpu[s]]);
        return;
      }
      const def = c.look ? lookDef(c.look.id) : null;
      const look = def && c.look ? { def, amount: c.look.amount } : null;
      const u = adjustUniforms(photo.values, look, true, frameFor({ width: src.width, height: src.height }));
      pairs.push([gpu, compositeCpu(src.data, src.width, src.height, u, c.look ? luts[c.look.id] : null)]);
    });
    out[name] = { passes, ...diffStats(pairs) };
  }

  const glError = gl.getError();
  engine.dispose();
  for (const b of bitmaps) b.close();
  return { renderer, glError, cases: out };
};
