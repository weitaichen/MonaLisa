// OWNER: media agent. Engine binaries download with progress (spec §9, RB §4 "Model and asset caching").
import type { EngineAssetsProgress } from '../types';
import { isFaceDetectorModel, withoutBlendshapes } from './faceBundle';

export const ENGINE_PATHS = {
  wasmBase: '/mediapipe/0.10.35',
  wasmFile: '/mediapipe/0.10.35/vision_wasm_internal.wasm',
  wasmLoader: '/mediapipe/0.10.35/vision_wasm_internal.js',
  model: '/models/face_landmarker/float16-1/face_landmarker.task',
  /** BlazeFace full-range, swapped into `model` for photos (faceBundle.ts, tracker.ts); 1,083,786 B (loadPhotoDetector) */
  photoDetector: '/models/face_detector/full-range-float16-1/blaze_face_full_range.tflite',
} as const;

export interface EngineModels {
  /**
   * The camera bundle: face_landmarker.task (BlazeFace short-range) without face_blendshapes.tflite, which the tracker
   * never runs (faceBundle.ts withoutBlendshapes, 2,803,159 B); as shipped (logged) when it is not a stored zip. The
   * camera, and photos while the full-range detector (loadPhotoDetector) is not there.
   */
  modelBuffer: Uint8Array;
}

/**
 * Cache Storage bucket of the engine binaries. vite.config.ts names the service worker's CacheFirst route
 * with the same string, so a copy stashed here by the page is what the SW serves offline later.
 */
export const ENGINE_CACHE = 'meiyan-engine-v1';

/** A download that delivers no bytes for this long is aborted, so the UI can offer 重試 instead of hanging. */
export const STALL_TIMEOUT_MS = 30_000;
/** Progress callbacks are throttled to this interval (the first and last event of a phase always fire). */
export const PROGRESS_INTERVAL_MS = 100;

type Listener = (p: EngineAssetsProgress) => void;

const listeners = new Set<Listener>();
let memo: Promise<EngineModels> | null = null;
let lastProgress: EngineAssetsProgress | null = null;

/**
 * Fetch model (+ warm the wasm and its loader script into HTTP/SW cache) with progress, so 'done' means every file
 * an offline tracker start needs has been requested. The full-range photo detector (loadPhotoDetector) downloads
 * alongside the model and counts in the model phase's bar, but nothing waits for it: the camera never runs it, so a
 * slow or failed detector holds neither 'done' nor the camera start (step-1 spec §6.5). Validated binaries are also
 * written to ENGINE_CACHE when no service worker controls the page, and older engine versions are pruned from it.
 * Memoised: concurrent callers share one download.
 * `loaded`/`total` are bytes of the current phase (the model phase: the model and the detector once it answered; 'done'
 * carries the sum of every file that finished, the detector included when it was in by then). A caller joining late
 * immediately receives the latest event. A failed download clears the memo, so calling again retries.
 */
export function loadEngineAssets(onProgress?: (p: EngineAssetsProgress) => void): Promise<EngineModels> {
  if (onProgress) {
    listeners.add(onProgress);
    if (lastProgress) deliver(onProgress, lastProgress);
  }
  if (!memo) {
    const run = download();
    memo = run;
    run.catch(() => {
      if (memo === run) {
        memo = null;
        lastProgress = null;
      }
    });
  }
  if (!onProgress) return memo;
  return memo.finally(() => listeners.delete(onProgress));
}

