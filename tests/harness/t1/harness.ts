// T1 engine-core harness page (served by vite on :5181, driven by run.mjs via Playwright).
// Exposes window.runT1(), which exercises the engine and returns numbers + PNG data URLs; the
// pixel comparisons against the decoded fixture happen in Node (run.mjs).
import { createEngine, isWebGL2Supported } from '../../../src/engine/index';
import { applyPreset, setFilter, setParam } from '../../../src/engine/params';
import { adapt } from '../../../src/tracking/adapter111';
import type { BeautyParams, Engine, Face, RenderInput, Tier } from '../../../src/types';

interface Shot {
  name: string;
  png: string;
  width: number;
  height: number;
}

export interface T1Result {
  webgl2: boolean;
  createdOk: boolean;
  createError: string | null;
  readyOk: boolean;
  readyError: string | null;
  glErrors: Record<string, number>;
  sizes: Record<string, { canvas: [number, number]; stats: [number, number]; passes: string[] }>;
  captureSizes: Record<string, [number, number]>;
  shots: Shot[];
  filterLoaded: Record<string, string>;
  timings: Record<string, number>;
  facePasses: Record<string, string[]>;
  errors: string[];
}

declare global {
  interface Window {
    runT1?: () => Promise<T1Result>;
  }
}

function toPng(img: ImageData): string {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2d context');
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

/** Copy the WebGL canvas as displayed (same task, before compositing clears it). */
function grabCanvas(gl: HTMLCanvasElement): string {
  const c = document.createElement('canvas');
  c.width = gl.width;
  c.height = gl.height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2d context');
  ctx.drawImage(gl, 0, 0);
  return c.toDataURL('image/png');
}

function gradientSource(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2d context');
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#d9a089');
  g.addColorStop(1, '#40302a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  return c;
}

async function run(): Promise<T1Result> {
  const res: T1Result = {
    webgl2: isWebGL2Supported(),
    createdOk: false,
    createError: null,
    readyOk: false,
    readyError: null,
    glErrors: {},
    sizes: {},
    captureSizes: {},
    shots: [],
    filterLoaded: {},
    timings: {},
    facePasses: {},
    errors: [],
  };

  console.log('runT1 start');
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  let engine: Engine;
  try {
    engine = createEngine(canvas, { mirror: false });
    res.createdOk = true; // every program compiled + linked (createProgram throws otherwise)
  } catch (e) {
    res.createError = String(e instanceof Error ? e.stack ?? e.message : e);
    return res;
  }
  const gl = canvas.getContext('webgl2') as WebGL2RenderingContext;
  const glErr = (label: string) => {
    res.glErrors[label] = gl.getError();
  };

  try {
    await engine.ready;
    res.readyOk = true;
  } catch (e) {
    res.readyError = String(e);
  }

  const blob = await (await fetch('/tests/fixtures/sample_face.png')).blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const W = bmp.width;
  const H = bmp.height;
  const input = (params: BeautyParams): RenderInput => ({ source: bmp, width: W, height: H, face: null, faceWeight: 0, params });

  const capture = (name: string, params: BeautyParams, mirror = false) => {
    console.log(`capture ${name}`);
    const t0 = performance.now();
    const img = engine.renderToImageData(input(params), { mirror });
    res.timings[`capture_${name}`] = performance.now() - t0;
    res.shots.push({ name, png: toPng(img), width: img.width, height: img.height });
    glErr(`capture_${name}`);
  };

  try {
    // (b)(d) identity + orientation via readback
    capture('original', applyPreset('original'));
    capture('original_mirror', applyPreset('original'), true);
    // (c) look checks
    capture('natural', applyPreset('natural'));
    const orig = applyPreset('original');
    capture('whiten_only', setParam(orig, 'skin.whiten', 1));
    capture('smooth_only', setParam(orig, 'skin.smooth', 1));
    capture('sharpen_only', setParam(orig, 'skin.sharpen', 0.5));
    capture('rosy_only', setParam(orig, 'skin.rosy', 1));
    capture('refined_skin', applyPreset('refined'));

    // filters (if T5's LUTs are present)
    for (const id of ['natural', 'warm', 'mono']) {
      try {
        await engine.loadFilter(id);
        res.filterLoaded[id] = 'ok';
        capture(`filter_${id}`, setFilter(applyPreset('original'), id));
      } catch (e) {
        res.filterLoaded[id] = String(e);
      }
    }

    // (e) display present, still mode, 原圖 + 自然, mirror off and on
    engine.setOptions({ mirror: false });
    let st = engine.render(input(applyPreset('original')), { still: true });
    res.shots.push({ name: 'display_original', png: grabCanvas(canvas), width: canvas.width, height: canvas.height });
    res.sizes.still = { canvas: [canvas.width, canvas.height], stats: [st.width, st.height], passes: st.passes };
    glErr('display_original');
    st = engine.render(input(applyPreset('natural')), { still: true });
    res.shots.push({ name: 'display_natural', png: grabCanvas(canvas), width: canvas.width, height: canvas.height });
    res.sizes.still_natural = { canvas: [canvas.width, canvas.height], stats: [st.width, st.height], passes: st.passes };
    glErr('display_natural');
    engine.setOptions({ mirror: true });
    engine.render(input(applyPreset('original')), { still: true });
    res.shots.push({ name: 'display_original_mirror', png: grabCanvas(canvas), width: canvas.width, height: canvas.height });
    engine.renderOriginal({ source: bmp, width: W, height: H }, { still: true });
    res.shots.push({ name: 'display_renderOriginal_mirror', png: grabCanvas(canvas), width: canvas.width, height: canvas.height });
    glErr('renderOriginal');
    engine.setOptions({ mirror: false });

    // (g) tiers: live sizes for a 1920×1080 "video" and the portrait fixture
    const video = gradientSource(1920, 1080);
    for (const t of ['H', 'M', 'L'] as Tier[]) {
      engine.setTier(t);
      const s1 = engine.render({ source: video, width: 1920, height: 1080, face: null, faceWeight: 0, params: applyPreset('natural') });
      res.sizes[`video_${t}`] = { canvas: [canvas.width, canvas.height], stats: [s1.width, s1.height], passes: s1.passes };
      const s2 = engine.render(input(applyPreset('natural')));
      res.sizes[`face_${t}`] = { canvas: [canvas.width, canvas.height], stats: [s2.width, s2.height], passes: s2.passes };
      res.shots.push({ name: `display_tier_${t}`, png: grabCanvas(canvas), width: canvas.width, height: canvas.height });
      if (t === 'M') {
        // sharpen WYSIWYG: tier-M preview vs the full-res captures 'original' / 'sharpen_only'
        engine.render(input(applyPreset('original')));
        res.shots.push({ name: 'display_original_tierM', png: grabCanvas(canvas), width: canvas.width, height: canvas.height });
        engine.render(input(setParam(applyPreset('original'), 'skin.sharpen', 0.5)));
        res.shots.push({ name: 'display_sharpen_tierM', png: grabCanvas(canvas), width: canvas.width, height: canvas.height });
      }
      const cap = engine.renderToImageData(input(applyPreset('natural')), { mirror: false });
      res.captureSizes[`face_${t}`] = [cap.width, cap.height];
      glErr(`tier_${t}`);
    }

    // face path (T2 passes + T3 adapter on the recorded landmarks fixture)
    try {
      const lm = (await (await fetch('/tests/fixtures/landmarks_sample_face.json')).json()) as { points: number[] };
      const face: Face = adapt({ points: Float32Array.from(lm.points) }, W, H);
      const faceInput = (params: BeautyParams): RenderInput => ({ source: bmp, width: W, height: H, face, faceWeight: 1, params });
      engine.setTier('H');
      const glow = applyPreset('glow');
      await engine.loadFilter(glow.filterId);
      // first face frame constructs the passes lazily; makeup is skipped until its textures load
      res.facePasses.first = engine.render(faceInput(glow), { still: true }).passes;
      const tWait = performance.now();
      while (performance.now() - tWait < 5000) {
        await new Promise((r) => setTimeout(r, 50));
        const ps = engine.render(faceInput(glow), { still: true }).passes;
        if (ps.includes('makeup')) break;
      }
      res.facePasses.glow = engine.render(faceInput(glow), { still: true }).passes;
      glErr('face_render');
      const faceCap = (name: string, params: BeautyParams, inp = faceInput(params)) => {
        console.log(`capture ${name}`);
        const img = engine.renderToImageData(inp, { mirror: false });
        res.shots.push({ name, png: toPng(img), width: img.width, height: img.height });
        glErr(`capture_${name}`);
      };
      faceCap('face_original', applyPreset('original'));
      faceCap('face_natural', applyPreset('natural'));
      faceCap('face_glow', glow);
      faceCap('face_refined', applyPreset('refined'));
      faceCap('face_weight0_natural', applyPreset('natural'), { ...faceInput(applyPreset('natural')), faceWeight: 0 });
      const smoothOnly = setParam(applyPreset('original'), 'skin.smooth', 1);
      faceCap('face_smooth_only', smoothOnly);
      engine.setOptions({ matchGpupixel: true });
      faceCap('face_smooth_only_match', smoothOnly);
      res.facePasses.match = engine.render(faceInput(applyPreset('natural')), { still: true }).passes;
      faceCap('face_natural_match', applyPreset('natural'));
      engine.setOptions({ matchGpupixel: false, showLandmarks: true, mirror: true });
      res.facePasses.overlay = engine.render(faceInput(applyPreset('natural')), { still: true }).passes;
      res.shots.push({ name: 'display_face_overlay_mirror', png: grabCanvas(canvas), width: canvas.width, height: canvas.height });
      glErr('overlay');
      engine.setOptions({ showLandmarks: false, mirror: false });
      // live-tier face frame (processing size ≠ source size)
      engine.setTier('M');
      res.facePasses.liveM = engine.render(faceInput(glow)).passes;
      res.shots.push({ name: 'display_face_glow_tierM', png: grabCanvas(canvas), width: canvas.width, height: canvas.height });
      glErr('face_tierM');
    } catch (e) {
      res.errors.push('face path: ' + String(e instanceof Error ? e.stack ?? e.message : e));
    }

    // timing: repeated live frames at tier M (CPU-side issue time + a sync readback to bound GPU time)
    engine.setTier('M');
    const vparams = applyPreset('natural');
    const N = 30;
    let t0 = performance.now();
    for (let i = 0; i < N; i++) engine.render({ source: video, width: 1920, height: 1080, face: null, faceWeight: 0, params: vparams });
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    res.timings.liveM_avg_ms = (performance.now() - t0) / N;
    engine.setTier('L');
    t0 = performance.now();
    for (let i = 0; i < N; i++) engine.render({ source: video, width: 1920, height: 1080, face: null, faceWeight: 0, params: vparams });
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    res.timings.liveL_avg_ms = (performance.now() - t0) / N;
    glErr('timing');

    // context loss → restore → render again
    const ext = gl.getExtension('WEBGL_lose_context');
    if (ext) {
      const lostEvt = new Promise<void>((r) => canvas.addEventListener('webglcontextlost', () => r(), { once: true }));
      ext.loseContext();
      await lostEvt;
      // Chromium decides "restore allowed" after ALL lost listeners ran; wait a task before restoring.
      await new Promise((r) => setTimeout(r, 0));
      res.timings.lostFlag = engine.lost ? 1 : 0;
      const lostStats = engine.render(input(applyPreset('natural')), { still: true });
      res.timings.renderWhileLostPasses = lostStats.passes.length;
      const restored = new Promise<void>((r) => canvas.addEventListener('webglcontextrestored', () => r(), { once: true }));
      ext.restoreContext();
      await Promise.race([restored, new Promise((_, rej) => setTimeout(() => rej(new Error('no webglcontextrestored within 5 s')), 5000))]);
      await new Promise((r) => setTimeout(r, 500)); // LUT re-upload
      res.timings.lostAfterRestore = engine.lost ? 1 : 0;
      engine.setTier('H');
      capture('after_restore_natural', applyPreset('natural'));
    }

    engine.dispose();
    glErr('dispose');
  } catch (e) {
    res.errors.push(String(e instanceof Error ? e.stack ?? e.message : e));
  }
  bmp.close();
  return res;
}

window.runT1 = run;
