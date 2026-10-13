// Public entry of the GPU engine (spec §5, RB §2): context lifecycle, static/filter LUT textures,
// tiers, and the render / capture / compare entry points. Pass logic lives in pipeline.ts.
import { debugState } from '../app/debug';
import { MAX_RENDER_FACES } from '../config/limits';
import type { Engine, EngineOptions, LookDef, LutKind, LutState, RenderInput, RenderStats, Tier } from '../types';
import { ADJUST_IDS, adjustUniforms, frameFor, type AdjustFrame, type AdjustUniforms, type AdjustValues } from './adjustMath';
import {
  createTexture,
  deleteTexture,
  type GL,
  loadImageTexture,
  resetGlCaches,
  type Texture,
  uploadSource,
} from './gl/gl';
import { probeFaceTable, probeR16FArray, readGlLimits } from './glProbe';
import { lookDef } from './looks';
import { boxCentre, ovalBox } from './passes/faceCap';
import { makeupUniformsFor } from './passes/makeup';
import { reshapeUniforms, type ReshapeUniforms } from './passes/reshape';
import { createPipeline, type FrameFace, type FrameJob, type Pipeline, type StaticLuts } from './pipeline';
import { processingSize, type Size, skinMaxima, skinUniformsFor } from './uniforms';

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
const LUT_ID = /^[a-z0-9_-]+$/;
const LUT_SIZE = 512;
/** 濾鏡 + 質感 LUT textures resident at once: 6 × 1 MB (step-2 spec §3.5) */
export const MAX_RESIDENT_LUTS = 6;

export function lutUrl(kind: LutKind, id: string): string {
  return kind === 'filter' ? `/luts/filters/${id}.png` : `/luts/looks/look_${id}.png`;
}

interface LutEntry {
  state: 'loading' | 'ready' | 'failed';
  tex: Texture | null;
  /** the upload in flight while loading */
  load: Promise<void> | null;
  /** LRU clock: bumped when a frame draws with it or it is asked for again */
  used: number;
}

