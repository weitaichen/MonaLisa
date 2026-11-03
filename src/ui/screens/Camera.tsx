// Camera 拍攝 (spec §7.2.2): gate → live beautified preview framed to 3:4 / 1:1 / 9:16,
// BeautyPanel + floating slider, timer, flip, hold-to-compare, shutter → Review.
// 拍照 / 錄影 (beauty video spec §4.1): in 錄影 the shutter records the beautified preview with the microphone → the clip
// screen; the preview going away stops a recording and keeps it (§4.6).
// 美體 is photo-only for now (body research report P1): the tab is shown with every item off and a note.
import { useEffect, useRef, useState } from 'preact/hooks';
import { cameraTapAction, ChipGate, coverTapUv } from '../../app/faceTracks';
import { liveRoute, type LiveLoop, type LiveStats } from '../../app/live';
import type { LivePersonId } from '../../app/livePersons';
import type { CameraController, CameraSnapshot, EditState, Facing } from '../../types';
import { lensFor, LIVE_PERSONS, type Lens, type PersonInfo } from '../../edit/lens';
import { handOverOf } from '../../edit/migrate';
import { cameraScreenSwap } from '../../edit/sides';
import { cameraEdit, LIVE, neutralPerson, personOf } from '../../edit/state';
import { MIC_ANSWER_MS, MIC_PROMPT_MS, type MicState } from '../../media/mic';
import { createRecordCanvas, type RecordCanvas } from '../../media/recordCanvas';
import { clipFile, startClipRecorder, type ClipRecorder, type ClipResult } from '../../media/recorder';
import { takeCameraPersonsHint, takeGroupModeHint, takeGroupModeOnToast } from '../../store/settings';
import { cameraErrorCopy } from '../cameraErrors';
import { beginDrag, cameraLensInfo, cameraSession, endCameraSession, keepDrag, panelPerson, writePerson, type CameraDrag } from '../cameraSession';
import { BeautyPanel, FACE_TABS } from '../components/BeautyPanel';
import { CameraFaceMarker } from '../components/CameraFaceMarker';
import { CanvasHost } from '../components/CanvasHost';
import { IconButton } from '../components/Controls';
import { EngineStatus } from '../components/EngineStatus';
import { SliderRow } from '../components/Slider';
import { Status } from '../components/Status';
import { debug, reportError } from '../debug';
import { deps } from '../deps';
import { openInEditor, pickPhoto } from '../flows';
import { GROUP_MODE_LABEL, groupModeAvailable, showGroupSceneHints, toggleGroupMode, warmsOnStart } from '../groupMode';
import { Icon } from '../icons';
import { cropImageData, grabOriginalFrame, normalizedCropRect, shotPersons, shotSeed } from '../imaging';
import { CAMERA_BODY, INITIAL_SELECTION, makeupNote, photoScoped, sliderFor, type BodyContext, type PanelSelection } from '../panelModel';
import { haptic, isStandalone } from '../platform';
import { ensureEngine, getCamera, getMic, stopCamera, svc } from '../services';
import { app, go, RATIO_VALUE, RATIOS, setLook, setPrefs, TIMERS, toast, type AppState } from '../state';
import { useStore } from '../store';
import { clipCapMs, clipClock, clipOutcome, clipSize, VIDEO_TOASTS, videoMime } from '../videoMode';
import { requestLut, useAdjustFailureNotice, useHold, useLutLoader } from './hooks';

let lastSel: PanelSelection = INITIAL_SELECTION;
/** 美體 is photo-only: its note offers the import right where the user looked for it */
const cameraBody: BodyContext = {
  ...CAMERA_BODY,
  action: { label: '匯入照片', run: () => pickPhoto((f) => void openInEditor(f, { returnTo: 'camera', picked: true })) },
};
/** basic-mode notes are announced once per engine bundle, not on every visit */
let notedBundle: unknown = null;

/** 拍照 / 錄影 (beauty video spec §4.1): radios, so the only button named 拍照 stays the photo shutter (e2e locators) */
const MODES: readonly { mode: AppState['cameraMode']; label: string }[] = [
  { mode: 'photo', label: '拍照' },
  { mode: 'video', label: '錄影' },
];

/**
 * The record flow (beauty video spec §4.1, task-6 rulings 8 and 15): idle → (the 計時 countdown) → starting (the shutter
 * waits, aria-busy, for the microphone's answer) → recording → stopping (until the recorder hands out the clip) → the
 * clip screen, or idle with 錄影時間太短. From starting to the stop's end every control but the beauty panel and the
 * face taps is locked.
 */
type RecPhase = 'idle' | 'starting' | 'recording' | 'stopping';

/** A recording under way: what it records into and with, and its cap */
interface Recording {
  rc: RecordCanvas;
  recorder: ClipRecorder;
  /** the cap's timeout (clipCapMs) */
  cap: number;
  /** set by the first stop trigger (the tap, the cap, the preview gone, the recorder ending): the others do nothing */
  stopping: boolean;
}

/**
 * The graph the new stream's first detection runs (§6.3, liveRoute): 合照模式 on, the group path's IMAGE; off, one VIDEO
 * pass (the front camera's solo path, the back camera's option C); each on its facing's detector. Run once the
 * 「正在開啟相機…」 spinner has painted: the
 * first full-range inference compiles for 1.1–1.3 s on the desktop GPU (§6.1) and blocks the main thread, so a call
 * inside the tap would freeze the old preview before the spinner shows. When the stream wins the race, its first call
 * pays the compile instead.
 */
function warmAfterPaint(f: Facing): void {
  requestAnimationFrame(() =>
    setTimeout(() => {
      try {
        const e = svc.get().engine;
        const tracker = e.state === 'ready' ? e.bundle.tracker : null;
        const r = liveRoute(f, app.get().prefs.groupMode);
        tracker?.warm(r.mode, r.detector);
      } catch (err) {
        reportError(err, 'tracker.warm');
      }
    }, 0),
  );
}

