// OWNER: app-glue agent. Live camera loop: rVFC → detect → adapt → render, face easing, auto-tier, debug state.
// Each tracked face renders its own camera person (camera per-person spec §8): the session (LivePersons) is the
// caller's, so a loop rebuilt on a new stream or bundle keeps everyone; pause and stop release the tracks into its away
// pool (§7.5). Detection runs one of two paths (§6.3, §6.6), the one 合照模式 picks (prefs.groupMode, K22, read every
// frame): the solo path (VIDEO on the whole frame, v0.5's selfie path, A1; option C on the back camera) or the group path
// (IMAGE calls on fixed views of the visible crop), at the cadence of §6.4; the shutter's frame gets its own detection
// (K13): on the solo path when its call has not answered on it, on the group path one complete refresh cycle, decided
// as one call.
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
import {
  AutoTier,
  DetectCadence,
  TimeEma,
  autoTierSample,
  cadenceSample,
  cameraFrameMs,
  effectiveEvery,
  framesBlocked,
  lowerTier,
  nextLowerTier,
  skippedFrames,
} from './liveCore';
import type { LivePersonId, LivePersons } from './livePersons';
import { layoutViews, mapLandmarks, refreshViews, shutterScope, ViewSchedule, viewScope, type LiveView, type ViewLayout } from './liveViews';

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
   * params, and every person found never edited with theirs and null (camera per-person spec §5.3, round-1 review C7);
   * `held`: missing at the shutter, known missing to a call that could see them (a person unseen since a no-answer is
   * not, round-2 review D7, and one held before it still is, round-3 review E5); `stale`: not known missing, the box
   * the last answer's, not the captured frame's (unseen since a no-answer, E5, or found before the captured frame by a
   * view that had no answer on it, §6.6 Capture). Each of them answered for on the captured frame first (K13,
   * detectForCapture) when the tracker answers. null if no frame yet.
   */
  capture(): { image: ImageData; seed: FaceSeed; persons: { rawBox: Rect; params: PersonParams | null; held: boolean; stale: boolean }[] } | null;
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

/**
 * Tier the auto policy settled on in this page session, per path (合照模式, K22). Auto never steps back up within a
 * session, so a loop restarted after Review/Editor starts where the previous one ended. A step-down on the solo path
 * holds on the group path too (the same render); one taken on the group path holds there only, so turning 合照模式 off
 * renders at the solo path's tier again (round-1 review C3: a group scene's detections stepped every later stream of
 * the page session down, the solo selfie included).
 */
const sessionAutoTier: Record<'solo' | 'group', Tier> = { solo: 'H', group: 'H' };

/** the solo path's session tier: the device's, which the export and import limits read (exportPlan, flows.maxImportEdge) */
export function autoTierSession(): Tier {
  return sessionAutoTier.solo;
}

/** Forget the auto result so auto measures from H again on both paths (bench "auto" button, tests). */
export function resetAutoTierSession(): void {
  sessionAutoTier.solo = 'H';
  sessionAutoTier.group = 'H';
}

/**
 * The detector of each camera stream (§6.3), keyed by the video's `srcObject` (one MediaStream per getUserMedia: a start,
 * a resume, a flip): fixed by the first loop session on it, so a later loop over the same live stream (Review → 重拍, a
 * bundle change) and a pause on it (a context loss) keep it, and a full-range download landing meanwhile is taken by the
 * next stream, whose start warms the graph behind the spinner (Camera.tsx). Round-1 review C14: re-read on every loop's
 * first frame, 重拍 after the download compiled full-range (1.1–1.3 s on the desktop GPU) on a live frame.
 */
const streamDetectors = new WeakMap<object, FaceDetectorKind>();

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
 * §5.3, K13: a track the shot hands over: an edited person, found or held, and a person found never edited (a blocker,
 * round-1 review C7). One unseen since a no-answer (`stale`) is not known missing, so it goes too, a blocker when never
 * edited (round-2 review D7); one held before the no-answer stays held, so a never-edited one does not (round-3 review E5)
 */
