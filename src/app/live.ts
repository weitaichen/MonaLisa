// OWNER: app-glue agent. Live camera loop: rVFC → detect → adapt → render, face easing, auto-tier, debug state.
// Each tracked face renders its own camera person (camera per-person spec §8): the session (LivePersons) is the
// caller's, so a loop rebuilt on a new stream or bundle keeps everyone; pause and stop release the tracks into its away
// pool (§7.5). Detection runs one of two paths (§6.3, §6.6), the one 合照模式 picks (prefs.groupMode, K22, read every
// frame): the solo path (VIDEO on the whole frame, v0.5's selfie path, A1; option C on the back camera) or the group path
// (IMAGE calls on fixed views of the visible crop), at the cadence of §6.4; the shutter's frame gets its own detection
// when the last one is older (K13).
import { EDIT_DETECT_FACES, LIVE_DETECT_FACES, LIVE_DETECTOR, MAX_LIVE_FACES, MAX_RENDER_FACES } from '../config/limits';
import { gpLeftOnLeft } from '../edit/sides';
import { neutralPerson } from '../edit/state';
import { photoLuts } from '../engine/looks';
import type {
  CameraController,
  Engine,
  EngineOptions,
  FaceDetectorKind,
  FaceSeed,
  Facing,
  Landmarks478,
  PersonParams,
  PhotoParams,
  Prefs,
  PxRect,
  Rect,
  StillFrame,
  Tier,
  Tracker,
} from '../types';
import { debugState, reportError } from './debug';
import { FaceTracks, type CameraSelection, type LiveTrackView } from './faceTracks';
import { createVideoFrameSource, type FrameInfo, type FrameSource } from './frameSource';
import { AutoTier, DetectCadence, TimeEma, cadenceSample, effectiveEvery, frameCost, nextLowerTier, skippedFrames } from './liveCore';
import type { LivePersonId, LivePersons } from './livePersons';
import { layoutViews, mapLandmarks, refreshViews, ViewSchedule, viewScope, type LiveView, type ViewLayout } from './liveViews';

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
  /** the detection path (camera per-person spec §6.3, §6.6): VIDEO on the whole frame, or IMAGE calls on the views */
  path: 'solo' | 'group';
  /** frames per detection on the last frame (§6.4: 1 with one face or none, tier L 2; the cadence's k with ≥ 2) */
  every: number;
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
  /** read every frame: the engine options, the tier, and 合照模式 (`groupMode`: the path, liveRoute, K22) */
  getPrefs: () => Prefs;
  /**
   * step 2: the picture the shutter keeps, as normalized source UV (the ratio's centre crop, Camera.tsx); read every
   * frame, so a ratio change moves the vignette at once. Absent → the whole video frame. The group path's views lie
   * inside it (the visible crop, §6.6).
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
/** §6.4: T before the camera's own interval is measured */
const CAMERA_FRAME_MS = 1000 / 30;

/** the visible crop in the frame's px (rounded, inside the frame); the whole frame without one */
function cropPx(f: Rect | undefined, w: number, h: number): PxRect {
  if (!f || !(f.w > 0 && f.h > 0) || !Number.isFinite(f.x + f.y + f.w + f.h)) return { x: 0, y: 0, w, h };
  const x = Math.min(w - 1, Math.max(0, Math.round(f.x * w)));
  const y = Math.min(h - 1, Math.max(0, Math.round(f.y * h)));
  return { x, y, w: Math.max(1, Math.min(w - x, Math.round(f.w * w))), h: Math.max(1, Math.min(h - y, Math.round(f.h * h))) };
}

interface ViewCopy {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: CanvasDrawImage;
}

/** a view copy's canvas (§6.6 Copies): an OffscreenCanvas, an HTMLCanvasElement where its 2D context is missing; throws without either */
function createViewCopy(w: number, h: number): ViewCopy {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d', { alpha: false }) as CanvasDrawImage | null;
    if (ctx) return { canvas, ctx };
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('no 2D context for the view copy');
  return { canvas, ctx };
}

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

/**
 * The path and graph of a stream (camera per-person spec §6.3, K22): 合照模式 on → the group path, IMAGE calls on the
 * views of §6.6, on either camera from its first frame; off → the solo path, one VIDEO pass over the whole frame (v0.5's
 * selfie path on the front camera, option C on the back). Either path runs the facing's detector (LIVE_DETECTOR: a
 * mode switch between the paths, never a bundle switch). MAX_LIVE_FACES = 1 has no group path. The camera warms the
 * graph a new stream's first detection runs with it (Camera.tsx warmAfterPaint); the loop takes its path from it.
 */
