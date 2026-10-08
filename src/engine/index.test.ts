// createEngine context-loss bookkeeping of filter LUT loads, with the GL layer and the pipeline faked.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadImageTexture } from './gl/gl';
import { createEngine } from './index';
import { defaultParams } from './params';
import { createPipeline, type FrameJob } from './pipeline';
import type { BodyField } from '../types';

vi.mock('./gl/gl', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./gl/gl')>()),
  createTexture: vi.fn(() => ({ tex: {}, width: 0, height: 0 })),
  deleteTexture: vi.fn(),
  loadImageTexture: vi.fn(),
  resetGlCaches: vi.fn(),
  uploadSource: vi.fn(),
}));

vi.mock('./pipeline', () => ({
  createPipeline: vi.fn(() => ({
    preloadMakeup: async () => undefined,
    run: vi.fn(() => ({ passes: [], output: null })),
    drawOverlay: vi.fn(),
    drawSource: vi.fn(),
    dispose: vi.fn(),
  })),
}));

const loadTex = vi.mocked(loadImageTexture);

function fakeCanvas() {
  const listeners = new Map<string, ((e: Event) => void)[]>();
  const gl = {
    MAX_TEXTURE_SIZE: 1,
    MAX_RENDERBUFFER_SIZE: 2,
    MAX_VIEWPORT_DIMS: 3,
    isContextLost: () => false,
    getParameter: (p: number) => (p === 3 ? new Int32Array([4096, 4096]) : 4096),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => gl,
    addEventListener: (t: string, fn: (e: Event) => void) => listeners.set(t, [...(listeners.get(t) ?? []), fn]),
    removeEventListener: () => {},
  };
  const fire = (t: string) => {
    for (const fn of listeners.get(t) ?? []) fn({ preventDefault() {} } as Event);
  };
  return { canvas: canvas as unknown as HTMLCanvasElement, fire };
}

const filterUrl = (id: string) => `/luts/filters/${id}.png`;
const filterCalls = (id: string) => loadTex.mock.calls.filter((c) => c[1] === filterUrl(id)).length;

beforeEach(() => {
  loadTex.mockReset();
  loadTex.mockImplementation(async (_gl, url) => ({ tex: {}, width: url.includes('/filters/') ? 512 : 64, height: url.includes('/filters/') ? 512 : 64 }) as never);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('createEngine: filter loads across a context loss', () => {
  it('a filter load that failed while the context was lost is retried by the first frame after restore', async () => {
    const { canvas, fire } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    fire('webglcontextlost');
    expect(engine.lost).toBe(true);
    // on a lost context gl.createTexture() returns null, so the upload throws
    loadTex.mockImplementationOnce(async () => {
      throw new Error('createTexture failed');
    });
    await expect(engine.loadFilter('x')).rejects.toThrow('createTexture failed');
    fire('webglcontextrestored');
    expect(engine.lost).toBe(false);
    await engine.ready;
    const before = filterCalls('x');
    const params = { ...defaultParams(), filterId: 'x' };
    engine.render({ source: {} as TexImageSource, width: 640, height: 480, face: null, faceWeight: 0, params });
    expect(filterCalls('x')).toBe(before + 1);
  });

  it('a filter load that fails on a live context is not retried implicitly', async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    loadTex.mockImplementationOnce(async () => {
      throw new Error('HTTP 404');
    });
    await expect(engine.loadFilter('y')).rejects.toThrow('HTTP 404');
    const params = { ...defaultParams(), filterId: 'y' };
    engine.render({ source: {} as TexImageSource, width: 640, height: 480, face: null, faceWeight: 0, params });
    expect(filterCalls('y')).toBe(1);
  });
});

describe('createEngine: 美體 field', () => {
  const lastJob = (): FrameJob => {
    const pipe = vi.mocked(createPipeline).mock.results.at(-1)!.value as { run: { mock: { calls: [FrameJob][] } } };
    return pipe.run.mock.calls.at(-1)![0];
  };
  const body: BodyField = { width: 4, height: 3, data: new Float32Array(24), version: 7 };
  const input = (b?: BodyField | null) => ({
    source: {} as TexImageSource,
    width: 640,
    height: 480,
    face: null,
    faceWeight: 0,
    params: defaultParams(),
    ...(b === undefined ? {} : { body: b }),
  });

  it('passes RenderInput.body to the frame job of render and of renderToImageData (preview = export)', async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    engine.render(input(body), { still: true });
    expect(lastJob().body).toBe(body);
    expect(() => engine.renderToImageData(input(body), { mirror: false })).toThrow('no output buffer');
    expect(lastJob().body).toBe(body);
    expect(lastJob().target).toBe('fbo');
  });

  it('absent or null body → null in the job', async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    engine.render(input());
    expect(lastJob().body).toBeNull();
    engine.render(input(null));
    expect(lastJob().body).toBeNull();
  });
});