async function download(): Promise<EngineModels> {
  requestPersistence();
  const stash = stashTarget();
  // the model phase's bar: the model's bytes plus the detector's from its first progress event (a detector that fails
  // leaves it); detector events after the model phase reach nobody here
  let modelPart = { loaded: 0, total: 0 };
  let detectorPart: { loaded: number; total: number } | null = null;
  let detectorDone = 0;
  let modelPhase = true;
  const showModel = () => {
    if (!modelPhase) return;
    const d = detectorPart;
    const known = modelPart.total > 0 && (!d || d.total > 0);
    emit({ phase: 'model', loaded: modelPart.loaded + (d?.loaded ?? 0), total: known ? modelPart.total + (d?.total ?? 0) : 0 });
  };
  const modelP = fetchWithProgress(ENGINE_PATHS.model, 'model', true, stash, (p) => {
    modelPart = { loaded: p.loaded, total: p.total };
    showModel();
  });
  // started right after the model request (one bar for both), never awaited
  loadPhotoDetector((p) => {
    detectorPart = { loaded: p.loaded, total: p.total };
    showModel();
  }).then(
    (bytes) => {
      detectorDone = bytes.byteLength;
    },
    () => {
      detectorPart = null;
      showModel();
    },
  );
  let model: Fetched;
  try {
    model = await modelP;
  } finally {
    modelPhase = false;
  }
  let modelBuffer = model.bytes;
  try {
    modelBuffer = withoutBlendshapes(model.bytes);
  } catch (e) {
    console.warn('[assets] the face model is not a stored zip: the camera runs it as shipped', e);
  }
  let wasmBytes = 0;
  try {
    // MediaPipe fetches the wasm itself (FilesetResolver); this only warms the SW/HTTP cache with progress.
    wasmBytes = (await fetchWithProgress(ENGINE_PATHS.wasmFile, 'wasm', false, stash)).loaded;
  } catch (e) {
    console.warn('[assets] wasm warm-up failed (MediaPipe will fetch it itself)', e);
  }
  try {
    // MediaPipe adds the loader as a <script> only when a tracker is created; the download may run without one
    // (idle prefetch from Home), so request it here too or an offline first camera start falls back to 基本模式.
    await warmLoader(stash);
  } catch (e) {
    console.warn('[assets] wasm loader warm-up failed (MediaPipe will fetch it itself)', e);
  }
  // Best-effort and not awaited: the download is done whether or not Cache Storage cooperates.
  pruneStale().catch(() => {});
  const sum = model.loaded + detectorDone + wasmBytes;
  emit({ phase: 'done', loaded: sum, total: sum });
  return { modelBuffer };
}

// ───────────── the photo detector: BlazeFace full-range (photos only, step-1 spec §6.5) ─────────────

const detectorJob: ModelJob = { memo: null, listeners: new Set(), last: null };

/**
 * Fetch the full-range face detector with progress (phase 'model', then 'done'), memoised. A failure (HTTP error, HTML
 * fallback, truncated, stalled, or not a TFLite model) is logged and clears the memo, so the next call fetches again:
 * a failed download is never kept as the answer. The engine download starts it beside the model; services.ts asks for
 * it again whenever a photo switches the tracker to it (or the editor opens one), and lets a photo wait for the first
 * download only, briefly (DETECTOR_WAIT_MS). Stashed in ENGINE_CACHE (no service worker) like the engine binaries, so
 * photos detect full-range offline once this file itself has downloaded once (the engine's 'done' does not wait for it).
 */
export function loadPhotoDetector(onProgress?: (p: EngineAssetsProgress) => void): Promise<Uint8Array> {
  const job = detectorJob;
  if (onProgress) {
    job.listeners.add(onProgress);
    if (job.last) deliver(onProgress, job.last);
  }
  if (!job.memo) {
    const run = downloadDetector(job);
    job.memo = run;
    run.catch((e: unknown) => {
      console.warn('[assets] full-range face detector unavailable, photos use the short-range detector for now', e);
      if (job.memo === run) {
        job.memo = null;
        job.last = null;
      }
    });
  }
  if (!onProgress) return job.memo;
  return job.memo.finally(() => job.listeners.delete(onProgress));
}

async function downloadDetector(job: ModelJob): Promise<Uint8Array> {
  const report = (p: EngineAssetsProgress) => {
    job.last = p;
    for (const cb of [...job.listeners]) deliver(cb, p);
  };
  const d = await fetchWithProgress(ENGINE_PATHS.photoDetector, 'model', true, stashTarget(), report);
  if (!isFaceDetectorModel(d.bytes)) throw new Error(`${ENGINE_PATHS.photoDetector}: not a TFLite model`);
  report({ phase: 'done', loaded: d.loaded, total: d.loaded });
  return d.bytes;
}

// ───────────── Cache Storage (offline engine) ─────────────

/**
 * The page writes the engine binaries (model, wasm, wasm loader) into ENGINE_CACHE itself only while no service
 * worker controls it (the first session before clientsClaim lands, a SW that failed to install): a controlled
 * page's fetches already go through the SW's CacheFirst route, which stores them. All three are fetched either way.
 */
function stashTarget(): boolean {
  try {
    if (typeof caches === 'undefined') return false;
    return !(typeof navigator !== 'undefined' && navigator.serviceWorker?.controller);
  } catch {
    return false;
  }
}

