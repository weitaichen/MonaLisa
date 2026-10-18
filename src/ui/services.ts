// Session-wide singletons: the display canvas, one Engine, one Tracker, one CameraController,
// the engine-asset download, (美體, on demand) one BodyTracker and (瘦臉 background limit, on demand) one person
// segmenter. Exposed as an observable store so screens can show loading / error states instead of failing silently.
import type { EngineModels } from '../engine/assets';
import type { PersonSegmenter } from '../tracking/segmenter';
import type { BodyTracker, CameraController, Engine, EngineAssetsProgress, Prefs, Tracker, TrackerState } from '../types';
import { debug, errorText, reportError } from './debug';
import { deps } from './deps';
import { createStore } from './store';

export interface EngineBundle {
  engine: Engine;
  /** null → 基本模式 (skin + filter only, no face effects) */
  tracker: Tracker | null;
  basic: boolean;
}

export type AssetsState =
  | { state: 'idle' }
  | { state: 'loading'; progress: EngineAssetsProgress | null }
  | { state: 'done' }
  /** message: the raw error (kept as a diagnostic) · hint: a friendly 繁中 reason */
  | { state: 'error'; message: string; hint: string };

export type EngineState =
  | { state: 'idle' }
  | { state: 'loading'; step: 'engine' | 'assets' | 'tracker' }
  | { state: 'ready'; bundle: EngineBundle; note: string | null }
  | { state: 'error'; message: string; /** assets failed → 基本模式 is possible */ canBasic: boolean }
  | { state: 'unsupported' };

/** The 美體 pose tracker: created on demand (first use of the 美體 tab), once per session. */
export type BodyTrackerState =
  | { state: 'idle' }
  /** model: downloading the pose model (progress 0..1, null = unknown) · tracker: waiting for / creating the graph */
  | { state: 'loading'; step: 'model' | 'tracker'; progress: number | null }
  | { state: 'ready' }
  /** retryable: the next ensureBodyTracker starts over (a downloaded model is reused) */
  | { state: 'error'; message: string; hint: string };

interface ServicesState {
  assets: AssetsState;
  body: BodyTrackerState;
  engine: EngineState;
  /** WebGL context lost and not yet restored */
  lost: boolean;
  /**
   * Health of the current bundle's tracker (src/tracking/tracker.ts heals itself): 'lost' while it
   * replaces a dead graph, 'failed' when automatic retries gave up (a later detect call retries).
   */
  tracker: TrackerState;
  /**
   * The full-range photo detector's bytes are in (step-1 spec §6.5): set by the download that brought them, whoever
   * started it (the engine download, a photo's tracker switch, an editor's ask, a retry after a 5xx or a captive
   * portal), so the editor completes a short-range answer whichever request lands (round 4: it heard only its own asks)
   */
  photoDetector: boolean;
  /** the single display canvas (replaced only when a lost context never comes back) */
  canvas: HTMLCanvasElement;
}

function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.className = 'display-canvas';
  c.addEventListener('webglcontextlost', () => svc.set({ lost: true }));
  c.addEventListener('webglcontextrestored', () => svc.set({ lost: false }));
  return c;
}

export const svc = createStore<ServicesState>({
  assets: { state: 'idle' },
  body: { state: 'idle' },
  engine: { state: 'idle' },
  lost: false,
  tracker: 'ok',
  photoDetector: false,
  canvas: null as unknown as HTMLCanvasElement,
});
svc.set({ canvas: makeCanvas() });

let getPrefs: () => Prefs = () => {
  throw new Error('services: prefs source not bound');
};
/** app.tsx binds the prefs source once (avoids an import cycle with state.ts). */
export function bindPrefs(fn: () => Prefs): void {
  getPrefs = fn;
}

// ───────────── WebGL2 support ─────────────

/** false only when the engine positively reports no WebGL2; an unknown answer (throw) counts as supported. */
export function webgl2Supported(): boolean {
  try {
    return deps.isWebGL2Supported();
  } catch (e) {
    reportError(e, 'isWebGL2Supported');
    return true;
  }
}

