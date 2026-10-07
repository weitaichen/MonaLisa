// OWNER: media agent. Engine binaries download with progress (spec §9, RB §4 "Model and asset caching").
import type { EngineAssetsProgress } from '../types';

export const ENGINE_PATHS = {
  wasmBase: '/mediapipe/0.10.35',
  wasmFile: '/mediapipe/0.10.35/vision_wasm_internal.wasm',
  wasmLoader: '/mediapipe/0.10.35/vision_wasm_internal.js',
  model: '/models/face_landmarker/float16-1/face_landmarker.task',
} as const;

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
let memo: Promise<{ modelBuffer: Uint8Array }> | null = null;
let lastProgress: EngineAssetsProgress | null = null;

/**
 * Fetch model (+ warm the wasm and its loader script into HTTP/SW cache) with progress, so 'done' means every file
 * an offline tracker start needs has been requested. Validated binaries are also written to ENGINE_CACHE when no
 * service worker controls the page, and older engine versions are pruned from it. Memoised: concurrent callers share one download.
 * `loaded`/`total` are bytes of the current phase ('done' carries the sum of both phases). A caller joining late
 * immediately receives the latest event. A failed download clears the memo, so calling again retries.
 */
export function loadEngineAssets(
  onProgress?: (p: EngineAssetsProgress) => void,
): Promise<{ modelBuffer: Uint8Array }> {
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

async function download(): Promise<{ modelBuffer: Uint8Array }> {
  requestPersistence();
  const stash = stashTarget();
  const model = await fetchWithProgress(ENGINE_PATHS.model, 'model', true, stash);
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
  const sum = model.loaded + wasmBytes;
  emit({ phase: 'done', loaded: sum, total: sum });
  return { modelBuffer: model.bytes };
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
  return path === ENGINE_PATHS.model || path.startsWith(`${ENGINE_PATHS.wasmBase}/`);
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
    emit({ phase, loaded: 0, total });
    // the copy for Cache Storage must be taken before the body is read; it is stored only once validated
    const copy = stash ? res.clone() : null;

    if (!res.body) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength === 0) throw new Error(`${url}: empty response`);
      emit({ phase, loaded: bytes.byteLength, total: bytes.byteLength });
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
        emit({ phase, loaded, total });
      }
    }
    if (total && loaded !== total) throw new Error(`${url}: truncated (${loaded}/${total} B)`);
    if (loaded === 0) throw new Error(`${url}: empty response`);
    emit({ phase, loaded, total: loaded });
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
