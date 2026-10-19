// MediaPipe FaceLandmarker 0.10.35 wrapper (spec §6, RB §3).
//
// One instance serves both live VIDEO and photo IMAGE detection: WebKit leaks memory when
// instances are created/closed per photo (MPI 5036). setOptions() without a model asset, or with a
// Uint8Array one, rebuilds the graph synchronously (its promise is already resolved), so detectImage
// can stay synchronous.
//
// Each mode has its own model: the camera keeps the camera bundle (BlazeFace short-range, the cheaper
// detector a selfie needs), photos get the photo bundle (the same bundle with BlazeFace full-range,
// engine/faceBundle.ts), which finds the small faces of a group photo the short-range detector misses.
// The photo bundle is assembled from the camera bundle and opts.fullRangeDetector right before each switch
// to it and not kept: MediaPipe copies every model buffer it is given. A photo may also ask for the camera
// bundle (detector 'camera'): the retry for a face the full-range detector misses (step-1 spec §6.5). The
// camera may ask for the photo bundle in VIDEO (detector 'photo': the back camera's one pass when the group path is
// off, v0.6 spec §6.3); its group path runs IMAGE calls on copied views (detectView, §6.6), and warm() moves a
// graph's one-time GPU warm-up behind the camera's spinner.
// The model travels in the mode switch's own setOptions, so switching costs no extra rebuild. Instances
// are created on the camera model: building on the photo model only moves the full-range graph's
// one-time GPU warm-up (about 1.2 s on desktop D3D11) from the first photo to the camera start.
//
// MediaPipe recovers from nothing by itself, so the wrapper heals in two steps, cheapest first:
//  1. One bad inference poisons the graph (MPI 5152: every later call throws "Graph has errors").
//     The next call rebuilds it in place with a same-mode setOptions (~15 ms, no new instance);
//     on the live path at most once per REBUILD_INTERVAL_MS. The error is rethrown so callers
//     report it instead of mistaking it for "no face".
//  2. The GPU graph's GL context is lost (iOS backgrounding, memory pressure, GPU-process reset).
//     Calls then return no faces without throwing, and MediaPipe never preventDefaults the loss, so
//     the context is never restored (and its GL objects would be gone anyway). The instance is
//     replaced by a new one on a fresh canvas (RB §3 Fallbacks 5); likewise after ESCALATE_AFTER
//     consecutive failures that in-place rebuilds did not fix, at most MAX_ESCALATIONS times in a
//     row (an error that survives fresh instances too is reported as 'failed'). Replacing only on
//     these rare events keeps to the single-instance rule.
import { FaceLandmarker, FilesetResolver, type FaceLandmarkerOptions } from '@mediapipe/tasks-vision';
import { EDIT_DETECT_FACES, LIVE_DETECT_FACES } from '../config/limits';
import { withFaceDetector } from '../engine/faceBundle';
import type { Delegate, FaceDetectorKind, Landmarks478, Tracker, TrackerOptions, TrackerState } from '../types';

const N_POINTS = 478;
/** CPU-path frame copy is capped here; the model crops the face to 256² anyway. */
const CPU_FRAME_MAX_EDGE = 1280;
/** Live path: minimum spacing of failure-driven in-place graph rebuilds. */
export const REBUILD_INTERVAL_MS = 1000;
/** Consecutive failed inferences (each after an in-place rebuild) before the instance is replaced. */
export const ESCALATE_AFTER = 3;
/** Delay before each replacement attempt (the last value repeats): a reset GPU process may refuse new contexts for a while. */
export const RECREATE_BACKOFF_MS: readonly number[] = [500, 1000, 2000, 5000];
/** 'auto': replacement attempts that retry the GPU delegate alone before CPU is tried as well. */
export const CPU_FALLBACK_AFTER = 2;
/** Failed replacement attempts before 'failed' is reported and retries wait for a detect call / return to foreground. */
export const SELF_RETRY_ATTEMPTS = 8;
/**
 * Failure-driven replacements since the last completed inference before 'failed' is reported and the instance is
 * kept (only throttled in-place rebuilds from then on). At least 2, so 'auto' gets its GPU retry and then CPU.
 */
export const MAX_ESCALATIONS = 3;
/** Distinct errors logged per tracker. */
const MAX_LOGGED = 8;
/** warm()'s blank input, px per side (v0.6 spec §6.3) */
const WARM_EDGE = 64;

type ImageInput = ImageBitmap | HTMLCanvasElement | HTMLImageElement | OffscreenCanvas;
type Fileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