// ───────────── engine assets (model + wasm warm-up) ─────────────

/** A friendly reason for an engine-download failure (engine/assets.ts errors and fetch TypeErrors). */
export function downloadHint(e: unknown): string {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return '目前沒有網路連線，請連上網路後重試';
  // a network failure: Chromium "Failed to fetch", WebKit "Load failed"
  if (e instanceof TypeError) return '網路連線不穩，請確認網路後重試';
  const msg = errorText(e);
  if (/stalled/.test(msg)) return '下載逾時，請確認網路後重試';
  if (/HTTP 5\d\d/.test(msg)) return '伺服器暫時無法回應，請稍後重試';
  if (/HTTP \d+|got HTML/.test(msg)) return '找不到引擎檔案，請稍後重試或重新開啟 App';
  if (/truncated|empty response/.test(msg)) return '下載不完整，請重試';
  return '請確認網路後重試';
}

let assetsP: Promise<EngineModels> | null = null;
let lastPct = -1;

/**
 * The engine download (the camera bundle, the wasm and its loader), memoised until it fails. It also starts the photo
 * detector's download, which nothing here waits for; ensurePhotoDetector joins it at once, so that request is the
 * session's first (photoDetectorPending): when it fails before 'done', the request 'done' starts is a retry.
 */
export function prefetchAssets(): Promise<EngineModels> {
  if (assetsP) return assetsP;
  lastPct = -1;
  svc.set({ assets: { state: 'loading', progress: null } });
  const onProgress = (p: EngineAssetsProgress) => {
    // throttle store churn: one update per whole percent (or per 256 KB when total is unknown)
    const pct = p.total > 0 ? Math.floor((p.loaded / p.total) * 100) : Math.floor(p.loaded / 262144);
    if (pct === lastPct && p.phase !== 'done') return;
    lastPct = pct;
    if (svc.get().assets.state === 'loading') svc.set({ assets: { state: 'loading', progress: p } });
  };
  let p: Promise<EngineModels>;
  try {
    p = deps.loadEngineAssets(onProgress);
  } catch (e) {
    p = Promise.reject(e);
  }
  // joins the detector request the engine download has just started (loadPhotoDetector is memoised), so services
  // counts that request as the session's first: a failure of it before 'done' is the first attempt failing (D1, a
  // photo then waits for no retry), not something services never saw
  void ensurePhotoDetector();
  const run = p.then(
    (r) => {
      svc.set({ assets: { state: 'done' } });
      // the detector is in, or still downloading (joined), or its request failed: asked again, so its bytes may be
      // there before the first photo (a retry, which no photo waits for)
      void ensurePhotoDetector();
      return r;
    },
    (e: unknown) => {
      assetsP = null;
      svc.set({ assets: { state: 'error', message: reportError(e, 'loadEngineAssets'), hint: downloadHint(e) } });
      throw e;
    },
  );
  assetsP = run;
  return run;
}

// ───────────── the full-range photo detector (step-1 spec §6.5) ─────────────

/**
 * How long a photo's face detection waits for the full-range detector's first download of the session (D1, step-1
 * spec §6.5): 3 s, once per session. The 1.08 MB file has been downloading since the engine started (beside the model),
 * and a link that delivers it in about 3 s more (≥ 3 Mbit/s) brings it in while the editor's spinner shows anyway, the
 * first full-range photo costing about 1.4–3 s of GPU compile on the desktop besides (§6.5). Past it the photo detects
 * with what is there at once: a slow link is not allowed to hold a photo on 「正在分析臉部…」 for the download's stall
 * bound (STALL_TIMEOUT_MS of silence per chunk, unbounded while bytes trickle in). The budget starts with the first wait
 * and is shared: a photo opened later waits only for what is left of it. A retry after a failed download is never
 * waited for. A photo detected meanwhile is marked short-range and picks up its missing faces once the detector is in:
 * in the open it lands in, or at a later open (§6.5). A photo drawn from its cache waits for nothing.
 */
export const DETECTOR_WAIT_MS = 3000;

