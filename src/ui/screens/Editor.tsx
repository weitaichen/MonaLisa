// Editor 編輯 (spec §7.2.4): ✕ · ↶ ↷ · 儲存; framed canvas with pinch-zoom / pan / double-tap fit;
// 按住對比 + 重置 (inline confirm) on the canvas; docked slider + BeautyPanel. Every edit is
// re-encoded (debounced 400 ms) so 儲存 can share synchronously, and autosaved to 最近編輯.
// 美體 (body research report §落地設計): the pose model loads the first time the 美體 tab opens; the detection is
// cached in the history entry, and the displacement field is rebuilt only when the body params change (a drag
// previews a draft field, at most one build per frame; the commit and every export use the full one).
// 瘦臉 background limit (faceProtectModel.ts): the face contour warps are bounded by the person mask, the cached 美體
// one or else the selfie segmenter's, once the limit is requested: the user moved a contour slider in this editor
// (contourEdited), or the reopened entry was saved with the request (source.faceProtect). Every params write records
// the request plus the segmenter mask (HistoryEntry.faceProtect / faceMask; limitRecord / writeParams), also while the
// limit cannot act yet (contour neutral, no face found, 基本模式), so a reopen rebuilds the same limit before its first
// frame (no model) and shows / exports what was saved. Preview and export draw with the same limit. New photo: not
// requested until a contour edit; undo / redo / 重置 never withdraw the request, in this editor or a later one.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { StillSession } from '../../app/still';
import { heightBandStretch } from '../../body/bands';
import { buildBodyField } from '../../body/field';
import { measureBody, paramAvailability } from '../../body/measure';
import { applyPreset, setHeightBand } from '../../engine/params';
import { buildFaceProtect } from '../../tracking/faceProtect';
import type { BeautyParams, BodyDetection, BodyField, Engine, Face } from '../../types';
import { BeautyPanel, FACE_TABS } from '../components/BeautyPanel';
import { HeightBandOverlay } from '../components/HeightBandOverlay';
import { CanvasHost } from '../components/CanvasHost';
import { IconButton } from '../components/Controls';
import { EngineStatus } from '../components/EngineStatus';
import { SliderRow } from '../components/Slider';
import { Status } from '../components/Status';
import { reportError } from '../debug';
import { deps, type UndoLike } from '../deps';
import {
  ANY_FIELD,
  BodyFieldMemo,
  bodyPanelContext,
  bodyToPersist,
  cachedBodyFits,
  detectBody,
  detectSession,
  exportOnLatest,
  FieldDraftGate,
  measureSafe,
  RedetectBudget,
  shouldDetectBody,
  stampIs,
  type BodyDet,
  type OutputStamp,
} from '../editorModel';
import { contourActive, FaceProtectSource, isContourEdit, maskCoversFace, paramsPatch, type FaceProtectRecord } from '../faceProtectModel';
import { Icon } from '../icons';
import { bandOrSuggested, INITIAL_SELECTION, showsHeightBand, sliderFor, type PanelSelection, type SliderBinding } from '../panelModel';
import { haptic } from '../platform';
import { ensureBodyTracker, ensureEngine, ensureFaceSegmenter, svc } from '../services';
import { go, setPendingHistory, showSaveFallback, toast, type EditorSource } from '../state';
import { useStore } from '../store';
import { useFilterLoader, useHold } from './hooks';
import { useZoomPan } from './zoomPan';

