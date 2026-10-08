// MediaPipe PoseLandmarker (tasks-vision 0.10.35) wrapper for 美體 (body research report §偵測).
//
// The caller creates one tracker per session, lazily and after the face tracker: every MediaPipe task carries its
// own wasm heap, and WebKit leaks when instances are created per photo. Photo mode is IMAGE with numPoses 2 (a
// second person is reported), segmentation on, input copied to our own canvas at ≤ 1280 long edge.
//
// Delegate and masks — measured in headless Chromium (tests/harness/b3/probe.mjs), contrary to BR's CPU plan:
//  - CPU delegate + outputSegmentationMasks ABORTS the wasm module in 0.10.35 on every detect (image_frame.cc:415
//    "Check failed: 1 == ChannelSize() (1 vs. 4)": the float mask is copied out as if it were 8-bit), in IMAGE and
//    VIDEO mode, full and lite. An abort kills the whole module, so this combination is never created.
//  - GPU delegate masks read inside detect's callback come back all zero (the MPI 4757 symptom); the synchronous
//    detect, which copies the masks before returning, gives correct masks. So detect is synchronous + close().
// Hence: masks requested → the graph runs on the GPU delegate (landmarks match CPU to 1e-5); if the GPU graph
// cannot be created the tracker falls back to CPU without masks (BodyDetection.mask = null, B1's keypoint widths).
// A mask that still comes back empty (some GPU) also reads as null. `delegate` reports what actually runs.
//
// ── Recovery ──
// Healing in place as in tracker.ts: an inference error poisons the graph (MPI 5152), so the next call rebuilds it
// with a same-mode setOptions and the error is rethrown (never mistaken for "no person"). What the rebuild cannot
// cure retires the instance for a fresh one, created in the background while calls throw BodyTrackerRecovering (a
// retry a moment later succeeds): a wasm abort (it kills the module, which throws on every later call), a lost GPU
// context (iOS backgrounding, memory pressure; it never comes back), ESCALATE_AFTER consecutive failures. Every
// create/close leaks on WebKit (MPI 5036) and the typical replacement failure is OOM, so five separate rules bound
// replacement, each with its own state:
//  (a) LEAK CAP. `replacements` counts instances retired since the last COMPLETED inference (any detect that
//      returned, "no person" included); only a completed inference resets it, creating an instance does not. The
//      first MAX_ESCALATIONS retirements are replaced at once. Beyond the cap a dead instance (aborted, context
//      lost, or its graph just abandoned for CPU) goes to STALLED, i.e. it is replaced at the backoff's pace, and a
//      live one (an ordinary error) is kept and the error rethrown: a fresh copy of the same graph fails the same way.
//  (b) GPU-MASK EVIDENCE. `gpuEscalations` counts escalations (failure-driven retirements) of a GPU mask graph
//      before any GPU graph read a mask back (`gpuProven`, sticky). Only detect-time failures count: a throw at
//      inference or at the mask readback (toDetection), or an abort. "No person" never runs the GPU-only mask copy,
//      so it proves nothing and resets nothing. At CPU_FALLBACK_AFTER the tracker switches for good (`cpuOnly`) to
//      the CPU graph without masks. A failed creation is NOT evidence (typically OOM right after an abort): a
//      replacement whose GPU build fails is retried on the GPU after the backoff, and only GPU_CREATE_TRIES
//      consecutive failed GPU builds make the next attempts build the CPU graph, NOT sticky: once one is built the
//      count restarts and the next replacement tries the GPU graph again. The one exception is the first creation
//      (createBodyTracker): it falls through GPU → CPU in the same call and sets cpuOnly, because nothing has
//      aborted yet and a GPU graph that cannot be built at startup is a capability (no WebGL2 / float textures).
//  (c) RELEASE FIRST. A retired instance is released BEFORE its replacement is allocated (two pose heaps on a
//      low-RAM iPhone is what fails) and is never called again: `inst` is null outside LIVE.
//  (d) BACKOFF. `strikes` counts entries into STALLED since the last completed inference. STALLED waits retryWait()
//      = CREATE_RETRY_MS · 2^(strikes − 1), capped at CREATE_RETRY_MAX_MS, then the next call makes ONE attempt.
//      Inside the window calls throw BodyTrackerUnavailable (`cause`: the creation error, or at the cap the error
//      that retired the instance; `trigger`: the error that retired it, null for a lost GPU context), not
//      BodyTrackerRecovering, so callers stop waiting and show a real error with 重試.
//  (e) LIVENESS. At most one creation is in flight; nothing retries on its own (every transition is a call or the
//      one pending creation settling); one graph (one heap) per attempt. From STALLED a call after the window always
//      attempts again, so once the environment heals (memory back) the first call after the window recovers.
//
// States (`state`; `inst` is the live instance, null in every other state):
//   LIVE       detect runs on `inst`
//   REPLACING  one creation in flight
//   STALLED    no instance, no creation: waiting retryWait() since `stalledAt`
//   CLOSED
// Events → transitions:
//   LIVE   detect completes (person + mask, person without mask, no person) → LIVE; failures = replacements =
//          strikes = 0; a mask read back from a GPU graph sets gpuProven.
//   LIVE   inference or mask readback throws (not an abort) → failures++, rebuild in place on the next call, rethrow;
//          the ESCALATE_AFTER-th consecutive one escalates.
//   LIVE   wasm abort → escalates at once.
//          escalate(e): (b) may set cpuOnly. Not aborted, cpuOnly unchanged and replacements ≥ MAX_ESCALATIONS →
//          LIVE, instance kept, e rethrown (failures restart). Otherwise retire(e).
//   LIVE   GPU context lost (webglcontextlost, or isContextLost() polled by a call) → retire(null).
//          retire: release the instance; replacements < MAX_ESCALATIONS → replacements++, start a creation →
//          REPLACING, throw BodyTrackerRecovering; else → STALLED (strikes++), throw BodyTrackerUnavailable.
//   REPLACING  call → BodyTrackerRecovering.
//   REPLACING  creation ok → LIVE (a fresh graph in `mode`, failures = 0); closed meanwhile → released at once.
//   REPLACING  creation fails (GPU or CPU) → STALLED (strikes++, cause = the creation error).
//   STALLED    call inside retryWait() → BodyTrackerUnavailable; after it (or with a clock that went backwards) →
//              start a creation → REPLACING, throw BodyTrackerRecovering.
//   any        close → CLOSED: the live instance is released; a pending creation is released when it settles.
// The graph a creation builds: cpuOnly → CPU without masks; GPU_CREATE_TRIES consecutive failed GPU builds → CPU
// without masks (degraded, not sticky); else the requested graph. bodyTracker.fuzz.test.ts model-checks these rules.
import {
  FilesetResolver,
  PoseLandmarker,
  type NormalizedLandmark,
  type PoseLandmarkerOptions,
  type PoseLandmarkerResult,
} from '@mediapipe/tasks-vision';
import type { BodyDetection, BodyTracker, BodyTrackerOptions, Delegate, PersonMask } from '../types';