/** the detector's bytes once downloaded; null: not yet, or the last attempt failed */
let photoDetector: Uint8Array | null = null;
let photoDetectorP: Promise<Uint8Array | null> | null = null;
/**
 * the session's first download attempt while it is in flight (the only one a detection waits for, D1); null after. The
 * engine download's own request (prefetchAssets joins it), or a photo's when it comes first
 */
let firstDetectorP: Promise<Uint8Array | null> | null = null;
/** the first attempt has been made (it may have settled since) */
let detectorTried = false;
/** Date.now() past which no detection waits for the first download any more: the first wait + DETECTOR_WAIT_MS */
let detectorWaitEnd: number | null = null;

/**
 * The full-range face detector photos detect with (engine/assets.ts loadPhotoDetector), never rejecting: null =
 * unavailable for now (photos detect short-range meanwhile). A failed attempt is not kept: the next call retries, and
 * calls come from every photo (the tracker reads fullRangeDetector at each switch to a photo). The camera never needs it.
 */
export function ensurePhotoDetector(): Promise<Uint8Array | null> {
  if (photoDetector) return Promise.resolve(photoDetector);
  if (photoDetectorP) return photoDetectorP;
  let p: Promise<Uint8Array>;
  try {
    p = deps.loadPhotoDetector();
  } catch (e) {
    p = Promise.reject(e);
  }
  // (loadPhotoDetector logs its own failures)
  const run = p.then(
    (bytes) => {
      photoDetector = bytes;
      // whoever asked: the editor follows the store, not its own requests (svc.photoDetector)
      svc.set({ photoDetector: true });
      return bytes;
    },
    () => null,
  );
  photoDetectorP = run;
  const first = !detectorTried;
  detectorTried = true;
  if (first) firstDetectorP = run;
  void run.then(() => {
    if (photoDetectorP === run) photoDetectorP = null;
    if (firstDetectorP === run) firstDetectorP = null;
  });
  return run;
}

/** TrackerOptions.fullRangeDetector of every tracker build: the bytes, or null and a retry in the background */
function fullRangeDetector(): Uint8Array | null {
  if (!photoDetector) void ensurePhotoDetector();
  return photoDetector;
}

/**
 * What a face detection about to run waits for (D1): the session's first detector download while it is in flight, for
 * what is left of DETECTOR_WAIT_MS since the first wait; it settles then or when the download does, and never rejects.
 * null (detect at once): the detector is in, the first attempt failed (its retries are never waited for), or the budget
 * is spent. Starts the first download when nothing has asked for it yet.
 */
export function photoDetectorPending(): Promise<void> | null {
  if (photoDetector) return null;
  if (!detectorTried) void ensurePhotoDetector();
  const first = firstDetectorP;
  if (!first) return null;
  const now = Date.now();
  detectorWaitEnd ??= now + DETECTOR_WAIT_MS;
  const left = detectorWaitEnd - now;
  if (left <= 0) return null;
  debug({ detectorWaits: (window.__meiyan?.detectorWaits ?? 0) + 1 });
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, left);
    void first.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Start the download on the first idle moment after launch (spec §7.2 Home). */
export function prefetchWhenIdle(): void {
  const start = () => {
    prefetchAssets().catch(() => {
      /* surfaced through svc.assets */
    });
  };
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
    .requestIdleCallback;
  if (ric) ric(start, { timeout: 2500 });
  else window.setTimeout(start, 1200);
}

// ───────────── engine + tracker ─────────────

let engine: Engine | null = null;
let engineP: Promise<EngineBundle> | null = null;
/** the one in-flight tracker (re)build, joined by ensureEngine / restartTracker instead of starting another */
let trackerP: Promise<EngineBundle> | null = null;
/** basic mode came from a createTracker failure (not the user's 基本模式 choice): a delegate change may retry */
let trackerFailed = false;
/**
 * The tracker of the current (or pending) bundle: the only one whose health reaches svc.tracker. Not tied to
 * the engine state, so a transition while recoverEngine reloads the engine (state 'loading') is kept.
 */
