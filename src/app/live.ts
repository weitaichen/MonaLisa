// OWNER: app-glue agent. Live camera loop: rVFC → detect → adapt → render, face easing, auto-tier, debug state.
// Each tracked face renders its own camera person (camera per-person spec §8): the session (LivePersons) is the
// caller's, so a loop rebuilt on a new stream or bundle keeps everyone; pause and stop release the tracks into its away
// pool (§7.5).
import { LIVE_DETECT_FACES, MAX_RENDER_FACES } from '../config/limits';
import { gpLeftOnLeft } from '../edit/sides';
import { neutralPerson } from '../edit/state';
import { photoLuts } from '../engine/looks';
import type { CameraController, Engine, EngineOptions, FaceSeed, Landmarks478, PersonParams, PhotoParams, Prefs, Rect, StillFrame, Tier, Tracker } from '../types';
import { debugState, reportError } from './debug';
import { FaceTracks, type CameraSelection, type LiveTrackView } from './faceTracks';
import { createVideoFrameSource, type FrameInfo, type FrameSource } from './frameSource';
import { AutoTier, TimeEma, frameCost, nextLowerTier, shouldDetect, skippedFrames } from './liveCore';
import type { LivePersonId, LivePersons } from './livePersons';

export interface LiveStats {
  fps: number;
  detectMs: number;
  renderMs: number;
  tier: Tier;
  face: boolean;
  /** shown tracks, held ones included */
  faces: number;
  /**
   * the target's track's GPUPixel-left eye shows left of its right eye on the unmirrored frame (gpLeftOnLeft, with
   * hysteresis); the last answer while no face shows, null before the first one on this stream. The camera's 左／右
   * chips map through it and the preview mirror (cameraScreenSwap, S5 §3.4)
   */
  gpLeftOnLeft: boolean | null;
  /** the person the sliders edit (camera per-person spec §3.2), null with no face shown */
  target: LivePersonId | null;
  /** the session's version (LivePersons.version): a target or param change re-renders the panel */
  personsVersion: number;
}

export interface LiveLoop {
  stop(): void;
  /** hold-to-compare: render the unprocessed frame while true */
  setCompare(on: boolean): void;
  /**
   * Full-resolution render of the latest frame with every shown face at its person's params (mirror per
   * prefs.mirrorOnSave), the hand-over seed (C2): the target's track's last raw box centre in unmirrored video UV, 'all'
   * under 全部套用, null without a track; and every edited person in view (found or held) with that raw box and their
   * params (camera per-person spec §5.3). null if no frame yet.
   */
  capture(): { image: ImageData; seed: FaceSeed; persons: { rawBox: Rect; params: PersonParams }[] } | null;
  /** the person of the shown track under (u, v) (unmirrored video UV), each box grown to at least minW × minH (C1) */
  hitTest(u: number, v: number, minW: number, minH: number): LivePersonId | null;
  /** pin a person as the target */
  select(id: LivePersonId): void;
  selection(): CameraSelection;
  /** every shown track, held ones included */
  tracks(): LiveTrackView[];
}