const handedOver = (v: LiveTrackView): boolean => v.edited || v.present || v.stale;
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
 * U3 (§0.1, §3.7; round-6 review H1): the shot's render input. Every face found (present: by the shutter's call, or by
 * its last call when its views had no answer there) is drawn as the shot hands it over, whatever the preview's easing
 * had reached: an edited person at weight 1 with their params, a never-edited one at 0, each at presence 1, and the
 * global skin off while a face is found (as 編輯 draws a photo with faces). The easing is the preview's (§8): a person
 * found at the shutter after a hold, or re-identified there, had both easers at 0 (the shutter's step moves nothing),
 * so the photo left them out, and one found within FACE_EASE_MS before the tap was drawn part-way, while 編輯 opened
 * them adjusted. A held or stale face keeps its eased weight and presence (§11, capture with a person held). The live
 * easers are not touched: the preview after 重拍 goes on from them.
 */
function shotFrame(views: readonly LiveTrackView[], anyFace: number, photo: PhotoParams, persons: Pick<LivePersons, 'params' | 'ambient'>): StillFrame {
  const shown = views.map((v) => (v.present ? { ...v, weight: v.edited ? 1 : 0, presence: 1 } : v));
  return liveFrame(shown, views.some((v) => v.present) ? 1 : anyFace, photo, persons);
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
  /**
   * §6.4's T: the camera's own frame interval, the EMA of the frames' own timestamps' steps (cameraFrameMs), else of the
   * intervals after a frame that ran no detection (the rAF fallback)
   */
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
  /** the frames the last frame's amortized detection (every > 1) kept the loop from seeing, else 0 (§6.4, C3, D3) */
  let detectionBlocked = 0;
  /** per stream session (resetSession, §6.3): the detector of both paths */
  let detector: FaceDetectorKind = 'camera';
  /** the path 合照模式 picked, synced every frame (syncPath, K22) */
  let path: 'solo' | 'group' = 'solo';
  /** frames since the last detection (Infinity: the next frame detects) */
  let sinceDetect = Infinity;
  /** frames per detection of the last frame (§6.4) */
  let every = 1;
  /** video.currentTime of the last processed frame (K13: the shutter's frame) */
  let lastMedia = NaN;
  /**
   * K13's record of the frame the last detection ran on: its video.currentTime, the tracks' clock of its first detection
   * (a track a call on it fed has `seen` at or past it: found on the captured frame, the hand-over's `stale` else), and
   * whether the solo path's call answered on it (a no-answer is none, round-2 review D7). The shutter reads it and adds
   * its own calls to it (onDetectFrame)
   */
  let lastDetectMedia = NaN;
  let frameClock = NaN;
  let soloAnswered = false;
  /** rVFC mediaTime of the last processed frame (§6.4's T, cameraFrameMs) */
  let lastFrameMedia: number | null = null;
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
    // every frame, so a session begun under this loop (a flip's) learns it too
    persons.setPath(path, now);
    syncOptions(prefs, facing === 'user');
    syncTier(prefs.tier);
    ensureLuts(photo);

    const interval = lastTs === null ? null : now - lastTs;

    // §6.4: one face or none → every frame (tier L every second, A1); ≥ 2 → every k-th frame
    every = effectiveEvery(cadence.k, engine.tier, tracks.views().length);
    let detectMs: number | null = null;
    if (tracker && sinceDetect + 1 >= every) {
      const t0 = performance.now();
      onDetectFrame(now);
      detectOnce(tracker, now, w, h, facing);
      detectMs = performance.now() - t0;
      sinceDetect = 0;
    } else sinceDetect++;
    const detected = detectMs !== null;
    tracks.step(interval ?? 0, now);

    const t1 = performance.now();
    grainSeed = (grainSeed + 1) >>> 0;
    draw(photo, w, h);
    const workEnd = performance.now();
    const renderMs = workEnd - t1;
    haveFrame = true;

    if (interval !== null && interval > 0) fpsEma.update(interval, interval);
    if (detectMs !== null) {
      detectEma.update(detectMs, lastDetectTs === null ? 0 : now - lastDetectTs);
      lastDetectTs = now;
    }
    renderEma.update(renderMs, interval ?? 0);
    // §6.4's T on every frame, from the camera's own clock (the frames' timestamps, which no work here stretches); in
    // the rAF fallback, an interval after a frame that ran no detection (this frame's own detection runs after its
    // interval, so it cannot stretch it). Round-1 review C16: excluding every frame next to a detection never measured
    // T at k ≤ 2, so a 15–20 fps camera (low light) kept the 30 fps default and detected every second frame for nothing
    const cam = cameraFrameMs(info.mediaTime, lastFrameMedia, info.presentedFrames, lastPresented);
    if (cam !== null) cameraEma.update(cam, cam);
    else if (interval !== null && interval > 0 && !detectedLastFrame) cameraEma.update(interval, interval);
    cadence.update(now, detectEma.value, renderEma.value, cameraEma.value ?? CAMERA_FRAME_MS);
    detectedLastFrame = detected;

    const frameMs = cameraEma.value ?? CAMERA_FRAME_MS;
    /** this frame's detection when it serves `every` > 1 frames */
    const amortized = every > 1 ? detectMs : null;
    if (prefs.tier === 'auto' && interval !== null) {
      // §6.4: a detection serving `every` frames is sampled amortized over them (cadenceSample). The frames it drops
      // are the detection's, which a lower render tier cannot fix: they show up on the next frame's callback, which is
      // forgiven exactly those (framesBlocked, autoTierSample; round-1 review C3: charged there, a group scene's 1 ms
      // render stepped the tier down to L). Every other drop is charged where it shows up, a detecting frame's own
      // included (round-2 review D3: one frame of GPU back-pressure at k 2 never stepped down)
      const work = amortized !== null ? cadenceSample(renderMs, amortized, every) : (detectMs ?? 0) + renderMs;
      const skipped = skippedFrames(info.presentedFrames, lastPresented);
      const s = autoTierSample(work, interval, skipped, detectionBlocked, frameMs);
      if (auto.sample(now, s.cost, s.dtMs)) stepDown();
    }
    // the frames this frame's amortized detection passes, timed from the frame's own presentation to its work's end
    const elapsed = info.presentationTime === null ? null : workEnd - info.presentationTime;
    detectionBlocked = amortized === null ? 0 : framesBlocked(amortized, elapsed, frameMs);

    lastTs = now;
    lastMedia = video.currentTime;
    lastPresented = info.presentedFrames;
    lastFrameMedia = info.mediaTime;
    publish(now, false);
  }

  /**
   * 合照模式 toggled (K22): the stream moves to the path it picks on this frame, and this frame detects on it (the group
   * path's first call is the whole view). The tracks carry over both ways (their boxes are in stream UV), so every
   * person keeps their params and selection; the solo path's VIDEO graph finds the faces again on its first call (a held
   * track is continued, §7.3 item 4). A face only the path left behind finds (a far one, one mostly outside the crop) is
   * dropped after the hold, and its person waits away, their grace stopped, until that path is back (LivePersons.setPath,
   * at most LIVE_IDLE_MAX_MS). One graph rebuild on a live frame, the mode switch (PGS, §10). The solo path uses no view
   * copy, so moving to it releases them (round-1 review C17). Auto-tier measures each path on its own (its session tier,
   * syncTier): a new window, so the path left behind's frames are never charged to this one (round-1 review C3).
   */
  function syncPath(want: 'solo' | 'group'): void {
    if (want === path) return;
    path = want;
    schedule.reset();
    viewIds = [];
    sinceDetect = Infinity;
    auto.restart();
    if (path === 'solo') releaseCopies();
  }

  /** One detection (§6.3, §6.6): the solo path's VIDEO call, or the group path's next view */
  function detectOnce(t: Tracker, now: number, w: number, h: number, facing: Facing): void {
    if (path === 'solo') {
      soloCall(t, now, w, h);
      return;
    }
    const lay = layoutOf(w, h, facing);
    const refresh = refreshOf(lay, now);
    viewIds = refresh.map((v) => v.id);
    viewCall(t, schedule.next(lay, refresh, tracks.views().length), lay, now, w, h);
  }

  /** the solo path's call on the whole frame, which answers for every track (K13: noted when it answers) */
  function soloCall(t: Tracker, now: number, w: number, h: number): void {
    const lms = detectVideo(t);
    tracks.detect(lms, now, w, h);
    if (lms !== null) soloAnswered = true;
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

  /** One group-path call in the loop (§6.6): the view's answer matched in its scope; a no-answer is that view's (F3, G4) */
  function viewCall(t: Tracker, view: LiveView, lay: ViewLayout, now: number, w: number, h: number): void {
    tracks.detect(viewAnswer(t, view, w, h), now, w, h, viewScope(view, lay));
  }

  /**
   * One group-path view's answer (§6.6): the view copied from the video, the IMAGE call on it, its faces mapped to
   * stream UV. The copy and the call share one guard: a throw anywhere in them (no canvas to be had, drawImage,
   * detectView) is reported and, as a null answer, is no answer (A5: no aging, no drop, the pin kept).
   */
  function viewAnswer(t: Tracker, view: LiveView, w: number, h: number): Landmarks478[] | null {
    let lms: Landmarks478[] | null;
    try {
      lms = t.detectView(copyOf(view), { maxFaces: EDIT_DETECT_FACES, detector });
    } catch (err) {
      reportError('live detect', err);
      lms = null;
    }
    return lms === null ? null : lms.map((lm) => mapLandmarks(lm, view.rect, w, h));
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

  /** §6.6: the views of the visible crop (getFrame; the whole frame without it); a new layout releases the old sizes' copies */
  function layoutOf(w: number, h: number, facing: Facing): ViewLayout {
    const crop = cropPx(deps.getFrame?.(), w, h);
    const key = `${w}x${h}:${crop.x},${crop.y},${crop.w},${crop.h}:${facing}:${detector}`;
    if (!layout || key !== layoutKey) {
      layout = layoutViews(w, h, crop, facing, detector);
      layoutKey = key;
      releaseCopies();
    }
    return layout;
  }

  /**
   * §6.6 Copies: every view copy's backing store freed at once (0 × 0), then forgotten; iOS caps the total canvas memory
   * and frees a dropped canvas only on GC (round-1 review C17: 合照模式 turned off, a ratio change and a stopped loop
   * kept or piled them up)
   */
  function releaseCopies(): void {
    for (const c of copies.values()) {
      c.canvas.width = 0;
      c.canvas.height = 0;
    }
    copies.clear();
  }

  /** §6.6 Schedule: the refresh views of the tracks' boxes predicted at `now` */
  function refreshOf(lay: ViewLayout, now: number): LiveView[] {
    return refreshViews(lay, trackBoxes(now));
  }

  /** every track's box predicted at `now` (found, held or unseen) */
  function trackBoxes(now: number): Rect[] {
    const boxes: Rect[] = [];
    for (const v of tracks.views()) {
      const b = tracks.predicted(v.id, now);
      if (b) boxes.push(b);
    }
    return boxes;
  }

  /** K13: a detection on a frame newer than the record's starts the record of that frame (`clock`: the tracks' clock) */
  function onDetectFrame(clock: number): void {
    if (video.currentTime === lastDetectMedia) return;
    lastDetectMedia = video.currentTime;
    frameClock = clock;
    soloAnswered = false;
  }

  /**
   * K13: every track the shot hands over is answered for on the captured frame before it is drawn and handed over, on
   * the tracks' clock (the frame's media time past the last processed frame's). The solo path's one call answers for
   * every track, so it runs once unless the frame's call answered (a no-answer is none, round-2 review D7). The group
   * path runs one complete refresh cycle on the captured frame and decides it as one call (`shutterCall`).
   */
  function detectForCapture(t: Tracker): void {
    if (lastTs === null || !Number.isFinite(lastMedia)) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    const capNow = lastTs + Math.max(1, (video.currentTime - lastMedia) * 1000);
    if (path === 'solo') {
      if (video.currentTime === lastDetectMedia && soloAnswered) return;
      onDetectFrame(capNow);
      soloCall(t, capNow, w, h);
    } else {
      onDetectFrame(capNow);
      shutterCall(t, capNow, w, h);
    }
    tracks.step(0, capNow);
  }

  /**
   * K13 on the group path (§6.6 Capture): one complete refresh cycle on the captured frame, whatever a call on it had
   * answered: the whole view, then, in raster order, each tile that refreshes a track (found, held or unseen) or the
   * last box of an away person in grace (`awayBoxes`: a person back just before the shutter is found in their own view,
   * a tile for a small face), each through the guarded call. Their answers are one decision (FaceTracks.detectViews, in
   * the union of the views that answered, shutterScope): a face any view found is found; a track is missed only when a
   * view that answered could miss it and none found it; a view with no answer is no event for its tracks (one no call
   * on the frame fed keeps its last answer, handed over `stale`: capture); everyone is re-identified once, over every
   * face. It replaces round 2–4's per-view calls and the plan that skipped views by what the frame's call had
   * fed (round-5 review G1: a newer frame whose plan held a tile only never ran the whole view, so a large edited person
   * back within the grace was left out; G2, Codex P2: a later tile that missed a face an earlier tile fed on the frame
   * marked it missing, an edited person handed over held, a never-edited one dropped). The extra calls are the
   * shutter's, once per shot (§10)
   */
  function shutterCall(t: Tracker, now: number, w: number, h: number): void {
    const lay = layoutOf(w, h, camera.snapshot.facing);
    const answers: { view: LiveView; lms: Landmarks478[] }[] = [];
    for (const view of refreshViews(lay, [...trackBoxes(now), ...persons.awayBoxes(now)])) {
      const lms = viewAnswer(t, view, w, h);
      if (lms !== null) answers.push({ view, lms });
    }
    const scope = shutterScope(answers.map((a) => a.view), lay);
    tracks.detectViews(answers.map((a) => ({ lms: a.lms, scope: viewScope(a.view, lay) })), now, w, h, scope);
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
   * The stream's detector is fixed by its first session (§6.3, streamDetectors): 'photo' only on a facing whose
   * LIVE_DETECTOR is it and once the full-range detector is in, so a download landing mid-stream never rebuilds the graph
   * under the preview, in this loop or a later one on the same stream. The path is 合照模式's, synced on every frame
   * (syncPath).
   */
  function resetSession(geo: string, now: number, facing: Facing): void {
    paused = false;
    geometry = geo;
    tracks.reset();
    persons.resume(now, facing);
    sides = null;
    // the stream's detector (streamDetectors): a stream without one (its first session) fixes it here
    const stream = video.srcObject;
    const known = stream ? streamDetectors.get(stream) : undefined;
    detector = known ?? (tracker && LIVE_DETECTOR[facing] === 'photo' && tracker.photoDetector === 'full-range' ? 'photo' : 'camera');
    if (stream && known === undefined) streamDetectors.set(stream, detector);
    cadence.reset();
    schedule.reset();
    sinceDetect = Infinity;
    lastDetectMedia = NaN;
    frameClock = NaN;
    soloAnswered = false;
    viewIds = [];
    detectedLastFrame = false;
    detectionBlocked = 0;
    lastTs = null;
    lastPresented = null;
    lastFrameMedia = null;
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
    lastFrameMedia = null;
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
    // auto: the path's own session tier (a 合照模式 toggle moves to the other path's, syncPath runs first)
    const want = isAuto ? sessionAutoTier[path] : pref;
    if (engine.tier !== want) {
      engine.setTier(want);
      auto.restart();
    }
  }

  /** auto's step-down, on this path's session tier; the solo path's holds on the group path too (the same render, C3) */
  function stepDown(): void {
    const lower = nextLowerTier(engine.tier);
    if (lower) {
      sessionAutoTier[path] = lower;
      if (path === 'solo') sessionAutoTier.group = lowerTier(sessionAutoTier.group, lower);
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
      releaseCopies();
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
      // K13: the photo's faces drawn on their own landmarks; U3: each found one as the shot hands it over (shotFrame)
      if (tracker) detectForCapture(tracker);
      const prefs = deps.getPrefs();
      const image = engine.renderToImageData(
        {
          source: video,
          width: video.videoWidth,
          height: video.videoHeight,
          ...shotFrame(tracks.views(), tracks.anyFace, deps.getPhoto(), persons),
          pictureFrame: deps.getFrame?.(),
          grainSeed,
        },
        { mirror: prefs.mirrorOnSave && camera.snapshot.facing === 'user' },
      );
      // the hand-over seed (C2): the target's track's last RAW box centre (not the smoothed one), unmirrored video UV
      const views = tracks.views();
      const b = views.find((v) => v.selected);
      const seed: FaceSeed = !views.length ? null : persons.all() ? 'all' : b ? { x: b.rawBox.x + b.rawBox.w / 2, y: b.rawBox.y + b.rawBox.h / 2 } : null;
      // the hand-over's persons (§5.3, handedOver): every edited person in view with their params, found or held, and
      // every person found never edited (params null), whose box keeps their own face from an edited person's (round-1
      // review C7); `held` only for a person a call that can see them missed (round-2 review D7: a no-answer at the
      // shutter dropped every blocker and marked every edited person held), kept through a no-answer (round-3 review E5:
      // marked unseen there, a person who had left went as found, with the box from before they left); `stale` for one
      // unseen since a no-answer: not known missing, but the box is not the captured frame's, so 編輯 pairs it as a
      // guess, by IoU or with a face of its size by the padded centre (E5: as found, it took a smaller face standing
      // where they were by the padded centre; round-4 review F2: by IoU alone, a person who had moved a third of a face
      // width was dropped and counted, though 編輯 found the face). So is one found before the captured frame whom no
      // call on it fed (`frameClock`, K13's record): their views had no answer at the shutter, which is no event for
      // them (§6.6 Capture), so their box is not the frame's. A box fed on the captured frame, by the frame's own call or
      // the shutter's, goes as found (round-4 review F3)
      const handed = views.filter(handedOver).map((v) => ({
        rawBox: v.rawBox,
        params: v.edited ? persons.params(v.person)! : null,
        held: !v.present && !v.stale,
        stale: v.stale || (v.present && v.seen < frameClock),
      }));
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