let liveTracker: Tracker | null = null;
/** the delegate pref the current bundle's tracker was built for (null: no tracker build, i.e. 基本模式) */
let trackerDelegate: Prefs['delegate'] | null = null;

function engineOptions(prefs: Prefs) {
  return { mirror: false, matchGpupixel: prefs.matchGpupixel, showLandmarks: prefs.showLandmarks };
}

function setEngineState(s: EngineState): void {
  svc.set({ engine: s });
}

/** Drop an engine whose `ready` rejected so the next ensureEngine builds a fresh one (same canvas → same context). */
function discardEngine(): void {
  try {
    engine?.dispose();
  } catch {
    /* already gone */
  }
  engine = null;
}

async function createTrackerSafe(
  models: EngineModels,
  delegate: Prefs['delegate'],
): Promise<{ tracker: Tracker | null; note: string | null }> {
  let created: Tracker | null = null;
  const onStateChange = (state: TrackerState) => {
    // only the tracker of the current bundle speaks for the UI (a replaced one is closed anyway); written even
    // while the engine is loading: the badge is drawn only once it is ready
    if (!created || created !== liveTracker) return;
    if (state === 'ok') debug({ delegate: created.delegate }); // an 'auto' rebuild may have fallen back to CPU
    svc.set({ tracker: state });
  };
  try {
    const tracker = await deps.createTracker({
      modelBuffer: models.modelBuffer,
      fullRangeDetector,
      wasmBase: deps.wasmBase,
      delegate,
      onStateChange,
    });
    created = tracker;
    debug({ delegate: tracker.delegate });
    return { tracker, note: null };
  } catch (e) {
    const msg = reportError(e, 'createTracker');
    debug({ delegate: null });
    return { tracker: null, note: `臉部偵測無法啟動，已切換為基本模式（${msg}）` };
  }
}

/** Build a tracker for the current delegate pref; if the pref changed while building, discard and rebuild. */
async function buildTracker(eng: Engine, models: EngineModels): Promise<EngineBundle> {
  for (;;) {
    const want = getPrefs().delegate;
    setEngineState({ state: 'loading', step: 'tracker' });
    const { tracker, note } = await createTrackerSafe(models, want);
    if (getPrefs().delegate !== want) {
      tracker?.close();
      continue;
    }
    trackerFailed = !tracker;
    const bundle: EngineBundle = { engine: eng, tracker, basic: !tracker };
    liveTracker = tracker;
    trackerDelegate = want; // even when it failed: a later delegate change is what retries it
    svc.set({ tracker: 'ok' });
    setEngineState({ state: 'ready', bundle, note });
    return bundle;
  }
}

/**
 * Resolve the shared engine (+ tracker). `basic` skips the model download and face tracking
 * (spec §8: offered when the engine assets fail to download).
 */
export function ensureEngine(basic = false): Promise<EngineBundle> {
  const cur = svc.get().engine;
  if (cur.state === 'ready') return Promise.resolve(cur.bundle);
  if (engineP) return engineP;
  if (trackerP) return trackerP;
  engineP = (async () => {
    if (!webgl2Supported()) {
      setEngineState({ state: 'unsupported' });
      throw new Error('此裝置不支援 WebGL2');
    }
    setEngineState({ state: 'loading', step: 'engine' });
    let modelP: Promise<EngineModels> | null = null;
    if (!basic) {
      modelP = prefetchAssets();
      modelP.catch(() => undefined); // awaited below; avoid an unhandled rejection meanwhile
    }
    let eng: Engine;
    try {
      if (!engine) engine = deps.createEngine(svc.get().canvas, engineOptions(getPrefs()));
      eng = engine;
      await eng.ready;
    } catch (e) {
      // `ready` is memoised per engine: keeping a rejected one would make every 重試 fail instantly
      discardEngine();
      setEngineState({ state: 'error', message: reportError(e, 'createEngine'), canBasic: false });
      throw e;
    }
    if (!modelP) {
      trackerFailed = false;
      liveTracker = null;
      trackerDelegate = null;
      const bundle: EngineBundle = { engine: eng, tracker: null, basic: true };
      setEngineState({ state: 'ready', bundle, note: '基本模式：僅美膚與濾鏡，臉型與美妝效果已停用' });
      return bundle;
    }
    setEngineState({ state: 'loading', step: 'assets' });
    let models: EngineModels;
    try {
      models = await modelP;
    } catch (e) {
      setEngineState({ state: 'error', message: `美顏引擎下載失敗：${downloadHint(e)}（${errorText(e)}）`, canBasic: true });
      throw e;
    }
    return buildTracker(eng, models);
  })();
  engineP.then(
    () => {
      engineP = null;
    },
    () => {
      engineP = null;
    },
  );
  return engineP;
}

