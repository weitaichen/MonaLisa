// Editor 編輯 (spec §7.2.4): ✕ · ↶ ↷ · 儲存; framed canvas with pinch-zoom / pan / double-tap fit;
// 按住對比 + 重置 (inline confirm) on the canvas; docked slider + BeautyPanel. Every edit is
// re-encoded (debounced 400 ms) so 儲存 can share synchronously, and autosaved to 最近編輯.
// Persons (S §3.3): the first definite face answer builds the detection cache (firstAnswer) and maps the edit onto
// its persons (the current edit and every undo state); the cache is written with the entry, so a reopen runs no
// detector. Every face is drawn with its person's params and its own 瘦臉 limit (buildFrame). With ≥ 2 persons the
// person strip (全部 + one chip per person) and the drawn face boxes show (S §2.1); a chip or a photo tap selects a
// person (hitPerson, S §2.3), and every panel write goes through the lens of that selection (or 全部).
// 美體 (body research report §落地設計): the pose model loads the first time the 美體 tab opens; every body joins the
// persons (bodyAnswer: withBodies, paired against the cache's own faces; while the tracker cannot give a face answer, into
// the 基本模式 form of the cache, preAnswerCache, which that answer merges into later) and is cached in the entry's detection, and
// the one multi-person displacement field is rebuilt only when the 美體 inputs change (a drag previews a draft field, at
// most one build per frame; the commit and every export use the full one).
// 瘦臉 background limit (faceProtectModel.ts): the face contour warps are bounded by the person mask, the cached 美體
// one or else the selfie segmenter's, once the limit is requested: the user moved a contour slider in this editor
// (contourEdited), or the reopened entry was saved with the request (source.faceProtect). Every params write records
// the request plus the segmenter mask (HistoryEntry.faceProtect / faceMask; limitRecord / writeParams), also while the
// limit cannot act yet (contour neutral, no face found, 基本模式), so a reopen rebuilds the same limit before its first
// frame (no model) and shows / exports what was saved. Preview and export draw with the same limit. New photo: not
// requested until a contour edit; undo / redo / 重置 never withdraw the request, in this editor or a later one.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { SessionFace, StillDetection, StillSession } from '../../app/still';
import { forwardY, heightBandStretch } from '../../body/bands';
import { bodyFieldCacheStats, buildBodyField, fieldBands, type BodyFieldInput } from '../../body/field';
import { measureBody, paramAvailability } from '../../body/measure';
import { EXPORT_RESTORE_WAIT_MS, SPOT_CAP, STAMP_COMMIT_MS } from '../../config/limits';
import { bodyBox, personInfos } from '../../detect/cache';
import { hitPerson } from '../../detect/persons';
import { backMapCpu } from '../../engine/backMapCpu';
import { backMapFrameOf } from '../../engine/backMapFrame';
import { sanitizeParams } from '../../engine/params';
import { eyeNoteInfo } from '../../engine/passes/eyeFrame';
import { earOf, mouthOpen } from '../../engine/passes/toneGeometry';
import { abortable, ExportError } from '../../media/exportFull';
import { EXPORT_COPY, NO_SOURCE, noSourceCopy, planExport, planHead, sourceSizeRecord, type ExportPlan, type SourceInfo } from '../../media/exportPlan';
import { takePersonsHint } from '../../store/settings';
import { stableKey } from '../../store/undo';
import { buildFaceProtect } from '../../tracking/faceProtect';
import type { BodyDetection, BodyField, BrushKind, BrushSize, DetectionCache, EditState, Engine, Face, FaceProtect, LiquifyField, LookId, PersonId, PersonMask, Rect, Selection, SpotSize, Stroke, Tracker } from '../../types';
import { buildFrame } from '../../edit/frame';
import { lensFor, type PersonInfo } from '../../edit/lens';
import { legacyProjection } from '../../edit/legacy';
import { LiquifyModel, makeStrokeId, type LiveStroke } from '../../edit/liquify';
import { bodyAnswer, completeAnswer, firstAnswer, preAnswerCache } from '../../edit/migrate';
import { patchPlan, readPatch } from '../../edit/patch';
import { screenLeftIsGpLeft } from '../../edit/sides';
import { addSpot, clearScope, clearSpots, ownerAt, ownerCtxOf, planSpot, regionAt, spotRadius, spotsInScope, type PlanResult } from '../../edit/spots';
import { clearStrokes, editKey, editSetGeometry, P0, rebaseStrokes, withStrokes } from '../../edit/state';
import { TONE_COPY } from '../../edit/toneCopy';
import { createWarpGuard } from '../../edit/warpGuard';
import { bodiesUToO, faceOToU, fieldUToO, maskOToU, maskUToO, poseOToU, upCanvas, upImage, upTracker } from '../../geometry/upFrame';
import { apply, chipTransform, cropModeLayout, cssTurn, eYAt, isIdentity, lockFor, oToV, ovalViewBox, snapCrop, upQuarter, viewSize, vToO, type Quarter } from '../../geometry/view';
import { BeautyPanel, FACE_TABS, type ShownToast } from '../components/BeautyPanel';
import { BrushBar } from '../components/BrushBar';
import { BRUSH_HINT_MS, BrushHint } from '../components/BrushHint';
import { BrushOverlay, ringLook, type RingHandle } from '../components/BrushOverlay';
import { FaceBoxes, type FaceBoxItem } from '../components/FaceBoxes';
import { BandPlane, HeightBandOverlay } from '../components/HeightBandOverlay';
import { CanvasHost } from '../components/CanvasHost';
import { CropOverlay } from '../components/CropOverlay';
import { IconButton } from '../components/Controls';
import { EngineStatus } from '../components/EngineStatus';
import { drawThumb, PersonStrip, type StripPerson } from '../components/PersonStrip';
import { SliderRow } from '../components/Slider';
import { SpotControls } from '../components/SpotControls';
import { SpotOverlay, type SpotRing } from '../components/SpotOverlay';
import { Status } from '../components/Status';
import { debug, reportError } from '../debug';
import { brushAt, clientToO } from '../brushMapping';
import { BrushQueue } from '../brushQueue';
import { cropActivate, StraightenGesture, straightenView, type CropAction } from '../cropPanel';
import { deps, type UndoLike } from '../deps';
import {
  answerNotices,
  ANY_FIELD,
  BodyFieldMemo,
  bodyDetectionOf,
  bodyPanelContext,
  bodyScansAfter,
  bodyWaitsForFaces,
  changedPersons,
  completionDue,
  completionHeld,
  completionOf,
  completionShows,
  detectBody,
  detectSession,
  exportOnLatest,
  FieldDraftGate,
  fieldInputOf,
  frameFacesOf,
  hitCtxOf,
  holdsFirstAnswer,
  legsAnchorOf,
  measuredAvailable,
  measurePersons,
  needsBodyScan,
  needsFaceScan,
  outputImage,
  outputSettled,
  outputWaits,
  PERSON_TABS,
  personBodyGate,
  protectRequests,
  rebaseStamp,
  RedetectBudget,
  rescanOf,
  sessionPlan,
  settleBodyAnswer,
  shouldDetectBody,
  stampIs,
  thumbRect,
  undoToast,
  whenRestored,
  type BodyDet,
  type OutputStamp,
} from '../editorModel';
import { deliverAction, exportOutcome, noSourceNote, pillLabel, planSig, preEncodes, shareReady, tapAction, tileDrawState, type Pill, type ShareCache } from '../exportFlow';
import { FaceProtectSource, isContourEdit, maskCoversFace, paramsPatch, type FaceProtectRecord } from '../faceProtectModel';
import { Icon } from '../icons';
import {
  bandOrSuggested,
  bandTouchToast,
  clearArmKey,
  clearLabel,
  clearTap,
  faceAnswer,
  INITIAL_SELECTION,
  makeupNote,
  personNumber,
  photoScoped,
  photoTabLabel,
  photoTouchToast,
  rememberable,
  rememberSel,
  showsBrush,
  showsHeightBand,
  showsSpotMode,
  skinToolGate,
  sliderEmptyText,
  sliderFor,
  spotTapInside,
  type PanelSelection,
  type SkinPanelContext,
  type SliderBinding,
} from '../panelModel';
import { haptic } from '../platform';
import { ensureBodyTracker, ensureEngine, ensureFaceSegmenter, ensurePhotoDetector, photoDetectorPending, svc, trackerComing } from '../services';
import { app, go, setPendingHistory, showSaveFallback, toast, type EditorSource } from '../state';
import { useStore } from '../store';
import { requestLut, useAdjustFailureNotice, useElementSize, useHold, useLutLoader } from './hooks';
import { useZoomPan, type BrushHooks } from './zoomPan';

const ENCODE_DEBOUNCE_MS = 400;
const THUMB_EDGE = 360;
const ORIGINAL_EDGE = 2048;
/** how long a history flush waits for a filter LUT still downloading before giving up on correcting the thumb */
const FLUSH_LUT_WAIT_MS = 3000;
/** let the 正在偵測人物 note paint before the synchronous pose detection */
const BODY_PAINT_MS = 60;
/** the stage's bottom band under the editor tools (theme.css `.editor-tools`: bottom 2px + 48px tall) */
const TOOLS_BAND = 50;

/** the strip selection the next photo opens on (never the 祛痘 mode: rememberable) */
let lastSel: PanelSelection = INITIAL_SELECTION;
/** 祛痘 大小, remembered for the app session only (skin-cleanup spec §2.3) */
let lastSpotSize: SpotSize = 'M';
/** 推／恢復 and the size: remembered for the app session, never persisted, never undo steps (push-brush spec §2.2) */
let lastBrushKind: BrushKind = 'push';
let lastBrushSize: BrushSize = 'm';

