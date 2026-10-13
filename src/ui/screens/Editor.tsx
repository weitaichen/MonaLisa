// Editor 編輯 (spec §7.2.4): ✕ · ↶ ↷ · 儲存; framed canvas with pinch-zoom / pan / double-tap fit;
// 按住對比 + 重置 (inline confirm) on the canvas; docked slider + BeautyPanel. Every edit is
// re-encoded (debounced 400 ms) so 儲存 can share synchronously, and autosaved to 最近編輯.
// Persons (S §3.3): the first definite face answer builds the detection cache (firstAnswer) and maps the edit onto
// its persons (the current edit and every undo state); the cache is written with the entry, so a reopen runs no
// detector. Every face is drawn with its person's params and its own 瘦臉 limit (buildFrame). With ≥ 2 persons the
// person strip (全部 + one chip per person) and the drawn face boxes show (S §2.1); a chip or a photo tap selects a
// person (hitPerson, S §2.3), and every panel write goes through the lens of that selection (or 全部).
// 美體 (body research report §落地設計): the pose model loads the first time the 美體 tab opens; every body joins the
// persons (bodyAnswer: withBodies, paired against the cache's own faces) and is cached in the entry's detection, and
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
import type { SessionFace, StillSession } from '../../app/still';
import { forwardY, heightBandStretch } from '../../body/bands';
import { bodyFieldCacheStats, buildBodyField, fieldBands, type BodyFieldInput } from '../../body/field';
import { measureBody, paramAvailability } from '../../body/measure';
import { bodyBox, personInfos } from '../../detect/cache';
import { hitPerson } from '../../detect/persons';
import { sanitizeParams } from '../../engine/params';
import { NO_SOURCE, sourceSizeRecord, type SourceInfo } from '../../media/exportPlan';
import { takePersonsHint } from '../../store/settings';
import { stableKey } from '../../store/undo';
import { buildFaceProtect } from '../../tracking/faceProtect';
import type { BodyDetection, BodyField, DetectionCache, EditState, Engine, FaceProtect, LookId, PersonId, PersonMask, Rect, Selection } from '../../types';
import { buildFrame } from '../../edit/frame';
import { lensFor } from '../../edit/lens';
import { legacyProjection } from '../../edit/legacy';
import { bodyAnswer, firstAnswer } from '../../edit/migrate';
import { editKey, editSetGeometry, P0 } from '../../edit/state';
import { createWarpGuard } from '../../edit/warpGuard';
import { bodiesUToO, faceOToU, fieldUToO, maskOToU, maskUToO, poseOToU, upCanvas, upImage, upTracker } from '../../geometry/upFrame';
import { apply, chipTransform, cropModeLayout, cssTurn, eYAt, isIdentity, lockFor, ovalViewBox, upQuarter, vToO, type Quarter } from '../../geometry/view';
import { BeautyPanel, FACE_TABS } from '../components/BeautyPanel';
import { FaceBoxes, type FaceBoxItem } from '../components/FaceBoxes';
import { BandPlane, HeightBandOverlay } from '../components/HeightBandOverlay';
import { CanvasHost } from '../components/CanvasHost';
import { CropOverlay } from '../components/CropOverlay';
import { IconButton } from '../components/Controls';
import { EngineStatus } from '../components/EngineStatus';
import { drawThumb, PersonStrip, type StripPerson } from '../components/PersonStrip';
import { SliderRow } from '../components/Slider';
import { Status } from '../components/Status';
import { debug, reportError } from '../debug';
import { cropActivate, StraightenGesture, straightenView, type CropAction } from '../cropPanel';
import { deps, type UndoLike } from '../deps';
import {
  addBodyScan,
  answerNotices,
  ANY_FIELD,
  BodyFieldMemo,
  bodyDetectionOf,
  bodyPanelContext,
  changedPersons,
  detectBody,
  detectSession,
  exportOnLatest,
  FieldDraftGate,
  fieldInputOf,
  frameFacesOf,
  hitCtxOf,
  legsAnchorOf,
  measuredAvailable,
  measurePersons,
  needsBodyScan,
  needsFaceScan,
  PERSON_TABS,
  protectRequests,
  rebaseStamp,
  RedetectBudget,
  sessionPlan,
  shouldDetectBody,
  stampIs,
  thumbRect,
  undoToast,
  type BodyDet,
  type OutputStamp,
} from '../editorModel';
import { FaceProtectSource, isContourEdit, maskCoversFace, paramsPatch, type FaceProtectRecord } from '../faceProtectModel';
import { Icon } from '../icons';
import {
  bandOrSuggested,
  bandTouchToast,
  INITIAL_SELECTION,
  personNumber,
  photoScoped,
  photoTabLabel,
  photoTouchToast,
  showsHeightBand,
  sliderEmptyText,
  sliderFor,
  type PanelSelection,
  type SliderBinding,
} from '../panelModel';
import { haptic } from '../platform';
import { ensureBodyTracker, ensureEngine, ensureFaceSegmenter, svc } from '../services';
import { go, setPendingHistory, showSaveFallback, toast, type EditorSource } from '../state';
import { useStore } from '../store';
import { requestLut, useAdjustFailureNotice, useElementSize, useHold, useLutLoader } from './hooks';
import { useZoomPan } from './zoomPan';

