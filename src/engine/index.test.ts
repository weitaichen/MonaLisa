// createEngine context-loss bookkeeping of filter LUT loads, with the GL layer and the pipeline faked.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { FACE_TABLE_CARRIER } from '../config/limits';
import { legacyFrame } from '../edit/frame';
import { defaultPhoto, neutralPerson } from '../edit/state';
import { flipView, glMat3, IDENTITY_GEOMETRY, IDENTITY_MAT3, oToV, rotateLeft, vToO } from '../geometry/view';
import { adjustUniforms, seedMix } from './adjustMath';
import { loadImageTexture } from './gl/gl';
import { createEngine, MAX_RESIDENT_LUTS } from './index';
import { defaultParams } from './params';
import { createPipeline, type FrameJob } from './pipeline';
import { buildMakeupGeometry } from './passes/makeupProc';
import { adapt } from '../tracking/adapter111';
import type { BodyField, PersonParamId, PhotoParams, RenderInput } from '../types';

vi.mock('./gl/gl', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./gl/gl')>()),
  createTexture: vi.fn(() => ({ tex: {}, width: 0, height: 0 })),
  deleteTexture: vi.fn(),
  loadImageTexture: vi.fn(),
  resetGlCaches: vi.fn(),
  shrinkTexture: vi.fn(),
  uploadSource: vi.fn(),
}));

// counted, not replaced: the 調節 memo tests check how often the engine builds the uniforms
vi.mock('./adjustMath', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./adjustMath')>();
  return { ...actual, adjustUniforms: vi.fn(actual.adjustUniforms) };
});
// counted, not replaced: the procedural makeup tests check how often a frame builds the geometry
vi.mock('./passes/makeupProc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./passes/makeupProc')>();
  return { ...actual, buildMakeupGeometry: vi.fn(actual.buildMakeupGeometry) };
});

// the dev-build probes draw on the context: stubbed (the GL limits read the fake context)
vi.mock('./glProbe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./glProbe')>()),
  probeFaceTable: vi.fn(() => ({ texture: true, ubo: true, float32: null })),
  probeR16FArray: vi.fn(() => true),
}));