/** λ_f (S §4.4): every warp strength × k; k = 1 returns `u` itself, so the unguarded table is bit-identical */
function scaleUniforms(u: ReshapeUniforms, k: number): ReshapeUniforms {
  if (k === 1) return u;
  const o = { ...u };
  for (const key of Object.keys(o) as (keyof ReshapeUniforms)[]) o[key] *= Math.min(1, Math.max(0, k));
  return o;
}

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
  /** 濾鏡 and 質感 LUTs keyed `${kind}:${id}` (the filter 'film' and the look 'film' are different textures) */
  const lutCache = new Map<string, LutEntry>();
  let lutTick = 0;
  /** keys the latest frame drew with: the LRU never evicts these */
  let frameLuts = new Set<string>();
  let adjustMemo: { key: string; u: AdjustUniforms } | null = null;

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
    // Phase 0 (S §6.2): GL limits once per page, probes only in dev builds; never fatal (a fake or odd context in
    // tests, a driver that refuses a probe shader)
    const dbg = debugState();
    if (dbg && !dbg.gl) {
      try {
        const limits = readGlLimits(gl);
        console.info('[engine] GL limits', limits);
        const probes = import.meta.env.DEV ? probeFaceTable(gl) : null;
        dbg.gl = {
          ...limits,
          ...(probes ? { PG1_texture: probes.texture, PG1_ubo: probes.ubo, ...(probes.float32 === null ? {} : { PG1_float32: probes.float32 }) } : {}),
          ...(import.meta.env.DEV ? { PG2: probeR16FArray(gl) } : {}),
        };
      } catch (e) {
        console.warn('[engine] GL limits / probes unavailable', e);
      }
    }
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
    lutCache.clear();
    frameLuts = new Set();
    adjustMemo = null;
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

  const lutKey = (kind: LutKind, id: string) => `${kind}:${id}`;

  /** Over the cap: drop the least recently used resident LUTs, but none the latest frame drew with. */
  function evictLuts(): void {
    const ready = [...lutCache.entries()].filter(([, e]) => e.state === 'ready').sort((a, b) => a[1].used - b[1].used);
    let excess = ready.length - MAX_RESIDENT_LUTS;
    for (const [key, e] of ready) {
      if (excess <= 0) break;
      if (frameLuts.has(key)) continue;
      deleteTexture(gl, e.tex);
      lutCache.delete(key);
      excess--;
    }
  }

  function loadLut(kind: LutKind, id: string): Promise<void> {
    if (kind === 'filter' && id === 'none') return Promise.resolve();
    const key = lutKey(kind, id);
    if (!LUT_ID.test(id)) {
      lutCache.set(key, { state: 'failed', tex: null, load: null, used: ++lutTick });
      return Promise.reject(new Error(`invalid ${kind} LUT id ${id}`));
    }
    const cur = lutCache.get(key);
    if (cur?.state === 'ready') {
      cur.used = ++lutTick;
      return Promise.resolve();
    }
    if (cur?.state === 'loading' && cur.load) return cur.load;
    const gen = generation;
    const entry: LutEntry = { state: 'loading', tex: null, load: null, used: ++lutTick };
    lutCache.set(key, entry);
    const p = loadImageTexture(gl, lutUrl(kind, id)).then(
      (t) => {
        if (gen !== generation) return; // uploaded to a dead context: the restored one reloads on demand
        if (lutCache.get(key) !== entry || disposed) {
          deleteTexture(gl, t);
          return;
        }
        entry.load = null;
        if (t.width !== LUT_SIZE || t.height !== LUT_SIZE) {
          deleteTexture(gl, t);
          if (lost) lutCache.delete(key);
          else entry.state = 'failed';
          throw new Error(`${kind} LUT ${id} is ${t.width}×${t.height}, expected 512×512`);
        }
        entry.tex = t;
        entry.state = 'ready';
        entry.used = ++lutTick;
        evictLuts();
      },
      (err: unknown) => {
        if (gen === generation && lutCache.get(key) === entry) {
          entry.load = null;
          // a load that failed on the lost context is not the LUT's fault: no mark, the restored context's first
          // frame asks again implicitly
          if (lost) lutCache.delete(key);
          else entry.state = 'failed';
        }
        throw err;
      },
    );
    entry.load = p;
    return p;
  }

  /** The LUT for this frame, or null (not drawn) while it loads; touches the LRU and pins it for this frame. */
  function lutFor(kind: LutKind, id: string): Texture | null {
    if (kind === 'filter' && id === 'none') return null;
    const key = lutKey(kind, id);
    frameLuts.add(key);
    const e = lutCache.get(key);
    if (e?.state === 'ready' && e.tex) {
      e.used = ++lutTick;
      return e.tex;
    }
    if (!e) loadLut(kind, id).catch((err: unknown) => console.warn(`[engine] ${kind} LUT ${id} unavailable`, err));
    return null;
  }

  /** adjustUniforms, memoized on its inputs (a drag rebuilds 9 knots; an unchanged frame rebuilds nothing) */
  function adjustFor(values: AdjustValues, look: { def: LookDef; amount: number } | null, ready: boolean, frame: AdjustFrame): AdjustUniforms {
    const key = JSON.stringify([ADJUST_IDS.map((id) => values[id]), look?.def.id ?? null, look?.amount ?? null, ready, frame]);
    if (adjustMemo?.key === key) return adjustMemo.u;
    const u = adjustUniforms(values, look, ready, frame);
    adjustMemo = { key, u };
    return u;
  }

  function sizeCanvas(size: Size): void {
    if (canvas.width !== size.width) canvas.width = size.width;
    if (canvas.height !== size.height) canvas.height = size.height;
  }

  function job(input: RenderInput, src: Texture, size: Size, halfMean: boolean, target: FrameJob['target'], mirror: boolean): FrameJob {
    frameLuts = new Set();
    const filterLut = lutFor('filter', input.photo.filterId);
    const listed = input.faces.slice(0, MAX_RENDER_FACES);
    const m = skinMaxima(
      listed.map((f) => ({ weight: f.weight, smooth: f.person.values['skin.smooth'], rosy: f.person.values['skin.rosy'] })),
      input.globalSkin,
    );
    const faces: FrameFace[] = listed.map((f, i) => {
      const w = Math.min(1, Math.max(0, Number.isFinite(f.weight) ? f.weight : 0));
      return {
        face: f.face,
        weight: w,
        reshape: scaleUniforms(reshapeUniforms(f.person.values, w), f.warpScale ?? 1),
        makeup: makeupUniformsFor(f.person, w),
        kS: m.k[i][0],
        kR: m.k[i][1],
        // photo editor only (the live loop passes none): the same object for preview and export
        protect: f.protect,
        centre: boxCentre(ovalBox(f.face)),
        presence: f.presence ?? 1,
      };
    });
    const look = input.photo.look;
    const def = look ? lookDef(look.id) : null;
    const lookRef = look && def ? { def, amount: look.amount } : null;
    const lookLut = lookRef ? lutFor('look', lookRef.def.id) : null;
    return {
      src,
      size,
      halfMean,
      faces,
      obstacles: input.obstacles ?? [],
      maskClear: m.clear,
      // preview and export share this path, so the 美體 field and every face's limit apply identically to both
      body: input.body ?? null,
      photo: input.photo,
      skin: skinUniformsFor(input.photo, m.S, m.R, filterLut !== null),
      luts,
      filterLut,
      // step 2: the look draws all-or-nothing, only once its LUT is resident (S §1.4)
      adjust: adjustFor(input.photo.values, lookRef, lookLut !== null, frameFor(size, input.pictureFrame, input.grainSeed ?? 0)),
      lookLut,
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

    loadFilter: (filterId: string) => loadLut('filter', filterId),
    loadLut,
    lutState(kind, id): LutState {
      if (kind === 'filter' && id === 'none') return 'ready';
      return lutCache.get(lutKey(kind, id))?.state ?? 'none';
    },
    get adjustUnavailable() {
      return pipeline?.adjustFailed ?? false;
    },

    render(input, opts) {
      const t0 = performance.now();
      if (lost || disposed || !pipeline || !srcTex || input.width <= 0 || input.height <= 0) return emptyStats(t0);
      const still = opts?.still === true;
      const size = processingSize(input.width, input.height, tier, still, maxSize);
      uploadSource(gl, srcTex, input.source, input.width, input.height);
      sizeCanvas(size);
      const res = pipeline.run(job(input, srcTex, size, !still && tier === 'L', 'canvas', options.mirror));
      if (options.showLandmarks && input.faces.length) {
        for (const f of input.faces) pipeline.drawOverlay(f.face, options.mirror);
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
        for (const e of lutCache.values()) deleteTexture(gl, e.tex);
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