export const N_POSE_POINTS = 33;
/** Inference input cap (same as the face tracker's CPU frame copy); the pose model crops to 256² anyway. */
export const BODY_INPUT_MAX_EDGE = 1280;
/** Long edge of the stored person mask (BR §管線: ≈ 256 matches the displacement field). */
export const MASK_LONG_EDGE = 256;
/** A mask with fewer confident pixels than this fraction of the image is treated as unavailable. */
const MASK_MIN_COVERAGE = 0.002;
/**
 * Consecutive failed inferences (each after an in-place rebuild) before the instance is replaced. 2, not
 * tracker.ts's 3: every photo-mode failure costs the user a 重試 tap.
 */
export const ESCALATE_AFTER = 2;
/** Leak cap (header (a)): retirements replaced at once since the last completed inference; beyond it, the backoff. */
export const MAX_ESCALATIONS = 2;
/** Header (b): escalations of a never-proven GPU mask graph before the sticky CPU fallback (one GPU retry). */
export const CPU_FALLBACK_AFTER = 2;
/** Header (b): consecutive failed GPU builds of replacements before the next attempts build the CPU graph. */
export const GPU_CREATE_TRIES = 2;
/**
 * STALLED waits this long before the next attempt, doubling per strike (header (d)). Longer than one detectBody
 * poll (500 ms): its first poll in STALLED gets BodyTrackerUnavailable and stops waiting.
 */