/** Every face with a full 478-point set, in MediaPipe's result order; [] for none. */
function toLandmarksAll(faces: { x: number; y: number; z: number }[][]): Landmarks478[] {
  const out: Landmarks478[] = [];
  for (const face of faces) {
    if (!face || face.length < N_POINTS) continue;
    const points = new Float32Array(N_POINTS * 3);
    for (let i = 0; i < N_POINTS; i++) {
      const q = face[i];
      points[i * 3] = q.x;
      points[i * 3 + 1] = q.y;
      points[i * 3 + 2] = q.z;
    }
    out.push({ points });
  }
  return out;
}

/** maxFaces → numFaces: 1…EDIT_DETECT_FACES (NaN → 1) */
export function clampFaces(n: number): number {
  return Number.isFinite(n) ? Math.min(EDIT_DETECT_FACES, Math.max(1, Math.floor(n))) : 1;
}

function imageSize(img: ImageInput): [number, number] {
  if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) {
    return img.complete ? [img.naturalWidth, img.naturalHeight] : [0, 0];
  }
  return [img.width, img.height];
}

interface FrameCopy {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: CanvasDrawImage;
}

function createFrameCopy(): FrameCopy | null {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
  const ctx = canvas.getContext('2d', { alpha: false }) as CanvasDrawImage | null;
  return ctx ? { canvas, ctx } : null;
}

/**
 * The CPU delegate reads a video back at videoWidth×videoHeight from a texture uploaded at the
 * frame's visible size; when those differ (Chromium scales camera frames lazily: coded 1280×720,
 * visible 960×720, display 640×480) landmarks come out scaled from the top-left corner. Copying
 * the frame to a canvas first gives MediaPipe consistent sizes. The GPU path is unaffected.
 */
function copyFrame(copy: FrameCopy, video: HTMLVideoElement): OffscreenCanvas | HTMLCanvasElement {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const s = Math.min(1, CPU_FRAME_MAX_EDGE / Math.max(vw, vh));
  const w = Math.max(1, Math.round(vw * s));
  const h = Math.max(1, Math.round(vh * s));
  if (copy.canvas.width !== w || copy.canvas.height !== h) {
    copy.canvas.width = w;
    copy.canvas.height = h;
  }
  copy.ctx.drawImage(video, 0, 0, w, h);
  return copy.canvas;
}

/** warm()'s input: a WARM_EDGE² canvas whose 2D context leaves it cleared (opaque black) */
function createBlank(): OffscreenCanvas | HTMLCanvasElement {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(WARM_EDGE, WARM_EDGE) : document.createElement('canvas');
  canvas.width = WARM_EDGE;
  canvas.height = WARM_EDGE;
  canvas.getContext('2d', { alpha: false });
  return canvas;
}

interface Instance {
  landmarker: FaceLandmarker;
  delegate: Delegate;
  /** MediaPipe's own context on our explicit canvas (GPU delegate only), polled with isContextLost() */
  gl: WebGL2RenderingContext | null;
  /** context lost or retired for replacement: never call into it again */
  dead: boolean;
  /** close() already called */
  released: boolean;
}

async function createInstance(
  fileset: Fileset,
  modelBuffer: Uint8Array,
  delegate: Delegate,
  onLost: (inst: Instance) => void,
  numFaces: number,
): Promise<Instance> {
  const options: FaceLandmarkerOptions = {
    // Copied by tasks-vision 0.10.35 (setOptions keeps its own Uint8Array, which every graph rebuild serializes into
    // the wasm heap): the caller's buffer is not read again after this call.
    baseOptions: { modelAssetBuffer: modelBuffer, delegate },
    runningMode: 'VIDEO',
    numFaces,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  };
  // Explicit canvas: the library's own Safari ≥ 17 UA sniff fails for CriOS/FxiOS/EdgiOS, it lets
  // us watch for context loss (RB §3), and a fresh canvas per instance because a task's canvas
  // cannot be reset.
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : undefined;
  if (canvas) options.canvas = canvas;
  const landmarker = await FaceLandmarker.createFromOptions(fileset, options);
  const inst: Instance = { landmarker, delegate, gl: null, dead: false, released: false };
  // Only the GPU graph depends on this context: the CPU delegate keeps detecting after a loss.
  if (canvas && delegate === 'GPU') {
    canvas.addEventListener('webglcontextlost', () => onLost(inst));
    // Same type as MediaPipe's, so this returns its existing context (null if it ever picked
    // WebGL1: the event alone then). Polled too: WebKit firing the event on OffscreenCanvas is unverified.
    try {
      inst.gl = canvas.getContext('webgl2');
    } catch {
      inst.gl = null;
    }
  }
  return inst;
}