export function liveRoute(facing: Facing, groupMode: boolean): { path: 'solo' | 'group'; mode: 'VIDEO' | 'IMAGE'; detector: FaceDetectorKind } {
  const group = groupMode && MAX_LIVE_FACES > 1;
  return { path: group ? 'group' : 'solo', mode: group ? 'IMAGE' : 'VIDEO', detector: LIVE_DETECTOR[facing] };
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
  /** §6.4's T: the camera's own frame interval, the EMA of the intervals between frames no detection delayed */
  const cameraEma = new TimeEma(STAT_TAU_MS);
  const cadence = new DetectCadence();
  const schedule = new ViewSchedule();
  const applied: Partial<EngineOptions> = {};

  /** grain seed: advanced once per drawn camera frame (moving grain, C §12 #11); redraws and the capture reuse it */
  let grainSeed = 0;
  let stopped = false;
  let compare = false;
  let paused = true;
  let detectedLastFrame = false;
  /** per stream session (resetSession, §6.3): the detector of both paths */
  let detector: FaceDetectorKind = 'camera';
  /** the path 合照模式 picked, synced every frame (syncPath, K22) */
  let path: 'solo' | 'group' = 'solo';
  /** frames since the last detection (Infinity: the next frame detects) */
  let sinceDetect = Infinity;
  /** frames per detection of the last frame (§6.4) */
  let every = 1;
  /** video.currentTime of the last detection and of the last processed frame (K13: the shutter's frame) */
  let lastDetectMedia = NaN;
  let lastMedia = NaN;
  /** the group path's views, memoized on the frame size, the crop in px, the facing and the detector (§6.6) */
  let layout: ViewLayout | null = null;
  let layoutKey = '';
  /** one reused copy canvas per view size (§6.6 Copies) */
  const copies = new Map<string, ViewCopy>();
  /** the refresh views of the last group-path detection (debug liveViews) */
  let viewIds: string[] = [];
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
    if (paused || geo !== geometry) resetSession(geo, now, facing);

    const prefs = deps.getPrefs();
    const photo = deps.getPhoto();
    syncPath(liveRoute(facing, prefs.groupMode).path);
    syncOptions(prefs, facing === 'user');
    syncTier(prefs.tier);
    ensureLuts(photo);

    const interval = lastTs === null ? null : now - lastTs;

    // §6.4: one face or none → every frame (tier L every second, A1); ≥ 2 → every k-th frame
    every = effectiveEvery(cadence.k, engine.tier, tracks.views().length);
    let detectMs: number | null = null;
    if (tracker && sinceDetect + 1 >= every) {
      const t0 = performance.now();
      detectOnce(tracker, now, w, h, facing);
      detectMs = performance.now() - t0;
      sinceDetect = 0;
      lastDetectMedia = video.currentTime;
    } else sinceDetect++;
    const detected = detectMs !== null;
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
    // §6.4's T: an interval neither this frame's nor the previous frame's detection can have stretched
    if (interval !== null && interval > 0 && !detected && !detectedLastFrame) cameraEma.update(interval, interval);
    cadence.update(now, detectEma.value, renderEma.value, cameraEma.value ?? CAMERA_FRAME_MS);
    detectedLastFrame = detected;

    if (prefs.tier === 'auto' && interval !== null) {
      // §6.4: a detection serving `every` frames is sampled amortized over them, without the skipped-frames charge (the
      // frame it drops is the detection's, which a lower render tier cannot fix)
      const cost =
        detectMs !== null && every > 1
          ? cadenceSample(renderMs, detectMs, every)
          : frameCost((detectMs ?? 0) + renderMs, interval, skippedFrames(info.presentedFrames, lastPresented));
      if (auto.sample(now, cost, interval)) stepDown();
    }

    lastTs = now;
    lastMedia = video.currentTime;
    lastPresented = info.presentedFrames;
    publish(now, false);
  }

  /**
   * 合照模式 toggled (K22): the stream moves to the path it picks on this frame, and this frame detects on it (the group
   * path's first call is the whole view). The tracks carry over both ways (their boxes are in stream UV), so every
   * person keeps their params and selection; the solo path's VIDEO graph finds the faces again on its first call (a held
   * track is continued, §7.3 item 4). One graph rebuild on a live frame, the mode switch (PGS, §10).
   */
  function syncPath(want: 'solo' | 'group'): void {
    if (want === path) return;
    path = want;
    schedule.reset();
    viewIds = [];
    sinceDetect = Infinity;
  }

  /** One detection (§6.3, §6.6): the solo path's VIDEO call, or the group path's next view */
  function detectOnce(t: Tracker, now: number, w: number, h: number, facing: Facing): void {
    if (path === 'solo') {
      tracks.detect(detectVideo(t), now, w, h);
      return;
    }
    const lay = layoutOf(w, h, facing);
    const refresh = refreshOf(lay, now);
    viewIds = refresh.map((v) => v.id);
    viewCall(t, schedule.next(lay, refresh, tracks.views().length), lay, now, w, h);
  }

  /** the solo path's call: null = no answer (the throw is reported), so a hiccup never drops a track (A5) */
  function detectVideo(t: Tracker): Landmarks478[] | null {
    try {
      return t.detectVideo(video, performance.now(), { maxFaces: LIVE_DETECT_FACES, detector });
    } catch (err) {
      reportError('live detect', err);
      return null;
    }
  }

  /**
   * One group-path call (§6.6): the view copied from the video, the IMAGE call on it, its faces mapped to stream UV and
   * matched in its scope. The copy and the call share one guard: a throw anywhere in them (no canvas to be had,
   * drawImage, detectView) is reported and, as a null answer, is no answer (A5: no aging, no drop, the pin kept).
   */
  function viewCall(t: Tracker, view: LiveView, lay: ViewLayout, now: number, w: number, h: number): void {
    let lms: Landmarks478[] | null;
    try {
      lms = t.detectView(copyOf(view), { maxFaces: EDIT_DETECT_FACES, detector });
    } catch (err) {
      reportError('live detect', err);
      lms = null;
    }
    if (lms === null) tracks.detect(null, now, w, h);
    else tracks.detect(lms.map((lm) => mapLandmarks(lm, view.rect, w, h)), now, w, h, viewScope(view, lay));
  }

  /** the view's rect of the current video frame, drawn into its size's reused canvas (unmirrored, §6.6 Copies) */
  function copyOf(view: LiveView): OffscreenCanvas | HTMLCanvasElement {
    const { w, h } = view.copy;
    const key = `${w}x${h}`;
    let c = copies.get(key);
    if (!c) {
      c = createViewCopy(w, h);
      copies.set(key, c);
    }
    const r = view.rect;
    c.ctx.drawImage(video, r.x, r.y, r.w, r.h, 0, 0, w, h);
    return c.canvas;
  }

  /** §6.6: the views of the visible crop (getFrame; the whole frame without it); a new layout drops the old sizes' copies */
  function layoutOf(w: number, h: number, facing: Facing): ViewLayout {
    const crop = cropPx(deps.getFrame?.(), w, h);
    const key = `${w}x${h}:${crop.x},${crop.y},${crop.w},${crop.h}:${facing}:${detector}`;
    if (!layout || key !== layoutKey) {
      layout = layoutViews(w, h, crop, facing, detector);
      layoutKey = key;
      copies.clear();
    }
    return layout;
  }

  /** §6.6 Schedule: the refresh views of the tracks' boxes predicted at `now` */
  function refreshOf(lay: ViewLayout, now: number): LiveView[] {
    const boxes: Rect[] = [];
    for (const v of tracks.views()) {
      const b = tracks.predicted(v.id, now);
      if (b) boxes.push(b);
    }
    return refreshViews(lay, boxes);
  }

  /**
   * K13: the shutter's frame is newer than the last detection (the cadence, tier L): one solo-path call, or every refresh
   * view of the current cycle (no scans, §6.6), through the same guarded calls, on the tracks' clock (the frame's media
   * time past the last processed frame's)
   */
  function detectForCapture(t: Tracker): void {
    if (lastTs === null || !Number.isFinite(lastMedia) || video.currentTime === lastDetectMedia) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    const capNow = lastTs + Math.max(1, (video.currentTime - lastMedia) * 1000);
    if (path === 'solo') tracks.detect(detectVideo(t), capNow, w, h);
    else {
      const lay = layoutOf(w, h, camera.snapshot.facing);
      for (const v of refreshOf(lay, capNow)) viewCall(t, v, lay, capNow, w, h);
    }
    lastDetectMedia = video.currentTime;
    tracks.step(0, capNow);
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
   * away pool, then the session resumes on this facing (another facing ends it; its clock skips the paused span, §7.5).
   * The stream session's detector is fixed here (§6.3): 'photo' only on a facing whose LIVE_DETECTOR is it and once the
   * full-range detector is in, so a download landing mid-stream never rebuilds the graph under the preview. The path is
   * 合照模式's, synced on every frame (syncPath).
   */
  function resetSession(geo: string, now: number, facing: Facing): void {
    paused = false;
    geometry = geo;
    tracks.reset();
    persons.resume(now, facing);
    sides = null;
    detector = tracker && LIVE_DETECTOR[facing] === 'photo' && tracker.photoDetector === 'full-range' ? 'photo' : 'camera';
    cadence.reset();
    schedule.reset();
    sinceDetect = Infinity;
    lastDetectMedia = NaN;
    viewIds = [];
    detectedLastFrame = false;
    lastTs = null;
    lastPresented = null;
    lastDetectTs = null;
    fpsEma.reset();
    cameraEma.reset();
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
      path,
      every,
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
      dbg.liveEvery = every;
      dbg.liveDetector = detector === 'photo' ? 'full-range' : 'short-range';
      dbg.livePath = path;
      dbg.liveViews = path === 'group' ? viewIds : [];
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
      copies.clear();
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
      // K13: the photo's faces drawn on their own landmarks
      if (tracker) detectForCapture(tracker);
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