export function Camera() {
  const look = useStore(app, (s) => s.look);
  const prefs = useStore(app, (s) => s.prefs);
  const ratio = useStore(app, (s) => s.ratio);
  const timer = useStore(app, (s) => s.timer);
  /** 拍照 or 錄影 (beauty video spec §4.1): in memory, kept across the clip screen (重錄) */
  const cameraMode = useStore(app, (s) => s.cameraMode);
  /** 全部套用 (S §2.5): in memory, kept across Review and retakes, mirrored into the camera session; off when the session ends */
  const cameraAll = useStore(app, (s) => s.cameraAll);
  const engine = useStore(svc, (s) => s.engine);
  const bundle = engine.state === 'ready' ? engine.bundle : null;
  const lost = useStore(svc, (s) => s.lost);
  /** the tracker is replacing a dead graph ('lost') or paused its automatic retries ('failed') */
  const trackerHealth = useStore(svc, (s) => s.tracker);

  const [ctrl, setCtrl] = useState<CameraController | null>(null);
  const [snap, setSnap] = useState<CameraSnapshot | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [startErr, setStartErr] = useState<string | null>(null);
  const [sel, setSelState] = useState(lastSel);
  const [collapsed, setCollapsed] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [flash, setFlash] = useState(0);
  const [noFace, setNoFace] = useState(false);
  const [loop, setLoop] = useState<LiveLoop | null>(null);
  /** the 全部套用 chip shows (ChipGate's 300 / 1200 ms debounce of the shown tracks) */
  const [chip, setChip] = useState(false);
  const chipGate = useRef(new ChipGate());
  /** the accent ring of the last tap selection: the tapped person (800 ms, CameraFaceMarker) */
  const [ring, setRing] = useState<{ person: LivePersonId; at: number } | null>(null);
  /** shown tracks, from LiveStats: redraws the marker when the count changes */
  const [shownFaces, setShownFaces] = useState(0);
  /** this mount already saw ≥ 2 faces: the one-time hints (§3.1, K22) are asked for once, not on every stats tick */
  const sawGroup = useRef(false);
  /** the second one-time hint, shown after the first (showGroupSceneHints); cancelled on unmount, its flag kept */
  const hintTimer = useRef(0);
  /** LiveStats.gpLeftOnLeft: the tracked face's halves on the unmirrored frame (the 左／右 chips, S5 §3.4) */
  const [gpLeft, setGpLeft] = useState<boolean | null>(null);

  const lookRef = useRef(look);
  lookRef.current = look;
  /** the camera session: every person's params, the selection, 全部套用 (camera per-person spec §3.11, §5.1) */
  const session = cameraSession();
  /** the slider drag in progress: it writes the persons it started on until it commits (§3.2, Review Focus #3) */
  const drag = useRef<CameraDrag | null>(null);
  /** LiveStats.personsVersion, and every panel write: a target or param change re-renders the panel */
  const [, setPersonsTick] = useState(0);
  /** the camera is one person, 'live' (RM §3.7): the panel uses the editor's lens and code */
  // 左／右 follow the tracked face through the preview mirror (S5 §3.4): a front ↔ back flip, or the face turned upside
  // down, re-maps the side chips on the next render (S5 §7)
  const livePersons: PersonInfo[] = [{ ...LIVE_PERSONS[0], screenSwap: cameraScreenSwap(snap?.facing ?? 'user', gpLeft) }];
  /**
   * the panel's lens (§3.2): the photo look over one person, 'live', holding the target's params (a drag's lead while it
   * runs; 基本模式: the session's ambient person, §3.6)
   */
  const lensOf = (l: typeof look): Lens => {
    const basic = !!bundle?.basic;
    const person = basic ? session.ambient : panelPerson(session, drag.current);
    // noFace whenever there is no target (cameraLensInfo), before the stream is live too (C4), and whatever
    // trackerHealth says: a person slider or preset would write nobody; while the tracker restarts its badge says why
    return lensFor(cameraEdit(l.photo, person), { kind: 'person', id: LIVE }, livePersons, LIVE, {
      camera: cameraLensInfo(session, drag.current, { shown: shownFaces, all: cameraAll, basic, live }),
    });
  };
  /**
   * a panel edit against the lens it was made on (`from`): the photo part to the look (meiyan.look.v1, its person 原圖,
   * K15), the person part to the drag's persons or the target (全部套用: everyone in view), 基本模式 to the ambient person
   */
  const setEdit = (e: EditState, from: Lens = lensOf(lookRef.current)) => {
    if (e.photo !== from.edit.photo) setLook({ photo: e.photo, person: neutralPerson() });
    const person = personOf(e, LIVE);
    if (person !== personOf(from.edit, LIVE)) {
      if (bundle?.basic) session.setAmbient(person);
      else writePerson(session, person, drag.current);
    }
    // a write re-renders the panel whether or not a loop runs (基本模式 before the stream is live included)
    setPersonsTick(session.version);
  };
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const countTimer = useRef(0);
  /** the running live loop, maintained by its effect: a countdown captures from whichever loop is current */
  const loopRef = useRef<LiveLoop | null>(null);
  /** 按住對比 as the loop was last told (useHold tells only of a change): a loop restarted under it takes it on */
  const compareOn = useRef(false);
  const capturing = useRef(false);
  /** 錄影's flow (RecPhase): the state for render, the ref for handlers and the callbacks of earlier renders */
  const [recPhase, setRecPhaseState] = useState<RecPhase>('idle');
  const recPhaseRef = useRef<RecPhase>('idle');
  const setRecPhase = (p: RecPhase) => {
    recPhaseRef.current = p;
    setRecPhaseState(p);
  };
  /** performance.now() at the recording's start: the badge counts from it */
  const [recSince, setRecSince] = useState(0);
  /** the recording under way, from its start until its stop has handed out the clip */
  const rec = useRef<Recording | null>(null);
  /** bumped by each record tap and cancel, by leaving 錄影 and the unmount: an older start does nothing (ruling 4) */
  const startSeq = useRef(0);
  /** false once unmounted: a stop that resolves later drops its clip (ruling 15) */
  const mounted = useRef(true);
  /** the microphone's state as its listener last heard it (ruling 2: render never reads mic.state, which can notify) */
  const [micState, setMicState] = useState<MicState>('idle');
  /** 「無法使用麥克風」 is said once per camera visit (spec §4.2) */
  const silentNoted = useRef(false);

  const setSel = (s: PanelSelection) => {
    lastSel = s;
    setSelState(s);
  };

  // camera controller (one per session)
  useEffect(() => {
    let c: CameraController;
    try {
      c = getCamera();
    } catch (e) {
      setFatal(reportError(e, 'createCamera'));
      return;
    }
    setCtrl(c);
    setSnap(c.snapshot);
    return c.subscribe((s) => {
      setSnap(s);
      // beauty video spec §4.6: the camera no longer live stops a recording (kept) and turns the microphone off here,
      // in the camera's own call. The app hidden is one (0.5.1 ends the stream inside the visibilitychange handler):
      // the [ready] and [live] effects below do the same only after the next frame, which a hidden page never draws,
      // so the recorder and the microphone would capture on, maybe into a suspension (camera.ts: the next launch's
      // stuck camera). They stay for a lost context and a loop gone, and find it done. Refs and stable setters only:
      // this closure is the first render's. At once on subscribe too, with no recording and an idle microphone: nothing
      if (s.state === 'live') return;
      cancelStart();
      if (rec.current) void stopRecording(rec.current);
      getMic().release();
    });
  }, []);

  // engine (no gesture needed): resolves while the user looks at the gate
  useEffect(() => {
    if (svc.get().engine.state !== 'unsupported') ensureEngine().catch(() => undefined);
  }, []);

  useLutLoader(bundle?.engine ?? null, look.photo);
  useAdjustFailureNotice(bundle?.engine ?? null, look.photo);

  useEffect(() => {
    if (engine.state !== 'ready' || !engine.note || notedBundle === engine.bundle) return;
    notedBundle = engine.bundle;
    toast(engine.note, 4000);
  }, [engine]);

  // live loop while the stream is live and the engine is ready
  const live = snap?.state === 'live';
  useEffect(() => {
    if (!ctrl || !bundle || !live) return;
    // a tracker come to a 基本模式 session (0.5.1's late tracker, RM §15): its all-skin edit goes on to every face as
    // 全部套用 does, the chip with it (round-7 review J1)
    if (bundle.tracker && cameraSession().ambientToAll()) app.set({ cameraAll: true });
    let l: LiveLoop;
    let lastFace: boolean | null = null;
    let faceTimer = 0;
    const onStats = (s: LiveStats) => {
      setShownFaces(s.faces);
      setGpLeft(s.gpLeftOnLeft);
      // the target or someone's params changed (a tap, a re-identification, the auto pick): the panel re-reads (§3.2)
      setPersonsTick(s.personsVersion);
      setChip(chipGate.current.update(s.faces, app.get().cameraAll, performance.now()));
      // ≥ 2 faces shown: 「點選畫面中的臉，可個別調整」 the first time (§3.1, K12), then, with 合照模式 off, that it lets
      // far people be selected (K22); each once per install, the second after the first (its flag taken when it shows)
      if (s.faces >= 2 && !sawGroup.current) {
        sawGroup.current = true;
        showGroupSceneHints({
          takePersons: takeCameraPersonsHint,
          takeGroupMode: takeGroupModeHint,
          skipGroupMode: () => app.get().prefs.groupMode || app.get().screen.name !== 'camera',
          toast: (t) => toast(t, 3200),
          later: (run, ms) => {
            hintTimer.current = window.setTimeout(run, ms);
          },
        });
      }
      if (s.face === lastFace) return;
      lastFace = s.face;
      clearTimeout(faceTimer);
      // debounce so blinks / brief misses don't flash the badge
      if (s.face) setNoFace(false);
      else faceTimer = window.setTimeout(() => setNoFace(true), 1200);
    };
    try {
      l = deps.startLiveLoop({
        camera: ctrl,
        engine: bundle.engine,
        tracker: bundle.tracker,
        // the camera session outlives this loop (a new stream, Review → 重拍, a bundle change keep everyone, §3.11)
        persons: cameraSession(),
        getPhoto: () => lookRef.current.photo,
        getPrefs: () => prefsRef.current,
        // the picture the shutter keeps (captureFrom crops to the same ratio): vignette, grain and the group path's views follow it
        getFrame: () => normalizedCropRect(ctrl.video.videoWidth, ctrl.video.videoHeight, RATIO_VALUE[app.get().ratio]),
        onStats,
      });
    } catch (e) {
      setFatal(reportError(e, 'startLiveLoop'));
      return;
    }
    loopRef.current = l;
    // a new bundle (a tracker come) restarts the loop within one render, under a held 按住對比 ([ready] does not change)
    if (compareOn.current) {
      try {
        l.setCompare(true);
      } catch (e) {
        reportError(e, 'setCompare');
      }
    }
    // ... and under a recording (beauty video spec §4.3, ruling 12): the old loop's stop() dropped the sink, the new
    // one feeds the same recording canvas, so the clip goes on with a short gap
    const recording = rec.current;
    if (recording && !recording.stopping) l.setRecordSink(recording.rc.sink);
    setLoop(l);
    return () => {
      clearTimeout(faceTimer);
      l.stop();
      if (loopRef.current === l) loopRef.current = null;
      // flip / interruption / bundle change cancels a countdown (the shutter is disabled meanwhile, so the
      // user could not cancel it, and it would fire into a stopped loop)
      clearInterval(countTimer.current);
      setCount(null);
      setLoop(null);
      setNoFace(false);
    };
  }, [ctrl, bundle, live]);

  useEffect(
    () => () => {
      clearInterval(countTimer.current);
      clearTimeout(hintTimer.current);
    },
    [],
  );

  // the page's microphone (ruling 18), its state mirrored for 切換鏡頭's lock. The camera screen going (to the clip
  // screen too, ruling 16) stops a recording without keeping it and releases the microphone (beauty video spec §4.2)
  useEffect(() => {
    const mic = getMic();
    const off = mic.subscribe(setMicState);
    setMicState(mic.state);
    return () => {
      mounted.current = false;
      startSeq.current++;
      const r = rec.current;
      if (r && !r.stopping) void finishRecording(r);
      off();
      mic.release();
    };
  }, []);

  const hold = useHold((on) => {
    compareOn.current = on;
    try {
      loop?.setCompare(on);
    } catch (e) {
      reportError(e, 'setCompare');
    }
  });

  const start = () => {
    if (!ctrl) return;
    haptic();
    setStartErr(null);
    // synchronous inside the tap: iOS requires the gesture for getUserMedia
    let p: Promise<void>;
    try {
      p = ctrl.snapshot.state === 'interrupted' ? ctrl.resume() : ctrl.start(ctrl.snapshot.facing);
    } catch (e) {
      p = Promise.reject(e);
    }
    p.catch((e: unknown) => setStartErr(reportError(e, 'camera.start')));
    // a start straight on the back camera, or on the front camera with 合照模式 on, warms its graph behind the spinner (§6.3)
    if (warmsOnStart(ctrl.snapshot.facing, app.get().prefs.groupMode)) warmAfterPaint(ctrl.snapshot.facing);
  };

  const close = () => {
    // ✕ is locked while recording (beauty video spec §4.1)
    if (recPhaseRef.current !== 'idle') return;
    clearInterval(countTimer.current);
    // ✕ ends the camera session first, so the stopping loop's releases are dropped (Review Focus #1)
    endCameraSession();
    drag.current = null;
    stopCamera();
    go({ name: 'home' });
  };

  const capture = async () => {
    const l = loopRef.current;
    if (!l || !ctrl || capturing.current) return;
    capturing.current = true;
    try {
      await captureFrom(l, ctrl);
    } finally {
      capturing.current = false;
    }
  };

  const captureFrom = async (l: LiveLoop, cam: CameraController) => {
    hold.release();
    let shotOut: ReturnType<LiveLoop['capture']>;
    try {
      shotOut = l.capture();
    } catch (e) {
      toast(`拍攝失敗：${reportError(e, 'capture')}`, 4000);
      return;
    }
    if (!shotOut) {
      toast('還沒有取得畫面，請稍候');
      return;
    }
    const img = shotOut.image;
    setFlash((f) => f + 1);
    const ratioValue = RATIO_VALUE[app.get().ratio];
    const image = cropImageData(img, ratioValue);
    let file: Promise<File>;
    try {
      file = deps.encodeOutput(image, prefsRef.current.exportFormat, 0.92);
    } catch (e) {
      file = Promise.reject(e);
    }
    file.catch((e: unknown) => reportError(e, 'encodeJpeg'));
    const mirror = prefsRef.current.mirrorOnSave && cam.snapshot.facing === 'user';
    const vw = cam.video.videoWidth;
    const vh = cam.video.videoHeight;
    // the hand-over (C2): the seed in the saved crop, mirrored as the shot
    const faceSeed = shotSeed(shotOut.seed, vw, vh, ratioValue, mirror);
    // U6 (camera per-person spec §3.8, §5.3): the photo look, each edited person in the picture (box in the saved crop,
    // mirrored as saved, 左右分開 swapped) and 基本模式's ambient person; null when nothing is set (編輯 opens at 原圖)
    const handOver = handOverOf(lookRef.current.photo, shotPersons(shotOut.persons, vw, vh, ratioValue, mirror), bundle?.basic ? cameraSession().ambient : null);
    // what 編輯 is handed and what the camera knew of each person at the shutter (e2e, round-4 review F5)
    debug({ shotHandOver: (handOver?.persons ?? []).map((p) => ({ ...p.box, edited: p.params !== null, held: !!p.held, stale: !!p.stale })) });
    let original: ImageBitmap | null = null;
    try {
      original = await grabOriginalFrame(cam.video, ratioValue, mirror);
    } catch (e) {
      reportError(e, 'grabOriginalFrame');
    }
    // the user left during the await: drop the shot. (Not when the camera merely stopped being live:
    // both images were drawn before the await, so the shot is still valid.)
    if (app.get().screen.name !== 'camera') {
      original?.close();
      return;
    }
    go({ name: 'review', shot: { image, file, original, faceSeed, handOver } });
  };

  const shutter = () => {
    haptic();
    if (count !== null) {
      clearInterval(countTimer.current);
      setCount(null);
      // a recording's countdown: its start goes with it
      cancelStart();
      return;
    }
    if (cameraMode === 'video') {
      record();
      return;
    }
    if (!timer) {
      void capture();
      return;
    }
    countdown(timer, () => void capture());
  };

  /** the 計時 countdown over the frame, then `done` (the photo, or the recording); the shutter cancels it meanwhile */
  const countdown = (from: number, done: () => void) => {
    let n = from;
    setCount(n);
    countTimer.current = window.setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(countTimer.current);
        setCount(null);
        done();
      } else setCount(n);
    }, 1000);
  };

  // ───────────── 錄影 (beauty video spec §4.1–§4.6) ─────────────

  /**
   * The shutter in 錄影: a tap while recording stops it; otherwise the 計時 countdown, then the recording. The
   * microphone is asked inside this tap, also when a countdown follows, so the iOS prompt comes with it (ruling 8), and
   * never while the camera's own request is out (ruling 10)
   */
  const record = () => {
    const r = rec.current;
    if (r) {
      void stopRecording(r);
      return;
    }
    if (!ctrl || recPhaseRef.current !== 'idle') return;
    const seq = ++startSeq.current;
    const answer = ctrl.snapshot.state === 'live' ? getMic().ensure(MIC_ANSWER_MS) : Promise.resolve([]);
    const begin = () => {
      if (seq !== startSeq.current) return;
      // the shutter waits, aria-busy, for the answer: at most MIC_ANSWER_MS, then the clip goes ahead without sound
      setRecPhase('starting');
      void answer.then(() => beginRecording(seq));
    };
    if (timer) countdown(timer, begin);
    else begin();
  };

  /** A start still waiting (its countdown, the microphone's answer) is dropped: the answer starts nothing (ruling 4) */
  const cancelStart = () => {
    startSeq.current++;
    if (recPhaseRef.current === 'starting') setRecPhase('idle');
  };

  /**
   * The recording, once the countdown and the microphone's answer have settled (ruling 8): the clip sized from the 比例
   * crop of the display canvas, the recording canvas fed by the live loop, its track recorded with the microphone's
   * tracks held now (a late answer kept by then counts). A start that fails says 這個瀏覽器無法錄影 and stays in 錄影
   * (ruling 5)
   */
  const beginRecording = (seq: number) => {
    // the answer to a 錄影 left, a camera screen gone or a start dropped (the preview gone) starts nothing (ruling 4)
    if (seq !== startSeq.current || recPhaseRef.current !== 'starting') return;
    const l = loopRef.current;
    const e = svc.get().engine;
    const canvas = e.state === 'ready' ? e.bundle.engine.canvas : null;
    if (!l || !ctrl || !canvas || ctrl.snapshot.state !== 'live') {
      setRecPhase('idle');
      return;
    }
    const mime = videoMime();
    const size = clipSize(ctrl.video.videoWidth, ctrl.video.videoHeight, RATIO_VALUE[app.get().ratio], canvas.width, canvas.height);
    if (!mime || !size) {
      setRecPhase('idle');
      toast(VIDEO_TOASTS.unsupported, 3200);
      return;
    }
    // ruling 11: a 按住對比 hold ends here (its frames never reach the sink); it is locked from now on
    hold.release();
    const tracks = getMic().tracks();
    let rc: RecordCanvas | null = null;
    let recorder: ClipRecorder;
    try {
      rc = createRecordCanvas(size.width, size.height);
      const stream = new MediaStream([...rc.stream.getVideoTracks(), ...tracks]);
      // the bitrate is sized for the clip's own size, the recording canvas's
      const env = { MediaRecorder, now: () => performance.now(), setTimeout, clearTimeout };
      recorder = startClipRecorder(stream, mime, { width: rc.width, height: rc.height }, env);
    } catch (err) {
      reportError(err, 'recorder.start');
      rc?.release();
      setRecPhase('idle');
      toast(VIDEO_TOASTS.unsupported, 3200);
      return;
    }
    const r: Recording = { rc, recorder, cap: 0, stopping: false };
    rec.current = r;
    l.setRecordSink(rc.sink);
    setRecSince(performance.now());
    setRecPhase('recording');
    r.cap = window.setTimeout(() => {
      if (rec.current !== r || r.stopping) return;
      toast(VIDEO_TOASTS.capped, 3200);
      void stopRecording(r);
    }, clipCapMs());
    // ruling 14: a recorder that ends by itself (an error, its tracks ending) is an interruption: stop and keep. It is
    // by itself when it gets here first: Camera's own stop marks the recording stopping before the recorder ends
    void recorder.ended.then(() => stopRecording(r, true));
    if (tracks.length === 0 && !silentNoted.current) {
      silentNoted.current = true;
      toast(VIDEO_TOASTS.silent, 3200);
    }
  };

  /**
   * Ruling 7's order: the sink off the live loop (no frame lands after the recorder's end), the recorder's last chunk,
   * then the canvas freed. The recording is stopping from here on: every later trigger does nothing (ruling 15)
   */
  const finishRecording = async (r: Recording): Promise<ClipResult> => {
    r.stopping = true;
    clearTimeout(r.cap);
    loopRef.current?.setRecordSink(null);
    try {
      return await r.recorder.stop();
    } finally {
      r.rc.release();
      if (rec.current === r) rec.current = null;
    }
  };

  /**
   * The first stop trigger (spec §4.6): the 停止錄影 tap, the cap, the preview going away, the recorder ending by
   * itself (`selfEnded`). The controls stay locked and the shutter busy until the recorder hands out the clip; then the
   * clip screen (MIN_CLIP_MS or more) or 錄影時間太短, or 這個瀏覽器無法錄影 for a recording with no data that cannot be
   * a short one (clipOutcome). Only for this mount still on the camera screen, as captureFrom checks (ruling 15)
   */
  const stopRecording = async (r: Recording, selfEnded = false): Promise<void> => {
    if (rec.current !== r || r.stopping) return;
    setRecPhase('stopping');
    const result = await finishRecording(r);
    if (!mounted.current || app.get().screen.name !== 'camera') return;
    setRecPhase('idle');
    const outcome = clipOutcome(result, selfEnded);
    if (outcome === 'short') {
      toast(VIDEO_TOASTS.short);
      return;
    }
    if (outcome === 'empty') {
      reportError(new Error('the recorder handed out no data'), 'recorder.stop');
      toast(VIDEO_TOASTS.unsupported, 3200);
      return;
    }
    const file = clipFile(result);
    // what the e2e reads of the clip: the production CSP blocks fetch() of its blob: URL (ruling 1)
    debug({ clip: { name: file.name, type: file.type, size: file.size, hasAudio: result.hasAudio } });
    go({ name: 'clip', clip: { file, url: URL.createObjectURL(file), durationMs: result.durationMs, hasAudio: result.hasAudio } });
  };

  /**
   * 拍照 / 錄影 (spec §4.1). 錄影 needs a browser that records, else 這個瀏覽器無法錄影 and 拍照 stays (ruling 9). Entering
   * it asks for the microphone inside this tap, so the iOS prompt comes with the intent, but not while the camera's own
   * request is out: the record tap asks then (§4.2, ruling 10). Leaving it releases the microphone (ruling 6)
   */
  const pickMode = (mode: AppState['cameraMode']) => {
    if (mode === cameraMode || recPhaseRef.current !== 'idle') return;
    haptic();
    if (mode === 'video') {
      if (!videoMime()) {
        toast(VIDEO_TOASTS.unsupported, 3200);
        return;
      }
      app.set({ cameraMode: 'video' });
      if (ctrl?.snapshot.state === 'live') void getMic().ensure(MIC_PROMPT_MS);
      return;
    }
    // ruling 4: an answer still coming belongs to the 錄影 just left
    startSeq.current++;
    app.set({ cameraMode: 'photo' });
    getMic().release();
  };

  const cycleRatio = () => {
    haptic();
    const i = RATIOS.indexOf(ratio);
    app.set({ ratio: RATIOS[(i + 1) % RATIOS.length] });
  };
  const cycleTimer = () => {
    haptic();
    const i = TIMERS.indexOf(timer);
    app.set({ timer: TIMERS[(i + 1) % TIMERS.length] });
  };
  /**
   * 合照模式 (K22): a camera setting (prefs, remembered across launches); the live loop reads it on its next frame and
   * moves to the path it picks, keeping every person (liveRoute, live.ts syncPath). The first turn-on explains the trade
   */
  const toggleGroup = () => {
    haptic();
    const r = toggleGroupMode(app.get().prefs.groupMode, takeGroupModeOnToast);
    setPrefs({ groupMode: r.groupMode });
    if (r.toast) toast(r.toast, 3200);
  };
  const flip = () => {
    // ruling 3: a microphone request still out would hold the other camera's request in WebKit's queue (the 0.5.1
    // hang); the rendered `disabled` can lag the microphone's listener by a render
    if (!ctrl || getMic().state === 'asking' || recPhaseRef.current !== 'idle') return;
    haptic();
    const next: Facing = ctrl.snapshot.facing === 'user' ? 'environment' : 'user';
    // another camera, another scene: the session ends before the old stream stops (Review Focus #1, §3.11)
    endCameraSession();
    drag.current = null;
    // ruling 6: the microphone goes with this camera; the next record tap asks again
    getMic().release();
    ctrl.flip().catch((e: unknown) => setStartErr(reportError(e, 'camera.flip')));
    // the new facing's graph, warmed while its stream opens behind the spinner (§6.3)
    warmAfterPaint(next);
  };

  /** S §2.5: with ≥ 2 shown tracks a tap on a face selects its person (ring, haptic); otherwise the panel collapse toggles */
  const onStageClick = (e: MouseEvent) => {
    if ((e.target as Element).closest('.slider-row, .status, button')) return;
    if (!live) return;
    const l = loopRef.current;
    const canvas = bundle?.engine.canvas;
    const shown = l?.tracks().length ?? 0;
    let hit: LivePersonId | null = null;
    if (l && canvas && ctrl && shown >= 2) {
      const m = coverTapUv(e.clientX, e.clientY, canvas.getBoundingClientRect(), ctrl.video.videoWidth, ctrl.video.videoHeight, snap?.facing === 'user');
      hit = l.hitTest(m.u, m.v, m.minW, m.minH);
    }
    const a = cameraTapAction(hit, shown, l?.selection() ?? 'auto', app.get().cameraAll);
    if (a.kind === 'collapse') {
      setCollapsed((c) => !c);
      return;
    }
    haptic();
    if (a.allOff) {
      // a tap on a face turns 全部套用 off; nobody reverts (§3.4)
      app.set({ cameraAll: false });
      cameraSession().setAll(false);
    }
    l!.select(a.id);
    setRing({ person: a.id, at: performance.now() });
  };

  // above the lens: keepDrag reads them (a const read before its line throws)
  const state = snap?.state ?? 'idle';
  const ready = !!loop && live && !lost;
  // basic mode only: the live no-face state comes and goes (the badge covers it), the panel must not flicker
  const faceNote = ready && bundle?.basic ? '基本模式不支援臉型與美妝' : null;
  const faceOff = !!faceNote && FACE_TABS.includes(sel.tab);
  let lens = lensOf(look);
  let binding = sliderFor(lens, sel, cameraBody);
  // SliderRow drops its drag without onCommit when its key changes or it unmounts (Slider.tsx), in this same render: a
  // dropped drag never writes again (Review Focus #3). The lens and the binding are then read again on the session's
  // target, so the row and the next beginDrag agree on the key
  const kept = keepDrag(drag.current, ready && !collapsed && !faceOff ? (binding?.key ?? null) : null);
  if (kept !== drag.current) {
    drag.current = kept;
    lens = lensOf(look);
    binding = sliderFor(lens, sel, cameraBody);
  }
  // the 美妝 note (S5 §2.5): no closed-eye or small-face note in the camera, they change every frame
  const mkNote = makeupNote(sel, { lensClosed: false, lashesClosed: false, lashesSmall: false, procFailed: !!bundle?.engine.procMakeupFailed });

  useEffect(() => {
    if (ready) return;
    // a toggled compare or a countdown must not outlive the preview / the shutter that cancels it
    // (a context loss disables the shutter without touching the live loop)
    hold.release();
    clearInterval(countTimer.current);
    setCount(null);
    // beauty video spec §4.6: the preview gone (the app hidden, the camera not live, a lost context) stops a recording
    // and keeps it; a start still waiting for its countdown or the microphone goes
    cancelStart();
    if (rec.current) void stopRecording(rec.current);
  }, [ready]);

  // ruling 6: the microphone is not kept while the camera is not live (the app hidden too: 0.5.1 stops the camera
  // then); the next record tap asks again. After the effect above, so a recording is stopped before its sound ends
  useEffect(() => {
    if (!live) getMic().release();
  }, [live]);

  const inVideo = cameraMode === 'video';
  /** rulings 15, 17: locked from the record tap's wait for the microphone until the stop has handed out the clip */
  const recLocked = recPhase !== 'idle';
  /** the shutter is 停止錄影, a red square, while recording and while that stop runs (disabled then, aria-busy) */
  const recStop = recPhase === 'recording' || recPhase === 'stopping';
  const shutterLabel = count !== null ? '取消倒數' : !inVideo ? '拍照' : recStop ? '停止錄影' : '開始錄影';
  /**
   * the ways to the photo picker, whose pick opens the editor and so ends the camera screen, unkept (相簿, the 美體
   * note's 匯入照片, 改用匯入照片): locked with the rest, and also during a 錄影 countdown, which would end behind the
   * picker sheet into a recording. The photo countdown leaves them as they were
   */
  const pickLocked = recLocked || (inVideo && count !== null);

  let overlay = null;
  if (fatal) {
    overlay = (
      <Status icon="warning" tone="danger" title="相機無法啟動" body="可以改用匯入照片來修圖。" detail={fatal}>
        <ImportButton disabled={pickLocked} />
      </Status>
    );
  } else if (state === 'idle') {
    overlay = (
      <Status icon="camera" tone="accent" title="開啟相機" body="影像只在這台裝置上處理，不會上傳。" detail={startErr}>
        <button type="button" class="btn primary" onClick={start}>
          點擊開啟相機
        </button>
      </Status>
    );
  } else if (state === 'starting') {
    if (snap?.error === 'noanswer') {
      // still waiting (a late answer goes live): no 重試, it would only wait for the same request
      const m = cameraErrorCopy('noanswer', isStandalone(), location.origin);
      overlay = (
        <Status spinner title={m.title} body={m.body} steps={m.steps} detail={m.detail}>
          <ImportButton disabled={pickLocked} />
        </Status>
      );
    } else overlay = <Status spinner title="正在開啟相機…" />;
  } else if (state === 'error') {
    const kind = snap?.error ?? 'unknown';
    const standalone = isStandalone();
    const m = cameraErrorCopy(kind, standalone, location.origin);
    // the Safari fallback needs the URL even when there is also a start error to show
    const safari = (kind === 'black' || kind === 'noframe') && standalone;
    const detail = safari ? [startErr, m.detail].filter(Boolean).join(' · ') : (startErr ?? m.detail);
    overlay = (
      <Status icon="warning" tone="danger" title={m.title} body={m.body} steps={m.steps} detail={detail}>
        <button type="button" class="btn primary" onClick={start}>
          重試
        </button>
        <ImportButton disabled={pickLocked} />
      </Status>
    );
  } else if (state === 'interrupted') {
    overlay = (
      <Status icon="camera" tone="accent" scrim title="相機已暫停" body="回到 App 後相機需要重新啟動。" detail={startErr}>
        <button type="button" class="btn primary" onClick={start}>
          恢復相機
        </button>
      </Status>
    );
  }

  return (
    <div class="screen camera">
      <div class="topbar">
        <IconButton icon="close" label="回首頁" onClick={close} disabled={recLocked} />
        <div class="topbar-center">
          <button type="button" class="chip-btn" aria-label={`比例 ${ratio}`} disabled={recLocked} onClick={cycleRatio}>
            <span class="num">{ratio}</span>
          </button>
          <button
            type="button"
            class={`chip-btn${timer ? ' on' : ''}`}
            aria-label={`計時 ${timer ? `${timer} 秒` : '關'}`}
            disabled={recLocked}
            onClick={cycleTimer}
          >
            <span>
              <Icon name="timer" size={16} stroke={2} />
              {timer ? `${timer}s` : '關'}
            </span>
          </button>
          {/* 基本模式 finds no face and MAX_LIVE_FACES = 1 has no group path: no path to pick (groupModeAvailable, C18) */}
          {groupModeAvailable(!!bundle?.basic) && (
            <button type="button" class={`chip-btn${prefs.groupMode ? ' on' : ''}`} aria-pressed={prefs.groupMode} disabled={recLocked} onClick={toggleGroup}>
              <span>{GROUP_MODE_LABEL}</span>
            </button>
          )}
        </div>
        {/* ruling 3: never while a microphone request is out, in either mode (WebKit would queue the camera's next) */}
        <IconButton icon="flip" label="切換鏡頭" onClick={flip} disabled={!live || count !== null || micState === 'asking' || recLocked} />
      </div>

      <div class="stage cam-stage" onClick={onStageClick}>
        <div class="frame" style={{ '--r': String(RATIO_VALUE[ratio]) }}>
          <CanvasHost fit="cover" />
          {ready && loop && bundle && ctrl && !hold.held && (
            <CameraFaceMarker
              loop={loop}
              canvas={bundle.engine.canvas}
              video={ctrl.video}
              mirrored={snap?.facing === 'user'}
              ring={ring}
              all={cameraAll}
              count={shownFaces}
              dim={photoScoped(sel, lens)}
            />
          )}
          {ready && (chip || cameraAll) && !hold.held && (
            <button
              type="button"
              class={`float-btn all-chip${cameraAll ? ' on' : ''}`}
              aria-pressed={cameraAll}
              onClick={(e) => {
                e.stopPropagation();
                haptic();
                // on copies the target's params to everyone in view; off reverts nobody (§3.4, K10)
                app.set({ cameraAll: !cameraAll });
                cameraSession().setAll(!cameraAll);
              }}
            >
              <span>全部套用</span>
            </button>
          )}
          {/* before the badges: they sit below it while it shows (theme.css) */}
          {recPhase === 'recording' && <RecBadge since={recSince} />}
          {hold.held && <span class="corner-label">原圖</span>}
          {ready && bundle?.basic && !hold.held && <span class="badge">基本模式</span>}
          {ready && !bundle?.basic && trackerHealth !== 'ok' && !hold.held && (
            <span class="badge" role="status">
              {trackerHealth === 'lost' ? '臉部偵測重新啟動中' : '臉部偵測暫停，稍後自動重試'}
            </span>
          )}
          {ready && !bundle?.basic && trackerHealth === 'ok' && noFace && !hold.held && (
            <span class="badge">未偵測到臉部</span>
          )}
          {count !== null && (
            <div class="countdown" aria-live="assertive">
              <span key={count} class="num">
                {count}
              </span>
            </div>
          )}
          {flash > 0 && <div key={flash} class="flash" />}
        </div>
        {overlay ?? (live ? <EngineStatus /> : null)}
        {ready && !collapsed && (
          <SliderRow
            float
            binding={faceOff ? null : binding}
            onChange={(v) => {
              if (!binding) return;
              // the drag's first change fixes whom it writes (the target, 全部套用: everyone in view) until it commits
              drag.current ??= beginDrag(session, binding.key);
              const l = lensOf(lookRef.current);
              setEdit(binding.apply(l, v), l);
            }}
            onCommit={(v) => {
              if (binding) {
                const l = lensOf(lookRef.current);
                setEdit(binding.apply(l, v), l);
              }
              drag.current = null;
            }}
            onSel={setSel}
          />
        )}
        {live && collapsed && !overlay && (
          <button
            type="button"
            class="float-btn panel-reopen"
            aria-expanded="false"
            aria-controls="beauty-panel"
            onClick={() => {
              haptic();
              setCollapsed(false);
            }}
          >
            <span>
              <Icon name="presetGlow" size={16} />
              美顏
            </span>
          </button>
        )}
      </div>

      {/* ruling 17: the 美體 note's 匯入照片 opens the editor, which would end a recording unkept (as 相簿 would): the
          same note without it while the picker is locked (pickLocked). Usable otherwise: the panel's edits are
          recorded */}
      <BeautyPanel
        id="beauty-panel"
        lens={lens}
        sel={sel}
        onSel={setSel}
        onEdit={(e) => setEdit(e, lens)}
        collapsed={collapsed}
        faceNote={faceNote}
        body={pickLocked ? CAMERA_BODY : cameraBody}
        lookFailed={(id) => bundle?.engine.lutState('look', id) === 'failed'}
        onRetryLook={(id) => bundle && requestLut(bundle.engine, 'look', id)}
        makeupNote={mkNote}
      />

      {/* above the shutter row, outside its grid (ruling 19: e2e find 相簿, the shutter and 按住對比 in .cam-controls) */}
      <div class="mode-switch" role="radiogroup" aria-label="拍攝模式">
        {MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            role="radio"
            aria-checked={cameraMode === m.mode}
            class={cameraMode === m.mode ? 'on' : ''}
            disabled={recLocked || count !== null}
            onClick={() => pickMode(m.mode)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div class="cam-controls">
        <button
          type="button"
          class="side-btn"
          disabled={pickLocked}
          onClick={() => {
            haptic();
            pickPhoto((f) => void openInEditor(f, { returnTo: 'camera', picked: true }));
          }}
        >
          <span class="side-icon">
            <Icon name="image" size={22} />
          </span>
          相簿
        </button>
        {/* 錄影: a red disc, 停止錄影 a red square; disabled and aria-busy while it waits for the microphone or the stop */}
        <button
          type="button"
          class={`shutter${inVideo ? ' rec' : ''}${recStop ? ' recording' : ''}${count !== null ? ' counting' : ''}`}
          aria-label={shutterLabel}
          aria-busy={recPhase === 'starting' || recPhase === 'stopping' ? 'true' : undefined}
          disabled={!inVideo || recPhase === 'idle' ? !ready : recPhase !== 'recording'}
          onClick={shutter}
        >
          <span />
        </button>
        <button type="button" class={`side-btn${hold.held ? ' held' : ''}`} disabled={!ready || recLocked} {...hold.props}>
          <span class="side-icon">
            <Icon name="compare" size={22} />
          </span>
          按住對比
        </button>
      </div>
    </div>
  );
}

/**
 * 「● 00:12」 over the frame while recording (beauty video spec §4.1), counted from `since` (performance.now()) every
 * 250 ms here, so the ticks re-render the badge only
 */
function RecBadge({ since }: { since: number }) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(t);
  }, []);
  return (
    <div class="rec-badge" role="timer">
      <span class="rec-dot" aria-hidden="true">
        ●
      </span>{' '}
      <span class="num">{clipClock(now - since)}</span>
    </div>
  );
}

/** 改用匯入照片 on the camera's cards; `disabled` while a pick would drop a recording (pickLocked) */
function ImportButton({ disabled }: { disabled?: boolean }) {
  return (
    <button
      type="button"
      class="btn"
      disabled={disabled}
      onClick={() => {
        haptic();
        pickPhoto((f) => void openInEditor(f, { returnTo: 'camera', picked: true }));
      }}
    >
      <Icon name="image" size={20} />
      改用匯入照片
    </button>
  );
}