export function Editor({ source }: { source: EditorSource }) {
  const engine = useStore(svc, (s) => s.engine);
  const lost = useStore(svc, (s) => s.lost);
  /** the tracker is replacing a dead graph ('lost') or paused its automatic retries ('failed') */
  const trackerHealth = useStore(svc, (s) => s.tracker);
  const bundle = engine.state === 'ready' ? engine.bundle : null;

  const [edit, setEditState] = useState<EditState>(source.edit);
  const editRef = useRef(edit);
  editRef.current = edit;

  // ── 推臉筆 (push-brush spec §3.5) ──
  /** bumped when a live stroke ends (commit or cancel) and when a chunked rebuild settles: re-arms sync, render and export */
  const [liquifyTick, setLiquifyTick] = useState(0);
  const [liquify] = useState(() => new LiquifyModel(source.frame, { onSettled: () => setLiquifyTick((n) => n + 1) }));
  /** a stroke is live (finger down): ↶ ↷ and 全部清除 wait, the encode / autosave waits */
  const [drawing, setDrawing] = useState(false);
  /** 「正在套用推臉筆…」 after 300 ms of a chunked rebuild */
  const [liquifyBusy, setLiquifyBusy] = useState(false);
  const [brushKind, setBrushKindState] = useState<BrushKind>(lastBrushKind);
  const [brushSize, setBrushSizeState] = useState<BrushSize>(lastBrushSize);
  const [hint, setHint] = useState<{ kind: BrushKind; gen: number } | null>(null);
  const ring = useRef<RingHandle | null>(null);
  const frameEl = useRef<HTMLDivElement>(null); // the .frame element (frameOf builds the StillFrame)
  /**
   * the live stroke; `kind` is the one it started with (a 推／恢復 switch mid-stroke applies to the next stroke).
   * `upBy`: the finger-up deadline of its synchronous drain (STAMP_COMMIT_MS from the first finger-up hook); `ending`:
   * the finger is up and the queue's backlog drains frame by frame before the commit (commitLive(true))
   */
  const live = useRef<{
    stroke: LiveStroke;
    kind: BrushKind;
    queue: BrushQueue;
    ringPx: number;
    last: { x: number; y: number };
    capToast: boolean;
    upBy: number | null;
    ending: boolean;
  } | null>(null);
  /** the stroke list the last commit replaced and the one it made: an edit computed before it keeps the stroke (update) */
  const committed = useRef<{ from: readonly Stroke[]; to: readonly Stroke[] } | null>(null);

  const publishLiquify = () =>
    debug({
      liquify: {
        strokes: editRef.current.photo.strokes.length,
        version: liquify.field?.version ?? 0,
        work: liquify.work,
        maxDisp: liquify.maxAbs,
        pending: liquify.pending,
      },
    });

  /**
   * finger up, a late second finger, pointercancel, or anything that ends the editing context: one undo step.
   * `fingerUp` (the brush hooks' commit): a backlog the frames have not drained yet is applied only until the
   * finger-up deadline, the rest one STAMP_FRAME_MS per frame, and the stroke commits from the frame that empties the
   * queue (BrushQueue.end): the same stamps in the same order as a full drain, without blocking finger up on the
   * backlog. Meanwhile the stroke stays live (`drawing`: no export, no undo), and any other caller (an edit, 儲存,
   * leaving the mode, a new stroke, hidden, unmount) commits it at once.
   */
  const commitLive = (fingerUp = false) => {
    const cur = live.current;
    if (!cur) return;
    if (fingerUp) {
      if (cur.ending) return; // its backlog is draining: the frame that empties the queue commits it
      cur.ending = true;
      ring.current?.hide();
      const now = cur.queue.end(() => {
        if (live.current === cur) commitRef.current();
      }, cur.upBy ?? performance.now() + STAMP_COMMIT_MS);
      if (!now) return;
    }
    live.current = null;
    cur.queue.finish(); // stamps still queued are applied first: what was drawn is what is committed
    const taken = new Set(editRef.current.photo.strokes.map((s) => s.id));
    const recs = cur.stroke.commit(() => {
      const id = makeStrokeId(taken);
      taken.add(id);
      return id;
    });
    ring.current?.hide();
    setDrawing(false);
    if (recs.length) {
      const prev = editRef.current;
      const next = withStrokes(prev, recs);
      committed.current = { from: prev.photo.strokes, to: next.photo.strokes };
      editRef.current = next; // a flush right after (unmount, hidden) must see it before the next render
      update(next, true);
    }
    sessionRef.current?.setLiquify(liquify.field);
    setLiquifyTick((n) => n + 1); // a no-op gesture made no edit: the export it held back still has to run
    publishLiquify();
  };

  /** a second finger within PINCH_GRACE_MS: the preview reverts, no undo step */
  const cancelLive = () => {
    const cur = live.current;
    if (!cur) return;
    live.current = null;
    cur.queue.clear();
    cur.stroke.cancel();
    ring.current?.hide();
    setDrawing(false);
    sessionRef.current?.setLiquify(liquify.field);
    setLiquifyTick((n) => n + 1);
    publishLiquify();
  };

  /**
   * Finish a pending rebuild now (儲存, the history flush: they need the committed strokes). LiquifyModel.settle() does
   * not call onSettled, so the tick is bumped here: it re-runs the sync effect (status off, __meiyan.liquify), the
   * render effect (it skipped the frame while pending; on a reopen there is none yet) and the encode effect. Uses
   * stable values only: the first render's flushHistory calls it.
   */
  const settleLiquify = () => {
    if (!liquify.pending) return;
    liquify.settle();
    sessionRef.current?.setLiquify(liquify.field);
    setLiquifyTick((n) => n + 1);
  };

  // The latest commitLive / cancelLive for callers created once: the brush hooks (memoized on brushMode) and
  // flushHistory, which the visibilitychange and unmount effects (deps []) captured on the first render; a stale
  // commitLive there would call that render's `update`.
  const commitRef = useRef(commitLive);
  commitRef.current = commitLive;
  const cancelRef = useRef(cancelLive);
  cancelRef.current = cancelLive;
  /**
   * the photo's detection cache (persons, faces, bodies); null until the first definite face answer, or until a 美體
   * detection that came before it while the tracker could not answer (preAnswerCache, S §7)
   */
  const [detect, setDetectState] = useState<DetectionCache | null>(source.detect);
  const detectRef = useRef(detect);
  const setDetect = (d: DetectionCache) => {
    detectRef.current = d;
    setDetectState(d);
  };
  /**
   * the photo had its first definite face answer (a stored cache counts; a pending rematch rides in it): the source's
   * one-shot inputs are spent. A 美體 cache written before that answer in this session leaves them for it
   */
  const answered = useRef(source.detect !== null);
  const primary: PersonId = detect?.primary ?? P0;
  const infos = useMemo(() => personInfos(detect), [detect]);
  /** view state (S §2.2): never in the undo stack, never persisted; the primary once detection answers */
  const [selection, setSelection] = useState<Selection>({ kind: 'person', id: primary });
  const multi = infos.length >= 2;
  /**
   * a selected person that disappeared (p0 handed over, a rematch) falls back to the primary (S §2.2); 全部 only means
   * something with ≥ 2 persons (one person edits exactly as in v0.3)
   */
  const selected: Selection = (selection.kind === 'person' ? !infos.some((p) => p.id === selection.id) : !multi) ? { kind: 'person', id: primary } : selection;
  const selId = selected.kind === 'all' ? 'all' : selected.id;
  /** a slider drag is in progress: chip and photo taps are ignored, the boxes hidden (S §2.1, §2.2) */
  const [dragging, setDragging] = useState(false);
  /** the 0.3 view of the edit on the primary: only shouldDetectBody reads it (is some 美體 value set) */
  const params = useMemo(() => legacyProjection(edit, primary), [edit, primary]);
  const [sel, setSelState] = useState(lastSel);
  /** boxes at full opacity for 1.5 s after a tab change, a selection change or a photo tap, then 30 % (S §2.1) */
  const [boxesIdle, setBoxesIdle] = useState(false);
  const idleTimer = useRef(0);
  const wakeBoxes = () => {
    setBoxesIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setBoxesIdle(true), 1500);
  };
  useEffect(wakeBoxes, [sel.tab, selId]);
  const choose = (s: Selection) => {
    if (dragging) return; // a chip or photo tap during a slider drag is ignored (S §2.2)
    setSelection(s);
  };
  /** the persons the last ↶ / ↷ changed: their chip and box carry .changed for 600 ms (S §1.1 item 8) */
  const [changedIds, setChangedIds] = useState<readonly PersonId[]>([]);
  const changedTimer = useRef(0);
  useEffect(
    () => () => {
      clearTimeout(idleTimer.current);
      clearTimeout(changedTimer.current);
    },
    [],
  );
  /** 「已套用到全部人物」 shows once per editor session; 「{label}套用於整張照片」 once per photo-level item */
  const allToastDone = useRef(false);
  const touchedPhoto = useRef(new Set<string>());
  /**
   * the still session plus the engine it draws with (recoverEngine replaces the engine → a new session).
   * unsure: its "no face" came from a tracker that could not answer (recovering, or the detect call threw).
   * tracked: bound with a tracker (a 基本模式 session waits for the bind the tracker that came brings).
   * held: the 基本模式 session held the photo's first answer for a tracker still coming (holdsFirstAnswer).
   */
  const [bound, setBound] = useState<{ s: StillSession; engine: Engine; unsure: boolean; tracked: boolean; held: boolean } | null>(null);
  /** bumped to detect again on the same engine once the tracker can answer (bounded: RedetectBudget) */
  const [detectGen, setDetectGen] = useState(0);
  const [redetect] = useState(() => new RedetectBudget(trackerHealth));
  /**
   * a face scan of a new up-frame is pending (S §3.6: a sideways photo, scanned once on leaving 裁切 or after ↶ ↷):
   * the next session detects on the U image of `scanQuarter` instead of reusing the cache. Cleared by its answer
   */
  const forceDetect = useRef(false);
  const scanQuarter = useRef<Quarter>(0);
  /**
   * the detection that completes a short-range answer once full-range is there (completionDue, step-1 spec §6.5) ran in
   * this editor: once per open, whatever it found (a later open tries again while the cache keeps its mark)
   */
  const moreFacesTried = useRef(false);
  /**
   * the full-range detector is in: whichever request brought it (services.ts svc.photoDetector), not only this editor's
   * asks (round 4: a retry a photo's tracker switch started, or one after a 5xx, landed unheard)
   */
  const detectorIn = useStore(svc, (s) => s.photoDetector);
  /** 正在重新偵測臉部… over the photo while the completion's detection runs */
  const [completing, setCompleting] = useState(false);
  /**
   * full-range photos now: the detector is in and this tracker takes it (a photo bundle it could not assemble leaves it
   * on short-range, Tracker.photoDetector, so a completion would find nothing new)
   */
  const fullRangeIn = (t: Tracker) => detectorIn && t.photoDetector === 'full-range';
  /** 正在重新偵測臉部… until the scanning session is bound */
  const [scanning, setScanning] = useState(false);
  const sessionGen = useRef(-1);
  const [fatal, setFatal] = useState<string | null>(null);
  const fatalRef = useRef(fatal);
  fatalRef.current = fatal;
  /** the 輸出 prefs (設定): read at the tap and by the debounce through prefsRef, so a change re-arms the pre-encode */
  const prefs = useStore(app, (s) => s.prefs);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const [pill, setPill] = useState<Pill>('save');
  /** a tiled export is running (S §2.3): the overlay, inert controls, a paused display and debounce */
  const [exporting, setExporting] = useState<{ progress: number } | null>(null);
  const exportBusy = exporting !== null;
  const exportAbort = useRef<AbortController | null>(null);
  /** the app went to the background mid-export: the return says so */
  const interrupted = useRef(false);
  /** 「此照片只保留了 {working long edge} 解析度」 once per editor session */
  const noSourceToastDone = useRef(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [, bump] = useState(0);
  /**
   * share cache: the encoded file for these params, this 美體 field and these output settings (planSig), so 儲存 can
   * share synchronously inside the tap
   */
  const fresh = useRef<ShareCache | null>(null);
  /** the file a slow export delivered: the 「分享」 tap shares it (tapAction) */
  const delivered = useRef<File | null>(null);
  const historyId = useRef<string | null>(source.historyId);
  /**
   * the entry exists, or the write that creates it is on historyChain (the first autosave's addEntry encodes and stores
   * for a while): a params write queued after it finds the id inside its own step
   */
  const entryQueued = useRef(source.historyId !== null);
  /** what was last queued to history (a reopened entry starts saved: viewing it writes nothing) */
  const saved = useRef<OutputStamp | null>(source.historyId ? { key: editKey(source.edit), field: ANY_FIELD } : null);
  const historyChain = useRef<Promise<unknown>>(Promise.resolve());
  /** the entry holds this photo's segmenter mask (HistoryEntry.faceMask) already */
  const faceMaskStored = useRef(!!source.faceMask);
  const originalBlob = useRef<Promise<Blob> | null>(null);
  const setupDone = useRef(false);
  const sessionEngine = useRef<Engine | null>(null);
  /** the session was bound with a tracker (a 基本模式 one binds again once a tracker comes, e.g. services.ts settleLate) */
  const sessionTracked = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  // ── 美體 ──
  const bodyTracker = useStore(svc, (s) => s.body);
  /**
   * the bodies live in the detection cache: a cache that knows every body (a v2 entry, a v1 entry's complete b0) makes
   * the pose model unnecessary ('done'; BodyDet.det is unused, the panel reads the cache)
   */
  const [bodyDet, setBodyDetState] = useState<BodyDet>(() =>
    source.detect?.bodies && source.detect.bodiesComplete ? { phase: 'done', det: null } : { phase: 'idle' },
  );
  /** written synchronously with the state, so a check in the same tick sees it */
  const bodyDetRef = useRef(bodyDet);
  const setBodyDet = (d: BodyDet) => {
    bodyDetRef.current = d;
    setBodyDetState(d);
  };
  // the field is built in the up frame U (S §3.4): the arrow reads buildInU (declared below) only when the memo builds
  const [fieldMemo] = useState(() => new BodyFieldMemo((input, prev, edge) => buildInU(input, prev, edge)));
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

  // ── the full-resolution source (S §3.7): decided once per import, before the add that creates the entry ──
  const workingLong = Math.max(photo.width, photo.height);
  const probed = source.source?.width && source.source.height ? { width: source.source.width, height: source.source.height } : null;
  const [keepSource] = useState<Promise<boolean>>(() =>
    source.picked ? deps.shouldKeepSource(source.picked, probed, workingLong).catch(() => false) : Promise.resolve(false),
  );
  /** what an export reads (the first session exports like every later reopen: only a kept file counts) */
  const sourceRef = useRef<SourceInfo>(source.picked ? { blob: null, width: probed?.width ?? null, height: probed?.height ?? null } : (source.source ?? NO_SOURCE));
  useEffect(() => {
    if (!source.picked) return;
    void keepSource.then((keep) => {
      if (keep && source.picked) sourceRef.current = { blob: source.picked, width: probed?.width ?? null, height: probed?.height ?? null };
    });
  }, []);

  // only a session bound to the current engine counts; while recoverEngine rebuilds there is none
  const session = bound && bundle && bound.engine === bundle.engine ? bound.s : null;

  // ── 裁切 (S §2.1): the engine draws the whole O image (identity geometry) and CSS turns the canvas ──
  const cropMode = sel.tab === 'crop';
  const g = edit.photo.geometry;
  const [straighten] = useState(() => new StraightenGesture());
  const [straightening, setStraightening] = useState(false);
  /** a 裁切 handle / move gesture changed the geometry and has not committed yet (CropOverlay onChange) */
  const [cropDragging, setCropDragging] = useState(false);
  /** a 裁切 gesture or a 拉直 drag runs: the encode / autosave effect waits for its commit */
  const geoDrag = straightening || cropDragging;
  /** 240 ms after a 旋轉 / 翻轉 tap: the canvas animates (not during 拉直 drags) */
  const [turning, setTurning] = useState(false);
  /** the turn window runs from the last tap: an earlier tap's timer must not cut a later turn short */
  const turnTimer = useRef(0);
  useEffect(() => () => clearTimeout(turnTimer.current), []);
  const stageSize = useElementSize(stageRef);
  const turnAngle = useRef<number | undefined>(undefined);
  // 重置 / 按住對比 stay in this mode and sit over the overlay: the layout keeps out of their band, so the 24 pt inset
  // still leaves the bottom handles' 44 pt targets clear of the pills. Same stage px from the top-left (CropOverlay, CanvasHost)
  const cropStage = { width: stageSize.width, height: Math.max(1, stageSize.height - TOOLS_BAND) };
  const cropLayout = cropMode && stageSize.width > 0 ? cropModeLayout(cropStage, photo, g, 24, turnAngle.current) : null;
  turnAngle.current = cropLayout ? cropLayout.angle : undefined;
  /** read at the tap (not at render), so a reduced-motion change applies to the very next 旋轉 / 翻轉 */
  const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** normal-mode overlays are V-normalized (S §2.2): an O-space box through the view (its points' V bbox) */
  const viewBoxOf = (pts: Float32Array, box: Rect): Rect => (isIdentity(g) ? box : ovalViewBox(pts, g, photo));
  const cornersOf = (b: Rect) => new Float32Array([b.x, b.y, b.x + b.w, b.y, b.x, b.y + b.h, b.x + b.w, b.y + b.h]);

  /** the session's faces, kept while a recovering engine has no session (head / neck anchors come from them) */
  const facesRef = useRef<readonly SessionFace[] | null>(null);
  const sessionFaces = session?.faces ?? facesRef.current;
  facesRef.current = sessionFaces;
  /** a cached face's drawn box in V: its adapted O-space FACE_OVAL mapped through the view (the box's corners while none is at hand) */
  const faceViewBox = (f: { id: string; box: Rect }): Rect => viewBoxOf(sessionFaces?.find((x) => x.id === f.id)?.face.oval ?? cornersOf(f.box), f.box);
  // ── the up frame U (S §3.4): O turned by whole quarters (never mirrored), so U rows = E rows and U-up = E-up. The body
  // measure, the 美體 field and a suggested 增高 band are computed in U; the field goes back to O exactly ──
  const up = upQuarter(g);
  /** the cached O masks turned into U, one object per (mask, quarter): the field builder caches per mask identity */
  const [masksU] = useState(() => new WeakMap<PersonMask, Map<Quarter, PersonMask>>());
  const maskInU = (m: PersonMask, q: Quarter): PersonMask => {
    if (q === 0) return m;
    let byQ = masksU.get(m);
    if (!byQ) masksU.set(m, (byQ = new Map()));
    let u = byQ.get(q);
    if (!u) byQ.set(q, (u = maskOToU(m, q)));
    return u;
  };
  /** a cached (O) body detection as the body measure reads it in U */
  const detU = (det: BodyDetection): BodyDetection =>
    up === 0
      ? det
      : { ...det, pose: poseOToU(det.pose, up), mask: det.mask && maskInU(det.mask, up), width: up % 2 ? det.height : det.width, height: up % 2 ? det.width : det.height };
  /** every body person measured with its PAIRED face, or none (S §3.3 item 6, P4); in U */
  const measures = useMemo(
    () =>
      measurePersons(
        detect,
        (id) => sessionFaces?.find((f) => f.id === id)?.face ?? null,
        (det, face) => measureBody(detU(det), face && faceOToU(face, up)),
        (e) => reportError(e, 'measureBody'),
      ),
    [detect, sessionFaces, up],
  );
  /** the 美體 field built on a U grid (the masks and the aspect turned in), handed back on the O grid */
  const buildInU = (input: BodyFieldInput, prev?: BodyField | null, edge?: number): BodyField | null => {
    const q = upQuarter(editRef.current.photo.geometry);
    const inputU: BodyFieldInput = q === 0 ? input : { ...input, aspect: q % 2 ? 1 / input.aspect : input.aspect, masks: input.masks.map((m) => ({ ...m, mask: maskInU(m.mask, q) })) };
    const f = buildBodyField(inputU, q === 0 ? prev : null, edge);
    return f && fieldUToO(f, q);
  };
  const measuresRef = useRef(measures);
  measuresRef.current = measures;
  // 左／右 follow the screen per face (S5 §2.2): through the view, so 翻轉 and 旋轉 move the labels, never the values
  const oView = oToV(g, photo);
  const toScreen = (p: [number, number]): [number, number] => apply(oView, p);
  /** the adapted Face of a person (its cache face id → the session face), or null for a body-only person */
  const faceOfPerson = (pid: PersonId): Face | null => {
    const fid = detect?.persons.find((c) => c.id === pid)?.face ?? null;
    return (fid !== null && sessionFaces?.find((f) => f.id === fid)?.face) || null;
  };
  const lensPersons: PersonInfo[] = infos.map((p) => {
    const face = faceOfPerson(p.id);
    return face ? { ...p, screenSwap: !screenLeftIsGpLeft(face, toScreen) } : p;
  });
  const lensOf = (e: EditState) => lensFor(e, selected, lensPersons, primary, { available: (p, id) => measuredAvailable(measuresRef.current, p, id, paramAvailability) });
  /** every face's 瘦臉 limit by face id (absent = unlimited): every render and export draws with them */
  const [protects, setProtects] = useState<ReadonlyMap<string, FaceProtect>>(() => new Map());
  const protectsRef = useRef(protects);
  protectsRef.current = protects;
  /** λ_f per face id from the last commit (S §4.4): reset by the next change, recomputed on every commit */
  const warpScales = useRef<ReadonlyMap<string, number>>(new Map());
  /** the safety net memoized per face: a commit maps only the faces whose warp changed (none for a filter tile, a shade, 美體…) */
  const warpGuard = useMemo(createWarpGuard, []);
  /**
   * what session `s` renders and exports for `e`: every face with its person's params and its limit (S §4.1). Pass the
   * exporting session: a corrected thumbnail may still export after the unmount cleared sessionRef
   */
  const frameOf = (e: EditState, s: StillSession | null = sessionRef.current) => {
    const d = detectRef.current;
    return buildFrame(e, frameFacesOf(d, s?.faces ?? []), d?.obstacles ?? [], protectsRef.current, d?.primary ?? P0, warpScales.current);
  };
  /** the device blocks of now (S §3.7) */
  const exportEnv = () => ({
    prefTier: prefsRef.current.tier,
    autoTier: deps.autoTierSession(),
    screen: { width: window.screen.width, height: window.screen.height },
    capped: deps.exportCapped(),
  });
  /** the export plan (S §3.7) of `e` on session `s` from `src`, with the 輸出 prefs and the device blocks of now */
  const planFor = (s: StillSession, e: EditState, src: SourceInfo, field: BodyField | null): ExportPlan =>
    planExport(e, prefsRef.current, src, photo, exportEnv(), s.bounds(frameOf(e, s), field, liquify.field ? (r) => liquify.maxDisp(r) : undefined), deps.readExportDebug());
  /**
   * planFor without its tiles (planHead): mode, format, quality and size, all the encode effect reads; no frame, no
   * displacement bounds, no tile planning and no debug knob on an edit step
   */
  const planHeadFor = (e: EditState, src: SourceInfo): ExportPlan => planHead(e, prefsRef.current, src, photo, exportEnv());
  /** an edit drops a finished file (a 25 MB file is not kept past the next edit, S §2.3); functional: a drag's closure may hold a stale pill */
  const dropFinished = () => {
    fresh.current = null;
    delivered.current = null;
    setPill((p) => (p === 'share' ? 'save' : p));
  };
  /** on a commit with ≥ 2 faces: the CPU port checks each changed face's warp, before the commit renders; an empty map whenever the guard does not act */
  const guardScales = (e: EditState): ReadonlyMap<string, number> => {
    const s = sessionRef.current;
    const d = detectRef.current;
    if (!s || !d || s.faces.length < 2) return new Map();
    try {
      const frame = buildFrame(e, frameFacesOf(d, s.faces), d.obstacles, protectsRef.current, d.primary);
      const lambda = warpGuard(frame, photo.width / Math.max(1, photo.height));
      const out = new Map<string, number>();
      s.faces.forEach((f, i) => {
        if (lambda[i] < 1) out.set(f.id, lambda[i]);
      });
      // it should never act (the caps keep the sum fold-free): say so in the console, but never as an error
      if (out.size) console.warn('[meiyan] warp guard scaled faces', Object.fromEntries(out));
      return out;
    } catch (err) {
      reportError(err, 'warpGuard');
      return new Map();
    }
  };

  const undo = useMemo<UndoLike<EditState> | null>(() => {
    try {
      const u = deps.createUndo<EditState>(50, { clone: false, key: editKey });
      u.reset(source.edit);
      return u;
    } catch (e) {
      reportError(e, 'UndoStack');
      return null;
    }
  }, [source]);

  const setSel = (s: PanelSelection) => {
    commitLive(); // a tab or strip-item tap ends the editing context (push-brush spec §2.5)
    // never 'spot' (step 4: a first touch on the next photo can never add a spot, S §2.3) and never 'brush': the next
    // photo opens in neither mode; the brush falls back to the item before it
    lastSel = rememberSel(rememberable(s), lastSel);
    setSelState(s);
    // another item's slider: a drag of the old one can no longer commit (its row was replaced)
    setDragging(false);
  };

  /**
   * commit=true records an undo step; commit=false is a drag step (the 美體 field previews a draft). `user`: a panel
   * write through the selection (重置 resets everyone whatever is selected: no 全部 toast). `shown`: the toast the tap
   * that made `e` has just shown (a tile's notice): the one slot then carries both lines, so neither replaces the other
   */
  const update = (e: EditState, commit: boolean, user = true, shown?: ShownToast) => {
    // a live stroke is committed first (a no-op unless one is live; commitLive clears it before it calls update): 重置,
    // 全部清除, presets and every other edit made with a second finger while the first one draws
    commitLive();
    // an edit computed before that commit (a strip item read the state without the live stroke) keeps the stroke
    const c = committed.current;
    if (c && editRef.current.photo.strokes === c.to) e = rebaseStrokes(e, c.from, c.to);
    dropFinished();
    fieldDraft.noteUpdate(commit);
    // a drag step draws the plain table; the commit checks it (S §4.4)
    warpScales.current = commit ? guardScales(e) : new Map();
    // the first 全部 write of this editor session says so (S §2.4)
    if (user && multi && selected.kind === 'all' && !allToastDone.current && changedPersons(editRef.current, e).length) {
      allToastDone.current = true;
      if (shown) toast(`${shown.text}\n已套用到全部人物`, shown.ms);
      else toast('已套用到全部人物');
    }
    setEditState(e);
    if (commit && undo) {
      try {
        undo.push(e);
      } catch (e) {
        reportError(e, 'undo.push');
      }
      bump((n) => n + 1);
    }
  };

  /** a detection changed the persons: rebase every stored state, keep "saved" saved, write the cache without reordering */
  const rebaseOnDetect = (fn: (e: EditState) => EditState, cache: DetectionCache) => {
    const prev = editRef.current;
    const next = fn(prev);
    try {
      undo?.rebase(fn);
    } catch (e) {
      reportError(e, 'undo.rebase');
    }
    editRef.current = next;
    setEditState(next);
    setDetect(cache);
    // the persons changed: the safety net's λ_f belonged to the old table
    warpScales.current = new Map();
    // bodies already known (a v2 cache, or a v1 entry's complete b0): the 美體 tab needs no pose model
    if (cache.bodies && cache.bodiesComplete && bodyDetRef.current.phase !== 'done') setBodyDet({ phase: 'done', det: null });
    // not an edit (U2): a saved output stays saved, so the autosave does not fire for it
    saved.current = rebaseStamp(saved.current, editKey(prev), editKey(next), fieldGen.current);
    historyChain.current = historyChain.current
      .then(async () => {
        const id = historyId.current;
        if (!id) return; // the addEntry that creates the entry carries `detect`
        const params = sanitizeParams(legacyProjection(next, cache.primary));
        await deps.updateEntry(id, { schema: 2, edit: next, params, paramsKey: stableKey(params), detect: cache }, { touch: false });
      })
      .catch((e: unknown) => reportError(e, 'history detect'));
    setPendingHistory(historyChain.current);
  };
  /**
   * the saved thumbnail no longer shows what the editor draws (an answer brought the photo's first faces: a v1 group
   * photo, where 0.3 drew faces[0] and 0.4 draws the primary; a 基本模式 merge; a re-detect after a faceless output):
   * rewritten once, without reordering 最近編輯
   */
  const thumbOwed = useRef(false);
  /** toasts share one slot (state.ts): the first now, each further one when the previous has had its time */
  const showNotices = (notices: readonly string[]) =>
    notices.forEach((text, i) => {
      if (i === 0) toast(text, 3200);
      else
        window.setTimeout(() => {
          if (!unmounted.current) toast(text, 3200);
        }, i * 3400);
    });
  const applyAnswer = (a: ReturnType<typeof firstAnswer>, first: boolean) => {
    // (before the rebase) this answer brings the photo's first faces: a first answer, a 基本模式 merge (A15), a re-detect
    // or a sideways scan after a faceless output. What the editor draws changed (v1: 0.3 drew faces[0], 0.4 the primary;
    // otherwise the faces now take 美型, 美妝 and their own 磨皮), so the saved thumbnail is owed (S §5.2)
    const firstFaces = !detectRef.current?.faces.length && a.detect.faces.length > 0;
    const wasPrimary = detectRef.current?.primary;
    rebaseOnDetect(a.rebase, a.detect);
    if (firstFaces) thumbOwed.current = true;
    // the first answer selects the primary (S §2.2); a later one (a re-scan, a merge) keeps the user's choice while that
    // person still exists (a vanished one falls back to the primary through `selected` anyway). A selection on the old
    // primary follows it: a merge whose body primary found no face hands the primary to a face (A13)
    setSelection((cur) =>
      first || (cur.kind === 'person' && (cur.id === wasPrimary || !a.detect.persons.some((p) => p.id === cur.id))) ? { kind: 'person', id: a.detect.primary } : cur,
    );
    const persons = a.detect.persons.length;
    // a rematch says so whenever it runs (a first answer, or the merge into a 美體 cache that carried it, S §7)
    const notices = a.dropped || (first && source.cacheDropped) ? ['已重新偵測臉部，部分人物的設定已重設'] : [];
    // over cap / too small only with the strip; the first group photo ever adds the hint (S §1.1 item 11, §2.6). A later
    // answer says what a first answer says when it brings the photo's first faces (once: the hint is taken for good)
    if (first || firstFaces) notices.push(...answerNotices(a.detect, persons, persons >= 2 && takePersonsHint()));
    showNotices(notices);
  };
  // a fitting cache that lost persons in normalizeDetect gets no answer: its toast shows once, at mount (S §5.4)
  useEffect(() => {
    if (source.detect && source.cacheDropped) toast('已重新偵測臉部，部分人物的設定已重設', 3200);
  }, []);

  useEffect(() => {
    ensureEngine().catch(() => undefined);
  }, []);

  // One still session per engine. The editor owns source.bitmap (closed on unmount), so after
  // recoverEngine replaces a lost engine the same photo is bound to the new one. A tracker coming to the same engine
  // (a slow tracker build adopted after its 基本模式 fallback) binds it again, which detects the photo the 基本模式
  // session could not (sessionPlan)
  const sessionRef = useRef<StillSession | null>(null);
  /** 按住對比 as the session was last told (useHold tells only of a change): a replacement session takes it on */
  const compareOn = useRef(false);
  const unmounted = useRef(false);
  const currentEngine = bundle?.engine ?? null;
  const currentTracked = !!bundle?.tracker;
  /**
   * what the completion's synchronous detection would freeze, or a rebase would spoil: it waits until none of these holds
   * (or a lost display). A working-size 儲存 in 準備中 too (round 4: only a tiled export held it, so the detection delayed
   * the file past the share window, and the new persons' rebase made it look edited, dropped). A tracker come to the
   * session's engine waits for it as well: its bind detects the photo the same way
   */
  const completionBusy = cropMode || drawing || dragging || exportBusy || pill === 'preparing' || lost;
  const completionBusyRef = useRef(completionBusy);
  completionBusyRef.current = completionBusy;
  useEffect(() => {
    if (!bundle) return;
    const sameBind = sessionEngine.current === bundle.engine && sessionGen.current === detectGen;
    if (sameBind && (sessionTracked.current === !!bundle.tracker || completionBusy)) return;
    const target = bundle.engine;
    const tracker = bundle.tracker;
    const gen = detectGen;
    /** only the tracker changed (the same engine and gen): this bind waits for nothing busy, at its start too */
    const trackerOnly = sameBind;
    const wasTracked = sessionTracked.current;
    sessionEngine.current = target;
    sessionGen.current = gen;
    sessionTracked.current = !!tracker;
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
    // let the "analysing" spinner paint before the synchronous face detection. A session that is about to detect first
    // waits for the full-range photo detector's first download, within DETECTOR_WAIT_MS once per session (step-1 spec
    // §6.5, services.ts photoDetectorPending): past it, or after a failed download, it detects with what is there, and
    // the cache records a short-range answer, which the completion below adds to once the detector is in. A session
    // from the cache never waits: its faces are there, and the completion runs after it is bound
    const start = () => {
      // a later bind (another engine, a re-detect, a tracker come meanwhile) owns the session now
      if (unmounted.current || sessionEngine.current !== target || sessionGen.current !== gen || sessionTracked.current !== !!tracker) return;
      // something got busy during the wait (a 儲存, a drag, 裁切): the effect binds again once nothing is
      if (trackerOnly && completionBusyRef.current) {
        sessionTracked.current = wasTracked;
        return;
      }
      if (sessionRef.current) {
        sessionRef.current.dispose();
        sessionRef.current = null;
      }
      try {
        // a fitting cache with an upright answer (the photo's own, or one found before the session a lost engine took
        // with it) is used as is, also without a tracker: cached faces are render inputs (S §3.3 item 3) and a definite
        // answer, never unsure. Anything else (no cache, a 基本模式 one, a dropped one) detects once a tracker allows
        const cache = detectRef.current;
        // a face scan of a new up-frame (S §3.6) detects whatever the cache holds (sessionPlan would reuse a cache
        // scanned upright), on the U image, answering in O
        const forced = forceDetect.current;
        const q: Quarter = forced ? scanQuarter.current : 0;
        // a scan that asks an up-frame again (its short-range "nobody" owed a full-range look): not a fresh answer
        const again = forced && rescanOf(cache, q);
        const { useCache, asks } = forced ? { useCache: false, asks: !!tracker } : sessionPlan(cache, !!tracker);
        const healthy = () => svc.get().tracker === 'ok';
        const { s, unsure } = detectSession(
          asks,
          healthy,
          () =>
            deps.createStillSession(target, tracker && upTracker(tracker, q), source.bitmap, {
              ownsBitmap: false,
              faces: useCache ? cache?.faces : undefined,
              obstacles: useCache ? cache?.obstacles : undefined,
              body: fieldMemo.field,
              // a replacement session (engine swap, re-detect) draws the strokes on its first frame
              liquify: liquify.field,
              // a camera shot's seed, with the photo's first answer (D2: the short-range detector is asked for its face
              // when full-range holds none that contains it)
              faceSeed: !useCache && !answered.current && source.faceSeed !== 'all' ? source.faceSeed : null,
            }),
        );
        // a tracker that could not answer is not "no face": no answer until the re-detect gives a real one. Nor is a
        // tracker still coming for a dropped cache's persons (holdsFirstAnswer): the bind it brings answers. One adopted
        // already counts as coming until its bind runs (the adoption re-renders before the effect that binds it)
        const now = svc.get().engine;
        const came = !tracker && now.state === 'ready' && now.bundle.engine === target && now.bundle.tracker !== null;
        const holds = holdsFirstAnswer({ hasTracker: !!tracker, useCache, answered: answered.current, rematch: source.rematch !== null, trackerComing: trackerComing() || came });
        if (!useCache && !holds && (!tracker || !unsure)) {
          // the source's one-shot inputs ride with the photo's first answer only (also when 美體 wrote the cache first
          // while no face answer could come, S §7: this answer merges into it, its body primary handing over as A13 says)
          const first = !answered.current;
          answered.current = true;
          applyAnswer(
            firstAnswer({
              detect: cache,
              prepared: tracker ? { faces: [...s.faces], obstacles: [...s.obstacles], dropped: s.dropped } : null,
              size: photo,
              v1Body: first ? source.v1Body : null,
              rematch: first ? source.rematch : null,
              faceSeed: first ? source.faceSeed : null,
              // the up-frame this detection ran in (0 for the first one): appended to faceScans
              quarter: q,
              // a short-range stand-in for the full-range detector marks the cache (§6.5)
              detector: s.detector,
            }),
            first,
          );
          // answered: the scan is done. (A tracker that could not answer keeps it pending, so the bounded re-detect
          // retries it in U, and the scan effect does not start another one for every new session)
          forceDetect.current = false;
        }
        sessionRef.current = s;
        // a re-detect, an engine swap or a tracker come replaces the session under a held 按住對比
        if (compareOn.current) {
          try {
            s.setCompare(true);
          } catch (e) {
            reportError(e, 'setCompare');
          }
        }
        setBound({ s, engine: target, unsure, tracked: !!tracker, held: holds });
        setScanning(false);
        // only a fresh answer says so (a reopened no-face photo shows no toast, S §8.4, nor does its completion, §6.5, nor
        // the scan that asks an up-frame again once full-range is in: its short-range "nobody" said so already)
        if (tracker && !unsure && !useCache && !again && !s.faces.length) toast('未偵測到臉部，臉型、美妝與膚質工具不會套用', 3200);
      } catch (e) {
        setFatal(reportError(e, 'createStillSession'));
      }
    };
    window.setTimeout(() => {
      // a session that will detect first waits for the detector's first download (D1: within DETECTOR_WAIT_MS, never for
      // a retry). One drawn from the cache does not, a short-range one included: its completion waits for nothing (§6.5)
      const plan = sessionPlan(detectRef.current, true);
      const asks = tracker !== null && (forceDetect.current || plan.asks);
      const pending = asks ? photoDetectorPending() : null;
      if (pending) void pending.then(start);
      else start();
    }, 60);
  }, [currentEngine, currentTracked, detectGen, completionBusy]);

  // the session draws identity geometry while 裁切 is open; the ratio lock is derived from the crop on entering
  const wasCrop = useRef(false);
  useEffect(() => {
    if (cropMode !== wasCrop.current) {
      wasCrop.current = cropMode;
      straighten.reset();
      setStraightening(false);
      setCropDragging(false);
      if (cropMode) {
        const lock = lockFor(editRef.current.photo.geometry, photo);
        if (lock !== sel.crop) setSel({ ...sel, crop: lock });
      }
    }
    try {
      session?.setViewMode(cropMode ? 'crop' : 'normal');
    } catch (e) {
      reportError(e, 'session.setViewMode');
    }
  }, [cropMode, session]);

  // a sideways photo (S §3.6, D12): when normal mode shows an up-frame not scanned yet while no face is known (on
  // leaving 裁切, or after ↶ ↷ elsewhere), detect once more on that U image, behind 正在重新偵測臉部…; so too an up-frame
  // the short-range detector answered, once full-range is in (§6.5). Never in 裁切 (each 旋轉 tap would block for the
  // detection), never while a scan is pending, and only on a bound session. Never while a completion is due or running
  // either (§6.5): it asks upright first, which may find the faces (no scan then) or leave the shown up-frame to ask. So
  // its end is checked here, whatever it found (round 5: one whose detection threw, or answered short-range, changed
  // nothing else, so the turned up-frame it held back was not scanned in that open)
  useEffect(() => {
    if (!bundle || !session || forceDetect.current || completing) return;
    const fullRange = !!bundle.tracker && fullRangeIn(bundle.tracker);
    if (completionDue({ cache: detectRef.current, tried: moreFacesTried.current, hasTracker: !!bundle.tracker, detectorIn: fullRange })) return;
    const geometry = editRef.current.photo.geometry;
    if (!needsFaceScan({ cache: detectRef.current, geometry, mode: cropMode ? 'crop' : 'normal', hasTracker: !!bundle.tracker, fullRange })) return;
    scanQuarter.current = upQuarter(geometry);
    forceDetect.current = true;
    setScanning(true);
    setDetectGen((n) => n + 1);
  }, [cropMode, edit.photo.geometry, detect, session, detectorIn, completing]);

  // ── the completion of a short-range answer (step-1 spec §6.5) ──
  // A cache the short-range detector answered while the full-range one was missing is drawn as it is (a definite answer,
  // faceless or not), and gains what one full-range detection finds once that detector is in: at once on a reopen, or
  // when the detector lands while the photo is open (a photo detected short-range a moment ago included), through any
  // request (detectorIn). Asking for it joins a download in flight or retries a failed one; the link coming back asks
  // again, and so does a return to the app (a captive portal signed in elsewhere fires no 'online')
  const marked = detect?.photoDetector === 'short-range' && !!bundle?.tracker;
  useEffect(() => {
    if (!marked || detectorIn || moreFacesTried.current) return;
    const ask = () => void ensurePhotoDetector();
    const back = () => {
      if (document.visibilityState === 'visible') ask();
    };
    ask();
    window.addEventListener('online', ask);
    document.addEventListener('visibilitychange', back);
    return () => {
      window.removeEventListener('online', ask);
      document.removeEventListener('visibilitychange', back);
    };
  }, [marked, detectorIn]);
  useEffect(() => {
    const tracker = bundle?.tracker ?? null;
    if (!tracker || !bound || !session) return;
    const due = completionDue({ cache: detectRef.current, tried: moreFacesTried.current, hasTracker: true, detectorIn: fullRangeIn(tracker) });
    const held = completionHeld({ bound: true, unsure: bound.unsure, health: trackerHealth, scanPending: forceDetect.current || scanning, busy: completionBusy });
    if (!due || held) return;
    // once per open: taken now, handed back only when it cannot start after all
    moreFacesTried.current = true;
    setCompleting(true);
    const target = bound.engine;
    // the cached faces are drawn; 正在重新偵測臉部… over them paints before the synchronous detection
    window.setTimeout(() => complete(target, tracker), BODY_PAINT_MS);
  }, [bound, session, detect, detectorIn, trackerHealth, scanning, completionBusy, completing]);

  /** one full-range detection where completionOf says, merged by completeAnswer when its answer is definite */
  const complete = (target: Engine, tracker: Tracker) => {
    if (unmounted.current) return;
    const cache = detectRef.current;
    const where = completionOf(cache);
    const cur = svc.get();
    const held =
      cur.engine.state !== 'ready' ||
      cur.engine.bundle.engine !== target ||
      cur.engine.bundle.tracker !== tracker ||
      sessionEngine.current !== target ||
      !sessionRef.current ||
      cur.tracker !== 'ok' ||
      forceDetect.current ||
      completionBusyRef.current;
    if (!cache || !where || held) {
      // not run: the effect starts it again once nothing holds it (or the mark is gone)
      moreFacesTried.current = false;
      setCompleting(false);
      return;
    }
    // a detection without a session (round 4: a probe session's dispose released the bound session's 美體 and 推臉筆
    // field textures, and its faces overwrote the debug state, so every completion rebuilt the session)
    let probe: { s: StillDetection; unsure: boolean } | null = null;
    try {
      probe = detectSession(
        true,
        () => svc.get().tracker === 'ok',
        () => deps.detectStill(upTracker(tracker, where.quarter), source.bitmap),
      );
    } catch (e) {
      reportError(e, 'completion');
    }
    // a definite full-range answer only: anything else leaves the cache, mark and all, for a later open
    let rebuild = false;
    if (probe && !probe.unsure && probe.s.detector === 'full-range') {
      const c = completeAnswer(cache, { faces: [...probe.s.faces], obstacles: [...probe.s.obstacles], dropped: probe.s.dropped }, photo, where.quarter);
      if (cache.faces.length) {
        // only new persons, from the template: nothing selected, owned or anchored moves. A new obstacle redraws too
        // (the frame reads the cache's, and it bounds a face's warp cap): the thumbnail is owed, and a face past the cap
        // says so, also when nobody was added (round 5)
        rebaseOnDetect(c.rebase, c.detect);
        const shows = completionShows(cache, c.detect, c.added, takePersonsHint);
        if (shows.redraws) thumbOwed.current = true;
        showNotices(shows.notices);
      } else applyAnswer(c, false);
      // the bound session draws the cache's faces (its obstacles and mark are the cache's, read per frame): rebuilt only
      // when there are new ones
      rebuild = c.added.length > 0;
    }
    setCompleting(false);
    if (rebuild) setDetectGen((n) => n + 1);
  };

  const onCropAction = (a: CropAction) => {
    const r = cropActivate(editRef.current, a, sel.crop, photo);
    if (r.lock !== sel.crop) setSel({ ...sel, crop: r.lock });
    if (r.changed) {
      if ((a.type === 'rotate' || a.type === 'flip') && !reduceMotion()) {
        setTurning(true);
        clearTimeout(turnTimer.current);
        turnTimer.current = window.setTimeout(() => setTurning(false), 260);
      }
      update(r.edit, true);
    }
    if (r.toast) toast(r.toast);
  };

  /** a 拉直 drag step (commit=false) or its commit: always from the gesture's start geometry */
  const straightenTo = (v: number, commit: boolean) => {
    setStraightening(!commit);
    update(editSetGeometry(editRef.current, straighten.step(editRef.current.photo.geometry, v, photo, commit)), commit);
  };

  // the tracker is back (or a throwing detect call has rebuilt its graph): detect again on this photo until
  // it gives a real answer (a few non-answers in a row; a tracker recovery allows a few more)
  useEffect(() => {
    if (redetect.next(!!bound?.unsure && bound.engine === currentEngine, trackerHealth)) setDetectGen((n) => n + 1);
  }, [bound, trackerHealth, currentEngine]);

  /**
   * Queue the history write for `e` rendered with field generation `gen` (thumb + update, or a new entry) and
   * publish it for Home. Returns what it marked as saved.
   */
  const queueHistory = (e: EditState, gen: number, img: ImageData, s: StillSession) => {
    const stamp: OutputStamp = { key: editKey(e), field: gen };
    saved.current = stamp;
    // this write carries a thumbnail of what the editor draws now
    thumbOwed.current = false;
    // the limit `img` was drawn with (a limit change since the export re-arms its own write: see the encode effect)
    const limit = limitRecord();
    // (writeHistory creates the entry when there is none yet)
    entryQueued.current = true;
    historyChain.current = historyChain.current
      .then(() => writeHistory(e, img, s, limit))
      .catch((e: unknown) => reportError(e, 'history autosave'));
    setPendingHistory(historyChain.current);
    return stamp;
  };

  /**
   * The 瘦臉 limit record of a history write now (HistoryEntry.faceProtect / faceMask): the request for this photo, and
   * the segmenter mask the limit every render and export draws with was built from. Every params write carries one.
   */
  const limitRecord = (): FaceProtectRecord => protectSrc.record(protectsRef.current);

  /**
   * The params write of an existing entry, the only one there is (writeHistory and the lost-engine flush): always with
   * the limit record (paramsPatch), so params and flag never disagree; the segmenter mask once.
   */
  const writeParams = async (id: string, e: EditState, limit: FaceProtectRecord, thumb?: Blob) => {
    await deps.updateEntry(id, paramsPatch(e, detectRef.current?.primary ?? P0, limit, faceMaskStored.current, thumb));
    if (limit.faceMask) faceMaskStored.current = true;
  };

  /**
   * thumb + update, or a new entry (one step of historyChain). `limit`: the limit record (limitRecord) taken when
   * `img` was exported, so a reopen draws the same.
   */
  const writeHistory = async (e: EditState, img: ImageData, size: { width: number; height: number }, limit: FaceProtectRecord) => {
    const { width, height } = size;
    const thumb = await deps.toJpegBlob(img, THUMB_EDGE, 0.82);
    if (historyId.current) {
      await writeParams(historyId.current, e, limit, thumb);
      return;
    }
    // `img` is the V image (cropped, turned): `original` stays the uncropped O working copy, so 還原 works after a reopen (S §5)
    const original = await (originalBlob.current ?? deps.toJpegBlob(source.bitmap, ORIGINAL_EDGE, 0.9));
    // the cache as it is when the entry is created (a detection-driven write before it had nothing to update)
    const detectNow = detectRef.current;
    historyId.current = await deps.addEntry({
      original,
      width,
      height,
      // the picked file, once the keep decision accepted it (addEntry retries without it on a quota error; this session
      // keeps exporting from the in-memory file, S §3.7), and its size whenever it exceeded the working edge
      ...((await keepSource) && source.picked ? { source: source.picked } : {}),
      ...(sourceSizeRecord(probed, workingLong) ?? {}),
      ...(detectNow ? { detect: detectNow } : {}),
      ...paramsPatch(e, detectNow?.primary ?? P0, limit, faceMaskStored.current),
      thumb,
    });
    if (limit.faceMask) faceMaskStored.current = true;
  };

  /**
   * A failed output read-back (exportImageData for a thumbnail or a history write) is a bug report unless the context
   * is lost: a read-back that finds a loss whose webglcontextlost is still queued throws and marks the engine lost
   * (checkReadBack, C §7), and one after the event throws too. A loss is no bug: the caller skips its write, and the
   * autosave effect re-arms once the context is restored
   */
  const reportReadBack = (err: unknown, where: string) => {
    if (!sessionEngine.current?.lost) reportError(err, where);
  };

  /**
   * Write the current params to history now if the debounce has not (✕ / 返回 within 400 ms of an edit,
   * or the app going to the background). Synchronous readback, so it works right before dispose.
   * When the filter LUT is not resident yet, a corrected thumbnail follows on historyChain: the session must
   * stay alive until that settles.
   */
  const flushHistory = () => {
    // through the ref: the visibilitychange and unmount effects hold the first render's flushHistory
    commitRef.current(); // a live stroke is committed before the editing context ends (hidden, unmount)
    settleLiquify(); // a pending rebuild finishes now: the thumbnail must show the committed strokes
    const s = sessionRef.current;
    if (!s || fatalRef.current) return;
    const e = editRef.current;
    const key = editKey(e);
    const gen = settleField();
    if (stampIs(saved.current, key, gen)) return;
    /**
     * no GL to render a thumbnail: keep at least the params of the entry (with their limit record, like every params
     * write: what the user saw them drawn with), an existing one or the one the first autosave is still creating: the
     * id is read inside the step, like writeHistory, so the write lands after that addEntry. The stored thumbnail no
     * longer shows them, so it is owed: the autosave effect draws and writes it once the context is restored, if the
     * editor is still open
     */
    const keepParams = () => {
      if (!entryQueued.current) return;
      const stamp: OutputStamp = { key, field: gen };
      saved.current = stamp;
      thumbOwed.current = true;
      const limit = limitRecord();
      historyChain.current = historyChain.current
        .then(async () => {
          const id = historyId.current;
          if (id) await writeParams(id, e, limit);
          // the addEntry it followed failed: nothing holds these params, so they are not saved (an editor still open
          // writes them, a new entry, once the autosave runs again)
          else if (saved.current === stamp) saved.current = null;
        })
        .catch((err: unknown) => reportError(err, 'history flush'));
      setPendingHistory(historyChain.current);
    };
    if (sessionEngine.current?.lost) {
      keepParams();
      return;
    }
    const ready = s.exportReady(frameOf(e, s));
    const field = snapshotField();
    const liq = liquify.snapshot();
    let stamp: OutputStamp;
    try {
      stamp = queueHistory(e, gen, s.exportImageData(frameOf(e, s), field, liq), s);
    } catch (err) {
      // the read-back found the context lost while webglcontextlost is still queued (checkReadBack marks the engine lost
      // and throws, C §7), or the render failed: no thumbnail, but the params are never dropped (✕ and the background
      // flush run once). Only a failure that is not a context loss is a bug report
      reportReadBack(err, 'history flush');
      keepParams();
      return;
    }
    if (ready) return;
    // the filter LUT (or a static texture) was still loading, so that thumbnail lacks it: write a corrected
    // one once it is resident, unless a newer edit was queued meanwhile (iOS may suspend us first: the
    // synchronous write above keeps the params either way)
    historyChain.current = historyChain.current
      .then(() => Promise.race([s.prepareExport(frameOf(e, s)), new Promise((r) => window.setTimeout(r, FLUSH_LUT_WAIT_MS))]))
      .then(async () => {
        if (saved.current !== stamp) return;
        // still not drawable (a loss the engine knows of, or the LUT wait ran out): the stored thumbnail lacks the LUT
        if (!s.exportReady(frameOf(e, s))) {
          thumbOwed.current = true;
          return;
        }
        let img: ImageData;
        try {
          img = s.exportImageData(frameOf(e, s), field, liq);
        } catch (err) {
          // a context lost meanwhile is no bug report (reportReadBack); the stored thumbnail still lacks the LUT, so it is
          // owed: drawn once the context is restored, if the editor is still open
          reportReadBack(err, 'history flush');
          thumbOwed.current = true;
          return;
        }
        await writeHistory(e, img, s, limitRecord());
      })
      .catch((err: unknown) => reportError(err, 'history flush'));
    setPendingHistory(historyChain.current);
  };

  useEffect(() => {
    // iOS may suspend or kill a backgrounded PWA before the debounce fires
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        // abort first: its listener frees ~140 MB synchronously, before the flush renders a thumbnail (S §2.3)
        if (exportAbort.current) {
          exportAbort.current.abort();
          interrupted.current = true;
        }
        flushHistory();
      } else if (interrupted.current) {
        interrupted.current = false;
        toast(EXPORT_COPY.interrupted, 4000);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(
    () => () => {
      unmounted.current = true;
      // a running tiled export frees its memory before the flush renders (✕ aborted it already; any other unmount too)
      exportAbort.current?.abort();
      // a finished file can be 25 MB: not kept past the editor (S §2.3)
      fresh.current = null;
      delivered.current = null;
      flushHistory(); // before dispose: the readback needs the live session (it commits a live stroke first)
      live.current?.queue.clear();
      live.current = null;
      const s = sessionRef.current;
      sessionRef.current = null;
      const release = () => {
        s?.dispose();
        liquify.dispose(); // the 推臉筆 buffers go with the session (push-brush spec §6.1)
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

  // ── 美體: the cache's bodies → detection on demand (every body, paired into persons) → measures → field ──

  const startBodyDetection = () => {
    setBodyDet({ phase: 'working' });
    // on the U image of the geometry now (S §3.6): the pose model wants the person upright; poses and masks come back
    // to O exactly, and the up-frame is recorded (bodyScans) so a "nobody" answer is tried once more only in a new one
    const q = upQuarter(editRef.current.photo.geometry);
    upImage(source.bitmap, q)
      .then((up) =>
        detectBody(() => ensureBodyTracker(), up.image, {
          pause: () => new Promise((r) => window.setTimeout(r, BODY_PAINT_MS)),
          cancelled: () => unmounted.current,
        }).finally(() => up.close()),
      )
      .then(
        (dets) => {
          if (dets === undefined || unmounted.current) return;
          // no face answer yet (the tracker cannot give one, S §7): the bodies build the photo's cache in the 基本模式
          // form, which is written like any cache; the face answer merges into it, a dropped cache's pending rematch with it
          const cache = detectRef.current ?? preAnswerCache(photo, answered.current ? null : source.rematch);
          let merged: DetectionCache | null = null;
          const r = settleBodyAnswer(
            () => {
              const found = dets ? bodiesUToO(dets, q).bodies : [];
              // pairing (P4) against the cache's own faces (no session needed: an engine recovery has none), the
              // body-only persons appended from the template, a vanished body's person handing over (p0 in a photo
              // without faces). The up-frames tried: this one, after the earlier ones (none before the first detection)
              const a = bodyAnswer(cache, found, photo);
              rebaseOnDetect(a.rebase, { ...a.detect, bodyScans: bodyScansAfter(cache, q) });
              merged = a.detect;
              setBodyDet({ phase: 'done', det: null });
            },
            () => {
              // body-only persons made this a group photo: the strip mounts now, with the notices of a group answer
              const n = merged?.persons.length ?? 0;
              if (merged && cache.persons.length < 2 && n >= 2) showNotices(answerNotices(merged, n, takePersonsHint()));
            },
            reportError,
          );
          // never a spinner forever (or an unhandled rejection): 重試 runs the detection again. Only a failed merge is
          // 美體偵測失敗; a notice that threw after it is reported alone (the bodies are merged)
          if (!r.ok && !unmounted.current) setBodyDet({ phase: 'error', message: r.message });
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
  // tab after a failure retries. The bodies join the persons of the face answer: wait for it (detect), unless the tracker
  // could not give one (bound.unsure: it may never come, S §7, and v0.3 never waited) or the bind holds it for a tracker
  // still coming (bound.held: that may not come either, bodyWaitsForFaces): the bodies then build the photo's cache
  // (preAnswerCache; a v1 entry's own body cache is merged without a detection, as 基本模式 merges it). Nobody found,
  // and the photo turned to an up-frame not tried yet: the next 美體 open detects once more, on that U (S §3.6, D5)
  const lastTab = useRef(sel.tab);
  useEffect(() => {
    const entered = sel.tab === 'body' && lastTab.current !== 'body';
    lastTab.current = sel.tab;
    const cache = detectRef.current;
    if (bodyWaitsForFaces({ cached: cache !== null, unsure: !!bound?.unsure, held: !!bound?.held })) return;
    const rescan = entered && bodyDet.phase !== 'working' && needsBodyScan(cache, editRef.current.photo.geometry);
    if (!shouldDetectBody(bodyDet, { tabOpen: sel.tab === 'body', entered, params }) && !rescan) return;
    if (cache === null && source.v1Body) {
      const a = firstAnswer({ detect: null, prepared: null, size: photo, v1Body: source.v1Body, rematch: null, faceSeed: null });
      rebaseOnDetect(a.rebase, a.detect);
    } else startBodyDetection();
  }, [sel.tab, bodyDet, params, detect, bound]);

  /** Bring the field up to date with the edit / measures (BodyFieldMemo: only the 美體 inputs count, S §4.6). */
  const applyField = (draft: boolean) => {
    let r: ReturnType<BodyFieldMemo['update']>;
    try {
      // keyed on the up-frame too: a 旋轉 rebuilds the field in the new U, a 翻轉 does not (S §3.4)
      r = fieldMemo.update(fieldInputOf(editRef.current, detectRef.current, measuresRef.current, bodyAspect), draft, upQuarter(editRef.current.photo.geometry));
    } catch (e) {
      reportError(e, 'buildBodyField');
      return;
    }
    if (!r.changed) return;
    // the global fold guard of the field just built (1 = untouched; S §8.4 reads it)
    debug({ lambdaGlobal: bodyFieldCacheStats.lambdaGlobal });
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

  // rebuilt only when the 美體 inputs (every person's local values, the band, 長腿, 背景保護) or the measures change
  // (BodyFieldMemo). A commit or a measures change builds the full field now, before the render effect below draws
  // this edit (and bumps fieldTick: the encode / autosave re-arms); only a drag step's own edit change builds a draft,
  // in a later animation frame (the latest edit wins, intermediate steps are dropped). A measures change during a drag
  // cancels its pending draft frame; the drag's next step schedules a new one
  useEffect(() => {
    if (fieldDraft.next(measures) === 'full') {
      cancelDraft();
      applyField(false);
    } else if (!fieldRaf.current) fieldRaf.current = requestAnimationFrame(runDraft);
  }, [measures, edit]);
  useEffect(() => cancelDraft, []);

  // ── 瘦臉 background limit ──
  const [protectTick, setProtectTick] = useState(0);
  /**
   * the user moved a contour slider in this editor: with a reopened entry saved limited, the only thing that requests
   * the limit (the 自然 preset already draws 瘦臉 / V臉, and a model download plus a warp that changes by itself must
   * never follow a mere import, preset, undo or 美體 detection; a new photo opens at 原圖)
   */
  const [contourEdited, setContourEdited] = useState(false);
  const limitRequested = contourEdited || source.faceProtect === true;
  const [protectSrc] = useState(
    () =>
      new FaceProtectSource(
        {
          build: (face, mask) => buildFaceProtect(face, mask, photo.width, photo.height),
          covers: (face, mask) => maskCoversFace(face, mask),
          // on the U image of the geometry when it runs (S §3.6), its mask mapped back to O by the exact permutation;
          // the U copy is made and released inside the synchronous segment() (none is left behind by a cancel)
          segmenter: () =>
            ensureFaceSegmenter().then((sg) =>
              sg
                ? {
                    segment: () => {
                      const q = upQuarter(editRef.current.photo.geometry);
                      if (q === 0) return sg.segment(source.bitmap);
                      const c = upCanvas(source.bitmap, q);
                      try {
                        const m = sg.segment(c);
                        return m ? maskUToO(m, q) : null;
                      } finally {
                        c.width = c.height = 0;
                      }
                    },
                  }
                : null,
            ),
          pause: () => new Promise((r) => window.setTimeout(r, BODY_PAINT_MS)),
          now: () => performance.now(),
          cancelled: () => unmounted.current,
          report: (e, where) => reportError(e, where),
          schedule: (fn) => requestAnimationFrame(() => fn()),
        },
        () => setProtectTick((n) => n + 1),
        // a reopened entry's saved segmentation: the same limit at once, no model
        source.faceMask ?? null,
        // a reopened entry saved with the request: requested again, for good
        source.faceProtect === true,
      ),
  );
  // one limit per face (F1); the session no longer holds them (A6): the frame carries them (frameOf)
  useEffect(() => {
    if (!session || !detect) return;
    const next = protectSrc.updateAll(protectRequests(detect, session.faces, edit, photo), limitRequested);
    const same = next.size === protectsRef.current.size && [...next].every(([k, v]) => protectsRef.current.get(k) === v);
    if (same) return;
    protectsRef.current = next;
    setProtects(next);
    // what an export is made from changed: re-arm the encode / autosave like a new 美體 field
    fieldGen.current++;
    setFieldTick((n) => n + 1);
  }, [session, detect, edit, protectTick, limitRequested]);

  useLutLoader(bundle?.engine ?? null, edit.photo);
  useAdjustFailureNotice(bundle?.engine ?? null, edit.photo);

  /**
   * Re-tap of the selected look whose LUT failed (step-2 spec §2.4, §7): retry the load. The still session draws only
   * when asked and the retry changes no edit, so once it worked redraw and, like a new 美體 field, re-arm the encode /
   * autosave: the share cache and the saved output were made without the look.
   */
  const retryLook = (id: LookId) => {
    if (!bundle) return;
    void requestLut(bundle.engine, 'look', id).then((ok) => {
      const s = sessionRef.current;
      const e = editRef.current;
      // (another look picked meanwhile: the edit already redrew and re-armed for that one)
      if (!ok || !s || unmounted.current || e.photo.look?.id !== id) return;
      try {
        s.render(frameOf(e, s));
      } catch (err) {
        setFatal(reportError(err, 'session.render'));
        return;
      }
      fieldGen.current++;
      setFieldTick((n) => n + 1);
    });
  };

  // the field follows the committed strokes (undo, redo, 全部清除, 重置, reopen). Declared before the render effect, so a
  // frame never draws new strokes with an old field (push-brush spec §3.5)
  useEffect(() => {
    const r = liquify.sync(edit.photo.strokes);
    if (!r.pending) sessionRef.current?.setLiquify(liquify.field);
    publishLiquify();
    if (!r.pending) {
      setLiquifyBusy(false);
      return;
    }
    const t = window.setTimeout(() => setLiquifyBusy(liquify.pending), 300);
    return () => clearTimeout(t);
  }, [edit.photo.strokes, liquifyTick]);

  useEffect(() => {
    // a chunked rebuild is pending: the canvas keeps its previous frame (on a reopen there is none yet: the status shows)
    if (!session || liquify.pending) return;
    try {
      session.render(frameOf(edit, session));
    } catch (e) {
      setFatal(reportError(e, 'session.render'));
    }
  }, [session, edit, protects, detect, liquifyTick]);
  // (a layout effect: a tap's selection is readable by the time the event's task ends)
  useLayoutEffect(() => {
    if (!session) return;
    // V-normalized like the drawn boxes (S §2.2): a tap at a box centre on the layer hits that person; the obstacles and
    // drops too (e2e: an eleventh face is an obstacle, S §6.7)
    debug({
      persons: infos.length,
      faces: session.faces.length,
      selected: selId,
      boxes: (detect?.faces ?? []).map((f) => ({ id: f.id, ...faceViewBox(f) })),
      obstacles: (detect?.obstacles ?? []).map((o) => viewBoxOf(o.oval, o.box)),
      dropped: { ...(detect?.dropped ?? { tooSmall: 0, overCap: 0 }) },
    });
  }, [session, detect, infos, selId, edit.photo.geometry]);

  /**
   * The session that took over from `failed` (a re-detect or an engine recovery replaced and disposed it), on a live
   * engine; null while there is none, or once the editor closed. An export runs again on it (exportOnLatest).
   */
  const replacementOf = (failed: StillSession): StillSession | null => {
    const cur = sessionRef.current;
    return !unmounted.current && cur && cur !== failed && !sessionEngine.current?.lost ? cur : null;
  };

  /**
   * Export + encode with the user's state captured when it was asked for (`e`, the 美體 `field`, the 推臉筆 `liq`); waits
   * for the filter LUT so the file matches the settled preview, and draws with the 瘦臉 limits at export time (see save).
   * The working size, encoded in the plan's format and quality. A lost context (the tiled fallback starts right after a
   * loss during the tiles) is waited for (C §7): once restored, prepareExport waits for the reloaded textures. The wait
   * ends at once when a session on a new engine took over (重新載入引擎: the old canvas is never restored) or the editor
   * closed: the ExportError('lost') then hands the export to that session (runWorking's exportOnLatest).
   */
  const encode = async (s: StillSession, e: EditState, field: BodyField | null, plan: ExportPlan, liq: LiquifyField | null) => {
    const engine = sessionEngine.current;
    const superseded = () => unmounted.current || replacementOf(s) !== null;
    if (engine?.lost && !(await whenRestored(engine, EXPORT_RESTORE_WAIT_MS, superseded))) throw new ExportError('lost', 'the WebGL context was not restored');
    await s.prepareExport(frameOf(e, s));
    if (unmounted.current) throw new Error('editor closed');
    const img = s.exportImageData(frameOf(e, s), field, liq);
    return { img, file: await deps.encodeOutput(img, plan.format, plan.quality) };
  };

  // debounced re-encode (share cache) + autosave to history; paused while the context is lost (nothing to
  // read back) and re-armed once it is restored. While a 瘦臉 limit is still being computed it waits for it (at
  // most PROTECT_WAIT_MS from the segmenter's start; protectTick re-arms this once it settles, also when it brings
  // no limit), so the limit landing does not redo a full-resolution export + history write right after this one.
  // Only a working-size JPEG plan keeps a pre-encoded share file (S §2.3); a share file is for the output settings it was
  // made with (planSig: a 設定 change re-arms this, Review Focus 1). Waits while a tiled export runs (its GL buffers are
  // tile-sized: a working-size render meanwhile would grow them back) and runs once when it ends. Waits while a 推臉筆
  // stroke is live or a rebuild is pending (push-brush spec §3.5): the `drawing` flip cancels a timer armed before the
  // stroke, so a debounced export never caches half a stroke under the pre-stroke editKey; liquifyTick re-arms it.
  // Waits while a 裁切 handle / move or 拉直 drag runs (geoDrag): its steps are no undo step yet and arrive at display
  // rate; the commit at gesture end runs this once. It reads the plan's head only (planHeadFor): an edit step pays for
  // no frame, no displacement bounds and no tile planning.
  useEffect(() => {
    if (!session || outputWaits({ noSession: false, lost, exportBusy, stroke: drawing, rebuild: liquify.pending, geoDrag })) return;
    const s = session;
    const key = editKey(edit);
    const now = planHeadFor(edit, sourceRef.current);
    // (a tiled or PNG plan has no share file to make; an owed thumbnail is drawn whatever the plan, also when the share
    // file for these params is made already)
    const settled = outputSettled({
      preEncodes: preEncodes(now),
      shareReady: shareReady(fresh.current, key, fieldGen.current, planSig(now)),
      thumbOwed: thumbOwed.current,
      saved: stampIs(saved.current, key, fieldGen.current),
    });
    if (settled) return;
    const delay = Math.max(ENCODE_DEBOUNCE_MS, protectSrc.outputHoldMs());
    const t = window.setTimeout(async () => {
      if (unmounted.current || sessionRef.current !== s || editKey(editRef.current) !== key) return;
      // synchronously, from the refs: a stroke that started after this timer was armed may have applied stamps before
      // the `drawing` flip's cleanup cancels it (Preact runs it after the next frame); liquifyTick re-arms the export
      const wait = { noSession: false, lost: !!sessionEngine.current?.lost, exportBusy: exportAbort.current !== null, stroke: live.current !== null, rebuild: liquify.pending, geoDrag: false };
      if (outputWaits(wait)) return;
      // (a drag held still past the debounce: export the full field, not its draft)
      const gen = settleField();
      const field = snapshotField();
      const liq = liquify.snapshot();
      /** nothing newer (params, 美體 field, session) replaced what this export was made from */
      const current = () => editKey(editRef.current) === key && sessionRef.current === s && fieldGen.current === gen;
      // (the head: a working-size encode reads format and quality, the share cache planSig; tiles are 儲存's)
      const plan = planHeadFor(edit, sourceRef.current);
      const sig = planSig(plan);
      let img: ImageData | null = null;
      const need = outputImage({
        preEncodes: preEncodes(plan),
        shareReady: shareReady(fresh.current, key, gen, sig),
        thumbOwed: thumbOwed.current,
        saved: stampIs(saved.current, key, gen),
        entry: historyId.current !== null,
      });
      if (need === 'encode') {
        try {
          const r = await encode(s, edit, field, plan, liq);
          img = r.img;
          // (a session replaced meanwhile, e.g. by a re-detect that found the face, made this file stale)
          if (current()) fresh.current = { key, field: gen, sig, file: r.file };
        } catch (e) {
          // closing mid-encode is not an error (the unmount flush writes history itself), and neither is a
          // context loss (this effect re-arms once the context is restored)
          if (!unmounted.current && sessionRef.current === s && !sessionEngine.current?.lost) reportError(e, 'encode');
          return;
        }
      } else if (need === 'thumb') {
        // no share file to make (a tiled or PNG plan, or the one for these params is made already): an owed thumbnail
        // still gets the working-size image
        try {
          await s.prepareExport(frameOf(edit, s));
          if (unmounted.current || sessionRef.current !== s) return;
          img = s.exportImageData(frameOf(edit, s), field, liq);
        } catch (e) {
          reportReadBack(e, 'history export');
          return;
        }
      }
      // the output of a saved entry is exported anyway for the share cache (or for the thumbnail alone): an owed
      // thumbnail (thumbOwed) is rewritten from it once, without reordering 最近編輯
      if (img && current() && thumbOwed.current && historyId.current && stampIs(saved.current, key, gen)) {
        thumbOwed.current = false;
        const id = historyId.current;
        const shot = img;
        historyChain.current = historyChain.current
          .then(async () => deps.updateEntry(id, { thumb: await deps.toJpegBlob(shot, THUMB_EDGE, 0.82) }, { touch: false }))
          .catch((e: unknown) => reportError(e, 'history thumb'));
        setPendingHistory(historyChain.current);
      }
      if (unmounted.current || stampIs(saved.current, key, gen) || sessionRef.current !== s) return;
      if (!img) {
        try {
          await s.prepareExport(frameOf(edit, s));
          if (unmounted.current || stampIs(saved.current, key, gen) || sessionRef.current !== s) return;
          img = s.exportImageData(frameOf(edit, s), field, liq);
        } catch (e) {
          reportReadBack(e, 'history export');
          return;
        }
      }
      // an edit (or a new field) during the await re-armed this effect: its own timer writes history
      if (!current()) return;
      queueHistory(edit, gen, img, s);
    }, delay);
    return () => clearTimeout(t);
  }, [session, edit, lost, fieldTick, protectTick, exportBusy, prefs, drawing, liquifyTick, geoDrag]);

  const hold = useHold((on) => {
    compareOn.current = on;
    try {
      sessionRef.current?.setCompare(on);
    } catch (e) {
      reportError(e, 'setCompare');
    }
  });

  // ── 推臉筆 brush mode (push-brush spec §2.5): one finger draws, two fingers pinch; never while 按住對比 is held ──
  /**
   * the mode: the brush bar, the dimmed strip, the hint and the gesture hooks (zoomPan's reducer). 按住對比 keeps it
   * (§2.3: the hold only hides the ring and starts no stroke), and so does a lost context (§7)
   */
  const brushMode = !!session && !fatal && showsBrush(sel);
  /** a stroke can start and the ring shows: not while 按住對比 is held, not with the context lost */
  const brushDraws = brushMode && !lost && !hold.held;
  const drawsRef = useRef(brushDraws);
  drawsRef.current = brushDraws;
  /** read at the pointer down: the hold and the context as they are now (a press in the frame before the re-render) */
  const canDraw = () => drawsRef.current && !hold.isHeld() && !svc.get().lost;

  const frameXY = (p: { x: number; y: number }) => {
    const r = frameEl.current?.getBoundingClientRect();
    return r ? { x: p.x - r.left, y: p.y - r.top } : p;
  };
  const layerRect = () => layerRef.current?.getBoundingClientRect() ?? null;
  const kindRef = useRef(brushKind);
  kindRef.current = brushKind;
  const sizeRef = useRef(brushSize);
  sizeRef.current = brushSize;

  // memoized on brushMode only (a new hooks object restarts zoomPan's reducer, so 按住對比 must not make one): the latest
  // commitLive / cancelLive are called through commitRef / cancelRef, everything else is read through refs
  const brushHooks = useMemo<BrushHooks | null>(() => {
    if (!brushMode) return null;
    return {
      start(p) {
        // a stroke whose backlog still drains after its finger up commits now; any other live stroke keeps the input
        if (live.current?.ending) commitRef.current();
        if (live.current) return;
        // 按住對比 held or the context lost: the finger neither draws nor pans (two fingers still pinch)
        if (!canDraw()) return;
        const r = layerRect();
        if (!r) return;
        const g = editRef.current.photo.geometry;
        const b = brushAt(p, sizeRef.current, r, g, source.frame);
        const kind = kindRef.current; // fixed for the stroke: a switch mid-stroke applies to the next one
        const stroke = liquify.begin(kind, b.radius, b.o);
        if (!stroke) {
          // a cap is already reached (a pending rebuild refuses input silently: its status shows)
          if (!liquify.pending) toast('推臉筆筆畫已達上限', 2600);
          return;
        }
        const queue = new BrushQueue({
          add: (o) => stroke.add(o),
          changed: () => {
            sessionRef.current?.setLiquify(liquify.field); // the session coalesces renders to one per frame
            const cur = live.current;
            if (!cur || cur.stroke !== stroke) return; // drained by a commit: the ring is already hidden
            if (!cur.ending) {
              // (after finger up the backlog still drains, but the ring is gone)
              const f = frameXY(cur.last);
              ring.current?.show(f.x, f.y, cur.ringPx, ringLook(kind, stroke.state));
            }
            if (stroke.state === 'capped' && !cur.capToast) {
              cur.capToast = true; // once per gesture (push-brush spec §2.4)
              toast('推臉筆筆畫已達上限', 2600);
            }
          },
          now: () => performance.now(),
          raf: (cb) => requestAnimationFrame(cb),
          cancelRaf: (id) => cancelAnimationFrame(id),
        });
        live.current = { stroke, kind, queue, ringPx: b.ringPx, last: p, capToast: false, upBy: null, ending: false };
        setDrawing(true);
        const f = frameXY(p);
        ring.current?.show(f.x, f.y, b.ringPx, ringLook(kind, stroke.state));
      },
      move(ps) {
        const cur = live.current;
        const r = layerRect();
        if (!cur || !r || !ps.length) return;
        const g = editRef.current.photo.geometry;
        for (const p of ps) cur.queue.push(clientToO(p, r, g, source.frame));
        cur.last = ps[ps.length - 1];
        const f = frameXY(cur.last);
        ring.current?.show(f.x, f.y, cur.ringPx, ringLook(cur.kind, cur.stroke.state));
      },
      commit: () => commitRef.current(true),
      cancel: () => cancelRef.current(),
      stamped() {
        const cur = live.current;
        if (!cur) return false;
        // finger up: the backlog only until the deadline the commit that follows shares (STAMP_COMMIT_MS in all); points
        // still queued then are a drawn stroke, never a tap (a tap's few points drain well within it)
        cur.upBy ??= performance.now() + STAMP_COMMIT_MS;
        cur.queue.drainUntil(cur.upBy);
        return cur.stroke.stamped || cur.queue.size > 0;
      },
      pinch(on) {
        if (on) ring.current?.hide();
      },
    };
  }, [brushMode]);

  // leaving brush mode (tab, item, crop), pressing 按住對比 or losing the context commits a live stroke first: what was
  // drawn is one undo step, and the next stroke starts after the release or the restore (push-brush spec §7)
  useEffect(() => {
    if (!brushDraws) commitLive();
  }, [brushDraws]);

  // the hint pill: on entering the mode and on each 推／恢復 switch, for BRUSH_HINT_MS (a 按住對比 hold is no re-entry)
  useEffect(() => {
    if (!brushMode) {
      setHint(null);
      return;
    }
    setHint((h) => ({ kind: brushKind, gen: (h?.gen ?? 0) + 1 }));
    const t = window.setTimeout(() => setHint(null), BRUSH_HINT_MS);
    return () => clearTimeout(t);
  }, [brushMode, brushKind]);

  const setBrushKind = (k: BrushKind) => {
    lastBrushKind = k;
    setBrushKindState(k); // applies to the next stroke (a live one keeps its kind)
  };
  /** the preview ring's hide timer: a later size tap restarts the 700 ms */
  const previewTimer = useRef(0);
  useEffect(() => () => clearTimeout(previewTimer.current), []);
  const setBrushSize = (s: BrushSize) => {
    lastBrushSize = s;
    setBrushSizeState(s);
    // a preview ring at the centre of the frame for 700 ms (push-brush spec §2.2), at the size the brush will have there
    const fr = frameEl.current?.getBoundingClientRect();
    const lr = layerRect();
    if (!fr || !lr || live.current) return;
    const c = { x: fr.left + fr.width / 2, y: fr.top + fr.height / 2 };
    const b = brushAt(c, s, lr, editRef.current.photo.geometry, source.frame);
    ring.current?.show(fr.width / 2, fr.height / 2, b.ringPx, ringLook(kindRef.current, 'ok'));
    clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(() => {
      if (!live.current) ring.current?.hide();
    }, 700);
  };
  const clearAllStrokes = () => update(clearStrokes(editRef.current), true); // update commits a live stroke first

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

  /**
   * 儲存 (S §2.3): the plan of the user's state at the tap. A file ready for it (the debounced JPEG, or the last export's
   * file for these output settings) and a slow export's delivered file (「分享」) are shared synchronously inside the tap;
   * otherwise the working size is encoded (today's path) or the source is rendered in tiles.
   */
  const save = () => {
    if (!session || lost) return;
    // a live stroke is committed first and a pending rebuild finished: the file shows the committed strokes (§2.5)
    commitLive();
    settleLiquify();
    const action = tapAction(pill, delivered.current !== null);
    if (action === 'ignore') return;
    if (action === 'sharePending') {
      const file = delivered.current!;
      delivered.current = null;
      setPill('save');
      share(file); // synchronous inside the tap: a fresh transient activation
      return;
    }
    const s = session;
    // the user's state at the tap is what is exported: these params and this 美體 field (snapshotField), so a 美體
    // edit while this waits for a filter LUT does not leak into it. Inputs the system settles by itself are not
    // snapshotted: they are included as the settled preview shows them (the filter LUT finishing loading, the 瘦臉
    // limit landing: it is no user edit, it only ever appears or improves, and the autosave / thumbnail the same
    // wait produces carries it too)
    const e = editRef.current;
    const key = editKey(e);
    const gen = settleField();
    const field = snapshotField();
    // the user's strokes at the tap (the snapshotField rule)
    const liq = liquify.snapshot();
    const plan = planFor(s, e, sourceRef.current, field);
    const sig = planSig(plan);
    if (shareReady(fresh.current, key, gen, sig)) {
      setPill('save');
      share(fresh.current!.file); // synchronous inside the tap
      return;
    }
    if (noSourceNote(plan, sourceRef.current, photo) && !noSourceToastDone.current) {
      noSourceToastDone.current = true;
      toast(noSourceCopy(workingLong));
    }
    const t0 = performance.now();
    if (plan.mode === 'tiled' && sourceRef.current.blob && sessionEngine.current) runTiled(s, e, field, plan, key, gen, t0, liq);
    else runWorking(s, e, field, plan, key, gen, t0, liq);
  };

  /**
   * finished: share inside the 4 s window, else the pill asks for a second tap (S §2.3), but only for a file of the
   * current edit (`current`: editKey only): an edit during 準備中 superseded it, so it is dropped
   */
  const deliver = (file: File, t0: number, current: boolean) => {
    const action = deliverAction(t0, performance.now(), current);
    if (action === 'share') {
      setPill('save');
      share(file);
    } else if (action === 'pending') {
      delivered.current = file;
      setPill('share');
      toast(EXPORT_COPY.shareReady, 4000);
    } else setPill('save');
  };

  /** today's path: the working size, encoded in the plan's format */
  const runWorking = (s: StillSession, e: EditState, field: BodyField | null, plan: ExportPlan, key: string, gen: number, t0: number, liq: LiquifyField | null) => {
    setPill('preparing');
    // a re-detect or an engine recovery may replace (and dispose) the session while this waits for the filter
    // LUT or for a restore: export from the replacement instead of failing
    exportOnLatest(s, (x) => encode(x, e, field, plan, liq), replacementOf).then(
      ({ s: done, result: r }) => {
        // ✕ during 準備中 (only a tiled export is aborted by it): no share sheet, fallback or 「分享」 toast over Home
        if (unmounted.current) return;
        debug({ export: { mode: 'working', width: r.img.width, height: r.img.height, tiles: 0, ms: Math.round(performance.now() - t0) } });
        // cached only while it still matches what is on screen (not after a 美體 edit during 準備中); kept for 分享
        // unless an edit superseded it (a field or limit the system settled meanwhile is no edit, S §2.3)
        const edited = editKey(editRef.current) !== key;
        if (!edited && sessionRef.current === done && fieldGen.current === gen) fresh.current = { key, field: gen, sig: planSig(plan), file: r.file };
        deliver(r.file, t0, !edited);
      },
      (err: unknown) => {
        if (unmounted.current) return;
        setPill('save');
        // a context that stayed lost (C §7) is no bug: a plain retry note, not the raw error
        if ((err instanceof ExportError && err.kind === 'lost') || sessionEngine.current?.lost) {
          console.warn('[meiyan] export: WebGL context lost', err);
          toast(EXPORT_COPY.lostRetry, 4000);
          return;
        }
        toast(`無法輸出照片：${reportError(err, 'encode')}`, 4000);
      },
    );
  };

  /**
   * the source decoded at up to 4096 and rendered in tiles; one fallback to the working size on failure (C §4.6). Like
   * encode(), it first waits for the 濾鏡 / 質感 LUTs and the static textures, so the file matches the settled preview:
   * the engine draws a tile without a LUT that is still loading, and one landing between tiles would leave seams
   */
  const runTiled = (s: StillSession, e: EditState, field: BodyField | null, plan: ExportPlan, key: string, gen: number, t0: number, liq: LiquifyField | null) => {
    const engine = sessionEngine.current!;
    const blob = sourceRef.current.blob!;
    const ac = new AbortController();
    exportAbort.current = ac;
    setPill('preparing');
    setExporting({ progress: 0 });
    debug({ export: null });
    /**
     * This export's UI ends once: at 取消, ✕ or the background abort, at once (step-3 review: the runner frees its memory
     * synchronously, but its pending await, a multi-second decode, an encode or a rAF that never fires while hidden,
     * settles later), else when the runner settles. Never a later export's: exportAbort is that one's by then. The
     * runner checks the signal after every await, so it draws no tile once the display is back.
     */
    let ended = false;
    const endUi = () => {
      if (ended) return;
      ended = true;
      if (exportAbort.current === ac) exportAbort.current = null;
      setExporting(null);
      try {
        s.pauseDisplay(false);
      } catch (err) {
        reportError(err, 'pauseDisplay');
      }
    };
    ac.signal.addEventListener(
      'abort',
      () => {
        endUi();
        if (!unmounted.current) setPill('save');
      },
      { once: true },
    );
    // 取消, ✕ and the background abort end this wait too (abortable); the display keeps drawing meanwhile, so a LUT
    // landing shows in the preview
    abortable(s.prepareExport(frameOf(e, s)), ac.signal)
      .then(() => {
        // the frame of now, as encode() takes it: a 瘦臉 limit that landed during the wait is in it
        const frame = frameOf(e, s);
        s.pauseDisplay(true);
        return deps.runTiledExport(engine, blob, plan, s.tileInput(frame, field, liq), {
          signal: ac.signal,
          working: photo,
          knob: deps.readExportDebug(),
          onProgress: (p) => {
            if (!ended) setExporting({ progress: p });
          },
          drawState: () => tileDrawState(engine, frame.photo),
        });
      })
      .then(
        (file) => {
          // (cancelled after the runner had finished: the user asked for no file)
          if (unmounted.current || ac.signal.aborted) return;
          debug({ export: { mode: 'tiled', width: plan.width, height: plan.height, tiles: plan.tiles.length, ms: Math.round(performance.now() - t0) } });
          const edited = editKey(editRef.current) !== key;
          if (!edited && fieldGen.current === gen) fresh.current = { key, field: gen, sig: planSig(plan), file };
          deliver(file, t0, !edited);
        },
        (err: unknown) => {
          // an abort's UI ended at the abort (the pill may be a newer export's by now)
          if (unmounted.current || ac.signal.aborted) return;
          if (exportOutcome(err) === 'abort') {
            setPill('save');
            return;
          }
          // a handled fallback, told by its toast: a warning, not reportError (console.error fails every e2e test,
          // tests/e2e/fixtures.ts guard, and the knob-injected failures of crop.spec.ts take this path)
          console.warn('[meiyan] tiled export failed; standard fallback', err);
          toast(EXPORT_COPY.fallback, 4000);
          const working = planFor(s, e, NO_SOURCE, field);
          runWorking(sessionRef.current ?? s, e, field, working, key, gen, t0, liq);
        },
      )
      .finally(endUi);
  };

  /** ↶ ↷ never change the selection; they flag the persons they changed and name them when none is selected (S §1.1 item 8) */
  const afterHistoryStep = (kind: 'undo' | 'redo', before: EditState, after: EditState) => {
    const ids = changedPersons(before, after);
    setChangedIds(ids);
    clearTimeout(changedTimer.current);
    changedTimer.current = window.setTimeout(() => setChangedIds([]), 600);
    if (!multi) return;
    const l = lensOf(after);
    const t = undoToast(kind, ids, selected, (id) => personNumber(l, id));
    if (t) toast(t, 2600);
  };
  const doUndo = () => {
    // never while a stroke is live (push-brush spec §2.5): finger up makes its undo step first
    if (drawing || !undo?.canUndo) return;
    haptic();
    const before = editRef.current;
    const e = undo.undo();
    fieldDraft.noteFull();
    if (e) {
      // a finished file is for the state before (S §2.3)
      dropFinished();
      // an undo lands on another committed state: the safety net checks it (S §4.4)
      warpScales.current = guardScales(e);
      setEditState(e);
      // the highlighted ratio follows the restored crop (S §2.1)
      if (sel.tab === 'crop') setSel({ ...sel, crop: lockFor(e.photo.geometry, photo) });
      afterHistoryStep('undo', before, e);
    }
    bump((n) => n + 1);
  };
  const doRedo = () => {
    if (drawing || !undo?.canRedo) return;
    haptic();
    const before = editRef.current;
    const e = undo.redo();
    fieldDraft.noteFull();
    if (e) {
      dropFinished();
      warpScales.current = guardScales(e);
      setEditState(e);
      if (sel.tab === 'crop') setSel({ ...sel, crop: lockFor(e.photo.geometry, photo) });
      afterHistoryStep('redo', before, e);
    }
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
    const next = lensOf(editRef.current).reset();
    update(next, true, false);
    // 重置 resets the crop too: the highlighted ratio follows it (S §2.1), 自由 for the identity geometry
    if (sel.tab === 'crop') setSel({ ...sel, crop: lockFor(next.photo.geometry, photo) });
  };

  /** a slider step (commit=false) or its commit: the only edit that counts as the user's own contour edit */
  const slide = (b: SliderBinding, v: number, commit: boolean) => {
    setDragging(!commit);
    const t = photoTouchToast(b, lensOf(editRef.current), touchedPhoto.current);
    if (t) toast(t);
    if (!contourEdited && isContourEdit(b.param ?? b.key, b.value, v)) {
      protectSrc.request(); // at once: a history write before the protect effect runs records it already
      setContourEdited(true);
    }
    update(b.apply(lensOf(editRef.current), v), commit);
  };

  const close = () => {
    // ✕ cancels a running tiled export, then closes (S §2.3)
    exportAbort.current?.abort();
    haptic();
    go(source.returnTo === 'camera' ? { name: 'camera' } : { name: 'home' });
  };

  // the 美體 measure shown: the selected person's body, else the primary's, else the first body person's (S §2.4)
  const bodyOwner =
    (selected.kind === 'person' && measures.has(selected.id) ? selected.id : null) ??
    (measures.has(primary) ? primary : null) ??
    ([...measures.keys()][0] ?? null);
  // (no measure yet: the primary's body, else the first body, as the detection status reads it)
  const ownerBody = bodyOwner
    ? (detect?.persons.find((p) => p.id === bodyOwner)?.body ?? null)
    : (detect?.persons.find((p) => p.id === primary)?.body ?? detect?.bodies?.[0]?.id ?? null);
  // (in U, like the measure: a new 增高 band is suggested on the legs' E rows, S §3.4)
  const ownerDet = detect && ownerBody ? bodyDetectionOf(detect, ownerBody) : null;
  const bodyCtx = {
    ...bodyPanelContext(
      bodyDet.phase === 'done' ? { phase: 'done', det: ownerDet && detU(ownerDet) } : bodyDet,
      bodyTracker,
      bodyOwner ? (measures.get(bodyOwner) ?? null) : null,
      paramAvailability,
      retryBody,
    ),
    legsAnchor: detect ? legsAnchorOf(edit, detect, measures) : null,
    // a selected body person the lens refuses is told its own measure's reason (none: BODY_UNMEASURED_REASON)
    personGate: personBodyGate(measures, paramAvailability),
  };
  const lens = lensOf(edit);
  // ── 祛痘 (skin-cleanup spec §2.3): the size, the two-tap clear and its scope, the tap rings ──
  const [spotSize, setSpotSizeState] = useState<SpotSize>(lastSpotSize);
  const setSpotSize = (s: SpotSize) => {
    lastSpotSize = s;
    setSpotSizeState(s);
  };
  /** the 清除 button is armed (「確定清除？」) until this performance.now(); 0 = not armed */
  const [confirmUntil, setConfirmUntil] = useState(0);
  const [rings, setRings] = useState<SpotRing[]>([]);
  const ringSeq = useRef(0);
  /** 「放大畫面可以點得更準」 once per editor session */
  const zoomHintDone = useRef(false);
  /** 清除此人 with one person of a group photo selected, else 全部清除 */
  const clearSc = clearScope(selected, detect?.persons.length ?? 0);
  const inScope = spotsInScope(edit, clearSc);
  // 膚質 (skin-cleanup spec §1.2, §2.2): the photo's face answer; the closed-mouth / closed-eye notes of the target faces
  const personOfFace = new Map((detect?.persons ?? []).filter((p) => p.face).map((p) => [p.face as string, p.id]));
  const toneTargets = (session?.faces ?? []).filter((f) => selected.kind === 'all' || personOfFace.get(f.id) === selected.id).map((f) => f.face);
  // 基本模式, or a tracker that came keeps it until its bind answers (that may wait for a drag or an export to end)
  const basicBind = !!bundle?.basic || !!(bundle?.tracker && bound && !bound.tracked);
  const skinCtx: SkinPanelContext = {
    // no answer yet while analysing (session null): no disabled flash, as the face note below (the slider row and the
    // canvas input are off until the session exists anyway)
    answer: session ? faceAnswer({ hasFaces: session.faces.length > 0, basic: basicBind, unsure: !!bound?.unsure, tracker: trackerHealth }) : 'faces',
    mouthClosed: toneTargets.length > 0 && toneTargets.every((f) => mouthOpen(f, bodyAspect) < 0.01),
    eyesClosed: toneTargets.length > 0 && toneTargets.every((f) => earOf(f, 'L', bodyAspect) < 0.12 && earOf(f, 'R', bodyAspect) < 0.12),
    spots: { inScope, total: edit.photo.spots.length, onePerson: clearSc !== 'all' },
  };
  const binding = sliderFor(lens, sel, bodyCtx, skinCtx);
  // the mode is up only while 祛痘 can act: a face answer that turned unsure (S §7) gates the tile and the taps alike
  const spotMode = !!session && showsSpotMode(sel) && skinToolGate('spot', skinCtx).ok;
  // Review Focus 3: ↶ ↷, a new spot, a chip change (or leaving the mode) disarms a pending 「確定清除？」
  const armKey = clearArmKey(String(clearSc), inScope, edit.photo.spots.length);
  useEffect(() => setConfirmUntil(0), [armKey, spotMode]);
  useEffect(() => {
    if (!confirmUntil) return;
    const t = window.setTimeout(() => setConfirmUntil(0), Math.max(0, confirmUntil - performance.now()));
    return () => clearTimeout(t);
  }, [confirmUntil]);
  useEffect(() => debug({ spots: edit.photo.spots.length }), [edit.photo.spots]);

  /** 祛痘: a tap (V uv) → O through the CPU back-map → refusals, radius, patch, snap and donor, owner → one undo step (S §3.4) */
  const tapSpot = (v: [number, number]) => {
    const s = sessionRef.current;
    // no spot while an export runs: its overlay stops taps that start on it (zoomPan skips .status), and this guard the
    // press that began before the export and ends during it (the display is paused, so the spot would not show)
    if (!s || hold.held || exportBusy || !spotTapInside(v)) return;
    const cur = editRef.current;
    if (cur.photo.spots.length >= SPOT_CAP) {
      toast(TONE_COPY.spotCap, 2600);
      return;
    }
    // the geometry the session draws (its crop snapped to whole working px, as the layer shows it)
    const shown = snapCrop(cur.photo.geometry, photo);
    let o: [number, number];
    try {
      // the frame the session shows for `cur`: every face with its person's params, limit and λ_f (frameOf)
      const f = frameOf(cur, s);
      // the 推臉筆 field first, so a spot tapped after strokes lands on what the finger touched (push-brush spec §4.5)
      o = backMapCpu(v, backMapFrameOf({ faces: f.faces, obstacles: f.obstacles, body: s.body, geometry: shown, liquify: liquify.field }, photo));
    } catch (e) {
      reportError(e, 'backMapCpu');
      return;
    }
    const aspect = photo.width / photo.height;
    const faces = s.faces.map((f) => ({ id: f.id, face: f.face }));
    const region = regionAt(o, faces, aspect);
    if (region.kind === 'eye' || region.kind === 'mouth') {
      toast(TONE_COPY.spotRefused, 2600);
      return;
    }
    const r = spotRadius(o, spotSize, faces, photo);
    let res: PlanResult;
    try {
      res = planSpot(readPatch(source.bitmap, patchPlan(o, r, photo)), o, r, { faces, aspect, existing: cur.photo.spots });
    } catch (e) {
      // S §7: the spot is still added at the tap, in fill mode
      reportError(e, 'readPatch');
      res = { x: o[0], y: o[1], r, dx: 0, dy: 0, owner: null };
    }
    if ('refused' in res) {
      toast(res.refused === 'cap' ? TONE_COPY.spotCap : TONE_COPY.spotRefused, 2600);
      return;
    }
    const spot = { ...res, owner: ownerAt([res.x, res.y], ownerCtxOf(detectRef.current, faces, aspect)) };
    haptic();
    const short = Math.min(photo.width, photo.height);
    const vWidth = viewSize(shown, photo).width;
    const id = ++ringSeq.current;
    setRings((rs) => [...rs, { id, x: v[0], y: v[1], r: (r * short) / vWidth }]);
    window.setTimeout(() => setRings((rs) => rs.filter((g) => g.id !== id)), 350);
    // the spot's on-screen diameter (the layer's rect carries the zoom) below 12 pt
    const layerW = layerRef.current?.getBoundingClientRect().width ?? 0;
    if (!zoomHintDone.current && 2 * r * short * (layerW / vWidth) < 12) {
      zoomHintDone.current = true;
      toast(TONE_COPY.zoomHint, 2600);
    }
    debug({ lastSpot: spot });
    update(addSpot(cur, spot), true);
  };
  /** 清除: the first tap arms 「確定清除？」 for 3 s, a second one clears the scope as one ↶ step */
  const onClear = () => {
    const r = clearTap(confirmUntil, performance.now(), inScope);
    setConfirmUntil(r.confirmUntil);
    haptic();
    if (r.clear) update(clearSpots(editRef.current, clearSc), true);
  };

  // ── persons UI (S §2): photo taps, the strip, the face boxes ──
  /** 調節 and 一鍵 › 質感 act on the whole photo, like 濾鏡: no face boxes, no photo taps (step-2 spec §2.1–2.2) */
  const personTab = PERSON_TABS.has(sel.tab) && photoTabLabel(sel) === null;
  const tapsOn = !!session && multi && personTab && !showsHeightBand(sel, bodyCtx);
  /** a photo tap selects the person under it (S §2.3); not in 祛痘 mode, where only the chips change the selection */
  const onPersonTap = tapsOn
    ? (uv: [number, number], rect: DOMRect) => {
        wakeBoxes();
        const d = detectRef.current;
        if (!d || dragging) return;
        // the layer shows V: the hit test runs in O (S §2.2), its 44 pt minimum too
        const toO = vToO(g, photo);
        const o = apply(toO, uv);
        const lq = liquify.backward({ x: o[0], y: o[1] }); // 推臉筆 first (push-brush spec §4.5); hitPerson then adds the body field
        const hit = hitPerson([lq.x, lq.y], hitCtxOf(d, sel.tab === 'body', fieldMemo.field, rect, toO));
        if (hit) choose({ kind: 'person', id: hit });
      }
    : undefined;
  // off in 裁切 mode, and its view is reset to identity when the tab opens (S §2.1)
  // brush mode: one finger draws, and no person is selected by a tap (push-brush spec §2.5), also while 按住對比 is held.
  // brushMode and spotMode are never both true (美型／美體 versus 美膚); zoomPan reads `brush` before `spotTap` and `onTap`
  useZoomPan(stageRef, layerRef, !!session && !cropMode, {
    onTap: spotMode || brushMode ? undefined : onPersonTap,
    spotTap: spotMode ? tapSpot : undefined,
    resetWhen: cropMode,
    brush: brushHooks,
  });
  /** chip thumbnails, drawn once per person from the working bitmap */
  const [thumbs, setThumbs] = useState<Readonly<Record<PersonId, string | null>>>({});
  useEffect(() => {
    if (!detect || detect.persons.length < 2) return;
    const missing = detect.persons.filter((p) => !(p.id in thumbs));
    if (!missing.length) return;
    const next = { ...thumbs };
    for (const p of missing) {
      try {
        next[p.id] = drawThumb(source.bitmap, thumbRect(detect, p));
      } catch (e) {
        reportError(e, 'person thumb');
        next[p.id] = null;
      }
    }
    setThumbs(next);
  }, [detect]);
  // strokes are photo-level (push-brush spec §1.2): the strip dims with 「整張照片」 in brush mode
  const scope = multi && (photoScoped(sel, lens) || brushMode);
  const stripPersons: StripPerson[] = infos.map((p, i) => ({
    id: p.id,
    n: i + 1,
    label: `人物 ${i + 1}${!p.face ? '（未偵測到臉部）' : !p.body && detect?.bodies ? '（未偵測到身體）' : ''}`,
    thumb: thumbs[p.id] ?? null,
    changed: changedIds.includes(p.id),
    ruler: sel.tab === 'body' && sel.body === 'body.legs' && bodyCtx.legsAnchor === p.id,
  }));
  // 增高 / 長腿 stretch whole rows on every tab, so the boxes follow the bands wherever they show (S §2.1 Position)
  const bands = detect && multi ? fieldBands(fieldInputOf(edit, detect, measures, bodyAspect)) : [];
  // the layer's width at zoom 1 (zoomPan scales it with a transform, which offsetWidth leaves out): the badges' CSS
  // multiplies the box width by the zoom itself, so a pinch needs no render (S §2.1)
  const layerW = layerRef.current?.offsetWidth ?? 0;
  const boxItems: FaceBoxItem[] =
    detect && multi && personTab
      ? detect.persons.flatMap((p, i): FaceBoxItem[] => {
          const f = p.face ? detect.faces.find((x) => x.id === p.face) : undefined;
          const b = !f && sel.tab === 'body' && p.body ? detect.bodies?.find((x) => x.id === p.body) : undefined;
          const oBox = f?.box ?? (b ? bodyBox(b) : null);
          if (!oBox) return [];
          // V-normalized (S §2.2): a face's oval, a body-only person's dashed pose box by its corners
          const box = f ? faceViewBox(f) : viewBoxOf(cornersOf(oBox), oBox);
          return [{ person: p.id, n: i + 1, box, selected: selected.kind === 'all' || selected.id === p.id, changed: changedIds.includes(p.id), dashed: !f, width: box.w * layerW }];
        })
      : [];
  // 祛痘 and 推臉筆 hide the boxes (C §2.2): the chips stay (in 祛痘 they pick the 清除 scope)
  const showBoxes = !!session && !fatal && !dragging && !hold.held && !showsHeightBand(sel, bodyCtx) && !spotMode && !brushMode;
  // face effects cannot apply: 基本模式, or no face in this photo (null while analysing, so no flash)
  // (a tracker that could not answer gets a neutral note until the re-detect gives a real answer)
  let faceNote: string | null = null;
  if (session && !session.faces.length) {
    if (basicBind) faceNote = '基本模式不支援臉型與美妝';
    else if (!bound?.unsure) faceNote = '未偵測到臉部，臉型與美妝不會套用';
    else if (trackerHealth === 'lost') faceNote = '臉部偵測重新啟動中，臉型與美妝暫不套用';
    else if (trackerHealth === 'failed') faceNote = '臉部偵測暫停，臉型與美妝暫不套用';
    else faceNote = '臉部偵測失敗，臉型與美妝暫不套用';
  }
  const faceOff = !!faceNote && FACE_TABS.includes(sel.tab);
  // S5 §2.4: closed eyes and small faces only for one selected person (not under 全部); the program failure always
  const selFace = selected.kind === 'person' ? faceOfPerson(selected.id) : null;
  const eyes = selFace ? eyeNoteInfo(selFace, photo.width / photo.height) : { lensClosed: false, lashesClosed: false, lashesSmall: false };
  const mkNote = makeupNote(sel, { ...eyes, procFailed: !!bound?.engine.procMakeupFailed });
  // the frame takes the V aspect (S §2.2)
  const view = session ? session.viewSizeFor(g) : { width: source.bitmap.width, height: Math.max(1, source.bitmap.height) };
  const ratio = view.width / view.height || 0.75;

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
  } else if (scanning) {
    overlay = <Status spinner title="正在重新偵測臉部…" />;
  } else if (!session) {
    overlay = <Status spinner title="正在分析臉部…" />;
  } else if (completing) {
    // the cached faces stay in view under it (step-1 spec §6.5)
    overlay = <Status spinner scrim title="正在重新偵測臉部…" />;
  } else if (exporting) {
    overlay = (
      <Status spinner scrim title={EXPORT_COPY.overlay} detail={`${Math.round(exporting.progress * 100)}%`}>
        <button type="button" class="btn" onClick={() => exportAbort.current?.abort()}>
          {EXPORT_COPY.cancel}
        </button>
      </Status>
    );
  } else if (lost) {
    overlay = <EngineStatus />; // 正在恢復畫面 · 重新載入引擎
  }

  return (
    <div class="screen editor">
      <div class="topbar">
        <IconButton icon="close" label="關閉" onClick={close} />
        <div class="title-center" inert={exportBusy}>
          <IconButton icon="undo" label="復原" onClick={doUndo} disabled={!undo?.canUndo || drawing} />
          <IconButton icon="redo" label="重做" onClick={doRedo} disabled={!undo?.canRedo || drawing} />
        </div>
        <button type="button" class="pill" onClick={save} disabled={!session || pill === 'preparing' || lost} aria-busy={pill === 'preparing'}>
          <span>{pillLabel(pill)}</span>
        </button>
      </div>

      <div class="stage editor-stage" ref={stageRef}>
        <div class={`frame${cropMode ? ' crop-mode' : ''}`} ref={frameEl} style={cropMode ? undefined : { '--r': String(ratio) }}>
          <div class="zoom-layer" ref={layerRef}>
            <CanvasHost
              fit="contain"
              style={
                cropLayout
                  ? {
                      left: `${cropLayout.canvas.x}px`,
                      top: `${cropLayout.canvas.y}px`,
                      right: 'auto',
                      bottom: 'auto',
                      width: `${cropLayout.canvas.w}px`,
                      height: `${cropLayout.canvas.h}px`,
                      transform: cssTurn(cropLayout),
                      transformOrigin: '50% 50%',
                      transition: turning ? 'transform 240ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
                    }
                  : undefined
              }
            />
            {/* 裁切 is not in PERSON_TABS, so its boxItems are already empty there (C §2.2). The 增高 / 長腿 row shift maps
                through the crop at θ = 0 (exactly forwardY at identity); with θ ≠ 0 the rows tilt and no shift is drawn */}
            {showBoxes && (
              <FaceBoxes
                items={boxItems}
                dim={scope}
                idle={boxesIdle}
                mapY={bands.length && g.straighten === 0 ? (y) => (forwardY(bands, g.crop.y + y * g.crop.h) - g.crop.y) / g.crop.h : undefined}
              />
            )}
            {session && !fatal && !hold.held && !cropMode && showsHeightBand(sel, bodyCtx) && (
              <BandPlane geometry={g}>
                <HeightBandOverlay
                  band={bandOrSuggested(edit, bodyCtx)}
                  stretch={heightBandStretch}
                  onChange={(b, commit) => {
                    const l = lensOf(editRef.current);
                    const t = bandTouchToast(l, touchedPhoto.current);
                    if (t) toast(t);
                    update(l.setHeightBand(b), commit);
                  }}
                  yAt={(cx, cy) => {
                    // client → V → E (C §3.5): the lines are E rows
                    const r = layerRef.current?.getBoundingClientRect();
                    return r && r.width > 0 ? eYAt(g, photo, [(cx - r.left) / r.width, (cy - r.top) / r.height]) : 0;
                  }}
                />
              </BandPlane>
            )}
            {spotMode && !hold.held && <SpotOverlay rings={rings} />}
          </div>
          {cropLayout && session && !fatal && (
            <CropOverlay
              layout={cropLayout}
              geometry={g}
              lock={sel.crop}
              oSize={photo}
              grid={straightening}
              onChange={(ng, commit) => {
                setCropDragging(!commit);
                update(editSetGeometry(editRef.current, ng), commit);
              }}
            />
          )}
          {hold.held && <span class="corner-label">原圖</span>}
          {spotMode && !hold.held && <span class="corner-label spot-hint">{TONE_COPY.spotHint}</span>}
          {/* 推臉筆 (push-brush spec §2.3): screen space, outside the zoom layer */}
          {brushDraws && <BrushOverlay handle={ring} />}
          {brushMode && hint && !liquifyBusy && <BrushHint key={hint.gen} kind={hint.kind} />}
          {/* a chunked rebuild past 300 ms (push-brush spec §3.5): a pill in the hint's place, not a status card, so the
              previous frame stays visible (on a reopen there is none yet); input passes through, the brush refuses it */}
          {liquifyBusy && session && !fatal && !overlay && (
            <div class="liquify-busy" role="status">
              <span class="spinner" aria-hidden="true" />
              正在套用推臉筆…
            </div>
          )}
          {session && !fatal && (
            <div class="editor-tools" inert={exportBusy}>
              <button type="button" class={`float-btn${confirmReset ? ' confirm' : ''}`} onClick={reset}>
                <span>
                  <Icon name="reset" size={16} stroke={2} />
                  {confirmReset ? (multi ? '確定重置全部？' : '確定重置？') : '重置'}
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

      <div class="editor-panel" inert={exportBusy}>
        {session && multi && (
          <PersonStrip persons={stripPersons} selection={selected} photoScope={scope} onSelect={choose} thumbTransform={isIdentity(g) ? undefined : chipTransform(g)} />
        )}
        {/* the brush bar takes the slider row's place, also when faceOff (the brush is never gated, push-brush spec §2.1) */}
        {brushMode ? (
          <BrushBar
            kind={brushKind}
            size={brushSize}
            strokes={edit.photo.strokes.length}
            busy={drawing || liquifyBusy}
            onKind={setBrushKind}
            onSize={setBrushSize}
            onClear={clearAllStrokes}
          />
        ) : spotMode ? (
          <SpotControls
            size={spotSize}
            onSize={setSpotSize}
            label={clearLabel(inScope, clearSc !== 'all', confirmUntil > 0)}
            disabled={inScope === 0}
            confirming={confirmUntil > 0}
            onClear={onClear}
          />
        ) : (
          <SliderRow
            binding={session && !faceOff ? (cropMode ? straightenView(g) : binding) : null}
            onChange={(v) => (cropMode ? straightenTo(v, false) : binding && slide(binding, v, false))}
            onCommit={(v) => (cropMode ? straightenTo(v, true) : binding && slide(binding, v, true))}
            emptyText={session && !faceOff ? sliderEmptyText(lens, sel) : null}
            onSel={setSel}
          />
        )}
        <BeautyPanel
          lens={lens}
          sel={sel}
          onSel={setSel}
          onEdit={(e, shown) => update(e, true, true, shown)}
          faceNote={faceNote}
          body={bodyCtx}
          skin={skinCtx}
          photoTouched={touchedPhoto.current}
          lookFailed={(id) => bundle?.engine.lutState('look', id) === 'failed'}
          onRetryLook={retryLook}
          crop={{ geometry: g, lock: sel.crop, oSize: photo, onAction: onCropAction }}
          makeupNote={mkNote}
        />
      </div>
      <div class="editor-bottom-pad" />
    </div>
  );
}