const ENCODE_DEBOUNCE_MS = 400;
const THUMB_EDGE = 360;
const ORIGINAL_EDGE = 2048;
/** how long a history flush waits for a filter LUT still downloading before giving up on correcting the thumb */
const FLUSH_LUT_WAIT_MS = 3000;
/** let the 正在偵測人物 note paint before the synchronous pose detection */
const BODY_PAINT_MS = 60;

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
  /** share cache: the encoded file for these params and 美體 field (so 儲存 can share synchronously inside the tap) */
  const fresh = useRef<(OutputStamp & { file: File }) | null>(null);
  const historyId = useRef<string | null>(source.historyId);
  /** what was last queued to history (a reopened entry starts saved: viewing it writes nothing) */
  const saved = useRef<OutputStamp | null>(source.historyId ? { key: keyOf(source.params), field: ANY_FIELD } : null);
  const historyChain = useRef<Promise<unknown>>(Promise.resolve());
  /** the entry holds this photo's segmenter mask (HistoryEntry.faceMask) already */
  const faceMaskStored = useRef(!!source.faceMask);
  const originalBlob = useRef<Promise<Blob> | null>(null);
  const setupDone = useRef(false);
  const faceToastDone = useRef(false);
  const sessionEngine = useRef<Engine | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  // ── 美體 ──
  const bodyTracker = useStore(svc, (s) => s.body);
  /**
   * a reopened entry starts from the cached detection Home handed over (source.body), else reads it from history
   * ('cache'): reopening never loads the pose model
   */
  const [bodyDet, setBodyDetState] = useState<BodyDet>(() => {
    if (!source.historyId) return { phase: 'idle' };
    const cached = source.body;
    if (cached !== undefined && cachedBodyFits(cached, source.bitmap.width, source.bitmap.height)) {
      return { phase: 'done', det: cached };
    }
    return { phase: 'cache' };
  });
  /** written synchronously with the state, so a history write queued in the same tick sees it */
  const bodyDetRef = useRef(bodyDet);
  const setBodyDet = (d: BodyDet) => {
    bodyDetRef.current = d;
    setBodyDetState(d);
  };
  /** the detection (or "no person") is in the history entry already */
  const bodyStored = useRef(bodyDet.phase === 'done');
  const [fieldMemo] = useState(() => new BodyFieldMemo(buildBodyField));
  /** draft vs full 美體 field: a draft (at most once per frame) only for a drag step's own params change */
  const [fieldDraft] = useState(() => new FieldDraftGate());
  /** generation of the field the session holds (bumped on every change): part of what an export was made from */
  const fieldGen = useRef(0);
  /** bumped when a full field replaced the previous one: re-arms the encode / autosave even with unchanged params */
  const [fieldTick, setFieldTick] = useState(0);
  const fieldRaf = useRef(0);
  /** a draft build waits until then: as much idle time as the last one took, so the thumb / band lines keep up */
  const draftNotBefore = useRef(0);
  /** pixel size / aspect of the photo, read once (the bitmap is closed on unmount) */
  const [photo] = useState(() => ({ width: source.bitmap.width, height: source.bitmap.height }));
  const bodyAspect = photo.width / Math.max(1, photo.height) || 1;

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

  /** commit=true records an undo step; commit=false is a drag step (the 美體 field previews a draft) */
  const update = (p: BeautyParams, commit: boolean) => {
    fieldDraft.noteUpdate(commit);
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
          () =>
            deps.createStillSession(target, tracker, source.bitmap, {
              ownsBitmap: false,
              face,
              body: fieldMemo.field,
              // built for this same face (the session keeps it only together with `face`)
              faceProtect: protectSrc.protect,
            }),
        );
        if (tracker && !unsure) {
          if (s.face && knownFace.current === undefined && replacing) {
            // found on a re-detect: what was encoded / autosaved so far lacks the face effects
            fresh.current = null;
            saved.current = null;
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

  /**
   * Queue the history write for `p` rendered with field generation `gen` (thumb + update, or a new entry) and
   * publish it for Home. Returns what it marked as saved.
   */
  const queueHistory = (p: BeautyParams, gen: number, img: ImageData, s: StillSession) => {
    const stamp: OutputStamp = { key: keyOf(p), field: gen };
    saved.current = stamp;
    // the limit `img` was drawn with (a limit change since the export re-arms its own write: see the encode effect)
    const limit = limitRecord(s);
    historyChain.current = historyChain.current
      .then(() => writeHistory(p, img, s, limit))
      .catch((e: unknown) => reportError(e, 'history autosave'));
    setPendingHistory(historyChain.current);
    return stamp;
  };

  /**
   * The 瘦臉 limit record of a history write from `s` now (HistoryEntry.faceProtect / faceMask): the request for this
   * photo, and the segmenter mask the limit `s` draws with was built from. Every params write carries one.
   */
  const limitRecord = (s: StillSession): FaceProtectRecord => protectSrc.record(s.faceProtect);

  /**
   * The params write of an existing entry, the only one there is (writeHistory and the lost-engine flush): always with
   * the limit record (paramsPatch), so params and flag never disagree; the segmenter mask once.
   */
  const writeParams = async (id: string, p: BeautyParams, limit: FaceProtectRecord, thumb?: Blob) => {
    await deps.updateEntry(id, paramsPatch(p, limit, faceMaskStored.current, thumb));
    if (limit.faceMask) faceMaskStored.current = true;
  };

  /**
   * thumb + update, or a new entry (one step of historyChain). `limit`: the limit record (limitRecord) taken when
   * `img` was exported, so a reopen draws the same.
   */
  const writeHistory = async (p: BeautyParams, img: ImageData, size: { width: number; height: number }, limit: FaceProtectRecord) => {
    const { width, height } = size;
    const thumb = await deps.toJpegBlob(img, THUMB_EDGE, 0.82);
    if (historyId.current) {
      await writeParams(historyId.current, p, limit, thumb);
      return;
    }
    const original = await (originalBlob.current ?? deps.toJpegBlob(img, ORIGINAL_EDGE, 0.9));
    const body = bodyToPersist(bodyDetRef.current, bodyStored.current);
    historyId.current = await deps.addEntry({
      original,
      width,
      height,
      ...(body !== undefined ? { body } : {}),
      ...paramsPatch(p, limit, faceMaskStored.current),
      thumb,
    });
    if (body !== undefined) bodyStored.current = true;
    if (limit.faceMask) faceMaskStored.current = true;
  };

  /**
   * Cache a fresh 美體 detection in the history entry (a body-only update: it does not reorder 最近編輯). Without
   * an entry yet, the add that creates it carries the detection instead.
   */
  const persistBody = () => {
    historyChain.current = historyChain.current
      .then(async () => {
        const id = historyId.current;
        const body = bodyToPersist(bodyDetRef.current, bodyStored.current);
        if (!id || body === undefined) return;
        await deps.updateEntry(id, { body });
        bodyStored.current = true;
      })
      .catch((e: unknown) => reportError(e, 'history body'));
    setPendingHistory(historyChain.current);
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
    const gen = settleField();
    if (stampIs(saved.current, key, gen)) return;
    if (sessionEngine.current?.lost) {
      // no GL to render a thumbnail: keep at least the params of an existing entry (with their limit record, like
      // every params write: what the user saw them drawn with)
      const id = historyId.current;
      if (!id) return;
      saved.current = { key, field: gen };
      const limit = limitRecord(s);
      historyChain.current = historyChain.current
        .then(() => writeParams(id, p, limit))
        .catch((e: unknown) => reportError(e, 'history flush'));
      setPendingHistory(historyChain.current);
      return;
    }
    const ready = s.exportReady(p);
    const field = snapshotField();
    let stamp: OutputStamp;
    try {
      stamp = queueHistory(p, gen, s.exportImageData(p, field), s);
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
        if (saved.current !== stamp || !s.exportReady(p)) return;
        await writeHistory(p, s.exportImageData(p, field), s, limitRecord(s));
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

  // ── 美體: cached detection → detection on demand → measure → field ──

  // a reopened entry: its cached detection (or cached "no person") makes the pose model unnecessary
  useEffect(() => {
    const id = source.historyId;
    if (!id || bodyDetRef.current.phase !== 'cache') return;
    let p: Promise<{ body?: BodyDetection | null } | undefined>;
    try {
      p = deps.getEntry(id);
    } catch (e) {
      p = Promise.reject(e);
    }
    p.then(
      (entry) => {
        if (unmounted.current || bodyDetRef.current.phase !== 'cache') return;
        const cached = entry?.body;
        if (cached !== undefined && cachedBodyFits(cached, photo.width, photo.height)) {
          bodyStored.current = true;
          setBodyDet({ phase: 'done', det: cached });
        } else setBodyDet({ phase: 'idle' });
      },
      (e: unknown) => {
        reportError(e, 'history body cache');
        if (!unmounted.current && bodyDetRef.current.phase === 'cache') setBodyDet({ phase: 'idle' });
      },
    );
  }, []);

  const startBodyDetection = () => {
    setBodyDet({ phase: 'working' });
    detectBody(() => ensureBodyTracker(), source.bitmap, {
      pause: () => new Promise((r) => window.setTimeout(r, BODY_PAINT_MS)),
      cancelled: () => unmounted.current,
    }).then(
      (det) => {
        if (det === undefined || unmounted.current) return;
        setBodyDet({ phase: 'done', det });
        persistBody();
      },
      (e: unknown) => {
        // a download / startup failure was reported by ensureBodyTracker and has a friendly hint; a failing
        // detection call is reported here (重試 runs it again on the same, self-healing tracker). The strip note
        // shows it as 美體偵測失敗（message）
        const st = svc.get().body;
        const message = st.state === 'error' ? st.hint : reportError(e, 'body detect');
        if (!unmounted.current) setBodyDet({ phase: 'error', message });
      },
    );
  };
  const retryBody = () => {
    if (bodyDetRef.current.phase === 'error') startBodyDetection();
  };

  // first time the 美體 tab opens (or right away when the params already use body sliders); coming back to the
  // tab after a failure retries
  const lastTab = useRef(sel.tab);
  useEffect(() => {
    const entered = sel.tab === 'body' && lastTab.current !== 'body';
    lastTab.current = sel.tab;
    if (shouldDetectBody(bodyDet, { tabOpen: sel.tab === 'body', entered, params })) startBodyDetection();
  }, [sel.tab, bodyDet, params]);

  // head / neck anchors come from the face: keep the last one while a recovering engine has no session
  const bodyFaceRef = useRef<Face | null>(null);
  const bodyFace = session ? session.face : bodyFaceRef.current;
  bodyFaceRef.current = bodyFace;
  const measure = useMemo(
    () => measureSafe(bodyDet, bodyFace, measureBody, (e) => reportError(e, 'measureBody')),
    [bodyDet, bodyFace],
  );
  const measureRef = useRef(measure);
  measureRef.current = measure;

  /** Bring the field up to date with the current params / measure (BodyFieldMemo: only the body subset counts). */
  const applyField = (draft: boolean) => {
    let r: ReturnType<BodyFieldMemo['update']>;
    try {
      r = fieldMemo.update(measureRef.current, paramsRef.current, bodyAspect, draft);
    } catch (e) {
      reportError(e, 'buildBodyField');
      return;
    }
    if (!r.changed) return;
    fieldGen.current++;
    try {
      sessionRef.current?.setBody(r.field);
    } catch (e) {
      reportError(e, 'session.setBody');
    }
    // a draft is built only for a drag step's own params change (FieldDraftGate), which re-arms the encode by itself
    if (!draft) setFieldTick((n) => n + 1);
  };
  const cancelDraft = () => {
    if (fieldRaf.current) cancelAnimationFrame(fieldRaf.current);
    fieldRaf.current = 0;
  };
  const runDraft = () => {
    fieldRaf.current = 0;
    const start = performance.now();
    if (start < draftNotBefore.current) {
      fieldRaf.current = requestAnimationFrame(runDraft);
      return;
    }
    applyField(fieldDraft.draft);
    const end = performance.now();
    draftNotBefore.current = end + (end - start);
  };
  /** The field generation an export of the current params uses: a draft (or a pending one) is rebuilt full now. */
  const settleField = (): number => {
    cancelDraft();
    applyField(false);
    // the full field replaced any pending draft: a gesture that never commits (the 增高 overlay unmounted
    // mid-drag by 按住對比) cannot keep the drag flag past this; the next real drag step sets it again
    fieldDraft.noteFull();
    return fieldGen.current;
  };
  /**
   * A copy of the session's field for an export asked for now: the builder refills its buffer in place, so a 美體
   * edit while the export waits (a filter LUT still loading) would otherwise leak into it. Call settleField first.
   * (Only the user's own state is snapshotted: the 瘦臉 limit is the session's at export time, see save.)
   */
  const snapshotField = (): BodyField | null => {
    const f = fieldMemo.field;
    return f ? { ...f, data: f.data.slice() } : null;
  };

  // rebuilt only when the body params / band / 背景保護 or the measure change (BodyFieldMemo). A commit or a
  // measure change builds the full field now, before the render effect below draws these params (and bumps
  // fieldTick: the encode / autosave re-arms); only a drag step's own params change builds a draft, in a later
  // animation frame (the latest params win, intermediate steps are dropped). A measure change during a drag
  // cancels its pending draft frame; the drag's next step schedules a new one
  useEffect(() => {
    if (fieldDraft.next(measure) === 'full') {
      cancelDraft();
      applyField(false);
    } else if (!fieldRaf.current) fieldRaf.current = requestAnimationFrame(runDraft);
  }, [measure, params]);
  useEffect(() => cancelDraft, []);

  // ── 瘦臉 background limit ──
  const [protectTick, setProtectTick] = useState(0);
  /**
   * the user moved a contour slider in this editor: with a reopened entry saved limited, the only thing that requests
   * the limit (the 自然 default already draws 瘦臉 / V臉, and a model download plus a warp that changes by itself must
   * never follow a mere import, preset, undo or 美體 detection)
   */
  const [contourEdited, setContourEdited] = useState(false);
  const limitRequested = contourEdited || source.faceProtect === true;
  const [protectSrc] = useState(
    () =>
      new FaceProtectSource(
        {
          build: (face, mask) => buildFaceProtect(face, mask, photo.width, photo.height),
          covers: (face, mask) => maskCoversFace(face, mask),
          segmenter: () => ensureFaceSegmenter().then((sg) => (sg ? { segment: () => sg.segment(source.bitmap) } : null)),
          pause: () => new Promise((r) => window.setTimeout(r, BODY_PAINT_MS)),
          now: () => performance.now(),
          cancelled: () => unmounted.current,
          report: (e, where) => reportError(e, where),
        },
        () => setProtectTick((n) => n + 1),
        // a reopened entry's saved segmentation: the same limit at once, no model
        source.faceMask ?? null,
        // a reopened entry saved with the request: requested again, for good
        source.faceProtect === true,
      ),
  );
  useEffect(() => {
    if (!session) return;
    const bodyMask = bodyDet.phase === 'done' ? (bodyDet.det?.mask ?? null) : null;
    const p = protectSrc.update(session.face, contourActive(params), bodyMask, limitRequested);
    if (session.faceProtect === p) return;
    try {
      session.setFaceProtect(p);
    } catch (e) {
      reportError(e, 'session.setFaceProtect');
      return;
    }
    // what an export is made from changed: re-arm the encode / autosave like a new 美體 field
    fieldGen.current++;
    setFieldTick((n) => n + 1);
  }, [session, bodyDet, params, protectTick, limitRequested]);

  useFilterLoader(bundle?.engine ?? null, params.filterId);

  useEffect(() => {
    if (!session) return;
    try {
      session.render(params);
    } catch (e) {
      setFatal(reportError(e, 'session.render'));
    }
  }, [session, params]);

  /**
   * Export + encode with the user's state captured when it was asked for (`p`, the 美體 `field`); waits for the filter
   * LUT so the file matches the settled preview, and draws with the session's 瘦臉 limit at export time (see save).
   */
  const encode = async (s: StillSession, p: BeautyParams, field: BodyField | null) => {
    await s.prepareExport(p);
    if (unmounted.current) throw new Error('editor closed');
    const img = s.exportImageData(p, field);
    return { img, file: await deps.encodeJpeg(img, 0.92) };
  };

  // debounced re-encode (share cache) + autosave to history; paused while the context is lost (nothing to
  // read back) and re-armed once it is restored. While a 瘦臉 limit is still being computed it waits for it (at
  // most PROTECT_WAIT_MS from the segmenter's start; protectTick re-arms this once it settles, also when it brings
  // no limit), so the limit landing does not redo a full-resolution export + history write right after this one
  useEffect(() => {
    if (!session || lost) return;
    const s = session;
    const key = keyOf(params);
    if (stampIs(fresh.current, key, fieldGen.current) && stampIs(saved.current, key, fieldGen.current)) return;
    const delay = Math.max(ENCODE_DEBOUNCE_MS, protectSrc.outputHoldMs());
    const t = window.setTimeout(async () => {
      if (unmounted.current || sessionRef.current !== s || keyOf(paramsRef.current) !== key) return;
      // (a drag held still past the debounce: export the full field, not its draft)
      const gen = settleField();
      const field = snapshotField();
      /** nothing newer (params, 美體 field, session) replaced what this export was made from */
      const current = () => keyOf(paramsRef.current) === key && sessionRef.current === s && fieldGen.current === gen;
      let img: ImageData | null = null;
      if (!stampIs(fresh.current, key, gen)) {
        try {
          const r = await encode(s, params, field);
          img = r.img;
          // (a session replaced meanwhile, e.g. by a re-detect that found the face, made this file stale)
          if (current()) fresh.current = { key, field: gen, file: r.file };
        } catch (e) {
          // closing mid-encode is not an error (the unmount flush writes history itself), and neither is a
          // context loss (this effect re-arms once the context is restored)
          if (!unmounted.current && sessionRef.current === s && !sessionEngine.current?.lost) reportError(e, 'encode');
          return;
        }
      }
      if (unmounted.current || stampIs(saved.current, key, gen) || sessionRef.current !== s) return;
      if (!img) {
        try {
          await s.prepareExport(params);
          if (unmounted.current || stampIs(saved.current, key, gen) || sessionRef.current !== s) return;
          img = s.exportImageData(params, field);
        } catch (e) {
          reportError(e, 'history export');
          return;
        }
      }
      // an edit (or a new field) during the await re-armed this effect: its own timer writes history
      if (!current()) return;
      queueHistory(params, gen, img, s);
    }, delay);
    return () => clearTimeout(t);
  }, [session, params, lost, fieldTick, protectTick]);

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
    const gen = settleField();
    const f = fresh.current;
    if (f && stampIs(f, key, gen)) {
      share(f.file); // synchronous inside the tap
      return;
    }
    // the user's state at the tap is what is exported: these params and this 美體 field (snapshotField), so a 美體
    // edit while this waits for a filter LUT does not leak into it. Inputs the system settles by itself are not
    // snapshotted: they are included as the settled preview shows them (the filter LUT finishing loading, the 瘦臉
    // limit landing: it is no user edit, it only ever appears or improves, and the autosave / thumbnail the same
    // wait produces carries it too)
    const field = snapshotField();
    setPreparing(true);
    // a re-detect or an engine recovery may replace (and dispose) the session while this waits for the filter
    // LUT: export from the replacement instead of failing
    const replacement = (failed: StillSession) => {
      const cur = sessionRef.current;
      return !unmounted.current && cur && cur !== failed && !sessionEngine.current?.lost ? cur : null;
    };
    exportOnLatest(session, (s) => encode(s, params, field), replacement).then(
      ({ s, result: r }) => {
        setPreparing(false);
        // cached only while it still matches what is on screen (not after a 美體 edit during 準備中)
        if (sessionRef.current === s && keyOf(paramsRef.current) === key && fieldGen.current === gen) {
          fresh.current = { key, field: gen, file: r.file };
        }
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
    fieldDraft.noteFull();
    if (p) setParamsState(p);
    bump((n) => n + 1);
  };
  const doRedo = () => {
    if (!undo?.canRedo) return;
    haptic();
    const p = undo.redo();
    fieldDraft.noteFull();
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

  /** a slider step (commit=false) or its commit: the only edit that counts as the user's own contour edit */
  const slide = (b: SliderBinding, v: number, commit: boolean) => {
    if (!contourEdited && isContourEdit(b.key, b.value, v)) {
      protectSrc.request(); // at once: a history write before the protect effect runs records it already
      setContourEdited(true);
    }
    update(b.apply(paramsRef.current, v), commit);
  };

  const close = () => {
    haptic();
    go(source.returnTo === 'camera' ? { name: 'camera' } : { name: 'home' });
  };

  const bodyCtx = bodyPanelContext(bodyDet, bodyTracker, measure, paramAvailability, retryBody);
  const binding = sliderFor(params, sel, bodyCtx);
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
            {session && !fatal && !hold.held && showsHeightBand(sel, bodyCtx) && (
              <HeightBandOverlay
                band={bandOrSuggested(params, bodyCtx)}
                stretch={heightBandStretch}
                onChange={(b, commit) => update(setHeightBand(paramsRef.current, b), commit)}
              />
            )}
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
          onChange={(v) => binding && slide(binding, v, false)}
          onCommit={(v) => binding && slide(binding, v, true)}
        />
        <BeautyPanel
          params={params}
          sel={sel}
          onSel={setSel}
          onParams={(p) => update(p, true)}
          faceNote={faceNote}
          body={bodyCtx}
        />
      </div>
      <div class="editor-bottom-pad" />
    </div>
  );
}