vi.mock('./pipeline', () => ({
  createPipeline: vi.fn(() => ({
    preloadMakeup: async () => undefined,
    run: vi.fn(() => ({ passes: [], output: null })),
    drawOverlay: vi.fn(),
    procMakeupFailed: vi.fn(() => false),
    faceTableCarrier: vi.fn((): 'texture' | 'ubo' | null => null),
    drawSource: vi.fn(),
    releaseBuffers: vi.fn(),
    releaseFields: vi.fn(),
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
    isContextLost: vi.fn(() => false),
    getParameter: (p: number) => (p === 3 ? new Int32Array([4096, 4096]) : 4096),
    readPixels: vi.fn(),
    bindFramebuffer: vi.fn(),
    viewport: vi.fn(),
    drawingBufferWidth: 1,
    drawingBufferHeight: 1,
    FRAMEBUFFER: 1,
    RGBA: 2,
    UNSIGNED_BYTE: 3,
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
  return { canvas: canvas as unknown as HTMLCanvasElement, fire, gl };
}

const filterUrl = (id: string) => `/luts/filters/${id}.png`;
const filterCalls = (id: string) => loadTex.mock.calls.filter((c) => c[1] === filterUrl(id)).length;

beforeEach(() => {
  loadTex.mockReset();
  loadTex.mockImplementation(async (_gl, url) => {
    const lut = /\/(filters|looks)\//.test(url);
    return { tex: {}, width: lut ? 512 : 64, height: lut ? 512 : 64 } as never;
  });
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
    engine.render({ source: {} as TexImageSource, width: 640, height: 480, ...legacyFrame(params, null, 0) });
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
    engine.render({ source: {} as TexImageSource, width: 640, height: 480, ...legacyFrame(params, null, 0) });
    expect(filterCalls('y')).toBe(1);
  });
});

describe('createEngine: window.__meiyan.gl.FACE_TABLE_UBO (S §6.4)', () => {
  it('is the carrier the pipeline’s reshape pass was built with, once a frame built it, not the renderer selector’s pick', async () => {
    vi.stubGlobal('window', {});
    try {
      const { canvas, gl } = fakeCanvas();
      // no debug-renderer extension and no renderer string: the selector picks FACE_TABLE_CARRIER (the UBO)
      Object.assign(gl, { getExtension: () => null });
      const engine = createEngine(canvas);
      await engine.ready;
      expect(FACE_TABLE_CARRIER).toBe('ubo');
      expect(vi.mocked(createPipeline)).toHaveBeenLastCalledWith(gl, { faceTable: 'ubo' });
      const pipe = vi.mocked(createPipeline).mock.results.at(-1)!.value as { faceTableCarrier: Mock<() => 'texture' | 'ubo' | null> };
      const info = () => (window as Window).__meiyan?.gl;
      expect(info()?.MAX_TEXTURE_SIZE).toBe(4096);
      const frame = { source: {} as TexImageSource, width: 640, height: 480, ...legacyFrame(defaultParams(), null, 0) };
      // no frame has built the reshape pass yet: nothing to report
      engine.render(frame);
      expect(info()?.FACE_TABLE_UBO).toBeUndefined();
      // what the pipeline built is what the flag says, here the texture whatever the selector picked (a wiring that
      // dropped the pick would show on the device)
      pipe.faceTableCarrier.mockReturnValue('texture');
      engine.render(frame);
      expect(info()?.FACE_TABLE_UBO).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
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
    ...legacyFrame(defaultParams(), null, 0),
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

describe('createEngine: 推臉筆 field', () => {
  // the 美體 block's two helpers (local to it)
  const lastJob = (): FrameJob => {
    const pipe = vi.mocked(createPipeline).mock.results.at(-1)!.value as { run: { mock: { calls: [FrameJob][] } } };
    return pipe.run.mock.calls.at(-1)![0];
  };
  const input = () => ({ source: {} as TexImageSource, width: 640, height: 480, ...legacyFrame(defaultParams(), null, 0) });
  const liquify = { width: 384, height: 512, data: new Float32Array(384 * 512 * 2), version: 3 };

  it('passes RenderInput.liquify to the job of render and of renderToImageData (preview = export)', async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    engine.render({ ...input(), liquify }, { still: true });
    expect(lastJob().liquify).toBe(liquify);
    expect(() => engine.renderToImageData({ ...input(), liquify }, { mirror: false })).toThrow('no output buffer');
    expect(lastJob().liquify).toBe(liquify);
    engine.render(input());
    expect(lastJob().liquify).toBeNull();
  });

  it('the field reaches the job again after a context restore (a fresh pipeline uploads it, push-brush spec §7)', async () => {
    const { canvas, fire } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    engine.render({ ...input(), liquify }, { still: true });
    const pipelinesBefore = vi.mocked(createPipeline).mock.results.length;
    fire('webglcontextlost');
    fire('webglcontextrestored');
    await engine.ready;
    expect(vi.mocked(createPipeline).mock.results.length).toBeGreaterThan(pipelinesBefore); // a new pipeline: no upload key
    engine.render({ ...input(), liquify }, { still: true });
    expect(lastJob().liquify).toBe(liquify);
  });
});

describe('createEngine: the frame job’s 調節 (step-2 spec §4.1)', () => {
  const lastJob = (): FrameJob => {
    const pipe = vi.mocked(createPipeline).mock.results.at(-1)!.value as { run: { mock: { calls: [FrameJob][] } } };
    return pipe.run.mock.calls.at(-1)![0];
  };

  it('a neutral photo keeps the 調節 program off; a user 調節 value turns it on, with no 質感 LUT bound', async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    const frame = legacyFrame(defaultParams(), null, 0);
    engine.render({ source: {} as TexImageSource, width: 640, height: 480, ...frame });
    expect(lastJob().adjust.on).toBe(false);
    expect(lastJob().lookLut).toBeNull();
    const photo = { ...frame.photo, values: { ...frame.photo.values, 'adjust.contrast': 0.8 } };
    engine.render({ source: {} as TexImageSource, width: 640, height: 480, ...frame, photo });
    expect(lastJob().adjust).toMatchObject({ on: true, adjustOn: true, curveOn: true, lookAmt: 0 });
    expect(lastJob().lookLut).toBeNull();
  });
});

const lookUrl = (id: string) => `/luts/looks/look_${id}.png`;
const calls = (url: string) => loadTex.mock.calls.filter((c) => c[1] === url).length;
const photoInput = (photo: Partial<PhotoParams> = {}, extra: Partial<RenderInput> = {}): RenderInput => ({
  source: {} as TexImageSource,
  width: 640,
  height: 480,
  faces: [],
  globalSkin: null,
  photo: { ...defaultPhoto(), ...photo },
  ...extra,
});
const latestJob = (): FrameJob => {
  const pipe = vi.mocked(createPipeline).mock.results.at(-1)!.value as { run: { mock: { calls: [FrameJob][] } } };
  return pipe.run.mock.calls.at(-1)![0];
};
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('createEngine: 濾鏡 and 質感 LUT cache (step-2 spec §3.5)', () => {
  it('kinds have their own paths; filter "film" and look "film" are separate textures', async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    await engine.loadLut('filter', 'film');
    expect(engine.lutState('filter', 'film')).toBe('ready');
    expect(engine.lutState('look', 'film')).toBe('none');
    await engine.loadLut('look', 'film');
    expect(calls(filterUrl('film'))).toBe(1);
    expect(calls(lookUrl('film'))).toBe(1);
    expect(engine.lutState('look', 'film')).toBe('ready');
    await engine.loadFilter('warm');
    expect(engine.lutState('filter', 'warm')).toBe('ready');
    expect(engine.lutState('filter', 'none')).toBe('ready');
  });

  it('lutState: loading → ready; a failed LUT stays failed (no implicit retry) until an explicit loadLut', async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    loadTex.mockImplementationOnce(async () => {
      throw new Error('HTTP 404');
    });
    const p = engine.loadLut('look', 'ccd');
    expect(engine.lutState('look', 'ccd')).toBe('loading');
    await expect(p).rejects.toThrow('HTTP 404');
    expect(engine.lutState('look', 'ccd')).toBe('failed');
    engine.render(photoInput({ look: { id: 'ccd', amount: 0.8 } }));
    expect(calls(lookUrl('ccd'))).toBe(1);
    await engine.loadLut('look', 'ccd');
    expect(engine.lutState('look', 'ccd')).toBe('ready');
    expect(calls(lookUrl('ccd'))).toBe(2);
  });

  it('the same LUT asked again while loading is fetched once (pick → 無 → pick, hook + frame path)', async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    let done!: (t: unknown) => void;
    loadTex.mockImplementationOnce(() => new Promise((r) => (done = r)) as never);
    const a = engine.loadLut('look', 'blue');
    const b = engine.loadLut('look', 'blue');
    engine.render(photoInput({ look: { id: 'blue', amount: 0.8 } }));
    expect(a).toBe(b);
    expect(calls(lookUrl('blue'))).toBe(1);
    done({ tex: {}, width: 512, height: 512 });
    await a;
    expect(engine.lutState('look', 'blue')).toBe('ready');
    expect(calls(lookUrl('blue'))).toBe(1);
  });

  it(`keeps at most ${MAX_RESIDENT_LUTS} LUTs resident: the least recently used goes, never one the latest frame drew with`, async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    await engine.loadLut('filter', 'a');
    engine.render(photoInput({ filterId: 'a' })); // the latest frame draws with filter a
    for (const id of ['b', 'c', 'd', 'e', 'f', 'g']) await engine.loadLut('filter', id);
    expect(engine.lutState('filter', 'a')).toBe('ready');
    expect(engine.lutState('filter', 'b')).toBe('none');
    for (const id of ['c', 'd', 'e', 'f', 'g']) expect(engine.lutState('filter', id)).toBe('ready');
  });

  it('a context loss drops the cache; after the restore the next frame reloads the look by itself', async () => {
    const { canvas, fire } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    await engine.loadLut('look', 'film');
    fire('webglcontextlost');
    expect(engine.lutState('look', 'film')).toBe('none');
    fire('webglcontextrestored');
    await engine.ready;
    const before = calls(lookUrl('film'));
    engine.render(photoInput({ look: { id: 'film', amount: 0.8 } }));
    expect(calls(lookUrl('film'))).toBe(before + 1);
  });

  it('a look draws only once its LUT is resident (all-or-nothing: no LUT and no offsets before)', async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    let done!: (t: unknown) => void;
    loadTex.mockImplementationOnce(() => new Promise((r) => (done = r)) as never);
    const input = photoInput({ look: { id: 'cinema', amount: 0.8 } });
    engine.render(input);
    expect(latestJob().lookLut).toBeNull();
    expect(latestJob().adjust).toMatchObject({ on: false, lookAmt: 0 });
    done({ tex: {}, width: 512, height: 512 });
    await flush();
    engine.render(input);
    expect(latestJob().lookLut).not.toBeNull();
    expect(latestJob().adjust).toMatchObject({ on: true, adjustOn: true, lookAmt: 0.8 });
  });

  it('user 調節 values, pictureFrame and grainSeed reach the frame uniforms; neutral photos stay off', async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    engine.render(photoInput());
    expect(latestJob().adjust.on).toBe(false);
    const p = defaultPhoto();
    engine.render(
      photoInput({ values: { ...p.values, 'adjust.vignette': 1 } }, { pictureFrame: { x: 0.25, y: 0, w: 0.5, h: 1 }, grainSeed: 7 }),
    );
    expect(latestJob().adjust.on).toBe(true);
    expect(latestJob().adjust.vMap).toEqual([2, 1, -0.5, 0]);
    expect(latestJob().adjust.seedMix).toBe(seedMix(7));
  });

  it('adjustUnavailable mirrors the pipeline', async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    expect(engine.adjustUnavailable).toBe(false);
    (vi.mocked(createPipeline).mock.results.at(-1)!.value as { adjustFailed?: boolean }).adjustFailed = true;
    expect(engine.adjustUnavailable).toBe(true);
  });

  it('neutral camera frames build no 調節 uniforms, whatever the grain seed (the v0.3 live path)', async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    const built = vi.mocked(adjustUniforms).mock.calls.length;
    for (let seed = 0; seed < 5; seed++) engine.render(photoInput({}, { grainSeed: seed }));
    expect(latestJob().adjust.on).toBe(false);
    expect(vi.mocked(adjustUniforms).mock.calls.length).toBe(built);
    // a look whose LUT is not resident draws nothing either (all-or-nothing): still no build
    loadTex.mockImplementationOnce(() => new Promise(() => {}) as never);
    engine.render(photoInput({ look: { id: 'cinema', amount: 0.8 } }, { grainSeed: 9 }));
    expect(latestJob().adjust.on).toBe(false);
    expect(vi.mocked(adjustUniforms).mock.calls.length).toBe(built);
  });

  it('the memo leaves the grain seed out: a new seed only changes seedMix', async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    const p = defaultPhoto();
    const photo = { values: { ...p.values, 'adjust.contrast': 0.8, 'adjust.grain': 0.5 } };
    const built = vi.mocked(adjustUniforms).mock.calls.length;
    engine.render(photoInput(photo, { grainSeed: 1 }));
    const first = latestJob().adjust;
    for (let seed = 2; seed < 6; seed++) {
      engine.render(photoInput(photo, { grainSeed: seed }));
      const u = latestJob().adjust;
      expect(u.seedMix).toBe(seedMix(seed));
      expect({ ...u, seedMix: 0 }).toEqual({ ...first, seedMix: 0 });
    }
    expect(vi.mocked(adjustUniforms).mock.calls.length).toBe(built + 1);
    // the frame the camera uniforms were built for is untouched by later seeds
    expect(first.seedMix).toBe(seedMix(1));
    // any other input still rebuilds
    engine.render(photoInput({ values: { ...photo.values, 'adjust.contrast': 0.7 } }, { grainSeed: 6 }));
    expect(vi.mocked(adjustUniforms).mock.calls.length).toBe(built + 2);
    expect(latestJob().adjust.seedMix).toBe(seedMix(6));
  });
});