/** a ready bundle with a tracker build (not the user's 基本模式) whose delegate differs from the pref */
function trackerStale(): boolean {
  const cur = svc.get().engine;
  if (cur.state !== 'ready' || (cur.bundle.basic && !trackerFailed)) return false;
  return trackerDelegate !== getPrefs().delegate;
}

/**
 * Delegate pref changed: rebuild the tracker on the same engine (new bundle → live loop restarts).
 * Joins an in-flight build and re-checks the pref once it settles (a recoverEngine reload keeps the old
 * tracker, so it is rebuilt then), so there is only ever one tracker being built and rapid toggles end on
 * the last pref. A tracker that failed to start may be retried.
 */
export function restartTracker(): Promise<void> {
  const pending = trackerP ?? engineP;
  if (pending) {
    return pending
      .then(
        () => (trackerStale() ? restartTracker() : undefined),
        () => undefined,
      )
      .then(() => undefined);
  }
  const cur = svc.get().engine;
  if (cur.state !== 'ready' || (cur.bundle.basic && !trackerFailed)) return Promise.resolve();
  const old = cur.bundle.tracker;
  const eng = cur.bundle.engine;
  const p = prefetchAssets().then((models) => {
    liveTracker = null;
    old?.close();
    return buildTracker(eng, models);
  });
  trackerP = p;
  const clear = () => {
    if (trackerP === p) trackerP = null;
  };
  p.then(clear, clear);
  return p.then(() => undefined);
}

/** Push prefs that the engine reads directly. Tier 'auto' is owned by the live loop. */
export function applyPrefsToEngine(prefs: Prefs): void {
  if (!engine) return;
  try {
    engine.setOptions({ matchGpupixel: prefs.matchGpupixel, showLandmarks: prefs.showLandmarks });
    if (prefs.tier !== 'auto') engine.setTier(prefs.tier);
  } catch (e) {
    reportError(e, 'engine.setOptions');
  }
}

/**
 * User tapped the "lost context" overlay and the display context never came back:
 * replace canvas + engine, keep the tracker. The tracker runs on its own OffscreenCanvas context,
 * detects that context's loss itself and replaces its MediaPipe instance (src/tracking/tracker.ts).
 */
export function recoverEngine(): void {
  const cur = svc.get().engine;
  if (!engine || !engine.lost) {
    svc.set({ lost: false });
    return;
  }
  // a build in flight finishes against the old engine first (the overlay is hidden while loading anyway)
  if (engineP || trackerP) return;
  const tracker = cur.state === 'ready' ? cur.bundle.tracker : null;
  liveTracker = tracker; // kept: its health keeps reaching svc.tracker during the reload
  discardEngine();
  const canvas = makeCanvas();
  svc.set({ canvas, lost: false });
  const fail = (e: unknown, where: string) => {
    // 重試 goes through ensureEngine(false), which builds a new engine and tracker
    if (liveTracker === tracker) liveTracker = null;
    tracker?.close();
    setEngineState({ state: 'error', message: reportError(e, where), canBasic: false });
  };
  try {
    const fresh = deps.createEngine(canvas, engineOptions(getPrefs()));
    engine = fresh;
    const bundle: EngineBundle = { engine: fresh, tracker, basic: !tracker };
    setEngineState({ state: 'loading', step: 'engine' });
    // an in-flight build like any other: ensureEngine / restartTracker during the reload join it instead of
    // building a second tracker next to the kept one
    const p = fresh.ready.then(
      () => {
        setEngineState({ state: 'ready', bundle, note: null });
        return bundle;
      },
      (e: unknown) => {
        if (engine === fresh) discardEngine();
        fail(e, 'engine.ready');
        throw e;
      },
    );
    engineP = p;
    const clear = () => {
      if (engineP === p) engineP = null;
    };
    p.then(clear, clear);
    p.catch(() => undefined); // surfaced through svc.engine; nobody has to await a recovery
  } catch (e) {
    discardEngine();
    fail(e, 'createEngine');
  }
}