function stashResponse(url: string, res: Response): void {
  try {
    caches
      .open(ENGINE_CACHE)
      .then((c) => c.put(url, res))
      .catch((e: unknown) => console.warn(`[assets] could not cache ${url}`, e));
  } catch (e) {
    console.warn(`[assets] could not cache ${url}`, e);
  }
}

/**
 * MediaPipe loads the wasm loader script itself; fetch it so an offline launch finds it too. Uncontrolled page:
 * stash the response. Controlled page: drain the body, so the SW's CacheFirst route stores it.
 */
async function warmLoader(stash: boolean): Promise<void> {
  const url = ENGINE_PATHS.wasmLoader;
  const ac = new AbortController();
  const stall = setTimeout(() => ac.abort(new Error(`${url}: stalled for ${STALL_TIMEOUT_MS} ms`)), STALL_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) return;
    if (stash) stashResponse(url, res);
    else await res.arrayBuffer();
  } finally {
    clearTimeout(stall);
  }
}

/** Entries of older engine versions (versioned paths) are never requested again: free the space. */
function isCurrent(path: string): boolean {
  return (
    path === ENGINE_PATHS.model ||
    path === ENGINE_PATHS.photoDetector ||
    path.startsWith(`${ENGINE_PATHS.wasmBase}/`) ||
    (Object.values(POSE_MODELS) as string[]).includes(path) ||
    path === SEGMENTER_MODEL
  );
}

async function pruneStale(): Promise<void> {
  if (typeof caches === 'undefined' || !(await caches.has(ENGINE_CACHE))) return;
  const c = await caches.open(ENGINE_CACHE);
  for (const req of await c.keys()) {
    const path = new URL(req.url, 'http://x').pathname;
    if ((path.startsWith('/mediapipe/') || path.startsWith('/models/')) && !isCurrent(path)) await c.delete(req);
  }
}

interface Fetched {
  loaded: number;
  bytes: Uint8Array;
}

async function fetchWithProgress(
  url: string,
  phase: 'model' | 'wasm',
  keep: boolean,
  stash: boolean,
  report: (p: EngineAssetsProgress) => void = emit,
): Promise<Fetched> {
  const ac = new AbortController();
  let stall: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(stall);
    stall = setTimeout(() => ac.abort(new Error(`${url}: stalled for ${STALL_TIMEOUT_MS} ms`)), STALL_TIMEOUT_MS);
  };
  arm();
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    // A missing asset behind an SPA fallback answers 200 with index.html.
    if ((res.headers.get('content-type') ?? '').includes('text/html')) throw new Error(`${url}: got HTML, asset missing`);
    let total = declaredLength(res);
    report({ phase, loaded: 0, total });
    // the copy for Cache Storage must be taken before the body is read; it is stored only once validated
    const copy = stash ? res.clone() : null;

    if (!res.body) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength === 0) throw new Error(`${url}: empty response`);
      report({ phase, loaded: bytes.byteLength, total: bytes.byteLength });
      if (copy) stashResponse(url, copy);
      return { loaded: bytes.byteLength, bytes };
    }

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    let lastEmit = Date.now();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      arm();
      loaded += value.byteLength;
      if (keep) chunks.push(value);
      if (total && loaded > total) total = 0;
      const now = Date.now();
      if (now - lastEmit >= PROGRESS_INTERVAL_MS) {
        lastEmit = now;
        report({ phase, loaded, total });
      }
    }
    if (total && loaded !== total) throw new Error(`${url}: truncated (${loaded}/${total} B)`);
    if (loaded === 0) throw new Error(`${url}: empty response`);
    report({ phase, loaded, total: loaded });
    if (copy) stashResponse(url, copy);
    return { loaded, bytes: keep ? concat(chunks, loaded) : new Uint8Array(0) };
  } finally {
    clearTimeout(stall);
  }
}