describe('createEngine: geometry, windows and tiles (step 3)', () => {
  const pipe = () => vi.mocked(createPipeline).mock.results.at(-1)!.value as {
    run: ReturnType<typeof vi.fn>;
    releaseBuffers: ReturnType<typeof vi.fn>;
    releaseFields: ReturnType<typeof vi.fn>;
    drawSource: ReturnType<typeof vi.fn>;
  };
  const job = (): FrameJob => pipe().run.mock.calls.at(-1)![0] as FrameJob;
  const input = (over: Partial<RenderInput> = {}): RenderInput => ({
    source: {} as TexImageSource,
    width: 640,
    height: 480,
    faces: [],
    globalSkin: null,
    photo: defaultPhoto(),
    ...over,
  });

  it('identity: the source size, the identity mat3, fullShortEdge = min(size), no window', async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    engine.render(input(), { still: true });
    const j = job();
    expect(j.size).toEqual({ width: 640, height: 480 });
    expect(j.srcSize).toEqual({ width: 640, height: 480 });
    expect(j.geoIdentity).toBe(true);
    expect(j.windowed).toBe(false);
    expect(j.geo).toBe(IDENTITY_MAT3);
    expect(j.fullShortEdge).toBe(480);
    expect(j.oAspect).toBe(640 / 480);
  });

  it('a quarter turn renders V (sides swapped) from the O source; the canvas takes the V size', async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    const g = rotateLeft(IDENTITY_GEOMETRY);
    engine.render(input({ geometry: g }), { still: true });
    const j = job();
    expect(j.size).toEqual({ width: 480, height: 640 });
    expect(canvas.width).toBe(480);
    expect(j.srcSize).toEqual({ width: 640, height: 480 });
    expect(j.geoIdentity).toBe(false);
    expect(Array.from(j.geo)).toEqual(Array.from(glMat3(vToO(g, { width: 640 / 480, height: 1 }))));
    expect(j.fullShortEdge).toBe(480);
  });

  it('renderTile renders the output tile from the window and reads back only `read`', async () => {
    vi.stubGlobal('ImageData', class {
      constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {}
    });
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    pipe().run.mockReturnValueOnce({ passes: [], output: { fbo: {} } });
    const img = engine.renderTile(
      input({
        width: 1200,
        height: 1100,
        sourceWindow: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
        output: { tile: { x: 0.25, y: 0, w: 0.25, h: 0.5 }, pixelSize: { width: 1088, height: 1152 }, fullShortEdge: 3072 },
        oAspect: 4 / 3,
      }),
      { x: 64, y: 0, w: 1024, h: 1088 },
    );
    const j = job();
    expect(j.target).toBe('fbo');
    expect(j.size).toEqual({ width: 1088, height: 1152 });
    expect(j.srcSize).toEqual({ width: 1200, height: 1100 });
    expect(j.win).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(j.tile).toEqual([0.25, 0, 0.25, 0.5]);
    expect(j.windowed).toBe(true);
    expect(j.oAspect).toBe(4 / 3);
    expect(j.fullShortEdge).toBe(3072);
    expect([img.width, img.height]).toEqual([1024, 1088]);
    vi.unstubAllGlobals();
  });

  // C §7: a loss inside the tile's GL calls leaves the read-back buffer zeroed (WebGL calls on a lost context do
  // nothing), and the lost event is only queued: the last tile would otherwise reach the file as a black rectangle
  it.each(['renderTile', 'renderToImageData'] as const)('%s throws when the context is lost by its read-back, and marks the engine lost', async (call) => {
    vi.stubGlobal('ImageData', class {
      constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {}
    });
    const { canvas, gl } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    pipe().run.mockReturnValueOnce({ passes: [], output: { fbo: {} } });
    gl.readPixels.mockImplementationOnce(() => gl.isContextLost.mockReturnValue(true));
    const tile = input({ output: { tile: { x: 0, y: 0, w: 1, h: 1 }, pixelSize: { width: 64, height: 48 }, fullShortEdge: 48 } });
    const run = () => (call === 'renderTile' ? engine.renderTile(tile, { x: 0, y: 0, w: 64, h: 48 }) : engine.renderToImageData(input(), { mirror: false }));
    expect(run).toThrow('WebGL context lost');
    // (before the queued webglcontextlost event): the next call and the export runner see it at once
    expect(engine.lost).toBe(true);
    expect(run).toThrow('WebGL context unavailable');
    vi.unstubAllGlobals();
  });

  it('releaseBuffers shrinks the pipeline buffers and the source texture', async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    engine.releaseBuffers();
    expect(pipe().releaseBuffers).toHaveBeenCalledTimes(1);
  });

  it('releaseFields drops the pipeline’s field textures; a no-op once disposed', async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    engine.releaseFields();
    expect(pipe().releaseFields).toHaveBeenCalledTimes(1);
    engine.dispose();
    engine.releaseFields();
    expect(pipe().releaseFields).toHaveBeenCalledTimes(1);
  });

  it('renderOriginal draws through the geometry (按住對比 keeps the crop)', async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    const g = rotateLeft(IDENTITY_GEOMETRY);
    engine.renderOriginal({ source: {} as TexImageSource, width: 640, height: 480, geometry: g }, { still: true });
    expect(canvas.width).toBe(480);
    expect(Array.from(pipe().drawSource.mock.calls.at(-1)![2] as Float32Array)).toEqual(Array.from(glMat3(vToO(g, { width: 640, height: 480 }))));
  });

  it('the 顯示臉部特徵點 overlay maps its O points through the view (O → V); the identity at identity geometry and in the camera', async () => {
    const lm = JSON.parse(readFileSync(new URL('../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as { width: number; height: number; points: number[] };
    const face = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas, { showLandmarks: true });
    await engine.ready;
    const overlay = () => (pipe() as unknown as { drawOverlay: ReturnType<typeof vi.fn> }).drawOverlay.mock.calls.at(-1)!;
    const faces = [{ face, weight: 1, person: neutralPerson(), protect: null }];
    // a crop after a quarter turn and a flip: the canvas shows V, so must the points
    const g = { ...flipView(rotateLeft(IDENTITY_GEOMETRY)), crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 } };
    engine.render(input({ faces, geometry: g }), { still: true });
    expect(overlay()[0]).toBe(face);
    expect(overlay()[2]).toBe(640 / 480);
    expect(Array.from(overlay()[3] as Float32Array)).toEqual(Array.from(glMat3(oToV(g, { width: 640 / 480, height: 1 }))));
    engine.render(input({ faces, geometry: IDENTITY_GEOMETRY }), { still: true });
    expect(overlay()[3]).toBe(IDENTITY_MAT3);
    // the camera: no geometry, mirrored by the present pass and the overlay's own uMirror
    engine.setOptions({ mirror: true });
    engine.render(input({ faces }));
    expect(overlay()[1]).toBe(true);
    expect(overlay()[3]).toBe(IDENTITY_MAT3);
  });
});

