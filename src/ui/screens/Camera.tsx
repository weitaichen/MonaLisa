// Camera 拍攝 (spec §7.2.2): gate → live beautified preview framed to 3:4 / 1:1 / 9:16,
// BeautyPanel + floating slider, timer, flip, hold-to-compare, shutter → Review.
// 美體 is photo-only for now (body research report P1): the tab is shown with every item off and a note.
import { useEffect, useRef, useState } from 'preact/hooks';
import { cameraTapAction, ChipGate, coverTapUv } from '../../app/faceTracks';
import type { LiveLoop, LiveStats } from '../../app/live';
import type { LivePersonId } from '../../app/livePersons';
import { LIVE_DETECTOR, LIVE_GROUP } from '../../config/limits';
import type { CameraController, CameraSnapshot, EditState, Facing } from '../../types';
import { lensFor, LIVE_PERSONS, type Lens, type PersonInfo } from '../../edit/lens';
import { cameraScreenSwap } from '../../edit/sides';
import { cameraEdit, LIVE, neutralPerson, personOf } from '../../edit/state';
import { takeCameraPersonsHint } from '../../store/settings';
import { cameraErrorCopy } from '../cameraErrors';
import { beginDrag, cameraSession, endCameraSession, keepDrag, panelPerson, writePerson, type CameraDrag } from '../cameraSession';
import { BeautyPanel, FACE_TABS } from '../components/BeautyPanel';
import { CameraFaceMarker } from '../components/CameraFaceMarker';
import { CanvasHost } from '../components/CanvasHost';
import { IconButton } from '../components/Controls';
import { EngineStatus } from '../components/EngineStatus';
import { SliderRow } from '../components/Slider';
import { Status } from '../components/Status';
import { reportError } from '../debug';
import { deps } from '../deps';
import { openInEditor, pickPhoto } from '../flows';
import { Icon } from '../icons';
import { cropImageData, grabOriginalFrame, normalizedCropRect, shotSeed } from '../imaging';
import { CAMERA_BODY, INITIAL_SELECTION, makeupNote, photoScoped, sliderFor, type BodyContext, type PanelSelection } from '../panelModel';
import { haptic, isStandalone } from '../platform';
import { ensureEngine, getCamera, stopCamera, svc } from '../services';
import { app, go, RATIO_VALUE, RATIOS, setLook, TIMERS, toast } from '../state';
import { useStore } from '../store';
import { requestLut, useAdjustFailureNotice, useHold, useLutLoader } from './hooks';

let lastSel: PanelSelection = INITIAL_SELECTION;
/** 美體 is photo-only: its note offers the import right where the user looked for it */
const cameraBody: BodyContext = {
  ...CAMERA_BODY,
  action: { label: '匯入照片', run: () => pickPhoto((f) => void openInEditor(f, { returnTo: 'camera', picked: true })) },
};
/** basic-mode notes are announced once per engine bundle, not on every visit */
let notedBundle: unknown = null;

/** the camera's group path (camera per-person spec §6.6, K17): LIVE_GROUP unless the e2e knob turns it off (§12.2) */
const liveGroup = (): boolean => LIVE_GROUP && deps.readLiveDebug().group !== false;

