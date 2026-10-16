// 調節 cost row (v0.4 step-2 spec §6.4): median GPU-complete render time, on a synthetic 1080 × 1920 bitmap (the largest
// live frame, as a still) and on the live camera frame at tier H, for (a) neutral — the base composite program, (b) all
// 12 調節 items at ±40, (c) each 質感 look at 0.8; per frame source, the first 調節 frame's overhead over its median; the
// compile + link of the 調節 program alone, timed on a fresh context before any engine here builds it; and a
// bit-exact probe of the grain hash (GPU lowbias32 vs adjustMath.ts).
// Decisions (spec §6.4): (b) − (a) ≤ 1.5 ms ships as is; > 3 ms → ADJUST_FAST in the camera; compile > 50 ms → pre-warm.
import { ADJUST_IDS, ADJUST_ONE_WAY, lowbias32, seedMix } from '../engine/adjustMath';
import { createProgram } from '../engine/gl/gl';
import { createEngine } from '../engine/index';
import { LOOK_IDS } from '../engine/looks';
import { GRAIN_HASH_GLSL } from '../engine/shaders/adjust';
import { compositeFs } from '../engine/shaders/composite';
import { PRESENT_VS } from '../engine/shaders/present';
import { defaultPhoto } from '../edit/state';
import type { PhotoParams, RenderInput } from '../types';

export interface AdjustBenchRow {
  config: string;
  medianMs: number;
  /** the frame drew with the 調節 program */
  adjust: boolean;
}
export interface AdjustBenchFrame {
  /** 合成 (the synthetic bitmap, drawn as a still) or 相機 H (the live camera frame, drawn at tier H) */
  label: string;
  /** source size → processing size */
  size: string;
  rows: AdjustBenchRow[];
  /**
   * the first 調節 frame of this source minus its 調節 median: uploads and first-draw driver work, plus, on the first
   * source, the engine's own build of the 調節 program unless the browser's program cache already holds it
   */
  firstFrameMs: number;
}
export interface AdjustBenchResult {
  frames: AdjustBenchFrame[];
  /** why the camera frame was not measured; null when it was */
  cameraNote: string | null;
  /** compile + link of the 調節 program alone, on a fresh context, before any engine of this run builds it */
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

/**
 * The 調節 program's compile + link alone (createProgram waits for LINK_STATUS), on a fresh context: the number the
 * > 50 ms pre-warm rule reads. It runs before any engine of the bench builds the program, so it is cold for this page;
 * the browser's own program cache may still hold it from an earlier visit.
 */
export function compileAdjustMs(now: () => number = () => performance.now()): number {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('WebGL2 unavailable');
  try {
    const t0 = now();
    const p = createProgram(gl, PRESENT_VS, compositeFs({ adjust: true }), 'composite-adjust (bench)');
    const ms = now() - t0;
    p.dispose();
    return ms;
  } finally {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/** the live camera's video when it has a frame to draw, else why not */
function cameraSource(video: HTMLVideoElement | null): { video: HTMLVideoElement } | { note: string } {
  if (!video) return { note: '未開相機（先按「開始」）' };
  if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return { note: '相機還沒有畫面' };
  return { video };
}

/**
 * The rows on the synthetic bitmap and, with `video` (the bench's live camera), on the camera frame at tier H as the
 * live loop draws it (not a still: processing at the tier's short edge, the video uploaded every frame).
 */
export async function runAdjustBench(video: HTMLVideoElement | null = null): Promise<AdjustBenchResult> {
  const compileMs = compileAdjustMs();
  const canvas = document.createElement('canvas');
  const engine = createEngine(canvas, { mirror: false });
  const bmp = await syntheticFrame();
  try {
    await engine.ready;
    engine.setTier('H');
    await Promise.all(LOOK_IDS.map((id) => engine.loadLut('look', id)));
    const gl = canvas.getContext('webgl2') as WebGL2RenderingContext;
    const px = new Uint8Array(4);
    const measure = (label: string, src: { source: TexImageSource; width: number; height: number; still: boolean }): AdjustBenchFrame => {
      const input = (photo: PhotoParams): RenderInput => ({ source: src.source, width: src.width, height: src.height, faces: [], globalSkin: null, photo });
      let size = '';
      /** one render, waited on until the GPU is done (renderMs alone is CPU issue time) */
      const once = (photo: PhotoParams) => {
        const t0 = performance.now();
        const s = engine.render(input(photo), { still: src.still });
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        size = `${src.width}×${src.height} → ${s.width}×${s.height}`;
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
      once(base); // warm the base program and this source's upload path
      const rows: AdjustBenchRow[] = [median('neutral', base)];
      const first = once(all12(base)).ms; // the first 調節 frame of this source
      const all = median('調節 ×12', all12(base));
      rows.push(all);
      for (const id of LOOK_IDS) rows.push(median(`質感 ${id}`, { ...base, look: { id, amount: 0.8 } }));
      return { label, size, rows, firstFrameMs: Math.max(0, first - all.medianMs) };
    };
    const frames = [measure('合成', { source: bmp, width: W, height: H, still: true })];
    const cam = cameraSource(video);
    if ('video' in cam) frames.push(measure('相機 H', { source: cam.video, width: cam.video.videoWidth, height: cam.video.videoHeight, still: false }));
    return { frames, cameraNote: 'note' in cam ? cam.note : null, compileMs, hash: probeGrainHash() };
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
  const lines: string[] = [];
  for (const f of r.frames) {
    lines.push(`${f.label} ${f.size}`);
    for (const row of f.rows) lines.push(`${row.config.padEnd(10)} ${row.medianMs.toFixed(2)} ms${row.adjust ? ' 調節' : ''}`);
    lines.push(`首幀額外 ${f.firstFrameMs.toFixed(1)} ms`);
  }
  if (r.cameraNote) lines.push(`相機 H：${r.cameraNote}`);
  lines.push(`編譯 ${r.compileMs.toFixed(1)} ms（獨立 context，冷）`);
  lines.push(`顆粒雜湊 ${r.hash.checked - r.hash.mismatches}/${r.hash.checked} 一致`);
  return `調節效能（中位數，含 GPU 完成）\n${lines.join('\n')}`;
}