describe('createEngine: procedural makeup in the frame job (face-detail spec §4.6)', () => {
  const lm = JSON.parse(readFileSync(new URL('../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
    width: number;
    height: number;
    points: number[];
  };
  const face = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
  const input = (values: Partial<Record<PersonParamId, number>> = {}, weight = 1): RenderInput => {
    const p = neutralPerson();
    return {
      source: {} as TexImageSource,
      width: lm.width,
      height: lm.height,
      faces: [{ face, weight, person: { ...p, values: { ...p.values, ...values } }, protect: null }],
      globalSkin: null,
      photo: defaultPhoto(),
    };
  };

  it('every procedural item neutral, or the face at weight 0: no geometry, so the frame is step 4’s', async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    engine.render(input({ 'makeup.lip': 0.8 }), { still: true });
    expect(latestJob().procMakeup).toBeNull();
    engine.render(input({ 'makeup.brow': 0.6 }, 0), { still: true });
    expect(latestJob().procMakeup).toBeNull();
  });

  it('a procedural item builds the geometry of the listed faces, only for its own layer', async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    engine.render(input({ 'makeup.brow': 0.6 }), { still: true });
    const g = latestJob().procMakeup;
    expect(g).not.toBeNull();
    expect(g!.ranges.brow[1]).toBeGreaterThan(0);
    expect(g!.ranges.lens[1]).toBe(0);
  });

  it('procMakeupFailed mirrors the pipeline', async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    expect(engine.procMakeupFailed).toBe(false);
    (vi.mocked(createPipeline).mock.results.at(-1)!.value as { procMakeupFailed: () => boolean }).procMakeupFailed = () => true;
    expect(engine.procMakeupFailed).toBe(true);
  });

  it('after PMAKEUP failed to compile, no frame builds procedural geometry (nothing could draw it)', async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    (vi.mocked(createPipeline).mock.results.at(-1)!.value as { procMakeupFailed: () => boolean }).procMakeupFailed = () => true;
    const before = vi.mocked(buildMakeupGeometry).mock.calls.length;
    for (let i = 0; i < 3; i++) engine.render(input({ 'makeup.brow': 0.6 + i / 10 }), { still: true });
    expect(latestJob().procMakeup).toBeNull();
    expect(vi.mocked(buildMakeupGeometry).mock.calls.length).toBe(before);
  });

  it('the geometry is rebuilt only when a face, its weight, a procedural value or shade, or the aspect changes', async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    const builds = () => vi.mocked(buildMakeupGeometry).mock.calls.length;
    const a = input({ 'makeup.brow': 0.6 });
    const n0 = builds();
    engine.render(a, { still: true });
    const g = latestJob().procMakeup;
    // the same faces and person values in new objects (a re-render for a filter tap, a later camera frame without a
    // new detection): the same geometry
    engine.render({ ...a, faces: a.faces.map((f) => ({ ...f, person: { ...f.person, values: { ...f.person.values } } })) }, { still: true });
    engine.render({ ...a, photo: { ...a.photo, filterId: 'warm' } }, { still: true });
    expect(latestJob().procMakeup).toBe(g);
    expect(builds()).toBe(n0 + 1);
    // each input buildMakeupGeometry reads rebuilds once
    const f0 = a.faces[0];
    engine.render(input({ 'makeup.brow': 0.7 }), { still: true });
    engine.render({ ...a, faces: [{ ...f0, person: { ...f0.person, shades: { ...f0.person.shades, brow: 'black' } } }] }, { still: true });
    engine.render({ ...a, faces: [{ ...f0, weight: 0.5 }] }, { still: true });
    engine.render({ ...a, faces: [{ ...f0, face: { ...f0.face } }] }, { still: true });
    engine.render({ ...a, oAspect: 0.5 }, { still: true });
    expect(builds()).toBe(n0 + 6);
  });
});
