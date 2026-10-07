// OWNER: media agent. getUserMedia lifecycle, recovery, wake lock (spec §8, RB §1 #7-#9, §4 "Camera handling").
import type { CameraController, CameraErrorKind, CameraSnapshot, Facing } from '../types';

/** Grace period after returning to the foreground (or a mute) for WebKit to auto-unmute the track. */
export const FOREGROUND_GRACE_MS = 800;
/** Black-frame detector (WK 252465): first sample this long after going live, then every interval. */
export const BLACK_FIRST_CHECK_MS = 2000;
export const BLACK_CHECK_INTERVAL_MS = 1000;
/** A frame counts as black when its brightest 16×16 cell has luma below this (0..255). */
export const BLACK_MAX_LUMA = 4;
export const BLACK_CHECKS = 3;
/** Give up if the stream never reports a frame size. */
export const METADATA_TIMEOUT_MS = 10_000;

const HAVE_METADATA = 1;
const HAVE_CURRENT_DATA = 2;

/** Explicit constraints: an unconstrained stream defaults to 640×480 (RB §1 #7, §2.6). */
export function cameraConstraints(facing: Facing): MediaStreamConstraints {
  return {
    audio: false,
    video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
  };
}

/** Map a getUserMedia rejection to the UI's error kinds (includes legacy Chrome/Firefox names). */
export function mapCameraError(err: unknown, secureContext: boolean): CameraErrorKind {
  if (!secureContext) return 'insecure';
  const name = typeof err === 'object' && err !== null && 'name' in err ? String(err.name) : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'notfound';
    case 'NotReadableError':
    case 'TrackStartError':
    // Firefox reports a busy device as AbortError ("Starting videoinput failed").
    case 'AbortError':
      return 'inuse';
    default:
      return 'unknown';
  }
}

/** Max luma (0..255) of an RGBA buffer — the black-frame test statistic. */
export function maxLuma(rgba: Uint8ClampedArray): number {
  let max = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const y = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    if (y > max) max = y;
  }
  return max;
}

/** Everything the controller touches outside itself; `createCamera` wires the browser, tests wire fakes. */
export interface CameraEnv {
  readonly video: HTMLVideoElement;
  readonly mediaDevices: Pick<MediaDevices, 'getUserMedia'> | undefined;
  readonly isSecureContext: boolean;
  readonly doc: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  readonly wakeLock: Pick<WakeLock, 'request'> | undefined;
  /** brightest-cell luma of the current frame scaled to 16×16; null = cannot sample (detector stays off) */
  sampleMaxLuma(video: HTMLVideoElement): number | null;
}

export function createCamera(): CameraController {
  return createCameraWith(browserEnv());
}

function browserEnv(): CameraEnv {
  const video = document.createElement('video');
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  // Attributes too: iOS autoplay policy and inline playback key off the markup, not only the IDL state.
  video.setAttribute('autoplay', '');
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('aria-hidden', 'true');
  video.disablePictureInPicture = true;
  // Rendered but invisible: display:none may stop frame delivery on WebKit (RB §4).
  video.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
  (document.body ?? document.documentElement).appendChild(video);

  let ctx: CanvasRenderingContext2D | null | undefined;
  const sampleMaxLuma = (v: HTMLVideoElement): number | null => {
    // No decoded frame this long after going live is as bad as a black one.
    if (v.readyState < HAVE_CURRENT_DATA) return 0;
    if (ctx === undefined) {
      const c = document.createElement('canvas');
      c.width = c.height = 16;
      ctx = c.getContext('2d', { willReadFrequently: true });
    }
    if (!ctx) return null;
    try {
      ctx.drawImage(v, 0, 0, 16, 16);
      return maxLuma(ctx.getImageData(0, 0, 16, 16).data);
    } catch {
      return null;
    }
  };

  return {
    video,
    mediaDevices: typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined,
    isSecureContext: typeof isSecureContext === 'boolean' ? isSecureContext : true,
    doc: document,
    wakeLock: typeof navigator !== 'undefined' && 'wakeLock' in navigator ? navigator.wakeLock : undefined,
    sampleMaxLuma,
  };
}

const INITIAL: CameraSnapshot = Object.freeze({ state: 'idle', facing: 'user', error: null, width: 0, height: 0 });

/**
 * Controller state machine.
 * - `start()` never rejects: failures land in `snapshot.error`. It is a no-op while live with the same facing,
 *   and a second call with the same facing while starting joins the pending one (`stop()` cancels it).
 * - `subscribe` calls back immediately with the current snapshot, then on every change.
 * - `width/height` are the last frame size; kept through 'starting' (flip/resume) and 'interrupted' so layouts
 *   do not jump, 0 when 'idle' or 'error'.
 */