export interface LiveDeps {
  camera: CameraController;
  engine: Engine;
  /** null → 基本模式 (no face effects; the session's ambient person on all skin, §3.6) */
  tracker: Tracker | null;
  /** the camera session (ui/cameraSession.ts): persons, params, selection, 全部套用, the away pool */
  persons: LivePersons;
  /** the photo look (濾鏡, 調節, 質感, 美白, 銳化: the whole frame, K2) */
  getPhoto: () => PhotoParams;
  getPrefs: () => Prefs;
  /**
   * step 2: the picture the shutter keeps, as normalized source UV (the ratio's centre crop, Camera.tsx); read every
   * frame, so a ratio change moves the vignette at once. Absent → the whole video frame.
   */
  getFrame?: () => Rect;
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

let neutral: PersonParams | null = null;
/** 原圖, built once (the frame lists every untouched face with it, every frame) */
const neutralOnce = (): PersonParams => (neutral ??= neutralPerson());
/** §6.3's render order: present edited faces, then present ones, then held ones */
const renderRank = (v: LiveTrackView): number => (v.present ? (v.edited ? 0 : 1) : 2);

/**
 * The camera's render input (camera per-person spec §8): every shown track with its eased weight and its own person's
 * params, 原圖 for an untouched one (listed at weight 0: it bounds its neighbours' caps and starts no pass, A3); a held
 * track that faded out and lost its presence is dropped from the list (it bounds nobody's cap any more). Present edited
 * faces first, then present, then held, cut at MAX_RENDER_FACES. The global skin is the session's ambient person (原圖
 * except in 基本模式, §3.6), fading with "no face" exactly as v0.3 (A2).
 */
export function liveFrame(
  views: readonly LiveTrackView[],
  anyFace: number,
  photo: PhotoParams,
  persons: Pick<LivePersons, 'params' | 'ambient'>,
): StillFrame {
  const amb = persons.ambient.values;
  return {
    faces: views
      .filter((v) => v.weight > 0 || v.presence > 0)
      .sort((a, b) => renderRank(a) - renderRank(b))
      .slice(0, MAX_RENDER_FACES)
      .map((v) => ({ face: v.face, weight: v.weight, person: persons.params(v.person) ?? neutralOnce(), protect: null, presence: v.presence })),
    obstacles: [],
    globalSkin: { smooth: amb['skin.smooth'], rosy: amb['skin.rosy'], weight: 1 - anyFace },
    photo,
  };
}

export function startLiveLoop(deps: LiveDeps): LiveLoop {
  const { camera, engine, tracker, persons } = deps;
  const video = camera.video;
  let frames: FrameSource = createVideoFrameSource(video);

  const auto = new AutoTier();
  const tracks = new FaceTracks(persons);
  const fpsEma = new TimeEma(STAT_TAU_MS);
  const detectEma = new TimeEma(STAT_TAU_MS);
  const renderEma = new TimeEma(STAT_TAU_MS);
  const applied: Partial<EngineOptions> = {};

  /** grain seed: advanced once per drawn camera frame (moving grain, C §12 #11); redraws and the capture reuse it */
  let grainSeed = 0;
  let stopped = false;
  let compare = false;
  let paused = true;
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
  /** LiveStats.gpLeftOnLeft of this stream (reset with the face state) */
  let sides: boolean | null = null;
  /** the pass list of the last processed display frame (debug) */
  let lastPasses: string[] = [];

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
    if (paused || geo !== geometry) resetSession(geo, now);

    const prefs = deps.getPrefs();
    const photo = deps.getPhoto();
    syncOptions(prefs, facing === 'user');
    syncTier(prefs.tier);
    ensureLuts(photo);

    const interval = lastTs === null ? null : now - lastTs;

    let detectMs: number | null = null;
    if (tracker && shouldDetect(engine.tier, detectedLastFrame)) {
      const t0 = performance.now();
      tracks.detect(detectFaces(tracker), now, w, h);
      detectMs = performance.now() - t0;
      detectedLastFrame = true;
    } else {
      detectedLastFrame = false;
    }
    tracks.step(interval ?? 0, now);

    const t1 = performance.now();
    grainSeed = (grainSeed + 1) >>> 0;
    draw(photo, w, h);
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

  /** null = no answer (the throw is reported), so a hiccup never drops a track (A5) */
  function detectFaces(t: Tracker): Landmarks478[] | null {
    try {
      return t.detectVideo(video, performance.now(), { maxFaces: LIVE_DETECT_FACES });
    } catch (err) {
      reportError('live detect', err);
      return null;
    }
  }

  function draw(photo: PhotoParams, w: number, h: number): void {
    if (compare) engine.renderOriginal({ source: video, width: w, height: h });
    else {
      const r = engine.render({
        source: video,
        width: w,
        height: h,
        ...liveFrame(tracks.views(), tracks.anyFace, photo, persons),
        pictureFrame: deps.getFrame?.(),
        grainSeed,
      });
      lastPasses = r?.passes ?? [];
    }
  }

  /**
   * New measurement window + fresh face state (start, resume, flip / resolution change): the tracks' persons go to the
   * away pool, then the session resumes on this facing (another facing ends it; its clock skips the paused span, §7.5)
   */
  function resetSession(geo: string, now: number): void {
    paused = false;
    geometry = geo;
    tracks.reset();
    persons.resume(now, camera.snapshot.facing);
    sides = null;
    detectedLastFrame = false;
    lastTs = null;
    lastPresented = null;
    lastDetectTs = null;
    fpsEma.reset();
    auto.restart();
  }

  /** the tracks' persons to the away pool, and the session clock stops at the last live frame (§7.5) */
  function release(): void {
    tracks.reset();
    persons.pause(lastTs ?? performance.now());
  }

  function pause(): void {
    if (paused) return;
    paused = true;
    release();
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

  /** the photo's 濾鏡 and 質感 LUTs; the frame path draws each once resident, so only unasked LUTs need a request */
  function ensureLuts(photo: { filterId: string; look: { id: string } | null }): void {
    for (const r of photoLuts(photo)) {
      if (engine.lutState(r.kind, r.id) !== 'none') continue;
      engine.loadLut(r.kind, r.id).catch((err: unknown) => reportError(`${r.kind} ${r.id}`, err));
    }
  }

  function publish(now: number, force: boolean): void {
    const views = tracks.views();
    // the 左／右 reference: the target's track while it is found (a held one keeps the last answer)
    const ref = views.find((v) => v.selected);
    if (ref?.present) sides = gpLeftOnLeft(ref.face, sides);
    const s: LiveStats = {
      fps: paused ? 0 : fpsEma.value ? 1000 / fpsEma.value : 0,
      detectMs: detectEma.value ?? 0,
      renderMs: renderEma.value ?? 0,
      tier: engine.tier,
      face: views.some((v) => v.present),
      faces: views.length,
      gpLeftOnLeft: sides,
      target: persons.target(),
      personsVersion: persons.version,
    };
    if (dbg) {
      dbg.fps = s.fps;
      dbg.detectMs = s.detectMs;
      dbg.renderMs = s.renderMs;
      dbg.tier = s.tier;
      dbg.face = s.face;
      dbg.faces = s.faces;
      dbg.boxes = views.map((v) => ({ id: `t${v.id}`, ...v.box, person: `c${v.person}`, edited: v.edited, view: v.view, seen: v.seen }));
      dbg.selected = persons.all() ? 'all' : ref ? `t${ref.id}` : null;
      dbg.passes = lastPasses;
      // a self-healing tracker may come back on another delegate ('auto' → CPU fallback)
      if (tracker) dbg.delegate = tracker.delegate;
    }
    if (!deps.onStats) return;
    const changed =
      !lastEmitted ||
      lastEmitted.face !== s.face ||
      lastEmitted.faces !== s.faces ||
      lastEmitted.tier !== s.tier ||
      lastEmitted.gpLeftOnLeft !== s.gpLeftOnLeft ||
      lastEmitted.target !== s.target ||
      lastEmitted.personsVersion !== s.personsVersion;
    if (!force && !changed && now - lastEmitTs < STATS_EVERY_MS) return;
    lastEmitTs = now;
    lastEmitted = s;
    deps.onStats(s);
  }

  /** Re-draw the current frame without detection (compare toggles must not wait for the next frame). */
  function redraw(): void {
    if (stopped || paused || !haveFrame || !isLive() || !hasVideoFrame()) return;
    try {
      draw(deps.getPhoto(), video.videoWidth, video.videoHeight);
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
      // a loop stopped while live (重拍's loop, a bundle change) hands its people to the away pool as a pause does
      if (!paused) {
        paused = true;
        release();
      }
    },
    setCompare(on) {
      if (compare === on) return;
      compare = on;
      redraw();
    },
    capture() {
      if (stopped || paused || !haveFrame || !isLive() || !hasVideoFrame()) return null;
      const prefs = deps.getPrefs();
      const image = engine.renderToImageData(
        {
          source: video,
          width: video.videoWidth,
          height: video.videoHeight,
          ...liveFrame(tracks.views(), tracks.anyFace, deps.getPhoto(), persons),
          pictureFrame: deps.getFrame?.(),
          grainSeed,
        },
        { mirror: prefs.mirrorOnSave && camera.snapshot.facing === 'user' },
      );
      // the hand-over seed (C2): the target's track's last RAW box centre (not the smoothed one), unmirrored video UV
      const views = tracks.views();
      const b = views.find((v) => v.selected);
      const seed: FaceSeed = !views.length ? null : persons.all() ? 'all' : b ? { x: b.rawBox.x + b.rawBox.w / 2, y: b.rawBox.y + b.rawBox.h / 2 } : null;
      // every edited person in view, found or held (§5.3): the hand-over's boxes and params
      const handed = views.filter((v) => v.edited).map((v) => ({ rawBox: v.rawBox, params: persons.params(v.person)! }));
      return { image, seed, persons: handed };
    },
    hitTest(u, v, minW, minH) {
      const id = tracks.hitTest(u, v, minW, minH);
      return id === null ? null : (tracks.views().find((t) => t.id === id)?.person ?? null);
    },
    select(id: LivePersonId) {
      persons.pin(id);
    },
    selection: (): CameraSelection => persons.selection(),
    tracks: () => tracks.views(),
  };
}
