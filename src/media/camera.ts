// OWNER: media agent. getUserMedia lifecycle, recovery, wake lock (spec §8, RB §1 #7-#9, §4 "Camera handling").
import type { CameraController, CameraErrorKind, CameraSnapshot, Facing } from '../types';

/** Grace period after a mute (a call, Control Center) for WebKit to auto-unmute the track. */
export const MUTE_GRACE_MS = 800;
/** Black-frame detector (WK 252465): first sample this long after going live, then every interval. */
export const BLACK_FIRST_CHECK_MS = 2000;
export const BLACK_CHECK_INTERVAL_MS = 1000;
/** A frame counts as black when its brightest 16×16 cell has luma below this (0..255). */
export const BLACK_MAX_LUMA = 4;
export const BLACK_CHECKS = 3;
/**
 * getUserMedia has this long to answer before 'noanswer' tells the user (the permission prompt first, then how to get
 * out of a stuck request); the request keeps waiting and a late answer goes live.
 */
export const ANSWER_TIMEOUT_MS = 8_000;
/** A stream must show its first decoded frame this long after it arrives (WK 252465: some never do). */
export const FRAME_TIMEOUT_MS = 5_000;
/**
 * A frame deadline that fires this much late was held up by a busy main thread (a MediaPipe graph starting up on the
 * first open): a frame may be queued behind the stall, so the deadline waits this long once more, STALL_GRACES times
 * at most.
 */
export const STALL_MS = 1_000;
export const STALL_GRACES = 3;
/** play() again when no frame came this long after the stream arrived (WK 216874, 241152). */
export const REPLAY_MS = 1_500;
/** Pause between stopping a stream that showed nothing and asking for a new one (WK 216874). */
export const REACQUIRE_DELAY_MS = 500;
/** A live video paused by the browser is played again at most this often. */
export const REPLAY_GAP_MS = 1_000;
/**
 * Back from the background within this long, the camera restarts by itself: a getUserMedia nobody tapped reuses the
 * permission for about a minute without capture on iOS; later 恢復相機 asks for the tap.
 */
export const AUTO_RESUME_MS = 50_000;

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

