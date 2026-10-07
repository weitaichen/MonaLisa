// Editor 編輯 (spec §7.2.4): ✕ · ↶ ↷ · 儲存; framed canvas with pinch-zoom / pan / double-tap fit;
// 按住對比 + 重置 (inline confirm) on the canvas; docked slider + BeautyPanel. Every edit is
// re-encoded (debounced 400 ms) so 儲存 can share synchronously, and autosaved to 最近編輯.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { StillSession } from '../../app/still';
import { applyPreset } from '../../engine/params';
import type { BeautyParams, Engine, Face } from '../../types';
import { BeautyPanel, FACE_TABS } from '../components/BeautyPanel';
import { CanvasHost } from '../components/CanvasHost';
import { IconButton } from '../components/Controls';
import { EngineStatus } from '../components/EngineStatus';
import { SliderRow } from '../components/Slider';
import { Status } from '../components/Status';
import { reportError } from '../debug';
import { deps, type UndoLike } from '../deps';
import { detectSession, exportOnLatest, RedetectBudget } from '../editorModel';
import { Icon } from '../icons';
import { INITIAL_SELECTION, sliderFor, type PanelSelection } from '../panelModel';
import { haptic } from '../platform';
import { ensureEngine, svc } from '../services';
import { go, setPendingHistory, showSaveFallback, toast, type EditorSource } from '../state';
import { useStore } from '../store';
import { useFilterLoader, useHold } from './hooks';
import { useZoomPan } from './zoomPan';

const ENCODE_DEBOUNCE_MS = 400;
const THUMB_EDGE = 360;
const ORIGINAL_EDGE = 2048;
/** how long a history flush waits for a filter LUT still downloading before giving up on correcting the thumb */
const FLUSH_LUT_WAIT_MS = 3000;

let lastSel: PanelSelection = INITIAL_SELECTION;

const keyOf = (p: BeautyParams) => JSON.stringify(p);

