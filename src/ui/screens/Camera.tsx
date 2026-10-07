// Camera 拍攝 (spec §7.2.2): gate → live beautified preview framed to 3:4 / 1:1 / 9:16,
// BeautyPanel + floating slider, timer, flip, hold-to-compare, shutter → Review.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { LiveLoop, LiveStats } from '../../app/live';
import type { CameraController, CameraSnapshot } from '../../types';
import { cameraErrorCopy } from '../cameraErrors';
import { BeautyPanel, FACE_TABS } from '../components/BeautyPanel';
import { CanvasHost } from '../components/CanvasHost';
import { IconButton } from '../components/Controls';
import { EngineStatus } from '../components/EngineStatus';
import { SliderRow } from '../components/Slider';
import { Status } from '../components/Status';
import { reportError } from '../debug';
import { deps } from '../deps';
import { openInEditor, pickPhoto } from '../flows';
import { Icon } from '../icons';
import { cropImageData, grabOriginalFrame } from '../imaging';
import { INITIAL_SELECTION, sliderFor, type PanelSelection } from '../panelModel';
import { haptic, isStandalone } from '../platform';
import { ensureEngine, getCamera, stopCamera, svc } from '../services';
import { app, go, RATIO_VALUE, RATIOS, setParams, TIMERS, toast } from '../state';
import { useStore } from '../store';
import { useFilterLoader, useHold } from './hooks';

let lastSel: PanelSelection = INITIAL_SELECTION;
/** basic-mode notes are announced once per engine bundle, not on every visit */
let notedBundle: unknown = null;

export function Camera() {
  const params = useStore(app, (s) => s.params);
  const prefs = useStore(app, (s) => s.prefs);
  const ratio = useStore(app, (s) => s.ratio);
  const timer = useStore(app, (s) => s.timer);
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

  const paramsRef = useRef(params);
  paramsRef.current = params;
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

  useFilterLoader(bundle?.engine ?? null, params.filterId);

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
        getParams: () => paramsRef.current,
        getPrefs: () => prefsRef.current,
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
  };

  const close = () => {
    clearInterval(countTimer.current);
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
    let img: ImageData | null;
    try {
      img = l.capture();
    } catch (e) {
      toast(`拍攝失敗：${reportError(e, 'capture')}`, 4000);
      return;
    }
    if (!img) {
      toast('還沒有取得畫面，請稍候');
      return;
    }
    setFlash((f) => f + 1);
    const r = RATIO_VALUE[app.get().ratio];
    const image = cropImageData(img, r);
    let file: Promise<File>;
    try {
      file = deps.encodeJpeg(image, 0.92);
    } catch (e) {
      file = Promise.reject(e);
    }
    file.catch((e: unknown) => reportError(e, 'encodeJpeg'));
    const mirror = prefsRef.current.mirrorOnSave && cam.snapshot.facing === 'user';
    let original: ImageBitmap | null = null;
    try {
      original = await grabOriginalFrame(cam.video, r, mirror);
    } catch (e) {
      reportError(e, 'grabOriginalFrame');
    }
    // the user left during the await: drop the shot. (Not when the camera merely stopped being live:
    // both images were drawn before the await, so the shot is still valid.)
    if (app.get().screen.name !== 'camera') {
      original?.close();
      return;
    }
    go({ name: 'review', shot: { image, file, original, params: paramsRef.current } });
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
    ctrl.flip().catch((e: unknown) => setStartErr(reportError(e, 'camera.flip')));
  };

  const onStageClick = (e: MouseEvent) => {
    if ((e.target as Element).closest('.slider-row, .status, button')) return;
    if (!live) return;
    setCollapsed((c) => !c);
  };

  const binding = sliderFor(params, sel);
  const state = snap?.state ?? 'idle';
  const ready = !!loop && live && !lost;
  // basic mode only: the live no-face state comes and goes (the badge covers it), the panel must not flicker
  const faceNote = ready && bundle?.basic ? '基本模式不支援臉型與美妝' : null;
  const faceOff = !!faceNote && FACE_TABS.includes(sel.tab);

  useEffect(() => {
    if (!ready) hold.release(); // a toggled compare must not outlive the preview it applies to
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
            onChange={(v) => binding && setParams(binding.apply(paramsRef.current, v))}
            onCommit={(v) => binding && setParams(binding.apply(paramsRef.current, v))}
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
        params={params}
        sel={sel}
        onSel={setSel}
        onParams={setParams}
        collapsed={collapsed}
        faceNote={faceNote}
      />

      <div class="cam-controls">
        <button
          type="button"
          class="side-btn"
          onClick={() => {
            haptic();
            pickPhoto((f) => void openInEditor(f, { returnTo: 'camera' }));
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
        pickPhoto((f) => void openInEditor(f, { returnTo: 'camera' }));
      }}
    >
      <Icon name="image" size={20} />
      改用匯入照片
    </button>
  );
}