/** AbortError just means srcObject changed again (flip/stop); the generation checks handle it. */
function playVideo(video: HTMLVideoElement): void {
  Promise.resolve(video.play()).catch(() => {});
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

/** What started a getUserMedia: a tap (the gesture iOS prompts on), the return from the background, the re-acquire. */
type StartCause = 'tap' | 'resume' | 'reacquire';

/** One getUserMedia call; `owner` is the start generation that takes its stream. */
interface GumRequest {
  facing: Facing;
  promise: Promise<MediaStream>;
  owner: number;
  /** what issued it (not what joined it): a refusal of one nobody tapped is not the user's 拒絕 */
  cause: StartCause;
  /** Date.now() when it was issued: a start that joins it gets 'noanswer' on the request's own clock */
  askedAt: number;
}

/**
 * Controller state machine.
 * - `start()` never rejects: failures land in `snapshot.error`. It is a no-op while live with the same facing,
 *   and a second call with the same facing while starting joins the pending one (`stop()` cancels it).
 * - One getUserMedia at a time: WebKit answers them in turn, so a second one would only wait behind one it left
 *   unanswered. A start for the same camera while a request is still out joins it, one for the other camera waits
 *   for it first; its answer goes to the latest start, or is stopped.
 * - No answer within ANSWER_TIMEOUT_MS → error 'noanswer' while still 'starting' (a late answer goes live). A stream
 *   that ends or shows no frame within FRAME_TIMEOUT_MS is stopped and asked for once more, by itself; a second
 *   one → 'error' 'noframe'.
 * - Hidden (home, another app, the lock screen) → the capture stops, 'interrupted'; back within AUTO_RESUME_MS it
 *   restarts by itself. (An app closed from the app switcher gets no visibilitychange: that capture is killed live.)
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
  /** the getUserMedia still unanswered (it cannot be cancelled) */
  let request: GumRequest | null = null;
  let stream: MediaStream | null = null;
  let track: MediaStreamTrack | null = null;
  let abortWait: AbortController | null = null;
  let healthTimer: ReturnType<typeof setTimeout> | null = null;
  let blackTimer: ReturnType<typeof setTimeout> | null = null;
  let answerTimer: ReturnType<typeof setTimeout> | null = null;
  /** a play() held back by REPLAY_GAP_MS, due at its end */
  let replayTimer: ReturnType<typeof setTimeout> | null = null;
  /** Date.now() until which coming back from the background restarts the camera the background stopped */
  let resumeBy: number | null = null;
  /** Date.now() of the last play() after a pause event */
  let lastReplay = -Infinity;
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
    if (answerTimer !== null) clearTimeout(answerTimer);
    if (replayTimer !== null) clearTimeout(replayTimer);
    healthTimer = blackTimer = answerTimer = replayTimer = null;
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
    }, MUTE_GRACE_MS);
  }

  function onEnded(): void {
    // while hidden the visibility handler has stopped everything already
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
    // an interruption (a call, Siri) may leave the video paused without telling (WK 216874)
    if (snap.state === 'live' && video.paused) playVideo(video);
  }

  /** WebKit pauses a capture video after an interruption or when it thinks it is off-screen (WK 216874, 241152). */
  function onPause(): void {
    if (snap.state !== 'live' || !visible() || replayTimer !== null) return;
    // at most once a second, so a video the browser keeps pausing cannot spin a play/pause loop; a pause within the
    // gap is played at its end (no further pause event comes while it stays paused)
    const wait = lastReplay + REPLAY_GAP_MS - Date.now();
    if (wait <= 0) return replay();
    replayTimer = setTimeout(() => {
      replayTimer = null;
      if (snap.state === 'live' && visible() && video.paused) replay();
    }, wait);
  }

  function replay(): void {
    lastReplay = Date.now();
    playVideo(video);
  }

  function onVisibility(): void {
    if (!visible()) {
      // A capture iOS suspends or kills along with the app is a reported trigger of the stuck camera of the next
      // launch (WK 252465 and kin): stop it now, and restart it on the way back.
      if (snap.state === 'live' || snap.state === 'starting') {
        resumeBy = Date.now() + AUTO_RESUME_MS;
        endStream({ state: 'interrupted', error: null });
      }
      return;
    }
    const by = resumeBy;
    resumeBy = null;
    // longer away, the user taps 恢復相機: iOS would ask for the camera again without a tap
    if (by !== null && snap.state === 'interrupted' && Date.now() <= by)
      startFor(snap.facing, 'resume').catch((e: unknown) => console.error('[camera] restart after the background failed', e));
  }

  function onResize(): void {
    if (snap.state === 'live' && video.videoWidth > 0 && video.videoHeight > 0)
      set({ width: video.videoWidth, height: video.videoHeight });
  }

  env.doc.addEventListener('visibilitychange', onVisibility);
  video.addEventListener('resize', onResize);
  video.addEventListener('pause', onPause);

  // ── black-frame detector (WK 252465) ──

  function scheduleBlackCheck(myGen: number, delay: number, blackCount: number): void {
    blackTimer = setTimeout(() => {
      blackTimer = null;
      if (myGen !== gen || snap.state !== 'live') return;
      const luma = env.sampleMaxLuma(video);
      // Unsampleable or a real frame seen: the stream is not the WK 252465 black stream, stop checking.
      if (luma === null || luma >= BLACK_MAX_LUMA) return;
      if (blackCount + 1 >= BLACK_CHECKS) endStream({ state: 'error', error: 'black', width: 0, height: 0 });
      else scheduleBlackCheck(myGen, BLACK_CHECK_INTERVAL_MS, blackCount + 1);
    }, delay);
  }

  // ── start ──

  /** Still no answer `ms` from now: say so, and keep waiting (a late answer still goes live). */
  function armAnswerTimer(myGen: number, ms: number): void {
    if (answerTimer !== null) clearTimeout(answerTimer);
    answerTimer = setTimeout(
      () => {
        answerTimer = null;
        // still 'starting': the user may be reading the permission prompt, and a late answer goes live
        if (myGen === gen && snap.state === 'starting') set({ error: 'noanswer' });
      },
      Math.max(0, ms),
    );
  }

  function ask(md: Pick<MediaDevices, 'getUserMedia'>, facing: Facing, myGen: number, cause: StartCause): GumRequest {
    let promise: Promise<MediaStream>;
    try {
      promise = Promise.resolve(md.getUserMedia(cameraConstraints(facing)));
    } catch (e) {
      promise = Promise.reject(e);
    }
    const req: GumRequest = { facing, promise, owner: myGen, cause, askedAt: Date.now() };
    const settled = () => {
      if (request === req) request = null;
    };
    promise.then(settled, settled);
    return req;
  }

  /** The stream for `facing`; null when this start was superseded or failed (the snapshot says why). */
  async function acquire(
    md: Pick<MediaDevices, 'getUserMedia'>,
    facing: Facing,
    myGen: number,
    cause: StartCause,
  ): Promise<MediaStream | null> {
    // waiting for the other camera's request counts as no answer too
    armAnswerTimer(myGen, ANSWER_TIMEOUT_MS);
    // A request still out for the other camera: its owner stops its stream; wait for that, there is no cancelling it.
    while (request && request.facing !== facing) {
      await request.promise.catch(() => undefined);
      if (myGen !== gen) return null;
    }
    // Called before any await on a tap's start, so the user gesture is still active (iOS prompt / re-prompt).
    const req = request ?? (request = ask(md, facing, myGen, cause));
    req.owner = myGen;
    // joined after ✕ or the background: the request has been unanswered since it was issued
    armAnswerTimer(myGen, req.askedAt + ANSWER_TIMEOUT_MS - Date.now());
    let s: MediaStream;
    try {
      s = await req.promise;
    } catch (e) {
      if (myGen !== gen) return null;
      const kind = mapCameraError(e, env.isSecureContext);
      // A request nobody tapped that fails is not the user's doing: the restart from the background lands on 恢復相機
      // whatever the error (its tap asks again, and shows what a tapped request then says), a re-acquire refused for
      // want of a gesture (iOS asks again only on one) on the stream that showed nothing. Either button taps again.
      if (req.cause === 'resume') endStream({ state: 'interrupted', error: null });
      else if (kind === 'denied' && req.cause === 'reacquire') endStream({ state: 'error', error: 'noframe', width: 0, height: 0 });
      else endStream({ state: 'error', error: kind, width: 0, height: 0 });
      return null;
    }
    if (myGen !== gen) {
      // a newer start that joined this request takes the stream; without one it is nobody's
      if (req.owner === myGen) s.getTracks().forEach((t) => t.stop());
      return null;
    }
    if (answerTimer !== null) clearTimeout(answerTimer);
    answerTimer = null;
    return s;
  }

  /** Show `s`: 'live', 'dead' (it ended or showed no frame in time), or null when superseded or failed. */
  async function attach(s: MediaStream, myGen: number): Promise<'live' | 'dead' | null> {
    stream = s;
    const t = s.getVideoTracks()[0] ?? null;
    track = t;
    if (!t) {
      endStream({ state: 'error', error: 'notfound', width: 0, height: 0 });
      return null;
    }
    t.addEventListener('ended', onEnded);
    t.addEventListener('mute', onMute);
    t.addEventListener('unmute', onUnmute);
    // the late answer to a request the user was told had none
    set({ state: 'starting', error: null });

    video.srcObject = s;
    playVideo(video);

    const ac = new AbortController();
    abortWait = ac;
    let shown: boolean;
    try {
      shown = await waitForFrame(video, t, ac.signal);
    } catch {
      return null; // aborted: a newer start or stop released this stream
    }
    if (myGen !== gen) return null;
    abortWait = null;
    // a track found ended as its first frame came (its 'ended' event still queued) has nothing to keep live
    if (!shown || t.readyState === 'ended') return 'dead';

    set({ state: 'live', width: video.videoWidth, height: video.videoHeight });
    acquireWake();
    scheduleBlackCheck(myGen, BLACK_FIRST_CHECK_MS, 0);
    if (t.muted && visible()) scheduleHealthCheck();
    return 'live';
  }

  async function open(facing: Facing, myGen: number, cause: StartCause): Promise<void> {
    if (!env.isSecureContext) return set({ state: 'error', facing, error: 'insecure', width: 0, height: 0 });
    const md = env.mediaDevices;
    if (!md || typeof md.getUserMedia !== 'function')
      return set({ state: 'error', facing, error: 'notfound', width: 0, height: 0 });

    set({ state: 'starting', facing, error: null });
    for (let attempt = 0; ; attempt++) {
      const s = await acquire(md, facing, myGen, attempt === 0 ? cause : 'reacquire');
      if (!s) return;
      // a stop or a newer start in the hop from acquire released nothing of this stream yet: nobody takes it
      if (myGen !== gen) return s.getTracks().forEach((t) => t.stop());
      // in the hop from attach, one released the dead stream already: the newer start owns the state and the timers
      if ((await attach(s, myGen)) !== 'dead' || myGen !== gen) return;
      if (attempt > 0) return endStream({ state: 'error', error: 'noframe', width: 0, height: 0 });
      // WK 252465 and kin: waiting longer does not help, a clean new request after a pause often does
      releaseStream();
      await new Promise<void>((r) => setTimeout(r, REACQUIRE_DELAY_MS));
      if (myGen !== gen) return;
    }
  }

  function startFor(facing: Facing, cause: StartCause): Promise<void> {
    resumeBy = null;
    if (snap.state === 'live' && snap.facing === facing) return Promise.resolve();
    // the same request (noanswer included): a second getUserMedia would only queue behind it
    if (inflight && inflight.facing === facing) return inflight.promise;
    // Stop the old capture first: iOS allows one capture at a time (RB §1 #7, §4 "Switching cameras").
    gen++;
    releaseStream();
    const myGen = gen;
    const promise = open(facing, myGen, cause).finally(() => {
      if (inflight?.promise === promise) inflight = null;
    });
    inflight = { facing, promise };
    return promise;
  }

  const start = (facing: Facing = snap.facing) => startFor(facing, 'tap');

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
      resumeBy = null;
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