// ───────────── 美體 body tracker ─────────────

let bodyTracker: BodyTracker | null = null;
let bodyP: Promise<BodyTracker> | null = null;
/** the 瘦臉 segmenter's ensure call in flight (model download + graph creation) */
let segmenterP: Promise<PersonSegmenter | null> | null = null;
/**
 * only the segmenter's graph creation in flight (declared here: the body tracker waits for it). Not the download: a
 * stalled 250 KB fetch adds nothing to the wasm memory peak the build ordering guards against, so it must not hold 美體.
 */
let segmenterCreateP: Promise<unknown> | null = null;
const bodyProgress = new Set<(p: EngineAssetsProgress) => void>();

/**
 * The 美體 PoseLandmarker (full model, IMAGE mode, with the person mask — which in 0.10.35 means the GPU graph;
 * 'CPU' below is the delegate of the mask-less fallback, see BodyTrackerOptions): downloads the model and creates the graph
 * the first time it is asked for, then returns the same instance for the rest of the session. It starts only
 * after a face-tracker build in flight has settled (never alongside it: two MediaPipe graphs initialising
 * at once is the memory peak that gets SE-class iPhones killed). A failure leaves a retryable error in
 * svc.body; the next call starts over.
 */
export function ensureBodyTracker(onProgress?: (p: EngineAssetsProgress) => void): Promise<BodyTracker> {
  if (bodyTracker) return Promise.resolve(bodyTracker);
  if (onProgress) bodyProgress.add(onProgress);
  if (bodyP) return bodyP;
  let lastBodyPct = -1;
  const progress = (p: EngineAssetsProgress) => {
    for (const cb of bodyProgress) cb(p);
    const pct = p.total > 0 ? Math.floor((p.loaded / p.total) * 100) : -1;
    if (pct === lastBodyPct && p.phase !== 'done') return;
    lastBodyPct = pct;
    if (svc.get().body.state === 'loading') {
      svc.set({ body: { state: 'loading', step: 'model', progress: pct >= 0 ? Math.min(1, pct / 100) : null } });
    }
  };
  const run = (async () => {
    svc.set({ body: { state: 'loading', step: 'tracker', progress: null } });
    // nor alongside the 瘦臉 segmenter's graph creation (not its download: see segmenterCreateP). No cycle: the
    // segmenter waits for this build before it creates its graph, and never once it has started creating
    for (const pending of [trackerP ?? engineP, segmenterCreateP]) if (pending) await pending.catch(() => undefined);
    svc.set({ body: { state: 'loading', step: 'model', progress: null } });
    const modelBuffer = await deps.loadPoseModel('full', progress);
    svc.set({ body: { state: 'loading', step: 'tracker', progress: 1 } });
    const t = await deps.createBodyTracker({
      modelBuffer,
      wasmBase: deps.wasmBase,
      variant: 'full',
      delegate: 'CPU',
      runningMode: 'IMAGE',
    });
    bodyTracker = t;
    return t;
  })();
  const p = run.then(
    (t) => {
      bodyP = null;
      bodyProgress.clear();
      svc.set({ body: { state: 'ready' } });
      return t;
    },
    (e: unknown) => {
      bodyP = null;
      bodyProgress.clear();
      svc.set({ body: { state: 'error', message: reportError(e, 'ensureBodyTracker'), hint: downloadHint(e) } });
      throw e;
    },
  );
  bodyP = p;
  return p;
}

