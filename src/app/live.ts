// OWNER: app-glue agent. Live camera loop: rVFC → detect → adapt → render, face easing, auto-tier, debug state.
import { adapt } from '../tracking/adapter111';
import type { BeautyParams, CameraController, Engine, EngineOptions, Face, Prefs, Tier, Tracker } from '../types';
import { debugState, reportError } from './debug';
import { createVideoFrameSource, type FrameInfo, type FrameSource } from './frameSource';
import { AutoTier, FaceWeightEaser, TimeEma, frameCost, nextLowerTier, shouldDetect, skippedFrames } from './liveCore';

export interface LiveStats {
  fps: number;
  detectMs: number;
  renderMs: number;
  tier: Tier;
  face: boolean;
}

export interface LiveLoop {
  stop(): void;
  /** hold-to-compare: render the unprocessed frame while true */
  setCompare(on: boolean): void;
  /** Full-resolution render of the latest frame with current params (mirror per prefs.mirrorOnSave). null if no frame yet. */
  capture(): ImageData | null;
}

export interface LiveDeps {
  camera: CameraController;
  engine: Engine;
  /** null → 基本模式 (no face effects) */
  tracker: Tracker | null;
  getParams: () => BeautyParams;
  getPrefs: () => Prefs;
  onStats?: (s: LiveStats) => void;
}

/** Tier the auto policy settled on in this page session. Auto never steps back up within a session,
 * so a loop restarted after Review/Editor starts where the previous one ended. */
let sessionAutoTier: Tier = 'H';

export function autoTierSession(): Tier {
  return sessionAutoTier;
}

/** Forget the auto result so auto measures from H again (bench "auto" button, tests). */
export function resetAutoTierSession(): void {
  sessionAutoTier = 'H';
}

const HAVE_CURRENT_DATA = 2;
/** smoothing of the displayed fps / detect / render numbers */
const STAT_TAU_MS = 500;
/** onStats throttle (UI re-renders); face/tier changes are emitted immediately */
const STATS_EVERY_MS = 250;
/** rVFC silent for 2 consecutive checks while the video plays → switch to rAF polling
 * (whether WebKit keeps firing rVFC for a 1×1 / opacity-0 video is unverified, RB §4) */
const WATCHDOG_MS = 1000;
const WATCHDOG_STRIKES = 2;