/**
 * The graph the new stream's first detection runs (§6.3): the back camera's group path IMAGE (the fallback VIDEO), the
 * front camera's solo path VIDEO, each on its facing's detector. Run once the 「正在開啟相機…」 spinner has painted: the
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
        tracker?.warm(liveGroup() && f === 'environment' ? 'IMAGE' : 'VIDEO', LIVE_DETECTOR[f]);
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
  /** this mount already saw ≥ 2 faces: the one-time hint (§3.1) is asked for once, not on every stats tick */
  const sawGroup = useRef(false);
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
   * runs; 基本模式: the session's ambient person, §3.6). It reads `ready`, so the render calls it below that line.
   */
  const lensOf = (l: typeof look): Lens => {
    const basic = !!bundle?.basic;
    const person = basic ? session.ambient : panelPerson(session, drag.current);
    // noFace does not read trackerHealth: with no face shown there is no target, so a person slider would write nobody
    // and snap back; while the tracker restarts its badge says why
    return lensFor(cameraEdit(l.photo, person), { kind: 'person', id: LIVE }, livePersons, LIVE, {
      camera: { shown: shownFaces, all: cameraAll, noFace: !basic && ready && shownFaces === 0, target: drag.current?.lead ?? session.target() },
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
  const capturing = useRef(false);

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
    return c.subscribe(setSnap);
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
    let l: LiveLoop;
    let lastFace: boolean | null = null;
    let faceTimer = 0;
    const onStats = (s: LiveStats) => {
      setShownFaces(s.faces);
      setGpLeft(s.gpLeftOnLeft);
      // the target or someone's params changed (a tap, a re-identification, the auto pick): the panel re-reads (§3.2)
      setPersonsTick(s.personsVersion);
      setChip(chipGate.current.update(s.faces, app.get().cameraAll, performance.now()));
      // the first time ≥ 2 faces are shown: 「點選畫面中的臉，可個別調整」 once per install (§3.1, K12)
      if (s.faces >= 2 && !sawGroup.current) {
        sawGroup.current = true;
        if (takeCameraPersonsHint()) toast('點選畫面中的臉，可個別調整', 3200);
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
        group: liveGroup(),
        onStats,
      });
    } catch (e) {
      setFatal(reportError(e, 'startLiveLoop'));
      return;
    }
    loopRef.current = l;
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

  useEffect(() => () => clearInterval(countTimer.current), []);

  const hold = useHold((on) => {
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
    // a start straight on the back camera warms its graph behind the spinner (§6.3)
    if (ctrl.snapshot.facing === 'environment') warmAfterPaint('environment');
  };

  const close = () => {
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
    // the hand-over (C2): the seed in the saved crop, mirrored as the shot
    const faceSeed = shotSeed(shotOut.seed, cam.video.videoWidth, cam.video.videoHeight, ratioValue, mirror);
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
    go({ name: 'review', shot: { image, file, original, faceSeed } });
  };

  const shutter = () => {
    haptic();
    if (count !== null) {
      clearInterval(countTimer.current);
      setCount(null);
      return;
    }
    if (!timer) {
      void capture();
      return;
    }
    let n: number = timer;
    setCount(n);
    countTimer.current = window.setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(countTimer.current);
        setCount(null);
        void capture();
      } else setCount(n);
    }, 1000);
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
  const flip = () => {
    if (!ctrl) return;
    haptic();
    const next: Facing = ctrl.snapshot.facing === 'user' ? 'environment' : 'user';
    // another camera, another scene: the session ends before the old stream stops (Review Focus #1, §3.11)
    endCameraSession();
    drag.current = null;
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

  // above the lens: lensOf and keepDrag read them (a const read before its line throws)
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
  }, [ready]);

  let overlay = null;
  if (fatal) {
    overlay = (
      <Status icon="warning" tone="danger" title="相機無法啟動" body="可以改用匯入照片來修圖。" detail={fatal}>
        <ImportButton />
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
    overlay = <Status spinner title="正在開啟相機…" />;
  } else if (state === 'error') {
    const kind = snap?.error ?? 'unknown';
    const standalone = isStandalone();
    const m = cameraErrorCopy(kind, standalone, location.origin);
    // the Safari fallback needs the URL even when there is also a start error to show
    const detail = kind === 'black' && standalone ? [startErr, m.detail].filter(Boolean).join(' · ') : (startErr ?? m.detail);
    overlay = (
      <Status icon="warning" tone="danger" title={m.title} body={m.body} steps={m.steps} detail={detail}>
        <button type="button" class="btn primary" onClick={start}>
          重試
        </button>
        <ImportButton />
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
        <IconButton icon="close" label="回首頁" onClick={close} />
        <div class="topbar-center">
          <button type="button" class="chip-btn" aria-label={`比例 ${ratio}`} onClick={cycleRatio}>
            <span class="num">{ratio}</span>
          </button>
          <button type="button" class={`chip-btn${timer ? ' on' : ''}`} aria-label={`計時 ${timer ? `${timer} 秒` : '關'}`} onClick={cycleTimer}>
            <span>
              <Icon name="timer" size={16} stroke={2} />
              {timer ? `${timer}s` : '關'}
            </span>
          </button>
        </div>
        <IconButton icon="flip" label="切換鏡頭" onClick={flip} disabled={!live || count !== null} />
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

      <BeautyPanel
        id="beauty-panel"
        lens={lens}
        sel={sel}
        onSel={setSel}
        onEdit={(e) => setEdit(e, lens)}
        collapsed={collapsed}
        faceNote={faceNote}
        body={cameraBody}
        lookFailed={(id) => bundle?.engine.lutState('look', id) === 'failed'}
        onRetryLook={(id) => bundle && requestLut(bundle.engine, 'look', id)}
        makeupNote={mkNote}
      />

      <div class="cam-controls">
        <button
          type="button"
          class="side-btn"
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
        <button
          type="button"
          class={`shutter${count !== null ? ' counting' : ''}`}
          aria-label={count !== null ? '取消倒數' : '拍照'}
          disabled={!ready}
          onClick={shutter}
        >
          <span />
        </button>
        <button type="button" class={`side-btn${hold.held ? ' held' : ''}`} disabled={!ready} {...hold.props}>
          <span class="side-icon">
            <Icon name="compare" size={22} />
          </span>
          按住對比
        </button>
      </div>
    </div>
  );
}

function ImportButton() {
  return (
    <button
      type="button"
      class="btn"
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