// ───────────── 瘦臉 person segmenter ─────────────

let segmenter: PersonSegmenter | null = null;
/** creating the graph failed (or a live one died): not retried this session, the unlimited 瘦臉 stays */
let segmenterBroken = false;
/** segmenters rebuilt this session after a lost WebGL context (iOS backgrounding); one at most */
let lostRecreates = 0;
const MAX_LOST_RECREATES = 1;

/**
 * The 瘦臉 background limit's person segmenter (selfie_segmenter, CPU, IMAGE mode; src/tracking/segmenter.ts), for a
 * photo without a cached 美體 person mask. Asked for the first time the user moves a contour slider in the editor
 * (FaceProtectSource: never for preset / default values), created then, and the same instance for the rest of the
 * session: one extra (small) wasm heap at most. The model downloads right away; like ensureBodyTracker the graph is
 * created only once no face-tracker / engine / body-tracker build is in flight (a 美體 build started meanwhile waits
 * for that creation only, never for the download). Never rejects: null = unavailable, and the caller keeps today's
 * unlimited contour warps. A failed download is retried by the next call; a failed graph creation or a segmenter that
 * died (a throw inside segment, e.g. OOM or an abort) is not (every create leaks on WebKit, and OOM repeats). The one
 * exception: a segmenter whose WebGL context was lost (`lost`, e.g. iOS backgrounding; nothing wrong with the module)
 * is rebuilt once per session; a second loss leaves the unlimited 瘦臉 for the rest of it.
 */
export function ensureFaceSegmenter(): Promise<PersonSegmenter | null> {
  if (segmenter?.dead) {
    const lost = segmenter.lost;
    segmenter.close();
    segmenter = null;
    if (lost && lostRecreates < MAX_LOST_RECREATES) lostRecreates++;
    else segmenterBroken = true;
  }
  if (segmenter) return Promise.resolve(segmenter);
  if (segmenterBroken) return Promise.resolve(null);
  if (segmenterP) return segmenterP;
  const p = (async (): Promise<PersonSegmenter | null> => {
    let modelBuffer: Uint8Array;
    try {
      modelBuffer = await deps.loadSegmenterModel();
    } catch (e) {
      // offline / blocked: an expected degradation (the unlimited warp stays), not an error to surface
      console.warn('[meiyan] 瘦臉 background limit: segmenter model unavailable', e);
      return null;
    }
    // until a synchronous check finds no build in flight (one may have started during the download or the wait)
    for (;;) {
      const pending = [trackerP ?? engineP, bodyP].filter((q) => q !== null);
      if (!pending.length) break;
      for (const q of pending) await q.catch(() => undefined);
    }
    // (no await between that check and this: a 美體 build starting from now on waits for segmenterCreateP)
    let create: Promise<PersonSegmenter> | null = null;
    try {
      create = deps.createPersonSegmenter({ modelBuffer, wasmBase: deps.wasmBase });
      segmenterCreateP = create;
      segmenter = await create;
      return segmenter;
    } catch (e) {
      segmenterBroken = true;
      console.warn('[meiyan] 瘦臉 background limit: segmenter unavailable', e);
      return null;
    } finally {
      if (create && segmenterCreateP === create) segmenterCreateP = null;
    }
  })();
  segmenterP = p;
  const clear = () => {
    if (segmenterP === p) segmenterP = null;
  };
  p.then(clear, clear);
  return p;
}

// ───────────── camera ─────────────

let camera: CameraController | null = null;
/** true once getUserMedia succeeded in this session: later entries may start from the tile tap */
let cameraGranted = false;

export function getCamera(): CameraController {
  if (!camera) {
    camera = deps.createCamera();
    camera.subscribe((s) => {
      debug({ cameraState: s.state });
      if (s.state === 'live') cameraGranted = true;
    });
  }
  return camera;
}

export function cameraWasGranted(): boolean {
  return cameraGranted;
}

export function stopCamera(): void {
  try {
    camera?.stop();
  } catch (e) {
    reportError(e, 'camera.stop');
  }
}
