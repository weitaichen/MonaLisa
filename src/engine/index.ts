// Public entry of the GPU engine (spec §5, RB §2): context lifecycle, static/filter LUT textures,
// tiers, and the render / capture / compare entry points. Pass logic lives in pipeline.ts.
import type { Engine, EngineOptions, RenderInput, RenderStats, Tier } from '../types';
import {
  createTexture,
  deleteTexture,
  type GL,
  loadImageTexture,
  resetGlCaches,
  type Texture,
  uploadSource,
} from './gl/gl';
import { createPipeline, type FrameJob, type Pipeline, type StaticLuts } from './pipeline';
import { processingSize, type Size, skinUniforms } from './uniforms';

const CONTEXT_ATTRS: WebGLContextAttributes = {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  premultipliedAlpha: false,
  preserveDrawingBuffer: false,
  powerPreference: 'high-performance',
};

const LUT_NAMES = ['gray', 'origin', 'skin', 'light'] as const;
const FILTER_ID = /^[a-z0-9_-]+$/;
const FILTER_LUT_SIZE = 512;

export function createEngine(canvas: HTMLCanvasElement, opts?: Partial<EngineOptions>): Engine {
  const ctx = canvas.getContext('webgl2', CONTEXT_ATTRS);
  if (!ctx) throw new Error('WebGL2 is not available');
  const gl: GL = ctx;

  const options: EngineOptions = { mirror: false, matchGpupixel: false, showLandmarks: false, ...opts };
  let tier: Tier = 'H';
  let lost = gl.isContextLost();
  let disposed = false;
  /** bumped on context loss: async uploads that finish afterwards belong to a dead context */
  let generation = 0;

  let pipeline: Pipeline | null = null;
  let srcTex: Texture | null = null;
  let maxSize = 4096;
  let luts: StaticLuts | null = null;
  const filterTex = new Map<string, Texture>();
  const filterLoads = new Map<string, Promise<void>>();
  /** filters whose implicit (frame-path) load failed; an explicit loadFilter() retries */
  const filterFailed = new Set<string>();

  /** makeup textures of the current pipeline (see Pipeline.preloadMakeup) */
  let makeupLoad: Promise<void> = Promise.resolve();

  function build(): void {
    pipeline = createPipeline(gl);
    makeupLoad = pipeline.preloadMakeup();
    srcTex = createTexture(gl, 0, 0);
    maxSize = Math.min(
      gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
      ...(gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array),
    );
  }

  async function loadStaticLuts(): Promise<void> {
    const gen = generation;
    const results = await Promise.allSettled(LUT_NAMES.map((n) => loadImageTexture(gl, `/luts/gp/lookup_${n}.png`)));
    const loaded = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    if (gen !== generation) return; // context was lost meanwhile; restore reloads
    if (disposed || loaded.length !== LUT_NAMES.length) {
      for (const t of loaded) deleteTexture(gl, t);
      const failure = results.find((r) => r.status === 'rejected');
      if (failure) throw (failure as PromiseRejectedResult).reason;
      return;
    }
    const [gray, origin, skin, light] = loaded;
    luts = { gray, origin, skin, light };
  }

  function dropGlState(): void {
    pipeline = null;
    srcTex = null;
    luts = null;
    filterTex.clear();
    filterLoads.clear();
    filterFailed.clear();
    resetGlCaches();
  }

  const onLost = (e: Event) => {
    e.preventDefault(); // required for webglcontextrestored to fire
    lost = true;
    generation++;
    pipeline?.dispose(true);
    dropGlState();
  };

  const onRestored = () => {
    if (disposed) return;
    try {
      resetGlCaches();
      build();
      lost = false;
      // A fresh `ready` for the restored context: callers that await engine.ready after a restore
      // (still.ts onRestored / prepareExport) wait for the reloaded skin LUTs and makeup textures.
      ready = Promise.all([loadStaticLuts(), makeupLoad]).then(() => undefined);
      ready.catch((err: unknown) => console.error('[engine] LUT reload after context restore failed', err));
    } catch (err) {
      console.error('[engine] rebuild after context restore failed', err);
    }
  };

  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  if (!lost) build();
  /** replaced on context restore (see onRestored); exposed through a getter */
  let ready: Promise<void> = Promise.all([loadStaticLuts(), makeupLoad]).then(() => undefined);
  // Callers await `ready`; this handler only stops a rejection nobody awaits from surfacing as unhandled.
  ready.catch(() => {});

  function loadFilter(filterId: string): Promise<void> {
    if (filterId === 'none' || filterTex.has(filterId)) return Promise.resolve();
    if (!FILTER_ID.test(filterId)) return Promise.reject(new Error(`invalid filter id ${filterId}`));
    const pending = filterLoads.get(filterId);
    if (pending) return pending;
    const gen = generation;
    const p = loadImageTexture(gl, `/luts/filters/${filterId}.png`).then(
      (t) => {
        if (gen !== generation) return;
        filterLoads.delete(filterId);
        if (disposed) {
          deleteTexture(gl, t);
          return;
        }
        if (t.width !== FILTER_LUT_SIZE || t.height !== FILTER_LUT_SIZE) {
          deleteTexture(gl, t);
          if (!lost) filterFailed.add(filterId);
          throw new Error(`filter LUT ${filterId} is ${t.width}×${t.height}, expected 512×512`);
        }
        filterFailed.delete(filterId);
        filterTex.set(filterId, t);
      },
      (err: unknown) => {
        if (gen === generation) {
          filterLoads.delete(filterId);
          // A load that failed on the lost context (createTexture returns null) is not the filter's fault:
          // leave no mark, so the restored context's first frame retries it implicitly.
          if (!lost) filterFailed.add(filterId);
        }
        throw err;
      },
    );
    filterLoads.set(filterId, p);
    return p;
  }

  /** LUT for the frame, or null (filter skipped) while it is still loading. */
  function filterFor(filterId: string): Texture | null {
    if (filterId === 'none') return null;
    const t = filterTex.get(filterId);
    if (t) return t;
    if (!filterLoads.has(filterId) && !filterFailed.has(filterId)) {
      loadFilter(filterId).catch((err: unknown) => console.warn(`[engine] filter ${filterId} unavailable`, err));
    }
    return null;
  }

  function sizeCanvas(size: Size): void {
    if (canvas.width !== size.width) canvas.width = size.width;
    if (canvas.height !== size.height) canvas.height = size.height;
  }

  function job(input: RenderInput, src: Texture, size: Size, halfMean: boolean, target: FrameJob['target'], mirror: boolean): FrameJob {
    const filterLut = filterFor(input.params.filterId);
    return {
      src,
      size,
      halfMean,
      face: input.face,
      faceWeight: Math.min(1, Math.max(0, input.faceWeight)),
      // preview and export share this path, so the 美體 field is applied identically to both
      body: input.body ?? null,
      // photo editor only (the live loop passes none): the same object for preview and export
      faceProtect: input.faceProtect ?? null,
      params: input.params,
      skin: skinUniforms(input.params, filterLut !== null),
      luts,
      filterLut,
      matchGpupixel: options.matchGpupixel,
      target,
      mirror,
    };
  }

  const emptyStats = (t0: number): RenderStats => ({ cpuMs: performance.now() - t0, width: 0, height: 0, passes: [] });

  return {
    canvas,
    get ready() {
      return ready;
    },
    get tier() {
      return tier;
    },
    get lost() {
      return lost;
    },

    setTier(t) {
      tier = t;
    },

    setOptions(o) {
      Object.assign(options, o);
    },

    loadFilter,

    render(input, opts) {
      const t0 = performance.now();
      if (lost || disposed || !pipeline || !srcTex || input.width <= 0 || input.height <= 0) return emptyStats(t0);
      const still = opts?.still === true;
      const size = processingSize(input.width, input.height, tier, still, maxSize);
      uploadSource(gl, srcTex, input.source, input.width, input.height);
      sizeCanvas(size);
      const res = pipeline.run(job(input, srcTex, size, !still && tier === 'L', 'canvas', options.mirror));
      if (options.showLandmarks && input.face) {
        pipeline.drawOverlay(input.face, options.mirror);
        res.passes.push('overlay');
      }
      return { cpuMs: performance.now() - t0, width: size.width, height: size.height, passes: res.passes };
    },

    renderToImageData(input, opts) {
      if (lost || disposed || !pipeline || !srcTex) throw new Error('renderToImageData: WebGL context unavailable');
      if (input.width <= 0 || input.height <= 0) throw new Error('renderToImageData: empty source');
      const size = processingSize(input.width, input.height, tier, true, maxSize);
      uploadSource(gl, srcTex, input.source, input.width, input.height);
      const res = pipeline.run(job(input, srcTex, size, false, 'fbo', opts.mirror));
      const out = res.output;
      if (!out) throw new Error('renderToImageData: no output buffer');
      const pixels = new Uint8Array(size.width * size.height * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
      gl.readPixels(0, 0, size.width, size.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      // Restore the display target so the next present / overlay draws to the canvas.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      return new ImageData(new Uint8ClampedArray(pixels.buffer), size.width, size.height);
    },

    renderOriginal(input, opts) {
      if (lost || disposed || !pipeline || !srcTex || input.width <= 0 || input.height <= 0) return;
      const size = processingSize(input.width, input.height, tier, opts?.still === true, maxSize);
      uploadSource(gl, srcTex, input.source, input.width, input.height);
      sizeCanvas(size);
      pipeline.drawSource(srcTex, options.mirror);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      const live = !gl.isContextLost();
      pipeline?.dispose(!live);
      if (live) {
        deleteTexture(gl, srcTex);
        if (luts) for (const t of Object.values(luts)) deleteTexture(gl, t);
        for (const t of filterTex.values()) deleteTexture(gl, t);
      }
      dropGlState();
    },
  };
}

let webgl2Supported: boolean | undefined;

/** true when WebGL2 is available on this device */
export function isWebGL2Supported(): boolean {
  if (webgl2Supported !== undefined) return webgl2Supported;
  try {
    if (typeof document === 'undefined' || typeof WebGL2RenderingContext === 'undefined') {
      webgl2Supported = false;
    } else {
      const probe = document.createElement('canvas').getContext('webgl2');
      webgl2Supported = probe !== null;
      // Free the probe context right away; iOS caps the number of live WebGL contexts.
      probe?.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    webgl2Supported = false;
  }
  return webgl2Supported;
}