export function Editor({ source }: { source: EditorSource }) {
  const engine = useStore(svc, (s) => s.engine);
  const lost = useStore(svc, (s) => s.lost);
  /** the tracker is replacing a dead graph ('lost') or paused its automatic retries ('failed') */
  const trackerHealth = useStore(svc, (s) => s.tracker);
  const bundle = engine.state === 'ready' ? engine.bundle : null;

  const [params, setParamsState] = useState(source.params);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const [sel, setSelState] = useState(lastSel);
  /**
   * the still session plus the engine it draws with (recoverEngine replaces the engine → a new session).
   * unsure: its "no face" came from a tracker that could not answer (recovering, or the detect call threw).
   */
  const [bound, setBound] = useState<{ s: StillSession; engine: Engine; unsure: boolean } | null>(null);
  /** a definite detection result for this photo (a face, or a real "no face"); undefined → not known yet */
  const knownFace = useRef<Face | null | undefined>(undefined);
  /** bumped to detect again on the same engine once the tracker can answer (bounded: RedetectBudget) */
  const [detectGen, setDetectGen] = useState(0);
  const [redetect] = useState(() => new RedetectBudget(trackerHealth));
  const sessionGen = useRef(-1);
  const [fatal, setFatal] = useState<string | null>(null);
  const fatalRef = useRef(fatal);
  fatalRef.current = fatal;
  const [preparing, setPreparing] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [, bump] = useState(0);
  /** share cache: the encoded file for these params (so 儲存 can share synchronously inside the tap) */
  const fresh = useRef<{ key: string; file: File } | null>(null);
  const historyId = useRef<string | null>(source.historyId);
  /** key of the params last queued to history (a reopened entry starts saved: viewing it writes nothing) */
  const savedKey = useRef<string | null>(source.historyId ? keyOf(source.params) : null);
  const historyChain = useRef<Promise<unknown>>(Promise.resolve());
  const originalBlob = useRef<Promise<Blob> | null>(null);
  const setupDone = useRef(false);
  const faceToastDone = useRef(false);
  const sessionEngine = useRef<Engine | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  // only a session bound to the current engine counts; while recoverEngine rebuilds there is none
  const session = bound && bundle && bound.engine === bundle.engine ? bound.s : null;

  const undo = useMemo<UndoLike<BeautyParams> | null>(() => {
    try {
      const u = deps.createUndo<BeautyParams>(50);
      u.reset(source.params);
      return u;
    } catch (e) {
      reportError(e, 'UndoStack');
      return null;
    }
  }, [source]);

  const setSel = (s: PanelSelection) => {
    lastSel = s;
    setSelState(s);
  };

  /** commit=true records an undo step */
  const update = (p: BeautyParams, commit: boolean) => {
    setParamsState(p);
    if (commit && undo) {
      try {
        undo.push(p);
      } catch (e) {
        reportError(e, 'undo.push');
      }
      bump((n) => n + 1);
    }
  };

  useEffect(() => {
    ensureEngine().catch(() => undefined);
  }, []);

  // One still session per engine. The editor owns source.bitmap (closed on unmount), so after
  // recoverEngine replaces a lost engine the same photo is bound to the new one.
  const sessionRef = useRef<StillSession | null>(null);
  const unmounted = useRef(false);
  const currentEngine = bundle?.engine ?? null;
  useEffect(() => {
    if (!bundle || (sessionEngine.current === bundle.engine && sessionGen.current === detectGen)) return;
    const target = bundle.engine;
    const tracker = bundle.tracker;
    const gen = detectGen;
    sessionEngine.current = target;
    sessionGen.current = gen;
    try {
      target.setOptions({ mirror: false });
    } catch (e) {
      reportError(e, 'engine.setOptions');
    }
    if (!setupDone.current) {
      setupDone.current = true;
      if (!historyId.current) {
        try {
          originalBlob.current = deps.toJpegBlob(source.bitmap, ORIGINAL_EDGE, 0.9);
        } catch (e) {
          originalBlob.current = Promise.reject(e);
        }
        originalBlob.current.catch((e: unknown) => reportError(e, 'toJpegBlob(original)'));
      }
    }
    // let the "analysing" spinner paint before the synchronous face detection
    window.setTimeout(() => {
      if (unmounted.current || sessionEngine.current !== target || sessionGen.current !== gen) return;
      const replacing = !!sessionRef.current;
      if (sessionRef.current) {
        sessionRef.current.dispose();
        sessionRef.current = null;
      }
      try {
        // the photo is unchanged: a face found before (e.g. by the session a lost engine took with it) still holds
        const face = tracker ? knownFace.current : undefined;
        const { s, unsure } = detectSession(
          !!tracker,
          () => svc.get().tracker === 'ok',
          () => deps.createStillSession(target, tracker, source.bitmap, { ownsBitmap: false, face }),
        );
        if (tracker && !unsure) {
          if (s.face && knownFace.current === undefined && replacing) {
            // found on a re-detect: what was encoded / autosaved so far lacks the face effects
            fresh.current = null;
            savedKey.current = null;
          }
          knownFace.current = s.face;
        }
        sessionRef.current = s;
        setBound({ s, engine: target, unsure });
        // a tracker that could not answer is not "no face": wait for the re-detect before saying so
        if (!faceToastDone.current && !unsure) {
          faceToastDone.current = true;
          if (tracker && !s.face) toast('未偵測到臉部，僅套用美膚與濾鏡', 3200);
        }
      } catch (e) {
        setFatal(reportError(e, 'createStillSession'));
      }
    }, 60);
  }, [currentEngine, detectGen]);

  // the tracker is back (or a throwing detect call has rebuilt its graph): detect again on this photo until
  // it gives a real answer (a few non-answers in a row; a tracker recovery allows a few more)
  useEffect(() => {
    if (redetect.next(!!bound?.unsure && bound.engine === currentEngine, trackerHealth)) setDetectGen((n) => n + 1);
  }, [bound, trackerHealth, currentEngine]);

  /** Queue the history write for `p` (thumb + update, or a new entry) and publish it for Home. */
  const queueHistory = (p: BeautyParams, img: ImageData, size: { width: number; height: number }) => {
    savedKey.current = keyOf(p);
    historyChain.current = historyChain.current
      .then(() => writeHistory(p, img, size))
      .catch((e: unknown) => reportError(e, 'history autosave'));
    setPendingHistory(historyChain.current);
  };

  /** thumb + update, or a new entry (one step of historyChain) */
  const writeHistory = async (p: BeautyParams, img: ImageData, size: { width: number; height: number }) => {
    const { width, height } = size;
    const thumb = await deps.toJpegBlob(img, THUMB_EDGE, 0.82);
    if (historyId.current) {
      await deps.updateEntry(historyId.current, { params: p, thumb });
    } else {
      const original = await (originalBlob.current ?? deps.toJpegBlob(img, ORIGINAL_EDGE, 0.9));
      historyId.current = await deps.addEntry({ original, thumb, params: p, width, height });
    }
  };

  /**
   * Write the current params to history now if the debounce has not (✕ / 返回 within 400 ms of an edit,
   * or the app going to the background). Synchronous readback, so it works right before dispose.
   * When the filter LUT is not resident yet, a corrected thumbnail follows on historyChain: the session must
   * stay alive until that settles.
   */
  const flushHistory = () => {
    const s = sessionRef.current;
    if (!s || fatalRef.current) return;
    const p = paramsRef.current;
    const key = keyOf(p);
    if (savedKey.current === key) return;
    if (sessionEngine.current?.lost) {
      // no GL to render a thumbnail: keep at least the params of an existing entry
      const id = historyId.current;
      if (!id) return;
      savedKey.current = key;
      historyChain.current = historyChain.current
        .then(() => deps.updateEntry(id, { params: p }))
        .catch((e: unknown) => reportError(e, 'history flush'));
      setPendingHistory(historyChain.current);
      return;
    }
    const ready = s.exportReady(p);
    try {
      queueHistory(p, s.exportImageData(p), s);
    } catch (e) {
      reportError(e, 'history flush');
      return;
    }
    if (ready) return;
    // the filter LUT (or a static texture) was still loading, so that thumbnail lacks it: write a corrected
    // one once it is resident, unless a newer edit was queued meanwhile (iOS may suspend us first: the
    // synchronous write above keeps the params either way)
    historyChain.current = historyChain.current
      .then(() => Promise.race([s.prepareExport(p), new Promise((r) => window.setTimeout(r, FLUSH_LUT_WAIT_MS))]))
      .then(async () => {
        if (savedKey.current !== key || !s.exportReady(p)) return;
        await writeHistory(p, s.exportImageData(p), s);
      })
      .catch((e: unknown) => reportError(e, 'history flush'));
    setPendingHistory(historyChain.current);
  };

  useEffect(() => {
    // iOS may suspend or kill a backgrounded PWA before the debounce fires
    const onVis = () => {
      if (document.visibilityState === 'hidden') flushHistory();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(
    () => () => {
      unmounted.current = true;
      flushHistory(); // before dispose: the readback needs the live session
      const s = sessionRef.current;
      sessionRef.current = null;
      const release = () => {
        s?.dispose();
        try {
          source.bitmap.close();
        } catch {
          /* already closed */
        }
      };
      // a corrected thumbnail (flushHistory: filter LUT not resident yet) may still need the session and the
      // bitmap: release them once the history writes queued so far have landed, drawing nothing meanwhile
      s?.stopDisplay();
      historyChain.current.then(release, release);
    },
    [],
  );

  useFilterLoader(bundle?.engine ?? null, params.filterId);

  useEffect(() => {
    if (!session) return;
    try {
      session.render(params);
    } catch (e) {
      setFatal(reportError(e, 'session.render'));
    }
  }, [session, params]);

  /** Export + encode; waits for the filter LUT so the file matches the preview. */
  const encode = async (s: StillSession, p: BeautyParams) => {
    await s.prepareExport(p);
    if (unmounted.current) throw new Error('editor closed');
    const img = s.exportImageData(p);
    return { img, file: await deps.encodeJpeg(img, 0.92) };
  };

  // debounced re-encode (share cache) + autosave to history; paused while the context is lost (nothing to
  // read back) and re-armed once it is restored
  useEffect(() => {
    if (!session || lost) return;
    const s = session;
    const key = keyOf(params);
    if (fresh.current?.key === key && savedKey.current === key) return;
    const t = window.setTimeout(async () => {
      let img: ImageData | null = null;
      if (fresh.current?.key !== key) {
        try {
          const r = await encode(s, params);
          img = r.img;
          // (a session replaced meanwhile, e.g. by a re-detect that found the face, made this file stale)
          if (keyOf(paramsRef.current) === key && sessionRef.current === s) fresh.current = { key, file: r.file };
        } catch (e) {
          // closing mid-encode is not an error (the unmount flush writes history itself), and neither is a
          // context loss (this effect re-arms once the context is restored)
          if (!unmounted.current && sessionRef.current === s && !sessionEngine.current?.lost) reportError(e, 'encode');
          return;
        }
      }
      if (unmounted.current || savedKey.current === key || sessionRef.current !== s) return;
      if (!img) {
        try {
          await s.prepareExport(params);
          if (unmounted.current || savedKey.current === key || sessionRef.current !== s) return;
          img = s.exportImageData(params);
        } catch (e) {
          reportError(e, 'history export');
          return;
        }
      }
      queueHistory(params, img, s);
    }, ENCODE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [session, params, lost]);

  const hold = useHold((on) => {
    try {
      sessionRef.current?.setCompare(on);
    } catch (e) {
      reportError(e, 'setCompare');
    }
  });

  useZoomPan(stageRef, layerRef, !!session);

  const share = (file: File) => {
    let p: Promise<string>;
    try {
      p = deps.saveFile(file);
    } catch (e) {
      p = Promise.reject(e);
    }
    p.then(
      (r) => {
        if (r === 'fallback') showSaveFallback(file);
        else if (r === 'shared') toast('完成');
      },
      (e: unknown) => {
        reportError(e, 'saveFile');
        showSaveFallback(file);
      },
    );
  };

  const save = () => {
    if (!session || preparing || lost) return;
    const key = keyOf(params);
    const f = fresh.current;
    if (f && f.key === key) {
      share(f.file); // synchronous inside the tap
      return;
    }
    setPreparing(true);
    // a re-detect or an engine recovery may replace (and dispose) the session while this waits for the filter
    // LUT: export from the replacement instead of failing
    const replacement = (failed: StillSession) => {
      const cur = sessionRef.current;
      return !unmounted.current && cur && cur !== failed && !sessionEngine.current?.lost ? cur : null;
    };
    exportOnLatest(session, (s) => encode(s, params), replacement).then(
      ({ s, result: r }) => {
        setPreparing(false);
        if (sessionRef.current === s) fresh.current = { key, file: r.file };
        share(r.file);
      },
      (e: unknown) => {
        if (unmounted.current) return;
        setPreparing(false);
        toast(`無法輸出照片：${reportError(e, 'encode')}`, 4000);
      },
    );
  };

  const doUndo = () => {
    if (!undo?.canUndo) return;
    haptic();
    const p = undo.undo();
    if (p) setParamsState(p);
    bump((n) => n + 1);
  };
  const doRedo = () => {
    if (!undo?.canRedo) return;
    haptic();
    const p = undo.redo();
    if (p) setParamsState(p);
    bump((n) => n + 1);
  };

  useEffect(() => {
    if (!confirmReset) return;
    const t = window.setTimeout(() => setConfirmReset(false), 3000);
    return () => clearTimeout(t);
  }, [confirmReset]);
  const reset = () => {
    haptic();
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setConfirmReset(false);
    update(applyPreset('natural', 1), true);
  };

  const close = () => {
    haptic();
    go(source.returnTo === 'camera' ? { name: 'camera' } : { name: 'home' });
  };

  const binding = sliderFor(params, sel);
  // face effects cannot apply: 基本模式, or no face in this photo (null while analysing, so no flash)
  // (a tracker that could not answer gets a neutral note until the re-detect gives a real answer)
  let faceNote: string | null = null;
  if (session && !session.face) {
    if (bundle?.basic) faceNote = '基本模式不支援臉型與美妝';
    else if (!bound?.unsure) faceNote = '未偵測到臉部，臉型與美妝不會套用';
    else if (trackerHealth === 'lost') faceNote = '臉部偵測重新啟動中，臉型與美妝暫不套用';
    else if (trackerHealth === 'failed') faceNote = '臉部偵測暫停，臉型與美妝暫不套用';
    else faceNote = '臉部偵測失敗，臉型與美妝暫不套用';
  }
  const faceOff = !!faceNote && FACE_TABS.includes(sel.tab);
  const ratio = session ? session.width / session.height : source.bitmap.width / Math.max(1, source.bitmap.height) || 0.75;

  let overlay = null;
  if (fatal) {
    overlay = (
      <Status icon="warning" tone="danger" title="無法開啟編輯器" detail={fatal}>
        <button type="button" class="btn" onClick={close}>
          返回
        </button>
      </Status>
    );
  } else if (!bundle) {
    overlay = <EngineStatus />;
  } else if (!session) {
    overlay = <Status spinner title="正在分析臉部…" />;
  } else if (lost) {
    overlay = <EngineStatus />; // 正在恢復畫面 · 重新載入引擎
  }

  return (
    <div class="screen editor">
      <div class="topbar">
        <IconButton icon="close" label="關閉" onClick={close} />
        <div class="title-center">
          <IconButton icon="undo" label="復原" onClick={doUndo} disabled={!undo?.canUndo} />
          <IconButton icon="redo" label="重做" onClick={doRedo} disabled={!undo?.canRedo} />
        </div>
        <button type="button" class="pill" onClick={save} disabled={!session || preparing || lost} aria-busy={preparing}>
          <span>{preparing ? '準備中' : '儲存'}</span>
        </button>
      </div>

      <div class="stage editor-stage" ref={stageRef}>
        <div class="frame" style={{ '--r': String(ratio) }}>
          <div class="zoom-layer" ref={layerRef}>
            <CanvasHost fit="contain" />
          </div>
          {hold.held && <span class="corner-label">原圖</span>}
          {session && !fatal && (
            <div class="editor-tools">
              <button type="button" class={`float-btn${confirmReset ? ' confirm' : ''}`} onClick={reset}>
                <span>
                  <Icon name="reset" size={16} stroke={2} />
                  {confirmReset ? '確定重置？' : '重置'}
                </span>
              </button>
              <button type="button" class={`float-btn${hold.held ? ' held' : ''}`} aria-label="按住對比" {...hold.props}>
                <span>
                  <Icon name="compare" size={16} stroke={2} />
                  按住對比
                </span>
              </button>
            </div>
          )}
        </div>
        {overlay}
      </div>

      <div class="editor-panel">
        <SliderRow
          binding={session && !faceOff ? binding : null}
          onChange={(v) => binding && update(binding.apply(paramsRef.current, v), false)}
          onCommit={(v) => binding && update(binding.apply(paramsRef.current, v), true)}
        />
        <BeautyPanel params={params} sel={sel} onSel={setSel} onParams={(p) => update(p, true)} faceNote={faceNote} />
      </div>
      <div class="editor-bottom-pad" />
    </div>
  );
}