export function startLiveLoop(deps: LiveDeps): LiveLoop {
  const { camera, engine, tracker } = deps;
  const video = camera.video;
  let frames: FrameSource = createVideoFrameSource(video);

  const auto = new AutoTier();
  const easer = new FaceWeightEaser();
  const fpsEma = new TimeEma(STAT_TAU_MS);
  const detectEma = new TimeEma(STAT_TAU_MS);
  const renderEma = new TimeEma(STAT_TAU_MS);
  const requestedFilters = new Set<string>();
  const applied: Partial<EngineOptions> = {};

  let stopped = false;
  let compare = false;
  let paused = true;
  /** latest detection result; held between detections on tier L */
  let detected: Face | null = null;
  /** face being rendered: the last detected face, held while faceWeight fades out */
  let shown: Face | null = null;
  let weight = 0;
  let detectedLastFrame = false;
  let lastTs: number | null = null;
  let lastPresented: number | null = null;
  let lastDetectTs: number | null = null;
  /** watchdog bookkeeping: frame callbacks since the last check, consecutive silent checks */
  let framesSinceCheck = 0;
  let silentChecks = 0;
  /** `${w}x${h}:${facing}` of the stream the face state belongs to */
  let geometry = '';
  let haveFrame = false;
  let tierPrefAuto: boolean | null = null;
  let lastEmitTs = -Infinity;
  let lastEmitted: LiveStats | null = null;

  const dbg = debugState();
  if (dbg && tracker) dbg.delegate = tracker.delegate;

  const isLive = () => camera.snapshot.state === 'live' && !engine.lost;
  const hasVideoFrame = () => video.readyState >= HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0;

  function onFrame(info: FrameInfo): void {
    if (stopped) return;
    framesSinceCheck++;
    // re-arm first so a throwing frame can never end the chain
    frames.request(onFrame);
    try {
      step(info);
    } catch (err) {
      reportError('live frame', err);
    }
  }

  function step(info: FrameInfo): void {
    if (!isLive() || !hasVideoFrame()) {
      pause();
      return;
    }
    const now = info.now;
    const w = video.videoWidth;
    const h = video.videoHeight;
    const facing = camera.snapshot.facing;
    const geo = `${w}x${h}:${facing}`;
    if (paused || geo !== geometry) resetSession(geo);

    const prefs = deps.getPrefs();
    const params = deps.getParams();
    syncOptions(prefs, facing === 'user');
    syncTier(prefs.tier);
    ensureFilter(params.filterId);

    const interval = lastTs === null ? null : now - lastTs;

    let detectMs: number | null = null;
    if (tracker && shouldDetect(engine.tier, detectedLastFrame)) {
      const t0 = performance.now();
      detected = detectFace(tracker, w, h);
      detectMs = performance.now() - t0;
      detectedLastFrame = true;
    } else {
      detectedLastFrame = false;
    }

    if (detected) shown = detected;
    weight = easer.update(detected !== null, interval ?? 0);
    if (weight <= 0) shown = null;

    const t1 = performance.now();
    draw(params, w, h);
    const renderMs = performance.now() - t1;
    haveFrame = true;

    if (interval !== null && interval > 0) fpsEma.update(interval, interval);
    if (detectMs !== null) {
      detectEma.update(detectMs, lastDetectTs === null ? 0 : now - lastDetectTs);
      lastDetectTs = now;
    }
    renderEma.update(renderMs, interval ?? 0);

    if (prefs.tier === 'auto' && interval !== null) {
      const cost = frameCost((detectMs ?? 0) + renderMs, interval, skippedFrames(info.presentedFrames, lastPresented));
      if (auto.sample(now, cost, interval)) stepDown();
    }

    lastTs = now;
    lastPresented = info.presentedFrames;
    publish(now, false);
  }

  function detectFace(t: Tracker, w: number, h: number): Face | null {
    try {
      const lm = t.detectVideo(video, performance.now());
      return lm ? adapt(lm, w, h) : null;
    } catch (err) {
      reportError('live detect', err);
      return null;
    }
  }

  function draw(params: BeautyParams, w: number, h: number): void {
    if (compare) engine.renderOriginal({ source: video, width: w, height: h });
    else engine.render({ source: video, width: w, height: h, face: shown, faceWeight: shown ? weight : 0, params });
  }

  /** New measurement window + fresh face state (start, resume, flip / resolution change). */
  function resetSession(geo: string): void {
    paused = false;
    geometry = geo;
    detected = null;
    shown = null;
    weight = 0;
    easer.reset(0);
    detectedLastFrame = false;
    lastTs = null;
    lastPresented = null;
    lastDetectTs = null;
    fpsEma.reset();
    auto.restart();
  }

  function pause(): void {
    if (paused) return;
    paused = true;
    detected = null;
    shown = null;
    weight = 0;
    lastTs = null;
    fpsEma.reset();
    publish(performance.now(), true);
  }

  function syncOptions(prefs: Prefs, mirror: boolean): void {
    if (
      applied.mirror === mirror &&
      applied.matchGpupixel === prefs.matchGpupixel &&
      applied.showLandmarks === prefs.showLandmarks
    )
      return;
    const o: EngineOptions = { mirror, matchGpupixel: prefs.matchGpupixel, showLandmarks: prefs.showLandmarks };
    engine.setOptions(o);
    Object.assign(applied, o);
  }

  function syncTier(pref: Prefs['tier']): void {
    const isAuto = pref === 'auto';
    if (isAuto !== tierPrefAuto) {
      tierPrefAuto = isAuto;
      auto.restart();
    }
    const want = isAuto ? sessionAutoTier : pref;
    if (engine.tier !== want) {
      engine.setTier(want);
      auto.restart();
    }
  }

  function stepDown(): void {
    const lower = nextLowerTier(engine.tier);
    if (lower) {
      sessionAutoTier = lower;
      engine.setTier(lower);
    }
    auto.restart();
  }

  function ensureFilter(id: string): void {
    if (id === 'none' || requestedFilters.has(id)) return;
    requestedFilters.add(id);
    engine.loadFilter(id).catch((err: unknown) => reportError(`filter ${id}`, err));
  }

  function publish(now: number, force: boolean): void {
    const s: LiveStats = {
      fps: paused ? 0 : fpsEma.value ? 1000 / fpsEma.value : 0,
      detectMs: detectEma.value ?? 0,
      renderMs: renderEma.value ?? 0,
      tier: engine.tier,
      face: detected !== null,
    };
    if (dbg) {
      dbg.fps = s.fps;
      dbg.detectMs = s.detectMs;
      dbg.renderMs = s.renderMs;
      dbg.tier = s.tier;
      dbg.face = s.face;
      // a self-healing tracker may come back on another delegate ('auto' → CPU fallback)
      if (tracker) dbg.delegate = tracker.delegate;
    }
    if (!deps.onStats) return;
    const changed = !lastEmitted || lastEmitted.face !== s.face || lastEmitted.tier !== s.tier;
    if (!force && !changed && now - lastEmitTs < STATS_EVERY_MS) return;
    lastEmitTs = now;
    lastEmitted = s;
    deps.onStats(s);
  }

  /** Re-draw the current frame without detection (compare toggles must not wait for the next frame). */
  function redraw(): void {
    if (stopped || paused || !haveFrame || !isLive() || !hasVideoFrame()) return;
    try {
      draw(deps.getParams(), video.videoWidth, video.videoHeight);
    } catch (err) {
      reportError('live redraw', err);
    }
  }

  const unsubscribe = camera.subscribe((snap) => {
    if (stopped) return;
    if (dbg) dbg.cameraState = snap.state;
    // a restarted stream (resume / flip) may not carry the pending rVFC registration over
    if (snap.state === 'live') {
      silentChecks = 0;
      frames.request(onFrame);
    } else pause();
  });

  const watchdog = setInterval(() => {
    const got = framesSinceCheck;
    framesSinceCheck = 0;
    const hidden = typeof document !== 'undefined' && document.hidden;
    if (stopped || frames.kind !== 'rvfc' || got > 0 || hidden || !isLive() || video.paused || !hasVideoFrame()) {
      silentChecks = 0;
      return;
    }
    if (++silentChecks < WATCHDOG_STRIKES) return;
    reportError('rVFC stalled, falling back to rAF', new Error('no video frame callbacks'));
    frames.cancel();
    frames = createVideoFrameSource(video, { rvfc: false });
    frames.request(onFrame);
  }, WATCHDOG_MS);

  frames.request(onFrame);

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      frames.cancel();
      clearInterval(watchdog);
      unsubscribe();
    },
    setCompare(on) {
      if (compare === on) return;
      compare = on;
      redraw();
    },
    capture() {
      if (stopped || paused || !haveFrame || !isLive() || !hasVideoFrame()) return null;
      const prefs = deps.getPrefs();
      return engine.renderToImageData(
        {
          source: video,
          width: video.videoWidth,
          height: video.videoHeight,
          face: shown,
          faceWeight: shown ? weight : 0,
          params: deps.getParams(),
        },
        { mirror: prefs.mirrorOnSave && camera.snapshot.facing === 'user' },
      );
    },
  };
}