export const CREATE_RETRY_MS = 5000;
export const CREATE_RETRY_MAX_MS = 60000;

type DetectInput = ImageBitmap | HTMLCanvasElement | HTMLImageElement | OffscreenCanvas;
type Mode = 'IMAGE' | 'VIDEO';
type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
type Fileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

/** Thrown while a retired instance is being replaced (REPLACING): retry shortly. */
export class BodyTrackerRecovering extends Error {
  constructor() {
    super('美體偵測器正在重新建立，請稍後再試');
    this.name = 'BodyTrackerRecovering';
  }
}

/**
 * Thrown in STALLED inside the retry backoff: the retired instance has no replacement because creating one failed
 * (typically OOM after a wasm abort) or the leak cap was reached. A real error, not worth waiting for. `cause` is
 * the creation error, or at the cap the error that retired the instance; `trigger` the error that retired it (null:
 * a lost GPU context).
 */
export class BodyTrackerUnavailable extends Error {
  readonly trigger: unknown;
  constructor(cause: unknown, trigger: unknown) {
    super('美體偵測器無法重新建立，請稍後重試', { cause });
    this.name = 'BodyTrackerUnavailable';
    this.trigger = trigger;
  }
}

// ───────────────────────── pure helpers (unit-tested) ─────────────────────────

/** Integer size with the long edge capped at `maxEdge` (never upscaled), aspect preserved. */
export function fitLongEdge(w: number, h: number, maxEdge: number): [number, number] {
  const s = Math.min(1, maxEdge / Math.max(w, h, 1));
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
}

/** The delegate the graph is created with, and whether it produces masks (see the header). */
export function resolveDelegate(opts: Pick<BodyTrackerOptions, 'delegate' | 'outputMask'>): {
  delegate: Delegate;
  masks: boolean;
} {
  const masks = opts.outputMask ?? true;
  return { delegate: masks ? 'GPU' : (opts.delegate ?? 'CPU'), masks };
}

/**
 * Index of the person to edit: the largest landmark bounding box (clipped to the frame), discounted by how far its
 * centre is from the image centre, so a big bystander at the edge does not beat a centred subject of similar size.
 */