/** Content-Length is the wire size; with a Content-Encoding it is not the decoded size, so report unknown. */
function declaredLength(res: Response): number {
  const enc = res.headers.get('content-encoding');
  if (enc && enc !== 'identity') return 0;
  const n = Number(res.headers.get('content-length'));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function concat(chunks: Uint8Array[], length: number): Uint8Array {
  if (chunks.length === 1 && chunks[0].byteLength === length) return chunks[0];
  const out = new Uint8Array(length);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

function emit(p: EngineAssetsProgress): void {
  lastProgress = p;
  for (const cb of [...listeners]) deliver(cb, p);
}

function deliver(cb: Listener, p: EngineAssetsProgress): void {
  try {
    cb(p);
  } catch (e) {
    console.error('[assets] progress callback threw', e);
  }
}

/** Ask for persistent storage in the installed app so iOS is less eager to evict the engine cache (RB §4). */
function requestPersistence(): void {
  try {
    const nav = navigator as Navigator & { standalone?: boolean };
    const standalone =
      nav.standalone === true ||
      (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);
    if (standalone) nav.storage?.persist?.().catch(() => {});
  } catch {
    // storage APIs can throw in locked-down contexts; persistence is only a hint
  }
}

// ───────────── 美體: pose models (OWNER: body-tracker agent) ─────────────

/** Self-hosted PoseLandmarker models (versioned paths → CacheFirst / immutable). */
export const POSE_MODELS = {
  full: '/models/pose_landmarker/full-float16-1/pose_landmarker_full.task',
  lite: '/models/pose_landmarker/lite-float16-1/pose_landmarker_lite.task',
} as const;

/**
 * Fetch a pose model with progress (phase 'model', then 'done'), memoised per variant; a failure clears the memo so a
 * later call retries. Downloaded on demand the first time 美體 is used (not part of the engine prefetch). Like the
 * engine binaries, a validated model is stashed in ENGINE_CACHE when no service worker controls the page, so the
 * SW's CacheFirst route serves it offline later. A caller joining late immediately receives the latest event.
 */
export function loadPoseModel(
  variant: keyof typeof POSE_MODELS,
  onProgress?: (p: EngineAssetsProgress) => void,
): Promise<Uint8Array> {
  const job = (poseJobs[variant] ??= { memo: null, listeners: new Set(), last: null });
  if (onProgress) {
    job.listeners.add(onProgress);
    if (job.last) deliver(onProgress, job.last);
  }
  if (!job.memo) {
    const run = downloadPose(variant, job);
    job.memo = run;
    run.catch(() => {
      if (job.memo === run) {
        job.memo = null;
        job.last = null;
      }
    });
  }
  if (!onProgress) return job.memo;
  return job.memo.finally(() => job.listeners.delete(onProgress));
}

/** one memoised model download with its own listeners (the pose models, the photo detector) */
interface ModelJob {
  memo: Promise<Uint8Array> | null;
  listeners: Set<Listener>;
  last: EngineAssetsProgress | null;
}

const poseJobs: Partial<Record<keyof typeof POSE_MODELS, ModelJob>> = {};

async function downloadPose(variant: keyof typeof POSE_MODELS, job: ModelJob): Promise<Uint8Array> {
  const report = (p: EngineAssetsProgress) => {
    job.last = p;
    for (const cb of [...job.listeners]) deliver(cb, p);
  };
  const model = await fetchWithProgress(POSE_MODELS[variant], 'model', true, stashTarget(), report);
  report({ phase: 'done', loaded: model.loaded, total: model.loaded });
  return model.bytes;
}

// ───────────── 瘦臉 background limit: person segmenter (on demand, photo editor only) ─────────────

/** Self-hosted ImageSegmenter selfie model, 249,537 B (versioned path → CacheFirst / immutable). */
export const SEGMENTER_MODEL = '/models/image_segmenter/selfie-float16-1/selfie_segmenter.tflite';

let segmenterMemo: Promise<Uint8Array> | null = null;

/**
 * Fetch the selfie segmenter model, memoised; a failure clears the memo so a later call retries. Downloaded the first
 * time the user moves a contour slider (瘦臉 / V臉 / 窄臉 / 下巴 / 額頭) on a photo without a cached 美體 person mask
 * (never for preset / default values: FaceProtectSource; not part of the engine prefetch); stashed in ENGINE_CACHE
 * like the pose models. No progress: it is small and nothing waits on it (the unlimited warp shows meanwhile).
 */
export function loadSegmenterModel(): Promise<Uint8Array> {
  if (!segmenterMemo) {
    const run = fetchWithProgress(SEGMENTER_MODEL, 'model', true, stashTarget(), () => {}).then((m) => m.bytes);
    segmenterMemo = run;
    run.catch(() => {
      if (segmenterMemo === run) segmenterMemo = null;
    });
  }
  return segmenterMemo;
}