const ENCODE_DEBOUNCE_MS = 400;
const THUMB_EDGE = 360;
const ORIGINAL_EDGE = 2048;
/** how long a history flush waits for a filter LUT still downloading before giving up on correcting the thumb */
const FLUSH_LUT_WAIT_MS = 3000;
/** let the 正在偵測人物 note paint before the synchronous pose detection */
const BODY_PAINT_MS = 60;
/** the stage's bottom band under the editor tools (theme.css `.editor-tools`: bottom 2px + 48px tall) */
const TOOLS_BAND = 50;

let lastSel: PanelSelection = INITIAL_SELECTION;

export function Editor({ source }: { source: EditorSource }) {
  const engine = useStore(svc, (s) => s.engine);
  const lost = useStore(svc, (s) => s.lost);
  /** the tracker is replacing a dead graph ('lost') or paused its automatic retries ('failed') */
  const trackerHealth = useStore(svc, (s) => s.tracker);
  const bundle = engine.state === 'ready' ? engine.bundle : null;

  const [edit, setEditState] = useState<EditState>(source.edit);
  const editRef = useRef(edit);
  editRef.current = edit;
  /** the photo's detection cache (persons, faces, bodies); null until the first definite face answer */
  const [detect, setDetectState] = useState<DetectionCache | null>(source.detect);
  const detectRef = useRef(detect);
  const setDetect = (d: DetectionCache) => {
    detectRef.current = d;
    setDetectState(d);
  };
  /** the photo had its first definite face answer (a stored cache counts): the source's one-shot inputs are spent */
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
   */
  const [bound, setBound] = useState<{ s: StillSession; engine: Engine; unsure: boolean } | null>(null);
  /** bumped to detect again on the same engine once the tracker can answer (bounded: RedetectBudget) */
  const [detectGen, setDetectGen] = useState(0);
  const [redetect] = useState(() => new RedetectBudget(trackerHealth));
  /**
   * a face scan of a new up-frame is pending (S §3.6: a sideways photo, scanned once on leaving 裁切 or after ↶ ↷):
   * the next session detects on the U image of `scanQuarter` instead of reusing the cache. Cleared by its answer
   */
  const forceDetect = useRef(false);
  const scanQuarter = useRef<Quarter>(0);
  /** 正在重新偵測臉部… until the scanning session is bound */
  const [scanning, setScanning] = useState(false);
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
  const saved = useRef<OutputStamp | null>(source.historyId ? { key: editKey(source.edit), field: ANY_FIELD } : null);
  const historyChain = useRef<Promise<unknown>>(Promise.resolve());
  /** the entry holds this photo's segmenter mask (HistoryEntry.faceMask) already */
  const faceMaskStored = useRef(!!source.faceMask);
  const originalBlob = useRef<Promise<Blob> | null>(null);
  const setupDone = useRef(false);
  const sessionEngine = useRef<Engine | null>(null);
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
  const lensOf = (e: EditState) => lensFor(e, selected, infos, primary, { available: (p, id) => measuredAvailable(measuresRef.current, p, id, paramAvailability) });
  /** every face's 瘦臉 limit by face id (absent = unlimited): every render and export draws with them */
  const [protects, setProtects] = useState<ReadonlyMap<string, FaceProtect>>(() => new Map());
  const protectsRef = useRef(protects);
  protectsRef.current = protects;
  /** λ_f per face id from the last commit (S §4.4): reset by the next change, recomputed on every commit */
  const warpScales = useRef<ReadonlyMap<string, number>>(new Map());
  /** the safety net memoized on its table: a commit that changes no face warp (a filter tile, a shade, 美體…) skips the CPU map */
  const warpGuard = useMemo(createWarpGuard, []);
  /**
   * what session `s` renders and exports for `e`: every face with its person's params and its limit (S §4.1). Pass the
   * exporting session: a corrected thumbnail may still export after the unmount cleared sessionRef
   */
  const frameOf = (e: EditState, s: StillSession | null = sessionRef.current) => {
    const d = detectRef.current;
    return buildFrame(e, frameFacesOf(d, s?.faces ?? []), d?.obstacles ?? [], protectsRef.current, d?.primary ?? P0, warpScales.current);
  };
  /** on a commit with ≥ 2 faces: the CPU port checks the summed map (once per warp); an empty map whenever the guard does not act */
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
    lastSel = s;
    setSelState(s);
    // another item's slider: a drag of the old one can no longer commit (its row was replaced)
    setDragging(false);
  };

  /**
   * commit=true records an undo step; commit=false is a drag step (the 美體 field previews a draft). `user`: a panel
   * write through the selection (重置 resets everyone whatever is selected: no 全部 toast)
   */
  const update = (e: EditState, commit: boolean, user = true) => {
    fieldDraft.noteUpdate(commit);
    // a drag step draws the plain table; the commit checks it (S §4.4)
    warpScales.current = commit ? guardScales(e) : new Map();
    // the first 全部 write of this editor session says so (S §2.4)
    if (user && multi && selected.kind === 'all' && !allToastDone.current && changedPersons(editRef.current, e).length) {
      allToastDone.current = true;
      toast('已套用到全部人物');
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
   * the saved thumbnail no longer shows what the editor draws (a v1 group photo: 0.3 drew faces[0], 0.4 draws the
   * primary; faces found by a re-detect after a faceless output): rewritten once, without reordering 最近編輯
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
    rebaseOnDetect(a.rebase, a.detect);
    // detection finished: the primary is selected (S §2.2)
    setSelection({ kind: 'person', id: a.detect.primary });
    if (!first) return;
    // a v1 entry (primaryInit set by openState) with ≥ 2 faces: 0.3 drew faces[0], 0.4 draws the primary
    if (source.historyId && source.edit.primaryInit && a.detect.faces.length >= 2) thumbOwed.current = true;
    const notices = a.dropped || source.cacheDropped ? ['已重新偵測臉部，部分人物的設定已重設'] : [];
    const persons = a.detect.persons.length;
    // over cap / too small only with the strip; the first group photo ever adds the hint (S §1.1 item 11, §2.6)
    notices.push(...answerNotices(a.detect, persons, persons >= 2 && takePersonsHint()));
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
        // a fitting cache with an upright answer (the photo's own, or one found before the session a lost engine took
        // with it) is used as is, also without a tracker: cached faces are render inputs (S §3.3 item 3) and a definite
        // answer, never unsure. Anything else (no cache, a 基本模式 one, a dropped one) detects once a tracker allows
        const cache = detectRef.current;
        // a face scan of a new up-frame (S §3.6) detects whatever the cache holds (sessionPlan would reuse a cache
        // scanned upright), on the U image, answering in O
        const forced = forceDetect.current;
        const q: Quarter = forced ? scanQuarter.current : 0;
        const { useCache, asks } = forced ? { useCache: false, asks: !!tracker } : sessionPlan(cache, !!tracker);
        const { s, unsure } = detectSession(
          asks,
          () => svc.get().tracker === 'ok',
          () =>
            deps.createStillSession(target, tracker && upTracker(tracker, q), source.bitmap, {
              ownsBitmap: false,
              faces: useCache ? cache?.faces : undefined,
              obstacles: useCache ? cache?.obstacles : undefined,
              body: fieldMemo.field,
            }),
        );
        // a tracker that could not answer is not "no face": no answer until the re-detect gives a real one
        if (!useCache && (!tracker || !unsure)) {
          // the source's one-shot inputs ride with the photo's first answer only
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
            }),
            first,
          );
          // found on a re-detect: the output written so far lacks the face effects
          if (replacing && s.faces.length) thumbOwed.current = true;
          // answered: the scan is done. (A tracker that could not answer keeps it pending, so the bounded re-detect
          // retries it in U, and the scan effect does not start another one for every new session)
          forceDetect.current = false;
        }
        sessionRef.current = s;
        setBound({ s, engine: target, unsure });
        setScanning(false);
        // only a fresh answer says so (a reopened no-face photo shows no toast, S §8.4)
        if (tracker && !unsure && !useCache && !s.faces.length) toast('未偵測到臉部，僅套用美膚與濾鏡', 3200);
      } catch (e) {
        setFatal(reportError(e, 'createStillSession'));
      }
    }, 60);
  }, [currentEngine, detectGen]);

  // the session draws identity geometry while 裁切 is open; the ratio lock is derived from the crop on entering
  const wasCrop = useRef(false);
  useEffect(() => {
    if (cropMode !== wasCrop.current) {
      wasCrop.current = cropMode;
      straighten.reset();
      setStraightening(false);
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
  // leaving 裁切, or after ↶ ↷ elsewhere), detect once more on that U image, behind 正在重新偵測臉部…. Never in 裁切 (each
  // 旋轉 tap would block for the detection), never while a scan is pending, and only on a bound session
  useEffect(() => {
    if (!bundle || !session || forceDetect.current) return;
    const geometry = editRef.current.photo.geometry;
    if (!needsFaceScan({ cache: detectRef.current, geometry, mode: cropMode ? 'crop' : 'normal', hasTracker: !!bundle.tracker })) return;
    scanQuarter.current = upQuarter(geometry);
    forceDetect.current = true;
    setScanning(true);
    setDetectGen((n) => n + 1);
  }, [cropMode, edit.photo.geometry, detect, session]);

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
   * Write the current params to history now if the debounce has not (✕ / 返回 within 400 ms of an edit,
   * or the app going to the background). Synchronous readback, so it works right before dispose.
   * When the filter LUT is not resident yet, a corrected thumbnail follows on historyChain: the session must
   * stay alive until that settles.
   */
  const flushHistory = () => {
    const s = sessionRef.current;
    if (!s || fatalRef.current) return;
    const e = editRef.current;
    const key = editKey(e);
    const gen = settleField();
    if (stampIs(saved.current, key, gen)) return;
    if (sessionEngine.current?.lost) {
      // no GL to render a thumbnail: keep at least the params of an existing entry (with their limit record, like
      // every params write: what the user saw them drawn with)
      const id = historyId.current;
      if (!id) return;
      saved.current = { key, field: gen };
      const limit = limitRecord();
      historyChain.current = historyChain.current
        .then(() => writeParams(id, e, limit))
        .catch((err: unknown) => reportError(err, 'history flush'));
      setPendingHistory(historyChain.current);
      return;
    }
    const ready = s.exportReady(frameOf(e, s));
    const field = snapshotField();
    let stamp: OutputStamp;
    try {
      stamp = queueHistory(e, gen, s.exportImageData(frameOf(e, s), field), s);
    } catch (err) {
      reportError(err, 'history flush');
      return;
    }
    if (ready) return;
    // the filter LUT (or a static texture) was still loading, so that thumbnail lacks it: write a corrected
    // one once it is resident, unless a newer edit was queued meanwhile (iOS may suspend us first: the
    // synchronous write above keeps the params either way)
    historyChain.current = historyChain.current
      .then(() => Promise.race([s.prepareExport(frameOf(e, s)), new Promise((r) => window.setTimeout(r, FLUSH_LUT_WAIT_MS))]))
      .then(async () => {
        if (saved.current !== stamp || !s.exportReady(frameOf(e, s))) return;
        await writeHistory(e, s.exportImageData(frameOf(e, s), field), s, limitRecord());
      })
      .catch((err: unknown) => reportError(err, 'history flush'));
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
          const cache = detectRef.current;
          if (!cache) return;
          try {
            // pairing (P4) against the cache's own faces (no session needed: an engine recovery has none), the body-only
            // persons appended from the template, a vanished body's person handing over (p0 in a photo without faces)
            const a = bodyAnswer(cache, dets ? bodiesUToO(dets, q).bodies : [], photo);
            rebaseOnDetect(a.rebase, { ...a.detect, bodyScans: addBodyScan(cache.bodyScans, q) });
            setBodyDet({ phase: 'done', det: null });
            // body-only persons made this a group photo: the strip mounts now, with the notices of a group answer
            const n = a.detect.persons.length;
            if (cache.persons.length < 2 && n >= 2) showNotices(answerNotices(a.detect, n, takePersonsHint()));
          } catch (e) {
            // never a spinner forever (or an unhandled rejection): 重試 runs the detection again
            if (!unmounted.current) setBodyDet({ phase: 'error', message: reportError(e, 'body answer') });
          }
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
  // tab after a failure retries. The bodies join the persons of the face answer: wait for it (detect). Nobody found, and
  // the photo turned to an up-frame not tried yet: the next 美體 open detects once more, on that U (S §3.6, D5)
  const lastTab = useRef(sel.tab);
  useEffect(() => {
    const entered = sel.tab === 'body' && lastTab.current !== 'body';
    lastTab.current = sel.tab;
    if (detectRef.current === null) return;
    const rescan = entered && bodyDet.phase !== 'working' && needsBodyScan(detectRef.current, editRef.current.photo.geometry);
    if (shouldDetectBody(bodyDet, { tabOpen: sel.tab === 'body', entered, params }) || rescan) startBodyDetection();
  }, [sel.tab, bodyDet, params, detect]);

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

  useEffect(() => {
    if (!session) return;
    try {
      session.render(frameOf(edit, session));
    } catch (e) {
      setFatal(reportError(e, 'session.render'));
    }
  }, [session, edit, protects, detect]);
  // (a layout effect: a tap's selection is readable by the time the event's task ends)
  useLayoutEffect(() => {
    if (!session) return;
    // V-normalized like the drawn boxes (S §2.2): a tap at a box centre on the layer hits that person
    debug({ persons: infos.length, faces: session.faces.length, selected: selId, boxes: (detect?.faces ?? []).map((f) => ({ id: f.id, ...faceViewBox(f) })) });
  }, [session, detect, infos, selId, edit.photo.geometry]);

  /**
   * Export + encode with the user's state captured when it was asked for (`e`, the 美體 `field`); waits for the filter
   * LUT so the file matches the settled preview, and draws with the 瘦臉 limits at export time (see save).
   */
  const encode = async (s: StillSession, e: EditState, field: BodyField | null) => {
    await s.prepareExport(frameOf(e, s));
    if (unmounted.current) throw new Error('editor closed');
    const img = s.exportImageData(frameOf(e, s), field);
    return { img, file: await deps.encodeJpeg(img, 0.92) };
  };

  // debounced re-encode (share cache) + autosave to history; paused while the context is lost (nothing to
  // read back) and re-armed once it is restored. While a 瘦臉 limit is still being computed it waits for it (at
  // most PROTECT_WAIT_MS from the segmenter's start; protectTick re-arms this once it settles, also when it brings
  // no limit), so the limit landing does not redo a full-resolution export + history write right after this one
  useEffect(() => {
    if (!session || lost) return;
    const s = session;
    const key = editKey(edit);
    if (stampIs(fresh.current, key, fieldGen.current) && stampIs(saved.current, key, fieldGen.current)) return;
    const delay = Math.max(ENCODE_DEBOUNCE_MS, protectSrc.outputHoldMs());
    const t = window.setTimeout(async () => {
      if (unmounted.current || sessionRef.current !== s || editKey(editRef.current) !== key) return;
      // (a drag held still past the debounce: export the full field, not its draft)
      const gen = settleField();
      const field = snapshotField();
      /** nothing newer (params, 美體 field, session) replaced what this export was made from */
      const current = () => editKey(editRef.current) === key && sessionRef.current === s && fieldGen.current === gen;
      let img: ImageData | null = null;
      if (!stampIs(fresh.current, key, gen)) {
        try {
          const r = await encode(s, edit, field);
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
      // the output of a saved entry is exported anyway for the share cache: an owed thumbnail (thumbOwed) is rewritten
      // from it once, without reordering 最近編輯
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
          img = s.exportImageData(frameOf(edit, s), field);
        } catch (e) {
          reportError(e, 'history export');
          return;
        }
      }
      // an edit (or a new field) during the await re-armed this effect: its own timer writes history
      if (!current()) return;
      queueHistory(edit, gen, img, s);
    }, delay);
    return () => clearTimeout(t);
  }, [session, edit, lost, fieldTick, protectTick]);

  const hold = useHold((on) => {
    try {
      sessionRef.current?.setCompare(on);
    } catch (e) {
      reportError(e, 'setCompare');
    }
  });

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
    const key = editKey(edit);
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
    exportOnLatest(session, (s) => encode(s, edit, field), replacement).then(
      ({ s, result: r }) => {
        setPreparing(false);
        // cached only while it still matches what is on screen (not after a 美體 edit during 準備中)
        if (sessionRef.current === s && editKey(editRef.current) === key && fieldGen.current === gen) {
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
    if (!undo?.canUndo) return;
    haptic();
    const before = editRef.current;
    const e = undo.undo();
    fieldDraft.noteFull();
    if (e) {
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
    if (!undo?.canRedo) return;
    haptic();
    const before = editRef.current;
    const e = undo.redo();
    fieldDraft.noteFull();
    if (e) {
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
    update(lensOf(editRef.current).reset(), true, false);
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
  };
  const lens = lensOf(edit);
  const binding = sliderFor(lens, sel, bodyCtx);

  // ── persons UI (S §2): photo taps, the strip, the face boxes ──
  /** 調節 and 一鍵 › 質感 act on the whole photo, like 濾鏡: no face boxes, no photo taps (step-2 spec §2.1–2.2) */
  const personTab = PERSON_TABS.has(sel.tab) && photoTabLabel(sel) === null;
  const tapsOn = !!session && multi && personTab && !showsHeightBand(sel, bodyCtx);
  // off in 裁切 mode, and its view is reset to identity when the tab opens (S §2.1)
  useZoomPan(stageRef, layerRef, !!session && !cropMode, {
    onTap: tapsOn
      ? (uv, rect) => {
          wakeBoxes();
          const d = detectRef.current;
          if (!d || dragging) return;
          // the layer shows V: the hit test runs in O (S §2.2)
          const hit = hitPerson(apply(vToO(g, photo), uv), hitCtxOf(d, sel.tab === 'body', fieldMemo.field, rect));
          if (hit) choose({ kind: 'person', id: hit });
        }
      : undefined,
    resetWhen: cropMode,
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
  const scope = multi && photoScoped(sel, lens);
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
  const layerW = layerRef.current?.getBoundingClientRect().width ?? 0;
  const boxItems: FaceBoxItem[] =
    detect && multi && personTab
      ? detect.persons.flatMap((p, i): FaceBoxItem[] => {
          const f = p.face ? detect.faces.find((x) => x.id === p.face) : undefined;
          const b = !f && sel.tab === 'body' && p.body ? detect.bodies?.find((x) => x.id === p.body) : undefined;
          const oBox = f?.box ?? (b ? bodyBox(b) : null);
          if (!oBox) return [];
          // V-normalized (S §2.2): a face's oval, a body-only person's dashed pose box by its corners
          const box = f ? faceViewBox(f) : viewBoxOf(cornersOf(oBox), oBox);
          return [{ person: p.id, n: i + 1, box, selected: selected.kind === 'all' || selected.id === p.id, changed: changedIds.includes(p.id), dashed: !f, narrow: box.w * layerW < 24 }];
        })
      : [];
  const showBoxes = !!session && !fatal && !dragging && !hold.held && !showsHeightBand(sel, bodyCtx);
  // face effects cannot apply: 基本模式, or no face in this photo (null while analysing, so no flash)
  // (a tracker that could not answer gets a neutral note until the re-detect gives a real answer)
  let faceNote: string | null = null;
  if (session && !session.faces.length) {
    if (bundle?.basic) faceNote = '基本模式不支援臉型與美妝';
    else if (!bound?.unsure) faceNote = '未偵測到臉部，臉型與美妝不會套用';
    else if (trackerHealth === 'lost') faceNote = '臉部偵測重新啟動中，臉型與美妝暫不套用';
    else if (trackerHealth === 'failed') faceNote = '臉部偵測暫停，臉型與美妝暫不套用';
    else faceNote = '臉部偵測失敗，臉型與美妝暫不套用';
  }
  const faceOff = !!faceNote && FACE_TABS.includes(sel.tab);
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
        <div class={`frame${cropMode ? ' crop-mode' : ''}`} style={cropMode ? undefined : { '--r': String(ratio) }}>
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
          </div>
          {cropLayout && session && !fatal && (
            <CropOverlay
              layout={cropLayout}
              geometry={g}
              lock={sel.crop}
              oSize={photo}
              grid={straightening}
              onChange={(ng, commit) => update(editSetGeometry(editRef.current, ng), commit)}
            />
          )}
          {hold.held && <span class="corner-label">原圖</span>}
          {session && !fatal && (
            <div class="editor-tools">
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

      <div class="editor-panel">
        {session && multi && (
          <PersonStrip persons={stripPersons} selection={selected} photoScope={scope} onSelect={choose} thumbTransform={isIdentity(g) ? undefined : chipTransform(g)} />
        )}
        <SliderRow
          binding={session && !faceOff ? (cropMode ? straightenView(g) : binding) : null}
          onChange={(v) => (cropMode ? straightenTo(v, false) : binding && slide(binding, v, false))}
          onCommit={(v) => (cropMode ? straightenTo(v, true) : binding && slide(binding, v, true))}
          emptyText={session && !faceOff ? sliderEmptyText(lens, sel) : null}
        />
        <BeautyPanel
          lens={lens}
          sel={sel}
          onSel={setSel}
          onEdit={(e) => update(e, true)}
          faceNote={faceNote}
          body={bodyCtx}
          photoTouched={touchedPhoto.current}
          lookFailed={(id) => bundle?.engine.lutState('look', id) === 'failed'}
          onRetryLook={retryLook}
          crop={{ geometry: g, lock: sel.crop, oSize: photo, onAction: onCropAction }}
        />
      </div>
      <div class="editor-bottom-pad" />
    </div>
  );
}
