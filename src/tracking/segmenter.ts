// MediaPipe ImageSegmenter (tasks-vision 0.10.35, selfie_segmenter 249,537 B) for the 瘦臉 background limit
// (reports/美體修圖 背景扭曲 抑制技術.md stage 1 ②): the person mask of a photo that has no cached 美體 detection.
//
// Measured in headless Chromium (Playwright, 0.10.35, selfie_segmenter float16/1) before choosing the graph:
//  - CPU delegate + confidence masks: works. No "Check failed: 1 == ChannelSize()" abort (that is PoseLandmarker's
//    segmentation-mask path); the float mask comes back with the input's size, ≈ 100 ms for a 1000×1500 input, and it
//    matches the GPU graph's mask (person coverage 0.936 vs 0.937 on sample_face).
//  - CPU + category mask also works (uint8, 0 = person); GPU works too. CPU is used for inference, but the graph still
//    owns a (1×1) WebGL2 context on its GraphRunner canvas, and on 0.10.35 the segmentation postprocessor runs in GL
//    even with delegate 'CPU' (the console logs segmentation_postprocessor_gl.cc). iOS can take that context on
//    backgrounding: the canvas is created here and watched (webglcontextlost, and isContextLost() polled because WebKit
//    firing the event on OffscreenCanvas is unverified). After a loss (WEBGL_lose_context) segment() does not throw: it
//    returns an all-zero confidence mask, i.e. "nobody". CPU PoseLandmarker / FaceLandmarker keep detecting after a
//    loss (identical landmarks), so only the segmenter needs this guard. segment() throws SegmenterContextLostError
//    instead (`lost` = true, graph released), and `dead` / `lost` poll too, so the caller can build a fresh instance.
// One instance per session (services.ts ensureFaceSegmenter), created lazily after the face tracker; IMAGE mode,
// synchronous segment() on a ≤ SEG_INPUT_MAX_EDGE copy (the model's input is 256², so a larger copy buys nothing).
// Any failure is the caller's cue to fall back to the unlimited 瘦臉 (an abort kills the module: never call it again).
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
import type { PersonMask } from '../types';
import { downscaleMask, fitLongEdge, isWasmAbort } from './bodyTracker';

/** long edge of the copy handed to the model */
export const SEG_INPUT_MAX_EDGE = 512;

export interface PersonSegmenterOptions {
  /** selfie_segmenter.tflite bytes */
  modelBuffer: Uint8Array;
  /** e.g. '/mediapipe/0.10.35' */
  wasmBase: string;
}

export interface PersonSegmenter {
  /**
   * Person mask of `image` (≈ 256 long edge, row 0 = top), null when nobody is in it. Throws on failure; after a throw
   * the instance is dead (`dead` = true) and every later call throws at once. A lost WebGL context throws
   * SegmenterContextLostError (never a null "nobody" from the all-zero mask a lost context yields).
   */
  segment(image: ImageBitmap | HTMLCanvasElement): PersonMask | null;
  /**
   * unusable: it threw, was closed, or lost its WebGL context (`lost`). Polls the context of an instance that has run,
   * so a loss whose webglcontextlost event never came (or has not come yet) reads as dead before segment() is called.
   */
  readonly dead: boolean;
  /**
   * the graph's WebGL context was lost (e.g. iOS backgrounding): a new instance would work, unlike after an abort.
   * Decided when the instance dies: one that died of another cause (a throw, close()) never turns `lost` later.
   */
  readonly lost: boolean;
  close(): void;
}

/** the segmenter graph's WebGL context was lost: the instance is dead, a fresh one is expected to work */
export class SegmenterContextLostError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('segmenter: WebGL context lost', options);
    this.name = 'SegmenterContextLostError';
  }
}

type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
type GL = WebGL2RenderingContext | WebGLRenderingContext;

export async function createPersonSegmenter(opts: PersonSegmenterOptions): Promise<PersonSegmenter> {
  const fileset = await FilesetResolver.forVisionTasks(opts.wasmBase);
  // the GraphRunner canvas (what tasks-vision would create itself), owned here so the loss of its WebGL context is seen
  const glCanvas: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
  let lost = false;
  const onLost = () => {
    lost = true;
  };
  glCanvas.addEventListener('webglcontextlost', onLost);
  let seg: ImageSegmenter;
  try {
    seg = await ImageSegmenter.createFromOptions(fileset, {
      canvas: glCanvas,
      baseOptions: { modelAssetBuffer: opts.modelBuffer, delegate: 'CPU' },
      runningMode: 'IMAGE',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
  } catch (e) {
    glCanvas.removeEventListener('webglcontextlost', onLost);
    throw e;
  }
  let dead = false;
  let closed = false;
  /** segment() has run once: the library has made its context, so getContext() returns it rather than making one */
  let ran = false;
  let gl: GL | null = null;
  /** sticky; a never-run instance is not polled (getContext() then would make a context before the library does) */
  const contextLost = (): boolean => {
    if (lost || !ran) return lost;
    try {
      gl ??= (glCanvas.getContext('webgl2') ?? glCanvas.getContext('webgl')) as GL | null;
      if (gl?.isContextLost()) lost = true;
    } catch {
      // a canvas bound to another context type: nothing to watch
    }
    return lost;
  };
  let frame: { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: Canvas2D } | null = null;
  const release = () => {
    if (closed) return;
    closed = true;
    frame = null;
    glCanvas.removeEventListener('webglcontextlost', onLost);
    try {
      seg.close();
    } catch (e) {
      console.warn('[segmenter] close', e);
    }
  };
  return {
    get dead() {
      return dead || closed || contextLost();
    },
    get lost() {
      // a live instance is polled; a dead one keeps the cause it died of (segment() polls on its way out)
      return dead || closed ? lost : contextLost();
    },
    segment(image) {
      if (closed) throw new Error('segmenter closed');
      if (dead) throw new Error('segmenter failed earlier');
      if (contextLost()) {
        dead = true;
        release();
        throw new SegmenterContextLostError();
      }
      try {
        const [w, h] = fitLongEdge(image.width, image.height, SEG_INPUT_MAX_EDGE);
        if (!frame) {
          const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
          const ctx = canvas.getContext('2d', { alpha: false }) as Canvas2D | null;
          if (!ctx) throw new Error('segmenter: no 2D canvas context');
          frame = { canvas, ctx };
        }
        if (frame.canvas.width !== w || frame.canvas.height !== h) {
          frame.canvas.width = w;
          frame.canvas.height = h;
        }
        frame.ctx.drawImage(image, 0, 0, w, h);
        ran = true;
        const r = seg.segment(frame.canvas);
        try {
          // a lost context yields an all-zero mask: it would say "nobody"
          if (contextLost()) throw new SegmenterContextLostError();
          const m = r.confidenceMasks?.[0];
          if (!m || m.width <= 0 || m.height <= 0) throw new Error('segmenter: no confidence mask');
          return downscaleMask(m.getAsFloat32Array(), m.width, m.height);
        } finally {
          r.close();
        }
      } catch (e) {
        dead = true;
        if (!(e instanceof SegmenterContextLostError) && contextLost()) {
          // the loss made the graph throw rather than return an all-zero mask: same cause, same remedy
          release();
          throw new SegmenterContextLostError({ cause: e });
        }
        // an abort leaves the module unusable, a lost context leaves the graph's GL state gone: release what can be
        // released, never call it again
        if (lost || isWasmAbort(e)) release();
        throw e;
      }
    },
    close: release,
  };
}