/** Try `order` in turn; throws the last error when every delegate fails. */
async function createFirst(
  fileset: Fileset,
  modelBuffer: Uint8Array,
  order: readonly Delegate[],
  onLost: (inst: Instance) => void,
  onFail: (d: Delegate, e: unknown, next: Delegate | undefined) => void,
  numFaces: number,
): Promise<Instance> {
  let err: unknown = new Error('no delegate to try');
  for (let i = 0; i < order.length; i++) {
    try {
      return await createInstance(fileset, modelBuffer, order[i], onLost, numFaces);
    } catch (e) {
      err = e;
      onFail(order[i], e, order[i + 1]);
    }
  }
  throw err;
}

function release(inst: Instance, note: (where: string, e: unknown) => void): void {
  if (inst.released) return;
  inst.released = true;
  try {
    inst.landmarker.close();
  } catch (e) {
    note('close', e); // a lost context can make close() throw
  }
}

/** which bundle a graph holds: the camera's (short-range) or the photo bundle (full-range) */
type ModelKind = 'camera' | 'photo';

export async function createTracker(opts: TrackerOptions): Promise<Tracker> {
  const fileset = await FilesetResolver.forVisionTasks(opts.wasmBase);
  const { modelBuffer } = opts;

  const logged = new Set<string>();
  /** Log each distinct error once (per-frame failures must not flood the console). */
  const note = (where: string, e: unknown): void => {
    const key = `${where}: ${e instanceof Error ? e.message : String(e)}`;
    if (logged.has(key) || logged.size >= MAX_LOGGED) return;
    logged.add(key);
    console.warn(`[tracker] ${where} failed:`, e);
  };

  /** a detector the photo bundle could not be assembled with (not a TFLite model, or the camera bundle is no stored zip) */
  let refused: Uint8Array | null = null;
  /** the full-range detector photos run now; null (none yet, or refused) → they run the camera bundle */
  const fullRange = (): Uint8Array | null => {
    let d: Uint8Array | null = null;
    try {
      d = opts.fullRangeDetector?.() ?? null;
    } catch (e) {
      note('fullRangeDetector', e);
    }
    return d && d !== refused ? d : null;
  };
  /** the photo bundle, assembled for one switch to it (about 3–4 ms on the desktop); null when there is none */
  const photoBundle = (): Uint8Array | null => {
    const d = fullRange();
    if (!d) return null;
    try {
      return withFaceDetector(modelBuffer, d);
    } catch (e) {
      refused = d;
      note('photo model', e);
      return null;
    }
  };

  // declared before the first instance exists: its loss listener closes over `inst`
  let inst: Instance;
  const onLost = (i: Instance) => {
    if (i === inst) retire();
    else i.dead = true;
  };
  /** numFaces of the current graph; every instance (the first and each replacement) is built with the last requested count */
  let faces = LIVE_DETECT_FACES;
  inst = await createFirst(
    fileset,
    modelBuffer,
    opts.delegate === 'auto' ? ['GPU', 'CPU'] : [opts.delegate],
    onLost,
    (d, e, next) => {
      if (next) console.warn(`[tracker] ${d} delegate failed, retrying on ${next}:`, e);
    },
    faces,
  );

  let frameCopy = inst.delegate === 'CPU' ? createFrameCopy() : null;
  /** warm()'s input, made on its first call */
  let blank: OffscreenCanvas | HTMLCanvasElement | null = null;
  let lastTs = -Infinity;
  let mode: 'VIDEO' | 'IMAGE' = 'VIDEO';
  /** the bundle of the current graph (every instance is built on the camera's) */
  let model: ModelKind = 'camera';
  let closed = false;
  // step 1: in-place graph rebuild
  let needsRebuild = false;
  let lastRebuildAt = -Infinity;
  /** consecutive failed inferences */
  let failures = 0;
  /** any inference ever completed (on any instance) */
  let everSucceeded = false;
  // step 2: instance replacement
  /** failure-driven replacements since the last completed inference */
  let escalations = 0;
  let forceCpu = false;
  /** replacement attempts since the last completed inference */
  let attempts = 0;
  let replacing = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let state: TrackerState = 'ok';

  const emit = (s: TrackerState) => {
    if (s === state) return;
    state = s;
    try {
      opts.onStateChange?.(s);
    } catch (e) {
      note('onStateChange', e);
    }
  };
  const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

  const replacementOrder = (): Delegate[] => {
    if (forceCpu) return ['CPU'];
    if (opts.delegate !== 'auto') return [opts.delegate];
    if (inst.delegate === 'CPU') return ['CPU'];
    return attempts > CPU_FALLBACK_AFTER ? ['GPU', 'CPU'] : ['GPU'];
  };

  const replace = async (): Promise<void> => {
    replacing = true;
    attempts++;
    release(inst, note);
    let next: Instance | null = null;
    try {
      next = await createFirst(fileset, modelBuffer, replacementOrder(), onLost, (d, e) => note(`recreate (${d})`, e), faces);
    } catch {
      next = null; // each failure already noted
    }
    replacing = false;
    if (closed) {
      if (next) release(next, note);
      return;
    }
    if (!next) {
      if (attempts >= SELF_RETRY_ATTEMPTS) emit('failed');
      else requestReplace();
      return;
    }
    // The new graph starts in VIDEO, on the camera model, with the last requested count (`faces` is unchanged);
    // lastTs is kept so timestamps stay strictly increasing.
    inst = next;
    mode = 'VIDEO';
    model = 'camera';
    needsRebuild = false;
    lastRebuildAt = -Infinity;
    failures = 0;
    forceCpu = false;
    if (next.delegate === 'CPU') frameCopy ??= createFrameCopy();
    if (next.dead || next.gl?.isContextLost()) {
      next.dead = true; // lost again straight away (GPU process still resetting): stay 'lost', retry
      requestReplace();
      return;
    }
    emit('ok');
  };

  /** Single-flight, backed-off replacement; never while hidden (the visibilitychange handler re-requests). */
  const requestReplace = (): void => {
    if (closed || replacing || retryTimer !== null || hidden()) return;
    const delay = RECREATE_BACKOFF_MS[Math.min(attempts, RECREATE_BACKOFF_MS.length - 1)];
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (closed || hidden()) return;
      void replace();
    }, delay);
  };

  /** The current instance is unusable: stop calling it and replace it. */
  function retire(): void {
    if (inst.dead) return;
    inst.dead = true;
    emit('lost');
    requestReplace();
  }

  /** false while the current instance is dead (and makes sure a replacement is on its way). */
  const usable = (): boolean => {
    if (!inst.dead && inst.gl?.isContextLost()) retire();
    if (!inst.dead) return true;
    requestReplace();
    return false;
  };

  const onVisibility = () => {
    if (!hidden()) usable();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  const succeeded = <T>(r: T): T => {
    failures = 0;
    escalations = 0;
    attempts = 0;
    everSucceeded = true;
    // the instance kept after MAX_ESCALATIONS works again
    if (state === 'failed' && !inst.dead) emit('ok');
    return r;
  };

  /** Record an inference failure; the next call rebuilds the graph, repeated failures replace the instance. */
  const failed = (where: string, e: unknown): unknown => {
    note(where, e);
    needsRebuild = true;
    if (++failures >= ESCALATE_AFTER) {
      failures = 0;
      // Fresh instances fail the same way: stop replacing (each create/close leaks on WebKit, MPI 5036).
      if (escalations >= MAX_ESCALATIONS) {
        emit('failed');
        return e;
      }
      // RB §3 sanctions CPU only as a last resort: on 'auto', a GPU graph that never produced a
      // result and whose GPU replacement failed the same way.
      forceCpu = opts.delegate === 'auto' && inst.delegate === 'GPU' && !everSucceeded && escalations >= 1;
      escalations++;
      retire();
    }
    return e;
  };

  // Every mode, count or model change rebuilds the graph, and the first inference after a rebuild is slow on the
  // GPU delegate (~1 s in desktop Chromium). Switching back to VIDEO lazily, on the next
  // detectVideo, keeps back-to-back photo detections from paying that twice. After a failure the
  // same-mode setOptions is the rebuild that clears the poisoned graph. `detector` picks the bundle in either mode
  // (the photo bundle in VIDEO: the back camera with the group path off, v0.6 spec §6.3).
  const setMode = (m: 'VIDEO' | 'IMAGE', n: number, detector: FaceDetectorKind) => {
    let want: ModelKind = detector === 'photo' && fullRange() ? 'photo' : 'camera';
    // the bytes to switch to (null: the graph already holds `want`); the photo bundle is assembled only for a switch
    let buffer: Uint8Array | null = null;
    if (want === 'photo' && model !== 'photo') {
      buffer = photoBundle();
      if (!buffer) want = 'camera';
    }
    if (want === 'camera' && model !== 'camera') buffer = modelBuffer;
    if (mode === m && faces === n && model === want && !needsRebuild) return;
    // Mode, count and model first: on a poisoned graph setOptions applies the new options (the model asset before
    // the rebuild) and starts the new graph, then throws while closing the old one, so the graph is in (m, n, want)
    // either way. runningMode and numFaces every time: the bundle writes numFaces only when the key is present, and
    // options are sticky. The model only when it changes, without `delegate` (sticky too); a Uint8Array keeps the
    // call synchronous.
    mode = m;
    faces = n;
    model = want;
    if (needsRebuild) {
      needsRebuild = false;
      lastRebuildAt = performance.now();
    }
    try {
      const o: FaceLandmarkerOptions = buffer ? { baseOptions: { modelAssetBuffer: buffer }, runningMode: m, numFaces: n } : { runningMode: m, numFaces: n };
      Promise.resolve(inst.landmarker.setOptions(o)).catch((e: unknown) => note('rebuild', e));
    } catch (e) {
      note('rebuild', e);
    }
  };

  return {
    get delegate() {
      return inst.delegate;
    },

    detectVideo(video: HTMLVideoElement, tsMs: number, o: { maxFaces: number; detector?: FaceDetectorKind }): Landmarks478[] | null {
      // MPI 5152: an empty frame gives "ROI width and height must be > 0" and poisons the graph.
      if (closed || video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) return null;
      // VIDEO mode requires strictly increasing timestamps (rVFC can repeat a mediaTime).
      const ts = tsMs > lastTs ? tsMs : lastTs + 1;
      lastTs = ts;
      if (!usable()) return null;
      // a persistent error must not rebuild the graph every frame
      if (needsRebuild && performance.now() - lastRebuildAt < REBUILD_INTERVAL_MS) return null;
      try {
        setMode('VIDEO', clampFaces(o.maxFaces), o.detector ?? 'camera');
        const frame = inst.delegate === 'CPU' && frameCopy ? copyFrame(frameCopy, video) : video;
        return succeeded(toLandmarksAll(inst.landmarker.detectForVideo(frame, ts).faceLandmarks));
      } catch (e) {
        throw failed('detectVideo', e);
      }
    },

    get photoDetector() {
      return fullRange() ? ('full-range' as const) : ('short-range' as const);
    },

    detectImage(image: ImageInput, o: { maxFaces: number; detector?: FaceDetectorKind }): Landmarks478[] {
      if (closed) return [];
      const [w, h] = imageSize(image);
      if (w <= 0 || h <= 0) return [];
      if (!usable()) return [];
      // one-shot and user-initiated: rebuild right away, no throttle
      try {
        setMode('IMAGE', clampFaces(o.maxFaces), o.detector ?? 'photo');
        return succeeded(toLandmarksAll(inst.landmarker.detect(image).faceLandmarks));
      } catch (e) {
        throw failed('detectImage', e);
      }
    },

    // detectImage's call under detectVideo's guards (the live loop's group path, v0.6 spec §6.6): null, not [], when
    // there is no answer, so the loop holds its tracks (A5)
    detectView(view: OffscreenCanvas | HTMLCanvasElement, o: { maxFaces: number; detector: FaceDetectorKind }): Landmarks478[] | null {
      if (closed) return null;
      // MPI 5152: an empty input poisons the graph
      if (view.width <= 0 || view.height <= 0) return null;
      if (!usable()) return null;
      // a persistent error must not rebuild the graph on every view
      if (needsRebuild && performance.now() - lastRebuildAt < REBUILD_INTERVAL_MS) return null;
      try {
        setMode('IMAGE', clampFaces(o.maxFaces), o.detector);
        return succeeded(toLandmarksAll(inst.landmarker.detect(view).faceLandmarks));
      } catch (e) {
        throw failed('detectView', e);
      }
    },

    warm(m: 'VIDEO' | 'IMAGE', detector: FaceDetectorKind): void {
      if (closed || !usable()) return;
      try {
        setMode(m, m === 'IMAGE' ? EDIT_DETECT_FACES : LIVE_DETECT_FACES, detector);
        blank ??= createBlank();
        if (m === 'IMAGE') {
          inst.landmarker.detect(blank);
        } else {
          // the live loop's clock (live.ts passes performance.now()), kept strictly increasing as detectVideo does
          const now = performance.now();
          const ts = now > lastTs ? now : lastTs + 1;
          lastTs = ts;
          inst.landmarker.detectForVideo(blank, ts);
        }
        succeeded(undefined);
      } catch (e) {
        failed('warm', e); // noted once; the next call rebuilds the graph
      }
    },

    close() {
      if (closed) return;
      closed = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      release(inst, note);
    },
  };
}