export function createCameraWith(env: CameraEnv): CameraController {
  const { video } = env;
  let snap: CameraSnapshot = INITIAL;
  const subs = new Set<(s: CameraSnapshot) => void>();

  /** bumps on every start/stop/interrupt/fail; async continuations from older generations bail out */
  let gen = 0;
  let inflight: { facing: Facing; promise: Promise<void> } | null = null;
  let stream: MediaStream | null = null;
  let track: MediaStreamTrack | null = null;
  let abortWait: AbortController | null = null;
  let healthTimer: ReturnType<typeof setTimeout> | null = null;
  let blackTimer: ReturnType<typeof setTimeout> | null = null;
  let wake: WakeLockSentinel | null = null;
  let wakePending = false;

  const visible = () => env.doc.visibilityState === 'visible';

  function notify(cb: (s: CameraSnapshot) => void): void {
    try {
      cb(snap);
    } catch (e) {
      console.error('[camera] subscriber threw', e);
    }
  }

  function set(patch: Partial<CameraSnapshot>): void {
    const next = { ...snap, ...patch };
    if (
      next.state === snap.state &&
      next.facing === snap.facing &&
      next.error === snap.error &&
      next.width === snap.width &&
      next.height === snap.height
    )
      return;
    snap = Object.freeze(next);
    [...subs].forEach(notify);
  }

  // ── stream teardown ──

  function clearTimers(): void {
    if (healthTimer !== null) clearTimeout(healthTimer);
    if (blackTimer !== null) clearTimeout(blackTimer);
    healthTimer = blackTimer = null;
  }

  function releaseStream(): void {
    abortWait?.abort();
    abortWait = null;
    clearTimers();
    if (track) {
      track.removeEventListener('ended', onEnded);
      track.removeEventListener('mute', onMute);
      track.removeEventListener('unmute', onUnmute);
    }
    stream?.getTracks().forEach((t) => t.stop());
    stream = track = null;
    if (video.srcObject) video.srcObject = null;
    releaseWake();
  }

  /** Terminal for the current stream: stop it and land in `state` (generation bump cancels pending work). */
  function endStream(patch: Partial<CameraSnapshot>): void {
    gen++;
    inflight = null;
    releaseStream();
    set(patch);
  }

  // ── wake lock (RB §4: works in standalone on iOS 18.4+; best effort elsewhere) ──

  function acquireWake(): void {
    if (!env.wakeLock || wake || wakePending || !visible()) return;
    wakePending = true;
    env.wakeLock.request('screen').then(
      (s) => {
        wakePending = false;
        if (snap.state !== 'live' || wake) {
          s.release().catch(() => {});
          return;
        }
        wake = s;
        s.addEventListener('release', () => {
          if (wake === s) wake = null;
        });
      },
      () => {
        wakePending = false;
      },
    );
  }

  function releaseWake(): void {
    const s = wake;
    wake = null;
    s?.release().catch(() => {});
  }

  // ── recovery (RB §1 #7, §4 "Recovery") ──

  function trackDead(): boolean {
    return !track || track.readyState === 'ended' || track.muted;
  }

  function scheduleHealthCheck(): void {
    if (healthTimer !== null) return;
    healthTimer = setTimeout(() => {
      healthTimer = null;
      if (snap.state === 'live' && visible() && trackDead()) endStream({ state: 'interrupted', error: null });
    }, FOREGROUND_GRACE_MS);
  }

  function onEnded(): void {
    // While hidden, wait for the foreground check: the page cannot show a resume button anyway.
    if (snap.state === 'live' && visible()) endStream({ state: 'interrupted', error: null });
  }

  function onMute(): void {
    if (snap.state === 'live' && visible()) scheduleHealthCheck();
  }

  function onUnmute(): void {
    if (healthTimer !== null && !trackDead()) {
      clearTimeout(healthTimer);
      healthTimer = null;
    }
  }

  function onVisibility(): void {
    if (snap.state !== 'live') return;
    if (visible()) {
      scheduleHealthCheck();
      acquireWake();
    } else if (healthTimer !== null) {
      clearTimeout(healthTimer);
      healthTimer = null;
    }
  }

  function onResize(): void {
    if (snap.state === 'live' && video.videoWidth > 0 && video.videoHeight > 0)
      set({ width: video.videoWidth, height: video.videoHeight });
  }

  env.doc.addEventListener('visibilitychange', onVisibility);
  video.addEventListener('resize', onResize);

  // ── black-frame detector (WK 252465) ──

  function scheduleBlackCheck(myGen: number, delay: number, blackCount: number): void {
    blackTimer = setTimeout(() => {
      blackTimer = null;
      if (myGen !== gen || snap.state !== 'live') return;
      if (!visible()) return scheduleBlackCheck(myGen, BLACK_CHECK_INTERVAL_MS, blackCount);
      const luma = env.sampleMaxLuma(video);
      // Unsampleable or a real frame seen: the stream is not the WK 252465 black stream, stop checking.
      if (luma === null || luma >= BLACK_MAX_LUMA) return;
      if (blackCount + 1 >= BLACK_CHECKS) endStream({ state: 'error', error: 'black', width: 0, height: 0 });
      else scheduleBlackCheck(myGen, BLACK_CHECK_INTERVAL_MS, blackCount + 1);
    }, delay);
  }

  // ── start ──

  async function open(facing: Facing, myGen: number): Promise<void> {
    if (!env.isSecureContext) return set({ state: 'error', facing, error: 'insecure', width: 0, height: 0 });
    const md = env.mediaDevices;
    if (!md || typeof md.getUserMedia !== 'function')
      return set({ state: 'error', facing, error: 'notfound', width: 0, height: 0 });

    set({ state: 'starting', facing, error: null });
    let s: MediaStream;
    try {
      // Called before any await so the user gesture is still active (iOS prompt / re-prompt).
      s = await md.getUserMedia(cameraConstraints(facing));
    } catch (e) {
      if (myGen === gen) endStream({ state: 'error', error: mapCameraError(e, env.isSecureContext), width: 0, height: 0 });
      return;
    }
    if (myGen !== gen) {
      s.getTracks().forEach((t) => t.stop());
      return;
    }
    stream = s;
    track = s.getVideoTracks()[0] ?? null;
    if (!track) return endStream({ state: 'error', error: 'notfound', width: 0, height: 0 });
    track.addEventListener('ended', onEnded);
    track.addEventListener('mute', onMute);
    track.addEventListener('unmute', onUnmute);

    video.srcObject = s;
    // AbortError here just means srcObject changed again (flip/stop); the generation check handles it.
    Promise.resolve(video.play()).catch(() => {});

    const ac = new AbortController();
    abortWait = ac;
    try {
      await waitForFrameSize(video, METADATA_TIMEOUT_MS, ac.signal);
    } catch {
      if (myGen === gen) endStream({ state: 'error', error: 'unknown', width: 0, height: 0 });
      return;
    }
    if (myGen !== gen) return;
    abortWait = null;
    if (track.readyState === 'ended') return endStream({ state: 'interrupted', error: null });

    set({ state: 'live', width: video.videoWidth, height: video.videoHeight });
    acquireWake();
    scheduleBlackCheck(myGen, BLACK_FIRST_CHECK_MS, 0);
    if (track.muted && visible()) scheduleHealthCheck();
  }

  function start(facing: Facing = snap.facing): Promise<void> {
    if (snap.state === 'live' && snap.facing === facing) return Promise.resolve();
    if (inflight && inflight.facing === facing) return inflight.promise;
    // Stop the old capture first: iOS allows one capture at a time (RB §1 #7, §4 "Switching cameras").
    gen++;
    releaseStream();
    const myGen = gen;
    const promise = open(facing, myGen).finally(() => {
      if (inflight?.promise === promise) inflight = null;
    });
    inflight = { facing, promise };
    return promise;
  }

  return {
    video,
    get snapshot() {
      return snap;
    },
    start,
    resume: () => start(snap.facing),
    flip() {
      const next: Facing = snap.facing === 'user' ? 'environment' : 'user';
      if (snap.state === 'idle') {
        set({ facing: next });
        return Promise.resolve();
      }
      return start(next);
    },
    stop() {
      endStream({ state: 'idle', error: null, width: 0, height: 0 });
    },
    subscribe(cb) {
      subs.add(cb);
      notify(cb);
      return () => {
        subs.delete(cb);
      };
    },
  };
}

/** Resolve once the video reports a frame size (dimensions only ever come from videoWidth/Height). */
function waitForFrameSize(video: HTMLVideoElement, timeoutMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const ready = () => video.readyState >= HAVE_METADATA && video.videoWidth > 0 && video.videoHeight > 0;
    if (ready()) return resolve();
    const events = ['loadedmetadata', 'loadeddata', 'resize', 'canplay'] as const;
    const cleanup = () => {
      clearTimeout(timer);
      events.forEach((e) => video.removeEventListener(e, check));
      signal.removeEventListener('abort', onAbort);
    };
    const check = () => {
      if (!ready()) return;
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException('aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('camera: no frame size'));
    }, timeoutMs);
    events.forEach((e) => video.addEventListener(e, check));
    signal.addEventListener('abort', onAbort);
  });
}
