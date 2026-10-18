// The face-table carrier from the renderer pick to the GPU (S §4.4, §6.4). createEngine picks it per renderer
// (faceTableCarrier.ts), createPipeline hands it to createReshapePass, and the pass compiles RESHAPE_FS with it and draws
// through it. index.test.ts fakes the pipeline and reshapePass.test.ts builds the pass itself, so this file runs the
// real engine → pipeline → pass chain on a recording fake context: a hop that stops passing the pick builds the pass's
// default, the texture, which the SwiftShader e2e (whose pick is the texture) cannot tell from a correct build.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFace } from '../app/testFakes';
import { FACE_TABLE_CARRIER } from '../config/limits';
import { legacyFrame } from '../edit/frame';
import type { RenderInput } from '../types';
import { createEngine } from './index';
import { defaultParams } from './params';
import { createPipeline, type FrameJob } from './pipeline';
import { reshapeFs } from './passes/reshape';

// the LUTs and makeup textures are fetched images: stand-ins; every other GL helper is real
vi.mock('./gl/gl', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./gl/gl')>()),
  loadImageTexture: vi.fn(async () => ({ tex: {}, width: 512, height: 512 })),
}));
// the dev-build probes draw and read back: stubbed
vi.mock('./glProbe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./glProbe')>()),
  probeFaceTable: vi.fn(() => ({ texture: true, ubo: true, float32: null })),
  probeR16FArray: vi.fn(() => true),
}));
// the real pipeline, its frame jobs recorded (the pipeline-level cases below replay one)
const jobs = vi.hoisted((): FrameJob[] => []);
vi.mock('./pipeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pipeline')>();
  return {
    ...actual,
    createPipeline: vi.fn((gl: WebGL2RenderingContext, opts?: { faceTable?: 'texture' | 'ubo' }) => {
      const p = actual.createPipeline(gl, opts);
      const run = p.run.bind(p);
      p.run = (job) => {
        jobs.push(job);
        return run(job);
      };
      return p;
    }),
  };
});

const UNMASKED_RENDERER = 0x9246;
const GPU = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)';
const SWIFTSHADER = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)';

/**
 * A WebGL2 context that accepts every call and records shader sources and UBO bindings: every compile and link
 * succeeds, constants are distinct numbers, objects are fresh `{}`. `renderer` is the unmasked renderer string; a
 * function is called instead (one that throws stands for a context whose renderer cannot be read).
 */
function recordingGl(renderer: string | (() => string)) {
  const ids = new Map<string, number>();
  const constant = (k: string) => {
    let v = ids.get(k);
    if (v === undefined) ids.set(k, (v = 0x10000 + ids.size));
    return v;
  };
  const sources: string[] = [];
  const uboBinds: unknown[] = [];
  const own: Record<string, unknown> = {
    drawingBufferWidth: 64,
    drawingBufferHeight: 64,
    isContextLost: () => false,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getUniformBlockIndex: () => 0,
    checkFramebufferStatus: () => constant('FRAMEBUFFER_COMPLETE'),
    shaderSource: (_sh: unknown, src: string) => sources.push(src),
    bindBufferBase: (target: number, _index: number, buffer: unknown) => {
      if (target === constant('UNIFORM_BUFFER') && buffer) uboBinds.push(buffer);
    },
    getExtension: (name: string) => {
      if (name !== 'WEBGL_debug_renderer_info') return {};
      if (typeof renderer === 'function') renderer();
      return { UNMASKED_RENDERER_WEBGL: UNMASKED_RENDERER };
    },
    getParameter: (p: number) => {
      if (p === UNMASKED_RENDERER) return typeof renderer === 'function' ? renderer() : renderer;
      if (p === constant('MAX_VIEWPORT_DIMS')) return new Int32Array([4096, 4096]);
      return 4096;
    },
  };
  const gl = new Proxy(own, {
    get(t, k) {
      if (typeof k !== 'string') return undefined;
      if (k in t) return t[k];
      if (/^[A-Z][A-Z0-9_]*$/.test(k)) return constant(k);
      return () => ({});
    },
  }) as unknown as WebGL2RenderingContext;
  /** the carrier RESHAPE_FS was compiled with on this context, or null when no reshape pass was built */
  const compiled = (): 'texture' | 'ubo' | null =>
    sources.includes(reshapeFs('ubo')) ? 'ubo' : sources.includes(reshapeFs('texture')) ? 'texture' : null;
  return { gl, compiled, uboBinds };
}

function canvasOf(gl: WebGL2RenderingContext): HTMLCanvasElement {
  return { width: 0, height: 0, getContext: () => gl, addEventListener: () => {}, removeEventListener: () => {} } as unknown as HTMLCanvasElement;
}

/** a face at the default look: 瘦臉 0.15, so the frame runs the reshape pass */
const faceFrame = (): RenderInput => ({ source: {} as TexImageSource, width: 640, height: 480, ...legacyFrame(defaultParams(), makeFace(), 1) });

beforeEach(() => {
  jobs.length = 0;
  vi.stubGlobal('window', {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the face-table carrier: renderer pick → createPipeline → createReshapePass → RESHAPE_FS (S §6.4)', () => {
  it.each([
    ['a GPU', GPU, FACE_TABLE_CARRIER],
    ['SwiftShader', SWIFTSHADER, 'texture'],
    ['an unreadable renderer', () => { throw new Error('no renderer'); }, FACE_TABLE_CARRIER],
  ] as const)('%s: the reshape pass compiles and draws with the pick, and FACE_TABLE_UBO says so', async (_name, renderer, want) => {
    const { gl, compiled, uboBinds } = recordingGl(renderer);
    const engine = createEngine(canvasOf(gl));
    await engine.ready;
    engine.render(faceFrame(), { still: true });
    expect(jobs.at(-1)!.faces).toHaveLength(1);
    expect(compiled()).toBe(want);
    expect(uboBinds.length > 0).toBe(want === 'ubo');
    expect((window as Window).__meiyan?.gl?.FACE_TABLE_UBO).toBe(want === 'ubo');
    engine.dispose();
  });

  it.each(['texture', 'ubo', undefined] as const)('createPipeline({ faceTable: %s }) builds the pass with that carrier (omitted: FACE_TABLE_CARRIER)', async (faceTable) => {
    // a real frame job of a face with 瘦臉, from the engine
    const src = recordingGl(GPU);
    const engine = createEngine(canvasOf(src.gl));
    await engine.ready;
    engine.render(faceFrame(), { still: true });
    const job = jobs.at(-1)!;
    engine.dispose();

    const want = faceTable ?? FACE_TABLE_CARRIER;
    const { gl, compiled, uboBinds } = recordingGl(GPU);
    const pipeline = createPipeline(gl, faceTable ? { faceTable } : {});
    expect(pipeline.faceTableCarrier()).toBeNull();
    expect(pipeline.run(job).passes).toContain('reshape');
    expect(pipeline.faceTableCarrier()).toBe(want);
    expect(compiled()).toBe(want);
    expect(uboBinds.length > 0).toBe(want === 'ubo');
  });
});
