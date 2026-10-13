// 調節 cost row (v0.4 step-2 spec §6.4): median GPU-complete render time at 1080 × 1920 (the largest live frame) for
// (a) neutral — the base composite program, (b) all 12 調節 items at ±40, (c) each 質感 look at 0.8; the cold
// compile + link of the 調節 program; and a bit-exact probe of the grain hash (GPU lowbias32 vs adjustMath.ts).
// Decisions (spec §6.4): (b) − (a) ≤ 1.5 ms ships as is; > 3 ms → ADJUST_FAST in the camera; compile > 50 ms → pre-warm.
import { ADJUST_IDS, ADJUST_ONE_WAY, lowbias32, seedMix } from '../engine/adjustMath';
import { createEngine } from '../engine/index';
import { LOOK_IDS } from '../engine/looks';
import { GRAIN_HASH_GLSL } from '../engine/shaders/adjust';
import { defaultPhoto } from '../edit/state';
import type { PhotoParams, RenderInput } from '../types';

export interface AdjustBenchRow {
  config: string;
  medianMs: number;
  /** the frame drew with the 調節 program */
  adjust: boolean;
}
export interface AdjustBenchResult {
  size: string;
  rows: AdjustBenchRow[];
  compileMs: number;
  hash: { checked: number; mismatches: number };
}

const RUNS = 30;
const W = 1080;
const H = 1920;

/** every skin stage off, no 濾鏡, neutral 調節 */
function neutralPhoto(): PhotoParams {
  const p = defaultPhoto();
  return { ...p, filterId: 'none', look: null, values: { ...p.values, 'skin.whiten': 0, 'skin.sharpen': 0, 'filter.amount': 0 } };
}

/** all 12 items at ±40 display units (one-way items at 40) */
function all12(base: PhotoParams): PhotoParams {
  const values = { ...base.values };
  ADJUST_IDS.forEach((id, i) => {
    values[id] = ADJUST_ONE_WAY.has(id) ? 0.4 : i % 2 === 0 ? 0.9 : 0.1;
  });
  return { ...base, values };
}

async function syntheticFrame(): Promise<ImageBitmap> {
  const img = new ImageData(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      img.data[i] = (x * 255) / W;
      img.data[i + 1] = (y * 255) / H;
      img.data[i + 2] = 64 + ((x + y) * 127) / (W + H);
      img.data[i + 3] = 255;
    }
  return createImageBitmap(img);
}

export async function runAdjustBench(): Promise<AdjustBenchResult> {
  const canvas = document.createElement('canvas');
  const engine = createEngine(canvas, { mirror: false });
  const bmp = await syntheticFrame();
  try {
    await engine.ready;
    await Promise.all(LOOK_IDS.map((id) => engine.loadLut('look', id)));
    const gl = canvas.getContext('webgl2') as WebGL2RenderingContext;
    const px = new Uint8Array(4);
    const input = (photo: PhotoParams): RenderInput => ({ source: bmp, width: W, height: H, faces: [], globalSkin: null, photo });
    /** one render, waited on until the GPU is done (renderMs alone is CPU issue time) */
    const once = (photo: PhotoParams) => {
      const t0 = performance.now();
      const s = engine.render(input(photo), { still: true });
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return { ms: performance.now() - t0, adjust: s.passes.includes('adjust') };
    };
    const median = (config: string, photo: PhotoParams): AdjustBenchRow => {
      const t: number[] = [];
      let adjust = false;
      for (let i = 0; i < RUNS; i++) {
        const r = once(photo);
        t.push(r.ms);
        adjust = r.adjust;
      }
      t.sort((a, b) => a - b);
      return { config, medianMs: t[RUNS >> 1], adjust };
    };
    const base = neutralPhoto();
    once(base); // warm the base program and the upload path
    const rows: AdjustBenchRow[] = [median('neutral', base)];
    const cold = once(all12(base)).ms; // the first 調節 frame compiles and links the program
    const all = median('調節 ×12', all12(base));
    rows.push(all);
    for (const id of LOOK_IDS) rows.push(median(`質感 ${id}`, { ...base, look: { id, amount: 0.8 } }));
    return { size: `${W}×${H}`, rows, compileMs: Math.max(0, cold - all.medianMs), hash: probeGrainHash() };
  } finally {
    bmp.close();
    engine.dispose();
    // free the context now: repeated runs would otherwise pile up contexts until Chrome drops the oldest one,
    // which can be the bench's live engine
    canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

const PROBE_VS = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
/**
 * Like the composite, the probe declares no default int precision (only `precision highp float`), so it runs the
 * hash exactly as the 調節 program does: a GPU that honours mediump would fail it unless every integer is highp.
 */
const PROBE_FS = /* glsl */ `#version 300 es
precision highp float;
uniform highp uint uMix;
out vec4 outColor;
${GRAIN_HASH_GLSL}
void main() {
  highp ivec2 p = ivec2(gl_FragCoord.xy) - 32;
  highp uint h = lowbias32(uint(p.x) ^ lowbias32(uint(p.y) ^ uMix)) >> 8u;
  outColor = vec4(float(h & 255u), float((h >> 8u) & 255u), float(h >> 16u), 255.0) / 255.0;
}`;

/** The GPU's lowbias32 lattice hash for indices −32…31 (negative ones included) against the CPU port, bit for bit. */
export function probeGrainHash(): { checked: number; mismatches: number } {
  const N = 64;
  const canvas = document.createElement('canvas');
  canvas.width = N;
  canvas.height = N;
  const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL2 unavailable');
  try {
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`grain probe: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, PROBE_VS));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, PROBE_FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`grain probe: ${gl.getProgramInfoLog(prog)}`);
    gl.useProgram(prog);
    const mix = seedMix(12345);
    gl.uniform1ui(gl.getUniformLocation(prog, 'uMix'), mix);
    gl.viewport(0, 0, N, N);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const out = new Uint8Array(N * N * 4);
    gl.readPixels(0, 0, N, N, gl.RGBA, gl.UNSIGNED_BYTE, out);
    let mismatches = 0;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const h = lowbias32(((x - 32) >>> 0) ^ lowbias32(((y - 32) >>> 0) ^ mix)) >>> 8;
        const i = (y * N + x) * 4;
        if (out[i] !== (h & 255) || out[i + 1] !== ((h >>> 8) & 255) || out[i + 2] !== h >>> 16) mismatches++;
      }
    return { checked: N * N, mismatches };
  } finally {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

export function formatAdjustBench(r: AdjustBenchResult): string {
  const lines = r.rows.map((row) => `${row.config.padEnd(10)} ${row.medianMs.toFixed(2)} ms${row.adjust ? ' 調節' : ''}`);
  lines.push(`編譯 ${r.compileMs.toFixed(1)} ms`);
  lines.push(`顆粒雜湊 ${r.hash.checked - r.hash.mismatches}/${r.hash.checked} 一致`);
  return `調節效能 ${r.size}（中位數，含 GPU 完成）\n${lines.join('\n')}`;
}