export function selectPerson(poses: readonly (readonly NormalizedLandmark[])[]): number {
  let best = -1;
  let bestScore = -Infinity;
  poses.forEach((pose, i) => {
    let x0 = 1;
    let y0 = 1;
    let x1 = 0;
    let y1 = 0;
    for (const p of pose) {
      const x = Math.min(1, Math.max(0, p.x));
      const y = Math.min(1, Math.max(0, p.y));
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    const area = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
    const d = Math.hypot((x0 + x1) / 2 - 0.5, (y0 + y1) / 2 - 0.5) / Math.SQRT1_2; // 0 centre … 1 corner
    const score = area * (1 - 0.5 * d);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/** 33 × (x, y, z, visibility); a missing visibility reads as 0 so gating stays conservative. */
export function toPose33(pose: readonly NormalizedLandmark[]): Float32Array {
  const out = new Float32Array(N_POSE_POINTS * 4);
  for (let i = 0; i < N_POSE_POINTS; i++) {
    const p = pose[i];
    if (!p) continue;
    out[i * 4] = p.x;
    out[i * 4 + 1] = p.y;
    out[i * 4 + 2] = p.z;
    out[i * 4 + 3] = Number.isFinite(p.visibility) ? p.visibility : 0;
  }
  return out;
}

/**
 * Box-filter a 0..1 float mask (row-major, row 0 = top) to ≈ `longEdge` on its long side as 0..255. Each output
 * texel averages the source texels it covers, so thin limbs keep their proportional coverage instead of aliasing.
 * Returns null when the mask is essentially empty (a GPU readback that failed silently).
 */
export function downscaleMask(src: Float32Array, sw: number, sh: number, longEdge = MASK_LONG_EDGE): PersonMask | null {
  let confident = 0;
  for (let i = 0; i < src.length; i++) if (src[i] > 0.5) confident++;
  if (confident < MASK_MIN_COVERAGE * sw * sh) return null;
  const [dw, dh] = fitLongEdge(sw, sh, longEdge);
  const data = new Uint8Array(dw * dh);
  const colStart = new Int32Array(dw + 1);
  for (let x = 0; x <= dw; x++) colStart[x] = Math.floor((x * sw) / dw);
  for (let y = 0; y < dh; y++) {
    const sy0 = Math.floor((y * sh) / dh);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const sx0 = colStart[x];
      const sx1 = Math.max(sx0 + 1, colStart[x + 1]);
      let sum = 0;
      for (let yy = sy0; yy < sy1; yy++) {
        const row = yy * sw;
        for (let xx = sx0; xx < sx1; xx++) sum += src[row + xx];
      }
      const v = sum / ((sy1 - sy0) * (sx1 - sx0));
      data[y * dw + x] = Math.round(Math.min(1, Math.max(0, v)) * 255);
    }
  }
  return { width: dw, height: dh, data };
}

/** An Emscripten abort (a WebAssembly.RuntimeError, or the same text rethrown as an Error) kills the whole module. */
export function isWasmAbort(e: unknown): boolean {
  if (typeof WebAssembly !== 'undefined' && e instanceof WebAssembly.RuntimeError) return true;
  return e instanceof Error && /\bAborted\(/.test(e.message);
}

/** Assemble a BodyDetection from a raw result; `width`/`height` are the original image's pixel size. */
export function toDetection(
  result: Pick<PoseLandmarkerResult, 'landmarks' | 'segmentationMasks'>,
  width: number,
  height: number,
): BodyDetection | null {
  const all = result.landmarks;
  const valid = all.map((p, i) => [p, i] as const).filter(([p]) => p.length >= N_POSE_POINTS);
  if (!valid.length) return null;
  const [pose, idx] = valid[selectPerson(valid.map(([p]) => p))];
  const mpMask = result.segmentationMasks?.[idx];
  let mask: PersonMask | null = null;
  if (mpMask && mpMask.width > 0 && mpMask.height > 0) {
    mask = downscaleMask(mpMask.getAsFloat32Array(), mpMask.width, mpMask.height);
  }
  return { pose: { points: toPose33(pose) }, mask, people: valid.length, width, height };
}

// ───────────────────────── tracker ─────────────────────────

function sourceSize(img: DetectInput | HTMLVideoElement): [number, number] {
  if (typeof HTMLVideoElement !== 'undefined' && img instanceof HTMLVideoElement) return [img.videoWidth, img.videoHeight];
  if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) {
    return img.complete ? [img.naturalWidth, img.naturalHeight] : [0, 0];
  }
  return [img.width, img.height];
}

function create2d(): { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: Canvas2D } {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
  const ctx = canvas.getContext('2d', { alpha: false }) as Canvas2D | null;
  if (!ctx) throw new Error('bodyTracker: no 2D canvas context');
  return { canvas, ctx };
}

interface Instance {
  landmarker: PoseLandmarker;
  delegate: Delegate;
  masks: boolean;
  /** MediaPipe's own context on our canvas (GPU only), polled with isContextLost() */
  gl: WebGL2RenderingContext | null;
  lost: boolean;
  released: boolean;
}

async function createInstance(
  fileset: Fileset,
  modelBuffer: Uint8Array,
  delegate: Delegate,
  masks: boolean,
  mode: Mode,
): Promise<Instance> {
  const options: PoseLandmarkerOptions = {
    // kept by reference and re-read on every setOptions graph rebuild: never mutate the buffer afterwards
    baseOptions: { modelAssetBuffer: modelBuffer, delegate },
    runningMode: mode,
    numPoses: 2,
    outputSegmentationMasks: masks,
  };
  // a fresh canvas per instance: a task's canvas cannot be reset, and it lets us watch the GPU context
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : undefined;
  if (canvas) options.canvas = canvas;
  const landmarker = await PoseLandmarker.createFromOptions(fileset, options);
  const inst: Instance = { landmarker, delegate, masks, gl: null, lost: false, released: false };
  if (canvas && delegate === 'GPU') {
    canvas.addEventListener('webglcontextlost', () => {
      inst.lost = true;
    });
    try {
      inst.gl = canvas.getContext('webgl2'); // same type as MediaPipe's: returns its existing context
    } catch {
      inst.gl = null;
    }
  }
  return inst;
}

function release(inst: Instance): void {
  if (inst.released) return;
  inst.released = true;
  try {
    inst.landmarker.close();
  } catch (e) {
    console.warn('[bodyTracker] close', e); // a lost context can make close() throw
  }
}

type State = 'LIVE' | 'REPLACING' | 'STALLED' | 'CLOSED';

export async function createBodyTracker(opts: BodyTrackerOptions): Promise<BodyTracker> {
  const fileset = await FilesetResolver.forVisionTasks(opts.wasmBase);
  const want = resolveDelegate(opts);
  let mode: Mode = opts.runningMode ?? 'IMAGE';
  const build = (delegate: Delegate, masks: boolean) => createInstance(fileset, opts.modelBuffer, delegate, masks, mode);

  /** (b) sticky: every creation is the CPU graph without masks (startup GPU build failure, or detect-time evidence) */
  let cpuOnly = false;
  // the first creation is the capability probe: GPU → CPU in the same call (header (b))
  let first: Instance;
  try {
    first = await build(want.delegate, want.masks);
  } catch (e) {
    if (want.delegate === 'CPU') throw e;
    console.warn('[bodyTracker] GPU graph failed, falling back to CPU without person masks', e);
    cpuOnly = true;
    first = await build('CPU', false);
  }

  let state: State = 'LIVE';
  /** the live instance; null outside LIVE (c) */
  let inst: Instance | null = first;
  let delegate: Delegate = first.delegate;
  const frame = create2d();
  let needsRebuild = false;
  let lastTs = -Infinity;
  /** consecutive failed inferences of the live instance */
  let failures = 0;
  /** (a) instances retired since the last completed inference */
  let replacements = 0;
  /** (b) escalations of a GPU mask graph while !gpuProven */
  let gpuEscalations = 0;
  /** (b) a GPU graph read a mask back on this device */
  let gpuProven = false;
  /** (b) consecutive failed GPU builds of replacements (0 after any successful build) */
  let gpuBuildFailures = 0;
  /** (d) entries into STALLED since the last completed inference */
  let strikes = 0;
  let stalledAt = -Infinity;
  let stallCause: unknown = null;
  /** the error that retired the last instance (null: a lost GPU context), reported as `trigger` */
  let trigger: unknown = null;
  const retryWait = () => Math.min(CREATE_RETRY_MAX_MS, CREATE_RETRY_MS * 2 ** (strikes - 1));

  const nextGraph = (): [Delegate, boolean] => {
    if (cpuOnly) return ['CPU', false];
    if (want.delegate === 'GPU' && gpuBuildFailures >= GPU_CREATE_TRIES) return ['CPU', false]; // degraded
    return [want.delegate, want.masks];
  };

  /** → STALLED (d): no instance, no creation until retryWait() has elapsed. */
  const stall = (cause: unknown): void => {
    state = 'STALLED';
    strikes++;
    stalledAt = performance.now();
    stallCause = cause;
  };

  /** STALLED/retired → REPLACING: one creation (one heap), only from a state without an instance (e). */
  const startCreation = (): void => {
    const [d, m] = nextGraph();
    state = 'REPLACING';
    build(d, m).then(
      (next) => {
        if (state === 'CLOSED') {
          release(next);
          return;
        }
        state = 'LIVE';
        inst = next;
        delegate = next.delegate;
        needsRebuild = false; // created in `mode`
        failures = 0;
        gpuBuildFailures = 0;
        stallCause = null;
        trigger = null;
      },
      (e: unknown) => {
        if (state === 'CLOSED') return;
        if (d === 'GPU') gpuBuildFailures++;
        stall(e);
        console.warn(`[bodyTracker] replacement (${d}) failed, next try in ${retryWait()} ms`, e);
      },
    );
  };

  /** LIVE → release the instance first (c), then REPLACING under the cap (a), else STALLED (d). */
  const retire = (why: unknown, cause: unknown): Error => {
    release(inst!);
    inst = null;
    failures = 0;
    trigger = why;
    if (replacements < MAX_ESCALATIONS) {
      replacements++;
      startCreation();
      return new BodyTrackerRecovering();
    }
    stall(cause);
    console.warn(`[bodyTracker] replacement cap reached, next try in ${retryWait()} ms`, cause);
    return new BodyTrackerUnavailable(cause, why);
  };

  /** Downscaled copy on our 2D canvas: consistent sizes for the delegate and a bounded inference cost. */
  const prepare = (img: DetectInput | HTMLVideoElement, sw: number, sh: number): OffscreenCanvas | HTMLCanvasElement => {
    const [w, h] = fitLongEdge(sw, sh, BODY_INPUT_MAX_EDGE);
    if (frame.canvas.width !== w || frame.canvas.height !== h) {
      frame.canvas.width = w;
      frame.canvas.height = h;
    }
    frame.ctx.drawImage(img, 0, 0, w, h);
    return frame.canvas;
  };

  const run = (target: Mode, img: DetectInput | HTMLVideoElement, ts: number): BodyDetection | null => {
    if (state === 'CLOSED') throw new Error('bodyTracker: closed');
    if (state === 'LIVE' && (inst!.lost || inst!.gl?.isContextLost())) {
      console.warn('[bodyTracker] GPU context lost, replacing the instance');
      throw retire(null, new Error('bodyTracker: GPU context lost'));
    }
    if (state === 'REPLACING') throw new BodyTrackerRecovering();
    if (state === 'STALLED') {
      const since = performance.now() - stalledAt;
      // since < 0 (a clock that went backwards) counts as elapsed rather than freezing the slot
      if (since >= 0 && since < retryWait()) throw new BodyTrackerUnavailable(stallCause, trigger);
      startCreation();
      throw new BodyTrackerRecovering();
    }
    const live = inst!;
    const [sw, sh] = sourceSize(img);
    if (!sw || !sh) return null;
    if (needsRebuild || mode !== target) {
      // no model asset in the options → MediaPipe rebuilds the graph synchronously (its promise is already settled)
      needsRebuild = false;
      mode = target;
      void live.landmarker.setOptions({ runningMode: target }).catch((e: unknown) => console.warn('[bodyTracker] setOptions', e));
    }
    const input = prepare(img, sw, sh);
    let det: BodyDetection | null;
    try {
      const result = target === 'IMAGE' ? live.landmarker.detect(input) : live.landmarker.detectForVideo(input, ts);
      try {
        // the mask readback (getAsFloat32Array → readPixels FLOAT) is a GPU failure point too
        det = toDetection(result, sw, sh);
      } finally {
        result.close();
      }
    } catch (e) {
      throw failed(live, e);
    }
    // a completed inference ("no person" included): the instance works, (a) and (d) start over
    failures = 0;
    replacements = 0;
    strikes = 0;
    if (live.delegate === 'GPU' && det?.mask) gpuProven = true; // only a mask read back proves the mask path (b)
    return det;
  };

  /** An inference failure on the live instance: rethrow (rebuild in place next call) or escalate (header). */
  const failed = (live: Instance, e: unknown): unknown => {
    needsRebuild = true;
    const aborted = isWasmAbort(e);
    if (!aborted && ++failures < ESCALATE_AFTER) return e;
    failures = 0;
    let toCpu = false;
    if (live.delegate === 'GPU' && live.masks && !gpuProven && !cpuOnly && ++gpuEscalations >= CPU_FALLBACK_AFTER) {
      toCpu = cpuOnly = true;
    }
    // beyond the cap a usable instance is kept: a fresh copy of the same graph fails the same way (a)
    if (!aborted && !toCpu && replacements >= MAX_ESCALATIONS) return e;
    console.warn(`[bodyTracker] detect keeps failing, replacing the instance${toCpu ? ' (CPU, no masks, from now on)' : ''}`, e);
    return retire(e, e);
  };

  return {
    variant: opts.variant,
    get delegate() {
      return delegate;
    },
    detect: (image) => run('IMAGE', image, 0),
    detectVideo: (video, tsMs) => {
      // strictly increasing timestamps or MediaPipe rejects the packet (and poisons the graph)
      const ts = tsMs > lastTs ? tsMs : lastTs + 1;
      lastTs = ts;
      return run('VIDEO', video, ts);
    },
    close: () => {
      if (state === 'CLOSED') return;
      state = 'CLOSED';
      if (inst) release(inst);
      inst = null;
    },
  };
}