/**
 * Resolve true once the video holds a decoded frame (its size known and readyState ≥ HAVE_CURRENT_DATA), false
 * when the track ends or FRAME_TIMEOUT_MS passes without one (more after a stall, STALL_MS); play() is called once
 * more meanwhile. Rejects when aborted.
 */
function waitForFrame(video: HTMLVideoElement, track: MediaStreamTrack, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const ready = () => video.readyState >= HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0;
    if (ready()) return resolve(true);
    if (track.readyState === 'ended') return resolve(false);
    const events = ['loadedmetadata', 'loadeddata', 'canplay', 'playing', 'resize', 'timeupdate'] as const;
    const cleanup = () => {
      clearTimeout(replay);
      clearTimeout(timer);
      events.forEach((e) => video.removeEventListener(e, check));
      track.removeEventListener('ended', onEnded);
      signal.removeEventListener('abort', onAbort);
    };
    const finish = (shown: boolean) => {
      cleanup();
      resolve(shown);
    };
    const check = () => {
      if (ready()) finish(true);
    };
    const onEnded = () => finish(false);
    const onAbort = () => {
      cleanup();
      reject(new DOMException('aborted', 'AbortError'));
    };
    const replay = setTimeout(() => {
      if (!ready()) playVideo(video);
    }, REPLAY_MS);
    // checked once more at the deadline: a frame whose event is not dispatched yet still counts. A deadline that fired
    // late (a busy main thread) waits a moment more: the frame may be queued behind the stall
    let due = Date.now() + FRAME_TIMEOUT_MS;
    let graces = 0;
    const deadline = () => {
      if (ready()) return finish(true);
      const now = Date.now();
      if (now - due < STALL_MS || graces >= STALL_GRACES) return finish(false);
      graces++;
      due = now + STALL_MS;
      timer = setTimeout(deadline, STALL_MS);
    };
    let timer = setTimeout(deadline, FRAME_TIMEOUT_MS);
    events.forEach((e) => video.addEventListener(e, check));
    track.addEventListener('ended', onEnded);
    signal.addEventListener('abort', onAbort);
  });
}
